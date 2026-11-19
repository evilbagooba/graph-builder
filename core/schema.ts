// zod schemas for the project file format, and migration of older
// documents. This is the validation half of core: the server and tests use
// it. Browser code imports the zod-free model (./model.ts) instead, so zod
// stays out of client bundles.

import { z } from "zod";
import { SCHEMA_VERSION, normalizeProject, type Project } from "./project";
import type { Op } from "./ops";

const id = z.string().min(1).max(64);

export const nodeSchema = z.object({
  id,
  title: z.string().max(120),
  subtitle: z.string().max(200),
  body: z.string().max(4000),
  color: z.string().max(32),
  size: z.enum(["sm", "md", "lg", "xl"]),
  dimmed: z.boolean(),
  /** How the node is drawn. */
  shape: z.enum(["circle", "emoji", "image"]).default("circle"),
  emoji: z.string().max(32).default(""),
  /** An http(s) URL or a downscaled data:image/... URL from an upload. */
  image: z
    .string()
    .max(400_000)
    .refine((s) => s === "" || /^(https?:\/\/|data:image\/)/.test(s), {
      message: "Image must be an http(s) link or an uploaded image.",
    })
    .default(""),
  /** Semantic tag: "centre", "branch", "foil", "evidence"… ("" = none).
   * Reserved; domain packs will supply the defaults. */
  kind: z.string().max(40).default(""),
  /** Where this idea came from (a chat message, a paper, a note). */
  provenance: z
    .object({ source: z.string().max(200), ref: z.string().max(400).default("") })
    .nullable()
    .default(null),
  x: z.number().min(-100000).max(100000),
  y: z.number().min(-100000).max(100000),
});

export const edgeSchema = z.object({
  id,
  from: id,
  to: id,
  label: z.string().max(120),
  style: z.enum(["solid", "dashed"]),
  arrow: z.enum(["forward", "both", "none"]),
});

/** A unit of work spawned from a node: an experiment, a reading, a ticket…
 * Track-and-link only: the work itself happens elsewhere. */
export const workSchema = z.object({
  id,
  nodeId: id,
  title: z.string().max(200),
  kind: z.string().max(40).default("task"),
  status: z.enum(["todo", "doing", "done"]).default("todo"),
  /** The conclusion, in the author's own words. */
  outcome: z.string().max(4000).default(""),
  link: z.string().max(2000).default(""),
});

/** Something work produced (a plot, a result table, a PR, a demo). */
export const artifactSchema = z.object({
  id,
  nodeId: id.nullable().default(null),
  workId: id.nullable().default(null),
  title: z.string().max(200),
  kind: z.string().max(40).default("link"),
  link: z.string().max(2000).default(""),
});

/** A named, ordered path through the graph; a slideshow renders one. */
export const narrativeSchema = z.object({
  id,
  name: z.string().max(120),
  nodeIds: z.array(id).max(500),
});

/** What each visual option means in this graph, keyed by option:
 * "color:teal", "size:xl", "dimmed", "edge:dashed", "arrow:both". */
export const legendSchema = z
  .record(z.string().max(40), z.string().max(80))
  .refine((o) => Object.keys(o).length <= 64, { message: "Too many legend entries." })
  .default({});

export const projectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  title: z.string().max(120),
  nodes: z.array(nodeSchema).max(500),
  edges: z.array(edgeSchema).max(1000),
  legend: legendSchema,
  work: z.array(workSchema).max(2000).default([]),
  artifacts: z.array(artifactSchema).max(2000).default([]),
  narratives: z.array(narrativeSchema).max(100).default([]),
});

const SHAPES = new Set(["circle", "emoji", "image"]);

/**
 * Upgrade any supported document to the current version and validate it.
 * Throws a zod error if the document is invalid after migration.
 *
 * v0 (unversioned): nodes stored their visual form in `kind`. That moves to
 * `shape`, and `kind` becomes the (empty) semantic tag. v0 documents also had
 * no title of their own, so `fallbackTitle` supplies one.
 */
export function migrateProject(raw: unknown, fallbackTitle = "Untitled graph"): Project {
  if (!raw || typeof raw !== "object") throw new Error("Not a project document.");
  const doc = { ...(raw as Record<string, unknown>) };
  if (doc.schemaVersion === undefined) {
    doc.schemaVersion = SCHEMA_VERSION;
    if (typeof doc.title !== "string" || !doc.title.trim()) doc.title = fallbackTitle;
    if (Array.isArray(doc.nodes)) {
      doc.nodes = doc.nodes.map((n: unknown) => {
        if (!n || typeof n !== "object") return n;
        const { kind, ...rest } = n as Record<string, unknown>;
        return typeof kind === "string" && SHAPES.has(kind) ? { ...rest, shape: kind } : rest;
      });
    }
  }
  return normalizeProject(projectSchema.parse(doc));
}


// ---- ops ----
//
// Validation for ops arriving from outside the app's own UI (chat, scripts,
// other tools). The UI builds ops in typed code and skips this.

/** A patch: every field optional, none defaulted (a default would silently
 * overwrite the stored value), unknown fields rejected. */
function patchOf<S extends z.ZodRawShape>(obj: z.ZodObject<S>) {
  const shape: Record<string, z.ZodType> = {};
  for (const [k, v] of Object.entries(obj.shape)) {
    if (k === "id") continue;
    const base = v instanceof z.ZodDefault ? (v.unwrap() as z.ZodType) : (v as z.ZodType);
    shape[k] = base.optional();
  }
  return z.strictObject(shape);
}

const nodePatch = patchOf(nodeSchema);
const edgePatch = patchOf(edgeSchema);
const workPatch = patchOf(workSchema);

export const opSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_title"), title: z.string().max(120) }),
  z.object({ type: z.literal("add_node"), node: nodeSchema }),
  z.object({ type: z.literal("update_node"), id, patch: nodePatch }),
  z.object({ type: z.literal("move_node"), id, x: z.number().min(-100000).max(100000), y: z.number().min(-100000).max(100000) }),
  z.object({ type: z.literal("remove_node"), id }),
  z.object({ type: z.literal("merge_nodes"), a: id, b: id }),
  z.object({ type: z.literal("set_centre"), id }),
  z.object({ type: z.literal("add_edge"), edge: edgeSchema }),
  z.object({ type: z.literal("update_edge"), id, patch: edgePatch }),
  z.object({ type: z.literal("remove_edge"), id }),
  z.object({ type: z.literal("set_legend"), key: z.string().max(40), meaning: z.string().max(80) }),
  z.object({ type: z.literal("spawn_work"), work: workSchema }),
  z.object({ type: z.literal("update_work"), id, patch: workPatch }),
  z.object({ type: z.literal("attach_outcome"), workId: id, outcome: z.string().max(4000) }),
  z.object({ type: z.literal("remove_work"), id }),
  z.object({ type: z.literal("add_artifact"), artifact: artifactSchema }),
  z.object({ type: z.literal("remove_artifact"), id }),
  z.object({ type: z.literal("create_narrative"), narrative: narrativeSchema }),
  z.object({ type: z.literal("rename_narrative"), id, name: z.string().max(120) }),
  z.object({ type: z.literal("reorder_narrative"), id, nodeIds: z.array(id).max(500) }),
  z.object({ type: z.literal("remove_narrative"), id }),
]);

export const opListSchema = z.array(opSchema).min(1).max(200);

/** Validate an untrusted op list. Throws a zod error if any op is malformed;
 * whether the ops *apply* to a given project is checked by applyOps. */
export function parseOps(raw: unknown): Op[] {
  return opListSchema.parse(raw) as Op[];
}
