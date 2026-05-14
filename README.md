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
npm run db:seed
npm run etl -w server -- --last-90d
npm run etl -w server -- --to 2026-05-14
npm run etl -w server -- --from 2026-05-01 --to 2026-05-14
npm run etl -w server -- --help
```

### ETL window modes

- **Default (no args):** rolling 90d snapshot with window end = **UTC yesterday**.
- **`--last-90d`:** same as default, explicit flag for scripts/CI.
- **`--to YYYY-MM-DD`:** single snapshot ending on that UTC date (inclusive last day of the 90d window).
- **Positional `YYYY-MM-DD`:** same as `--to` (backward compatible).
- **`--from YYYY-MM-DD --to YYYY-MM-DD`:** backfill **one rollup snapshot per UTC day** in the inclusive range (facts/daily rebuilt once; rollups run once per end date).

## Run

From the **monorepo root** (`engineering-impact-dashboard/`, not only `server/`).  
If your cwd is `server/` or `web/`, `npm run dev:web` / `npm run dev:api` still work via delegating scripts.

Terminal 1 — API (default `http://localhost:4000`):

```bash
npm run dev:api
```

Terminal 2 — Web (`http://localhost:5173`):

```bash
npm run dev:web
```

## Production deploy (single process)

The **Express** server serves **`/api/*`** and, after `npm run build`, the **Vite** app from **`web/dist`** on the same port (same origin — no CORS issues for `/api`).

From the **monorepo root**:

```bash
npm ci
npm run build
npm run db:migrate -w server
npm start
```

**One command your platform can run after each deploy** (build + migrate + start):

```bash
npm run deploy
```

That runs: `build` → `prisma migrate deploy` (via `db:migrate` in `server`) → `npm start` (starts `node server/dist/index.js`).

Then open **`http://<host>:<PORT>/`** (default `PORT=4000`). Set `DATABASE_URL` (and `PORT` if required) in the environment.

### Docker

```bash
docker build -t impact-dashboard .
docker run --rm -e DATABASE_URL="postgresql://..." -p 4000:4000 impact-dashboard
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
