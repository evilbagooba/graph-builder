# Roadmap

Graph Builder is the first tool of a planned suite: **idea graph → work →
slides**, with chat as a control layer over all of it. The tools are meant to
be standalone repos that integrate through one portable project file, not
shared code. Graph Builder is where that file format and its operations layer
are being built first.

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
(+ Node / Connect / Legend) and the editor's bottom sheet disappear. Not
reproduced or diagnosed yet; needs the browser, device size and a screenshot.
Both sit at the bottom of the editor, which suggests the editor's bottom edge
is cut off rather than the elements being hidden.

### 2. Project format v1 + operations layer

Framework-free code (no React, no DOM) in its own folder, so it can later
lift out into a standalone `core` repo mechanically.

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

### 3. Graph UI slots for the suite

Build the UI slots now, with plain data behind them:

- **Work section** in the node panel: the node's work items (kind, status,
  outcome, link) and a spawn button. Track-and-link only — no execution.
- **Path mode:** click nodes in order to build and save a narrative,
  highlighted on the canvas. This is most of the Slides tool's input.
- **Chat drawer** with the op-diff card UI (proposed ops, Apply / Reject),
  designed before any LLM is wired in.

### 4. Later, in roughly this order

1. **Slides from a narrative** — a compiler, not an author: its only content
   inputs are the project, the chosen narrative and promoted evidence.
2. **Work board** (standalone `work` tool).
3. **Chat extraction / editing** (standalone `chat` tool) producing op lists.
4. **Extract `core`** into its own repo once the folder settles, with fixture
   projects as contract tests. Needs a name for the file format.

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
- **Fixture projects:** a golden example graph for contract tests must not
  contain private content if `core` is public.

## Deferred

- **CSS anchor positioning for the menu:** JS placement stays as the
  cross-engine path until all three engines support anchor positioning.
- **`oklch` colour tokens:** low value for a light-only palette.
