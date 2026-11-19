// Contract tests for the project format, ops and history.
// Run with `npm test`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OpError,
  SCHEMA_VERSION,
  applyOps,
  canRedo,
  canUndo,
  commit,
  commitFrom,
  createHistory,
  emptyProject,
  migrateProject,
  preview,
  redo,
  undo,
  type Op,
  type Project,
  type ProjectNode,
} from "./index";

function node(id: string, extra: Partial<ProjectNode> = {}): ProjectNode {
  return {
    id,
    title: id,
    subtitle: "",
    body: "",
    color: "paper",
    size: "md",
    dimmed: false,
    shape: "circle",
    emoji: "",
    image: "",
    kind: "",
    provenance: null,
    x: 0,
    y: 0,
    ...extra,
  };
}

function project(): Project {
  return applyOps(emptyProject("Test"), [
    { type: "add_node", node: node("a") },
    { type: "add_node", node: node("b") },
    { type: "add_node", node: node("c") },
    { type: "add_edge", edge: { id: "ab", from: "a", to: "b", label: "", style: "solid", arrow: "forward" } },
    { type: "add_edge", edge: { id: "bc", from: "b", to: "c", label: "", style: "solid", arrow: "forward" } },
  ]);
}

describe("migrateProject", () => {
  it("upgrades an unversioned document: kind (shape) → shape, fills defaults", () => {
    const v0 = {
      nodes: [
        { id: "n", title: "N", subtitle: "", body: "", color: "teal", size: "md", dimmed: false, kind: "emoji", emoji: "💡", x: 1, y: 2 },
        { id: "m", title: "M", subtitle: "", body: "", color: "teal", size: "md", dimmed: false, x: 3, y: 4 },
      ],
      edges: [{ id: "e", from: "n", to: "m", label: "x", style: "solid", arrow: "none" }],
    };
    const p = migrateProject(v0, "Stored title");
    assert.equal(p.schemaVersion, SCHEMA_VERSION);
    assert.equal(p.title, "Stored title");
    assert.equal(p.nodes[0]!.shape, "emoji");
    assert.equal(p.nodes[0]!.kind, "");
    assert.equal(p.nodes[1]!.shape, "circle");
    assert.deepEqual(p.work, []);
    assert.deepEqual(p.narratives, []);
    assert.deepEqual(p.legend, {});
  });

  it("drops dangling references and blank legend meanings", () => {
    const p = migrateProject({
      schemaVersion: 1,
      title: "T",
      nodes: [node("a")],
      edges: [{ id: "e", from: "a", to: "gone", label: "", style: "solid", arrow: "none" }],
      legend: { "color:teal": "  " },
      narratives: [{ id: "n", name: "Talk", nodeIds: ["a", "gone"] }],
    });
    assert.equal(p.edges.length, 0);
    assert.deepEqual(p.legend, {});
    assert.deepEqual(p.narratives[0]!.nodeIds, ["a"]);
  });

  it("rejects documents that aren't projects", () => {
    assert.throws(() => migrateProject(null));
    assert.throws(() => migrateProject({ schemaVersion: 1, title: "T", nodes: "nope", edges: [] }));
  });
});

describe("ops", () => {
  it("keeps untouched objects identical (structural sharing)", () => {
    const p = project();
    const q = applyOps(p, [{ type: "move_node", id: "a", x: 10, y: 20 }]);
    assert.notEqual(q.nodes[0], p.nodes[0]);
    assert.equal(q.nodes[1], p.nodes[1]);
    assert.equal(q.edges, p.edges);
  });

  it("remove_node takes its edges, work and narrative stops with it", () => {
    const p = applyOps(project(), [
      { type: "spawn_work", work: { id: "w", nodeId: "b", title: "Try it", kind: "experiment", status: "todo", outcome: "", link: "" } },
      { type: "create_narrative", narrative: { id: "talk", name: "Talk", nodeIds: ["a", "b", "c"] } },
      { type: "remove_node", id: "b" },
    ]);
    assert.deepEqual(p.nodes.map((n) => n.id), ["a", "c"]);
    assert.equal(p.edges.length, 0);
    assert.equal(p.work.length, 0);
    assert.deepEqual(p.narratives[0]!.nodeIds, ["a", "c"]);
  });

  it("merge_nodes rewires edges and drops the edge between the pair", () => {
    const p = applyOps(project(), [{ type: "merge_nodes", a: "a", b: "b" }]);
    assert.deepEqual(p.nodes.map((n) => n.id), ["a", "c"]);
    assert.deepEqual(p.edges.map((e) => [e.from, e.to]), [["a", "c"]]);
  });

  it("set_centre moves the centre tag", () => {
    const p = applyOps(project(), [
      { type: "set_centre", id: "a" },
      { type: "set_centre", id: "c" },
    ]);
    assert.deepEqual(p.nodes.map((n) => n.kind), ["", "", "centre"]);
  });

  it("set_legend with an empty meaning removes the entry", () => {
    const p = applyOps(project(), [
      { type: "set_legend", key: "color:teal", meaning: "Ideas" },
      { type: "set_legend", key: "color:teal", meaning: "" },
    ]);
    assert.deepEqual(p.legend, {});
  });

  it("rejects invalid ops and is atomic", () => {
    const p = project();
    const bad: Op[] = [
      { type: "move_node", id: "a", x: 5, y: 5 },
      { type: "add_edge", edge: { id: "x", from: "a", to: "nope", label: "", style: "solid", arrow: "none" } },
    ];
    assert.throws(() => applyOps(p, bad), OpError);
    assert.equal(p.nodes[0]!.x, 0); // the first op didn't leak
    assert.throws(() => applyOps(p, [{ type: "add_node", node: node("a") }]), OpError);
    assert.throws(
      () => applyOps(p, [{ type: "add_edge", edge: { id: "self", from: "a", to: "a", label: "", style: "solid", arrow: "none" } }]),
      OpError,
    );
  });
});

describe("history", () => {
  it("undoes and redoes steps", () => {
    let h = createHistory(project());
    h = commit(h, [{ type: "set_title", title: "One" }]);
    h = commit(h, [{ type: "set_title", title: "Two" }]);
    assert.equal(h.present.title, "Two");
    h = undo(h);
    assert.equal(h.present.title, "One");
    h = redo(h);
    assert.equal(h.present.title, "Two");
    h = undo(undo(h));
    assert.equal(h.present.title, "Test");
    assert.equal(canUndo(h), false);
    assert.equal(canRedo(h), true);
  });

  it("coalesces rapid edits with the same key into one step", () => {
    let h = createHistory(project());
    h = commit(h, [{ type: "set_title", title: "T" }], { coalesceKey: "title", now: 0 });
    h = commit(h, [{ type: "set_title", title: "Ti" }], { coalesceKey: "title", now: 300 });
    h = commit(h, [{ type: "set_title", title: "Tit" }], { coalesceKey: "title", now: 600 });
    assert.equal(h.past.length, 1);
    h = commit(h, [{ type: "set_title", title: "Title" }], { coalesceKey: "title", now: 5000 });
    assert.equal(h.past.length, 2);
    assert.equal(undo(undo(h)).present.title, "Test");
  });

  it("a previewed drag commits as a single step", () => {
    let h = createHistory(project());
    const base = h.present;
    for (let x = 1; x <= 30; x++) h = preview(h, [{ type: "move_node", id: "a", x, y: 0 }]);
    assert.equal(h.past.length, 0);
    h = commitFrom(h, base);
    assert.equal(h.past.length, 1);
    assert.equal(h.present.nodes[0]!.x, 30);
    assert.equal(undo(h).present.nodes[0]!.x, 0);
  });

  it("a new commit clears the redo stack", () => {
    let h = commit(createHistory(project()), [{ type: "set_title", title: "A" }]);
    h = undo(h);
    h = commit(h, [{ type: "set_title", title: "B" }]);
    assert.equal(canRedo(h), false);
  });

  it("a failing commit leaves history unchanged", () => {
    const h = createHistory(project());
    assert.throws(() => commit(h, [{ type: "remove_edge", id: "nope" }]), OpError);
  });
});
