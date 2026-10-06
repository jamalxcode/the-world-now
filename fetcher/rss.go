package main

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
)

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

func parseFeed(body []byte) ([]entry, error) {
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
	var entries []entry
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			if len(entries) > 0 {
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
		e := entry{
			title:   cleanText(it.Title),
			url:     pickLink(it),
			summary: truncate(cleanText(firstNonEmpty(it.Description, it.Summary)), 280),
			outlet:  cleanText(it.Source),
			t:       parseDate(firstNonEmpty(it.PubDate, it.Published, it.Date, it.Updated)),
		}
		if e.title == "" && e.summary != "" { // title-less feeds (e.g. microblogs)
			e.title, e.summary = splitPost(e.summary)
		}
		entries = append(entries, e)
	}
	if len(entries) == 0 {
		return nil, errors.New("no items in feed")
	}
	return entries, nil
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
	"2006-01-02 15:04:05", "January 2, 2006 15:04 MST", "01/02/2006 - 15:04", "2006-01-02",
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
	return time.Time{}
}
