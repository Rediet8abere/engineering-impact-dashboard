import "dotenv/config";
import { parseEtlArgv, printEtlHelp, resolveWindowEndsFromCli } from "./parseArgs.js";
import { runFullEtl } from "./pipeline.js";

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseEtlArgv(argv);

  if (parsed.help) {
    printEtlHelp();
    return;
  }

  const windowEnds = resolveWindowEndsFromCli(parsed);
  await runFullEtl(windowEnds);

  // eslint-disable-next-line no-console
  console.log("ETL completed", {
    windowEnds: windowEnds.map((d) => d.toISOString().slice(0, 10)),
    rollupSnapshots: windowEnds.length,
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
