// Fails the build when the client bundle outgrows its budget (gzipped bytes,
// summed per file type). Raise a budget deliberately, in review, not to make
// a build pass: the point is to notice when a dependency or feature adds weight.

import { readdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_KB = { ".js": 100, ".css": 10 };

const dir = new URL("../client/dist/assets/", import.meta.url).pathname;
const totals = {};
for (const file of readdirSync(dir)) {
  const ext = extname(file);
  if (!(ext in BUDGET_KB)) continue;
  totals[ext] = (totals[ext] ?? 0) + gzipSync(readFileSync(join(dir, file))).length;
}

let failed = false;
for (const [ext, limit] of Object.entries(BUDGET_KB)) {
  const kb = (totals[ext] ?? 0) / 1024;
  const over = kb > limit;
  failed ||= over;
  console.log(`${over ? "✗" : "✓"} ${ext.slice(1).padEnd(3)} ${kb.toFixed(1)} kB gzip (budget ${limit} kB)`);
}
if (failed) {
  console.error("Bundle over budget — see scripts/check-size.mjs.");
  process.exit(1);
}
