import { utcYesterdayCalendarDate } from "./dateUtils.js";

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseUtcDateOnly(s: string): Date {
  if (!isIsoDate(s)) {
    throw new Error(`Invalid date "${s}". Expected YYYY-MM-DD.`);
  }
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date "${s}".`);
  }
  return d;
}

/** Inclusive UTC day range; returns one Date per calendar day at 00:00Z. */
export function enumerateUtcDaysInclusive(fromStr: string, toStr: string): Date[] {
  const from = parseUtcDateOnly(fromStr);
  const to = parseUtcDateOnly(toStr);
  if (from.getTime() > to.getTime()) {
    throw new Error(`--from (${fromStr}) must be <= --to (${toStr}).`);
  }

  const out: Date[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += 86400000) {
    out.push(new Date(t));
  }
  return out;
}

export type ParsedEtlCli = {
  /** When true, window end is UTC "yesterday" (same default as no args). */
  last90d: boolean;
  /** Explicit single window end (inclusive last day of 90d window). */
  windowEnd?: string;
  /** Back-compat positional YYYY-MM-DD (same as --to). */
  positional?: string;
  /** If set with --to, materialize one rollup row per day in the inclusive range. */
  from?: string;
  help: boolean;
};

export function parseEtlArgv(argv: string[]): ParsedEtlCli {
  const out: ParsedEtlCli = {
    last90d: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a) continue;

    if (a === "--help" || a === "-h") {
      out.help = true;
      continue;
    }
    if (a === "--last-90d") {
      out.last90d = true;
      continue;
    }
    if (a === "--to") {
      const v = argv[++i];
      if (!v || v.startsWith("-")) throw new Error("--to requires a YYYY-MM-DD value.");
      out.windowEnd = v;
      continue;
    }
    if (a === "--from") {
      const v = argv[++i];
      if (!v || v.startsWith("-")) throw new Error("--from requires a YYYY-MM-DD value.");
      out.from = v;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`Unknown flag "${a}". Try --help.`);
    }

    if (out.positional) {
      throw new Error(`Unexpected extra argument "${a}".`);
    }
    out.positional = a;
  }

  return out;
}

export function printEtlHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`
ETL — rebuild pull_request_facts, engineer_daily_facts, engineer_90d_rollups

Rolling 90d window is always **90 inclusive UTC calendar days** ending on the chosen window end.

Usage:
  npm run etl -w server
  npm run etl -w server -- --last-90d
  npm run etl -w server -- --to YYYY-MM-DD
  npm run etl -w server -- YYYY-MM-DD
  npm run etl -w server -- --from YYYY-MM-DD --to YYYY-MM-DD

Flags:
  --last-90d     Use UTC yesterday as window end (explicit alias for default behavior)
  --to DATE      Window end (inclusive last day of the 90d window)
  --from DATE    With --to, materialize rollups for every window end in [from, to] (UTC days)
  -h, --help     Show this help

Notes:
  - Facts/daily tables are rebuilt once; each window end recomputes 90d rollups only.
  - Large --from/--to ranges can take longer (one rollup pass per day).
  - Load real PostHog/posthog PRs first: npm run ingest:github -w server  (then run this ETL).
`.trim());
}

export function resolveWindowEndsFromCli(parsed: ParsedEtlCli): Date[] {
  if (parsed.help) return [];

  if (parsed.positional && parsed.windowEnd) {
    throw new Error('Provide either a positional YYYY-MM-DD or --to, not both.');
  }

  const singleEnd = parsed.windowEnd ?? parsed.positional;

  if (parsed.last90d && (parsed.from || parsed.windowEnd || parsed.positional)) {
    throw new Error('Do not combine --last-90d with --from/--to or a positional date. Use one mode.');
  }

  if (parsed.from && !parsed.windowEnd) {
    throw new Error("--from requires --to.");
  }

  if (parsed.from && parsed.windowEnd) {
    return enumerateUtcDaysInclusive(parsed.from, parsed.windowEnd);
  }

  if (parsed.last90d) {
    return [utcYesterdayCalendarDate()];
  }

  if (singleEnd) {
    return [parseUtcDateOnly(singleEnd)];
  }

  // default: yesterday UTC
  return [utcYesterdayCalendarDate()];
}
