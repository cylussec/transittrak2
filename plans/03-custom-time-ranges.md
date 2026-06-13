# Plan 03 — Custom / Arbitrary Date Ranges on Route Analysis

## Decisions Locked (2026-05-24)

- **Keep existing pills**: `1h / 2h / 4h / 8h / 12h / 24h` stay; add a single
  `Custom…` pill that opens absolute datetime pickers. No "Yesterday" /
  "Last 7 days" presets in v1 (revisit later if useful).
- **Big ranges**: **hard-cap and warn**, do not silently downsample. Response
  carries `{ truncated: true, rows_returned, max_rows, hint }` and the UI
  banner reads “Showing first N of M; narrow your range or generate a report.”
- **Cold ranges**: defer to plan 04 reports; the picker shows the CTA.

## Problem / Goal

The Route Analysis tab currently only supports six fixed look-backs:
`1h, 2h, 4h, 8h, 12h, 24h`. The user wants:

- "Show me last Saturday between 6 AM and 10 PM."
- "Show me Aug 1 2026 – Aug 7 2026."
- "Show me **yesterday** without doing math in my head."

This applies to both the **route stringline** and the **vehicle stringline**.

## Current State (citations)

- Time-range pills: `apps/web/src/components/AnalysisPanel.tsx:158-169`.
- `hoursBack` state drives `sinceMs` via
  `Date.now() - hoursBack * 60 * 60 * 1000` (`AnalysisPanel.tsx:24,34`).
- Backend already accepts arbitrary `since_ms` / `until_ms`:
  - `apps/worker/src/routes/analysis.ts:211-212` (route stringline)
  - `apps/worker/src/routes/analysis.ts:302-303` (vehicle stringline)
- The backend caps each query at `LIMIT 10000` rows
  (`analysis.ts:225, 311`). That's a 24h × ~7 vehicles × 60s ≈ 10k ceiling —
  longer windows will silently truncate.

## Proposed Approach

### 1. Replace the pill row with a `TimeRangePicker` component

A single new component `apps/web/src/components/TimeRangePicker.tsx` exposes:

```ts
type TimeRange =
  | { kind: 'relative'; hoursBack: number }
  | { kind: 'absolute'; sinceMs: number; untilMs: number }

interface Props {
  value: TimeRange
  onChange: (next: TimeRange) => void
  agencyTimezone: string   // for label rendering AND input ↔ ms conversion
}
```

UI shape:

- Top row: existing relative pills `1h / 2h / 4h / 8h / 12h / 24h` plus a
  single `Custom…` pill at the end.
- Clicking `Custom…` reveals two `<input type="datetime-local">` controls
  plus a timezone label showing "agency time (e.g. America/New_York)".

#### 1a. Browser-tz ↔ agency-tz conversion (important)

`<input type="datetime-local">` reads/writes wall-clock time in the **browser's**
local time zone, not the agency's. If a user in PT picks `2026-08-01 06:00`
for an ET agency, the API must receive 06:00 ET (= 10:00 UTC), not 06:00 PT
(= 13:00 UTC). The `TimeRangePicker` is responsible for this conversion:

```ts
// agency wall-clock 'YYYY-MM-DDTHH:mm' string → epoch ms
function localToMs(local: string, tz: string): number {
  // Parse the wall-clock as if it were UTC, then subtract the agency's
  // UTC offset for THAT instant (DST-correct via Intl).
  const naiveUtc = Date.parse(local + ':00Z')
  const offsetMs = getTzOffsetMs(naiveUtc, tz) // via Intl.DateTimeFormat 'longOffset'
  return naiveUtc - offsetMs
}

// epoch ms → agency wall-clock 'YYYY-MM-DDTHH:mm' string for the input value
function msToLocal(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ms))
  const get = (t: string) => parts.find(p => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}
```

The input value displayed to the user is always agency-local; the value
persisted to URL state and the API is always UTC ms. Vitest must cover
DST-boundary days (e.g. picking 02:30 on a spring-forward day collapses to
03:30 — confirm the code matches user expectation).

### 2. Push absolute ranges all the way to the API

Update `AnalysisPanel.tsx` to compute and pass both `since_ms` **and**
`until_ms` (today only `since_ms` is passed; `until_ms` defaults to
`Date.now()`). This way "Yesterday" doesn't accidentally include "today" data.

### 3. Backend hardening for arbitrary ranges

Long ranges break the implicit `LIMIT 10000` and risk hitting D1's response
size limits (~10 MB JSON per request). **Hard-cap and warn** is the locked
policy, but the cap must be applied per-vehicle so the chart isn't biased.

Problem with naive `LIMIT N`: today the SQL is
`ORDER BY vehicle_id, ts_ms LIMIT 10000`
(`apps/worker/src/routes/analysis.ts:225`). With a 7-day, 50-vehicle range
and a 50K row cap, you return *all data for the first ~10 vehicles
alphabetically and zero data for the rest* — the user sees a chart of
"10 vehicles for 7 days" and assumes the route only had 10 vehicles.

**Fix:** stride sample per vehicle, not lex-truncate.

- Compute a target `STRIDE_S` such that the expected row count fits inside
  `MAX_ROWS = 50_000`: `STRIDE_S = max(60, ceil(span_s * estimated_vehicles / MAX_ROWS))`.
  60s is the natural feed cadence; never sample finer than that.
- Use the modulo trick directly in SQL (works on D1):
  ```sql
  SELECT ... FROM vp_points
  WHERE ... AND ts_ms / 1000 % ? = 0   -- ? = STRIDE_S
  ORDER BY vehicle_id, ts_ms
  LIMIT 50001
  ```
  This drops to one ping per `STRIDE_S` per vehicle, deterministically and
  uniformly across all vehicles in the window.
- Run with `LIMIT MAX_ROWS + 1` and detect overflow. Always return a
  structured envelope:
  ```json
  {
    "vehicles": { ... },
    "stops": [ ... ],
    "truncated": true,
    "rows_returned": 50000,
    "max_rows": 50000,
    "stride_s": 120,
    "response_bytes_estimate": 9123456,
    "hint": "Showing one ping per 120 s; narrow your range or generate a report"
  }
  ```
- The UI banner explains the stride ("Sampled at 1 ping / 2 min") so users
  know the chart is a downsample, not a truncation that drops vehicles.
  When the per-vehicle stride hits 60s and we still overflow, fall back to
  truncation with a stronger banner that says exactly which vehicles were
  dropped.

Also enforce a soft byte cap: estimate ~200 bytes/row and refuse to bind a
`MAX_ROWS` that would exceed ~8 MB JSON, regardless of the user's request.

### 4. URL state

Reflect the chosen range in the URL hash so links can be shared:
`#/analysis/route?route=11736&since=...&until=...&mode=outbound`.

Use a tiny custom hook `useUrlState<T>(key, parse, serialize)` rather than
adding a routing dependency.

### 5. Read from cold storage if needed

If the requested range falls outside D1's hot window (see plan 02), the
backend should:

- Return a clearly-typed response `{ status: 'cold', report_id: '...', }`
  indicating the user should consume the result via the reports system
  (plan 04).
- The UI shows a "This range exceeds the hot cache; generate a report" CTA
  that creates a one-click report.

## Implementation Steps

1. Build `TimeRangePicker.tsx` (frontend only, defaults to current
   relative-pill behavior). Includes the agency-tz conversion helpers from
   §1a. Tests: vitest for `localToMs` / `msToLocal` round-trips on a DST
   spring-forward and fall-back day in two different agency timezones. [1 PR]
2. Plumb `untilMs` through `AnalysisPanel.tsx` and the API calls. [1 PR]
3. Replace fixed `LIMIT 10000` in `analysis.ts` with the per-vehicle stride
   sampler and a `truncated` / `stride_s` flag in the response. Update
   `StringlineChart` to surface "Sampled at 1 ping / N min". Tests: a
   simulated 7-day range with 50 vehicles returns all 50 vehicles in the
   response (the bias regression test). [1 PR]
4. Add URL sync via `useUrlState`. [1 PR]
5. Wire to plan 04 reports for cold ranges. [follow-up]

## Acceptance Criteria

- [ ] Custom date+time pickers work in both Route and Vehicle tabs and
      interpret the user's input in **agency-local** time regardless of the
      browser's tz.
- [ ] Picking yesterday's agency-local 00:00 → 23:59 in the Custom… picker
      produces a chart that contains zero of "today's" data, even when the
      browser is in a different tz than the agency.
- [ ] A 7-day range returns either complete data (within `MAX_ROWS`), a
      uniformly-sampled response (`stride_s > 60`), or a hard-truncated
      response with an explicit dropped-vehicles banner. The UI never
      silently drops vehicles.
- [ ] Response bytes never exceed the soft 8 MB cap.
- [ ] URL is shareable.
- [ ] Out-of-hot-cache ranges produce a clean fallback (CTA → report), not
      an empty chart.
- [ ] Vitest covers DST round-trips in `TimeRangePicker` and the
      per-vehicle stride sampler in `analysis.ts`.

## Open Questions

- Default end of range: `now()` or "now rounded down to the minute"? Going
  with "now" is fine.
- (Deferred) Named presets like "Yesterday" / "Last 7 days" — reconsider
  after we see custom-range usage.
