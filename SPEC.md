# TransitTrack — Implementation Spec / Checklist

## 0) Core decisions (locked)

- [x] **Hosting**: Single Cloudflare Worker serves
  - API under `/api/*`
  - React frontend as static assets (Worker `assets`)
- [x] **Storage**: R2 (immutable archive) + D1 (index/query) + Durable Objects (ingest coordination)
- [x] **Timezone**: store/query timestamps in UTC only
- [x] **Ingest cadence v1**: 1-minute snapshots (Cron Trigger)
- [x] **Feeds v1**: bus-first (Local Bus)
  - [x] GTFS static: https://feeds.mta.maryland.gov/gtfs/local-bus
  - [ ] GTFS-RT via Swiftly (agencyKey `mta-maryland`)
    - [ ] Trip Updates
    - [ ] Vehicle Positions
    - [ ] Alerts optional: https://feeds.mta.maryland.gov/alerts.pb

## 0.1) Repo / monorepo status

- [x] npm workspaces monorepo
- [x] `apps/web` builds into `apps/worker/site`
- [x] Worker serves `/api/*` + SPA fallback

## 0.2) Branch strategy + release strategy (Option B: trunk-based)

- [ ] **Branch protections** (GitHub) — **MANUAL SETUP YOU MUST DO IN GITHUB UI**
  - [ ] Go to GitHub repo → **Settings** → **Branches**
  - [ ] Under **Branch protection rules**, click **Add rule**
  - [ ] **Branch name pattern**: `main`
  - [ ] Enable **Require a pull request before merging**
    - [ ] Enable **Require approvals** (set to `1` for now)
    - [ ] (Recommended) Enable **Dismiss stale pull request approvals when new commits are pushed**
  - [ ] Enable **Require status checks to pass before merging**
    - [ ] Enable **Require branches to be up to date before merging**
    - [ ] Select the CI check from this repo’s workflow:
      - [ ] Check name is typically **`CI`** (sometimes shown as `CI / ci`)
      - [ ] If you don’t see it yet, push a commit and wait for Actions to run once, then come back and select it
  - [ ] Enable **Restrict who can push to matching branches** (so direct pushes are blocked)
    - [ ] Leave empty unless you want to allow a release-bot later
  - [ ] (Recommended) Enable **Do not allow bypassing the above settings**
  - [ ] Click **Create** / **Save changes**
- [x] **Staging deploy**
  - [x] `main` deploys to staging (Worker env `staging`)
- [ ] **Production deploy**
  - [ ] Production deploys on version tags only (e.g. `v0.1.0`)

## 0.3) CI / quality gates

- [x] Root script `npm run ci` (lint + test + build)
- [ ] Enforce in GitHub branch protection: required check `CI`
- [ ] Local discipline (part of commit/push)
  - [ ] Run `npm run ci` before pushing
  - [ ] (Optional) Enable the repo’s pre-push hook so CI runs automatically before every push — **MANUAL SETUP YOU MUST DO LOCALLY**
    - [ ] One-time setup:
      - [ ] Run: `npm run setup:hooks`
    - [ ] After that, `git push` will run `npm run ci` automatically
    - [ ] If you need to bypass it once: `git push --no-verify`

## 0.4) GitHub Actions + required secrets

- [x] CI workflow (PR/push)
- [x] Deploy staging workflow (push to `main`)
- [x] Deploy production workflow (push tag `v*`)

GitHub repo secrets required:

- [ ] `CLOUDFLARE_API_TOKEN`
- [ ] `CLOUDFLARE_ACCOUNT_ID`

Manual GitHub setup (Option B):

- [ ] **Enable Actions** (GitHub)
  - [ ] GitHub repo → **Settings** → **Actions** → **General**
  - [ ] Ensure Actions are allowed to run for this repo
- [ ] **Add Actions secrets** (GitHub)
  - [ ] GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
  - [ ] Add `CLOUDFLARE_API_TOKEN`
    - [ ] Create in Cloudflare dashboard → **My Profile** → **API Tokens**
    - [ ] Use a token that can deploy Workers (and read account info). Start with Cloudflare’s “Edit Workers” token template and tighten later.
  - [ ] Add `CLOUDFLARE_ACCOUNT_ID`
    - [ ] Find in Cloudflare dashboard (right sidebar / overview) or via `wrangler whoami`
- [ ] **(Recommended) Configure Environments** (GitHub)
  - [ ] GitHub repo → **Settings** → **Environments**
  - [ ] Create environment: `staging`
  - [ ] Create environment: `production`
    - [ ] (Optional) Require reviewers for `production` deploys (extra safety even though prod is tag-based)

Release process (Option B):

- [ ] Merge PR into `main` (this deploys to **staging**)
- [ ] Verify staging looks good
- [ ] Create a version tag and push it (this deploys to **production**)
  - [ ] Example:
    - [ ] `git tag v0.1.0`
    - [ ] `git push origin v0.1.0`

## 1) External API details (what to call)

### 1.1 Swiftly GTFS-RT base pattern

- [ ] Trip updates
  - [ ] `https://api.goswift.ly/real-time/{agencyKey}/gtfs-rt-trip-updates`
- [ ] Vehicle positions
  - [ ] `https://api.goswift.ly/real-time/{agencyKey}/gtfs-rt-vehicle-positions`

For MTA bus (Local Bus):

- [ ] `agencyKey = mta-maryland`

### 1.2 Auth

- [ ] Store API key as a Worker secret: `SWIFTLY_API_KEY`
- [ ] Send both headers on requests:
  - [ ] `Authorization: Bearer ${SWIFTLY_API_KEY}`
  - [ ] `x-api-key: ${SWIFTLY_API_KEY}`

### 1.3 Response type

- [ ] GTFS-RT endpoints return protobuf (`.pb`)

## 2) Cloudflare resources to create

- [ ] **R2 buckets** (Cloudflare Dashboard) — **MANUAL SETUP YOU MUST DO IN CLOUDFLARE UI**
  - [ ] Create production bucket: `transittrack-archive`
  - [ ] Create staging bucket: `transittrack-archive-staging`
  - [ ] Note: `wrangler.jsonc` already expects these names for the `ARCHIVE_BUCKET` binding
- [ ] **D1 databases** (Cloudflare Dashboard) — **MANUAL SETUP YOU MUST DO IN CLOUDFLARE UI**
  - [ ] Create production DB: `transittrack`
  - [ ] Create staging DB: `transittrack-staging`
  - [ ] Note: we will need to add the D1 `database_id` values to `wrangler.jsonc` later
  - [ ] After creating DBs, apply schema from repo:
    - [ ] `npm run -w transittrack-worker db:apply`
    - [ ] `npm run -w transittrack-worker db:apply:staging`
  - [ ] Seed initial agencies/feeds:
    - [ ] `npm run -w transittrack-worker db:seed`
    - [ ] `npm run -w transittrack-worker db:seed:staging`
- [ ] **Durable Object namespace**
  - [x] Worker config includes DO binding `INGEST_COORDINATOR` → class `IngestCoordinator`
  - [x] Worker config includes migrations for the DO class
- [ ] **Cron trigger**
  - [ ] Add a 1-minute cron once ingestion is implemented (avoid enabling it before the pipeline exists)
- [ ] Optional: Queue (not required for v1)

## 3) Data you store forever (R2 object layout)

- [ ] Store raw immutable snapshots in R2

R2 key format for GTFS-RT snapshots:

- [ ] `gtfsrt/{agency_id}/{feed_type}/year=YYYY/month=MM/day=DD/hour=HH/{ts_ms}.pb`
  - [ ] `agency_id`: start with `mta-maryland-local-bus`
  - [ ] `feed_type`: `trip-updates` | `vehicle-positions` | `alerts`
  - [ ] `ts_ms`: ingestion timestamp (UTC ms)

R2 key format for GTFS static zips:

- [ ] `gtfs-static/{agency_id}/hash={sha256}/fetched_at={ts_ms}.zip`

## 4) Versioning GTFS static

- [ ] Each realtime snapshot gets assigned a `gtfs_version_id`
- [ ] `gtfs_version_id = sha256(gtfs_zip_bytes)`
- [ ] Snapshot → GTFS mapping rule: “latest GTFS fetched before snapshot time”

## 5) D1 schema (explicit tables + indexes)

### 5.1 Agencies + feeds

- [ ] `agencies`
  - [ ] `agency_id TEXT PRIMARY KEY`
  - [ ] `display_name TEXT`
  - [ ] `timezone TEXT` (store UTC)
  - [ ] `gtfs_static_url TEXT`
  - [ ] `swiftly_agency_key TEXT`
  - [ ] `enabled INTEGER`
- [ ] `feeds`
  - [ ] `feed_id TEXT PRIMARY KEY`
  - [ ] `agency_id TEXT`
  - [ ] `feed_type TEXT`
  - [ ] `url TEXT`
  - [ ] `enabled INTEGER`
  - [ ] Index `(agency_id, feed_type)`

### 5.2 Static GTFS versions

- [ ] `gtfs_versions`
  - [ ] `gtfs_version_id TEXT PRIMARY KEY`
  - [ ] `agency_id TEXT`
  - [ ] `fetched_at_ms INTEGER`
  - [ ] `r2_key TEXT`
  - [ ] Index `(agency_id, fetched_at_ms)`
- [ ] `gtfs_version_effective`
  - [ ] `agency_id TEXT`
  - [ ] `effective_from_ms INTEGER`
  - [ ] `gtfs_version_id TEXT`
  - [ ] Primary key `(agency_id, effective_from_ms)`

### 5.3 Snapshot index

- [ ] `gtfsrt_snapshots`
  - [ ] `snapshot_id TEXT PRIMARY KEY`
  - [ ] `agency_id TEXT`
  - [ ] `feed_type TEXT`
  - [ ] `ts_ms INTEGER`
  - [ ] `gtfs_version_id TEXT` (nullable for alerts)
  - [ ] `r2_key TEXT`
  - [ ] `byte_size INTEGER`
  - [ ] `http_etag TEXT` (nullable)
  - [ ] `http_last_modified TEXT` (nullable)
  - [ ] Index `(agency_id, feed_type, ts_ms)`

### 5.4 Parsed “thin” tables for fast UI (hot cache)

- [ ] `vp_points`
  - [ ] Index `(agency_id, route_id, ts_ms)`
  - [ ] Index `(agency_id, vehicle_id, ts_ms)`
- [ ] `tu_stop_time_updates`
  - [ ] Index `(agency_id, route_id, ts_ms)`
  - [ ] Index `(agency_id, trip_id, ts_ms)`

## 6) Durable Object responsibilities

- [ ] DO class: `IngestCoordinator`
- [ ] One DO instance per agency (`id = agency_id`)
- [ ] Prevent overlapping ingests per agency
- [ ] Store last-success metadata and last error

Endpoints in DO:

- [ ] `POST /do/ingest/run` body `{ agency_id: string }`

## 7) Ingestion pipeline

### 7.1 Cron handler

- [ ] On scheduled event: for each enabled agency, call the agency’s DO run

### 7.2 DO run flow

For each enabled feed:

- [ ] Fetch feed with auth headers
- [ ] `ts_ms = Date.now()` (UTC)
- [ ] Resolve `gtfs_version_id` (latest effective <= `ts_ms`)
- [ ] Write raw snapshot to R2
- [ ] Write snapshot index row to D1
- [ ] Decode protobuf and write hot-cache rows to D1 (batched inserts)

Idempotency:

- [ ] Snapshot ID is unique (`agency_id + feed_type + ts_ms`)

## 8) GTFS static fetch + parse pipeline

- [ ] Download GTFS zip
- [ ] Compute sha256 → `gtfs_version_id`
- [ ] Store zip in R2
- [ ] Insert into `gtfs_versions` + `gtfs_version_effective`
- [ ] Parse minimal CSVs into versioned D1 tables

## 9) Public API routes (explicit contract)

### 9.1 Metadata

- [ ] `GET /api/agencies`
- [ ] `GET /api/{agency_id}/routes?gtfs_version_id=...`
- [ ] `GET /api/{agency_id}/route/{route_id}/stops?gtfs_version_id=...`
- [ ] `GET /api/{agency_id}/route/{route_id}/patterns?gtfs_version_id=...`

### 9.2 Stringline

- [ ] `GET /api/{agency_id}/stringline`
  - [ ] `route_id`
  - [ ] `pattern_id` (required for buses)
  - [ ] `start_ms`
  - [ ] `end_ms`
  - [ ] `source=vehicle_positions|trip_updates`
  - [ ] `y_axis=stop_index|distance`

### 9.3 Exports

- [x] `GET /api/{agency_id}/export`
	- [x] Returns manifest of R2 keys for day (v1)
	- [x] `GET /api/{agency_id}/snapshots` (list D1 index rows; returns 501 locally until D1 bound)

## 10) Frontend (React) pages

- [ ] `/` selectors + time range
- [ ] `/stringline` chart
- [ ] `/download` manifest download

## 11) Hard parts / implementation notes

- [ ] Buses have multiple patterns: use `shape_id` and/or a representative `trip_id` to define `pattern_id`
- [ ] Join realtime to static via `trip_id` when possible
- [ ] R2 is forever archive; D1 is index + hot cache

## 12) Milestones (deliverable order)

- [ ] **Milestone A — Infrastructure**
  - [ ] Bind R2 + D1 + DO
  - [ ] Add cron trigger
  - [ ] Add secret `SWIFTLY_API_KEY`
- [ ] **Milestone B — Static GTFS**
  - [ ] Download + version + parse
- [ ] **Milestone C — Realtime ingest**
  - [ ] cron → DO → fetch → R2 → D1 index → parse hot tables
- [ ] **Milestone D — Query APIs**
  - [ ] metadata + stringline
- [ ] **Milestone E — React UI**
  - [ ] selectors + stringline
- [ ] **Milestone F — Exports**
  - [ ] day manifest export
