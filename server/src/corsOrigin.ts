import type { CorsOptions } from "cors";

/**
 * - Unset / empty `CORS_ORIGIN` → echo the request `Origin` (works for split Render UI + API).
 * - Comma-separated exact origins (no trailing slash), e.g.
 *   `http://localhost:5173,https://my-web.onrender.com`
 * - A single origin string → only that origin is allowed.
 *
 * Avoid copying only `http://localhost:5173` into production: the real UI origin must be listed too.
 */
export function corsOriginFromEnv(): CorsOptions["origin"] {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) return true;

  const allowed = raw
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);

  if (allowed.length === 0) return true;

  return (requestOrigin: string | undefined, callback: (err: Error | null, allow?: boolean | string) => void) => {
    if (!requestOrigin) {
      callback(null, true);
      return;
    }
    const o = requestOrigin.replace(/\/$/, "");
    if (allowed.includes(o)) {
      callback(null, o);
      return;
    }
    callback(new Error("Not allowed by CORS"));
  };
}
