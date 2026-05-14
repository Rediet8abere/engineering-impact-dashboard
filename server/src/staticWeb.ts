import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import express from "express";

/** Monorepo root: parent of `server/` (works for both `server/src/*.ts` and `server/dist/*.js`). */
export function monorepoRootDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..");
}

export function attachWebDistIfPresent(app: Express): void {
  const dist = path.join(monorepoRootDir(), "web", "dist");
  const indexHtml = path.join(dist, "index.html");
  if (!fs.existsSync(indexHtml)) {
    return;
  }

  app.use(express.static(dist, { index: false, maxAge: "1h" }));

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(indexHtml, (err) => {
      if (err) next(err);
    });
  });
}
