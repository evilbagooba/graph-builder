// Fails the build when the first-load bundle outgrows its budget (gzipped
// bytes, summed per file type). Raise a budget deliberately, in review, not
// to make a build pass: the point is to notice when a dependency or feature
// adds weight.
//
// "First load" is what index.html pulls in. Chunks loaded on demand (the
// validation schemas, fetched only when a file is opened or saved without
// the hub) are reported but don't count against the budget.

import { readdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_KB = { ".js": 100, ".css": 10 };

const dist = new URL("../client/dist/", import.meta.url).pathname;
const html = readFileSync(join(dist, "index.html"), "utf8");
const dir = join(dist, "assets");
const totals = {};
const lazy = [];
for (const file of readdirSync(dir)) {
  const ext = extname(file);
  if (!(ext in BUDGET_KB)) continue;
  const size = gzipSync(readFileSync(join(dir, file))).length;
  if (html.includes(file)) totals[ext] = (totals[ext] ?? 0) + size;
  else lazy.push([file, size]);
}

let failed = false;
for (const [ext, limit] of Object.entries(BUDGET_KB)) {
  const kb = (totals[ext] ?? 0) / 1024;
  const over = kb > limit;
  failed ||= over;
  console.log(`${over ? "✗" : "✓"} ${ext.slice(1).padEnd(3)} ${kb.toFixed(1)} kB gzip first load (budget ${limit} kB)`);
}
for (const [file, size] of lazy) console.log(`  on demand: ${file} ${(size / 1024).toFixed(1)} kB gzip`);
if (failed) {
  console.error("Bundle over budget — see scripts/check-size.mjs.");
  process.exit(1);
}
