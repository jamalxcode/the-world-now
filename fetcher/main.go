// Command fetcher downloads the public feeds listed in sources.json (RSS/Atom,
// public Telegram channels and public Bluesky accounts) and writes a single
// feed.json for the static site to read. It uses only the Go standard library,
// so the GitHub Action needs nothing but a Go toolchain.
package main

import (
	"crypto/sha1"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const userAgent = "Mozilla/5.0 (compatible; TheWorldNow/2.0; +https://news.sala.company)"

type Source struct {
	Name       string `json:"name"`
	Type       string `json:"type,omitempty"` // "" (RSS/Atom), "telegram" or "bluesky"
	URL        string `json:"url,omitempty"`
	Channel    string `json:"channel,omitempty"` // telegram: public channel name
	Handle     string `json:"handle,omitempty"`  // bluesky: account handle
	Category   string `json:"category"`
	Aggregator bool   `json:"aggregator,omitempty"` // items name their own outlet in <source>
}

type Config struct {
	MaxAgeHours    int      `json:"max_age_hours"`
	MaxItems       int      `json:"max_items"`
	PerSourceLimit int      `json:"per_source_limit"`
	MinOKSources   int      `json:"min_ok_sources"`
	Exclude        []string `json:"exclude_title_patterns"`
	Sources        []Source `json:"sources"`
}

type Item struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	Source    string `json:"source"`
	Category  string `json:"category"`
	Published string `json:"published"`
	Summary   string `json:"summary,omitempty"`
	Social    bool   `json:"social,omitempty"`
	Media     string `json:"media,omitempty"` // "video" or "audio"

	t time.Time
}

// entry is a parsed item before filtering, whatever the source type.
type entry struct {
	id, title, url, summary, outlet string
	media                           string // hint from the source's markup: "video", "audio" or ""
	t                               time.Time
}

type SourceStatus struct {
	Name     string `json:"name"`
	Category string `json:"category"`
	Type     string `json:"type,omitempty"`
	OK       bool   `json:"ok"`
	Count    int    `json:"count"`
	Error    string `json:"error,omitempty"`
	MS       int64  `json:"ms"`
}

// LiveSource is a Bluesky account the browser may poll directly between builds.
type LiveSource struct {
	Name     string `json:"name"`
	Handle   string `json:"handle"`
	Category string `json:"category"`
}

type Output struct {
	GeneratedAt string         `json:"generated_at"`
	SourcesOK   int            `json:"sources_ok"`
	SourcesAll  int            `json:"sources_total"`
	Sources     []SourceStatus `json:"sources"`
	Live        []LiveSource   `json:"live"`
	Items       []Item         `json:"items"`
}

func main() {
	srcPath := flag.String("sources", "sources.json", "sources config")
	outPath := flag.String("out", "feed.json", "output file")
	flag.Parse()

	raw, err := os.ReadFile(*srcPath)
	if err != nil {
		log.Fatal(err)
	}
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		log.Fatalf("parse %s: %v", *srcPath, err)
	}
	if cfg.MaxAgeHours == 0 {
		cfg.MaxAgeHours = 48
	}
	if cfg.MaxItems == 0 {
		cfg.MaxItems = 700
	}
	if cfg.PerSourceLimit == 0 {
		cfg.PerSourceLimit = 40
	}
	var exclude []*regexp.Regexp
	for _, p := range cfg.Exclude {
		exclude = append(exclude, regexp.MustCompile(p))
	}

	now := time.Now().UTC()
	cutoff := now.Add(-time.Duration(cfg.MaxAgeHours) * time.Hour)
	// Force HTTP/1.1: a few CDNs reset Go's HTTP/2 streams.
	client := &http.Client{Timeout: 20 * time.Second, Transport: &http.Transport{
		Proxy:        http.ProxyFromEnvironment,
		TLSNextProto: map[string]func(string, *tls.Conn) http.RoundTripper{},
	}}

	statuses := make([]SourceStatus, len(cfg.Sources))
	results := make([][]Item, len(cfg.Sources))
	sem := make(chan struct{}, 12)
	var wg sync.WaitGroup
	for i, src := range cfg.Sources {
		wg.Add(1)
		go func(i int, src Source) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			start := time.Now()
			items, err := fetchSource(client, src, cutoff, now, cfg.PerSourceLimit, exclude)
			st := SourceStatus{Name: src.Name, Category: src.Category, Type: src.Type, MS: time.Since(start).Milliseconds()}
			if err != nil {
				st.Error = err.Error()
			} else {
				// Reachable and parseable counts as OK even if nothing is new.
				st.OK, st.Count = true, len(items)
				if len(items) == 0 {
					st.Error = "quiet: nothing in the last " + fmt.Sprint(cfg.MaxAgeHours) + "h"
				}
			}
			statuses[i], results[i] = st, items
		}(i, src)
	}
	wg.Wait()

	// Merge, dropping duplicates by URL and by normalised title.
	var all []Item
	seenURL, seenTitle := map[string]bool{}, map[string]bool{}
	ok := 0
	for i, items := range results {
		if statuses[i].OK {
			ok++
		}
		for _, it := range items {
			u, t := normURL(it.URL), normTitle(it.Title)
			if seenURL[u] || seenTitle[t] {
				continue
			}
			seenURL[u], seenTitle[t] = true, true
			all = append(all, it)
		}
	}
	sort.SliceStable(all, func(a, b int) bool { return all[a].t.After(all[b].t) })
	if len(all) > cfg.MaxItems {
		all = all[:cfg.MaxItems]
	}

	var live []LiveSource
	for _, src := range cfg.Sources {
		if src.Type == "bluesky" {
			live = append(live, LiveSource{Name: src.Name, Handle: src.Handle, Category: src.Category})
		}
	}

	for _, st := range statuses {
		mark := "ok  "
		if !st.OK {
			mark = "FAIL"
		}
		log.Printf("%s %-24s %3d items %5dms %s", mark, st.Name, st.Count, st.MS, st.Error)
	}
	log.Printf("%d/%d sources ok, %d items", ok, len(cfg.Sources), len(all))

	// Refuse to publish a near-empty feed: the job fails loudly and the last
	// good deployment stays live instead of the site silently going blank.
	if ok < cfg.MinOKSources {
		log.Fatalf("only %d sources ok (min %d) — not writing %s", ok, cfg.MinOKSources, *outPath)
	}

	out := Output{
		GeneratedAt: now.Format(time.RFC3339),
		SourcesOK:   ok,
		SourcesAll:  len(cfg.Sources),
		Sources:     statuses,
		Live:        live,
		Items:       all,
	}
	buf, err := json.Marshal(out)
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(*outPath, buf, 0o644); err != nil {
		log.Fatal(err)
	}
}

func fetchSource(client *http.Client, src Source, cutoff, now time.Time, limit int, exclude []*regexp.Regexp) ([]Item, error) {
	var (
		entries []entry
		err     error
		social  bool
	)
	switch src.Type {
	case "telegram":
		social = true
		var body []byte
		if body, err = get(client, "https://t.me/s/"+src.Channel, "text/html"); err == nil {
			entries, err = parseTelegram(body)
		}
	case "bluesky":
		social = true
		var body []byte
		u := "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?filter=posts_no_replies&limit=40&actor=" + url.QueryEscape(src.Handle)
		if body, err = get(client, u, "application/json"); err == nil {
			entries, err = parseBluesky(body, src.Handle)
		}
	default:
		var body []byte
		if body, err = get(client, src.URL, "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8"); err == nil {
			entries, err = parseFeed(body)
		}
	}
	if err != nil {
		return nil, err
	}
	if social && limit > 15 { // chatty channels would otherwise flood the feed
		limit = 15
	}

	var items []Item
	undated := 0
	for _, e := range entries {
		if e.t.IsZero() {
			undated++
			continue
		}
		if e.title == "" || e.url == "" || matchesAny(exclude, e.title) || e.t.Before(cutoff) {
			continue
		}
		if social && len(strings.Fields(e.title)) < 4 { // "Good morning", "Thread:", …
			continue
		}
		if e.t.After(now) { // some feeds stamp items in the future
			e.t = now
		}
		name := src.Name
		if src.Aggregator && e.outlet != "" {
			name = e.outlet
			e.title = strings.TrimSuffix(e.title, " - "+e.outlet)
		}
		if strings.EqualFold(e.summary, e.title) {
			e.summary = ""
		}
		id := e.id
		if id == "" {
			id = hash(e.url)
		}
		items = append(items, Item{
			ID:        id,
			Title:     e.title,
			URL:       e.url,
			Source:    name,
			Category:  src.Category,
			Published: e.t.UTC().Format(time.RFC3339),
			Summary:   e.summary,
			Social:    social,
			Media:     detectMedia(e.media, e.url, e.title),
			t:         e.t,
		})
		if len(items) >= limit {
			break
		}
	}
	if len(items) == 0 && undated > 0 && undated == len(entries) {
		return nil, errors.New("no parseable dates in feed")
	}
	return items, nil
}

func get(client *http.Client, u, accept string) ([]byte, error) {
	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", accept)
	resp, err := client.Do(req)
	if err != nil {
		return nil, shortErr(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return nil, shortErr(err)
	}
	return body, nil
}

var (
	tagRE   = regexp.MustCompile(`(?s)<[^>]*>`)
	brRE    = regexp.MustCompile(`(?i)<br\s*/?>`)
	spaceRE = regexp.MustCompile(`\s+`)
	punctRE = regexp.MustCompile(`[^\p{L}\p{N} ]+`)
)

func cleanText(s string) string {
	s = html.UnescapeString(s)
	s = tagRE.ReplaceAllString(s, " ")
	s = html.UnescapeString(s) // double-escaped feeds
	return strings.TrimSpace(spaceRE.ReplaceAllString(s, " "))
}

// splitPost turns a social post into a headline (its first line or sentence)
// and a summary (the rest).
func splitPost(text string) (title, summary string) {
	text = postURLRE.ReplaceAllString(text, "")
	defer func() { title = tidyPostTitle(title) }()
	var lines []string
	for _, l := range strings.Split(text, "\n") {
		if l = strings.TrimSpace(spaceRE.ReplaceAllString(l, " ")); l != "" {
			lines = append(lines, l)
		}
	}
	if len(lines) == 0 {
		return "", ""
	}
	title = lines[0]
	rest := strings.Join(lines[1:], " ")
	// A one-word or emoji-only first line ("BREAKING:", "🚨") isn't a headline.
	if utf8.RuneCountInString(title) < 25 && rest != "" {
		title, rest = title+" "+rest, ""
	}
	if utf8.RuneCountInString(title) > 220 {
		r := []rune(title)
		cut := 220
		for i := 80; i < 220; i++ {
			if (r[i] == '.' || r[i] == '!' || r[i] == '?') && i+1 < len(r) && r[i+1] == ' ' {
				cut = i + 1
				break
			}
		}
		rest = strings.TrimSpace(string(r[cut:]) + " " + rest)
		title = strings.TrimSpace(string(r[:cut]))
		if cut == 220 {
			title += "…"
		}
	}
	return title, truncate(strings.TrimSpace(rest), 280)
}

var (
	postURLRE  = regexp.MustCompile(`(?i)(https?://\S+|\b[a-z0-9-]+\.(rs|com|org|net|co|ly|gl|me|news|io|tv|uk)/\S*)`)
	leadSymRE  = regexp.MustCompile(`^[^\p{L}\p{N}"'“(#]+`)
	breakingRE = regexp.MustCompile(`(?i)^#?(breaking|urgent|just in|flash)\b\s*[:\-–—|]*\s*`)
	hashtagRE  = regexp.MustCompile(`#(\p{L})`)
)

// tidyPostTitle drops the emoji/flag/"BREAKING" decoration social posts lead with.
func tidyPostTitle(t string) string {
	for i := 0; i < 3; i++ {
		t = breakingRE.ReplaceAllString(leadSymRE.ReplaceAllString(t, ""), "")
	}
	return strings.TrimSpace(hashtagRE.ReplaceAllString(t, "$1"))
}

// Video and audio are recognised from the source's own markup when it has
// any, otherwise from well-known URL shapes and "Watch:"/"Listen:" titles.
// app.js mirrors these patterns for posts it polls live.
var (
	videoURLRE   = regexp.MustCompile(`(?i)(/videos?/|/av/|/watch/|/clip/|/live-video|youtube\.com/(watch|shorts|live)|youtu\.be/|vimeo\.com/|rumble\.com/|\.(mp4|m3u8|webm)(\?|$))`)
	audioURLRE   = regexp.MustCompile(`(?i)(/podcasts?/|/audio/|/sounds/|/listen/|/radio/|open\.spotify\.com/(episode|show)|podcasts\.apple\.com/|soundcloud\.com/|\.(mp3|m4a|ogg)(\?|$))`)
	videoTitleRE = regexp.MustCompile(`(?i)^(watch|video|live video)\s*[:|–—-]`)
	audioTitleRE = regexp.MustCompile(`(?i)^(listen|podcast|audio)\s*[:|–—-]`)
)

func detectMedia(hint, u, title string) string {
	switch {
	case hint != "":
		return hint
	case videoURLRE.MatchString(u) || videoTitleRE.MatchString(title):
		return "video"
	case audioURLRE.MatchString(u) || audioTitleRE.MatchString(title):
		return "audio"
	}
	return ""
}

// mediaFromType maps a MIME type or media:content medium to "video"/"audio".
func mediaFromType(s string) string {
	s = strings.ToLower(s)
	switch {
	case strings.HasPrefix(s, "video"):
		return "video"
	case strings.HasPrefix(s, "audio"):
		return "audio"
	}
	return ""
}

func normTitle(s string) string {
	return strings.TrimSpace(spaceRE.ReplaceAllString(punctRE.ReplaceAllString(strings.ToLower(s), " "), " "))
}

func normURL(s string) string {
	u, err := url.Parse(s)
	if err != nil {
		return s
	}
	return strings.ToLower(u.Host) + strings.TrimSuffix(u.Path, "/")
}

func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)[:n]
	return strings.TrimSpace(string(r)) + "…"
}

func matchesAny(res []*regexp.Regexp, s string) bool {
	for _, re := range res {
		if re.MatchString(s) {
			return true
		}
	}
	return false
}

func firstNonEmpty(ss ...string) string {
	for _, s := range ss {
		if strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}

func hash(s string) string {
	h := sha1.Sum([]byte(s))
	return hex.EncodeToString(h[:6])
}

func shortErr(err error) error {
	msg := err.Error()
	if len(msg) > 120 {
		msg = msg[:120]
	}
	return errors.New(msg)
}
