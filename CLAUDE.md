# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**The World Now** (https://news.sala.company) is a live world-headlines page that runs entirely on GitHub: a Go
fetcher (standard library only) runs in GitHub Actions every ~5 minutes, pulls ~130 public sources (RSS/Atom feeds,
YouTube channel feeds, public Telegram web previews `t.me/s/<channel>`, public Bluesky accounts, Google News searches),
dedupes and tags them, and writes static JSON files that are deployed with the site to GitHub Pages. The front end is
a no-build vanilla HTML/CSS/JS page (`index.html`, `app.js`, `style.css`) plus a service worker, installable as a PWA.
No servers, API keys or third-party proxies.

## Commands

```bash
go run ./fetcher -out feed.json          # Go 1.22+ (go.mod); writes feed.json from sources.json
python -m http.server 8000               # or any static server; open http://localhost:8000
go build -o fetch ./fetcher              # what CI does before running the fetcher several times
```

Useful fetcher flags (see `fetcher/main.go`): `-sources`, `-out`, `-carry <url of previous feed.json>`, `-out24`,
`-outstart`/`-starthours`, `-outnew`/`-newmin`, `-breaking`, `-breakingprev`. There are no tests, linters or npm scripts.
`feed.json` and `_site/` are gitignored. Note: a compiled binary `fetcher/fetcher` is committed; CI does not use it.

## Architecture

- `fetcher/` (Go, package main):
  - `main.go` – config loading (`max_age_hours` = 48, `min_ok_sources`, junk filters), fetching, 48h cutoff, dedupe of
    syndicated copies (`also`, `via`), carry-forward of the previous live build's items, output files. If fewer than
    `min_ok_sources` sources work it fails the run instead of publishing an empty page. Failing sources are set aside
    (retried every 6h after 24h of failure).
  - `rss.go` (RSS/Atom), `social.go` (Telegram/Bluesky), `enrich.go` (country tagging `geo` via `geoData`, including
    Arabic place names), `breaking.go` (`breaking.json` with the `notify` list for push alerts).
- Source configs: `sources.json` (main; categories `top, world, mideast, osint, defense, biz, tech, hazard, science`;
  also `known_outlets`, `blocked_outlets`, `exclude_title_patterns`, `min_title_words`), `sources-near.json`
  (Google News per country -> `near*.json`, each every 30 min via `every_minutes`), `sources-ar.json` (Arabic ->
  `ar*.json`), `sources-local.json` (Arabic/Russian/Ukrainian -> `local.json`, read only by the separate Meridian map
  project, not by this page).
- Published data files: `feed.json` (48h), `feed-24h.json`, `feed-start.json`/`near-start.json` (last 6h),
  `*-new.json` (last ~75 min), `near.json`, `ar.json`, `local.json`, `breaking.json`, and `version.json` (build times).
  The page polls `version.json` and only fetches the small `*-new.json` files when a build is new; full files load on
  open, on refresh, hourly, and when 48h/Arabic is enabled.
- `app.js` (~1500 lines) – rendering, clustering, Near me rings (`GEO_GROUPS`, country from the device time zone),
  breaking detection (`BREAK_MIN_SOURCES`, `BREAK_WINDOW_H`, `BREAK_FRESH_MIN` at the top), source tiers
  (`tier()`, `KNOWN_OUTLETS`, `PAYWALLED`, `DEFAULT_HIDDEN`), search-link term selection (`storyTerms`), keyboard
  shortcuts, alerts. All settings/ratings are in `localStorage` with the `twn-` prefix (e.g. `twn-theme`,
  `twn-text-size`, read by an inline script in `index.html` before paint).
- `sw.js` – network-first service worker (cache `twn-v1`, state cache `twn-state`); JSON is cached by pathname so
  `?t=`/`?v=` variants share one copy; Periodic Background Sync breaking-news check (Chromium installed apps only).
- `manifest.webmanifest`, `icons/`, `fonts/inter-latin.woff2`, `og-image.png`.

## Deployment

- `.github/workflows/update.yml` ("Update news & deploy"): runs on cron (`2-59/5 * * * *`, backup only), on every
  push, and on `workflow_dispatch` (triggered every 5 min by an external cron-job.org job). It builds the fetcher,
  generates all JSON into `_site/`, copies `index.html app.js style.css fonts icons manifest.webmanifest sw.js
  og-image.png CNAME` into `_site/`, and deploys to GitHub Pages via Actions. **Only `main` deploys; pushing to `main`
  deploys live.** Then an `alerts` job posts new breaking stories to the public ntfy.sh topic
  `news-sala-company-breaking`, and a `heartbeat` job commits `.github/heartbeat` after 45 quiet days so schedules stay
  enabled. `concurrency: pages` with cancel-in-progress.
- `.github/workflows/freshness.yml`: hourly check that live `feed.json` is under 30 minutes old (fails otherwise).
- Custom domain from `CNAME` (`news.sala.company`). The fetcher reads the previous live files from that domain
  (`-carry`, `-breakingprev`), so the site URL is hard-coded in the workflow.

## Conventions / gotchas

- **New top-level static files must be added to the `cp` line in `update.yml`**, or they will not be deployed.
- Cache-busting is automatic: the workflow rewrites `src="app.js"` and `href="style.css"` in `index.html` to
  `?v=<short sha>` and greps to verify. Keep those attributes written exactly like that. `sw.js` uses a fixed cache
  name `twn-v1`; bump it if the cached shell must be invalidated.
- **GoatCounter** snippet at the bottom of `index.html` (endpoint `https://salacompany.goatcounter.com/count`, paths
  prefixed with `location.host`) – keep it intact.
- Workflow comments must not contain `${{ }}` expressions (GitHub evaluates them even in comments); headline text must
  travel through env vars, never be interpolated into `run:` scripts.
- Only add public sources that need no sign-up; some sites block GitHub's runners, so check the run log or the
  Sources panel (`s`).
- Arabic headlines render right-to-left; the page has light/dark themes and mobile layouts (side panel only at
  >= 1200px).
