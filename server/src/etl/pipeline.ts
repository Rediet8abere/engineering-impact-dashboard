import { prisma } from "../db.js";
import { toUtcCalendarDate, utcYesterdayCalendarDate } from "./dateUtils.js";
import { computeImpactScore, computeSubscores } from "./scoring.js";

const MS_PER_HOUR = 1000 * 60 * 60;

type PullRequestPayload = {
  action?: string;
  pull_request?: {
    id: number;
    title?: string;
    merged?: boolean;
    merged_at?: string | null;
    created_at?: string;
    additions?: number;
    deletions?: number;
    changed_files?: number;
    user?: { login?: string; id?: number };
    labels?: Array<{ name?: string }>;
    review_comments?: number;
    requested_reviewers?: Array<{ login?: string }>;
  };
};

function parsePullRequestPayload(payload: unknown): PullRequestPayload | null {
  if (!payload || typeof payload !== "object") return null;
  return payload as PullRequestPayload;
}

function mergeWeightFromPr(args: {
  additions: number;
  deletions: number;
  churnScore: number;
  isRevert: boolean;
  isHotfix: boolean;
}): number {
  const lines = Math.max(0, args.additions + args.deletions);
  const size = 1 - Math.exp(-lines / 800);
  let w = 0.25 + 0.75 * size;
  w *= 1 - Math.min(0.6, args.churnScore) * 0.5;
  if (args.isRevert) w *= 0.35;
  if (args.isHotfix) w *= 0.75;
  return Math.max(0.05, Math.min(3, w));
}

function subsystemFromLabels(labels: Array<{ name?: string }> | undefined): string | null {
  const names = (labels ?? []).map((l) => l.name?.toLowerCase() ?? "").filter(Boolean);
  const blob = names.join(" ");
  if (blob.includes("security") || blob.includes("audit")) return "security";
  if (names.some((n) => n.includes("frontend") || n.includes("ui") || n.includes("ux"))) return "frontend";
  if (blob.includes("ingestion") || blob.includes("capture") || blob.includes("pipeline")) return "ingestion";
  if (blob.includes("hogql") || blob.includes("query") || blob.includes("clickhouse")) return "hogql";
  if (blob.includes("experiment") || blob.includes("flag")) return "experimentation";
  if (blob.includes("billing") || blob.includes("stripe")) return "billing";
  return "core";
}

function complexityFromSubsystem(slug: string | null): number {
  const s = (slug ?? "core").toLowerCase();
  const map: Record<string, number> = {
    security: 95,
    hogql: 88,
    ingestion: 82,
    experimentation: 80,
    billing: 78,
    frontend: 70,
    core: 60,
  };
  return map[s] ?? 60;
}

export async function rebuildPullRequestFactsFromRaw(): Promise<number> {
  const events = await prisma.rawGitHubEvent.findMany({
    where: { eventType: "pull_request" },
    orderBy: { receivedAt: "asc" },
  });

  let upserted = 0;
  for (const ev of events) {
    const body = parsePullRequestPayload(ev.payload);
    if (!body) continue;

    const pr = body.pull_request;
    if (!pr?.id) continue;

    const action = body.action ?? ev.action ?? "";
    const merged = Boolean(pr.merged) && Boolean(pr.merged_at);
    if (!merged && action !== "closed") {
      // keep latest open state optional — for demo skip non-merged
      continue;
    }
    if (!merged) continue;

    const login = pr.user?.login;
    if (!login) continue;

    const engineer = await prisma.engineer.upsert({
      where: { githubLogin: login },
      create: { githubLogin: login, displayName: login },
      update: {},
    });

    const createdAt = new Date(pr.created_at ?? Date.now());
    const mergedAt = new Date(pr.merged_at as string);
    const cycleMs = mergedAt.getTime() - createdAt.getTime();
    const cycleTimeHours = Math.max(0, cycleMs / MS_PER_HOUR);

    const additions = pr.additions ?? 0;
    const deletions = pr.deletions ?? 0;
    const changedFiles = pr.changed_files ?? 0;

    const labels = pr.labels ?? [];
    const titleLower = (pr.title ?? "").toLowerCase();
    const churnScore = labels.some((l) => l.name?.toLowerCase().includes("churn")) ? 0.45 : 0.08;
    const isRevert =
      labels.some((l) => (l.name ?? "").toLowerCase().includes("revert")) || titleLower.startsWith("revert");
    const isHotfix =
      labels.some((l) => (l.name ?? "").toLowerCase().includes("hotfix")) || titleLower.includes("hotfix");

    const subsystemSlug = subsystemFromLabels(labels);
    const mergeWeight = mergeWeightFromPr({
      additions,
      deletions,
      churnScore,
      isRevert,
      isHotfix,
    });

    const rc = pr.review_comments ?? 0;
    const rq = (pr.requested_reviewers ?? []).length;
    const reviewsDistinct = Math.min(12, Math.max(1, Math.round(rc + 0.5 * rq)));

    await prisma.pullRequestFact.upsert({
      where: { prId: BigInt(pr.id) },
      create: {
        prId: BigInt(pr.id),
        repoFullName: ev.repoFullName,
        authorEngineerId: engineer.id,
        subsystemSlug,
        createdAt,
        mergedAt,
        cycleTimeHours,
        mergeWeight,
        churnScore,
        isRevert,
        isHotfix,
        additions,
        deletions,
        changedFiles,
        reviewsDistinct,
      },
      update: {
        repoFullName: ev.repoFullName,
        authorEngineerId: engineer.id,
        subsystemSlug,
        createdAt,
        mergedAt,
        cycleTimeHours,
        mergeWeight,
        churnScore,
        isRevert,
        isHotfix,
        additions,
        deletions,
        changedFiles,
        reviewsDistinct,
        updatedAt: new Date(),
      },
    });
    upserted += 1;
  }

  return upserted;
}

export async function rebuildEngineerDailyFacts(): Promise<void> {
  await prisma.engineerDailyFact.deleteMany({});

  const merged = await prisma.pullRequestFact.findMany({
    where: { mergedAt: { not: null } },
  });

  type Key = string;
  const buckets = new Map<
    Key,
    {
      engineerId: string;
      day: Date;
      merges: number;
      weightedMerges: number;
      reviewsSubmitted: number;
      sumCycleTimeHours: number;
      prsWithCycleTime: number;
      churnEvents: number;
      revertEvents: number;
      hotfixMerges: number;
      activeMergeDay: number;
    }
  >();

  const dayKey = (d: Date) => d.toISOString().slice(0, 10);

  for (const pr of merged) {
    if (!pr.mergedAt) continue;
    const day = new Date(pr.mergedAt.toISOString().slice(0, 10));
    const k = `${pr.authorEngineerId}:${dayKey(day)}`;
    const cur =
      buckets.get(k) ??
      {
        engineerId: pr.authorEngineerId,
        day,
        merges: 0,
        weightedMerges: 0,
        reviewsSubmitted: 0,
        sumCycleTimeHours: 0,
        prsWithCycleTime: 0,
        churnEvents: 0,
        revertEvents: 0,
        hotfixMerges: 0,
        activeMergeDay: 1,
      };

    cur.merges += 1;
    cur.weightedMerges += pr.mergeWeight;
    cur.reviewsSubmitted += pr.reviewsDistinct;
    if (pr.cycleTimeHours != null) {
      cur.sumCycleTimeHours += pr.cycleTimeHours;
      cur.prsWithCycleTime += 1;
    }
    cur.churnEvents += pr.churnScore >= 0.25 ? 1 : 0;
    cur.revertEvents += pr.isRevert ? 1 : 0;
    cur.hotfixMerges += pr.isHotfix ? 1 : 0;
    buckets.set(k, cur);
  }

  const rows = [...buckets.values()];
  for (const r of rows) {
    await prisma.engineerDailyFact.create({
      data: {
        engineerId: r.engineerId,
        day: r.day,
        merges: r.merges,
        weightedMerges: r.weightedMerges,
        reviewsSubmitted: r.reviewsSubmitted,
        sumCycleTimeHours: r.sumCycleTimeHours,
        prsWithCycleTime: r.prsWithCycleTime,
        churnEvents: r.churnEvents,
        revertEvents: r.revertEvents,
        hotfixMerges: r.hotfixMerges,
        activeMergeDay: r.merges > 0 ? 1 : 0,
      },
    });
  }
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function uniqueIsoWeeks(dates: Date[]): number {
  const weeks = new Set<string>();
  for (const d of dates) {
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    weeks.add(`${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`);
  }
  return weeks.size;
}

export async function rebuildEngineer90dRollups(windowEnd: Date): Promise<void> {
  const end = toUtcCalendarDate(windowEnd);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 89);

  const engineers = await prisma.engineer.findMany({
    select: { id: true, githubLogin: true, displayName: true },
  });
  const engineerById = new Map(engineers.map((e) => [e.id, e]));

  const cohort: Array<{
    engineerId: string;
    weightedMerges90d: number;
    merges90d: number;
    medianCycleHours: number | null;
    activeDays: number;
    activeWeeks: number;
    avgReviewsPerMerge: number;
    churnRate: number;
    revertRate: number;
    hotfixRate: number;
    subsystemEntropy: number;
    avgComplexity: number;
  }> = [];

  for (const e of engineers) {
    const daily = await prisma.engineerDailyFact.findMany({
      where: { engineerId: e.id, day: { gte: start, lte: end } },
      orderBy: { day: "asc" },
    });

    const endExclusive = new Date(end);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

    const mergedPrs = await prisma.pullRequestFact.findMany({
      where: {
        authorEngineerId: e.id,
        mergedAt: { gte: start, lt: endExclusive },
      },
    });

    const merges90d = daily.reduce((s, d) => s + d.merges, 0);
    const weightedMerges90d = daily.reduce((s, d) => s + d.weightedMerges, 0);
    const activeDays = daily.filter((d) => d.merges > 0).length;
    const mergeDays = daily.filter((d) => d.merges > 0).map((d) => d.day);
    const activeWeeks = uniqueIsoWeeks(mergeDays);

    const cycleHours = mergedPrs.map((p) => p.cycleTimeHours).filter((x): x is number => x != null);
    const medianCycleHours = median(cycleHours);

    const reviewsSubmitted = daily.reduce((s, d) => s + d.reviewsSubmitted, 0);
    const avgReviewsPerMerge = merges90d > 0 ? reviewsSubmitted / merges90d : 0;

    const churnEvents = daily.reduce((s, d) => s + d.churnEvents, 0);
    const revertEvents = daily.reduce((s, d) => s + d.revertEvents, 0);
    const hotfixMerges = daily.reduce((s, d) => s + d.hotfixMerges, 0);

    const churnRate = merges90d > 0 ? churnEvents / merges90d : 0;
    const revertRate = merges90d > 0 ? revertEvents / merges90d : 0;
    const hotfixRate = merges90d > 0 ? hotfixMerges / merges90d : 0;

    const subsystemCounts = new Map<string, number>();
    for (const p of mergedPrs) {
      const slug = p.subsystemSlug ?? "core";
      subsystemCounts.set(slug, (subsystemCounts.get(slug) ?? 0) + 1);
    }
    let entropy = 0;
    const totalSubs = mergedPrs.length || 1;
    for (const c of subsystemCounts.values()) {
      const p = c / totalSubs;
      entropy += p > 0 ? -(p * Math.log(p)) : 0;
    }

    const avgComplexity =
      mergedPrs.length > 0
        ? mergedPrs.reduce((s, p) => s + complexityFromSubsystem(p.subsystemSlug), 0) / mergedPrs.length
        : 60;

    cohort.push({
      engineerId: e.id,
      weightedMerges90d,
      merges90d,
      medianCycleHours,
      activeDays,
      activeWeeks,
      avgReviewsPerMerge,
      churnRate,
      revertRate,
      hotfixRate,
      subsystemEntropy: entropy,
      avgComplexity,
    });
  }

  const maxWeighted = Math.max(1e-6, ...cohort.map((c) => c.weightedMerges90d));

  for (const c of cohort) {
    const sub = computeSubscores({
      weightedMerges90d: c.weightedMerges90d,
      maxWeightedMerges90d: maxWeighted,
      medianCycleHours: c.medianCycleHours,
      activeDays: c.activeDays,
      activeWeeks: c.activeWeeks,
      avgReviewsPerMerge: c.avgReviewsPerMerge,
      churnRate: c.churnRate,
      revertRate: c.revertRate,
      hotfixRate: c.hotfixRate,
      subsystemEntropy: c.subsystemEntropy,
      avgSubsystemComplexity: c.avgComplexity,
    });

    const impactScore = computeImpactScore(sub);

    const engineer = engineerById.get(c.engineerId);
    if (!engineer) continue;

    const dailyTimeline = await prisma.engineerDailyFact.findMany({
      where: { engineerId: c.engineerId, day: { gte: start, lte: end } },
      orderBy: { day: "asc" },
    });

    const dailyTimelineJson = dailyTimeline.map((d) => ({
      day: d.day.toISOString().slice(0, 10),
      merges: d.merges,
      weightedMerges: d.weightedMerges,
      reviewsSubmitted: d.reviewsSubmitted,
    }));

    const weeklyMap = new Map<
      string,
      { merges: number; weightedMerges: number; reviewsSubmitted: number }
    >();
    for (const d of dailyTimeline) {
      const wk = isoWeekKey(d.day);
      const cur = weeklyMap.get(wk) ?? { merges: 0, weightedMerges: 0, reviewsSubmitted: 0 };
      cur.merges += d.merges;
      cur.weightedMerges += d.weightedMerges;
      cur.reviewsSubmitted += d.reviewsSubmitted;
      weeklyMap.set(wk, cur);
    }
    const weeklyTimelineJson = [...weeklyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, v]) => ({ week, ...v }));

    const subsystemBreakdownJson = await buildSubsystemBreakdown(c.engineerId, start, end);

    const explainJson = {
      specVersion: "impact/v1",
      windowDays: 90,
      windowStart: start.toISOString().slice(0, 10),
      windowEnd: end.toISOString().slice(0, 10),
      engineer: { id: c.engineerId, githubLogin: engineer.githubLogin, displayName: engineer.displayName },
      subscores: sub,
      impactScore,
      inputs: {
        merges90d: c.merges90d,
        weightedMerges90d: c.weightedMerges90d,
        medianCycleHours: c.medianCycleHours,
        activeDays: c.activeDays,
        activeWeeks: c.activeWeeks,
        churnRate: c.churnRate,
        revertRate: c.revertRate,
        hotfixRate: c.hotfixRate,
        subsystemEntropy: c.subsystemEntropy,
        avgSubsystemComplexity: c.avgComplexity,
      },
    };

    await prisma.engineer90dRollups.upsert({
      where: { engineerId_windowEnd: { engineerId: c.engineerId, windowEnd: end } },
      create: {
        engineerId: c.engineerId,
        windowEnd: end,
        throughputScore: sub.throughput,
        consistencyScore: sub.consistency,
        reviewQualityScore: sub.review_quality,
        stabilityScore: sub.stability,
        subsystemComplexityScore: sub.subsystem_complexity,
        impactScore,
        merges90d: c.merges90d,
        weightedMerges90d: c.weightedMerges90d,
        medianCycleHours: c.medianCycleHours,
        activeDays: c.activeDays,
        activeWeeks: c.activeWeeks,
        explainJson,
        subsystemBreakdownJson,
        dailyTimelineJson,
        weeklyTimelineJson,
        asOf: new Date(),
      },
      update: {
        throughputScore: sub.throughput,
        consistencyScore: sub.consistency,
        reviewQualityScore: sub.review_quality,
        stabilityScore: sub.stability,
        subsystemComplexityScore: sub.subsystem_complexity,
        impactScore,
        merges90d: c.merges90d,
        weightedMerges90d: c.weightedMerges90d,
        medianCycleHours: c.medianCycleHours,
        activeDays: c.activeDays,
        activeWeeks: c.activeWeeks,
        explainJson,
        subsystemBreakdownJson,
        dailyTimelineJson,
        weeklyTimelineJson,
        asOf: new Date(),
      },
    });
  }
}

function isoWeekKey(d: Date): string {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

async function buildSubsystemBreakdown(engineerId: string, start: Date, end: Date) {
  const endExclusive = new Date(end);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const prs = await prisma.pullRequestFact.findMany({
    where: {
      authorEngineerId: engineerId,
      mergedAt: { gte: start, lt: endExclusive },
    },
  });
  const map = new Map<string, { merges: number; weighted: number }>();
  for (const p of prs) {
    const slug = p.subsystemSlug ?? "core";
    const cur = map.get(slug) ?? { merges: 0, weighted: 0 };
    cur.merges += 1;
    cur.weighted += p.mergeWeight;
    map.set(slug, cur);
  }
  const totalWeighted = [...map.values()].reduce((s, v) => s + v.weighted, 0) || 1;
  return [...map.entries()]
    .map(([slug, v]) => ({
      slug,
      merges: v.merges,
      weightedMerges: v.weighted,
      share: v.weighted / totalWeighted,
    }))
    .sort((a, b) => b.weightedMerges - a.weightedMerges);
}

/**
 * Rebuild facts/daily once, then materialize rolling 90d rollups for each inclusive window end date.
 * Each `windowEnd` is the **last UTC calendar day** included in the 90-day window.
 */
export async function runFullEtl(windowEnds?: Date[]): Promise<void> {
  if (windowEnds != null && !Array.isArray(windowEnds)) {
    throw new TypeError(
      "runFullEtl expects Date[] | undefined. If you see this, update callers (do not pass a single Date or CLI string).",
    );
  }

  const ends =
    windowEnds?.length && windowEnds.length > 0
      ? windowEnds.map((d) => toUtcCalendarDate(d))
      : [utcYesterdayCalendarDate()];

  await rebuildPullRequestFactsFromRaw();
  await rebuildEngineerDailyFacts();

  for (const end of ends) {
    await rebuildEngineer90dRollups(end);
  }
}
