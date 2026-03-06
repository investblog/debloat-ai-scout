# Debloat AI Scout

Automated detection of new AI insertions for the [Debloat](https://github.com/investblog/debloat) browser extension. Receives reports from extension users, runs heuristic detection, and creates GitHub Issues for new findings.

## How it works

```
Extension (opt-in) → POST /scout/report → Worker pipeline → GitHub Issue
                                            ↓
                              detect → score → filter → baseline diff → dedup
```

1. **Debloat extension** detects AI elements on search pages and sends anonymous reports
2. **Cloudflare Worker** runs the detection pipeline: heuristic scoring, false-positive filtering, baseline diffing, duplicate suppression
3. **GitHub Issues** are created for novel findings with DOM snippets, signals, and metadata
4. **Webhook feedback loop**: closing an issue with labels (e.g. `false-positive`, `fixed`) updates baselines and suppression registry
5. **Notifications**: extension receives ready-to-show notification payloads for each report
6. **Weekly digest**: per-installation and global stats via `/scout/digest`

## Architecture

| Component | Stack | Purpose |
|-----------|-------|---------|
| Worker API | Cloudflare Workers + Hono | Report processing, detection pipeline, GitHub integration |
| State | Cloudflare KV | Baselines, fingerprints, feedback, stats |
| Artifacts | Cloudflare R2 | Screenshots, scan metadata |
| Crawler | Playwright (GHA) | Optional smoke-test crawling |
| Tests | Vitest | 61 unit tests |

## API

### `POST https://scout.debloat.click/scout/report`

Extension sends detected candidates. Worker returns pipeline result + notification payload.

### `GET https://scout.debloat.click/scout/digest?id={installId}`

Weekly stats — personal (`you`) and community (`global`).

### Webhook: `POST /webhook/github`

GitHub Issues webhook — processes `closed` events to update suppression registry and baselines.

## Detection Pipeline

```
candidates → detectAndScore() → applyFilters() → filterActionable()
  → diffAgainstBaseline() → dedup check → createGitHubIssue()
```

- **Heuristic scoring**: keyword signals (AI/sponsored/shopping), placement, action buttons, shadow DOM
- **Filtering**: structural elements, organic search results, oversized containers, nested dedup
- **Fingerprinting**: FNV-1a hash of DOM properties for stable identity across scans
- **Baseline diff**: added/removed/changed/unchanged categorization

## Resolution Labels

| Label | Effect |
|-------|--------|
| `false-positive` | 30-day suppression in KV |
| `fixed` | Promotes candidate baseline to stable |
| `accepted-baseline-update` | Promotes candidate baseline |
| `duplicate-detection` | Suppression |
| `needs-human-review` | Auto-applied by scout |

## Development

```bash
npm install
npm run test           # 61 unit tests
npm run check          # typecheck + lint + test
npm run scan           # Run Playwright crawler (loads .env)
npm run scan:dry       # Dry-run without Worker
npm run worker:dev     # Local Worker dev server
npm run worker:deploy  # Deploy to Cloudflare
```

## Project Structure

```
src/
  shared/types.ts        Core types (CandidateBlock, ExtensionReport, etc.)
  detectors/             Heuristic scoring + false-positive filters
  fingerprint/           FNV-1a block + layout fingerprinting
  scoring/               Score thresholds and verdict logic
  baseline/              Baseline diff engine
  crawler/               Playwright crawl (optional)
  github/                Issue composer + GitHub API client
  worker-client.ts       Worker API client for GHA pipeline
configs/
  keywords.ts            AI/sponsored/shopping keyword lists
  scoring.ts             Score weights and thresholds
  surfaces.ts            Crawl target definitions
  baselines.ts           Baseline management config
  suppression.ts         Suppression TTL config
worker/src/
  index.ts               Hono app with CORS
  routes/report.ts       POST /scout/report — full pipeline
  routes/digest.ts       GET /scout/digest — weekly stats
  routes/baseline.ts     Baseline CRUD
  routes/dedup.ts        Duplicate checking
  routes/scan.ts         Scan results storage (GHA)
  routes/webhook.ts      GitHub webhook handler
scripts/
  e2e-live-test.ts       End-to-end test script
  inspect-candidates.ts  Debug artifact viewer
```

## Related

- [Debloat](https://github.com/investblog/debloat) — the browser extension
- [debloat.click](https://debloat.click) — project website
