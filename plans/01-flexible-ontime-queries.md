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

## Problem / Goal

The user wants to answer questions like:

- "What's the on-time percentage of Route X on **weekends**?"
- "How does Route X do on **Tuesday afternoons** vs **Friday mornings**?"
- "Show me on-time % for these 3 routes on **weekday rush hours** only."
- "How was Route X on **holidays** vs regular weekdays?"

Today `/api/analysis/stats/ontime` only supports `group_by=route|hour|dow`
(see `apps/worker/src/routes/analysis.ts:374-431`) and **does not actually
compute on-time percentages** — it just counts updates. There is also no
delay/lateness column being persisted.

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

Add a computed column `delay_seconds INTEGER` to `tu_stop_time_updates` and
populate it in `parse-queue.ts`. The delta is
`predicted_arrival_ms - scheduled_arrival_for_(trip_id, stop_sequence)_ms`.

- Pros: queries become `AVG(delay_seconds)` / `COUNT(... BETWEEN -60 AND 300)`
  with no extra joins.
- Cons: requires the GTFS static stop_times row at parse time. We already
  resolve `gtfs_version_id` at ingest, so a small in-memory cache per worker
  invocation keyed by `(version, trip_id, stop_sequence)` should be fine.

Industry "on-time" definition (locked default, agency-overridable):
`−60s ≤ delay ≤ +300s`. Override columns live on `agencies`.

Schema migration:

```sql
ALTER TABLE tu_stop_time_updates ADD COLUMN delay_seconds INTEGER;
CREATE INDEX idx_tu_route_ts_delay ON tu_stop_time_updates (route_id, ts_ms, delay_seconds);
```

Backfill: a one-shot script that walks existing rows in time-chunks, joins to
`gtfs_stop_times` and updates `delay_seconds`. Run via the admin endpoint
introduced in step 2 below; resumable by passing `start_ms`.

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
  "groups": [
    { "group_key": "11736", "samples": 12345, "on_time_pct": 78.4,
      "early_pct": 5.1, "late_pct": 16.5, "avg_delay_s": 92,
      "p50_delay_s": 30, "p90_delay_s": 540 }
  ]
}
```

Important: time-of-day and day-of-week filtering **must** be done in the
agency's local timezone, not UTC. Storage stays UTC (decision locked); the
worker computes the local offset per row at query time using
`agencies.timezone` (resolved via `Intl.DateTimeFormat` for DST-correct
offsets) before binding the SQL filter. No `local_ts_ms` denormalization.

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

1. **Schema + parse-queue change** (1 PR)
   - Add `delay_seconds` column + index (new migration).
   - In `parse-queue.ts`, build a per-batch cache:
     `Map<\`${version}|${trip_id}|${stop_seq}\`, scheduledMs>` populated by a
     single `SELECT ... WHERE trip_id IN (...)` per batch.
   - Compute delay; write to D1; also include in the Pipelines payload so the
     Iceberg archive has it too.
2. **Backfill job** (1 PR)
   - New worker route `POST /api/admin/backfill-delays?start_ms&end_ms` (auth
     gate via a secret header — see plan 04 for the pattern).
3. **API v2** (1 PR) — `/api/analysis/stats/ontime` with new params; keep old
   shape behind `?v=1` until UI is migrated.
4. **UI filter bar** (1 PR) — in `StatsView.tsx`, with URL-synced state.

## Open Questions

- Holidays — see plan 04 for the holiday calendar table proposal.
- Down the road: terminal-aware departure-vs-arrival logic (currently arrival
  is used for every stop; revisit if it produces noisy first-stop signal).
- Down the road: UI surfacing of the agency-level on-time window override
  (an admin form, not a per-query control).

## Acceptance Criteria

- [ ] User can filter on-time stats by `dow` subset + hour range + date range.
- [ ] Response includes true `on_time_pct`, `avg_delay_s`, `p50/p90`.
- [ ] All timing is computed in agency-local time.
- [ ] Bar charts in `StatsView.tsx` reflect the active filters.
- [ ] Backfill processes all existing rows or clearly skips them with a NULL
      flag that the UI handles.
