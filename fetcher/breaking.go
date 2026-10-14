package main

// breaking.json: stories breaking right now, for the installed app's background alerts (sw.js), which
// can't run the page's own grouping, and for the ntfy.sh push alerts the workflow sends. Same rule as the
// page: 3+ different established outlets (configured news sources and known outlets, not social posts or
// unknown outlets found through an aggregator) report it within 3 hours, and the newest report is under
// 90 minutes old.
//
// "alerted" remembers the headlines of stories already pushed (12 hours), so a story is pushed once even
// as its lead headline changes; "notify" lists the stories to push from this build.

import (
	"sort"
	"strings"
	"time"
	"unicode"
)

type BreakingStory struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	URL       string   `json:"url"`
	Source    string   `json:"source"`
	Sources   []string `json:"sources"`
	FirstSeen string   `json:"first_seen"`
	Newest    string   `json:"newest"`
}

type AlertedStory struct {
	Title string `json:"title"`
	At    string `json:"at"`
}

type BreakingOut struct {
	GeneratedAt string          `json:"generated_at"`
	Stories     []BreakingStory `json:"stories"`
	Notify      []BreakingStory `json:"notify"`
	Alerted     []AlertedStory  `json:"alerted"`
}

const (
	alertMemory   = 12 * time.Hour
	maxNotifyRun  = 3
	maxAlertedLen = 300
)

var groupStop = map[string]bool{}

func init() {
	for _, w := range strings.Fields("about above after again against also among amid amidst around because been before being below between both could does doing down during each from further have having here into itself just more most much near only other over said says same should some such than that their them then there these they this those through under until very were what when where which while with would your will year years week weeks today first last back news live update updates latest video watch report reports breaking urgent according officials official people told") {
		groupStop[w] = true
	}
}

// groupTokens mirrors tokens() in app.js: lower-case words of 4+ letters, minus filler.
func groupTokens(title string) map[string]bool {
	set := map[string]bool{}
	for _, w := range strings.FieldsFunc(strings.ToLower(title), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		if len([]rune(w)) >= 4 && !groupStop[w] && strings.Trim(w, "0123456789") != "" {
			set[w] = true
		}
	}
	return set
}

// sameStory is the page's grouping rule: 3+ shared keywords, or 2 that make up a third of them.
func sameStory(a, b map[string]bool) bool {
	shared := 0
	for w := range b {
		if a[w] {
			shared++
		}
	}
	union := len(a) + len(b) - shared
	return shared >= 3 || (shared >= 2 && union > 0 && float64(shared)/float64(union) >= 0.34)
}

// prev is the previous breaking.json (nil if there was none or it couldn't be read). Nothing is pushed
// unless prev carries an "alerted" list, so a first build or a failed read can't send a burst of old stories.
func breakingNow(items []Item, established map[string]bool, prev *BreakingOut, wantPrev bool, now time.Time) BreakingOut {
	var recent []Item // newest first, like items
	for _, it := range items {
		if now.Sub(it.t) < 3*time.Hour && !it.Social {
			recent = append(recent, it)
		}
	}
	toks := make([]map[string]bool, len(recent))
	for i, it := range recent {
		toks[i] = groupTokens(it.Title)
	}
	used := make([]bool, len(recent))
	var out []BreakingStory
	for a := range recent {
		if used[a] {
			continue
		}
		used[a] = true
		group := []int{a}
		for b := a + 1; b < len(recent); b++ {
			if !used[b] && sameStory(toks[a], toks[b]) {
				used[b] = true
				group = append(group, b)
			}
		}
		srcs := map[string]bool{}
		var names []string
		oldest := recent[a].t
		for _, i := range group {
			if established[recent[i].Source] && !srcs[recent[i].Source] {
				srcs[recent[i].Source] = true
				names = append(names, recent[i].Source)
			}
			if recent[i].t.Before(oldest) {
				oldest = recent[i].t
			}
		}
		if len(names) >= 3 && now.Sub(recent[a].t) < 90*time.Minute {
			lead := recent[a]
			for _, i := range group { // an established outlet's headline, if the newest isn't one
				if established[recent[i].Source] {
					lead = recent[i]
					break
				}
			}
			out = append(out, BreakingStory{ID: lead.ID, Title: lead.Title, URL: lead.URL, Source: lead.Source, Sources: names,
				FirstSeen: oldest.Format(time.RFC3339), Newest: recent[a].Published})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return len(out[i].Sources) > len(out[j].Sources) })
	if len(out) > 5 {
		out = out[:5]
	}

	// Push alerts: stories not like any headline alerted in the last 12 hours.
	alerted := []AlertedStory{}
	canNotify := wantPrev && prev != nil && prev.Alerted != nil
	if prev != nil {
		for _, a := range prev.Alerted {
			if t, err := time.Parse(time.RFC3339, a.At); err == nil && now.Sub(t) < alertMemory {
				alerted = append(alerted, a)
			}
		}
	}
	notify := []BreakingStory{}
	for _, s := range out {
		st := groupTokens(s.Title)
		seen, exact := false, false
		for _, a := range alerted {
			if a.Title == s.Title {
				exact = true
			}
			if sameStory(groupTokens(a.Title), st) {
				seen = true
			}
		}
		if !seen && canNotify && len(notify) < maxNotifyRun {
			notify = append(notify, s)
		}
		if !exact { // every lead headline is remembered, so the story is still recognised as it's reworded
			alerted = append(alerted, AlertedStory{Title: s.Title, At: now.Format(time.RFC3339)})
		}
	}
	if len(alerted) > maxAlertedLen {
		alerted = alerted[len(alerted)-maxAlertedLen:]
	}
	return BreakingOut{GeneratedAt: now.Format(time.RFC3339), Stories: out, Notify: notify, Alerted: alerted}
}
