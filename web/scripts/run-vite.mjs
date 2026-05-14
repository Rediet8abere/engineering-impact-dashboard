/**
 * Run the Vite CLI without relying on `node_modules/.bin` being on PATH
 * (npm workspaces hoist `vite` to the monorepo root — Render `cwd=web/` → exit 127).
 *
 * Usage: node scripts/run-vite.mjs <vite-args...>
 * Examples: node scripts/run-vite.mjs build
 *             node scripts/run-vite.mjs preview
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");
const monorepoRoot = join(webRoot, "..");

const require = createRequire(join(webRoot, "package.json"));

function resolveViteCli(): string {
  const searchRoots = [webRoot, monorepoRoot];
  const rels = ["vite/bin/vite.js"];

  for (const root of searchRoots) {
    for (const rel of rels) {
      try {
        return require.resolve(rel, { paths: [root] });
      } catch {
        /* try next */
      }
    }
  }

  console.error(
    "[web] Could not resolve `vite`. Install from the monorepo root (parent of `web/`) so dependencies hoist, e.g.\n" +
      "  cd .. && npm install\n" +
      "Render: set **Root Directory** to the folder that contains root `package.json` (not only `web/`).",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("[web] Usage: node scripts/run-vite.mjs <vite-args…>  (e.g. `build`, `preview`, `dev`)");
  process.exit(1);
}

if (args[0] === "preview") {
  const indexHtml = join(webRoot, "dist", "index.html");
  if (!existsSync(indexHtml)) {
    console.error(
      "[web] `dist/index.html` is missing. Run a production build before `preview`, e.g.\n" +
        "  npm run build -w web\n" +
        "or on Render set **Build Command** to include that (or `cd .. && npm run build`).",
    );
    process.exit(1);
  }
}

const viteCli = resolveViteCli();

const child = spawn(process.execPath, [viteCli, ...args], {
  stdio: "inherit",
  cwd: webRoot,
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
