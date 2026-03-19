import path from "node:path";
import process from "node:process";
import { getCodeCockpitRuntime } from "../../src/code-cockpit/runtime.js";

function parseArgs(argv: string[]) {
  let repoRoot: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") {
      repoRoot = argv[index + 1];
      index += 1;
    }
  }
  return {
    repoRoot: repoRoot ? path.resolve(repoRoot) : undefined,
  };
}

const { repoRoot } = parseArgs(process.argv.slice(2));
const result = await getCodeCockpitRuntime().supervisorTick({ repoRoot });
console.log(JSON.stringify(result, null, 2));
