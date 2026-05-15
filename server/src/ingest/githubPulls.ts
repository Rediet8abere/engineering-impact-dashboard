/**
 * Ingest merged Pull Requests from GitHub into `raw_github_events` (append-style upserts).
 * Then run ETL: `npm run etl -w server` to rebuild pull_request_facts → engineer_daily_facts → engineer_90d_rollups.
 *
 * Uses GitHub Search with **merged:YYYY-MM-DD..YYYY-MM-DD** windows (default 14-day chunks) so each query
 * stays under GitHub’s 1000-result limit, plus per-PR GET for additions/reviews.
 */
import { config as loadEnv } from "dotenv";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pLimit from "p-limit";
import { utcYesterdayCalendarDate } from "../etl/dateUtils.js";
import { prisma } from "../db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** `npm run` cwd is usually `server/`, but load explicitly so token is found reliably. */
loadEnv({ path: join(__dirname, "..", "..", ".env") });
loadEnv(); // optional: cwd `.env` overrides

const USER_AGENT = "engineering-impact-dashboard-ingest";

type SearchResponse = {
  total_count: number;
  incomplete_results?: boolean;
  items: Array<{
    id: number;
    number: number;
    title?: string;
    pull_request?: { url?: string };
  }>;
};

type PullRequestApi = {
  id: number;
  number: number;
  title?: string;
  merged?: boolean;
  merged_at?: string | null;
  created_at?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  user?: { login?: string; id?: number } | null;
  labels?: Array<{ id?: number; name?: string }>;
  review_comments?: number;
  requested_reviewers?: Array<{ login?: string }>;
};

function parseArgs(argv: string[]) {
  let days = 90;
  let chunkDays = 14;
  let prDelayMs = 220;
  let owner = "PostHog";
  let repo = "posthog";
  let maxPrs = 2500;
  /** Hard cap concurrent DB upserts (Neon / pooled URLs: keep 1–3). */
  let writeConcurrency = 1;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a) continue;
    if (a === "--help" || a === "-h") {
      help = true;
      continue;
    }
    if (a === "--days") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 1 || v > 365) throw new Error("--days expects 1..365");
      days = v;
      continue;
    }
    if (a === "--chunk-days") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 1 || v > 30) throw new Error("--chunk-days expects 1..30");
      chunkDays = v;
      continue;
    }
    if (a === "--pr-delay-ms") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 0 || v > 5000) throw new Error("--pr-delay-ms expects 0..5000");
      prDelayMs = v;
      continue;
    }
    if (a === "--owner") {
      const v = argv[++i];
      if (!v || v.startsWith("-")) throw new Error("--owner requires a value");
      owner = v;
      continue;
    }
    if (a === "--repo") {
      const v = argv[++i];
      if (!v || v.startsWith("-")) throw new Error("--repo requires a value");
      repo = v;
      continue;
    }
    if (a === "--max-prs") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 1) throw new Error("--max-prs expects a positive number");
      maxPrs = v;
      continue;
    }
    if (a === "--write-concurrency") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 1 || v > 3) throw new Error("--write-concurrency expects 1..3");
      writeConcurrency = v;
      continue;
    }
    if (a.startsWith("-")) throw new Error(`Unknown flag "${a}". Try --help.`);
    throw new Error(`Unexpected argument "${a}". Try --help.`);
  }

  return { days, chunkDays, prDelayMs, owner, repo, maxPrs, writeConcurrency, help };
}

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`
Ingest merged PRs from GitHub → raw_github_events (upsert by dedupe key), then run ETL separately.

Usage:
  npm run ingest:github -w server
  npm run ingest:github -w server -- --days 90 --chunk-days 14 --owner PostHog --repo posthog
  npm run ingest:github -w server -- --max-prs 500

Flags:
  --days N         Rolling inclusive calendar days ending UTC yesterday (default 90)
  --chunk-days N   Each GitHub search uses merged:FROM..TO spans of N inclusive days (default 14; lowers >1000 hits)
  --pr-delay-ms N  Pause before each PR detail GET (default 220; raises spacing for flaky TLS / rate limits)
  --write-concurrency N  Concurrent Prisma upserts (default 1; max 3). Use 1 for Neon under load.
  --owner / --repo Default PostHog / posthog
  --max-prs        Stop after N upserts (default 2500)

Environment:
  GITHUB_TOKEN   Required for practical runs (classic PAT or fine-grained token with Contents read + Metadata).
                 Put it in server/.env as GITHUB_TOKEN=ghp_...
  GH_TOKEN       Alias; used if GITHUB_TOKEN is unset.
  DATABASE_URL   For Neon, append pool hints to the URL (see server/.env.example), e.g. connection_limit=5 or pgbouncer=true.

Next step:
  npm run etl -w server
`.trim());
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Inclusive merged-date upper bound: UTC yesterday (matches ETL window-end convention). */
function mergedRangeEndIso(): string {
  return toIsoDate(utcYesterdayCalendarDate());
}

/** First UTC calendar day of an inclusive `days`-long window ending on `rangeEndIso`. */
function mergedRangeStartIso(rangeEndIso: string, days: number): string {
  const end = new Date(`${rangeEndIso}T00:00:00.000Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return toIsoDate(start);
}

function addUtcDaysIso(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return toIsoDate(d);
}

function minIsoDate(a: string, b: string): string {
  return a <= b ? a : b;
}

/**
 * Non-overlapping inclusive merged-date windows (e.g. 14 days → merged:2026-02-13..2026-02-26).
 * Keeps each GitHub code search under the 1000-result cap.
 */
function enumerateMergedDateChunks(
  rangeStartIso: string,
  rangeEndIso: string,
  spanInclusive: number,
): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  let from = rangeStartIso;
  while (from <= rangeEndIso) {
    const to = minIsoDate(addUtcDaysIso(from, spanInclusive - 1), rangeEndIso);
    out.push({ from, to });
    from = addUtcDaysIso(to, 1);
  }
  return out;
}

async function githubFetch(url: string, token: string | undefined): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
  };
  const t = token?.trim();
  if (t) {
    headers.Authorization = `Bearer ${t}`;
  }
  return fetch(url, { headers });
}

const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

function isRetryableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (msg.includes("fetch failed") || msg.includes("network") || msg.includes("socket")) return true;
  const c = (err as Error & { cause?: unknown }).cause;
  if (c && typeof c === "object" && "code" in c) {
    const code = String((c as { code?: string }).code);
    if (
      code.startsWith("UND_ERR") ||
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "EPIPE" ||
      code === "ECONNABORTED"
    ) {
      return true;
    }
  }
  return false;
}

function isRetryableHttp(status: number, bodySnippet: string): boolean {
  if (RETRYABLE_HTTP.has(status)) return true;
  if (status === 403 && /rate limit|secondary rate limit/i.test(bodySnippet)) return true;
  return false;
}

async function sleepBackoff(attempt: number, baseMs: number): Promise<void> {
  const jitter = Math.floor(Math.random() * 250);
  const ms = Math.min(30_000, baseMs * 2 ** attempt + jitter);
  await sleep(ms);
}

/** Retries transient TLS/socket drops and GitHub 429/5xx. Returns only `res.ok` responses. */
async function githubFetchWithRetry(
  url: string,
  token: string | undefined,
  ctx: string,
  options?: { maxAttempts?: number; baseBackoffMs?: number },
): Promise<Response> {
  const maxAttempts = options?.maxAttempts ?? 6;
  const baseBackoffMs = options?.baseBackoffMs ?? 500;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const res = await githubFetch(url, token);
      if (res.ok) return res;

      const text = await res.text();
      const retryAfter = res.headers.get("retry-after");
      const raMs = Number.parseInt(retryAfter ?? "", 10) * 1000;

      if (isRetryableHttp(res.status, text) && attempt < maxAttempts - 1) {
        // eslint-disable-next-line no-console
        console.warn(
          `  [retry ${attempt + 1}/${maxAttempts}] ${ctx} → HTTP ${res.status} ${text.slice(0, 120).replace(/\s+/g, " ")}`,
        );
        if (Number.isFinite(raMs) && raMs > 0) {
          await sleep(Math.min(raMs, 120_000));
        } else {
          await sleepBackoff(attempt, baseBackoffMs);
        }
        continue;
      }

      throw new Error(`${ctx} → HTTP ${res.status}: ${text.slice(0, 500)}`);
    } catch (e) {
      lastErr = e;
      if (!isRetryableNetworkError(e) || attempt >= maxAttempts - 1) throw e;
      // eslint-disable-next-line no-console
      console.warn(`  [retry ${attempt + 1}/${maxAttempts}] ${ctx}: ${(e as Error).message}`);
      await sleepBackoff(attempt, baseBackoffMs);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function toWebhookPayload(pr: PullRequestApi, repoFullName: string) {
  return {
    action: "closed",
    pull_request: {
      id: pr.id,
      number: pr.number,
      title: pr.title ?? "",
      merged: Boolean(pr.merged),
      merged_at: pr.merged_at,
      created_at: pr.created_at,
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
      changed_files: pr.changed_files ?? 0,
      user: pr.user?.login ? { login: pr.user.login, id: pr.user.id ?? 0 } : undefined,
      labels: (pr.labels ?? []).map((l) => ({ name: l.name ?? "" })),
      review_comments: pr.review_comments ?? 0,
      requested_reviewers: (pr.requested_reviewers ?? []).map((r) => ({ login: r.login ?? "" })),
      base: { repo: { full_name: repoFullName } },
    },
  };
}

async function fetchPullDetail(apiPullUrl: string, token: string | undefined): Promise<PullRequestApi> {
  const res = await githubFetchWithRetry(apiPullUrl, token, `GET ${apiPullUrl}`);
  const text = await res.text();
  return JSON.parse(text) as PullRequestApi;
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return;
  }

  const tokenRaw = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const token = tokenRaw?.trim() || undefined;
  const repoFullName = `${opts.owner}/${opts.repo}`;
  const rangeEnd = mergedRangeEndIso();
  const rangeStart = mergedRangeStartIso(rangeEnd, opts.days);
  const windows = enumerateMergedDateChunks(rangeStart, rangeEnd, opts.chunkDays);

  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set (or empty). Add to server/.env:\n" +
        "  GITHUB_TOKEN=ghp_your_pat_here\n" +
        "Unauthenticated GitHub REST hits ~60 requests/hour and ingest will fail quickly.",
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `Ingesting ${repoFullName} merged ${rangeStart}..${rangeEnd} (${opts.days} inclusive days, ` +
      `${windows.length} search window(s) ≤${opts.chunkDays}d each) — authenticated`,
  );
  // eslint-disable-next-line no-console
  console.log(`  DB write concurrency: ${opts.writeConcurrency} (no DB retries; cap pool pressure)`);

  const writeLimit = pLimit(opts.writeConcurrency);

  let ingested = 0;
  const perPage = 100;
  const maxSearchPage = 10;

  for (const win of windows) {
    if (ingested >= opts.maxPrs) break;

    const q = `repo:${repoFullName} is:pr is:merged merged:${win.from}..${win.to}`;
    // eslint-disable-next-line no-console
    console.log(`  merged:${win.from}..${win.to}`);

    let page = 1;
    while (ingested < opts.maxPrs && page <= maxSearchPage) {
      const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=${perPage}&page=${page}`;
      const res = await githubFetchWithRetry(
        url,
        token,
        `search merged:${win.from}..${win.to} page=${page}`,
      );
      const text = await res.text();
      const body = JSON.parse(text) as SearchResponse;

      if (page === 1 && body.total_count > 1000) {
        throw new Error(
          `merged:${win.from}..${win.to} has total_count=${body.total_count} (>1000). GitHub only returns the first 1000. ` +
            `Re-run with a smaller --chunk-days (e.g. 7).`,
        );
      }

      const items = body.items ?? [];
      if (items.length === 0) break;

      for (const it of items) {
        if (ingested >= opts.maxPrs) break;
        const prUrl = it.pull_request?.url;
        if (!prUrl) continue;

        await sleep(opts.prDelayMs);
        const pr = await fetchPullDetail(prUrl, token);
        if (!pr.merged_at || !pr.user?.login) continue;

        const dedupeKey = `github:ingest:${repoFullName}:${pr.number}`;
        const payload = toWebhookPayload(pr, repoFullName);

        await writeLimit(() =>
          prisma.rawGitHubEvent.upsert({
            where: { dedupeKey },
            create: {
              id: randomUUID(),
              dedupeKey,
              deliveryId: `ingest:${opts.owner}:${opts.repo}:${pr.number}`,
              eventType: "pull_request",
              action: "closed",
              repoFullName,
              payload,
            },
            update: {
              payload,
              receivedAt: new Date(),
            },
          }),
        );
        ingested += 1;
      }

      if (items.length < perPage) break;
      page += 1;
      await sleep(350);
    }

    await sleep(400);
  }

  // eslint-disable-next-line no-console
  console.log(`Upserted ${ingested} raw pull_request events for ${repoFullName}. Run: npm run etl -w server`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
