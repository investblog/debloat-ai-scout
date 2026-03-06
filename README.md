# Debloat AI Scout

Automated detection of new AI insertions and GitHub Issue generation for the [Debloat](https://github.com/investblog/debloat) browser extension.

## What it does

- Crawls browser surfaces (Google Search, Bing, Edge NTP, Firefox Home)
- Detects new AI elements, UI drift, and selector regressions
- Fingerprints findings to avoid duplicates
- Creates structured GitHub Issues with DOM snippets and screenshots

## Architecture

- **GitHub Actions** — Playwright crawl (daily cron)
- **Cloudflare Workers** — state API, webhook handler
- **Cloudflare KV** — baselines, fingerprints, feedback registry
- **Cloudflare R2** — screenshots, DOM snapshots

## Setup

```bash
npm install
cp .env.example .env
# Fill in .env values (see setup checklist)
```

## Commands

```bash
npm run scan           # Run crawler locally
npm run test           # Unit tests
npm run check          # Typecheck + lint + test
npm run worker:dev     # Local CF Worker dev server
npm run worker:deploy  # Deploy CF Worker
```

## Status

Sprint 0 — project scaffold.
