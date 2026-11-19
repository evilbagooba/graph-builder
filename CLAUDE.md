# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Graph Builder: a node/edge diagram editor with a library of saved graphs. React + Tailwind v4 client built by Vite, a Node server using SQLite (better-sqlite3 + drizzle-orm). It began as a Muse/Hatch "web artifact" and was ported to run standalone; the original Muse version is not maintained here.

## Commands

- `npm run dev` — Vite dev server on :5173. The `/actions` API runs inside it (see `vite.config.ts`), and server code hot-reloads.
- `npm run typecheck` — type-checks client (`client/tsconfig.json`) and server (`server/tsconfig.json`). There is no test suite or linter.
- `npm run build` then `npm start` — production: `server/src/main.ts` (run via `tsx`) serves `client/dist` plus `/actions`. Env: `PORT` (3000), `DATA_DIR` (`./data`).

## Architecture

**Typed RPC, no codegen.** `server/src/actions.ts` exports `Actions`, built with `defineAction` from `server/src/rpc.ts` (zod request/response schemas + `handler(ctx, args)`). `server/src/http.ts` handles `POST /actions` with body `{ action, args }`: it parses args through the action's zod request schema (this is where defaults get applied), runs the handler, and replies `{ ok, result | error }`. `client/src/api.ts` builds `api` via `createActionClient<typeof Actions>()` using a *type-only* import of the server module (`verbatimModuleSyntax` makes dropping `type` a compile error — keep server runtime out of the client bundle). Client types like `GraphNode` are derived with `ApiResponse<typeof api, "getGraph">`, so changing a zod schema on the server propagates to the client.

**Data model: one JSON document per graph.** `server/src/schema.ts` has a single `graphs` table; `data` holds `{ nodes, edges }` as JSON. The zod `nodeSchema`/`edgeSchema` in `actions.ts` are the source of truth for shape and limits. New node fields must use `.default(...)` so stored graphs and imported JSON from before the field existed still validate — `parseDoc` silently falls back to an empty graph if stored JSON fails validation. Table changes need a new SQL file in `drizzle/` plus a `meta/_journal.json` entry with a `when` greater than the previous one (the migrator in `server/src/db.ts` skips entries whose timestamp isn't newer than the last applied).

**Client: nearly everything is in `client/src/App.tsx`.** `Library` (list/create/import), `Editor` (SVG canvas), `NodePanel`/`EdgePanel` (detail sheet). Node kinds: `circle`, `emoji`, `image` (images are an http(s) URL or a downscaled `data:image/...` upload stored inline in the document). Edge endpoints are computed by `borderPoint`, which is shape-aware.

**Local-first editing with debounced whole-document autosave.** The `Editor` loads a graph once per `graphId` into React state, mirrors it into `latestRef`, and `scheduleSave` debounces ~600 ms before sending the full document via `saveGraph`. Later refetches don't overwrite local state. A save the server rejects (e.g. a half-typed image link) surfaces as a notice and stops autosave until fixed, which is why `NodePanel` only commits complete links.

**Canvas interaction.** The camera (`{x, y, k}`) is React state. Zoom buttons and fit-view animate it with a spring (`moveCamera`), released pans coast (`coast`), and any new pointer or wheel input cancels both via `stopCameraAnim`. The wheel listener is attached natively (non-passive) so trackpad pinch (ctrl+wheel) can be intercepted. `prefersReducedMotion()` switches animations off; matching CSS lives at the bottom of `client/src/theme.css`.
