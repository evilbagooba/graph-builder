// zod schemas for the project file format, and migration of older
// documents. This is the validation half of core: the server and tests use
// it. Browser code imports the zod-free model (./model.ts) instead, so zod
// stays out of client bundles.

import { z } from "zod";
import { SCHEMA_VERSION, normalizeProject, type Project } from "./project";

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

