# Roadmap

What's planned next, in order, and decisions already made along the way.
Update this file as items land or plans change.

## Next

### 1. Fix: toolbar and editor panel missing on narrow screens

In a browser's responsive/device mode (below 768px wide), the bottom toolbar
(+ Node / Connect / Legend) and the editor's bottom sheet disappear. Not
reproduced or diagnosed yet. Both sit at the bottom of the editor, which
suggests the editor's bottom edge is being cut off rather than the elements
being hidden. Start by reproducing at a specific device size before
changing layout code.

### 2. Visual pass on the floating panels — first round done

Landed in `d56252a`: line icons replacing Unicode glyphs, a grouped editor
panel, larger controls on touch screens, and edge labels as canary sticky
notes that stay readable when zoomed out.

Still open:
- The zoom island (32px controls) is shorter than the toolbar beside it
  (40px). The toolbar's size and look were deliberately kept as they were,
  so matching them needs a different approach than shrinking the toolbar.

### 3. Motion with anime.js, plus a Motion setting

- Add [anime.js](https://github.com/juliangarnier/anime) v4 (MIT), importing
  only what's used: `animate` + `createSpring` is ~14 kB gzip; with
  timelines/draggable ~24 kB. This needs a deliberate bump of the JS budget
  in `scripts/check-size.mjs` (100 kB → ~115 kB).
- Candidates: panels spring in and out; a new edge draws itself
  (`svg.createDrawable`); new nodes pop in; nodes stagger in when a graph
  opens; `createLayout` for dock/undock.
- Animate SVG/DOM directly, never through React state (see "Canvas
  interaction and rendering performance" in `CLAUDE.md`).
- Add a **Motion** setting (System / Full / Reduced). The app honours
  `prefers-reduced-motion`, so with it on most motion is intentionally
  invisible; the setting lets people opt in or out explicitly.

### 4. Undo / redo

The biggest missing editor feature. Graphs are edited locally and autosaved
as whole documents, so a history of document snapshots (or patches) on the
client is the natural fit.

### 5. Auto level of detail

A third node-detail mode next to Simple and Detailed: **Auto** shows
subtitles only when zoomed in far enough to read them, and titles only when
zoomed out to see the whole graph.

- The camera isn't React state (see `CLAUDE.md`), so `setCamera` should flip a
  single "show subtitles" state only when the zoom crosses the threshold,
  not on every frame.
- Use hysteresis so the view doesn't flicker at the boundary, e.g. show at
  zoom ≥ 85%, hide below 75%.
- Open question: in Auto, should exports follow the current zoom's level of
  detail, or always export Detailed?

## Decided

- **No styled component library.** UI is native HTML primitives in
  `client/src/ui.tsx` styled with Tailwind; add an unstyled piece (e.g. one
  React Aria component) only for genuinely hard widgets. Kernel UI was tried;
  a snapshot lives on the `kernel-ui` branch.
- **tldraw as design reference only, not as the SDK.** Its license requires a
  license key for production use, which doesn't suit a public, self-hostable
  repo, and it would replace the whole canvas and data model.
- **Layout follows tldraw/Excalidraw:** full-bleed canvas, floating islands,
  editor panel floating on selection with an opt-in dock, panels declaring
  covered edges via `data-viewport-ui`.
- **No blanket `*` transitions** and no global `interpolate-size`: they turn
  per-frame SVG changes into CSS transitions and lag pans and drags.

## Deferred

- **CSS anchor positioning for the menu:** JS placement stays as the
  cross-engine path until all three engines support anchor positioning.
- **`oklch` colour tokens:** low value for a light-only palette; revisit if a
  dark theme is added.
