package main

import (
	"encoding/json"
	"errors"
	"html"
	"path"
	"regexp"
	"strings"
	"time"
)

// Telegram: public channels have a no-login web preview at t.me/s/<channel>.

var (
	tgTextRE = regexp.MustCompile(`(?s)class="tgme_widget_message_text js-message_text"[^>]*>(.*?)</div>`)
	tgTimeRE = regexp.MustCompile(`<time datetime="([^"]+)"`)
)

func parseTelegram(body []byte) ([]entry, error) {
	chunks := strings.Split(string(body), `data-post="`)
	if len(chunks) < 2 {
		return nil, errors.New("no posts on channel page")
	}
	var entries []entry
	for _, c := range chunks[1:] {
		end := strings.IndexByte(c, '"')
		if end < 0 {
			continue
		}
		post := c[:end] // "<channel>/<id>"
		m := tgTextRE.FindStringSubmatch(c)
		tm := tgTimeRE.FindStringSubmatch(c)
		if m == nil || tm == nil {
			continue // media-only post
		}
		text := html.UnescapeString(tagRE.ReplaceAllString(brRE.ReplaceAllString(m[1], "\n"), ""))
		title, summary := splitPost(text)
		t, _ := time.Parse(time.RFC3339, tm[1])
		entries = append(entries, entry{
			id:      "tg-" + strings.ReplaceAll(post, "/", "-"),
			title:   title,
			url:     "https://t.me/" + post,
			summary: summary,
			t:       t,
		})
	}
	// The page lists oldest first; put newest first so per-source limits keep the latest.
	for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
		entries[i], entries[j] = entries[j], entries[i]
	}
	return entries, nil
}

// Bluesky: the public AppView API needs no account (and allows browser CORS,
// which app.js uses to poll these same accounts live between builds).

type bskyFeed struct {
	Feed []struct {
		Post struct {
			URI    string `json:"uri"`
			Record struct {
				Text      string `json:"text"`
				CreatedAt string `json:"createdAt"`
			} `json:"record"`
			Embed struct {
				External *struct {
					URI   string `json:"uri"`
					Title string `json:"title"`
				} `json:"external"`
			} `json:"embed"`
		} `json:"post"`
		Reason json.RawMessage `json:"reason"` // set for reposts
	} `json:"feed"`
}

func parseBluesky(body []byte, handle string) ([]entry, error) {
	var f bskyFeed
	if err := json.Unmarshal(body, &f); err != nil {
		return nil, errors.New("bad bluesky json")
	}
	var entries []entry
	for _, it := range f.Feed {
		if len(it.Reason) > 0 {
			continue
		}
		p := it.Post
		rkey := path.Base(p.URI)
		title, summary := splitPost(p.Record.Text)
		link := "https://bsky.app/profile/" + handle + "/post/" + rkey
		if ext := p.Embed.External; ext != nil && strings.HasPrefix(ext.URI, "http") {
			link = ext.URI
			if t := cleanText(ext.Title); t != "" && (len([]rune(title)) < 30 || strings.Contains(title, "http")) {
				title = t
			}
		}
		t, _ := time.Parse(time.RFC3339, p.Record.CreatedAt)
		entries = append(entries, entry{id: "bsky-" + rkey, title: title, url: link, summary: summary, t: t})
	}
	return entries, nil
}
