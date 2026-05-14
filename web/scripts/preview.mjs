/**
 * Resolve `vite` from this workspace (follows hoisting to monorepo root `node_modules`).
 * Avoids shell `vite` not found (exit 127) when Render cwd is `web/` but binaries live at repo root.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");
const require = createRequire(join(webRoot, "package.json"));

const viteCli = require.resolve("vite/bin/vite.js");

const child = spawn(process.execPath, [viteCli, "preview", ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: webRoot,
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
