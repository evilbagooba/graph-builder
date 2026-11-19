// Drizzle schema for Graph Builder.
//
// One table: each saved graph is a row whose `data` column holds the whole
// graph document (nodes + edges) as JSON. Graphs are small (tens of nodes),
// so a document column beats a node/edge relational split here.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const graphs = sqliteTable("graphs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  data: text("data").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
