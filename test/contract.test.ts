// Contract tests against core's fixture projects: every fixture still loads
// through the same path the server uses for stored and imported documents,
// and stays within what this app can store and draw.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { describe, it } from "node:test";
import { migrateProject, normalizeProject, projectSchema } from "core";

const dir = dirname(fileURLToPath(import.meta.resolve("core/fixtures/bird-feeder.json")));
const names = readdirSync(dir).filter((f) => f.endsWith(".json"));

describe("core fixtures", () => {
  it("are installed", () => assert.ok(names.length > 0));
  for (const name of names) {
    it(`${name} opens and saves`, () => {
      const doc = JSON.parse(readFileSync(`${dir}/${name}`, "utf8"));
      const project = migrateProject(doc, "Imported");
      // What saveGraph does with it.
      const saved = normalizeProject(projectSchema.parse(JSON.parse(JSON.stringify(project))));
      assert.deepEqual(saved, project);
      for (const n of project.nodes) assert.ok(["circle", "emoji", "image"].includes(n.shape));
    });
  }
});
