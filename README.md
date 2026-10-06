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

  It then drops items older than 48 hours, removes duplicates and writes `feed.json`.
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

The design follows heat.sala.company: Inter, soft cards and an automatic light or dark theme (switch with the ◐ button). **Comfortable / Compact** (key `d`) switches between larger headlines with details and one headline per line. Headlines with video show 📺 and ones with audio (podcasts, voice notes) show 🔊, detected from the source's media tags, Telegram and Bluesky video posts, and video or podcast links. **🔎 Search links** (key `v`) adds X, YouTube, Google News, Rumble and Yandex searches under each headline. They use 3 or 4 keywords from the headline rather than the whole headline, and ask for the newest results: X's Latest tab, news sorted by date on Google, Rumble and Yandex, and this week's uploads on YouTube, which no longer sorts by date. **↺ Reset** (key `x`) clears the search and filters, closes panels and goes back to the default view. It keeps your theme, alerts and sound settings.

## Breaking news

A story is marked **BREAKING** when 3 or more different sources report it within 3 hours and the latest report is under 90 minutes old. It gets a red **Breaking** tag on its own row. The feed is always strictly newest first, with no separate breaking bar, because a bar of older stories above newer ones was confusing. Turn on **[ALERTS]** (key `a`) for a browser notification when a new story starts breaking, and **[SND]** for a beep. The thresholds are constants at the top of `app.js`.

## X (Twitter)

X has no free API, and its RSS mirrors (Nitter, xcancel) are blocked, so X posts can't be read without a paid account. Instead the site follows the same OSINT accounts where they cross-post publicly: Telegram (OSINTdefender, WarMonitors, Clash Report, Rerum Novarum, WarTranslated…) and Bluesky (NOELreports, ISW, Bellingcat…). Posts from social sources are tagged **TG** or **BSKY** and are unverified.

## Editing sources

Edit [`sources.json`](sources.json) and push. Every entry has a `name` and a `category` (`top`, `world`, `mideast`, `osint`, `defense`, `biz`, `tech`, `hazard` or `science`), plus one of these:

```json
{ "name": "BBC", "category": "world", "url": "https://feeds.bbci.co.uk/news/world/rss.xml" }
{ "name": "WarMonitors", "category": "osint", "type": "telegram", "channel": "warmonitors" }
{ "name": "Reuters", "category": "top", "type": "bluesky", "handle": "reuters.com" }
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
