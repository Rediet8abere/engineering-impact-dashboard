import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";

export const apiRouter = Router();

const windowSchema = z.enum(["90d"]);

async function latestWindowEnd(): Promise<Date | null> {
  const row = await prisma.engineer90dRollups.findFirst({
    orderBy: { windowEnd: "desc" },
    select: { windowEnd: true },
  });
  return row?.windowEnd ?? null;
}

apiRouter.get("/snapshot/current", async (_req, res) => {
  const windowEnd = await latestWindowEnd();
  if (!windowEnd) {
    res.status(404).json({ error: "no_rollups" });
    return;
  }

  const rollup = await prisma.engineer90dRollups.findFirst({
    where: { windowEnd },
    orderBy: { asOf: "desc" },
    select: { asOf: true, windowEnd: true },
  });

  res.json({
    window: "90d",
    window_end: windowEnd.toISOString().slice(0, 10),
    as_of: rollup?.asOf?.toISOString() ?? null,
  });
});

apiRouter.get("/leaderboard", async (req, res) => {
  const query = z
    .object({
      window: windowSchema,
      limit: z.coerce.number().int().min(1).max(50).default(5),
    })
    .parse(req.query);

  const windowEnd = await latestWindowEnd();
  if (!windowEnd) {
    res.status(404).json({ error: "no_rollups" });
    return;
  }

  const rows = await prisma.engineer90dRollups.findMany({
    where: { windowEnd },
    orderBy: [{ impactScore: "desc" }, { engineerId: "asc" }],
    take: query.limit,
    include: {
      engineer: { select: { id: true, githubLogin: true, displayName: true } },
    },
  });

  res.json({
    snapshot: {
      window: query.window,
      window_end: windowEnd.toISOString().slice(0, 10),
    },
    rows: rows.map((r, idx) => ({
      rank: idx + 1,
      engineer_id: r.engineerId,
      github_login: r.engineer.githubLogin,
      display_name: r.engineer.displayName,
      impact_score: r.impactScore,
      merges_90d: r.merges90d,
      weighted_merges_90d: r.weightedMerges90d,
      subscores: {
        throughput: r.throughputScore,
        consistency: r.consistencyScore,
        review_quality: r.reviewQualityScore,
        stability: r.stabilityScore,
        subsystem_complexity: r.subsystemComplexityScore,
      },
    })),
  });
});

apiRouter.get("/engineers/:engineerId/impact", async (req, res) => {
  const params = z.object({ engineerId: z.string().uuid() }).parse(req.params);
  z.object({ window: windowSchema }).parse(req.query);

  const windowEnd = await latestWindowEnd();
  if (!windowEnd) {
    res.status(404).json({ error: "no_rollups" });
    return;
  }

  const rollup = await prisma.engineer90dRollups.findUnique({
    where: {
      engineerId_windowEnd: { engineerId: params.engineerId, windowEnd },
    },
    include: {
      engineer: { select: { id: true, githubLogin: true, displayName: true } },
    },
  });

  if (!rollup) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  res.json({
    snapshot: { window: "90d", window_end: windowEnd.toISOString().slice(0, 10) },
    engineer: rollup.engineer,
    impact_score: rollup.impactScore,
    subscores: {
      throughput: rollup.throughputScore,
      consistency: rollup.consistencyScore,
      review_quality: rollup.reviewQualityScore,
      stability: rollup.stabilityScore,
      subsystem_complexity: rollup.subsystemComplexityScore,
    },
    metrics: {
      merges_90d: rollup.merges90d,
      weighted_merges_90d: rollup.weightedMerges90d,
      median_cycle_hours: rollup.medianCycleHours,
      active_days: rollup.activeDays,
      active_weeks: rollup.activeWeeks,
    },
    explain: rollup.explainJson,
  });
});

apiRouter.get("/engineers/:engineerId/timeline", async (req, res) => {
  const params = z.object({ engineerId: z.string().uuid() }).parse(req.params);
  const query = z
    .object({
      window: windowSchema,
      granularity: z.enum(["daily", "weekly"]).default("daily"),
    })
    .parse(req.query);

  const windowEnd = await latestWindowEnd();
  if (!windowEnd) {
    res.status(404).json({ error: "no_rollups" });
    return;
  }

  if (query.granularity === "weekly") {
    const rollup = await prisma.engineer90dRollups.findUnique({
      where: {
        engineerId_windowEnd: { engineerId: params.engineerId, windowEnd },
      },
      select: { weeklyTimelineJson: true },
    });
    if (!rollup) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({
      snapshot: { window: "90d", window_end: windowEnd.toISOString().slice(0, 10) },
      granularity: "weekly",
      series: rollup.weeklyTimelineJson,
    });
    return;
  }

  const start = new Date(windowEnd);
  start.setUTCDate(start.getUTCDate() - 89);

  const daily = await prisma.engineerDailyFact.findMany({
    where: {
      engineerId: params.engineerId,
      day: { gte: start, lte: windowEnd },
    },
    orderBy: { day: "asc" },
    select: {
      day: true,
      merges: true,
      weightedMerges: true,
      reviewsSubmitted: true,
    },
  });

  res.json({
    snapshot: { window: "90d", window_end: windowEnd.toISOString().slice(0, 10) },
    granularity: "daily",
    series: daily.map((d) => ({
      day: d.day.toISOString().slice(0, 10),
      merges: d.merges,
      weighted_merges: d.weightedMerges,
      reviews_submitted: d.reviewsSubmitted,
    })),
  });
});

apiRouter.get("/engineers/:engineerId/subsystems", async (req, res) => {
  const params = z.object({ engineerId: z.string().uuid() }).parse(req.params);
  z.object({ window: windowSchema }).parse(req.query);

  const windowEnd = await latestWindowEnd();
  if (!windowEnd) {
    res.status(404).json({ error: "no_rollups" });
    return;
  }

  const rollup = await prisma.engineer90dRollups.findUnique({
    where: {
      engineerId_windowEnd: { engineerId: params.engineerId, windowEnd },
    },
    select: { subsystemBreakdownJson: true },
  });

  if (!rollup) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  res.json({
    snapshot: { window: "90d", window_end: windowEnd.toISOString().slice(0, 10) },
    items: rollup.subsystemBreakdownJson,
  });
});
