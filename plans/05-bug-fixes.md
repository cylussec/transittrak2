# Plan 05 — Bug Fixes

Four reported bugs. Each is scoped to a minimal upstream fix.

## Decisions Locked (2026-05-24)

- **Bug 1 symptom confirmed**: page shows the literal "No stats yet — data
  accumulates over time" message. So the API is reachable and returns an
  empty `stats` array. Investigation must confirm whether
  `tu_stop_time_updates` is empty or just has NULL `route_id`.
- **Bug 3 confirmed at API layer**: ALL y-axis labels are stop IDs even when
  the corresponding `gtfs_stops.stop_name` exists. This is a backend-side
  join failure, not a frontend fallback edge case. The fix focuses on
  `analysis.ts` first; the frontend changes (truncation, dim styling) are
  follow-ups.
- **Execution order**: Bug 4 (1-line SQL) → Bug 2 (layout, blocks visual
  inspection) → Bug 3 (API stop-name join) → Bug 1 (paired with plan 01
  diagnostic endpoint).

---

## Bug 1 — Analysis → Stats always says "No stats yet"

### Symptom (confirmed)

Visiting **Analysis → Stats** shows the literal `"No stats yet — data
accumulates over time"` message even after weeks of ingestion. The API is
responding successfully with an empty `stats` array.

### Likely Root Causes

`StatsView` fires three queries via `useFetch` (see
`apps/web/src/components/StatsView.tsx:21-29`):

1. `/api/analysis/stats/ontime?group_by=route` (always)
2. `/api/analysis/stats/ontime?group_by=hour&route_id=...` (only when a route
   is selected)
3. `/api/analysis/stats/ontime?group_by=dow&route_id=...` (only when a route
   is selected)

The "route summary" table reads `byRoute.stats` (see
`StatsView.tsx:38-39`). The backend SQL (`apps/worker/src/routes/analysis.ts:413-426`)
is:

```sql
SELECT route_id,
  COUNT(*) as total_updates,
  COUNT(DISTINCT trip_id) as unique_trips,
  MIN(ts_ms) as first_update_ms,
  MAX(ts_ms) as last_update_ms
FROM tu_stop_time_updates
WHERE agency_id = ?
GROUP BY route_id
```

Two plausible causes:

1. **`route_id` is NULL in every row** because the parser doesn't pull it
   from `TripDescriptor.route_id`. Then `GROUP BY route_id` returns one row
   with `route_id = NULL` — which the UI maps to a blank table cell, not a
   "no rows" state… but the user perceives it as empty.
2. **`tu_stop_time_updates` is genuinely empty** because trip-update parsing
   is silently failing. Check the parser output in
   `apps/worker/src/queues/parse-queue.ts:77-115`.

### Plan

1. Add a worker route `GET /api/admin/table-stats` returning `COUNT(*)` per
   D1 table; visit it in the browser to confirm whether
   `tu_stop_time_updates` has data and how many rows have `route_id IS NULL`.
2. If null `route_id`: fix the parser to copy `TripDescriptor.route_id` into
   the row (and backfill via the new admin endpoint).
3. If empty table: inspect a `.pb` snapshot from R2 directly via
   `apps/worker/src/routes/exports.ts` and re-run the parser locally with the
   existing Vitest setup (`apps/worker/test/`).
4. UX safety net: in `StatsView.tsx`, distinguish three states explicitly —
   *loading*, *zero rows*, *rows but route_id NULL* — and render a useful
   message in each.

### Acceptance

- [ ] `byRoute.stats` returns non-NULL route_ids in production.
- [ ] StatsView shows the route table for the default agency on first load
      without requiring a route to be selected.

---

## Bug 2 — Analysis main content doesn't expand to fill its area

### Symptom

In the screenshot the stringline chart occupies a narrow column inside the
`<main>` area, leaving a large empty pane to its right. Affects all
Analysis sub-tabs.

### Root Cause

`apps/web/src/components/AnalysisPanel.tsx:189`:

```tsx
<main className="flex-1 bg-gray-950 overflow-y-auto p-6">
```

This is fine. But the chart container in
`apps/web/src/components/StringlineChart.tsx:200-204`:

```tsx
<div ref={containerRef} className="w-full overflow-x-auto bg-gray-900 rounded-lg">
  <svg ref={svgRef} className="min-w-[600px] block" />
</div>
```

Sizes the **SVG** explicitly with an inner `<g>` of `width = state.width`.
`state.width` starts at `800` and is updated via `ResizeObserver`. If the
first observed width is set before the layout has settled (or the SVG forces
an inner scroll), the SVG never grows to fill the container.

Additionally, `min-w-[600px]` *on the SVG* combined with `overflow-x-auto`
*on the parent* gives the parent a horizontal scrollbar that visually shrinks
the apparent SVG width on first paint.

### Plan

1. Make the chart's effective width track the **container** rather than the
   SVG's intrinsic minimum. Move `min-w-[600px]` to the *parent* div and let
   the SVG be `width="100%"`-style via the existing `width` state — and
   ensure `state.width` is **always** at least `containerRef.current.clientWidth`
   on each mount.
2. Confirm by adding a temporary border on `<main>` and on the chart container
   to verify expansion; remove before commit.
3. Same fix applies to `StatsView.tsx` `BarChart` — its `width` is read once
   at effect time from `getBoundingClientRect()` and never updated on
   resize. Add a `ResizeObserver` there too (extract a `useContainerWidth`
   hook so both charts share the logic).

### Acceptance

- [ ] Stringline + StatsView charts fill the available width of `<main>`.
- [ ] Resizing the browser window updates the chart width without a
      refresh.
- [ ] No horizontal scrollbar appears unless the chart genuinely needs more
      pixels than the container has.

---

## Bug 3 — Stringline: y-axis shows stop IDs, x-axis is too cramped

### Symptom (confirmed)

- **All** y-axis labels are stop_ids (e.g. `11797`) even though `gtfs_stops`
  has `stop_name` rows for those IDs. The frontend fallback in
  `StringlineChart.tsx:101-106` is firing for every stop, which means the
  API never sent us the names.
- The x-axis is unreadable for longer time ranges (ticks overlap).

### Root Cause

**Y axis (the real issue)**: `getStringlineData` in
`apps/worker/src/routes/analysis.ts:202-277` builds the `stops` array, then
tries to fill in names via:

```ts
await db.prepare(`
  SELECT stop_id, stop_name FROM gtfs_stops
  WHERE agency_id = ? AND stop_id IN (...)
`).bind(agencyId, ...stopOrder).all()
```

The `try/catch` swallows any error and silently leaves `stopNames` empty. For
every stop, the response then returns `stop_name = stop_id`. Likely culprits:

1. **D1 has a SQL parameter limit** (~100 placeholders per statement). For a
   long route with > ~100 stops the `IN (?,?,?,...)` query throws and the
   `catch` eats it.
2. The `agency_id` filter doesn't match what's in `gtfs_stops` (e.g.
   `'mta-maryland'` vs `'mta-maryland-local-bus'`). Verify in D1 with a
   small admin query.
3. The `gtfs_stops` table itself was never populated for that agency —
   GTFS-static parsing is listed as pending in `SPEC.md:251-258`.

**X axis**: `StringlineChart.tsx:90-98` hard-codes `d3.timeMinute.every(15)`.
For a 24h window that yields 96 ticks; for a 7-day window (after plan 03)
it would yield ~672 ticks.

### Plan

**Y axis (names) — do all of these:**

1. **Diagnose first**. As part of the Bug 1 admin endpoint, return
   `gtfs_stops` row counts grouped by `agency_id`. Confirm whether the
   table is populated for the relevant agency at all.
2. **Stop swallowing the error**. In `analysis.ts` (both
   `getStringlineData:240-256` and `getRouteStops:177-193`), remove the
   silent `catch {}`. Log to the console and add a `_stop_name_lookup_error`
   field on the response so the issue is visible during dev.
3. **Fix the IN()-batching**. Chunk the lookup into groups of ≤90 stop_ids
   per query (D1 SQL parameter cap). Merge results into the same
   `stopNames` map.
4. **Confirm the agency_id**. Run a quick D1 audit (e.g. `SELECT DISTINCT
   agency_id FROM gtfs_stops`) and reconcile against what `getStringlineData`
   binds. Normalize at the source if there's a mismatch.
5. **If `gtfs_stops` is genuinely empty**, that's a pre-existing milestone
   gap (GTFS-static parsing); file a follow-up but ship the lookup fix so
   it works the moment static data lands.
6. **Frontend dim-fallback**: when the API genuinely returns `stop_name ===
   stop_id`, render the label muted so the user can spot it. Low priority
   compared to fixing the API.

**X axis (ticks):**

Replace the hard-coded interval with one chosen from the time span:

```ts
const spanMs = data.until_ms - data.since_ms
const tickInterval =
  spanMs <= 2 * 3600_000   ? d3.timeMinute.every(5)
  : spanMs <= 6 * 3600_000 ? d3.timeMinute.every(15)
  : spanMs <= 24 * 3600_000 ? d3.timeHour.every(1)
  : spanMs <= 72 * 3600_000 ? d3.timeHour.every(3)
  :                            d3.timeHour.every(6)

const tickFormat =
  spanMs <= 24 * 3600_000 ? d3.timeFormat('%-I:%M %p')
                          : d3.timeFormat('%a %-I %p')
```

Also: rotate x-axis labels -30° when there are >12 ticks to avoid overlap, or
use `tickValues` to skip every other label at narrow widths.

### Acceptance

- [ ] No numeric stop IDs appear on the y-axis for any route with GTFS
      static loaded.
- [ ] X-axis ticks are readable for 1h, 6h, 24h, and (post plan 03) 7-day
      ranges.

---

## Bug 4 — Duplicate vehicles in Analysis → Vehicle

### Symptom

The vehicle dropdown lists the same `vehicle_id` multiple times.

### Root Cause

`apps/worker/src/routes/analysis.ts:285-291`:

```sql
SELECT DISTINCT vehicle_id, route_id, direction_id
FROM vp_points
WHERE agency_id = ? AND ts_ms >= ?
ORDER BY vehicle_id
LIMIT 5000
```

`DISTINCT` applies to the **tuple** `(vehicle_id, route_id, direction_id)`.
A vehicle that ran outbound (dir=0) then inbound (dir=1), or that switched
routes during the window, appears multiple times.

### Plan

Replace the SQL with one row per `vehicle_id`, keeping the most-recent
`route_id` / `direction_id`:

```sql
SELECT vehicle_id,
       (SELECT route_id      FROM vp_points p2
          WHERE p2.agency_id = vp.agency_id
            AND p2.vehicle_id = vp.vehicle_id
            AND p2.ts_ms >= ?
          ORDER BY p2.ts_ms DESC LIMIT 1) AS route_id,
       (SELECT direction_id  FROM vp_points p2
          WHERE p2.agency_id = vp.agency_id
            AND p2.vehicle_id = vp.vehicle_id
            AND p2.ts_ms >= ?
          ORDER BY p2.ts_ms DESC LIMIT 1) AS direction_id,
       MAX(ts_ms) AS last_seen_ms
FROM vp_points vp
WHERE agency_id = ? AND ts_ms >= ?
GROUP BY vehicle_id
ORDER BY last_seen_ms DESC
LIMIT 5000
```

(Or simpler if SQLite cooperates: `GROUP BY vehicle_id` with a window function
fallback.)

Surface `last_seen_ms` in the dropdown label
(`Vehicle 1234 — Route 22 (8m ago)`) so the user can spot stale entries.

### Acceptance

- [ ] Each `vehicle_id` appears at most once in the dropdown.
- [ ] The displayed route/direction matches the vehicle's most recent ping.
- [ ] Sort order is "most recently seen first" for fastest selection.

---

## Suggested Execution Order (locked)

1. **Bug 4** — 1-line SQL change, immediate user-visible win.
2. **Bug 2** — layout, affects everything else you're about to look at.
3. **Bug 3** — API stop-name join + axis density. Bigger than originally
   scoped because the backend is at fault.
4. **Bug 1** — stats. Diagnose with the admin endpoint introduced in plan 01
   step 2; same fix lands either as a parser bug or a UI message-state
   improvement.
