import "dotenv/config";
import { createApp } from "./app.js";
import { prisma } from "./db.js";

const port = Number(process.env.PORT ?? 4000);
/** Render / Docker / PaaS require listening on all interfaces, not only localhost. */
const host = process.env.HOST ?? "0.0.0.0";
const app = createApp();

const server = app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(
    `Listening on http://${host}:${port} (API + /health; static UI if web/dist exists from monorepo build)`,
  );
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
