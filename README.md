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

Secrets (example):

```bash
wrangler secret put SWIFTLY_API_KEY
```

## Branching + environments (recommended)

This matches a common “staging then production” promotion flow:

- **Feature branches**
  - Branch off `staging` (or `main` if you prefer), open PRs into `staging`.
- **`staging` branch**
  - Protected branch.
  - PR required.
  - CI deploys to the **staging Worker** on merge.
- **`main` branch (production)**
  - Protected branch.
  - PR required.
  - CI deploys to the **production Worker** on merge.

Promotion is a PR from `staging` → `main` once staging looks good.
