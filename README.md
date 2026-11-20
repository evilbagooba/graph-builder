# tako-nerve — idea graph

A node-and-edge editor for mapping ideas: drag nodes around a dotted canvas,
connect them with labelled edges, and annotate each one. Nodes can be
circles, emoji, or images; any node can carry work items, and named paths
through the graph become talks. Part of the
[tako](https://github.com/evilbagooba/tako) suite, and usable on its own.

## Run it

Requires Node.js 20.11 or newer.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in client/dist (npm run preview to serve it)
```

It is a static page with no server of its own.

**With the hub running** (`tako`, from the tako repo), the start screen is
your library: every project in the hub's folder (`~/tako/` by default).
Graphs are saved as you edit, shared live with the work board and slides,
and undo steps back through changes made in any tool. `?hub=<url>` overrides
the hub address (`http://localhost:4100`); `?project=<id>` opens a project
directly.

**Without the hub**, graphs open from files: start a new one, or open a
`.json` project file, and save with Ctrl/Cmd+S (written back in place in
Chromium, downloaded elsewhere).

Export as PNG, SVG or JSON from the graph menu.

## In the suite

`public/tako.tool.json` is how this tool describes itself to the hub.
Installed with `tako add evilbagooba/tako-nerve`, it is served by the hub at
`/nerve/`. With other tools present, the graph menu has "Open in work
board" / "Open in slides", pointed at the selected node. Links into this
tool can carry `?node=<id>` or `?work=<id>` (which selects the work item's
node). Pushing a `v*` tag builds the page and attaches it to a release as
`tako-tool.tgz` (`.github/workflows/release.yml`).

## How it's put together

- `client/src/App.tsx` — the whole UI: library, SVG canvas (drag, pan,
  pinch/trackpad zoom), node and edge panels, work section, path mode, chat
  drawer, export.
- `client/src/ui.tsx` — small native-HTML UI primitives.
- `client/src/file.ts` — opening and saving a project as a plain file.
- `client/src/theme.css` — off-white Dieter Rams / Teenage Engineering
  styling on Tailwind v4.
- `tako` (pinned by tag in `package.json`) — the project format, the ops
  every edit is made of, and the hub client.

`ROADMAP.md` has the plan; `CLAUDE.md` has the architecture in more depth.

## Checks

```sh
npm run typecheck
npm test           # every tako fixture project still opens and saves
```
