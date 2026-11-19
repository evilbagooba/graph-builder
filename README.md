# Graph Builder

A small node-and-edge diagram editor for mapping ideas: drag nodes around a
dotted canvas, connect them, and annotate each one. Nodes can be circles,
emoji, or images. Graphs autosave to a local SQLite database and export as
PNG, SVG, or JSON.

## Run it

Requires Node.js 20.11 or newer.

```sh
npm install
npm run dev
```

Then open http://localhost:5173.

On npm 11+, install scripts are opt-in; `package.json` already approves the
two this project needs (`better-sqlite3`'s native binary and `esbuild`).

### Production

```sh
npm run build   # bundles the client into client/dist
npm start       # serves it plus the API on http://localhost:3000
```

Environment variables: `PORT` (default `3000`) and `DATA_DIR` (default
`./data`; the database is `$DATA_DIR/app.db`).

## How it's put together

- `client/src/App.tsx` — the whole UI: graph library, SVG canvas
  (drag, pan, pinch/trackpad zoom), node and edge panels, export.
- `client/src/theme.css` — off-white Dieter Rams / Teenage Engineering
  styling on Tailwind v4.
- `server/src/actions.ts` — the API: list/get/create/save/duplicate/delete
  graphs, each validated with zod.
- `server/src/schema.ts` + `drizzle/` — SQLite schema and migrations
  (applied automatically on startup).
- `server/src/rpc.ts` / `client/src/rpc.ts` — a tiny typed RPC layer: the
  client's types come straight from the server's action definitions.

`npm run typecheck` type-checks client and server.
