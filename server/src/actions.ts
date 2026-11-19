// Actions for Graph Builder.
//
// A graph is stored as one row: title + a JSON document holding its nodes
// and edges. The client edits the document locally (dragging must feel
// instant) and autosaves it whole via `saveGraph`; the server validates the
// document shape on every write.

import { defineAction, z, type ActionsModule } from "./rpc";
import { desc, eq } from "drizzle-orm";
import * as schema from "./schema";

const nodeSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().max(120),
  subtitle: z.string().max(200),
  body: z.string().max(4000),
  color: z.string().max(32),
  size: z.enum(["sm", "md", "lg", "xl"]),
  dimmed: z.boolean(),
  // How the node is drawn. Defaults keep graphs saved before these fields
  // existed loading as plain circles.
  kind: z.enum(["circle", "emoji", "image"]).default("circle"),
  emoji: z.string().max(32).default(""),
  // An http(s) URL or a downscaled data:image/... URL from an upload.
  image: z
    .string()
    .max(400_000)
    .refine((s) => s === "" || /^(https?:\/\/|data:image\/)/.test(s), {
      message: "Image must be an http(s) link or an uploaded image.",
    })
    .default(""),
  x: z.number().min(-100000).max(100000),
  y: z.number().min(-100000).max(100000),
});

const edgeSchema = z.object({
  id: z.string().min(1).max(64),
  from: z.string().min(1).max(64),
  to: z.string().min(1).max(64),
  label: z.string().max(120),
  style: z.enum(["solid", "dashed"]),
  arrow: z.enum(["forward", "both", "none"]),
});

// What each visual option means in this graph, keyed by option:
// "color:teal", "size:xl", "dimmed", "edge:dashed", "arrow:both". Only
// options the author has given a meaning are stored.
const legendSchema = z
  .record(z.string().max(40), z.string().max(80))
  .refine((o) => Object.keys(o).length <= 64, { message: "Too many legend entries." })
  .default({});

const graphDocSchema = z.object({
  nodes: z.array(nodeSchema).max(500),
  edges: z.array(edgeSchema).max(1000),
  legend: legendSchema,
});

const graphSummary = z.object({
  id: z.number(),
  title: z.string(),
  nodeCount: z.number(),
  updatedAt: z.string(),
});

const fullGraph = graphSummary.extend({
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  legend: legendSchema,
});

type GraphDoc = z.infer<typeof graphDocSchema>;

function parseDoc(raw: string): GraphDoc {
  try {
    const parsed = graphDocSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through to the empty document
  }
  return { nodes: [], edges: [], legend: {} };
}

const listGraphsResponse = z.object({ graphs: z.array(graphSummary) });
const getGraphResponse = z.object({ graph: fullGraph });
const createGraphResponse = z.object({ graph: fullGraph });
const okResponse = z.object({ ok: z.literal(true) });

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
          nodeCount: parseDoc(row.data).nodes.length,
          updatedAt: row.updatedAt.toISOString(),
        })),
      };
    },
  }),

  getGraph: defineAction({
    description: "Loads one graph with all of its nodes and edges.",
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
      const doc = parseDoc(row.data);
      return {
        graph: {
          id: row.id,
          title: row.title,
          nodeCount: doc.nodes.length,
          updatedAt: row.updatedAt.toISOString(),
          nodes: doc.nodes,
          edges: doc.edges,
          legend: doc.legend,
        },
      };
    },
  }),

  createGraph: defineAction({
    description: "Creates a new empty graph with the given title.",
    request: z.object({ title: z.string().trim().min(1).max(120) }),
    response: createGraphResponse,
    async handler(ctx, args): Promise<z.infer<typeof createGraphResponse>> {
      const db = ctx.db<typeof schema>();
      const empty: GraphDoc = { nodes: [], edges: [], legend: {} };
      const inserted = await db
        .insert(schema.graphs)
        .values({ title: args.title, data: JSON.stringify(empty) })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error("createGraph: insert returned no rows");
      ctx.invalidateQueries();
      return {
        graph: {
          id: row.id,
          title: row.title,
          nodeCount: 0,
          updatedAt: row.updatedAt.toISOString(),
          nodes: [],
          edges: [],
          legend: {},
        },
      };
    },
  }),

  saveGraph: defineAction({
    description:
      "Saves a graph's title, nodes and edges, replacing what was stored.",
    request: z.object({
      id: z.number().int().positive(),
      title: z.string().trim().min(1).max(120),
      nodes: z.array(nodeSchema).max(500),
      edges: z.array(edgeSchema).max(1000),
      legend: legendSchema,
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const nodeIds = new Set(args.nodes.map((n) => n.id));
      const edges = args.edges.filter(
        (e) => nodeIds.has(e.from) && nodeIds.has(e.to) && e.from !== e.to,
      );
      // Drop meanings left blank so the stored legend only holds real ones.
      const legend = Object.fromEntries(
        Object.entries(args.legend).filter(([, v]) => v.trim() !== ""),
      );
      const doc: GraphDoc = { nodes: args.nodes, edges, legend };
      await db
        .update(schema.graphs)
        .set({
          title: args.title,
          data: JSON.stringify(doc),
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
      const doc = parseDoc(source.data);
      const inserted = await db
        .insert(schema.graphs)
        .values({
          title: `${source.title} (copy)`.slice(0, 120),
          data: source.data,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error("duplicateGraph: insert returned no rows");
      ctx.invalidateQueries();
      return {
        graph: {
          id: row.id,
          title: row.title,
          nodeCount: doc.nodes.length,
          updatedAt: row.updatedAt.toISOString(),
          nodes: doc.nodes,
          edges: doc.edges,
          legend: doc.legend,
        },
      };
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
      const doc: GraphDoc = {
        nodes: [
          {
            id: "feeder",
            title: "Build a bird feeder",
            subtitle: "The goal · the centre",
            body: "The project everything else hangs off. Drag nodes around, tap one to edit it, and use Connect to link ideas.",
            color: "ink",
            size: "xl",
            dimmed: false,
            kind: "circle",
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
            kind: "circle",
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
            kind: "emoji",
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
            kind: "emoji",
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
            kind: "circle",
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
            kind: "circle",
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
      };
      const inserted = await db
        .insert(schema.graphs)
        .values({ title: "Example: bird feeder", data: JSON.stringify(doc) })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error("seedExampleGraph: insert returned no rows");
      ctx.invalidateQueries();
      return {
        graph: {
          id: row.id,
          title: row.title,
          nodeCount: doc.nodes.length,
          updatedAt: row.updatedAt.toISOString(),
          nodes: doc.nodes,
          edges: doc.edges,
          legend: doc.legend,
        },
      };
    },
  }),
} satisfies ActionsModule;
