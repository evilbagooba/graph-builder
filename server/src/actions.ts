// Actions for Graph Builder.
//
// A graph is stored as one row: title + a project document (the portable
// project file format from core/). The client edits the project locally via
// core's operations layer and autosaves it whole via `saveGraph`; the
// server validates every write against core's schema and migrates older
// stored documents when they're read.

import { defineAction, z, type ActionsModule } from "./rpc";
import { desc, eq } from "drizzle-orm";
import * as schema from "./schema";
import {
  emptyProject,
  migrateProject,
  normalizeProject,
  projectSchema,
  type Project,
} from "../../core";

/** Read a stored row's document, upgrading older formats. A document that
 * can't be read falls back to an empty project rather than failing the
 * whole request. */
function parseStored(raw: string, title: string): Project {
  try {
    return migrateProject(JSON.parse(raw), title);
  } catch {
    return emptyProject(title);
  }
}

const graphSummary = z.object({
  id: z.number(),
  title: z.string(),
  nodeCount: z.number(),
  updatedAt: z.string(),
});

const fullGraph = graphSummary.extend({ project: projectSchema });

const listGraphsResponse = z.object({ graphs: z.array(graphSummary) });
const getGraphResponse = z.object({ graph: fullGraph });
const createGraphResponse = z.object({ graph: fullGraph });
const okResponse = z.object({ ok: z.literal(true) });

type Row = typeof schema.graphs.$inferSelect;

function toFullGraph(row: Row, project: Project) {
  return {
    id: row.id,
    title: row.title,
    nodeCount: project.nodes.length,
    updatedAt: row.updatedAt.toISOString(),
    project,
  };
}

export const Actions = {
  listGraphs: defineAction({
    description: "Lists all saved graphs, most recently edited first.",
    request: z.object({}),
    response: listGraphsResponse,
    async handler(ctx): Promise<z.infer<typeof listGraphsResponse>> {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.graphs)
        .orderBy(desc(schema.graphs.updatedAt));
      return {
        graphs: rows.map((row) => ({
          id: row.id,
          title: row.title,
          nodeCount: parseStored(row.data, row.title).nodes.length,
          updatedAt: row.updatedAt.toISOString(),
        })),
      };
    },
  }),

  getGraph: defineAction({
    description: "Loads one graph's project document.",
    request: z.object({ id: z.number().int().positive() }),
    response: getGraphResponse,
    async handler(ctx, args): Promise<z.infer<typeof getGraphResponse>> {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.graphs)
        .where(eq(schema.graphs.id, args.id))
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error("That graph no longer exists.");
      return { graph: toFullGraph(row, parseStored(row.data, row.title)) };
    },
  }),

  createGraph: defineAction({
    description: "Creates a new empty graph with the given title.",
    request: z.object({ title: z.string().trim().min(1).max(120) }),
    response: createGraphResponse,
    async handler(ctx, args): Promise<z.infer<typeof createGraphResponse>> {
      const db = ctx.db<typeof schema>();
      const project = emptyProject(args.title);
      const inserted = await db
        .insert(schema.graphs)
        .values({ title: args.title, data: JSON.stringify(project) })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error("createGraph: insert returned no rows");
      ctx.invalidateQueries();
      return { graph: toFullGraph(row, project) };
    },
  }),

  saveGraph: defineAction({
    description: "Saves a graph's project document, replacing what was stored.",
    request: z.object({
      id: z.number().int().positive(),
      project: projectSchema.refine((p) => p.title.trim() !== "", {
        message: "The graph needs a title.",
        path: ["title"],
      }),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const project = normalizeProject({ ...args.project, title: args.project.title.trim() });
      await db
        .update(schema.graphs)
        .set({
          title: project.title,
          data: JSON.stringify(project),
          updatedAt: new Date(),
        })
        .where(eq(schema.graphs.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  duplicateGraph: defineAction({
    description: "Copies a graph, giving the copy a new id and title.",
    request: z.object({ id: z.number().int().positive() }),
    response: createGraphResponse,
    async handler(ctx, args): Promise<z.infer<typeof createGraphResponse>> {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.graphs)
        .where(eq(schema.graphs.id, args.id))
        .limit(1);
      const source = rows[0];
      if (!source) throw new Error("That graph no longer exists.");
      const title = `${source.title} (copy)`.slice(0, 120);
      const project = { ...parseStored(source.data, source.title), title };
      const inserted = await db
        .insert(schema.graphs)
        .values({ title, data: JSON.stringify(project) })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error("duplicateGraph: insert returned no rows");
      ctx.invalidateQueries();
      return { graph: toFullGraph(row, project) };
    },
  }),

  importProject: defineAction({
    description:
      "Creates a graph from a project file (any version this app has exported); the document is migrated and validated here.",
    request: z.object({
      document: z.unknown(),
      fallbackTitle: z.string().trim().min(1).max(120),
    }),
    response: createGraphResponse,
    async handler(ctx, args): Promise<z.infer<typeof createGraphResponse>> {
      const db = ctx.db<typeof schema>();
      let project: Project;
      try {
        project = migrateProject(args.document, args.fallbackTitle);
      } catch {
        throw new Error("That file doesn't look like a graph exported from here.");
      }
      const title = project.title.trim().slice(0, 120) || args.fallbackTitle;
      project = { ...project, title };
      const inserted = await db
        .insert(schema.graphs)
        .values({ title, data: JSON.stringify(project) })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error("importProject: insert returned no rows");
      ctx.invalidateQueries();
      return { graph: toFullGraph(row, project) };
    },
  }),

  deleteGraph: defineAction({
    description: "Deletes a graph and all of its nodes and edges.",
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.graphs).where(eq(schema.graphs.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  seedExampleGraph: defineAction({
    description:
      "Adds an example graph that shows off node shapes and edge styles.",
    request: z.object({}),
    response: createGraphResponse,
    async handler(ctx): Promise<z.infer<typeof createGraphResponse>> {
      const db = ctx.db<typeof schema>();
      // Built through the schema so newer fields (kind, provenance, work…)
      // take their defaults.
      const project = projectSchema.parse({
        schemaVersion: 1,
        title: "Example: bird feeder",
        nodes: [
          {
            id: "feeder",
            title: "Build a bird feeder",
            subtitle: "The goal · the centre",
            body: "The project everything else hangs off. Drag nodes around, tap one to edit it, and use Connect to link ideas.",
            color: "ink",
            size: "xl",
            dimmed: false,
            shape: "circle",
            emoji: "",
            image: "",
            x: 470,
            y: 300,
          },
          {
            id: "design",
            title: "Sketch a design",
            subtitle: "First step",
            body: "Circle nodes take a colour and a size.",
            color: "ochre",
            size: "md",
            dimmed: false,
            shape: "circle",
            emoji: "",
            image: "",
            x: 170,
            y: 190,
          },
          {
            id: "wood",
            title: "Offcut wood",
            subtitle: "Materials",
            body: "Emoji nodes show the emoji large with the title underneath.",
            color: "paper",
            size: "md",
            dimmed: false,
            shape: "emoji",
            emoji: "🪵",
            image: "",
            x: 170,
            y: 430,
          },
          {
            id: "tools",
            title: "Saw, drill, screws",
            subtitle: "Tools",
            body: "",
            color: "paper",
            size: "md",
            dimmed: false,
            shape: "emoji",
            emoji: "🔨",
            image: "",
            x: 790,
            y: 190,
          },
          {
            id: "spot",
            title: "Find a spot",
            subtitle: "Near a window",
            body: "",
            color: "teal",
            size: "md",
            dimmed: false,
            shape: "circle",
            emoji: "",
            image: "",
            x: 790,
            y: 430,
          },
          {
            id: "squirrels",
            title: "Squirrel-proof roof",
            subtitle: "Maybe later",
            body: "Greyed-out nodes mark ideas that were parked or cut.",
            color: "vermilion",
            size: "sm",
            dimmed: true,
            shape: "circle",
            emoji: "",
            image: "",
            x: 470,
            y: 600,
          },
        ],
        edges: [
          {
            id: "e-design-feeder",
            from: "design",
            to: "feeder",
            label: "shapes",
            style: "solid",
            arrow: "forward",
          },
          {
            id: "e-wood-feeder",
            from: "wood",
            to: "feeder",
            label: "made from",
            style: "solid",
            arrow: "forward",
          },
          {
            id: "e-tools-feeder",
            from: "tools",
            to: "feeder",
            label: "needs",
            style: "solid",
            arrow: "forward",
          },
          {
            id: "e-feeder-spot",
            from: "feeder",
            to: "spot",
            label: "goes",
            style: "solid",
            arrow: "forward",
          },
          {
            id: "e-feeder-squirrels",
            from: "feeder",
            to: "squirrels",
            label: "could add",
            style: "dashed",
            arrow: "forward",
          },
          {
            id: "e-wood-tools",
            from: "wood",
            to: "tools",
            label: "",
            style: "solid",
            arrow: "both",
          },
        ],
        legend: {
          "color:ink": "The goal",
          "color:ochre": "Planning",
          "color:teal": "Placement",
          "color:vermilion": "Nice-to-have",
          "size:xl": "Centre of the project",
          "dimmed": "Parked for now",
          "edge:dashed": "Optional",
          "arrow:both": "Used together",
        },
      });
      const inserted = await db
        .insert(schema.graphs)
        .values({ title: project.title, data: JSON.stringify(project) })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error("seedExampleGraph: insert returned no rows");
      ctx.invalidateQueries();
      return { graph: toFullGraph(row, project) };
    },
  }),
} satisfies ActionsModule;
