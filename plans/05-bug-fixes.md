# Plan 05 — Bug Fixes

Four reported bugs. Each is scoped to a minimal upstream fix.

## Decisions Locked (2026-05-24)

- **Bug 1 symptom confirmed**: page shows the literal "No stats yet — data
  accumulates over time" message. The frontend renders that text only when
  `byRoute.stats.length === 0` (`apps/web/src/components/StatsView.tsx:38-39`),
  which means the SQL `GROUP BY route_id` returns zero rows. Even an
  all-NULL-`route_id` table would produce one row, so the symptom rules out
  the "NULL route_id" hypothesis as a sole cause. The two remaining
  hypotheses are (a) `tu_stop_time_updates` is genuinely empty for the
  agency, and (b) **the bound `agency_id` doesn't match what the parser
  writes** (the route hard-codes `'mta-maryland'` as default —
  `apps/worker/src/routes/analysis.ts:378`).
- **Bug 3 confirmed at API layer**: ALL y-axis labels are stop IDs even when
  the corresponding `gtfs_stops.stop_name` exists. This is a backend-side
  join failure, not a frontend fallback edge case. Fix is to fold the
  lookup into the originating SQL as a `LEFT JOIN gtfs_stops` instead of a
  second `IN (...)` query, eliminating the silent `try/catch` and the D1
  parameter cap entirely.
- **Bug 4 fix uses SQLite bare-column MAX**, not correlated subqueries.
  D1 is on a SQLite version that returns the row at MAX/MIN when other
  columns are bare in `GROUP BY`; one index scan replaces the proposed
  per-vehicle subqueries.
- **Execution order**: Bug 4 (1 SQL change) → Bug 2 (layout, blocks visual
  inspection) → Bug 3 (API stop-name JOIN) → Bug 1 (paired with plan 01
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

The frontend message only fires when `byRoute.stats.length === 0`
(`apps/web/src/components/StatsView.tsx:38-39`). `GROUP BY route_id` against a
non-empty table always returns at least one row (NULL forms its own group),
so *the table or the agency filter is genuinely returning zero rows*.

Likely causes, in priority order:

1. **`agency_id` mismatch** between the API default (`'mta-maryland'`,
   `apps/worker/src/routes/analysis.ts:378`) and what the parser actually
   writes. This is the most likely cause given how often `agency_id` is
   hard-coded across the analysis routes. Verify with
   `SELECT DISTINCT agency_id, COUNT(*) FROM tu_stop_time_updates GROUP BY 1`.
2. **`tu_stop_time_updates` is genuinely empty** because trip-update parsing
   is silently failing. Check the parser output in
   `apps/worker/src/queues/parse-queue.ts:77-115`.
3. **`route_id` populated but always NULL** is *not* the cause of the
   observed symptom (it would produce one NULL-group row, not zero rows),
   but is still worth fixing for clean per-route reporting once the
   primary bug is unblocked. Confirm by querying
   `SELECT COUNT(*), COUNT(route_id) FROM tu_stop_time_updates`.

### Plan

1. Add a worker route `GET /api/admin/table-stats` returning per-table
   `COUNT(*)` AND `COUNT(*) GROUP BY agency_id` AND
   `COUNT(route_id) / COUNT(*)` so we can disambiguate all three hypotheses
   in a single page visit. Auth via the `X-Admin-Token` header introduced
   in plan 01 step 3.
2. **If agency_id mismatch** (most likely): pick whichever fix is correct
   for the deployment — either rename the seeded `agencies.agency_id`, or
   change the API default. Then thread an explicit agency selection through
   the UI as part of plan 02 Layer F follow-up.
3. **If null `route_id`**: fix the parser to copy `TripDescriptor.route_id`
   into the row and backfill via the admin endpoint.
4. **If empty table**: inspect a `.pb` snapshot from R2 via
   `apps/worker/src/routes/exports.ts` and re-run the parser locally with
   the existing Vitest setup (`apps/worker/test/`).
5. UX safety net: in `StatsView.tsx`, distinguish four states explicitly —
   *loading*, *zero rows for this agency*, *rows but route_id NULL*,
   *rows present* — and render a useful message in each.
6. Tests: `/api/admin/table-stats` snapshot test; `StatsView` render test
   per state.

### Acceptance

- [ ] `byRoute.stats` returns non-NULL route_ids in production for the
      currently-bound `agency_id`.
- [ ] StatsView shows the route table for the default agency on first load
      without requiring a route to be selected.
- [ ] `/api/admin/table-stats` exposes per-agency row counts so this class
      of bug is diagnosable in <30 seconds in the future.

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
2. Read the initial container width in a `useLayoutEffect` (not `useEffect`)
   so it's available on the first paint, then keep a `ResizeObserver` for
   subsequent resizes. The current symptom is partly driven by
   `state.width` defaulting to `800` and only being corrected after the
   first paint cycle.
3. Confirm by adding a temporary border on `<main>` and on the chart
   container to verify expansion; remove before commit.
4. Same fix applies to `StatsView.tsx` `BarChart` — its `width` is read once
   at effect time from `getBoundingClientRect()` and never updated on
   resize. Add a `ResizeObserver` there too. Extract a shared
   `useContainerWidth` hook (`apps/web/src/hooks/useContainerWidth.ts`) so
   both charts share the logic.
5. Tests: React Testing Library + a mocked `ResizeObserver` to verify the
   hook returns the container width on initial mount.

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

**Y axis (names) — the right fix is to JOIN, not chunk `IN()`:**

The current code runs the data query first, collects stop_ids, then runs a
separate `WHERE stop_id IN (?,?,?…)` lookup wrapped in a silent `catch {}`
(`apps/worker/src/routes/analysis.ts:240-257` and
`apps/worker/src/routes/analysis.ts:342-357`). The clean fix is to
**fold `gtfs_stops` into the originating query** and drop the second
statement entirely:

```sql
-- getStringlineData (route)
SELECT vp.vehicle_id, vp.ts_ms, vp.stop_id, s.stop_name,
       vp.current_stop_sequence, vp.lat, vp.lon,
       vp.current_status, vp.direction_id
FROM vp_points vp
LEFT JOIN gtfs_stops s
  ON s.agency_id = vp.agency_id AND s.stop_id = vp.stop_id
WHERE vp.route_id = ? AND vp.agency_id = ?
  AND vp.ts_ms BETWEEN ? AND ?
  [AND vp.direction_id = ?]
ORDER BY vp.vehicle_id, vp.ts_ms
LIMIT 10000
```

This eliminates:

- The silent `try/catch` swallowing errors.
- The D1 SQL-parameter cap (~100 placeholders) issue.
- A round-trip and the `Map<stop_id, stop_name>` plumbing.
- The conditional "only do the lookup if `stopOrder.length > 0`" branch.

Apply the same JOIN to `getRouteStops` and `getVehicleStringline`.

**Supporting steps:**

1. **Diagnose first**. As part of the Bug 1 admin endpoint, return
   `gtfs_stops` row counts grouped by `agency_id`. Confirms whether the
   table is populated for the relevant agency at all.
2. **Confirm the agency_id**. Run a quick D1 audit (e.g. `SELECT DISTINCT
   agency_id FROM gtfs_stops`) and reconcile against what the analysis
   routes bind. Normalize at the source if there's a mismatch — same
   underlying issue as Bug 1's hypothesis #1.
3. **If `gtfs_stops` is genuinely empty**, that's a pre-existing milestone
   gap (GTFS-static parsing); file a follow-up but ship the JOIN fix so
   it works the moment static data lands.
4. **Frontend dim-fallback**: when the API genuinely returns `stop_name ===
   stop_id` (or NULL via the LEFT JOIN), render the label muted so the user
   can spot it. Low priority compared to fixing the API.
5. Tests: vitest snapshot of the JOIN-based response on a fixture where
   half the stops have names and half don't.

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
- [ ] No silent `catch {}` remains around the stop-name lookup; the
      response either has names or has a documented null fallback.
- [ ] Tests: snapshot test for the JOIN response shape; visual regression
      test for x-axis tick density at three ranges.

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

Use SQLite's **bare-column MAX/MIN** behavior: when a query has
`MAX(col_x)` and other columns are bare in `GROUP BY`, SQLite returns the
values of those bare columns *from the row that produced the MAX*
([SQLite docs, since 3.7.11](https://www.sqlite.org/lang_select.html#bareagg)).
D1 is on a SQLite version that supports this. The fix is one query, one
index scan over the existing `idx_vp_points_agency_vehicle_ts`
(`apps/worker/migrations/0000_init.sql:80`):

```sql
SELECT vehicle_id,
       route_id,
       direction_id,
       MAX(ts_ms) AS last_seen_ms
FROM vp_points
WHERE agency_id = ? AND ts_ms >= ?
GROUP BY vehicle_id
ORDER BY last_seen_ms DESC
LIMIT 5000
```

No correlated subqueries, no window functions, no DISTINCT-tuple bug.

Surface `last_seen_ms` in the dropdown label
(`Vehicle 1234 — Route 22 (8m ago)`) so the user can spot stale entries.

Tests: vitest fixture with a vehicle that runs both directions in the
window; assert the result row shows the most recent direction.

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
