import cors from "cors";
import express from "express";
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

  return app;
}
