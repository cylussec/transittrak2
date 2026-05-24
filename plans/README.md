# TransitTrack — Planning Docs

This folder holds **forward-looking implementation plans** for the next set of
features and bug fixes. Each plan is a self-contained Markdown file that other
agents (or humans) can pick up, refine, and execute against.

Conventions:

- Each plan starts with a **Problem / Goal** section and ends with **Acceptance
  Criteria** so the work is easy to scope and verify.
- Plans cite specific files/lines from the current codebase where relevant.
- Plans intentionally **do not change any code** — they only describe the work.
- If a plan is partially executed, leave a `## Status` section at the top with
  the date and what's done so far.

## Index

| # | File | Topic | Priority |
|---|------|-------|----------|
| 01 | `01-flexible-ontime-queries.md` | Flexible on-time % queries (weekends, weekday afternoons, etc.) | High |
| 02 | `02-storage-efficiency.md` | Storage + lookup efficiency for multi-agency, multi-year data | High |
| 03 | `03-custom-time-ranges.md` | Custom / arbitrary date ranges on the Route Analysis tab | Medium |
| 04 | `04-reports-generation.md` | Async reports (3-month on-time, stop bottlenecks, holiday compare) | High |
| 05 | `05-bug-fixes.md` | Stats empty, layout, stringline axes, duplicate vehicles | High |

## How to pick something up

1. Read the plan file end-to-end.
2. Check the **Open Questions** section — confirm decisions with the user
   before writing code.
3. Create a feature branch (e.g. `feature/ontime-flexible-filters`).
4. Update the plan's `## Status` block as you go so the next agent knows where
   to resume.
