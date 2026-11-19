// Minimal typed-action layer. Each action pairs a zod request schema, a zod
// response schema and a handler; the client derives its types from
// `typeof Actions` (see client/src/rpc.ts), so there is no codegen.

import { z } from "zod";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

export { z };

export interface ActionContext {
  db<TSchema extends Record<string, unknown>>(): BetterSQLite3Database<TSchema>;
  /** Hook for pushing cache invalidation to other clients; a no-op locally. */
  invalidateQueries(): void;
}

export interface ActionDef<Req extends z.ZodType, Res extends z.ZodType> {
  description: string;
  request: Req;
  response: Res;
  handler(ctx: ActionContext, args: z.output<Req>): Promise<z.output<Res>>;
}

export type ActionsModule = Record<string, ActionDef<any, any>>;

export function defineAction<Req extends z.ZodType, Res extends z.ZodType>(
  def: ActionDef<Req, Res>,
): ActionDef<Req, Res> {
  return def;
}
