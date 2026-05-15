# Engineering Impact Dashboard

Full-stack demo: **Node.js + TypeScript + Express + Prisma + PostgreSQL** API and **React + Vite + TanStack Query** UI.

Analytics read only **precomputed** tables (`pull_request_facts`, `engineer_daily_facts`, `engineer_90d_rollups`). Raw GitHub events are ingested into `raw_github_events` and processed by the ETL worker.

## Prerequisites

- Node.js 20+
- PostgreSQL 15+

## Setup

```bash
cd engineering-impact-dashboard
cp server/.env.example server/.env
# edit server/.env — set DATABASE_URL

npm install
npm run db:generate
npm run db:migrate
```

### Option A — quick local demo (synthetic PRs)

```bash
npm run db:seed
npm run etl
```

### Option B — **PostHog/posthog** from GitHub (recommended for real impact)

Requires **`GITHUB_TOKEN`** (or `GH_TOKEN`) in **`server/.env`**. Ingest loads `server/.env` explicitly and sends `Authorization: Bearer …` on every GitHub request; without a token the script exits immediately (unauthenticated REST is ~60 requests/hour and will fail during ingest).

```bash
# Writes merged PRs (last 90 days by default) into raw_github_events, then rebuilds all fact tables.
npm run load:posthog
```

Or step-by-step: `npm run ingest:github -w server` then `npm run etl -w server`. Ingest uses GitHub search windows `merged:FROM..TO` in **14-day** slices (under the 1000-result cap); tune with `--chunk-days` / `--days` / `--max-prs` / `--write-concurrency` (default **1** concurrent upsert; max **3**). For Neon, cap connections on `DATABASE_URL` (see `server/.env.example`, e.g. `connection_limit` / `pgbouncer=true`). See `npm run ingest:github -w server -- --help`.

## Run

From the **monorepo root** (`engineering-impact-dashboard/`, not only `server/`).  
If your cwd is `server/`, `npm run dev:web` delegates to the web workspace. From `web/`, start the API with `npm --prefix .. run dev -w server` (or `cd ..` and use the root scripts below).

Terminal 1 — API (default `http://localhost:4000`):

```bash
npm run dev:api
```

Terminal 2 — Web (`http://localhost:5173`):

```bash
npm run dev:web
```

## Impact score (explainable)

```
impact_score =
  0.3 * throughput +
  0.2 * consistency +
  0.2 * review_quality +
  0.2 * stability +
  0.1 * subsystem_complexity
```

Subscores are on **0–100** (see `server/src/etl/scoring.ts`).

## Docker Postgres (optional)

```bash
docker run --name impact-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=impact -p 5432:5432 -d postgres:16
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/impact?schema=public
```
