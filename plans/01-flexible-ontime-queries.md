# Plan 01 — Flexible On-Time Percentage Queries

## Decisions Locked (2026-05-24)

- **On-time window default**: `[-60s, +300s]` (1 min early through 5 min late).
  Stored as `on_time_lower_s` / `on_time_upper_s` columns on `agencies` so each
  agency can override; the API also accepts per-query overrides.
- **Storage**: persist `delay_seconds` at parse time (new column on
  `tu_stop_time_updates`). Backfill existing rows in chunks.
- **Time semantics**: store everything in UTC; **convert to agency-local time
  at query time** using `agencies.timezone`. Day-of-week / hour-of-day filters
  are agency-local.
- **Signal**: compare predicted **arrival** to scheduled arrival (default).
  Departure-vs-terminal special-casing is deferred.
- **Schedule resolution** (added 2026-05-24 after review): the parser must also
  capture `TripDescriptor.start_date` so we can convert
  `gtfs_stop_times.arrival_time` (an `HH:MM:SS` text that may exceed 24h) to
  an absolute UTC ms. New nullable column `start_date TEXT` (`YYYYMMDD`) on
  `tu_stop_time_updates`.
- **Aggregate metrics in rollups are additive only**: count, sum_delay_s,
  sum_sq_delay_s (→ mean, std, on_time_pct). **Percentiles (p50/p90) are NOT
  served from rollups.** A `?precision=exact` flag scans raw rows for the
  hot 30-day window; older ranges return percentiles as `null` until plan 02
  Layer C (Iceberg) ships, or we add a t-digest blob per bucket.

## Problem / Goal

The user wants to answer questions like:

- "What's the on-time percentage of Route X on **weekends**?"
- "How does Route X do on **Tuesday afternoons** vs **Friday mornings**?"
- "Show me on-time % for these 3 routes on **weekday rush hours** only."
- "How was Route X on **holidays** vs regular weekdays?"

Today `/api/analysis/stats/ontime` only supports `group_by=route|hour|dow`
(see `apps/worker/src/routes/analysis.ts:374-431`) and **does not actually
compute on-time percentages** — it just counts updates. There is also no
delay/lateness column being persisted, and the parser doesn't store
`TripDescriptor.start_date`, which we need to resolve the absolute scheduled
arrival time of an `HH:MM:SS` schedule entry.

## Current State (citations)

- `apps/worker/src/routes/analysis.ts:374-431` — `getOnTimeStats`. SQL groups by
  hour-of-day or DOW but only returns `total_updates` / `scheduled_count`.
- `apps/worker/migrations/0000_init.sql:47-58` — `tu_stop_time_updates` has
  `arrival_time_ms`, `departure_time_ms`, `schedule_relationship`. **No
  computed `delay_seconds` column.**
- `apps/worker/src/queues/parse-queue.ts:77-115` — TU parser writes the raw
  predicted arrival/departure ms but does not compare to schedule.
- `apps/worker/migrations/0001_wealthy_mimic.sql:29-45` — `gtfs_stop_times`
  holds the **scheduled** `arrival_time` / `departure_time` (as `HH:MM:SS`
  text). This is what we need to compare against.
- `apps/web/src/components/StatsView.tsx:18-117` — UI for stats; currently
  has no filters beyond route+hour+DOW.

## Proposed Approach

### 1. Persist on-time deltas at parse time (best signal, cheapest queries)

Add `delay_seconds INTEGER` and `start_date TEXT` columns to
`tu_stop_time_updates` and populate both in `parse-queue.ts`. The delta is
`predicted_arrival_ms - scheduled_arrival_for_(trip_id, stop_sequence, start_date)_ms`.

- Pros: queries become `AVG(delay_seconds)` / `COUNT(... BETWEEN -60 AND 300)`
  with no extra joins.
- Cons: requires the GTFS static stop_times row at parse time. We already
  resolve `gtfs_version_id` at ingest, so a small in-memory cache should be
  fine — see scope note below.

Industry "on-time" definition (locked default, agency-overridable):
`−60s ≤ delay ≤ +300s`. Override columns live on `agencies`.

#### 1a. Resolving `scheduled_arrival_ms` from GTFS static

`gtfs_stop_times.arrival_time` is `HH:MM:SS` text (`apps/worker/migrations/0001_wealthy_mimic.sql:29-45`)
and can exceed 24h (e.g. `25:13:00` for trips that start before midnight and
end after). Conversion algorithm:

```ts
// inputs: agency.timezone (IANA), start_date 'YYYYMMDD', arrival 'HH:MM:SS'
function scheduledArrivalMs(tz: string, startDate: string, arrival: string): number {
  const [hStr, mStr, sStr] = arrival.split(':')
  const totalSeconds = (+hStr) * 3600 + (+mStr) * 60 + (+sStr)
  // Compose 'noon local' on start_date as a stable anchor, then add
  // (totalSeconds - 12h). Anchoring at noon avoids DST-boundary ambiguity
  // on "spring forward" (which removes 02:00) and "fall back" (which
  // duplicates 01:00) — both edge cases are >= 12h away from noon.
  const yyyy = startDate.slice(0,4), mm = startDate.slice(4,6), dd = startDate.slice(6,8)
  const noonLocalMs = zonedDateTimeToUtcMs(`${yyyy}-${mm}-${dd}T12:00:00`, tz)
  return noonLocalMs + (totalSeconds - 12 * 3600) * 1000
}
```

`zonedDateTimeToUtcMs` uses `Intl.DateTimeFormat(tz, { timeZoneName: 'longOffset' })`
or a `Temporal` polyfill (Workers runtime supports `Temporal` behind a flag —
verify the compatibility date pinned in `wrangler.jsonc` before relying on it,
otherwise use the `Intl` approach which is always available).

#### 1b. Cache scope

The parse queue runs **per-message** today
(`apps/worker/src/queues/parse-queue.ts:21-77`); a queue batch contains up to
10 unrelated messages. Use a **module-level LRU** keyed by
`${gtfs_version_id}|${trip_id}|${stop_sequence}` so that consecutive messages
in the same batch (and consecutive batches in the same isolate lifetime)
share the cache. Per-message cache misses are populated by a single
`SELECT trip_id, stop_sequence, arrival_time FROM gtfs_stop_times
WHERE agency_id = ? AND gtfs_version_id = ? AND trip_id IN (...)` keyed by
the distinct trip_ids in that message.

#### 1c. Schema migration

```sql
ALTER TABLE tu_stop_time_updates ADD COLUMN delay_seconds INTEGER;
ALTER TABLE tu_stop_time_updates ADD COLUMN start_date TEXT;  -- 'YYYYMMDD' from TripDescriptor
-- Match existing index convention; agency_id is the leading column on every
-- analysis query (see analysis.ts:413-426). delay_seconds is intentionally
-- NOT part of the index — it's used as an output expression, not a filter
-- predicate, so adding it would just bloat the index.
CREATE INDEX idx_tu_updates_agency_route_ts_delay
  ON tu_stop_time_updates (agency_id, route_id, ts_ms);
```

#### 1d. Backfill

A one-shot job that walks existing rows in time-chunks, joins to
`gtfs_stop_times`, and updates `delay_seconds`. Existing rows have **no**
`start_date`, so the backfill must infer it from `ts_ms` and `agency.timezone`
(use the local civil date of `ts_ms`, falling back to the previous local date
for schedules that obviously overflow midnight — heuristic: if naive scheduled
time ends up >12h ahead of `ts_ms`, subtract one day). Mark rows we cannot
resolve with `delay_seconds = NULL` and surface the count in the admin
table-stats endpoint.

Run via the admin endpoint introduced in step 2 below; resumable by passing
`start_ms`. Auth: shared `X-Admin-Token` header compared against
`env.ADMIN_TOKEN` (Worker secret).

#### 1e. Pipelines schema evolution

The Cloudflare Pipeline binding for TU has a server-side schema. Before
shipping the parser change, add `delay_seconds` (int, nullable) and
`start_date` (string, nullable) to the `TU_PIPELINE` stream config so the
Iceberg `default.tu_updates` table evolves in lockstep. List this as the
first sub-step of step 1 in the implementation order.

### 2. Generalize the API to accept a structured filter

Replace the `group_by` query param with a flexible filter object:

```
GET /api/analysis/stats/ontime
  ?route_id=11736                  (repeatable)
  &start_ms=...&end_ms=...         (overall window)
  &dow=sat,sun                     (subset of days of week, agency-local)
  &hour_range=14-18                (hour-of-day range, agency-local)
  &exclude_holidays=true           (uses a holiday calendar table; see plan 04)
  &group_by=route|day|week|hour|dow|none
  &on_time_lower_s=-60&on_time_upper_s=300
```

Response:

```json
{
  "filters": { ... echoed ... },
  "precision": "rollup" | "exact",
  "groups": [
    { "group_key": "11736", "samples": 12345, "on_time_pct": 78.4,
      "early_pct": 5.1, "late_pct": 16.5, "avg_delay_s": 92,
      "std_delay_s": 187,
      "p50_delay_s": 30, "p90_delay_s": 540 }
  ]
}
```

`precision: rollup` returns additive aggregates only; `p50_delay_s` and
`p90_delay_s` are `null` in that mode. `precision: exact` (the default for
ranges fully inside the 30-day hot window) scans raw `tu_stop_time_updates`
and fills the percentiles. The UI must hide the percentile column or render
it as "—" when `null`.

Important: time-of-day and day-of-week filtering **must** be done in the
agency's local timezone, not UTC. Storage stays UTC (decision locked); the
worker resolves the filter expression in JS *before* binding SQL, not inside
SQL (D1/SQLite has no IANA tz library). Concretely:

1. Take the user's `(start_ms, end_ms, dow_subset, hour_range)` filter.
2. Walk each local-civil day inside the range using
   `Intl.DateTimeFormat(tz)` and emit a list of UTC `[since_ms, until_ms]`
   sub-windows that cover only the requested `(dow, hour_range)` cells.
   This naturally handles DST: spring-forward yields a 23h day with one
   missing hour, fall-back yields a 25h day with a duplicated hour, both
   correct by construction.
3. Bind those sub-windows into a `WHERE (ts_ms BETWEEN ? AND ?) OR ...`
   clause (cap the disjunction at ~50 sub-windows; for wider ranges, fall
   back to the rollup path which already keys on local dow/hour buckets).

### 3. Frontend UI

In `StatsView.tsx`, add a filter bar above the existing charts:

- Multi-select day-of-week pills (Mon..Sun, plus presets "Weekdays" /
  "Weekends").
- Hour-of-day double-handle slider (0–24).
- Date-range pickers (linked with plan 03).
- Optional "Exclude US federal holidays" checkbox.

When any filter is set, the bar chart legends label the slice (e.g.
"Weekday afternoons, last 30 days").

## Implementation Steps

1. **Pipelines schema change** (config-only, ships before code)
   - Add `delay_seconds`, `start_date` to the TU pipeline stream so Iceberg
     evolves before any new payloads land.
2. **Schema + parse-queue change** (1 PR)
   - Add `delay_seconds`, `start_date` columns + new index (migration).
   - In `parse-queue.ts`, capture `TripDescriptor.start_date`; populate a
     module-level LRU keyed by `${version}|${trip_id}|${stop_seq}` from a
     single `SELECT ... WHERE trip_id IN (...)` per message.
   - Compute delay using the algorithm in §1a; write to D1 and the
     Pipelines payload.
   - Tests: vitest fixture covering `HH:MM:SS > 24h` and DST spring-forward.
3. **Backfill job** (1 PR)
   - New worker route `POST /api/admin/backfill-delays?start_ms&end_ms` (auth
     via `X-Admin-Token` header compared against `env.ADMIN_TOKEN`).
   - Tests: dry-run mode that returns counts without writing.
4. **API v2** (1 PR) — `/api/analysis/stats/ontime` with new params; keep old
   shape behind `?v=1` until UI is migrated. Tests: response shape per
   `precision`, and the local-time sub-window decomposition over a DST day.
5. **UI filter bar** (1 PR) — in `StatsView.tsx`, with URL-synced state.

## Open Questions

- Holidays — see plan 04 for the holiday calendar table proposal.
- Down the road: terminal-aware departure-vs-arrival logic (currently arrival
  is used for every stop; revisit if it produces noisy first-stop signal).
- Down the road: UI surfacing of the agency-level on-time window override
  (an admin form, not a per-query control).

## Acceptance Criteria

- [ ] User can filter on-time stats by `dow` subset + hour range + date range.
- [ ] Response includes true `on_time_pct`, `avg_delay_s`, and (when
      `precision=exact`) `p50_delay_s` / `p90_delay_s`. Rollup-precision
      responses set those fields to `null` and the UI renders them as `—`.
- [ ] All timing is computed in agency-local time, with explicit DST tests.
- [ ] Bar charts in `StatsView.tsx` reflect the active filters.
- [ ] Backfill processes all existing rows or clearly skips them with a NULL
      `delay_seconds` that the UI handles.
- [ ] Iceberg `tu_updates` table contains the two new columns before any
      worker code that writes them is deployed.
- [ ] Vitest coverage: schedule-time conversion (incl. >24h, DST), local
      sub-window decomposition, backfill dry-run.
