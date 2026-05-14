import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { apiRouter } from "./routes/api.js";
import { attachWebDistIfPresent } from "./staticWeb.js";

export function createApp() {
  const app = express();
  app.use(cors({ origin: process.env.CORS_ORIGIN ?? true }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api", apiRouter);

  // Production / full-stack: serve Vite build from `web/dist` when present (after `npm run build`).
  attachWebDistIfPresent(app);

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: "bad_request", message: err.message });
      return;
    }
    if (err instanceof Prisma.PrismaClientInitializationError) {
      res.status(503).json({
        error: "database_unavailable",
        message:
          "Cannot reach Postgres. Set DATABASE_URL in server/.env and run migrations (see README).",
      });
      return;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      res.status(500).json({ error: "database_error", code: err.code, message: err.message });
      return;
    }
    console.error(err);
    const message = err instanceof Error ? err.message : "internal_error";
    res.status(500).json({ error: "internal_error", message });
  });

  return app;
}
