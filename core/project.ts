// The project file format: one portable JSON document per graph.
//
// This folder is framework-free (no React, no DOM) so it can lift out into a
// standalone `core` package. The zod schemas in schema.ts are the contract;
// this module holds the types derived from them plus helpers that need no
// validation library, so browser code can use them without bundling zod.
//
// Versioning: `schemaVersion` is bumped on breaking changes, and
// `migrateProject` (schema.ts) upgrades older documents on load. New
// optional fields use `.default(...)` so older files still validate without
// a bump.

import type { z } from "zod";
import type { projectSchema } from "./schema";

export const SCHEMA_VERSION = 1;

export type Project = z.output<typeof projectSchema>;
export type ProjectNode = Project["nodes"][number];
export type ProjectEdge = Project["edges"][number];
export type Work = Project["work"][number];
export type Artifact = Project["artifacts"][number];
export type Narrative = Project["narratives"][number];
export type Legend = Project["legend"];

export function emptyProject(title: string): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    title,
    nodes: [],
    edges: [],
    legend: {},
    work: [],
    artifacts: [],
    narratives: [],
  };
}

/** Drop references to things that no longer exist, and blank legend
 * meanings. Safe to run on any valid project; returns the same object if
 * nothing needed fixing. */
export function normalizeProject(p: Project): Project {
  const nodeIds = new Set(p.nodes.map((n) => n.id));
  const edges = p.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to) && e.from !== e.to);
  const work = p.work.filter((w) => nodeIds.has(w.nodeId));
  const workIds = new Set(work.map((w) => w.id));
  const artifacts = p.artifacts.filter(
    (a) => (a.nodeId === null || nodeIds.has(a.nodeId)) && (a.workId === null || workIds.has(a.workId)),
  );
  let narrativesChanged = false;
  const narratives = p.narratives.map((n) => {
    const kept = n.nodeIds.filter((id) => nodeIds.has(id));
    if (kept.length === n.nodeIds.length) return n;
    narrativesChanged = true;
    return { ...n, nodeIds: kept };
  });
  const legendEntries = Object.entries(p.legend);
  const legendKept = legendEntries.filter(([, v]) => v.trim() !== "");
  if (
    edges.length === p.edges.length &&
    work.length === p.work.length &&
    artifacts.length === p.artifacts.length &&
    !narrativesChanged &&
    legendKept.length === legendEntries.length
  ) {
    return p;
  }
  return {
    ...p,
    edges,
    work,
    artifacts,
    narratives,
    legend: Object.fromEntries(legendKept),
  };
}
