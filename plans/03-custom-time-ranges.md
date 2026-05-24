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
  agencyTimezone: string   // for label rendering
}
```

UI shape:

- Top row: existing relative pills `1h / 2h / 4h / 8h / 12h / 24h` plus a
  single `Custom…` pill at the end.
- Clicking `Custom…` reveals two `<input type="datetime-local">` controls
  plus a timezone label showing "agency time (e.g. America/New_York)".
- All custom inputs are interpreted in agency-local time, then converted to
  UTC `since_ms` / `until_ms` for the API call.

### 2. Push absolute ranges all the way to the API

Update `AnalysisPanel.tsx` to compute and pass both `since_ms` **and**
`until_ms` (today only `since_ms` is passed; `until_ms` defaults to
`Date.now()`). This way "Yesterday" doesn't accidentally include "today" data.

### 3. Backend hardening for arbitrary ranges

Long ranges break the implicit `LIMIT 10000`. **Hard-cap and warn** is the
locked policy:

- Replace the fixed `LIMIT 10000` with an explicit `MAX_ROWS = 50_000`
  constant.
- Run the SQL with `LIMIT MAX_ROWS + 1` and detect overflow.
- Always return a structured envelope:
  ```json
  {
    "vehicles": { ... },
    "stops": [ ... ],
    "truncated": true,
    "rows_returned": 50000,
    "max_rows": 50000,
    "hint": "Range is too wide; narrow it or generate a report"
  }
  ```
- The UI shows a yellow banner above the chart whenever `truncated === true`,
  with a “Generate report” button that pre-fills the plan-04 form for the
  same range/route.

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
   relative-pill behavior). [1 PR]
2. Plumb `untilMs` through `AnalysisPanel.tsx` and the API calls. [1 PR]
3. Replace fixed `LIMIT 10000` in `analysis.ts` with window-aware caps + a
   `truncated` flag in the response. Update `StringlineChart` to surface
   "Truncated — showing first N points". [1 PR]
4. Add URL sync via `useUrlState`. [1 PR]
5. Wire to plan 04 reports for cold ranges. [follow-up]

## Acceptance Criteria

- [ ] Custom date+time pickers work in both Route and Vehicle tabs.
- [ ] Picking yesterday's local 00:00 → 23:59 in the Custom… picker
      produces a chart that contains zero of "today's" data.
- [ ] A 7-day range returns either complete data (within `MAX_ROWS`) or a
      `truncated: true` envelope; the UI surfaces a yellow banner with a
      "Generate report" CTA when truncated.
- [ ] URL is shareable.
- [ ] Out-of-hot-cache ranges produce a clean fallback (CTA → report), not
      an empty chart.

## Open Questions

- Default end of range: `now()` or "now rounded down to the minute"? Going
  with "now" is fine.
- (Deferred) Named presets like "Yesterday" / "Last 7 days" — reconsider
  after we see custom-range usage.
