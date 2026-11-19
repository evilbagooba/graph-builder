// Client half of the typed-action layer (server half: server/src/rpc.ts).
// `createActionClient<typeof Actions>()` returns a proxy whose methods POST
// `{ action, args }` to ./actions and resolve to the typed result.

import type { z } from "zod";
import type { ActionsModule } from "../../server/src/rpc";

export type ActionClient<A extends ActionsModule> = {
  [K in keyof A]: (
    args: z.input<A[K]["request"]>,
  ) => Promise<z.output<A[K]["response"]>>;
};

type AnyFn = (...args: never[]) => Promise<unknown>;

export type ApiRequest<C, K extends keyof C> = C[K] extends AnyFn ? Parameters<C[K]>[0] : never;
export type ApiResponse<C, K extends keyof C> = C[K] extends AnyFn ? Awaited<ReturnType<C[K]>> : never;

async function call(action: string, args: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch("./actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, args }),
    });
  } catch {
    throw new Error("Can't reach the server — check it's running.");
  }
  const body = (await res.json().catch(() => null)) as
    | { ok: true; result: unknown }
    | { ok: false; error: string }
    | null;
  if (!body) throw new Error(`Server error (${res.status}).`);
  if (!body.ok) throw new Error(body.error);
  return body.result;
}

export function createActionClient<A extends ActionsModule>(): ActionClient<A> {
  return new Proxy({} as ActionClient<A>, {
    get: (_target, action) =>
      typeof action === "string" ? (args: unknown) => call(action, args) : undefined,
  });
}
