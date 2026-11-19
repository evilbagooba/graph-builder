// The operations layer: every change to a project is an Op, applied by one
// pure reducer. UI controls (and later chat, as tool calls) produce ops;
// nothing mutates a project any other way. Ops are small, inspectable and
// reversible via history.ts.

import type { Artifact, Narrative, Project, ProjectEdge, ProjectNode, Work } from "./project";

type NodePatch = Partial<Omit<ProjectNode, "id">>;
type EdgePatch = Partial<Omit<ProjectEdge, "id">>;
type WorkPatch = Partial<Omit<Work, "id">>;

export type Op =
  | { type: "set_title"; title: string }
  | { type: "add_node"; node: ProjectNode }
  | { type: "update_node"; id: string; patch: NodePatch }
  | { type: "move_node"; id: string; x: number; y: number }
  | { type: "remove_node"; id: string }
  /** Fold `b` into `a`: b's edges, work and narrative stops move to a. */
  | { type: "merge_nodes"; a: string; b: string }
  /** Tag `id` as the centre; any other centre loses the tag. */
  | { type: "set_centre"; id: string }
  | { type: "add_edge"; edge: ProjectEdge }
  | { type: "update_edge"; id: string; patch: EdgePatch }
  | { type: "remove_edge"; id: string }
  /** Set what a visual option means; an empty meaning removes it. */
  | { type: "set_legend"; key: string; meaning: string }
  | { type: "spawn_work"; work: Work }
  | { type: "update_work"; id: string; patch: WorkPatch }
  | { type: "attach_outcome"; workId: string; outcome: string }
  | { type: "remove_work"; id: string }
  | { type: "add_artifact"; artifact: Artifact }
  | { type: "remove_artifact"; id: string }
  | { type: "create_narrative"; narrative: Narrative }
  | { type: "rename_narrative"; id: string; name: string }
  /** Replace a path's stops (append, remove and reorder all go through this). */
  | { type: "reorder_narrative"; id: string; nodeIds: string[] }
  | { type: "remove_narrative"; id: string };

/** An op that can't apply to this project (unknown id, duplicate id…). */
export class OpError extends Error {
  constructor(
    message: string,
    readonly op: Op,
  ) {
    super(message);
  }
}

function patchById<T extends { id: string }>(
  items: T[],
  id: string,
  patch: NoInfer<Partial<T>>,
  op: Op,
): T[] {
  let found = false;
  const next = items.map((it) => {
    if (it.id !== id) return it;
    found = true;
    return { ...it, ...patch };
  });
  if (!found) throw new OpError(`No item with id "${id}".`, op);
  return next;
}

function requireNode(p: Project, id: string, op: Op) {
  if (!p.nodes.some((n) => n.id === id)) throw new OpError(`No node with id "${id}".`, op);
}

function requireStops(p: Project, ids: readonly string[], op: Op) {
  for (const id of ids) requireNode(p, id, op);
  if (new Set(ids).size !== ids.length) throw new OpError("A path can't visit a node twice.", op);
}

function requireFree<T extends { id: string }>(items: T[], id: string, op: Op) {
  if (items.some((it) => it.id === id)) throw new OpError(`Id "${id}" is already in use.`, op);
}

/** Apply one op. Pure: returns a new project (sharing every untouched
 * object with the old one), or throws OpError. */
export function applyOp(p: Project, op: Op): Project {
  switch (op.type) {
    case "set_title":
      return { ...p, title: op.title };

    case "add_node":
      requireFree(p.nodes, op.node.id, op);
      return { ...p, nodes: [...p.nodes, op.node] };

    case "update_node":
      return { ...p, nodes: patchById(p.nodes, op.id, op.patch, op) };

    case "move_node":
      return { ...p, nodes: patchById(p.nodes, op.id, { x: op.x, y: op.y }, op) };

    case "remove_node": {
      requireNode(p, op.id, op);
      const workIds = new Set(p.work.filter((w) => w.nodeId === op.id).map((w) => w.id));
      return {
        ...p,
        nodes: p.nodes.filter((n) => n.id !== op.id),
        edges: p.edges.filter((e) => e.from !== op.id && e.to !== op.id),
        work: p.work.filter((w) => w.nodeId !== op.id),
        artifacts: p.artifacts.filter(
          (a) => a.nodeId !== op.id && (a.workId === null || !workIds.has(a.workId)),
        ),
        narratives: p.narratives.map((n) =>
          n.nodeIds.includes(op.id) ? { ...n, nodeIds: n.nodeIds.filter((i) => i !== op.id) } : n,
        ),
      };
    }

    case "merge_nodes": {
      const { a, b } = op;
      requireNode(p, a, op);
      requireNode(p, b, op);
      if (a === b) throw new OpError("Can't merge a node into itself.", op);
      const seen = new Set<string>();
      const edges: ProjectEdge[] = [];
      for (const e of p.edges) {
        const from = e.from === b ? a : e.from;
        const to = e.to === b ? a : e.to;
        if (from === to) continue; // the edge between a and b disappears
        const key = `${from}>${to}`;
        if (seen.has(key)) continue; // a duplicate after rewiring
        seen.add(key);
        edges.push(from === e.from && to === e.to ? e : { ...e, from, to });
      }
      return {
        ...p,
        nodes: p.nodes.filter((n) => n.id !== b),
        edges,
        work: p.work.map((w) => (w.nodeId === b ? { ...w, nodeId: a } : w)),
        artifacts: p.artifacts.map((x) => (x.nodeId === b ? { ...x, nodeId: a } : x)),
        narratives: p.narratives.map((n) => {
          if (!n.nodeIds.includes(b)) return n;
          const ids = n.nodeIds.map((i) => (i === b ? a : i));
          return { ...n, nodeIds: ids.filter((i, k) => ids.indexOf(i) === k) };
        }),
      };
    }

    case "set_centre":
      requireNode(p, op.id, op);
      return {
        ...p,
        nodes: p.nodes.map((n) =>
          n.id === op.id
            ? n.kind === "centre"
              ? n
              : { ...n, kind: "centre" }
            : n.kind === "centre"
              ? { ...n, kind: "" }
              : n,
        ),
      };

    case "add_edge": {
      const e = op.edge;
      requireFree(p.edges, e.id, op);
      requireNode(p, e.from, op);
      requireNode(p, e.to, op);
      if (e.from === e.to) throw new OpError("An edge can't connect a node to itself.", op);
      return { ...p, edges: [...p.edges, e] };
    }

    case "update_edge": {
      const next = patchById(p.edges, op.id, op.patch, op);
      const e = next.find((x) => x.id === op.id)!;
      requireNode(p, e.from, op);
      requireNode(p, e.to, op);
      return { ...p, edges: next };
    }

    case "remove_edge":
      if (!p.edges.some((e) => e.id === op.id)) throw new OpError(`No edge with id "${op.id}".`, op);
      return { ...p, edges: p.edges.filter((e) => e.id !== op.id) };

    case "set_legend": {
      const legend = { ...p.legend };
      if (op.meaning.trim() === "") delete legend[op.key];
      else legend[op.key] = op.meaning;
      return { ...p, legend };
    }

    case "spawn_work":
      requireFree(p.work, op.work.id, op);
      requireNode(p, op.work.nodeId, op);
      return { ...p, work: [...p.work, op.work] };

    case "update_work":
      if (op.patch.nodeId !== undefined) requireNode(p, op.patch.nodeId, op);
      return { ...p, work: patchById(p.work, op.id, op.patch, op) };

    case "attach_outcome":
      return { ...p, work: patchById(p.work, op.workId, { outcome: op.outcome }, op) };

    case "remove_work":
      if (!p.work.some((w) => w.id === op.id)) throw new OpError(`No work item "${op.id}".`, op);
      return {
        ...p,
        work: p.work.filter((w) => w.id !== op.id),
        artifacts: p.artifacts.filter((a) => a.workId !== op.id),
      };

    case "add_artifact":
      requireFree(p.artifacts, op.artifact.id, op);
      if (op.artifact.nodeId !== null) requireNode(p, op.artifact.nodeId, op);
      if (op.artifact.workId !== null && !p.work.some((w) => w.id === op.artifact.workId)) {
        throw new OpError(`No work item "${op.artifact.workId}".`, op);
      }
      return { ...p, artifacts: [...p.artifacts, op.artifact] };

    case "remove_artifact":
      if (!p.artifacts.some((a) => a.id === op.id)) throw new OpError(`No artifact "${op.id}".`, op);
      return { ...p, artifacts: p.artifacts.filter((a) => a.id !== op.id) };

    case "create_narrative":
      requireFree(p.narratives, op.narrative.id, op);
      requireStops(p, op.narrative.nodeIds, op);
      return { ...p, narratives: [...p.narratives, op.narrative] };

    case "rename_narrative":
      return { ...p, narratives: patchById(p.narratives, op.id, { name: op.name }, op) };

    case "reorder_narrative":
      requireStops(p, op.nodeIds, op);
      return { ...p, narratives: patchById(p.narratives, op.id, { nodeIds: op.nodeIds }, op) };

    case "remove_narrative":
      if (!p.narratives.some((n) => n.id === op.id)) throw new OpError(`No narrative "${op.id}".`, op);
      return { ...p, narratives: p.narratives.filter((n) => n.id !== op.id) };
  }
}

/** Apply ops in order, atomically: if any op fails, the error is thrown and
 * the caller keeps the original project. */
export function applyOps(p: Project, ops: readonly Op[]): Project {
  return ops.reduce(applyOp, p);
}
