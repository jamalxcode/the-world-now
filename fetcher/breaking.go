package main

// breaking.json: stories breaking right now, for the installed app's background alerts (sw.js), which
// can't run the page's own grouping. Same rule as the page: 3+ different established outlets (configured
// news sources, not social posts or unknown outlets found through an aggregator) report it within
// 3 hours, and the newest report is under 90 minutes old.

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

type BreakingOut struct {
	GeneratedAt string          `json:"generated_at"`
	Stories     []BreakingStory `json:"stories"`
}

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

func breakingNow(items []Item, established map[string]bool, now time.Time) BreakingOut {
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
			if used[b] {
				continue
			}
			shared := 0
			for w := range toks[b] {
				if toks[a][w] {
					shared++
				}
			}
			union := len(toks[a]) + len(toks[b]) - shared
			if shared >= 3 || (shared >= 2 && union > 0 && float64(shared)/float64(union) >= 0.34) {
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
	return BreakingOut{GeneratedAt: now.Format(time.RFC3339), Stories: out}
}
