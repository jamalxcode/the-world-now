// Command fetcher downloads the public RSS/Atom feeds listed in sources.json
// and writes a single feed.json for the static site to read. It uses only the
// Go standard library, so the GitHub Action needs nothing but a Go toolchain.
package main

import (
	"bytes"
	"crypto/sha1"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
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
	URL        string `json:"url"`
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

	t time.Time
}

type SourceStatus struct {
	Name     string `json:"name"`
	Category string `json:"category"`
	OK       bool   `json:"ok"`
	Count    int    `json:"count"`
	Error    string `json:"error,omitempty"`
	MS       int64  `json:"ms"`
}

type Output struct {
	GeneratedAt string         `json:"generated_at"`
	SourcesOK   int            `json:"sources_ok"`
	SourcesAll  int            `json:"sources_total"`
	Sources     []SourceStatus `json:"sources"`
	Items       []Item         `json:"items"`
}

// xmlItem covers RSS 2.0 <item>, RSS 1.0 (RDF) <item> and Atom <entry>.
// encoding/xml matches on local names, so dc:date, content:encoded etc. land here too.
type xmlItem struct {
	Title       string    `xml:"title"`
	Links       []xmlLink `xml:"link"`
	GUID        string    `xml:"guid"`
	ID          string    `xml:"id"`
	PubDate     string    `xml:"pubDate"`
	Published   string    `xml:"published"`
	Updated     string    `xml:"updated"`
	Date        string    `xml:"date"`
	Description string    `xml:"description"`
	Summary     string    `xml:"summary"`
	Source      string    `xml:"source"`
}

type xmlLink struct {
	Href string `xml:"href,attr"`
	Rel  string `xml:"rel,attr"`
	Text string `xml:",chardata"`
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

	now := time.Now().UTC()
	cutoff := now.Add(-time.Duration(cfg.MaxAgeHours) * time.Hour)
	// Force HTTP/1.1: a few CDNs (CBC, NHK) reset Go's HTTP/2 streams.
	var exclude []*regexp.Regexp
	for _, p := range cfg.Exclude {
		exclude = append(exclude, regexp.MustCompile(p))
	}

	client := &http.Client{Timeout: 20 * time.Second, Transport: &http.Transport{
		Proxy:        http.ProxyFromEnvironment,
		TLSNextProto: map[string]func(string, *tls.Conn) http.RoundTripper{},
	}}

	statuses := make([]SourceStatus, len(cfg.Sources))
	results := make([][]Item, len(cfg.Sources))
	sem := make(chan struct{}, 10)
	var wg sync.WaitGroup
	for i, src := range cfg.Sources {
		wg.Add(1)
		go func(i int, src Source) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			start := time.Now()
			items, err := fetchSource(client, src, cutoff, now, cfg.PerSourceLimit, exclude)
			st := SourceStatus{Name: src.Name, Category: src.Category, MS: time.Since(start).Milliseconds()}
			if err != nil {
				st.Error = err.Error()
			} else if len(items) == 0 {
				st.Error = "no recent items"
			} else {
				st.OK, st.Count = true, len(items)
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

	for _, st := range statuses {
		mark := "ok  "
		if !st.OK {
			mark = "FAIL"
		}
		log.Printf("%s %-22s %3d items %5dms %s", mark, st.Name, st.Count, st.MS, st.Error)
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
	req, err := http.NewRequest("GET", src.URL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8")
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
	raws, err := parseFeed(body)
	if err != nil {
		return nil, err
	}

	var items []Item
	for _, r := range raws {
		title := cleanText(r.Title)
		link := pickLink(r)
		if title == "" || link == "" {
			continue
		}
		if matchesAny(exclude, title) {
			continue
		}
		t := parseDate(firstNonEmpty(r.PubDate, r.Published, r.Date, r.Updated))
		if t.IsZero() || t.Before(cutoff) {
			continue
		}
		if t.After(now) { // some feeds stamp items in the future
			t = now
		}
		name := src.Name
		if src.Aggregator {
			if outlet := cleanText(r.Source); outlet != "" {
				name = outlet
				title = strings.TrimSuffix(title, " - "+outlet)
			}
		}
		summary := truncate(cleanText(firstNonEmpty(r.Description, r.Summary)), 280)
		if strings.EqualFold(summary, title) {
			summary = ""
		}
		items = append(items, Item{
			ID:        hash(link),
			Title:     title,
			URL:       link,
			Source:    name,
			Category:  src.Category,
			Published: t.UTC().Format(time.RFC3339),
			Summary:   summary,
			t:         t,
		})
		if len(items) >= limit {
			break
		}
	}
	return items, nil
}

func parseFeed(body []byte) ([]xmlItem, error) {
	dec := xml.NewDecoder(bytes.NewReader(body))
	dec.Strict = false
	dec.Entity = xml.HTMLEntity
	dec.CharsetReader = func(charset string, r io.Reader) (io.Reader, error) {
		switch strings.ToLower(charset) {
		case "utf-8", "utf8", "us-ascii", "ascii":
			return r, nil
		default: // iso-8859-1 / windows-1252: map bytes to runes
			b, err := io.ReadAll(r)
			if err != nil {
				return nil, err
			}
			var sb strings.Builder
			for _, c := range b {
				sb.WriteRune(rune(c))
			}
			return strings.NewReader(sb.String()), nil
		}
	}
	var items []xmlItem
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			if len(items) > 0 {
				break // keep what parsed before the broken markup
			}
			return nil, fmt.Errorf("bad xml: %v", shortErr(err))
		}
		se, ok := tok.(xml.StartElement)
		if !ok || (se.Name.Local != "item" && se.Name.Local != "entry") {
			continue
		}
		var it xmlItem
		if err := dec.DecodeElement(&it, &se); err != nil {
			continue
		}
		items = append(items, it)
	}
	if len(items) == 0 {
		return nil, errors.New("no items in feed")
	}
	return items, nil
}

func pickLink(r xmlItem) string {
	var fallback string
	for _, l := range r.Links {
		if l.Href != "" && (l.Rel == "" || l.Rel == "alternate") {
			return strings.TrimSpace(l.Href)
		}
		if t := strings.TrimSpace(l.Text); t != "" && fallback == "" {
			fallback = t
		}
	}
	if fallback != "" {
		return fallback
	}
	if g := strings.TrimSpace(r.GUID); strings.HasPrefix(g, "http") {
		return g
	}
	if id := strings.TrimSpace(r.ID); strings.HasPrefix(id, "http") {
		return id
	}
	return ""
}

var dateLayouts = []string{
	time.RFC1123Z, time.RFC1123, time.RFC3339, time.RFC3339Nano,
	"Mon, 2 Jan 2006 15:04:05 -0700", "Mon, 2 Jan 2006 15:04:05 MST",
	"Mon, 02 Jan 2006 15:04:05 Z", "Mon, 2 Jan 2006 15:04 -0700", "Mon, 2 Jan 2006 15:04 MST",
	"2 Jan 2006 15:04:05 -0700", "02 Jan 2006 15:04:05 MST",
	"Mon, 02 Jan 06 15:04:05 -0700", "Mon,  2 Jan 2006 15:04:05 -0700",
	"2006-01-02T15:04:05Z0700", "2006-01-02T15:04:05", "2006-01-02 15:04:05 -0700",
	"2006-01-02 15:04:05", "January 2, 2006 15:04 MST", "2006-01-02",
}

func parseDate(s string) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}
	}
	for _, l := range dateLayouts {
		if t, err := time.Parse(l, s); err == nil {
			return t
		}
	}
	// "EDT"/"EST"-style zones parse with zero offset; good enough for sorting.
	return time.Time{}
}

var (
	tagRE   = regexp.MustCompile(`(?s)<[^>]*>`)
	spaceRE = regexp.MustCompile(`\s+`)
	punctRE = regexp.MustCompile(`[^\p{L}\p{N} ]+`)
)

func cleanText(s string) string {
	s = html.UnescapeString(s)
	s = tagRE.ReplaceAllString(s, " ")
	s = html.UnescapeString(s) // double-escaped feeds
	return strings.TrimSpace(spaceRE.ReplaceAllString(s, " "))
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
