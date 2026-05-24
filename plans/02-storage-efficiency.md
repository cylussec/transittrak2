# Plan 02 — Storage & Lookup Efficiency for Many Agencies × Many Years

## Decisions Locked (2026-05-24)

- **Hot D1 window**: **30 days** of raw rows. Older rows live only in Iceberg.
- **Layers to pursue (in this execution order)**:
  1. **Layer E** — Dedup at parse time (cheapest, biggest immediate win).
  2. **Layer B** — Pre-aggregation rollup tables (unlocks plan 01 at scale).
  3. **Layer A** — INTEGER dim tables for route/vehicle/stop/version.
  4. **Layer C** — Iceberg query path (see below).
- **Cold-query path**: wait for **Cloudflare R2 SQL / native Iceberg query** to
  go GA. Until it ships, queries / reports that need data older than 30 days
  return a clear `{ status: 'archived', earliest_hot_ms }` response and the UI
  surfaces a CTA. We do **not** ship a DuckDB-WASM or Containers solution in
  the interim.

## Problem / Goal

Even with a few months of MTA Maryland Local Bus data, the bill is approaching
$1. We want to:

1. Add many more agencies (NY MTA, WMATA, CTA, BART, etc.) — NY MTA alone is
   ~10× the size of MTA Maryland.
2. Retain **years** of data forever (per existing rule).
3. Keep both **storage cost** and **query latency** acceptable.

We need a deliberate hot/cold tiering strategy with aggressive pre-aggregation,
because the per-row cost of D1 plus the cardinality of NYC bus + subway will
otherwise dominate.

## Current State (citations)

- Dual write: `apps/worker/src/queues/parse-queue.ts:37-115` writes every VP /
  TU row to **D1** *and* to **R2 Data Catalog (Iceberg)** Pipelines.
- D1 schema: `apps/worker/migrations/0000_init.sql:47-80` —
  `vp_points` and `tu_stop_time_updates` are **wide and indexed twice each**.
  Every row carries `agency_id`, `gtfs_version_id`, `vehicle_id`, etc. as TEXT.
- D1 age-off cron: daily at 02:00 UTC, deletes only when DB > 8 GB. (See
  retrieved memory.)
- Pipelines write Parquet + zstd to Iceberg tables (`vp_points`, `tu_updates`).
- Analysis queries (`apps/worker/src/routes/analysis.ts`) **only touch D1**.
  Iceberg is currently a write-only archive.

## Cost / Size Drivers (rough)

A `vp_points` row stored in D1 SQLite is on the order of 150–250 bytes
(uncompressed) with two indexes per row. For NYC MTA bus + subway (~5–6k
vehicles, 60s cadence) that is ~5M rows/day. A year of NYC alone in D1 would
be ~2 billion rows / >300 GB — well past D1's 10 GB hard cap per database.

Iceberg/Parquet with zstd compresses GTFS-RT-style data 8–15× and gives us
predicate pushdown — that's where multi-year data must live.

## Proposed Approach (in layers)

### Layer A — Row-level encoding wins (cheap, do first)

In **D1** today every row stores `agency_id`, `route_id`, `vehicle_id`,
`stop_id`, `gtfs_version_id` as text. With a dictionary table:

| Lookup table | Replaces |
|--------------|----------|
| `dim_agency(agency_pk INTEGER PRIMARY KEY, agency_id TEXT UNIQUE)` | TEXT `agency_id` |
| `dim_route(route_pk, agency_pk, route_id)` | TEXT `route_id` |
| `dim_vehicle(vehicle_pk, agency_pk, vehicle_id)` | TEXT `vehicle_id` |
| `dim_stop(stop_pk, agency_pk, stop_id)` | TEXT `stop_id` |
| `dim_version(version_pk, gtfs_version_id)` | TEXT `gtfs_version_id` |

Migrate `vp_points` / `tu_stop_time_updates` to use the INTEGER FKs. Expected
row-size reduction: **2–4×** with no information loss.

Also: `direction_id`, `current_status`, `schedule_relationship` can be 1-byte
INTEGER enums. `bearing` / `speed` can be REAL or even smallint with scale.

### Layer B — Aggressive pre-aggregation tables in D1

The hot UI almost never needs **raw 60-second pings**. It needs:

- "Position of vehicle V at minute M on route R" → already 60s; OK.
- "Stringline of route R for last N hours" → minute-resolution is fine.
- "On-time % bucketed by (route, hour, dow)" → can be a **rollup**.

Add summary tables that are computed by a Durable Object or cron once per
hour/day:

- `vp_minute_bins(agency_pk, route_pk, vehicle_pk, minute_bucket_ms, lat, lon, stop_pk, direction_id)`
  — keeps one row per (vehicle, minute) instead of multiple.
- `tu_route_hour_stats(agency_pk, route_pk, ts_hour_ms, samples, on_time, early, late, sum_delay_s, sum_sq_delay_s)`
  — feeds plan 01 instantly; sub-millisecond queries.
- `tu_route_dow_hour_stats(agency_pk, route_pk, dow, hour, samples, on_time, ..., as_of_ms)`
  — rolling 30 / 90 / 365-day windows materialized.

D1 retains only the rollups + the last **7 days** of raw rows. Anything older
is served from Iceberg.

### Layer C — Cold reads from Iceberg

For "give me 3 months of route R at minute resolution":

- Today the worker has no Iceberg query path.
- Add a worker route `GET /api/analysis/archive/...` that queries
  R2 Data Catalog via the Iceberg REST catalog + a small Parquet reader.
  Cloudflare's Pipelines docs link to PyIceberg / DuckDB-WASM patterns; for
  a Worker, the realistic options are:
  - **(A)** Issue a query through Cloudflare's R2 SQL / Iceberg query
    endpoint when available, OR
  - **(B)** Spawn a small companion service (Cloudflare Containers /
    external) that does the heavy scan and writes a cached result back to R2.
- Cache the result in R2 under
  `analytics-cache/{agency}/{query_hash}.json` with a TTL.

For interactive UI: never block on Iceberg; instead, fire the query through
plan 04's report system so the user gets a "report ready" notification.

### Layer D — Per-agency partition discipline

Pipelines stream config should partition Iceberg by
`(agency_id, year, month, day)` so multi-agency queries only scan the partitions
they need. (Verify the current Pipeline stream config — set partition keys if
missing.)

R2 raw `.pb` archive key format (already in spec) is per-agency-per-hour, so
that's fine for replays.

### Layer E — Don't archive what we don't need

GTFS-RT often emits duplicate predictions (a stop appears in 5 consecutive TU
snapshots with the same predicted arrival). At parse time we can dedupe:

- For `tu_stop_time_updates`: only write a row when
  `(trip_id, stop_sequence)` has a **different** `arrival_time_ms` vs the last
  one we saw within the last 5 min. A small Durable Object keyed by
  `(agency, trip_id)` keeps the last value.
- Expected reduction: **3–5×** on TU volume.

For `vp_points`: only write when the vehicle has moved > X meters or X
seconds since the last write. Configurable per agency.

### Layer F — Add NY MTA in stages

NY MTA has separate feeds per subway division (1234567, ACE, BDFM, G, JZ, L,
NQRW, SIR) and per bus borough. Add them as **separate `feed_id` rows** under
one `agency_id = mta-nyct` so users see one logical agency. Enable feeds one
at a time and watch cost dashboards.

## Implementation Order

1. **Measure first** (no code change). Add a worker route
   `GET /api/admin/storage-stats` that returns per-table row counts and a
   `dbsize_mb` estimate. Capture a baseline before optimizing.
2. **Dedupe at parse time** (Layer E). Lowest risk; reduces every downstream
   storage cost.
3. **Rollups** (Layer B). Required by plan 01.
4. **Dim tables / INTEGER FKs** (Layer A). Background migration; new inserts
   use FKs first, backfill in chunks.
5. **Tighten age-off cron to 30-day window** (was 8 GB-triggered). Once the
   Iceberg fallback is in place, this becomes the source of truth.
6. **Cold-query fallback shim** (returns `{ status: 'archived' }` for old
   ranges) — ships *with* the 30-day cap so the UI never silently truncates.
7. **Iceberg query path** (Layer C) once Cloudflare R2 SQL is GA. Replace the
   shim with real results.
8. **Enable NY MTA feeds** (Layer F). One feed at a time. Required *before*
   step 7 only if NY data volume forces D1 down to a smaller window.

## Acceptance Criteria

- [ ] Per-day D1 growth drops at least 2× without losing query fidelity.
- [ ] `getOnTimeStats` (post plan 01) responds in <100 ms for any
      (route, time-of-day, dow) filter, using the rollup tables.
- [ ] Queries older than 30 days return a clean `{ status: 'archived' }`
      shim until Cloudflare R2 SQL is GA, then transparently read from Iceberg.
- [ ] Adding a new agency = inserting rows in `agencies` + `feeds`, no schema
      changes.
- [ ] Documented monthly cost projection in this file once Layer A+B is in.

## Open Questions

- Should `vp_points` be downsampled to 30s for high-frequency agencies in D1
  (Layer B writes a downsampled copy), or kept raw? Recommendation: keep raw
  in Iceberg, downsample to 60s in D1's `vp_minute_bins` rollup.
- When NY MTA goes live, is 30 days still feasible inside D1's 10 GB cap, or
  do we need to drop the hot window for that one agency? Re-evaluate after
  Layer A lands and we have real numbers.
- Track Cloudflare R2 SQL GA status; this plan blocks on it for Layer C.
