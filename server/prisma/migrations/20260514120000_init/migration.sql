-- CreateTable
CREATE TABLE "Engineer" (
    "id" UUID NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,

    CONSTRAINT "Engineer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Engineer_githubLogin_key" ON "Engineer"("githubLogin");

-- CreateTable
CREATE TABLE "raw_github_events" (
    "id" UUID NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "deliveryId" TEXT,
    "eventType" TEXT NOT NULL,
    "action" TEXT,
    "repoFullName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_github_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "raw_github_events_dedupeKey_key" ON "raw_github_events"("dedupeKey");
CREATE INDEX "raw_github_events_receivedAt_idx" ON "raw_github_events"("receivedAt");
CREATE INDEX "raw_github_events_eventType_receivedAt_idx" ON "raw_github_events"("eventType", "receivedAt");

-- CreateTable
CREATE TABLE "pull_request_facts" (
    "prId" BIGINT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "authorEngineerId" UUID NOT NULL,
    "subsystemSlug" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,
    "mergedAt" TIMESTAMPTZ(6),
    "cycleTimeHours" DOUBLE PRECISION,
    "mergeWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "churnScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isRevert" BOOLEAN NOT NULL DEFAULT false,
    "isHotfix" BOOLEAN NOT NULL DEFAULT false,
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "changedFiles" INTEGER NOT NULL DEFAULT 0,
    "reviewsDistinct" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pull_request_facts_pkey" PRIMARY KEY ("prId")
);

CREATE INDEX "pull_request_facts_authorEngineerId_mergedAt_idx" ON "pull_request_facts"("authorEngineerId", "mergedAt");
CREATE INDEX "pull_request_facts_repoFullName_mergedAt_idx" ON "pull_request_facts"("repoFullName", "mergedAt");

-- CreateTable
CREATE TABLE "engineer_daily_facts" (
    "engineerId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "merges" INTEGER NOT NULL DEFAULT 0,
    "weightedMerges" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewsSubmitted" INTEGER NOT NULL DEFAULT 0,
    "sumCycleTimeHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "prsWithCycleTime" INTEGER NOT NULL DEFAULT 0,
    "churnEvents" INTEGER NOT NULL DEFAULT 0,
    "revertEvents" INTEGER NOT NULL DEFAULT 0,
    "hotfixMerges" INTEGER NOT NULL DEFAULT 0,
    "activeMergeDay" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineer_daily_facts_pkey" PRIMARY KEY ("engineerId","day")
);

CREATE INDEX "engineer_daily_facts_engineerId_day_idx" ON "engineer_daily_facts"("engineerId", "day");
CREATE INDEX "engineer_daily_facts_day_idx" ON "engineer_daily_facts"("day");

ALTER TABLE "engineer_daily_facts" ADD CONSTRAINT "engineer_daily_facts_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "Engineer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "engineer_90d_rollups" (
    "engineerId" UUID NOT NULL,
    "windowEnd" DATE NOT NULL,
    "throughputScore" DOUBLE PRECISION NOT NULL,
    "consistencyScore" DOUBLE PRECISION NOT NULL,
    "reviewQualityScore" DOUBLE PRECISION NOT NULL,
    "stabilityScore" DOUBLE PRECISION NOT NULL,
    "subsystemComplexityScore" DOUBLE PRECISION NOT NULL,
    "impactScore" DOUBLE PRECISION NOT NULL,
    "merges90d" INTEGER NOT NULL DEFAULT 0,
    "weightedMerges90d" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "medianCycleHours" DOUBLE PRECISION,
    "activeDays" INTEGER NOT NULL DEFAULT 0,
    "activeWeeks" INTEGER NOT NULL DEFAULT 0,
    "explainJson" JSONB NOT NULL,
    "subsystemBreakdownJson" JSONB NOT NULL,
    "dailyTimelineJson" JSONB NOT NULL,
    "weeklyTimelineJson" JSONB NOT NULL,
    "asOf" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineer_90d_rollups_pkey" PRIMARY KEY ("engineerId","windowEnd")
);

CREATE INDEX "engineer_90d_rollups_windowEnd_impactScore_idx" ON "engineer_90d_rollups"("windowEnd", "impactScore" DESC);

ALTER TABLE "engineer_90d_rollups" ADD CONSTRAINT "engineer_90d_rollups_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "Engineer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
