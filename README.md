# transittrak2
The second iteration of transittrak, this time on Cloudflare Workers.

## Repo structure

This repo is an npm workspaces monorepo:

```
apps/web     # React (Vite) frontend
apps/worker  # Cloudflare Worker (API + static asset hosting)
```

The web app builds directly into the Worker’s static assets directory:

```
apps/worker/site
```

## Requirements

- Node.js (LTS recommended)
- npm
- Cloudflare account + Wrangler authenticated (`wrangler login`)

## Install

From the repo root:

```bash
npm install
```

## Local development

- Worker dev server:

```bash
npm run dev:worker
```

Notes:

- `dev:worker` runs `build:web` first so the Worker always has UI assets to serve.
- The Worker serves API routes under `/api/*` and serves the SPA for everything else.

- Web UI dev server (with `/api` proxied to the Worker):

```bash
npm run dev:web
```

### Local D1 database setup

The Worker talks to a Cloudflare D1 database. For local development and tests you’ll need to apply the Drizzle migrations into Wrangler’s persisted state so the tables exist.

1. Authenticate Wrangler once (if you haven’t already):

   ```bash
   npx wrangler login
   ```

2. Apply the migrations to the local D1 instance (creates a SQLite DB under `.wrangler/state`):

   ```bash
   npm run -w transittrack-worker db:migrate:local
   ```

3. (Optional) Seed local/staging data from `db/seed.sql`:

   ```bash
   npm run -w transittrack-worker db:seed:local
   ```

4. If you need a clean slate, delete the `.wrangler/state` directory and rerun the migrate command.

5. Tests that exercise the API expect the schema to be present. Run the migrate step above before `npm run test:worker`, or add a test setup hook that executes the generated SQL against `env.DB`.

## Tests

Worker tests:

```bash
npm run test:worker
```

## Build

Build the web app into `apps/worker/site`:

```bash
npm run build
```

## Deploy

Build the UI and deploy the Worker:

```bash
npm run deploy
```

## API testing with Bruno

A Bruno workspace lives in `bruno/` with requests for every Worker endpoint and environments targeting local dev, staging, and production.

1. Install [Bruno](https://www.usebruno.com/).
2. Open the workspace folder `bruno/`.
3. Switch environments as needed:
   - `localhost` → http://localhost:8787 (Wrangler dev server)
   - `staging` → replace `REPLACE-WITH-STAGING-WORKER-URL` with your staging Worker URL
   - `production` → replace `REPLACE-WITH-PROD-WORKER-URL` with your production Worker URL
4. Run requests in the collection groups (Health, Metadata, GTFS static, Ingest, Exports) to exercise each endpoint.

Rename the staging/production environment base URLs once the Workers are deployed so the requests resolve correctly.

Secrets (example):

```bash
wrangler secret put SWIFTLY_API_KEY
```

## Branching + environments (recommended)

This repo uses a trunk-based flow (Option B):

- **Feature branches**
  - Branch off `main`.
  - Open PRs into `main`.
- **`main` branch (staging)**
  - Protected branch.
  - PR required.
  - Merges to `main` deploy to the **staging Worker**.
- **Production releases**
  - Production deploys happen only from version tags (e.g. `v0.1.0`).

Deploy commands:

```bash
npm run deploy:staging
npm run deploy:prod
```
