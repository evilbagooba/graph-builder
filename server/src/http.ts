// POST /actions handler: body is `{ action, args }`. The request is
// validated (and defaulted) by the action's zod schema before the handler
// runs. Replies `{ ok: true, result }` or `{ ok: false, error }`.

import type { IncomingMessage, ServerResponse } from "node:http";
import { Actions } from "./actions";
import type { ActionContext } from "./rpc";
import { getDb } from "./db";

const MAX_BODY = 50 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Request too large."));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

const ctx: ActionContext = {
  // The handlers name their schema type; the one database serves them all.
  db: (() => getDb()) as ActionContext["db"],
  invalidateQueries: () => {},
};

export async function handleActions(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "Use POST." });
  let action: unknown;
  let args: unknown;
  try {
    ({ action, args } = JSON.parse(await readBody(req)) as { action?: unknown; args?: unknown });
  } catch {
    return send(res, 400, { ok: false, error: "Malformed request." });
  }
  const def = typeof action === "string" && Object.hasOwn(Actions, action)
    ? Actions[action as keyof typeof Actions]
    : undefined;
  if (!def) return send(res, 404, { ok: false, error: `Unknown action: ${String(action)}` });

  const parsed = def.request.safeParse(args ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    return send(res, 400, { ok: false, error: `${issue?.message ?? "Invalid request"}${where}` });
  }
  try {
    const result = await (def.handler as (c: ActionContext, a: any) => Promise<unknown>)(
      ctx,
      parsed.data,
    );
    return send(res, 200, { ok: true, result });
  } catch (e) {
    console.error(`[actions] ${String(action)} failed:`, e);
    return send(res, 500, {
      ok: false,
      error: e instanceof Error ? e.message : "Something went wrong.",
    });
  }
}
