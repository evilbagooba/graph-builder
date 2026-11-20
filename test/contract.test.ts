// Contract tests against tako's fixture projects: every fixture still loads
// through the same path the hub and the file opener use,
// and stays within what this app can store and draw.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { describe, it } from "node:test";
import { migrateProject, normalizeProject, projectSchema } from "tako";

const dir = dirname(fileURLToPath(import.meta.resolve("tako/fixtures/bird-feeder.json")));
const names = readdirSync(dir).filter((f) => f.endsWith(".json"));

describe("tako fixtures", () => {
  it("are installed", () => assert.ok(names.length > 0));
  for (const name of names) {
    it(`${name} opens and saves`, () => {
      const doc = JSON.parse(readFileSync(`${dir}/${name}`, "utf8"));
      const project = migrateProject(doc, "Imported");
      // What saving it does.
      const saved = normalizeProject(projectSchema.parse(JSON.parse(JSON.stringify(project))));
      assert.deepEqual(saved, project);
      for (const n of project.nodes) assert.ok(["circle", "emoji", "image"].includes(n.shape));
    });
  }
});
