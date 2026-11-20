# Roadmap

This repo is tako-nerve (formerly Graph Builder), the first tool of the tako
suite: **idea graph → work →
slides**, with chat as a control layer over all of it. The tools are meant to
be standalone repos that integrate through one portable project file, not
shared code. The file format, its operations layer and the hub live in the
`tako` repo.

Update this file as items land or plans change.

## Design tests

Apply these to every feature decision:

- **Traceability:** can you click anything in an output and reach the idea or
  evidence it came from in three hops or fewer?
- **Ownership:** is every conclusion in the system in the user's own words,
  entered deliberately? Promotion is a manual step, never automatic.
- **Reasoning visibility:** does it make a weakness in the reasoning *visible*
  (untested claims, contested edges, orphan nodes, missing foils) rather than
  hiding it behind polish?
- **Source-only (slides):** does every piece of output map to a node,
  evidence item or run in the project? Content that came from a prompt fails.

## Next

### 1. Fix: toolbar and editor panel missing on narrow screens

In a browser's responsive/device mode (below 768px wide), the bottom toolbar
(+ Node / Connect / Legend) and the editor's bottom sheet disappear.

**Status: open, blocked on a screenshot.** Not reproducible in headless
Chromium or Firefox (2026-11-19): phone presets, 320–700px wide, windows down
to 300px tall, and shrinking an open editor (floating and docked) all kept
both visible. The narrow layout has changed since the report (top islands
share one row; side-panel toggles fold into a Panels menu below 500px), so it
may already be gone. If it happens again, record the browser, device preset
or window size, and a screenshot; until then, work continues below.

### 2. Project format v1 + operations layer — done

Landed: `core/` (format v1 with migration from unversioned documents, ops,
dispatch, undo/redo, contract tests), plus `opSchema`/`parseOps` for
validating ops from outside the UI and `reviewOps` for describing them.


Framework-free code (no React, no DOM), since extracted into the `core`
repo (see 4).

- **Versioned project format:** a schema version; nodes, edges, legend, plus
  reserved `work[]`, `artifacts[]`, `narratives[]` and per-node provenance.
  Old graphs load with the new collections empty.
- **`shape` vs `kind`:** the node's visual form (circle / emoji / image)
  becomes `shape`; `kind` is reserved for the semantic tag (centre, branch,
  foil, evidence…). Migrated automatically on load.
- **Ops + dispatch:** every change to a project is a validated op
  (`add_node`, `update_node`, `move_node`, `add_edge`, `remove_edge`, …)
  applied by one pure reducer. UI buttons, and later chat, call the same ops.
- **Undo / redo** from the dispatch history. View state (the camera, the
  selection) is never an op. A node drag stays local while moving and commits
  one `move_node` step on release, so undo isn't flooded with per-frame steps.

### 3. Graph UI slots for the suite — done

Landed, each with plain data behind it and no execution or model:

- **Work section** in the node panel: work items (title, status, kind, link,
  outcome in the author's words), as native disclosures.
- **Path mode:** the Paths panel creates named paths; while one is active,
  tapping nodes adds or drops stops, the canvas dims everything else and
  draws the route with numbered stops. Reorder in the panel. On phones it
  shrinks to a one-line bar.
- **Chat drawer** (marked Preview): proposals arrive as op-diff cards
  (`reviewOps` in core) with Apply / Reject; Apply is one undo step and a
  stale proposal says why it can't apply. With no model wired in, pasting a
  JSON op list (validated by the server's `checkOps` / core's `opSchema`)
  drives the same path.

Follow-ups: canvas hint for nodes with open work (reasoning visibility);
action errors (e.g. invalid ops) come back as HTTP 500 rather than 4xx; the
JS bundle is at ~96 of 100 kB, so the next big UI (slides) should load
lazily rather than raise the budget.

### 4. Later, in roughly this order

1. ~~**Slides from a narrative**~~ — v0.1.0 at github.com/evilbagooba/tako-skin
   (standalone static app: open a project file, pick a path, present or
   print). Evidence = done work outcomes + evidence-kind nodes wired to a
   stop; untested stops are flagged in pre-flight; a contract test checks
   every shown string is verbatim project content. Next there: export a
   self-contained HTML deck; the brief's "promotion" step (choosing which
   outcome becomes a slide's takeaway) once the format has it.
2. ~~**Work board**~~ — v0.1.0 at github.com/evilbagooba/tako-arm (standalone static app:
   open a project file, one lane per node, To do / Doing /
   Done, save back to the file). Track-and-link only. Each item shows why it
   exists (its node, labelled connections, paths, a mini-map); done items
   with no outcome are flagged; node state (untested / in progress / has
   evidence) is computed by the slides tool's rule. Promotion is manual: the
   author writes the finding, which becomes an evidence node wired to the
   claim with `provenance: { source: "work", ref: <work id> }`. Contract
   tests run every board op through core's validation on each fixture.
   Next there: runs (the per-iteration log) and pinned metrics, which need
   format additions in core; the graph could then show "promoted from" using
   that provenance.
3. **Chat extraction / editing** (standalone `chat` tool) producing op lists.
4. ~~**Extract `core`**~~ — done early (to let `slides` pin it):
   github.com/evilbagooba/tako (then `core`), v0.1.0, with fixture projects that this
   repo runs as contract tests (`test/contract.test.ts`). The format's name
   is decided (tako; see Plan); repos are renamed in step 1.

## Plan (agreed 2026-11-20)

**Rules for scope.** Tools and format stay domain-neutral: a feature goes in
only if it works unchanged for a software project too; research specifics
belong in a pack. The thesis is the first and most demanding user, not the
definition of the tool. A tool is a web page that opens a tako file: from
the hub if one is running, from the file picker if not. Tools depend on the
hub at most, never on each other.

**Names.** The suite and file format are **tako** (蛸 as a decorative mark
only). Repos: `tako` (core + hub), `tako-nerve` (graph), `tako-arm` (work),
`tako-skin` (slides), `tako-ink` (chat). Each keeps a plain tagline, e.g.
"tako-arm — work board". Renamed in step 1.

### Step 1: hub and connection (core v0.2, renamed `tako`) — done

Landed 2026-11-20: tako v0.2.0, tako-arm v0.2.0, tako-skin v0.2.0, and this
repo as tako-nerve. Checked end to end in Firefox and Chromium (an edit in
one tool appears live in the others; undo crosses tools; no hub falls back
to files). The one graph in the old database was exported to
`~/tako/thesis-idea-graph.tako.json`; `data/app.db` is left in place,
unused. Not done: the hub's undo history is in memory, so it resets when
the hub restarts; `author` is always "user" until step 3 gives agents a way
in; the bundle budget now covers first load only, with the validation
schemas loaded on demand (~27 kB gzip) when a file is opened without the
hub.

Removes the export / open / save / import hand-off between tools.

- **The `tako` hub** lives in core: a small local program that stores each
  project as a `.tako.json` file in `~/tako/` (one setting to change it).
  It listens on this machine only and answers only pages served from it.
- **Edits in, whole projects out.** A tool sends a small op list; the hub
  applies it to the latest version (core's `applyOps`), saves, and tells
  every open tool, which takes the fresh project and re-applies anything of
  its own not yet sent. No merging beyond that.
- **Every edit is logged** beside the project with its author and time,
  from day one (it can't be recreated later).
- **Undo lives on the hub** as one shared history, so it works across
  tools (change a status in work, undo it from the graph).
- **Graph, work and slides connect** when the hub is running and keep the
  file picker for when it isn't.
- **The graph app loses its server and SQLite database** and becomes a
  static page; its library lists what the hub has. Existing graphs are
  exported into the folder once.

### Step 2: one front door — done

Landed 2026-11-20 as tako v0.3.0 and v0.3.0 of all three tools. `tako`
alone now starts everything at http://localhost:4100/ (home page, and
`/nerve/`, `/arm/`, `/skin/`). Each tool ships `public/tako.tool.json` and a
release workflow that attaches `tako-tool.tgz`; `tako add <owner/repo>`
installs it. Checked in Firefox and Chromium: home → graph → work on the
selected node → back to the graph on a work item's node → slides on a stop,
and a tool running from its dev server announcing itself. Not done: tools
on the home page are listed alphabetically by id rather than in pipeline
order; there is no "update all" (re-run `tako add` to update a tool).

- **Each tool describes itself** in a small file in its own repo (name,
  tagline, what it can open). The hub holds no tool-specific knowledge, so
  a new tool is one new repo and no changes anywhere else.
- **`tako add <github repo>`** fetches a tool's built page into
  `~/tako/tools/`; the hub serves installed tools at one address, with a
  home page listing projects and tools. No separate programs to launch.
  Tools under development can still run on their own and announce
  themselves.
- **Cross-tool links** ("Open in work", "Show in graph") land on the same
  project and node, and appear only for tools that are present.
- Keep the hub to: store projects, serve tools, list what's there. No
  update manager, settings or accounts.

### Thesis test

Run the thesis graph through graph → work → slides: one in-flight
experiment and one reading tracked to an outcome and a promotion, and one
real deck compiled, ideally for a real meeting. Raw notes go in
`../test-notes.md` as they happen and are triaged into this file
afterwards. A write-up of the real research loop (`../research-loop.md`,
still to come) informs it. The test decides the shape of runs and what an
agent should log.

### Step 3: agents and history

- **A generic agent door** on the hub (a command plus a local address) that
  any agent can use; tako-ink is later just one user of it.
- **Two lanes, split by the ownership rule.** *Proposals*: anything touching
  ideas or conclusions (nodes, edges, outcomes, findings, paths) waits in an
  inbox until the author applies it. *Records*: mechanical facts (status,
  links, artifacts, later runs) are applied directly.
- **Agent-written text is marked** in every tool until the author edits or
  confirms it; slides flag it the way they flag untested claims.
- **Undo becomes personal:** Ctrl+Z reverses the author's own latest change
  (sent as a new edit) and never an agent's. A History panel can
  deliberately revert any logged change. Named checkpoints ("before lab
  meeting"). No git built in; the folder can be put under git by hand.

### After that

- **core v0.3:** runs and promotion in the format (work: runs table and
  pinned metrics; slides: takeaway line; graph: "promoted from").
- **tako-ink** (chat), with the template repo extracted just before it.
- True op-by-op live syncing only if real clashes show up.

## Later polish

- **Motion with anime.js plus a Motion setting** (System / Full / Reduced).
  anime.js v4 is MIT; `animate` + `createSpring` is ~14 kB gzip, so the JS
  budget in `scripts/check-size.mjs` needs a deliberate bump. Animate SVG/DOM
  directly, never through React state.
- **Auto level of detail:** a third node-detail mode showing subtitles only
  when zoomed in enough to read them. Flip state only when the zoom crosses
  the threshold, with hysteresis (e.g. show ≥ 85%, hide < 75%).
- **Panel heights:** the zoom island is shorter than the toolbar beside it;
  the toolbar's size stays, so matching needs another approach.

## Decided

- **No styled component library.** UI is native HTML primitives in
  `client/src/ui.tsx` styled with Tailwind; add an unstyled piece (e.g. one
  React Aria component) only for genuinely hard widgets. Kernel UI was tried;
  a snapshot lives on the `kernel-ui` branch.
- **tldraw as design reference only, not as the SDK.** Its license requires a
  license key for production use, which doesn't suit a public, self-hostable
  repo.
- **Layout follows tldraw/Excalidraw:** full-bleed canvas, floating islands,
  editor panel floating on selection with an opt-in dock, panels declaring
  covered edges via `data-viewport-ui`.
- **No blanket `*` transitions** and no global `interpolate-size`: they turn
  per-frame SVG changes into CSS transitions and lag pans and drags.
- **Design language:** off-white field, dot grid, hairlines, small squared
  corners, near-black ink, Helvetica plus monospace micro-labels, circles for
  nodes, one signal orange accent. No dark mode.

## Open questions

- **Edge-label colour:** the canary sticky notes add a second strong colour
  beside the single orange accent the design language calls for.
- **Legend vs node kinds:** the per-graph legend overlaps with kinds-as-tags
  (and packs supplying defaults); it may grow into kinds rather than sit
  beside them.
- **Fixture projects:** core's fixtures are fictional (bird feeder,
  sourdough); a thesis-shaped fixture would have to be invented, not copied.

## Deferred

- **CSS anchor positioning for the menu:** JS placement stays as the
  cross-engine path until all three engines support anchor positioning.
- **`oklch` colour tokens:** low value for a light-only palette.
