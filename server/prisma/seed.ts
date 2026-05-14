import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const WINDOW_END = "2026-05-14";

const engineers = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    githubLogin: "alice-dev",
    displayName: "Alice Rivera",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    githubLogin: "bob-dev",
    displayName: "Bob Chen",
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    githubLogin: "charlie-dev",
    displayName: "Charlie Kim",
  },
  {
    id: "44444444-4444-4444-4444-444444444444",
    githubLogin: "dana-dev",
    displayName: "Dana Patel",
  },
  {
    id: "55555555-5555-5555-5555-555555555555",
    githubLogin: "evan-dev",
    displayName: "Evan Lopez",
  },
] as const;

function prPayload(args: {
  id: number;
  login: string;
  created: string;
  merged: string;
  additions: number;
  deletions: number;
  changed_files: number;
  labels: string[];
}) {
  return {
    action: "closed",
    pull_request: {
      id: args.id,
      number: args.id % 100000,
      merged: true,
      merged_at: `${args.merged}T16:00:00Z`,
      created_at: `${args.created}T10:00:00Z`,
      additions: args.additions,
      deletions: args.deletions,
      changed_files: args.changed_files,
      user: { login: args.login, id: 1 },
      labels: args.labels.map((name) => ({ name })),
      base: { repo: { full_name: "PostHog/posthog" } },
    },
  };
}

export async function main() {
  await prisma.rawGitHubEvent.deleteMany();
  await prisma.pullRequestFact.deleteMany();
  await prisma.engineerDailyFact.deleteMany();
  await prisma.engineer90dRollups.deleteMany();
  await prisma.engineer.deleteMany();

  for (const e of engineers) {
    await prisma.engineer.create({ data: { id: e.id, githubLogin: e.githubLogin, displayName: e.displayName } });
  }

  const repo = "PostHog/posthog";
  const events: Array<{ dedupeKey: string; deliveryId: string; payload: unknown }> = [];

  let nextPrId = 200001;
  type PrSpec = Omit<Parameters<typeof prPayload>[0], "id" | "login" | "created" | "merged">;
  const push = (login: string, created: string, merged: string, spec: PrSpec) => {
    const prId = nextPrId++;
    const payload = prPayload({ id: prId, login, created, merged, ...spec });
    events.push({
      dedupeKey: `seed:pr:${prId}`,
      deliveryId: `seed-del-${prId}`,
      payload,
    });
  };

  // Alice: steady merges across many days + hogql/security mix
  const aliceDays = [
    "2026-02-18",
    "2026-02-25",
    "2026-03-04",
    "2026-03-11",
    "2026-03-18",
    "2026-03-25",
    "2026-04-02",
    "2026-04-09",
    "2026-04-16",
    "2026-04-23",
    "2026-04-30",
    "2026-05-07",
    "2026-05-13",
  ];
  for (const day of aliceDays) {
    push("alice-dev", day, day, {
      additions: 420,
      deletions: 110,
      changed_files: 9,
      labels: ["hogql", "many-reviews"],
    });
  }

  // Bob: burst merges in a short window (same week)
  for (const day of ["2026-04-28", "2026-04-29", "2026-04-30"]) {
    for (let i = 0; i < 4; i += 1) {
      push("bob-dev", day, day, {
        additions: 40,
        deletions: 5,
        changed_files: 2,
        labels: ["few-reviews"],
      });
    }
  }

  // Charlie: moderate spread
  for (const day of ["2026-03-02", "2026-03-16", "2026-04-01", "2026-04-15", "2026-05-01"]) {
    push("charlie-dev", day, day, {
      additions: 220,
      deletions: 60,
      changed_files: 6,
      labels: ["frontend"],
    });
  }

  // Dana: churn + revert + hotfix labels
  for (const day of ["2026-02-20", "2026-03-10", "2026-04-05", "2026-05-02"]) {
    push("dana-dev", day, day, {
      additions: 900,
      deletions: 400,
      changed_files: 22,
      labels: ["churn", "revert", "hotfix", "security", "many-reviews"],
    });
  }

  // Evan: low volume
  push("evan-dev", "2026-04-12", "2026-04-12", {
    additions: 80,
    deletions: 10,
    changed_files: 3,
    labels: ["ingestion"],
  });

  for (const ev of events) {
    await prisma.rawGitHubEvent.create({
      data: {
        dedupeKey: ev.dedupeKey,
        deliveryId: ev.deliveryId,
        eventType: "pull_request",
        action: "closed",
        repoFullName: repo,
        payload: ev.payload as object,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded ${engineers.length} engineers and ${events.length} raw PR events.`);
  // eslint-disable-next-line no-console
  console.log(`Run ETL with window end ${WINDOW_END}: npm run etl --workspace server -- ${WINDOW_END}`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
