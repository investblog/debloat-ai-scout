# Debloat AI Scout — competitor watch

Weekly watch of the Chrome Web Store extensions that hide Google's AI features. When one of
them ships new Google SERP selectors, that usually means Google changed its markup — this repo
turns that into a GitHub issue so [Debloat](https://github.com/investblog/debloat) can follow.

## How it works

```
configs/competitors.ts ──► download CRX (in memory) ──► read manifest + Google content scripts
        ──► extract selector tokens ──► diff with snapshots/<id>.json ──► issue + commit snapshot
```

1. For each watched extension, the package is downloaded from the Web Store update endpoint and
   unzipped in memory (`src/watch/crx.ts`). Nothing is written to disk and nothing is executed.
2. Only content scripts that run on Google (plus the background script, for dNR rules such as
   `udm=14` redirects) are scanned. Tokens are taken from string literals and CSS selectors:
   `#id`, `[attr op "value"]` (data-*, jsname, jscontroller, role, …), `.class` (CSS only),
   `udm=N` (`src/watch/extract.ts`).
3. The token set is compared with the committed snapshot. Added / removed tokens are reported in
   one issue labelled `competitor-signal`; each added token is marked ✅ if Debloat's
   `src/selectors/google-search.ts` already contains it, 🆕 otherwise.
4. The first run for an extension only records a baseline.

New tokens are **leads, not facts** — verify them on a live Google results page before adding
them to Debloat.

## Run

```bash
npm ci
npm test            # unit tests (zip reader, extraction, diff)
npm run watch       # fetch + diff; prints the report, opens an issue only with GITHUB_TOKEN
```

The workflow `.github/workflows/watch.yml` runs every Monday 03:00 UTC (and on demand), opens
the issue in this repository and commits changed snapshots. If nothing changed for ~45 days it
commits `snapshots/.heartbeat`, because GitHub disables scheduled workflows after 60 days
without repository activity.

## History

Until v0.1 this repo held "AI Scout": a Cloudflare Worker that received opt-in reports from the
extension plus a Playwright crawler of Google/Bing. It never produced findings — the report
endpoint was not reachable and Google serves a captcha to datacenter crawlers — and was replaced
by this watch in v0.2 (Nov 2026).
