// Plain-language descriptions of ops, for review before they're applied
// (the chat drawer's diff cards, and later any tool that proposes changes).
// Zod-free, like the rest of model.ts.

import { applyOp, OpError, type Op } from "./ops";
import type { Project } from "./project";

export type OpLine = {
  /** add = something new, change = an edit, remove = something deleted. */
  sign: "add" | "change" | "remove";
  text: string;
};

export type OpReview = {
  lines: OpLine[];
  /** Set when the ops can't apply to this project as it is now; `lines`
   * then covers the ops before the failing one. */
  error: string | null;
};

const q = (s: string) => `“${s.trim() || "Untitled"}”`;
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const FIELD_NAMES: Record<string, string> = {
  title: "title",
  subtitle: "subtitle",
  body: "notes",
  color: "colour",
  size: "size",
  dimmed: "greyed out",
  shape: "shape",
  emoji: "emoji",
  image: "image",
  kind: "kind",
  provenance: "source",
  x: "position",
  y: "position",
  label: "label",
  style: "line",
  arrow: "arrow",
  from: "start",
  to: "end",
  status: "status",
  outcome: "outcome",
  link: "link",
  nodeId: "node",
};

function describePatch(patch: Record<string, unknown>): string {
  const parts = new Set<string>();
  for (const [k, v] of Object.entries(patch)) {
    const name = FIELD_NAMES[k] ?? k;
    if (typeof v === "string" && k !== "body" && k !== "image" && k !== "outcome") {
      parts.add(`${name} → ${q(clip(v, 40))}`);
    } else if (typeof v === "boolean") {
      parts.add(`${name} ${v ? "on" : "off"}`);
    } else {
      parts.add(`${name} changed`);
    }
  }
  return [...parts].join(", ");
}

function describeOp(p: Project, op: Op): OpLine {
  const node = (id: string) => q(p.nodes.find((n) => n.id === id)?.title ?? id);
  const edge = (id: string) => {
    const e = p.edges.find((x) => x.id === id);
    return e ? `${node(e.from)} → ${node(e.to)}` : `edge ${id}`;
  };
  const work = (id: string) => q(p.work.find((w) => w.id === id)?.title ?? id);
  const path = (id: string) => q(p.narratives.find((n) => n.id === id)?.name ?? id);
  switch (op.type) {
    case "set_title":
      return { sign: "change", text: `Rename the graph to ${q(op.title)}` };
    case "add_node":
      return { sign: "add", text: `Node ${q(op.node.title)}` };
    case "update_node":
      return { sign: "change", text: `${node(op.id)}: ${describePatch(op.patch)}` };
    case "move_node":
      return { sign: "change", text: `Move ${node(op.id)}` };
    case "remove_node": {
      const links = p.edges.filter((e) => e.from === op.id || e.to === op.id).length;
      return {
        sign: "remove",
        text: `Node ${node(op.id)}${links ? ` and its ${links} connection${links === 1 ? "" : "s"}` : ""}`,
      };
    }
    case "merge_nodes":
      return { sign: "change", text: `Merge ${node(op.b)} into ${node(op.a)}` };
    case "set_centre":
      return { sign: "change", text: `Make ${node(op.id)} the centre` };
    case "add_edge":
      return {
        sign: "add",
        text: `${node(op.edge.from)} → ${node(op.edge.to)}${op.edge.label ? ` ${q(op.edge.label)}` : ""}`,
      };
    case "update_edge":
      return { sign: "change", text: `${edge(op.id)}: ${describePatch(op.patch)}` };
    case "remove_edge":
      return { sign: "remove", text: edge(op.id) };
    case "set_legend":
      return op.meaning.trim()
        ? { sign: "change", text: `Legend: ${op.key} means ${q(op.meaning)}` }
        : { sign: "remove", text: `Legend entry ${op.key}` };
    case "spawn_work":
      return { sign: "add", text: `Work ${q(op.work.title)} on ${node(op.work.nodeId)}` };
    case "update_work":
      return { sign: "change", text: `Work ${work(op.id)}: ${describePatch(op.patch)}` };
    case "attach_outcome":
      return { sign: "change", text: `Outcome for ${work(op.workId)}: ${q(clip(op.outcome))}` };
    case "remove_work":
      return { sign: "remove", text: `Work ${work(op.id)}` };
    case "add_artifact":
      return { sign: "add", text: `Artifact ${q(op.artifact.title)}` };
    case "remove_artifact":
      return {
        sign: "remove",
        text: `Artifact ${q(p.artifacts.find((a) => a.id === op.id)?.title ?? op.id)}`,
      };
    case "create_narrative":
      return {
        sign: "add",
        text: `Path ${q(op.narrative.name)} (${op.narrative.nodeIds.length} stops)`,
      };
    case "rename_narrative":
      return { sign: "change", text: `Rename path ${path(op.id)} to ${q(op.name)}` };
    case "reorder_narrative":
      return { sign: "change", text: `Path ${path(op.id)}: now ${op.nodeIds.length} stops` };
    case "remove_narrative":
      return { sign: "remove", text: `Path ${path(op.id)}` };
  }
}

/** Describe `ops` as they would apply to `p`, in order (so a node added by
 * an earlier op is named in later ones), and check they still apply. */
export function reviewOps(p: Project, ops: readonly Op[]): OpReview {
  const lines: OpLine[] = [];
  let cur = p;
  for (const op of ops) {
    try {
      const line = describeOp(cur, op);
      cur = applyOp(cur, op);
      lines.push(line);
    } catch (e) {
      if (e instanceof OpError) return { lines, error: e.message };
      throw e;
    }
  }
  return { lines, error: null };
}
