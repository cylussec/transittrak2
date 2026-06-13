# Plan 04 — Long-Running Reports & Findings

## Decisions Locked (2026-05-24)

- **v1 report kinds (4)**: `route_ontime_summary`, `schedule_compare`,
  `stop_bottlenecks`, `headway_analysis`. Order of build:
  ontime_summary → schedule_compare → stop_bottlenecks → headway_analysis.
- **v2 report kinds (deferred, but listed in §4 for reference)**:
  `holiday_compare` (depends on plan 04 holiday calendar),
  `vehicle_reliability` (depends on plan 02 dim tables for cheap per-vehicle
  aggregation). The §4 table is the spec; the implementation order below is
  the build queue. They are intentionally different lengths.
- **Prose**: **template-based by default**, with a per-report
  “✨ Enhance with AI” button that re-renders the interpretation +
  findings via Workers AI. Template output is always cached so the report
  detail page never depends on the LLM being available.
- **Concurrency**: cap at `MAX_CONCURRENT_REPORTS = 3` via the **Workers
  Queues consumer `max_concurrency`** setting on the new
  `transittrack-reports` queue. No DO semaphore — we don't need cross-report
  state and a DO that holds an in-memory counter would lose it on hibernation
  anyway. (See §3 for details.)
- **Retention**: auto-prune unpinned reports after **90 days** (row + R2
  artifacts). Pinning is a per-report flag (`pinned INTEGER DEFAULT 0`).

## Problem / Goal

The user wants the ability to ask questions whose answers require minutes of
computation over months of data — e.g.:

- "On-time % of Routes 22 + 24 + 26 over the last 3 months."
- "Which stop on Route 11736 most consistently runs behind schedule?"
- "Compare weekday vs weekend performance on Route 22 for 2026."
- "Holiday vs non-holiday performance on the CityLink lines."

And the user wants more than a number: each report should have

1. **Here are the stats**,
2. **Here's what they mean** (plain-English explanation), and
3. **Here's an interesting thing I found** (anomaly / insight).

## Current State (citations)

- No reports system exists. The only analytical endpoints today are
  `/api/analysis/*` in `apps/worker/src/routes/analysis.ts`, all synchronous
  and bounded by D1 query time.
- The Worker runtime has a strict CPU budget per request, so long scans must
  be off-loaded to async infra (Queue + DO).
- Pipelines/Iceberg holds the full archive — see plan 02 for the query path.

## Proposed Approach

### 1. New `reports` domain in D1

```sql
CREATE TABLE reports (
  report_id      TEXT PRIMARY KEY,           -- ulid
  kind           TEXT NOT NULL,              -- e.g. 'route_ontime_summary'
  status         TEXT NOT NULL,              -- queued | running | done | failed
  agency_id      TEXT NOT NULL,
  params_json    TEXT NOT NULL,              -- inputs (routes, date range, etc.)
  result_json    TEXT,                       -- structured findings (when done)
  ai_summary     TEXT,                       -- LLM-rewritten prose, on demand
  ai_summary_at_ms INTEGER,                  -- when the LLM was last run
  pinned         INTEGER NOT NULL DEFAULT 0, -- 1 = exempt from auto-prune
  error          TEXT,
  requested_by   TEXT,                       -- user/session id (future)
  created_ms     INTEGER NOT NULL,
  started_ms     INTEGER,
  completed_ms   INTEGER
);
CREATE INDEX idx_reports_status_created ON reports (status, created_ms);
CREATE INDEX idx_reports_agency_kind ON reports (agency_id, kind);
CREATE INDEX idx_reports_pinned_created ON reports (pinned, created_ms);
```

Large outputs (charts, CSV exports) go to R2 under
`reports/{report_id}/...` and `result_json` references the keys.

### 2. Worker endpoints

```
POST   /api/reports                         -> { report_id, status: 'queued' }
  body: { kind, agency_id, params }
GET    /api/reports/:id                     -> { ...report row, result_json }
GET    /api/reports?status=&kind=&limit=    -> list
DELETE /api/reports/:id                     -> cleanup R2 + row
POST   /api/reports/:id/pin                 -> body { pinned: true|false }
POST   /api/reports/:id/enhance             -> kicks an LLM rewrite, fills ai_summary
```

### 3. Execution: Queue consumer + per-report chunking

Add a new queue `transittrack-reports` with the consumer configured for
`max_concurrency: 3` in `wrangler.jsonc`. **No Durable Object.** The Cloudflare
Queues runtime enforces the cap; if we ever need to revisit, the queue config
is the only knob to turn. (Originally specced as a DO semaphore; rejected
because an in-memory counter doesn't survive DO hibernation, and DO storage
adds complexity for state that the queue runtime already provides.)

The consumer routes each message by `kind` to a handler module under
`apps/worker/src/reports/`:

```
apps/worker/src/reports/
  index.ts                  // registry { kind -> handler }
  runner.ts                 // queue consumer
  ontime_summary.ts
  stop_bottlenecks.ts
  schedule_compare.ts       // weekday vs weekend, holiday vs not, etc.
  headway_analysis.ts
```

#### 3a. Workers CPU/subrequest budget

A Worker handler has a per-request CPU wall-time (~30 s on paid) and a
per-request subrequest cap (~1000 D1 statements). A 90-day
`route_ontime_summary` over `tu_stop_time_updates` (post plan 02 Layer B
rollups) is roughly:

- 1 query for the hour-of-day rollup over 90×24=2160 buckets,
- 1 query for the dow rollup over 7 buckets,
- 1 query per detector (§5) — ~5 detectors.

That fits comfortably in a single request **for the rollup-served metrics**.
Any report that needs raw-row scans (percentiles, custom time-of-day
intersections) must chunk:

- The handler computes a list of `(start_ms, end_ms)` sub-windows.
- For each sub-window it streams a partial result into
  `R2://reports/{report_id}/partials/{idx}.json`.
- The handler self-reschedules via `env.REPORTS_QUEUE.send({ report_id,
  resume_from_idx })` when it has used >20 s of CPU on the current invocation.
- A final "merge" message coalesces all partials into `result_json` + R2
  artifacts and flips status to `done`.

The v1 kinds (rollup-friendly metrics only) ship without chunking; chunking
lands as part of the handler-framework work in step 1 so we don't have to
refactor when the first raw-scan report arrives.

#### 3b. Worked example budget (route_ontime_summary, 90 days, 1 route)

| Step | Subrequests | Wall-time est |
|------|-------------|----------------|
| Read rollup `tu_route_dow_hour_stats` for `(agency, route, [t0,t1])` | 1 | <50 ms |
| Read rollup `tu_route_hour_stats` weekly trend (90/7=13 weeks) | 1 | <50 ms |
| 5 detectors (each 1 D1 query against rollups) | 5 | <250 ms |
| Render template prose | 0 | <10 ms |
| Write `result_json` to D1 + (optional) CSV to R2 | 2 | <100 ms |
| **Total** | **9** | **<500 ms** |

Well under the limits; revisit when reports start scanning raw rows.

Each handler returns:

```ts
interface ReportResult {
  headline: string                 // 1-sentence summary
  stats: Record<string, number>    // raw numbers (on_time_pct, samples, …)
  charts: Array<{                  // optional, rendered server-side or by UI
    type: 'bar' | 'line' | 'heatmap'
    title: string
    data: unknown                  // shape per chart type
  }>
  interpretation: string           // “what this means” paragraph
  findings: Array<{                // “anomaly hunter” block
    severity: 'info' | 'warn' | 'alert'
    title: string
    detail: string
    evidence?: unknown             // pointer into the data
  }>
  csv_r2_key?: string              // for downloads
}
```

### 4. The first set of report `kind`s

| kind | Inputs | Stats | Chart(s) | Anomaly checks |
|------|--------|-------|----------|----------------|
| `route_ontime_summary` | route_ids[], date range | on_time_pct, early/late split, p50/p90 delay, n_samples | weekly trend line, hour-of-day heatmap | weeks with on_time_pct < (avg-10pts); worst hour of day |
| `stop_bottlenecks` | route_id, date range | per-stop avg delay added vs previous stop | bar chart of "delay added per stop" | top 3 stops where vehicles consistently fall behind schedule |
| `schedule_compare` | route_id, two date filters (e.g. weekday vs weekend) | side-by-side on_time_pct, delay distribution, headway | grouped bar | "Saturday outperforms weekdays by X pts on this route" |
| `holiday_compare` | route_id, year | holiday vs normal day metrics | bar | "Service appears reduced on Thanksgiving (X% fewer trips)" |
| `headway_analysis` | route_id, direction, date range | mean/std headway, bunching count (headway < 0.5×scheduled), gaps (headway > 1.5×scheduled) | headway-over-time scatter | "Bunching rate is 3× higher between 5–6 PM" |
| `vehicle_reliability` | agency_id, date range | per-vehicle: trips operated, no-show rate, avg lateness | table | vehicles that disappear mid-trip frequently |

### 5. Picking interesting findings (the "I found this when I dug in" part)

Each handler runs a small set of **rule-based detectors** *after* computing
the base stats:

- **Stop drift**: stop where `(delay at stop) − (delay at previous stop)` is in
  the top 5% of all stop pairs on the route, with > 200 samples.
- **Time-of-day collapse**: an hour bucket whose on-time % is > 15 points
  below the route average.
- **Weekend / weekday gap**: > 10-point difference between weekday and weekend
  on-time %.
- **Trend break**: a week whose on-time % moved > 2σ from the trailing
  8-week mean (cheap CUSUM-style detector).
- **Bunching cluster**: ≥ 3 consecutive headways below 50% of scheduled.

Detectors live in `apps/worker/src/reports/detectors.ts` and are unit-tested
independently of the SQL.

### 6. Frontend

Add a new top-level tab `Reports` (or a sub-tab under Analysis). Three views:

- **Build a report** — kind picker → param form → "Run". Saves to history.
- **History** — list of reports with status, run-time, links.
- **Report detail** — renders `ReportResult`: headline, stats grid, charts,
  prose interpretation, and a "Findings" stack of color-coded callouts.

Report detail pages are sharable (URL = `/reports/{id}`).

### 7. Holiday calendar

A small new table:

```sql
CREATE TABLE holidays (
  agency_id TEXT NOT NULL,
  date_local TEXT NOT NULL,            -- 'YYYY-MM-DD' in agency tz
  name TEXT NOT NULL,
  observed INTEGER NOT NULL DEFAULT 1, -- 0 = listed but not observed
  reduced_service INTEGER NOT NULL DEFAULT 0, -- agency hint
  PRIMARY KEY (agency_id, date_local)
);
```

Seeded with US federal holidays plus any agency-specific service-reduction
days the agency publishes. Used by plan 01 and `schedule_compare` /
`holiday_compare` reports.

**Date-to-ms conversion:** `date_local` is in agency tz, so converting to a
UTC `[since_ms, until_ms]` window for SQL filtering uses the same
`Intl.DateTimeFormat(tz)` helper introduced in plan 01 §2 / plan 03 §1a. Pull
that helper into `apps/worker/src/lib/agency-time.ts` so all three plans
consume one implementation.

## Implementation Order

1. `reports` table + endpoints + queue consumer (with `max_concurrency: 3`
   in `wrangler.jsonc`) + handler-framework (chunking helper from §3a).
   Hard-code `kind: 'route_ontime_summary'` running on D1 only. Template
   prose only. Tests: queue consumer fanout, chunked-resume happy path.
2. Frontend "Build a report" + history + detail viewer + pin button.
3. Detector framework + first 3 detectors (stop drift, TOD collapse,
   weekend/weekday gap). Tests: each detector against a synthetic dataset.
4. `schedule_compare` report (uses plan 01 filters internally).
5. `stop_bottlenecks` report.
6. `headway_analysis` report.
7. “Enhance with AI” button + Workers AI integration. Cache the result in
   `ai_summary` so re-renders are free.
8. **Auto-prune cron** (daily): delete `status='done' AND pinned=0 AND
   completed_ms < now() - 90d` rows + their R2 artifacts. Piggyback on the
   existing `0 2 * * *` trigger in `wrangler.jsonc:18-21` so we don't add a
   third cron.
9. Holiday calendar + `holiday_compare` report (dependent on plan 01).
10. `vehicle_reliability` report (dependent on plan 02 Layer A dim_vehicle
    for cheap per-vehicle aggregation).
11. Iceberg-backed reports (depends on plan 02 Layer C, gated on Cloudflare
    R2 SQL GA).

## Open Questions

- **Auth**: still single-user, no auth needed. Hash params to dedupe identical
  runs as a small QoL feature.
- **AI provider**: assume Cloudflare Workers AI (e.g. Llama 3.x). Confirm
  model + cost ceiling before wiring `/enhance`.
- **Pin UI**: a star icon in the history list and on the detail page. No
  bulk-pin needed in v1.

## Acceptance Criteria

- [ ] User can request a "Route on-time summary, last 90 days" report and
      receive a structured `ReportResult` within a few minutes.
- [ ] Every report includes headline + stats + interpretation + ≥1 finding.
- [ ] Failed reports surface a clear error and are retryable.
- [ ] Pinned reports survive the auto-prune; unpinned reports older than 90
      days are removed cleanly (row + R2 artifacts gone).
- [ ] Up to 3 reports run concurrently (enforced by Queues `max_concurrency`,
      verified by integration test); a 4th queues and starts when one
      finishes.
- [ ] No single report invocation exceeds the Workers CPU or subrequest
      caps; reports that would are chunked via the framework in §3a.
- [ ] Adding a new report `kind` = new file under `apps/worker/src/reports/`
      + registry entry + one form section, nothing else.
- [ ] Vitest coverage on each detector + the chunked-resume merge step.
