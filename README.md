# The World Now

Live world headlines at **https://news.sala.company**. It runs entirely on GitHub, with no servers, API keys, sign-ups or third-party proxies.

```
 every ~5 min            GitHub Actions                       GitHub Pages
┌──────────────┐  go run ./fetcher  ┌───────────┐  deploy-pages  ┌──────────────────┐
│ cron trigger │ ─────────────────▶ │ feed.json │ ─────────────▶ │ index.html + JS  │
└──────────────┘  ~95 public feeds  └───────────┘                │ reads feed.json  │
                                                                 └────────┬─────────┘
                                          every 60s, from the browser     │
                                          Bluesky public API  ◀───────────┘
```

- **`fetcher/`**: a small Go program (standard library only) that runs on GitHub's servers, so the browser never runs into CORS. It pulls three kinds of public source:
  - **RSS/Atom feeds** from news outlets, government, defense and disaster sites.
  - **Public Telegram channels**, read from their no-login web preview (`t.me/s/<channel>`). Many OSINT accounts that started on X also post there.
  - **Public Bluesky accounts**, read through the public API with no account needed.

  It then drops items older than 48 hours, removes duplicates and writes `feed.json`. Most feeds only list their latest ~15 stories, so each build also **carries forward** the previous build's headlines (`-carry`, read from the live `feed.json`) until they are 48 hours old; otherwise the second day would be nearly empty. A source removed from `sources.json` ages out within 48 hours.
- **`index.html`, `app.js`, `style.css`**: a static page with no build step. It loads `feed.json`, polls for new builds and checks the Bluesky accounts **live every 60 seconds** between builds.
- **`.github/workflows/update.yml`**: started every 5 minutes by cron-job.org (see **Timers**), on every push and on demand (**Actions → Update news & deploy → Run workflow**). Only `main` deploys.
- **`.github/workflows/freshness.yml`**: hourly check that the live `feed.json` is under 30 minutes old. If it isn't, the run fails and GitHub emails you.

## Timers

GitHub's own schedules are unreliable: in the first 3 hours, the 5-minute schedule here didn't fire once. So, as on heat.sala.company, **cron-job.org** starts the workflows through GitHub's API (`workflow_dispatch`). GitHub's schedules stay on as a backup, and the page polls the Bluesky accounts live in the meantime.

| cron-job.org job | Every | URL (method POST) |
|---|---|---|
| news update | 5 minutes | `https://api.github.com/repos/jamalxcode/the-world-now/actions/workflows/update.yml/dispatches` |
| news freshness | hour | `https://api.github.com/repos/jamalxcode/the-world-now/actions/workflows/freshness.yml/dispatches` |

Each job sends the body `{"ref":"main"}` and these headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2022-11-28`. A successful call returns **204**. The token is a fine-grained GitHub token with access to this repo and **Actions: read and write** only. If it's the same token heat uses, renew it in every job that uses it when it expires.

## Look and controls

The design follows heat.sala.company: Inter, soft cards and an automatic light or dark theme (switch with the ◐ button). It is kept uncluttered on purpose:

- **One slim bar** holds what's used all the time: ↺ Reset, the categories, 📍 location and search. Everything else (layout, time range, search links, auto-refresh, alerts, sound, Trends, Sources, Help) is in the **⚙ View** menu.
- **Each headline is two short lines**: the headline, then "source · +N reports". The exact time, 👍 / 👎, copies and search links appear on hover (computer) or after tapping **⋯** (phone).
- **Near me** shows 8 stories per section with "See all N →"; the other views use **Last hour / 1–3 hours ago / Earlier today / Yesterday** dividers instead of an age on every row.
- **Top stories now** (Near me and All): the 6 most-reported stories of the last 6 hours, scored by number of different sources × freshness, more for breaking stories and, in Near me, for stories near you. "N reports →" opens the story in the feed without leaving your view. **Hide** folds it away (↺ Reset brings it back). On phones the cards are one swipeable row.
- **Side panel** on screens 1200px and wider: trending words (click to search), your 👍 sources (click to show only one), and source status. Narrower screens keep the same things under ⚙ View.

**Comfortable / Compact** (key `d`) switches between larger headlines with details and one headline per line. Headlines with video show 📺 and ones with audio (podcasts, voice notes) show 🔊, detected from the source's media tags, Telegram and Bluesky video posts, and video or podcast links. **🔎 Search links** (on by default, key `v`) adds X, YouTube, Google News, Yandex Video and Bilibili searches to each headline's actions. Their words are chosen to pin the story down without being too literal (`storyTerms` in `app.js`):

1. **Story consensus**: words several of the story's reports share describe the event; one outlet's own phrasing doesn't.
2. **Rarity**: words in few of today's headlines ("Woodford", "Mandeb") score higher than everyday ones ("Trump", "war").
3. **Cleaning**: labels ("From Breakingviews -", "COMMENTARY:", "LIVE:", "| WION Shorts") and titles ("Rep.") are dropped; two-word names stay whole ("South Korea", "Bab el-Mandeb"); spellings are unified (Türkiye → Turkey); a country the headline names is always kept as the anchor.
4. **Per site**: X gets 4 words, quoted names, both spellings with OR and no replies; Google News 4 words with quoted names, past 24 hours (past week for older stories) newest first; YouTube 3 words, last hour for busy fresh stories (2+ sources, under 3 hours) else this week, since it no longer sorts by date; Yandex Video 4 words newest first; Bilibili 2 words, by relevance (it has no date sort).
5. **Your choice**: ✎ shows the words as chips; switch any off or add suggested ones, and every link updates. ↺ auto goes back to the automatic pick. Hover over a link to see its exact search. **↺ Reset** (key `x`) clears the search and filters, closes panels and goes back to the default view (Near me, last 24 hours). It keeps your location, ratings, theme, alerts and sound settings.

## Near me

**📍 Near me** (the default view) lists news in rings: the reader's country, then its neighbourhood (for Kuwait: the Gulf), its region (the Middle East) and the rest of the world, each newest first. The country comes from the device's time zone, with no permission prompt; the 📍 menu changes it (or 🌐 Anywhere). The region table is `GEO_GROUPS` in `app.js`.

- The fetcher tags each headline with countries (`geo`): from the places, demonyms, capitals and big cities named in it (`geoData` in `fetcher/enrich.go`), or, when it names none, the outlet's home country (`"country"` in `sources.json`).
- [`sources-near.json`](sources-near.json) adds Google News searches for ~50 countries, built into `near.json`. Each is fetched every 30 minutes (`every_minutes`) to stay gentle with Google; carry-forward fills the gaps. These headlines only appear in Near me. To add a country, copy a line and set `about` to its code.
- A story sits in the ring of its headline's countries; if the headline names none, where most of its reports point.
- The **Last 6h / 12h / 24h / 48h** menu limits every view; the default is 24 hours. The data keeps 48 hours.

## Repeats, ratings and source health

- **Syndicated copies**: when several outlets run the same story word for word (usually a wire story), the fetcher keeps the earliest and lists the others as **+N copies** (`also`), with **via Reuters** (`via`) when the text names the wire service. Different outlets' own reporting is kept and grouped on the page instead.
- **👍 / 👎** next to each source: 👍 makes its report lead its stories, 👎 hides it. Ratings are stored in the reader's browser only (no accounts), so each person has their own and they don't sync between devices. **Sources → Your ratings** lists and undoes them.
- **Set aside**: a source failing for over 24 hours is only retried every 6 hours, shown with ⏸ in Sources, and comes back on its own once it works.

## Breaking news

A story is marked **BREAKING** when 3 or more different sources report it within 3 hours and the latest report is under 90 minutes old. It gets a red **Breaking** tag on its own row. The feed is always strictly newest first, with no separate breaking bar, because a bar of older stories above newer ones was confusing. Turn on **[ALERTS]** (key `a`) for a browser notification when a new story starts breaking, and **[SND]** for a beep. The thresholds are constants at the top of `app.js`.

## X (Twitter)

X has no free API, and its RSS mirrors (Nitter, xcancel) are blocked, so X posts can't be read without a paid account. Instead the site follows the same OSINT accounts where they cross-post publicly: Telegram (OSINTdefender, WarMonitors, Clash Report, Rerum Novarum, WarTranslated…) and Bluesky (NOELreports, ISW, Bellingcat…). Posts from social sources are tagged **TG** or **BSKY** and are unverified.

## Non-English sources (for the Meridian map)

[`sources-local.json`](sources-local.json) lists Arabic, Russian and Ukrainian sources. The same workflow builds them into a separate `local.json` (also with carry-forward), which only the [Meridian map](https://github.com/jamalxcode/globe) reads; this site's own page doesn't show them. If that build fails, `feed.json` still publishes.

## Editing sources

Edit [`sources.json`](sources.json) and push. Every entry has a `name` and a `category` (`top`, `world`, `mideast`, `osint`, `defense`, `biz`, `tech`, `hazard` or `science`), plus one of these, and optionally `"country"` (the outlet's home country, used for headlines that name no place). For a YouTube channel, the `channel` is its ID (starts with `UC`), found in the page source of the channel page as `"externalId"`; check the feed name matches, because the first ID on a page can belong to a sister channel:

```json
{ "name": "BBC", "category": "world", "url": "https://feeds.bbci.co.uk/news/world/rss.xml" }
{ "name": "WarMonitors", "category": "osint", "type": "telegram", "channel": "warmonitors" }
{ "name": "Reuters", "category": "top", "type": "bluesky", "handle": "reuters.com" }
{ "name": "CNN", "category": "world", "type": "youtube", "channel": "UCupvZG-5ko_eiXAupbDfxWw" }
```

Only use public sources that need no sign-up. Some sites block GitHub's servers, so check the run log or the **[SOURCES]** panel after adding one.

## When feeds fail

- On the site, **[SOURCES]** (or the `s` key) lists every source with its status: ● working, ○ quiet (reachable but nothing new in 48h), ✕ failing with the error.
- If fewer than `min_ok_sources` sources work, the fetcher **fails the run instead of publishing an empty page**. The last good version stays live, and GitHub emails you about the failed workflow.
- The header dot turns amber or red when the build is more than 20 or 60 minutes old.
- GitHub pauses scheduled workflows after 60 days without commits. The workflow makes a small heartbeat commit when the repo has been quiet for 45 days.

## Run locally

```bash
go run ./fetcher -out feed.json   # needs Go 1.22+
python -m http.server 8000         # or any static server, then open http://localhost:8000
```

## Keyboard

`x` ↺ reset view · `j`/`k` navigate · `o` open · `space` more reports · `/` search · `r` refresh · `n` apply new · `b` jump to breaking · `a` alerts · `d` compact · `c` cluster · `v` search links · `h` heatmaps · `s` sources · `?` help
