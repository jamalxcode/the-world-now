# The World Now

Live world headlines at **https://news.sala.company**. It runs entirely on GitHub, with no servers, API keys or third-party proxies.

```
 every 15 min            GitHub Actions                       GitHub Pages
┌──────────────┐  go run ./fetcher  ┌───────────┐  deploy-pages  ┌──────────────────┐
│ cron trigger │ ─────────────────▶ │ feed.json │ ─────────────▶ │ index.html + JS  │
└──────────────┘  ~45 public feeds  └───────────┘                │ reads feed.json  │
                                                                 └──────────────────┘
```

- **`fetcher/`**: a small Go program (standard library only). It downloads every feed in `sources.json` on GitHub's servers, so the browser never runs into CORS, then drops items older than 48 hours, removes duplicates and writes `feed.json`.
- **`index.html`, `app.js`, `style.css`**: a static page with no build step. It loads `feed.json` and polls for new builds.
- **`.github/workflows/update.yml`**: runs every 15 minutes, on every push and on demand (**Actions → Update news & deploy → Run workflow**). Only `main` deploys.

## Editing sources

Add or remove entries in [`sources.json`](sources.json) and push. Only use public RSS/Atom feeds that need no sign-up. Each entry has a `name`, a `url` and a `category` (`top`, `world`, `mideast`, `biz`, `tech`, `defense` or `science`). Some sites block GitHub's servers, so check the run log after adding one.

## When feeds fail

- On the site, **[SOURCES]** (or the `s` key) lists every feed with its status and the latest error.
- If fewer than `min_ok_sources` feeds work, the fetcher **fails the run instead of publishing an empty page**. The last good version stays live, and GitHub emails you about the failed workflow.
- The header dot turns amber or red when the data is more than 40 or 120 minutes old.
- GitHub pauses scheduled workflows after 60 days without commits. The workflow makes a small heartbeat commit when the repo has been quiet for 45 days.

## Run locally

```bash
go run ./fetcher -out feed.json   # needs Go 1.22+
python -m http.server 8000         # or any static server, then open http://localhost:8000
```

## Keyboard

`j`/`k` navigate · `o` open · `space` expand related · `/` search · `r` refresh · `n` apply new · `c` cluster · `v` video links · `h` heatmaps · `s` sources · `?` help
