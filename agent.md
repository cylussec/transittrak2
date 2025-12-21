# TransitTrack Project Guide (Agent Handoff)

## Context Recap
- Goal: Cloudflare Workers-based platform ingesting Maryland MTA GTFS-RT (bus-first), storing forever (R2 archive + D1 indexes), exposing APIs & React UI (stringlines, exports).
- All timestamps in UTC. Swiftly API key stored as Worker secret.
- Long-term plan: ingestion DO, GTFS static versioning, public API, React UI (map/stringline), exports, future analytics.

## Current State (feature/bootstrap)
1. **Monorepo workspace structure** (npm workspaces):
   - `apps/worker/` (Cloudflare Worker)
   - `apps/web/` (React/Vite UI)
   - Root `package.json` defines workspaces + root scripts
2. **Worker scaffold** (`apps/worker/`) via `wrangler init`:
   - Typescript Worker template with Vitest.
   - Scripts: `dev`, `deploy`, `cf-typegen`, etc.
   - Wrangler config + type definitions ready for bindings.
3. **React/Vite frontend scaffold** (`apps/web/`) via `npm create vite@latest ... --template react-ts`:
   - React 19 + TS + ESLint config in place.
   - Basic App shell ready for customization.
4. **UI served by Worker (asset pipeline)**:
   - `apps/web` builds into `apps/worker/site/`.
   - `apps/worker/wrangler.jsonc` serves assets from `./site`.
   - Worker routes `/api/*` to backend handlers; all other paths serve the SPA with an `index.html` fallback.
5. **Repo hygiene**:
   - Root `.gitignore` created (ignores node_modules, dist, .wrangler, etc.).
   - Work tracked on branch `feature/bootstrap`.

## Expected Practices
- Use official tooling (`wrangler`, `create-vite`, etc.) instead of manual scaffolding when possible.
- Favor DRY abstractions; add comments only for non-obvious logic.
- Maintain UTC everywhere.
- Prefer minimum viable changes per commit; do not revert user edits.

## Common Commands (run at repo root)
- `npm run dev:worker` (starts Worker API + static asset serving at `http://localhost:8787`)
- `npm run dev:web` (starts Vite dev server at `http://localhost:5173`, proxies `/api` → Worker)
- `npm run build` (builds web → `apps/worker/site`)
- `npm run deploy` (builds web, then deploys Worker)

## Branch / Release Workflow
1. Develop on feature branches (`feature/*`), starting from `main`.
2. Merge feature → `staging` (integration tests + staging Worker deploy).
3. Promote `staging` → `production` branch for prod deployment.
4. Future TODO: GitHub Actions to automate staging/prod Worker publishes.

## Immediate Next Steps
1. Define wrangler bindings (R2/D1/DO) + stub API routes per architecture plan.
2. Flesh out ingestion coordination scaffolding (Durable Object class, env types).
3. Connect Vite build into Worker (static asset serving or separate Pages).
4. Add documentation: root README (expanded), CONTRIBUTING/architecture overview.
5. Set up CI (lint/test) + GitHub Actions for deploys (staging/prod secrets).

## Reference Plan
- Detailed architecture/plan captured in session summary (Cloudflare Worker ingest + R2/D1 + React stringline UI). Follow that document for implementation order & requirements.
