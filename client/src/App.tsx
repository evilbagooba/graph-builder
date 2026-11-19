import {
useCallback,
useEffect,
useId,
useLayoutEffect,
useMemo,
memo,
useRef,
useState,
type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  ChoiceGroup,
  Dialog,
  Menu,
  MenuItem,
  MenuSeparator,
  Switch,
  TextField,
  Textarea,
  Toaster,
  toast,
} from "./ui";
import { api, type ApiResponse } from "./api";
import {
  OpError,
  canRedo,
  canUndo,
  commit,
  commitFrom,
  createHistory,
  emptyProject,
  preview,
  redo,
  undo,
  type History,
  type Legend,
  type Op,
  type Project,
  type ProjectEdge,
  type ProjectNode,
} from "../../core/model"; // zod-free half of core: keeps zod out of the bundle
import {
  BackIcon,
  CloseIcon,
  DockIcon,
  FitIcon,
  MinusIcon,
  MoreIcon,
  PlusIcon,
  RedoIcon,
  UndoIcon,
  UndockIcon,
} from "./icons";

// Graph data types come from the project format in core/.
type GraphNode = ProjectNode;
type GraphEdge = ProjectEdge;
type GraphSummary = ApiResponse<typeof api, "listGraphs">["graphs"][number];
type NodeSize = GraphNode["size"];
type EdgeStyle = GraphEdge["style"];
type ArrowKind = GraphEdge["arrow"];

const uid = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const SIZES: Record<NodeSize, { w: number; h: number; label: string }> = {
  sm: { w: 108, h: 108, label: "Small" },
  md: { w: 136, h: 136, label: "Medium" },
  lg: { w: 168, h: 168, label: "Large" },
  xl: { w: 204, h: 204, label: "Centre" },
};

const COLORS: Record<string, { fill: string; border: string; ink: string }> = {
  ink: { fill: "#1b1b1b", border: "#1b1b1b", ink: "#f2f2ee" },
  paper: { fill: "var(--node-paper)", border: "var(--text)", ink: "var(--text)" },
  teal: { fill: "#dde5e1", border: "#1b1b1b", ink: "#1b1b1b" },
  vermilion: { fill: "#ff4d00", border: "#d63e00", ink: "#ffffff" },
  ochre: { fill: "#efe3bc", border: "#1b1b1b", ink: "#1b1b1b" },
  plum: { fill: "#e3dfe3", border: "#1b1b1b", ink: "#1b1b1b" },
  sage: { fill: "#dfe5d6", border: "#1b1b1b", ink: "#1b1b1b" },
  slate: { fill: "#dee1e4", border: "#1b1b1b", ink: "#1b1b1b" },
};
const COLOR_KEYS = Object.keys(COLORS);

function colorOf(key: string) {
  return COLORS[key] ?? COLORS.paper!;
}

type Camera = { x: number; y: number; k: number };

function zoomPercent(k: number) {
  return `${Math.round(k * 100)}%`;
}

function cameraTransform(c: Camera) {
  return `translate(${c.x},${c.y}) scale(${c.k})`;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Emoji and image nodes carry their title as a caption below the shape. */
const CAPTION_H = 48;

function nodeRect(n: GraphNode) {
  const s = SIZES[n.size];
  const extra = n.shape === "circle" ? 0 : CAPTION_H;
  return { x: n.x - s.w / 2, y: n.y - s.h / 2, w: s.w, h: s.h + extra };
}

/** Point where the segment a→b exits a's border (circle, or square for images). */
function borderPoint(
  a: GraphNode,
  b: GraphNode,
): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return { x: a.x, y: a.y };
  const half = SIZES[a.size].w / 2;
  if (a.shape === "image") {
    const t = half / Math.max(Math.abs(dx), Math.abs(dy));
    return { x: a.x + dx * t, y: a.y + dy * t };
  }
  const len = Math.hypot(dx, dy) || 1;
  const radius = a.shape === "emoji" ? half * 0.8 : half;
  return { x: a.x + (dx / len) * radius, y: a.y + (dy / len) * radius };
}

const EMOJI_PICKS = ["💡", "🤖", "📱", "📷", "🌱", "🔬", "📄", "🎯", "⚡", "🧩", "❓", "⭐"];

/** Downscale an uploaded image to a small data URL that fits in the graph document. */
function imageFileToDataUrl(file: File, maxSide = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return reject(new Error("no canvas"));
      ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height);
      // WebP keeps transparency; browsers without a WebP encoder return PNG.
      let data = canvas.toDataURL("image/webp", 0.85);
      if (data.length > 380_000) data = canvas.toDataURL("image/jpeg", 0.8);
      resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable image"));
    };
    img.src = url;
  });
}

function edgeGeometry(e: GraphEdge, byId: Map<string, GraphNode>) {
  const a = byId.get(e.from);
  const b = byId.get(e.to);
  if (!a || !b) return null;
  return edgeGeometryBetween(a, b);
}

function edgeGeometryBetween(a: GraphNode, b: GraphNode) {
  const p1 = borderPoint(a, b);
  const p2 = borderPoint(b, a);
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  // Slight perpendicular bow so parallel / overlapping edges separate.
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(26, len * 0.08);
  const cx = mx + (-dy / len) * bow;
  const cy = my + (dx / len) * bow;
  return { p1, p2, cx, cy, path: `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}` };
}

// ---- edge labels ----
// A label is a small sticky note centred on its edge: sentence-case sans
// text on pale yellow with a folded corner. The note covers the line
// beneath it, so the line reads as stopping at the note.

const LABEL_FONT_SIZE = 11.5;
const LABEL_FONT = `500 ${LABEL_FONT_SIZE}px "Helvetica Neue", Helvetica, system-ui, -apple-system, "Segoe UI", sans-serif`;
const LABEL_PAD_X = 6;
const LABEL_H = 19;

const labelWidths = new Map<string, number>();
let labelCtx: CanvasRenderingContext2D | null | undefined;

/** Text width for a label, measured once per string on an off-screen
 * canvas (no DOM layout, nothing per frame). */
function labelWidth(text: string): number {
  const cached = labelWidths.get(text);
  if (cached !== undefined) return cached;
  if (labelCtx === undefined) labelCtx = document.createElement("canvas").getContext("2d");
  let w = text.length * LABEL_FONT_SIZE * 0.55;
  if (labelCtx) {
    labelCtx.font = LABEL_FONT;
    w = labelCtx.measureText(text).width;
  }
  labelWidths.set(text, w);
  return w;
}

const LABEL_FOLD = 6;

/** Sticky-note chip for a label centred on (x, y): `body` is the note with
 * its bottom-right corner cut off, `fold` the turned-over corner. */
function labelChip(text: string, x: number, y: number) {
  const w = labelWidth(text) + LABEL_PAD_X * 2 + LABEL_FOLD / 2;
  const h = LABEL_H;
  const l = x - w / 2;
  const t = y - h / 2;
  const r = l + w;
  const b = t + h;
  const f = LABEL_FOLD;
  return {
    body: `M ${l} ${t} H ${r} V ${b - f} L ${r - f} ${b} H ${l} Z`,
    fold: `M ${r} ${b - f} L ${r - f} ${b - f} L ${r - f} ${b} Z`,
  };
}

// Canary sticky-note yellow. Every node colour is a muted pastel (ochre
// included), so the note stands apart by saturation, not just hue.
const NOTE_FILL = "#fdee7f";
const NOTE_EDGE = "#d9bf2e";
const NOTE_FOLD = "#f2d84a";

/** Point on the quadratic curve at t (for the edge label). */
function quadPoint(
  g: NonNullable<ReturnType<typeof edgeGeometry>>,
  t: number,
) {
  const u = 1 - t;
  return {
    x: u * u * g.p1.x + 2 * u * t * g.cx + t * t * g.p2.x,
    y: u * u * g.p1.y + 2 * u * t * g.cy + t * t * g.p2.y,
  };
}

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Greedy word wrap to about `perLine` characters. A word longer than a
 * line breaks after its hyphens first; with `splitLongWords` any part still
 * too long is then cut across lines rather than overflowing. */
function wrapWords(text: string, perLine: number, splitLongWords = false): string[] {
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => (w.length > perLine ? w.split(/(?<=-)/) : [w]))
    .flatMap((w) =>
      splitLongWords && w.length > perLine ? (w.match(new RegExp(`.{1,${perLine}}`, "g")) ?? []) : [w],
    );
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    // Pieces of a hyphenated word rejoin without a space.
    const joined = !line ? w : line.endsWith("-") ? line + w : `${line} ${w}`;
    if (line && joined.length > perLine) {
      lines.push(line);
      line = w;
    } else {
      line = joined;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function wrapTitle(title: string, size: NodeSize): string[] {
  const perLine = size === "sm" ? 11 : size === "md" ? 14 : size === "lg" ? 17 : 20;
  return wrapWords(title, perLine).slice(0, 3);
}

const SUBTITLE_FONT = 8.5;
const SUBTITLE_LINE = 11;

/**
 * Text inside a circle node: up to three title lines, then the subtitle
 * wrapped in full (never truncated), each line centred, and the whole block
 * centred vertically on the node. In simple view (`detailed` false) the
 * subtitle is left out and the title re-centres. Baselines are offsets from
 * the node's centre. Shared by the canvas and the SVG/PNG export so they always match.
 */
function circleTextLayout(n: GraphNode, detailed: boolean) {
  const fontSize = n.size === "sm" ? 13 : n.size === "md" ? 15 : n.size === "lg" ? 17 : 20;
  const lineH = fontSize + 3;
  const title = wrapTitle(n.title || "Untitled", n.size);
  // ~78% of the diameter at ~5.9px per uppercase mono character.
  const subPerLine = Math.max(8, Math.floor((SIZES[n.size].w * 0.78) / 5.9));
  // The subtitle is shown in full, so over-long words are split too.
  const sub =
    detailed && n.subtitle ? wrapWords(n.subtitle.toUpperCase(), subPerLine, true) : [];
  const gap = sub.length ? 4 : 0;
  const top = -(title.length * lineH + gap + sub.length * SUBTITLE_LINE) / 2;
  return {
    fontSize,
    title: title.map((text, i) => ({ text, dy: top + fontSize * 0.85 + i * lineH })),
    sub: sub.map((text, i) => ({
      text,
      dy: top + title.length * lineH + gap + SUBTITLE_FONT * 0.85 + i * SUBTITLE_LINE,
    })),
  };
}

/** Up to two caption lines under an emoji / image node. */
function captionLines(n: GraphNode): string[] {
  return n.title ? wrapTitle(n.title, "xl").slice(0, 2) : [];
}

/** Returns the previous node object while only its position changed. */
function useStableIgnoringPosition(node: GraphNode | undefined): GraphNode | undefined {
  const ref = useRef(node);
  const prev = ref.current;
  const same =
    prev === node ||
    (!!prev &&
      !!node &&
      (Object.keys(node) as (keyof GraphNode)[]).every(
        (k) => k === "x" || k === "y" || prev[k] === node[k],
      ));
  if (!same) ref.current = node;
  return ref.current;
}

// ---- canvas pieces ----
// Memoized so a pan (which only changes the camera transform on the parent
// <g>) re-renders none of them, and a node drag re-renders only the dragged
// node and the edges attached to it.

type NodeEvents = {
  onPointerDown: (e: ReactPointerEvent, id: string) => void;
  onKeyDown: (e: React.KeyboardEvent, n: GraphNode) => void;
};

const NodeView = memo(function NodeView({
  node: n,
  isSel,
  isSource,
  isDragging,
  detailed,
  events,
}: {
  node: GraphNode;
  isSel: boolean;
  isSource: boolean;
  isDragging: boolean;
  detailed: boolean;
  events: NodeEvents;
}) {
  const c = colorOf(n.color);
  const r = nodeRect(n);
  if (n.shape !== "circle") {
    const half = r.w / 2;
    const ring = isSel || isSource ? "var(--accent)" : "var(--border)";
    return (
      <g
        data-node-id={n.id}
        opacity={n.dimmed ? 0.42 : 1}
        className="gb-node"
        data-dragging={isDragging || undefined}
        tabIndex={0}
        role="button"
        aria-label={`${n.title || "Untitled"} node`}
        aria-pressed={isSel}
        onKeyDown={(ev) => events.onKeyDown(ev, n)}
        onPointerDown={(ev) => events.onPointerDown(ev, n.id)}
      >
        {n.shape === "emoji" ? (
          <>
            <circle
              cx={n.x}
              cy={n.y}
              r={half * 0.8}
              fill="transparent"
              stroke={isSel || isSource ? ring : "none"}
              strokeWidth={2.5}
              strokeDasharray="5 4"
            />
            <text
              x={n.x}
              y={n.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={half * 1.2}
              pointerEvents="none"
            >
              {n.emoji || "❓"}
            </text>
          </>
        ) : (
          <>
            <rect
              x={n.x - half}
              y={n.y - half}
              width={half * 2}
              height={half * 2}
              fill={n.image ? "transparent" : "var(--node-paper)"}
              stroke={n.image && !isSel && !isSource ? "none" : ring}
              strokeWidth={isSel || isSource ? 3 : 1.4}
              strokeDasharray={n.image ? undefined : "4 4"}
            />
            {n.image ? (
              <image
                href={n.image}
                x={n.x - half}
                y={n.y - half}
                width={half * 2}
                height={half * 2}
                preserveAspectRatio="xMidYMid meet"
                pointerEvents="none"
              />
            ) : (
              <text
                x={n.x}
                y={n.y}
                textAnchor="middle"
                dominantBaseline="central"
                className="gb-mono"
                fontSize={10}
                letterSpacing={1}
                fill="var(--dim)"
                pointerEvents="none"
              >
                NO IMAGE
              </text>
            )}
          </>
        )}
        {captionLines(n).map((ln, i) => (
          <text
            key={i}
            x={n.x}
            y={n.y + half + 18 + i * 15}
            textAnchor="middle"
            className="gb-sans"
            fontWeight="bold"
            fontSize={13}
            fill="var(--text)"
            pointerEvents="none"
          >
            {ln}
          </text>
        ))}
      </g>
    );
  }
  const text = circleTextLayout(n, detailed);
  return (
    <g
      data-node-id={n.id}
      opacity={n.dimmed ? 0.42 : 1}
      className="gb-node"
      data-dragging={isDragging || undefined}
      tabIndex={0}
      role="button"
      aria-label={`${n.title || "Untitled"} node`}
      aria-pressed={isSel}
      onKeyDown={(ev) => events.onKeyDown(ev, n)}
      onPointerDown={(ev) => events.onPointerDown(ev, n.id)}
    >
      <circle
        cx={n.x}
        cy={n.y}
        r={r.w / 2}
        fill={c.fill}
        stroke={isSel || isSource ? "var(--accent)" : c.border}
        strokeWidth={isSel || isSource ? 3 : 1.4}
      />
      {text.title.map((ln, i) => (
        <text
          key={`t${i}`}
          x={n.x}
          y={n.y + ln.dy}
          textAnchor="middle"
          className="gb-sans"
          fontWeight="bold"
          fontSize={text.fontSize}
          fill={c.ink}
          pointerEvents="none"
        >
          {ln.text}
        </text>
      ))}
      {text.sub.map((ln, i) => (
        <text
          key={`s${i}`}
          x={n.x}
          y={n.y + ln.dy}
          textAnchor="middle"
          className="gb-mono"
          fontSize={SUBTITLE_FONT}
          letterSpacing={0.8}
          fill={c.ink}
          opacity={0.78}
          pointerEvents="none"
        >
          {ln.text}
        </text>
      ))}
    </g>
  );
});

const EdgeView = memo(function EdgeView({
  edge: e,
  from,
  to,
  isSel,
  onSelect,
}: {
  edge: GraphEdge;
  from: GraphNode;
  to: GraphNode;
  isSel: boolean;
  onSelect: (id: string) => void;
}) {
  const g = edgeGeometryBetween(from, to);
  const stroke = isSel ? "var(--accent)" : "var(--text)";
  return (
    <g>
      <path
        d={g.path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        style={{ cursor: "pointer" }}
        onPointerDown={(ev) => ev.stopPropagation()}
        onClick={() => onSelect(e.id)}
      />
      <path
        d={g.path}
        fill="none"
        stroke={stroke}
        strokeWidth={isSel ? 2.6 : 1.8}
        strokeDasharray={e.style === "dashed" ? "6 5" : undefined}
        markerEnd={
          e.arrow === "forward" || e.arrow === "both"
            ? `url(#${isSel ? "gb-arrow-accent" : "gb-arrow"})`
            : undefined
        }
        markerStart={
          e.arrow === "both"
            ? `url(#${isSel ? "gb-arrow-accent" : "gb-arrow"})`
            : undefined
        }
        pointerEvents="none"
      />
    </g>
  );
});

/**
 * An edge's label chip, drawn in a pass after all edge lines so no line
 * crosses a chip. The chip is also a click target for selecting the edge.
 * `.gb-edge-label` keeps it from shrinking below a readable size when
 * zoomed out (scaled in CSS from the camera's --gb-k; no re-render).
 */
const EdgeLabelView = memo(function EdgeLabelView({
  edge: e,
  from,
  to,
  isSel,
  onSelect,
}: {
  edge: GraphEdge;
  from: GraphNode;
  to: GraphNode;
  isSel: boolean;
  onSelect: (id: string) => void;
}) {
  const lp = quadPoint(edgeGeometryBetween(from, to), 0.5);
  const note = labelChip(e.label, lp.x, lp.y);
  const edgeStroke = isSel ? "var(--accent)" : NOTE_EDGE;
  return (
    <g
      className="gb-edge-label"
      onPointerDown={(ev) => ev.stopPropagation()}
      onClick={() => onSelect(e.id)}
    >
      <path
        d={note.body}
        fill={NOTE_FILL}
        stroke={edgeStroke}
        strokeWidth={isSel ? 1.5 : 1}
        strokeLinejoin="round"
      />
      <path
        d={note.fold}
        fill={NOTE_FOLD}
        stroke={edgeStroke}
        strokeWidth={isSel ? 1.5 : 1}
        strokeLinejoin="round"
      />
      <text
        x={lp.x}
        y={lp.y}
        textAnchor="middle"
        dominantBaseline="central"
        className="gb-edge-label-text"
        fill="var(--text)"
      >
        {e.label}
      </text>
    </g>
  );
});

type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | null;

type DragState =
  | {
      mode: "node";
      id: string;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      moved: boolean;
    }
  | {
      mode: "pan";
      startX: number;
      startY: number;
      origX: number;
      origY: number;
    }
  | null;

function Editor({
  graphId,
  onBack,
}: {
  graphId: number;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["graph", graphId],
    queryFn: () => api.getGraph({ id: graphId }),
  });

  // The project lives in an undo history (core/history.ts). Every change goes
  // through `dispatch` as ops; nothing edits the project any other way.
  // historyRef mirrors the latest history synchronously, so several
  // dispatches before a re-render each build on the previous one.
  const [history, setHistoryState] = useState<History>(() => createHistory(emptyProject("")));
  const historyRef = useRef(history);
  const setHistory = useCallback((h: History) => {
    historyRef.current = h;
    setHistoryState(h);
  }, []);
  const { title, nodes, edges, legend } = history.present;
  const [selection, setSelection] = useState<Selection>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const [confirmDeleteGraph, setConfirmDeleteGraph] = useState(false);
  const wide = useMediaQuery("(min-width: 768px)");
  // Floating editor by default; docking is the user's choice and remembered.
  const [docked, setDocked] = useState(() => readStored("gb.inspectorDocked") === 1);
  const [legendOpen, setLegendOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  // View preference, not graph data: Detailed shows subtitles, Simple only
  // titles. Remembered across graphs.
  const [detailed, setDetailed] = useState(() => readStored("gb.simpleView") !== 1);
  const canvasAreaRef = useRef<HTMLDivElement | null>(null);
  const exitFocusRef = useRef<HTMLButtonElement | null>(null);
  const zoomLabelRef = useRef<HTMLButtonElement | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; camera: Camera } | null>(null);
  const panVelRef = useRef({ x: 0, y: 0, t: 0, vx: 0, vy: 0, fromPinch: false });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const fittedForRef = useRef<number | null>(null);
  const skipRevealRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragBaseRef = useRef<Project | null>(null); // project before a node drag

  // One toast at a time: a new notice replaces the previous one, so a
  // repeating problem (e.g. an empty title while typing) never stacks up.
  const toastIdRef = useRef<string | null>(null);
  const setNotice = useCallback(
    (msg: string, kind: "danger" | "warning" | "success" = "danger") => {
      if (toastIdRef.current) toast.dismiss(toastIdRef.current);
      toastIdRef.current = toast[kind](msg);
    },
    [],
  );

  // Local state is the source of truth while editing, so every save also
  // writes it into the query cache. Without this, reopening the graph soon
  // after leaving would load the stale cached copy, and the next autosave
  // would write that stale copy over the newer edits.
  const cacheDoc = useCallback(
    (project: Project) => {
      queryClient.setQueryData(
        ["graph", graphId],
        (old: ApiResponse<typeof api, "getGraph"> | undefined) =>
          old && {
            graph: {
              ...old.graph,
              title: project.title,
              project,
              nodeCount: project.nodes.length,
              updatedAt: new Date().toISOString(),
            },
          },
      );
    },
    [queryClient, graphId],
  );

  const saveMutation = useMutation({
    mutationFn: async (project: Project) => api.saveGraph({ id: graphId, project }),
    onMutate: (doc) => cacheDoc(doc),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["graphs"] }),
    onError: (e) => setNotice(e instanceof Error ? e.message : "Save failed — try again."),
  });
  const { mutate: saveMutate, isPending: saving } = saveMutation;

  // Leaving within the autosave debounce (Back, or closing the graph) must
  // not drop the last edits: flush the pending save on the way out.
  useEffect(
    () => () => {
      if (!saveTimerRef.current) return;
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      const project = historyRef.current.present;
      if (!project.title.trim()) return;
      cacheDoc(project);
      void api
        .saveGraph({ id: graphId, project })
        .then(() => queryClient.invalidateQueries({ queryKey: ["graphs"] }))
        .catch(() => toast.danger("Your last change couldn't be saved."));
    },
    [graphId, cacheDoc, queryClient],
  );

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const project = historyRef.current.present;
      if (!project.title.trim()) {
        setNotice("The graph needs a title — type one in the header to keep saving.", "warning");
        return;
      }
      saveTimerRef.current = null;
      saveMutate(project);
    }, 600);
  }, [saveMutate, setNotice]);

  /** Apply ops as one undoable step and autosave. Edits sharing a
   * `coalesceKey` within a second merge into one step (typing a title is one
   * undo, not one per keystroke). An op that can't apply surfaces as a
   * notice and changes nothing. */
  const dispatch = useCallback(
    (ops: Op | Op[], opts?: { coalesceKey?: string }) => {
      try {
        setHistory(commit(historyRef.current, Array.isArray(ops) ? ops : [ops], opts));
      } catch (e) {
        if (e instanceof OpError) {
          setNotice(e.message);
          return;
        }
        throw e;
      }
      scheduleSave();
    },
    [setHistory, scheduleSave, setNotice],
  );

  const undoEdit = useCallback(() => {
    const h = historyRef.current;
    if (!canUndo(h)) return;
    setHistory(undo(h));
    scheduleSave();
  }, [setHistory, scheduleSave]);

  const redoEdit = useCallback(() => {
    const h = historyRef.current;
    if (!canRedo(h)) return;
    setHistory(redo(h));
    scheduleSave();
  }, [setHistory, scheduleSave]);

  const updateLegend = useCallback(
    (key: string, meaning: string) =>
      dispatch({ type: "set_legend", key, meaning }, { coalesceKey: `legend:${key}` }),
    [dispatch],
  );

  // Load the server document once per graph. Later refetches only refresh
  // the stored copy if the user has no unsaved local edits in flight. A
  // layout effect: when the graph is already cached (prefetched on hover in
  // the library) it opens with no "Opening graph…" frame in between.
  useLayoutEffect(() => {
    if (!query.data) return;
    if (loadedId === graphId) return;
    const g = query.data.graph.project;
    setHistory(createHistory(g));
    // Remembered per graph; first time, open it if the graph has meanings.
    const storedLegend = readStored(`gb.legendOpen.${graphId}`);
    setLegendOpen(
      storedLegend != null ? storedLegend === 1 : wide && Object.keys(g.legend).length > 0,
    );
    setSelection(g.nodes[0] ? { kind: "node", id: g.nodes[0].id } : null);
    skipRevealRef.current = true; // that selection is automatic; the fit frames it
    setLoadedId(graphId);
  }, [query.data, graphId, loadedId]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedNode =
    selection?.kind === "node" ? byId.get(selection.id) : undefined;
  const selectedEdge =
    selection?.kind === "edge" ? edges.find((e) => e.id === selection.id) : undefined;

  // ---- camera motion ----
  // Programmatic camera moves (zoom buttons, fit) glide on a damped spring;
  // pans released with speed coast to a stop. Both are interruptible: any
  // new pointer or wheel input cancels them. Reduced motion jumps instead.

  // The camera is not React state. Every pan, pinch, wheel, coast and
  // spring frame writes the transform straight onto the canvas <g>, so
  // moving the view never re-renders anything; the browser paints it on its
  // next frame. React renders the transform from cameraRef, so a re-render
  // for any other reason always shows the current camera.
  const cameraRef = useRef<Camera>({ x: 0, y: 0, k: 1 });
  const cameraGroupRef = useRef<SVGGElement | null>(null);
  const setCamera = useCallback((next: Camera | ((c: Camera) => Camera)) => {
    const c = typeof next === "function" ? next(cameraRef.current) : next;
    const prevK = cameraRef.current.k;
    cameraRef.current = c;
    cameraGroupRef.current?.setAttribute("transform", cameraTransform(c));
    // Zoom level for CSS (edge-label minimum size). Only written when the
    // zoom changes, so pans never trigger a style recalculation.
    if (c.k !== prevK) cameraGroupRef.current?.style.setProperty("--gb-k", String(c.k));
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = zoomPercent(c.k);
  }, []);

  /** The part of the canvas not covered by floating panels, in canvas-local
   * pixels. Every floating panel declares the edge it hugs with
   * `data-viewport-ui` (an idea from Excalidraw), so fit, zoom, keep-in-view
   * and new-node placement all centre on what the user can actually see. */
  const visibleArea = useCallback(() => {
    const el = svgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const inset = { top: 0, right: 0, bottom: 0, left: 0 };
    canvasAreaRef.current?.querySelectorAll<HTMLElement>("[data-viewport-ui]").forEach((ui) => {
      const b = ui.getBoundingClientRect();
      if (!b.width || !b.height) return;
      const side = ui.dataset.viewportUi;
      if (side === "top") inset.top = Math.max(inset.top, b.bottom - r.top);
      else if (side === "bottom") inset.bottom = Math.max(inset.bottom, r.bottom - b.top);
      else if (side === "left") inset.left = Math.max(inset.left, b.right - r.left);
      else if (side === "right") inset.right = Math.max(inset.right, r.right - b.left);
    });
    const w = r.width - inset.left - inset.right;
    const h = r.height - inset.top - inset.bottom;
    // If the panels leave too little room, fall back to the whole canvas.
    if (w < 160 || h < 120) return { x: 0, y: 0, w: r.width, h: r.height };
    return { x: inset.left, y: inset.top, w, h };
  }, []);
  const cameraAnimRef = useRef<number | null>(null);
  const cameraTargetRef = useRef<Camera | null>(null);

  const stopCameraAnim = useCallback(() => {
    if (cameraAnimRef.current != null) cancelAnimationFrame(cameraAnimRef.current);
    cameraAnimRef.current = null;
    cameraTargetRef.current = null;
  }, []);

  const moveCamera = useCallback(
    (target: Camera, animate = true) => {
      stopCameraAnim();
      if (!animate || prefersReducedMotion()) {
        setCamera(target);
        return;
      }
      cameraTargetRef.current = target;
      // Critically damped spring per axis (stiffness 260, mass 1).
      const stiffness = 260;
      const damping = 2 * Math.sqrt(stiffness);
      const cur = { ...cameraRef.current };
      const vel = { x: 0, y: 0, k: 0 };
      let last = performance.now();
      const step = (now: number) => {
        const dt = Math.min(0.032, (now - last) / 1000);
        last = now;
        let settled = true;
        for (const axis of ["x", "y", "k"] as const) {
          const force = stiffness * (target[axis] - cur[axis]) - damping * vel[axis];
          vel[axis] += force * dt;
          cur[axis] += vel[axis] * dt;
          const scale = axis === "k" ? 0.001 : 0.5;
          if (Math.abs(target[axis] - cur[axis]) > scale || Math.abs(vel[axis]) > scale) {
            settled = false;
          }
        }
        if (settled) {
          setCamera(target);
          cameraAnimRef.current = null;
          cameraTargetRef.current = null;
          return;
        }
        setCamera({ ...cur });
        cameraAnimRef.current = requestAnimationFrame(step);
      };
      cameraAnimRef.current = requestAnimationFrame(step);
    },
    [stopCameraAnim, setCamera],
  );

  /** Let a released pan keep its velocity and decay with friction. */
  const coast = useCallback(
    (vx: number, vy: number) => {
      stopCameraAnim();
      if (prefersReducedMotion() || Math.hypot(vx, vy) < 0.25) return;
      let last = performance.now();
      const step = (now: number) => {
        const dt = Math.min(32, now - last);
        last = now;
        const decay = Math.exp(-dt / 325);
        vx *= decay;
        vy *= decay;
        if (Math.hypot(vx, vy) < 0.02) {
          cameraAnimRef.current = null;
          return;
        }
        setCamera((c) => ({ ...c, x: c.x + vx * dt, y: c.y + vy * dt }));
        cameraAnimRef.current = requestAnimationFrame(step);
      };
      cameraAnimRef.current = requestAnimationFrame(step);
    },
    [stopCameraAnim, setCamera],
  );

  useEffect(() => stopCameraAnim, [stopCameraAnim]);

  const fitView = useCallback(
    (list: GraphNode[], animate = true) => {
      const area = visibleArea();
      if (!area || list.length === 0) return;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const n of list) {
        const r = nodeRect(n);
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.w);
        maxY = Math.max(maxY, r.y + r.h);
      }
      const pad = 48;
      const w = maxX - minX + pad * 2;
      const h = maxY - minY + pad * 2;
      const k = Math.min(1.15, Math.max(0.15, Math.min(area.w / w, area.h / h)));
      moveCamera(
        {
          k,
          x: area.x + area.w / 2 - ((minX + maxX) / 2) * k,
          y: area.y + area.h / 2 - ((minY + maxY) / 2) * k,
        },
        animate,
      );
    },
    [moveCamera, visibleArea],
  );

  // Fit the camera the first time each graph's nodes arrive. A layout
  // effect, so the fit lands before the first paint: with a plain effect the
  // graph flashes at the default zoom for a frame and then jumps.
  useLayoutEffect(() => {
    if (loadedId !== graphId || nodes.length === 0) return;
    if (fittedForRef.current === graphId) return;
    fittedForRef.current = graphId;
    fitView(nodes, false);
  }, [loadedId, graphId, nodes, fitView]);

  // When a selection opens the editor and the canvas shrinks under it, glide
  // the selected node back into view instead of leaving it hidden. Runs only
  // on selection changes, so dragging a node never moves the camera.
  const selectedNodeId = selection?.kind === "node" ? selection.id : null;
  useEffect(() => {
    if (!selectedNodeId) return;
    if (skipRevealRef.current) {
      skipRevealRef.current = false;
      return;
    }
    const area = visibleArea();
    const n = historyRef.current.present.nodes.find((x) => x.id === selectedNodeId);
    if (!area || !n) return;
    const c = cameraTargetRef.current ?? cameraRef.current;
    const sx = n.x * c.k + c.x;
    const sy = n.y * c.k + c.y;
    const margin = Math.min(80, area.w / 4, area.h / 4);
    const nx = Math.min(Math.max(sx, area.x + margin), area.x + area.w - margin);
    const ny = Math.min(Math.max(sy, area.y + margin), area.y + area.h - margin);
    if (nx !== sx || ny !== sy) moveCamera({ ...c, x: c.x + (nx - sx), y: c.y + (ny - sy) });
  }, [selectedNodeId, wide, docked, moveCamera, visibleArea]);

  /** Zoom to an absolute scale (or by a factor) around the visible centre. */
  const zoomTo = (next: (k: number) => number) => {
    const area = visibleArea();
    if (!area) return;
    // Repeated taps compound from where the previous glide was heading.
    const c = cameraTargetRef.current ?? cameraRef.current;
    const k = Math.min(2.5, Math.max(0.15, next(c.k)));
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    moveCamera({ k, x: cx - ((cx - c.x) / c.k) * k, y: cy - ((cy - c.y) / c.k) * k });
  };
  const zoomBy = (factor: number) => zoomTo((k) => k * factor);

  // ---- node / edge mutations (local state + autosave) ----

  const updateNode = useCallback(
    (id: string, patch: Partial<GraphNode>) =>
      dispatch(
        { type: "update_node", id, patch },
        { coalesceKey: `node:${id}:${Object.keys(patch).join(",")}` },
      ),
    [dispatch],
  );

  const addNode = () => {
    const area = visibleArea();
    const cam = cameraRef.current;
    const cx = area ? (area.x + area.w / 2 - cam.x) / cam.k : 0;
    const cy = area ? (area.y + area.h / 2 - cam.y) / cam.k : 0;
    const n: GraphNode = {
      id: uid(),
      title: "New idea",
      subtitle: "",
      body: "",
      color: "paper",
      size: "md",
      dimmed: false,
      shape: "circle",
      emoji: "",
      image: "",
      kind: "",
      provenance: null,
      x: Math.round(cx + (Math.random() * 60 - 30)),
      y: Math.round(cy + (Math.random() * 60 - 30)),
    };
    dispatch({ type: "add_node", node: n });
    setSelection({ kind: "node", id: n.id });
    setConnectFrom(null);
  };

  const deleteNode = useCallback(
    (id: string) => {
      dispatch({ type: "remove_node", id });
      setSelection(null);
      setConnectFrom((c) => (c === id ? null : c));
    },
    [dispatch],
  );

  const updateEdge = useCallback(
    (id: string, patch: Partial<GraphEdge>) =>
      dispatch(
        { type: "update_edge", id, patch },
        { coalesceKey: `edge:${id}:${Object.keys(patch).join(",")}` },
      ),
    [dispatch],
  );

  const deleteEdge = useCallback(
    (id: string) => {
      dispatch({ type: "remove_edge", id });
      setSelection(null);
    },
    [dispatch],
  );

  const selectEdge = useCallback((id: string) => setSelection({ kind: "edge", id }), []);
  const clearSelection = useCallback(() => setSelection(null), []);

  const tapNode = (id: string) => {
    if (connectFrom) {
      if (connectFrom !== id) {
        const exists = edges.some(
          (e) =>
            (e.from === connectFrom && e.to === id) ||
            (e.from === id && e.to === connectFrom),
        );
        if (!exists) {
          const e: GraphEdge = {
            id: uid(),
            from: connectFrom,
            to: id,
            label: "",
            style: "solid",
            arrow: "forward",
          };
          dispatch({ type: "add_edge", edge: e });
          setSelection({ kind: "edge", id: e.id });
        } else {
          setSelection({ kind: "node", id });
        }
      } else {
        setSelection({ kind: "node", id });
      }
      setConnectFrom(null);
      return;
    }
    setSelection({ kind: "node", id });
  };

  // ---- pointer handling: drag nodes, pan, pinch-zoom ----

  // Pointer events can arrive many times per frame (high-rate mice,
  // trackpads, Firefox). Node drags are React state, so queue those updates
  // and apply them once per animation frame. (Camera moves skip React
  // entirely; see setCamera.)
  const frameRef = useRef<number | null>(null);
  const frameQueueRef = useRef<(() => void)[]>([]);
  const flushFrame = useCallback(() => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const queue = frameQueueRef.current;
    frameQueueRef.current = [];
    if (queue.length === 0) return;
    // flushSync renders now, before this frame paints. A plain setState
    // from a rAF callback is rendered after the paint, which shows up as
    // the node trailing the pointer by a frame.
    flushSync(() => {
      for (const fn of queue) fn();
    });
  }, []);
  const queueFrame = useCallback(
    (fn: () => void) => {
      frameQueueRef.current.push(fn);
      if (frameRef.current == null) frameRef.current = requestAnimationFrame(flushFrame);
    },
    [flushFrame],
  );
  useEffect(
    () => () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const onNodePointerDown = (e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    stopCameraAnim();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const n = byId.get(id);
    if (!n) return;
    dragRef.current = {
      mode: "node",
      id,
      startX: e.clientX,
      startY: e.clientY,
      origX: n.x,
      origY: n.y,
      moved: false,
    };
  };

  /** Keyboard path for nodes: Enter/Space selects (or completes a connection), arrows nudge. */
  const onNodeKeyDown = (e: React.KeyboardEvent, n: GraphNode) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      tapNode(n.id);
      return;
    }
    const step = e.shiftKey ? 50 : 10;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    updateNode(n.id, { x: n.x + d[0], y: n.y + d[1] });
  };

  // NodeView is memoized, so it gets one stable events object that forwards
  // to the latest handlers (which close over fresh state every render).
  const nodeHandlersRef = useRef({ onNodePointerDown, onNodeKeyDown });
  nodeHandlersRef.current = { onNodePointerDown, onNodeKeyDown };
  const nodeEvents = useMemo<NodeEvents>(
    () => ({
      onPointerDown: (e, id) => nodeHandlersRef.current.onNodePointerDown(e, id),
      onKeyDown: (e, n) => nodeHandlersRef.current.onNodeKeyDown(e, n),
    }),
    [],
  );

  const startPan = (x: number, y: number, t: number, fromPinch = false) => {
    dragRef.current = {
      mode: "pan",
      startX: x,
      startY: y,
      origX: cameraRef.current.x,
      origY: cameraRef.current.y,
    };
    panVelRef.current = { x, y, t, vx: 0, vy: 0, fromPinch };
  };

  const onCanvasPointerDown = (e: ReactPointerEvent) => {
    stopCameraAnim();
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const [p1, p2] = [...pointersRef.current.values()];
      if (p1 && p2) {
        pinchRef.current = {
          dist: Math.hypot(p1.x - p2.x, p1.y - p2.y),
          camera: cameraRef.current,
        };
      }
      dragRef.current = null;
      return;
    }
    startPan(e.clientX, e.clientY, e.timeStamp);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pinchRef.current && pointersRef.current.size === 2) {
      const [p1, p2] = [...pointersRef.current.values()];
      const start = pinchRef.current;
      if (p1 && p2 && start.dist > 0) {
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const rect = svgRef.current?.getBoundingClientRect();
        if (rect) {
          const midX = (p1.x + p2.x) / 2 - rect.left;
          const midY = (p1.y + p2.y) / 2 - rect.top;
          const k = Math.min(2.5, Math.max(0.15, start.camera.k * (dist / start.dist)));
          setCamera({
            k,
            x: midX - ((midX - start.camera.x) / start.camera.k) * k,
            y: midY - ((midY - start.camera.y) / start.camera.k) * k,
          });
        }
      }
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.mode === "pan") {
      // Smoothed release velocity (px/ms) so a flick can coast.
      const v = panVelRef.current;
      const dt = e.timeStamp - v.t;
      if (dt > 0) {
        v.vx = 0.8 * ((e.clientX - v.x) / dt) + 0.2 * v.vx;
        v.vy = 0.8 * ((e.clientY - v.y) / dt) + 0.2 * v.vy;
        v.x = e.clientX;
        v.y = e.clientY;
        v.t = e.timeStamp;
      }
      const x = drag.origX + (e.clientX - drag.startX);
      const y = drag.origY + (e.clientY - drag.startY);
      setCamera((c) => ({ ...c, x, y }));
    } else {
      const dx = (e.clientX - drag.startX) / cameraRef.current.k;
      const dy = (e.clientY - drag.startY) / cameraRef.current.k;
      if (
        !drag.moved &&
        Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 4
      ) {
        drag.moved = true;
        dragBaseRef.current = historyRef.current.present;
        setDraggingId(drag.id);
      }
      if (drag.moved) {
        const nx = Math.round(drag.origX + dx);
        const ny = Math.round(drag.origY + dy);
        // Previewed, not committed: one undo step is recorded on release.
        queueFrame(() =>
          setHistory(preview(historyRef.current, [{ type: "move_node", id: drag.id, x: nx, y: ny }])),
        );
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    flushFrame();
    pointersRef.current.delete(e.pointerId);
    if (pinchRef.current && pointersRef.current.size === 1) {
      // Lifting one finger of a pinch hands over to a pan with the other,
      // so the canvas never goes dead under a finger still touching it.
      pinchRef.current = null;
      const [rest] = [...pointersRef.current.values()];
      if (rest) startPan(rest.x, rest.y, e.timeStamp, true);
      return;
    }
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const drag = dragRef.current;
    dragRef.current = null;
    setDraggingId(null);
    if (!drag) return;
    if (drag.mode === "node") {
      if (drag.moved) {
        // The whole drag becomes one undo step.
        if (dragBaseRef.current) setHistory(commitFrom(historyRef.current, dragBaseRef.current));
        dragBaseRef.current = null;
        scheduleSave();
      }
      else tapNode(drag.id);
    } else {
      // A pan that didn't move is a tap on empty canvas: clear selection.
      const still = e.clientX === drag.startX && e.clientY === drag.startY;
      if (still && !panVelRef.current.fromPinch) {
        setSelection(null);
        setConnectFrom(null);
      } else if (!still && e.type === "pointerup") {
        const v = panVelRef.current;
        // A finger that paused before lifting has no momentum left.
        if (e.timeStamp - v.t < 80) coast(v.vx, v.vy);
      }
    }
  };

  // Trackpad pinch arrives as ctrl+wheel and two-finger scroll as small
  // pixel deltas: pinch zooms in proportion to the gesture, scroll pans, and
  // notched mouse wheels zoom. Attached natively because React's wheel
  // listener is passive and can't stop the browser zooming the page.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopCameraAnim();
      const rect = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      const mouseWheel =
        e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
      if (!e.ctrlKey && !e.metaKey && !mouseWheel) {
        setCamera((c) => ({ ...c, x: c.x - dx, y: c.y - dy }));
        return;
      }
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
      setCamera((c) => {
        const k = Math.min(2.5, Math.max(0.15, c.k * factor));
        return { k, x: mx - ((mx - c.x) / c.k) * k, y: my - ((my - c.y) / c.k) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [loadedId, stopCameraAnim, setCamera]);

  // ---- export ----

  const exportJson = () => {
    download(
      `${title.trim() || "graph"}.json`,
      // The portable project file (core/project.ts), not just nodes and edges.
      new Blob([JSON.stringify(historyRef.current.present, null, 2)], {
        type: "application/json",
      }),
    );
  };

  const exportSvgString = (): string => {
    if (nodes.length === 0) return "";
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      const r = nodeRect(n);
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    }
    const pad = 40;
    // The legend is drawn below the graph so exported images explain themselves.
    const groups = legendGroups(nodes, edges);
    const rowH = 20;
    const legendH = groups.length
      ? 28 + groups.reduce((sum, g) => sum + 18 + g.entries.length * rowH, 0)
      : 0;
    const w = Math.max(maxX - minX + pad * 2, groups.length ? 280 : 0);
    const h = maxY - minY + pad * 2 + legendH;
    const ox = -minX + pad;
    const oy = -minY + pad;
    const parts: string[] = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    );
    parts.push(`<rect width="${w}" height="${h}" fill="#edecea"/>`);
    parts.push(
      `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#1b1b1b"/></marker></defs>`,
    );
    for (const e of edges) {
      const g = edgeGeometry(e, byId);
      if (!g) continue;
      parts.push(
        `<path d="M ${g.p1.x + ox} ${g.p1.y + oy} Q ${g.cx + ox} ${g.cy + oy} ${g.p2.x + ox} ${g.p2.y + oy}" fill="none" stroke="#1b1b1b" stroke-width="1.8" ${e.style === "dashed" ? `stroke-dasharray="6 5"` : ""} ${e.arrow === "forward" || e.arrow === "both" ? `marker-end="url(#arr)"` : ""} ${e.arrow === "both" ? `marker-start="url(#arr)"` : ""}/>`,
      );
    }
    for (const e of edges) {
      if (!e.label) continue;
      const g = edgeGeometry(e, byId);
      if (!g) continue;
      const lp = quadPoint(g, 0.5);
      const note = labelChip(e.label, lp.x + ox, lp.y + oy);
      parts.push(
        `<path d="${note.body}" fill="${NOTE_FILL}" stroke="${NOTE_EDGE}" stroke-linejoin="round"/>`,
        `<path d="${note.fold}" fill="${NOTE_FOLD}" stroke="${NOTE_EDGE}" stroke-linejoin="round"/>`,
        `<text x="${lp.x + ox}" y="${lp.y + oy}" text-anchor="middle" dominant-baseline="central" font-family="'Helvetica Neue', Helvetica, sans-serif" font-weight="500" font-size="${LABEL_FONT_SIZE}" fill="#1b1b1b">${escapeXml(e.label)}</text>`,
      );
    }
    for (const n of nodes) {
      if (n.shape !== "circle") {
        const half = SIZES[n.size].w / 2;
        const cx = n.x + ox;
        const cy = n.y + oy;
        const shape =
          n.shape === "emoji"
            ? `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${half * 1.2}">${escapeXml(n.emoji || "❓")}</text>`
            : n.image
              ? `<image href="${escapeXml(n.image)}" x="${cx - half}" y="${cy - half}" width="${half * 2}" height="${half * 2}" preserveAspectRatio="xMidYMid meet"/>`
              : `<rect x="${cx - half}" y="${cy - half}" width="${half * 2}" height="${half * 2}" fill="#fafaf7" stroke="#1b1b1b" stroke-width="1.4" stroke-dasharray="4 4"/>`;
        const caption = captionLines(n)
          .map(
            (ln, i) =>
              `<text x="${cx}" y="${cy + half + 18 + i * 15}" text-anchor="middle" font-family="'Helvetica Neue', Helvetica, sans-serif" font-weight="bold" font-size="13" fill="#1b1b1b">${escapeXml(ln)}</text>`,
          )
          .join("");
        parts.push(`<g opacity="${n.dimmed ? 0.45 : 1}">${shape}${caption}</g>`);
        continue;
      }
      const c = colorOf(n.color);
      const fill = n.color === "paper" ? "#fafaf7" : c.fill;
      const ink = n.color === "paper" ? "#1b1b1b" : c.ink;
      const r = nodeRect(n);
      const layout = circleTextLayout(n, detailed);
      const texts = layout.title
        .map(
          (ln) =>
            `<text x="${n.x + ox}" y="${n.y + oy + ln.dy}" text-anchor="middle" font-family="'Helvetica Neue', Helvetica, sans-serif" font-weight="bold" font-size="${layout.fontSize}" fill="${ink}">${escapeXml(ln.text)}</text>`,
        )
        .join("");
      const sub = layout.sub
        .map(
          (ln) =>
            `<text x="${n.x + ox}" y="${n.y + oy + ln.dy}" text-anchor="middle" font-family="monospace" font-size="${SUBTITLE_FONT}" letter-spacing="0.8" fill="${ink}" opacity="0.78">${escapeXml(ln.text)}</text>`,
        )
        .join("");
      parts.push(
        `<g opacity="${n.dimmed ? 0.45 : 1}"><circle cx="${n.x + ox}" cy="${n.y + oy}" r="${r.w / 2}" fill="${fill}" stroke="#1b1b1b" stroke-width="1.4"/>${texts}${sub}</g>`,
      );
    }
    if (groups.length) {
      const mono = `font-family="monospace" letter-spacing="1"`;
      let y = maxY - minY + pad * 2;
      parts.push(
        `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="#d7d7cf"/>`,
        `<text x="${pad}" y="${y + 20}" ${mono} font-size="10" fill="#71716a">LEGEND</text>`,
      );
      y += 28;
      for (const g of groups) {
        parts.push(
          `<text x="${pad}" y="${y + 12}" ${mono} font-size="9" fill="#71716a">${escapeXml(g.title.toUpperCase())}</text>`,
        );
        y += 18;
        for (const e of g.entries) {
          const label = legend[e.key]?.trim() || e.fallback;
          parts.push(
            swatchMarkup(e.swatch, pad + 12, y + rowH / 2),
            `<text x="${pad + 32}" y="${y + rowH / 2 + 4}" font-family="'Helvetica Neue', Helvetica, sans-serif" font-size="12" fill="#1b1b1b">${escapeXml(label)}</text>`,
          );
          y += rowH;
        }
      }
    }
    parts.push("</svg>");
    return parts.join("");
  };

  const exportSvg = () => {
    const s = exportSvgString();
    if (s) download(`${title.trim() || "graph"}.svg`, new Blob([s], { type: "image/svg+xml" }));
  };

  const exportPng = () => {
    const s = exportSvgString();
    if (!s) return;
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return;
      ctx2d.scale(scale, scale);
      ctx2d.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) download(`${title.trim() || "graph"}.png`, blob);
      }, "image/png");
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
  };

  const deleteGraphMutation = useMutation({
    mutationFn: async () => api.deleteGraph({ id: graphId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["graphs"] });
      onBack();
    },
    onError: (e) => setNotice(e instanceof Error ? e.message : "Delete failed."),
  });

  const duplicateMutation = useMutation({
    mutationFn: async () => api.duplicateGraph({ id: graphId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["graphs"] });
      setNotice("Duplicated — find the copy in your library.", "success");
    },
    onError: (e) => setNotice(e instanceof Error ? e.message : "Duplicate failed."),
  });

  // ---- memoized chrome ----
  // Everything outside the canvas is memoized against what it actually
  // shows, so a drag or pan (which re-renders the Editor every frame) does
  // not re-render the header, menus, tooltips, legend or editor panel.
  // Actions reach the latest closures through a ref instead of props.
  const actionsRef = useRef({
    undo: undoEdit,
    redo: redoEdit,
    exportPng,
    exportSvg,
    exportJson,
    duplicate: () => duplicateMutation.mutate(),
    fit: () => fitView(historyRef.current.present.nodes),
    zoomBy,
    zoomReset: () => zoomTo(() => 1),
    toggleFocus: () => setFocusMode((f) => !f),
    deleteGraph: () => deleteGraphMutation.mutate(),
  });

  // Entering focus mode hides whatever had focus (often the menu item that
  // triggered it); give keyboard users the way back out.
  useEffect(() => {
    if (focusMode) exitFocusRef.current?.focus();
  }, [focusMode]);

  // Docking changes the panel's shape and the canvas's width at once; a View
  // Transition morphs the panel between its floating box and the docked
  // column instead of jumping (instant where unsupported or reduced motion).
  const setDetail = useCallback((next: boolean) => {
    setDetailed(next);
    writeStored("gb.simpleView", next ? null : 1);
  }, []);

  const toggleDock = useCallback(() => {
    withViewTransition(() =>
      setDocked((d) => {
        writeStored("gb.inspectorDocked", d ? null : 1);
        return !d;
      }),
    );
  }, []);
  const toggleLegend = useCallback(() => {
    setLegendOpen((o) => {
      writeStored(`gb.legendOpen.${graphId}`, o ? 2 : 1); // 1 open, 2 closed
      return !o;
    });
  }, [graphId]);

  // Keyboard: Esc cancels connecting, then clears the selection (which
  // closes the floating editor); Ctrl/Cmd + . toggles focus mode. Typing in
  // a field, the menu or a dialog keeps its own Escape.
  const keyStateRef = useRef({ connectFrom, selection });
  keyStateRef.current = { connectFrom, selection };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      // Undo/redo the graph, except while typing: text fields keep the
      // browser's own undo for their text.
      if (mod && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
        const t = e.target as HTMLElement | null;
        if (t?.closest("input, textarea, select, [contenteditable]")) return;
        e.preventDefault();
        if (e.key.toLowerCase() === "y" || e.shiftKey) actionsRef.current.redo();
        else actionsRef.current.undo();
        return;
      }
      if (mod && e.key === ".") {
        e.preventDefault();
        setFocusMode((f) => !f);
        return;
      }
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable], dialog, [popover]")) return;
      const st = keyStateRef.current;
      if (st.connectFrom) setConnectFrom(null);
      else if (st.selection) setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  actionsRef.current = {
    undo: undoEdit,
    redo: redoEdit,
    exportPng,
    exportSvg,
    exportJson,
    duplicate: () => duplicateMutation.mutate(),
    fit: () => fitView(historyRef.current.present.nodes),
    zoomBy,
    zoomReset: () => zoomTo(() => 1),
    toggleFocus: () => setFocusMode((f) => !f),
    deleteGraph: () => deleteGraphMutation.mutate(),
  };
  const deleting = deleteGraphMutation.isPending;

  // The panel shows a node's content, not its position: keep the same
  // object while only x/y change so dragging the selected node doesn't
  // re-render the whole form.
  const panelNode = useStableIgnoringPosition(selectedNode);
  // Connection lists and edge headers only need titles.
  const titlesKey = nodes.map((n) => `${n.id}\u0000${n.title}`).join("\u0001");
  const titleById = useMemo(
    () => new Map(nodes.map((n) => [n.id, n.title] as const)),
    [titlesKey],
  );
  // The legend depends on which options are used, not on positions.
  const legendSig =
    nodes.map((n) => `${n.shape}|${n.color}|${n.size}|${n.dimmed ? 1 : 0}`).join(",") +
    "/" +
    edges.map((e) => e.style + e.arrow).join(",");
  const legendGroupsMemo = useMemo(
    () => legendGroups(historyRef.current.present.nodes, historyRef.current.present.edges),
    [legendSig],
  );

  const undoable = canUndo(history);
  const redoable = canRedo(history);
  const inspectorMode: InspectorMode = !wide ? "sheet" : docked ? "docked" : "floating";
  const floatingEditorOpen =
    !focusMode && inspectorMode === "floating" && !!(panelNode || selectedEdge);
  // Focus goes back to the node that was being edited when the editor
  // closes with focus inside it (see InspectorPane).
  const lastNodeIdRef = useRef<string | null>(null);
  if (panelNode) lastNodeIdRef.current = panelNode.id;
  const restoreFocusToNode = useCallback(() => {
    const id = lastNodeIdRef.current;
    const el = id
      ? canvasAreaRef.current?.querySelector<SVGGElement>(`[data-node-id="${CSS.escape(id)}"]`)
      : null;
    el?.focus();
  }, []);

  // Top-left: back, title, save state, graph menu.
  const menuIslandEl = useMemo(
    () => (
      <div
        role="group"
        aria-label="Graph"
        data-viewport-ui="top"
        className={`gb-island absolute left-2 top-2 z-30 ml-safe mt-safe flex items-center gap-1 p-1 ${
          !wide
            ? "max-w-[calc(100%-12rem)]"
            : floatingEditorOpen
              ? "max-w-[calc(100%-21rem)]"
              : "max-w-[calc(100%-1rem)]"
        }`}
      >
        <Button
          size="sm"
          variant="ghost"
          aria-label="Back to library"
          data-tip="Back to library"
          data-tip-placement="bottom"
          onClick={onBack}
          className="gb-icon-btn"
        >
          <BackIcon />
        </Button>
        <input
          maxLength={120}
          aria-label="Graph title"
          style={{ viewTransitionName: `gb-title-${graphId}` }}
          value={title}
          onChange={(e) =>
            dispatch({ type: "set_title", title: e.target.value }, { coalesceKey: "title" })
          }
          className="gb-sans gb-title-input min-w-0 flex-1 rounded bg-transparent px-1.5 text-[0.9375rem] font-bold text-[var(--text)]"
        />
        <span aria-live="polite" className="gb-mono hidden shrink-0 px-1 text-[10px] uppercase tracking-widest text-[var(--dim)] lg:block">
          {saving ? "Saving…" : "Saved"}
        </span>
        <span aria-hidden className="gb-island-divider" />
        <Button
          size="sm"
          variant="ghost"
          aria-label="Undo"
          data-tip="Undo (Ctrl Z)"
          data-tip-placement="bottom"
          disabled={!undoable}
          onClick={() => actionsRef.current.undo()}
          className="gb-icon-btn"
        >
          <UndoIcon />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Redo"
          data-tip="Redo (Ctrl Shift Z)"
          data-tip-placement="bottom"
          disabled={!redoable}
          onClick={() => actionsRef.current.redo()}
          className="gb-icon-btn"
        >
          <RedoIcon />
        </Button>
        <Menu label="Graph menu" trigger={<MoreIcon />}>
          <MenuItem onSelect={() => actionsRef.current.exportPng()}>Export PNG</MenuItem>
          <MenuItem onSelect={() => actionsRef.current.exportSvg()}>Export SVG</MenuItem>
          <MenuItem onSelect={() => actionsRef.current.exportJson()}>Export JSON</MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => actionsRef.current.duplicate()}>Duplicate graph</MenuItem>
          <MenuItem onSelect={() => actionsRef.current.fit()}>Fit view</MenuItem>
          <MenuItem checked={detailed} onSelect={() => setDetail(!detailed)}>
            Detailed view
          </MenuItem>
          <MenuItem onSelect={() => actionsRef.current.toggleFocus()}>
            Focus mode <span className="gb-mono ml-auto pl-4 text-[10px] text-[var(--dim)]">Ctrl .</span>
          </MenuItem>
          <MenuSeparator />
          <MenuItem destructive onSelect={() => setConfirmDeleteGraph(true)}>
            Delete graph…
          </MenuItem>
        </Menu>
      </div>
    ),
    [title, saving, onBack, graphId, dispatch, wide, floatingEditorOpen, detailed, setDetail, undoable, redoable],
  );

  // Navigation: zoom out / level / in / fit. Bottom-left on wide screens,
  // top-right on narrow ones (the bottom belongs to the toolbar there). The
  // zoom level is written by setCamera, not rendered by React. Tooltips are
  // CSS-only (`data-tip`); each button's aria-label is its accessible name.
  const navIslandEl = useMemo(
    () => (
      <div
        role="group"
        aria-label="Zoom"
        data-viewport-ui={wide ? "bottom" : "top"}
        className={`gb-island absolute z-30 flex items-center gap-0.5 p-1 ${
          wide ? "bottom-2 left-2 mb-safe ml-safe" : "right-2 top-2 mr-safe mt-safe"
        }`}
      >
        <Button
          size="sm"
          variant="ghost"
          aria-label="Zoom out"
          data-tip="Zoom out"
          data-tip-placement="top"
          onClick={() => actionsRef.current.zoomBy(0.8)}
          className="gb-icon-btn"
        >
          <MinusIcon />
        </Button>
        <button
          ref={zoomLabelRef}
          type="button"
          aria-label="Reset zoom to 100%"
          data-tip="Reset to 100%"
          data-tip-placement="top"
          onClick={() => actionsRef.current.zoomReset()}
          className="gb-zoom-label gb-mono"
        >
          {zoomPercent(cameraRef.current.k)}
        </button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Zoom in"
          data-tip="Zoom in"
          data-tip-placement="top"
          onClick={() => actionsRef.current.zoomBy(1.25)}
          className="gb-icon-btn"
        >
          <PlusIcon />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Fit graph to view"
          data-tip="Fit to view"
          data-tip-placement="top"
          onClick={() => actionsRef.current.fit()}
          className="gb-icon-btn"
        >
          <FitIcon />
        </Button>
        {wide && (
          <>
            <span aria-hidden className="gb-island-divider" />
            <ChoiceGroup
              variant="segmented"
              label="Node detail"
              hideLabel
              value={detailed ? "detailed" : "simple"}
              onChange={(v) => setDetail(v === "detailed")}
              options={[
                { value: "simple", label: "Simple", tip: "Titles only", tipPlacement: "top-start" },
                { value: "detailed", label: "Detailed", tip: "Titles and subtitles", tipPlacement: "top-end" },
              ]}
            />
          </>
        )}
      </div>
    ),
    [wide, detailed, setDetail],
  );

  const inspectorEl = useMemo(
    () =>
      !focusMode && (panelNode || selectedEdge || inspectorMode === "docked") ? (
        <InspectorPane
          key={inspectorMode}
          mode={inspectorMode}
          label={panelNode ? "Node" : selectedEdge ? "Edge" : "Editor"}
          onDismiss={clearSelection}
          onToggleDock={inspectorMode === "sheet" ? undefined : toggleDock}
          restoreFocus={restoreFocusToNode}
        >
          {!panelNode && !selectedEdge && (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
              <p className="gb-sans text-base font-bold text-[var(--text)]">Nothing selected</p>
              <p className="text-sm text-[var(--dim)]">
                Select a node or an edge on the canvas to edit it here.
              </p>
            </div>
          )}
          {panelNode && (
            <NodePanel
              node={panelNode}
              edges={edges}
              titleById={titleById}
              legend={legend}
              onChange={updateNode}
              onDelete={deleteNode}
              onSelectEdge={selectEdge}
            />
          )}
          {selectedEdge && (
            <EdgePanel
              edge={selectedEdge}
              titleById={titleById}
              legend={legend}
              onChange={updateEdge}
              onDelete={deleteEdge}
            />
          )}
        </InspectorPane>
      ) : null,
    [
      focusMode,
      inspectorMode,
      panelNode,
      selectedEdge,
      edges,
      titleById,
      legend,
      updateNode,
      deleteNode,
      updateEdge,
      deleteEdge,
      selectEdge,
      clearSelection,
      toggleDock,
      restoreFocusToNode,
    ],
  );

  // Delete-graph confirmation: a native <dialog> (see ui.tsx).
  const dialogEl = useMemo(
    () => (
      <Dialog
        open={confirmDeleteGraph}
        onOpenChange={setConfirmDeleteGraph}
        title={`Delete “${title}”?`}
        description="The graph and all its nodes and edges will be gone. This can't be undone."
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirmDeleteGraph(false)}>Keep it</Button>
          <Button variant="danger" loading={deleting} onClick={() => actionsRef.current.deleteGraph()}>
            Delete graph
          </Button>
        </div>
      </Dialog>
    ),
    [confirmDeleteGraph, title, deleting],
  );

  if (query.isPending || loadedId !== graphId) {
    return (
      <div className="gb-paper flex min-h-screen items-center justify-center">
        <p className="text-sm text-[var(--dim)]">Opening graph…</p>
      </div>
    );
  }
  if (query.error) {
    return (
      <div className="gb-paper flex min-h-screen flex-col items-center justify-center gap-3 px-6">
        <p className="text-sm text-[var(--text)]">Couldn't open that graph.</p>
        <Button onClick={onBack}>Back to library</Button>
      </div>
    );
  }

  const connectSource = connectFrom ? byId.get(connectFrom) : undefined;
  if (connectFrom && !connectSource) setConnectFrom(null); // source undone away

  // Layout: the canvas is the whole editor. Everything else floats on it
  // as small panels ("islands"), except a docked editor (which takes its
  // own column) and the narrow-screen sheet (its own row).
  return (
    <div className="flex h-full flex-col md:flex-row">
      <div ref={canvasAreaRef} className="relative min-h-0 min-w-0 flex-1">
        {/* Chrome first in the DOM, so keyboard users reach the menu, tools
            and editor before tabbing through every node on the canvas. The
            islands are absolutely positioned above it, so DOM order doesn't
            change what's painted on top. */}
        {focusMode ? (
          <Button
            ref={exitFocusRef}
            size="sm"
            data-viewport-ui="top"
            aria-label="Exit focus mode"
            data-tip="Ctrl ."
            data-tip-placement="bottom-end"
            onClick={() => setFocusMode(false)}
            className="gb-island gb-island-enter absolute right-2 top-2 z-30 mr-safe mt-safe"
          >
            Exit focus
          </Button>
        ) : (
          <>
            {menuIslandEl}

            {/* Bottom centre: the connect prompt sits just above the tools
                it was started from. A centred flex row, not translate(-50%),
                so the islands' own translate/scale stay free for motion. */}
            <div className="pointer-events-none absolute inset-x-2 bottom-2 z-30 mb-safe flex flex-col items-center gap-2">
              {connectFrom && (
                <div
                  role="status"
                  data-viewport-ui="bottom"
                  className="gb-island gb-island-enter pointer-events-auto flex max-w-full items-center gap-3 py-1 pl-3 pr-1 text-sm"
                >
                  <span className="min-w-0 truncate">
                    Connecting from <strong>{connectSource?.title || "node"}</strong> — tap the
                    node it points to
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setConnectFrom(null)}>
                    Cancel <span className="gb-mono text-[10px] text-[var(--dim)]">Esc</span>
                  </Button>
                </div>
              )}
              <div
                role="group"
                aria-label="Tools"
                data-viewport-ui="bottom"
                className="gb-island pointer-events-auto flex items-center gap-1 p-1"
              >
                <Button variant="primary" onClick={addNode}>
                  + Node
                </Button>
                <Button
                  disabled={!selectedNode}
                  onClick={() => selectedNode && setConnectFrom(selectedNode.id)}
                >
                  Connect →
                </Button>
                <span aria-hidden className="mx-0.5 h-6 w-px bg-[var(--border)]" />
                <Button
                  variant="ghost"
                  aria-expanded={legendOpen}
                  aria-controls={legendOpen ? "gb-legend" : undefined}
                  onClick={toggleLegend}
                >
                  Legend
                </Button>
              </div>
            </div>

            {inspectorMode === "floating" && inspectorEl}

            {legendOpen && (
              <LegendPanel
                groups={legendGroupsMemo}
                legend={legend}
                wide={wide}
                onChange={updateLegend}
                onClose={toggleLegend}
              />
            )}

            {navIslandEl}
          </>
        )}

        <svg
          ref={svgRef}
          className="gb-paper absolute inset-0 block h-full w-full touch-none select-none"
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="application"
          aria-label="Graph canvas. Drag nodes to move them, drag the background to pan."
        >
          <defs>
            <marker
              id="gb-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="var(--text)" />
            </marker>
            <marker
              id="gb-arrow-accent"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
            </marker>
          </defs>
          <g
            ref={cameraGroupRef}
            transform={cameraTransform(cameraRef.current)}
            style={{ "--gb-k": cameraRef.current.k } as React.CSSProperties}
          >
            {edges.map((e) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              return (
                <EdgeView
                  key={e.id}
                  edge={e}
                  from={a}
                  to={b}
                  isSel={selection?.kind === "edge" && selection.id === e.id}
                  onSelect={selectEdge}
                />
              );
            })}
            {edges.map((e) => {
              if (!e.label) return null;
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              return (
                <EdgeLabelView
                  key={e.id}
                  edge={e}
                  from={a}
                  to={b}
                  isSel={selection?.kind === "edge" && selection.id === e.id}
                  onSelect={selectEdge}
                />
              );
            })}
            {nodes.map((n) => (
              <NodeView
                key={n.id}
                node={n}
                isSel={selection?.kind === "node" && selection.id === n.id}
                isSource={connectFrom === n.id}
                isDragging={draggingId === n.id}
                detailed={detailed}
                events={nodeEvents}
              />
            ))}
          </g>
        </svg>

        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="gb-sans text-xl font-bold text-[var(--text)]">A blank sheet of graph paper</p>
            <p className="max-w-xs text-sm text-[var(--dim)]">
              Tap “+ Node” below to place your first idea, then drag it where it
              belongs and connect it to the next one.
            </p>
          </div>
        )}

      </div>

      {inspectorMode !== "floating" && inspectorEl}

      {dialogEl}
    </div>
  );
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

const PANE_DEFAULT_W = 340;
const FLOAT_DEFAULT_W = 300;

function readStored(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, v: number | null) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(v));
  } catch {
    // storage unavailable (private mode etc.): size just isn't remembered
  }
}

/** Past a limit, each extra pixel of drag moves the edge less (iOS-style). */
function rubberBand(overshoot: number, dimension = 200) {
  return (1 - 1 / ((overshoot * 0.55) / dimension + 1)) * dimension;
}

type InspectorMode = "floating" | "docked" | "sheet";

/**
 * The node/edge editor, in one of three modes:
 * - floating (wide screens, default): a panel over the canvas's right edge,
 *   shown only while something is selected;
 * - docked (wide screens, opt-in via the pin): a full-height side pane that
 *   takes its own space, shown even with nothing selected;
 * - sheet (narrow screens): a bottom sheet, swiped down to close.
 * Floating and docked are resized from their left edge, the sheet from its
 * top grip. Dragging past a limit meets resistance and springs back on
 * release. Sizes are remembered per mode; double-click (or Home) on the
 * handle resets.
 */
const InspectorPane = memo(function InspectorPane({
  mode,
  label,
  onDismiss,
  onToggleDock,
  restoreFocus,
  children,
}: {
  mode: InspectorMode;
  /** Shown in the panel's top bar, e.g. "Node" or "Edge". */
  label: string;
  onDismiss: () => void;
  onToggleDock?: () => void;
  /** Where keyboard focus goes if the pane closes while focus is inside it. */
  restoreFocus?: () => void;
  children: React.ReactNode;
}) {
  const horizontal = mode !== "sheet";
  const storageKey =
    mode === "docked" ? "gb.paneWidth" : mode === "floating" ? "gb.floatWidth" : "gb.sheetHeight";
  const defaultSize = mode === "docked" ? PANE_DEFAULT_W : FLOAT_DEFAULT_W;
  const [size, setSize] = useState<number | null>(() => readStored(storageKey));
  const [live, setLive] = useState<number | null>(null); // unclamped, while dragging
  const [settling, setSettling] = useState(false);
  const paneRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ pos: number; size: number; last: number; t: number; v: number } | null>(
    null,
  );

  const limits = () =>
    horizontal
      ? { min: 260, max: Math.max(260, Math.min(640, window.innerWidth * 0.5)) }
      : { min: 140, max: Math.max(140, window.innerHeight * 0.8) };
  const clamp = (v: number) => {
    const { min, max } = limits();
    return Math.round(Math.min(max, Math.max(min, v)));
  };
  const resist = (v: number) => {
    const { min, max } = limits();
    if (v < min) return min - rubberBand(min - v);
    if (v > max) return max + rubberBand(v - max);
    return v;
  };
  const commit = (v: number | null, animate = false) => {
    setLive(null);
    setSettling(animate && !prefersReducedMotion());
    setSize(v);
    writeStored(storageKey, v);
  };
  const measured = () => {
    const r = paneRef.current?.getBoundingClientRect();
    return r ? (horizontal ? r.width : r.height) : defaultSize;
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const pos = horizontal ? e.clientX : e.clientY;
    dragRef.current = { pos, size: measured(), last: pos, t: e.timeStamp, v: 0 };
    setSettling(false);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const pos = horizontal ? e.clientX : e.clientY;
    const dt = e.timeStamp - d.t;
    if (dt > 0) {
      d.v = 0.8 * ((pos - d.last) / dt) + 0.2 * d.v;
      d.last = pos;
      d.t = e.timeStamp;
    }
    // The handle sits on the pane's leading edge, so dragging toward the
    // canvas (left / up) grows the pane.
    setLive(d.size - (pos - d.pos));
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    const raw = d.size - ((horizontal ? e.clientX : e.clientY) - d.pos);
    const stillMoving = e.timeStamp - d.t < 80;
    // Sheet only: a downward flick, or a drag well below the minimum, closes it.
    if (!horizontal && (raw < limits().min - 60 || (stillMoving && d.v > 0.9))) {
      setLive(null);
      onDismiss();
      return;
    }
    if (live == null) return; // a click on the handle, not a drag
    commit(clamp(raw), true);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 24;
    const grow = horizontal ? "ArrowLeft" : "ArrowUp";
    const shrink = horizontal ? "ArrowRight" : "ArrowDown";
    if (e.key === grow) commit(clamp(measured() + step), true);
    else if (e.key === shrink) commit(clamp(measured() - step), true);
    else if (e.key === "Home") commit(null, true);
    else if (e.key === "End") commit(limits().max, true);
    else return;
    e.preventDefault();
  };

  // Closing with Esc or × while focus is inside would drop focus on <body>;
  // a layout-effect cleanup runs before the pane leaves the DOM, so it can
  // still tell whether focus was inside.
  const restoreFocusRef = useRef(restoreFocus);
  restoreFocusRef.current = restoreFocus;
  useLayoutEffect(
    () => () => {
      if (paneRef.current?.contains(document.activeElement)) {
        const restore = restoreFocusRef.current;
        if (restore) requestAnimationFrame(restore);
      }
    },
    [],
  );

  const { min, max } = limits();
  const current = live != null ? resist(live) : size == null ? null : clamp(size);
  return (
    <aside
      ref={paneRef}
      aria-label={`${label} editor`}
      data-viewport-ui={mode === "floating" ? "right" : undefined}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget) setSettling(false);
      }}
      style={{
        viewTransitionName: "gb-inspector",
        ...(horizontal
          ? { width: current ?? defaultSize }
          : current != null
            ? { height: current }
            : {}),
      }}
      className={[
        "z-20 flex shrink-0 flex-col bg-[var(--surface)]",
        mode === "docked" && "relative border-l-2 border-[var(--text)]",
        mode === "floating" &&
          // Stops above the bottom row of islands so it never covers the toolbar.
          "gb-island gb-island-enter absolute right-2 top-2 mr-safe max-h-[calc(100%-4.75rem)]",
        mode === "sheet" && "gb-sheet relative border-t-2 border-[var(--text)]",
        mode === "sheet" && current == null && "max-h-[46%]",
        settling && "gb-pane-settle",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        role="separator"
        tabIndex={0}
        aria-label={horizontal ? "Resize editor" : "Resize editor — drag down to close"}
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-valuemin={Math.round(min)}
        aria-valuemax={Math.round(max)}
        aria-valuenow={Math.round(current ?? (horizontal ? defaultSize : min))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => commit(null, true)}
        onKeyDown={onKeyDown}
        data-dragging={live != null || undefined}
        className={`group absolute z-10 touch-none select-none ${
          horizontal
            ? "gb-resize-edge inset-y-0 -left-2 w-4 cursor-col-resize"
            : "inset-x-0 -top-2 h-7 cursor-row-resize"
        }`}
      >
        {/* Wide: the pane's own border is the handle (see .gb-resize-edge).
            Narrow: a grip, the touch convention for a draggable sheet. */}
        {!horizontal && (
          <span
            aria-hidden
            className={`absolute left-1/2 top-1/2 h-1 w-10 -translate-1/2 rounded-full bg-[var(--border)] transition-colors group-hover:bg-[var(--text)] group-focus-visible:bg-[var(--accent)] ${
              live != null ? "bg-[var(--text)]" : ""
            }`}
          />
        )}
      </div>

      {/* Top bar: what's being edited, dock toggle, close. Doesn't scroll. */}
      <div
        className={`flex shrink-0 items-center gap-1 border-b border-[var(--border)] py-1 pl-4 pr-1.5 ${
          mode === "sheet" ? "pt-3" : ""
        }`}
      >
        <p className="gb-label mr-auto">{label}</p>
        {onToggleDock && (
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={mode === "docked"}
            aria-label={mode === "docked" ? "Undock editor" : "Dock editor to the side"}
            data-tip={mode === "docked" ? "Undock" : "Dock to side"}
            data-tip-placement="bottom-end"
            onClick={onToggleDock}
            className="gb-icon-btn"
          >
            {mode === "docked" ? <UndockIcon /> : <DockIcon />}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-label="Close editor"
          data-tip="Close (Esc)"
          data-tip-placement="bottom-end"
          onClick={onDismiss}
          className="gb-icon-btn"
        >
          <CloseIcon />
        </Button>
      </div>

      <div
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 ${
          mode === "floating" ? "" : "pb-safe-or-3"
        } ${mode === "docked" ? "pr-safe-or-4" : ""}`}
      >
        {children}
      </div>
    </aside>
  );
});

// ---- legend ----
// Each graph can say what its visual options mean ("teal = early ideas",
// "dashed = speculative"). The legend lists only options the graph uses;
// blank meanings fall back to the option's plain name.


type LegendSwatch =
  | { type: "color"; color: string }
  | { type: "size"; size: NodeSize }
  | { type: "dimmed" }
  | { type: "edge"; style: EdgeStyle }
  | { type: "arrow"; arrow: ArrowKind };

type LegendEntry = { key: string; fallback: string; swatch: LegendSwatch };

const COLOR_NAMES: Record<string, string> = {
  ink: "Ink",
  paper: "Paper",
  teal: "Teal",
  vermilion: "Vermilion",
  ochre: "Ochre",
  plum: "Plum",
  sage: "Sage",
  slate: "Slate",
};

const ARROW_LABELS: Record<ArrowKind, string> = {
  forward: "Arrow →",
  both: "Both ↔",
  none: "No arrow",
};

const legendKey = {
  color: (c: string) => `color:${c}`,
  size: (s: NodeSize) => `size:${s}`,
  dimmed: "dimmed",
  edge: (s: EdgeStyle) => `edge:${s}`,
  arrow: (a: ArrowKind) => `arrow:${a}`,
};

function legendGroups(nodes: GraphNode[], edges: GraphEdge[]) {
  const circles = nodes.filter((n) => n.shape === "circle");
  const groups: { title: string; entries: LegendEntry[] }[] = [];
  const colours = COLOR_KEYS.filter((k) => circles.some((n) => n.color === k));
  if (colours.length)
    groups.push({
      title: "Colours",
      entries: colours.map((k) => ({
        key: legendKey.color(k),
        fallback: COLOR_NAMES[k] ?? k,
        swatch: { type: "color", color: k },
      })),
    });
  const sizes = (Object.keys(SIZES) as NodeSize[]).filter((s) => nodes.some((n) => n.size === s));
  if (sizes.length)
    groups.push({
      title: "Sizes",
      entries: sizes.map((s) => ({
        key: legendKey.size(s),
        fallback: SIZES[s].label,
        swatch: { type: "size", size: s },
      })),
    });
  if (nodes.some((n) => n.dimmed))
    groups.push({
      title: "Nodes",
      entries: [{ key: legendKey.dimmed, fallback: "Greyed out", swatch: { type: "dimmed" } }],
    });
  const styles = (["solid", "dashed"] as EdgeStyle[]).filter((st) => edges.some((e) => e.style === st));
  const arrows = (["forward", "both", "none"] as ArrowKind[]).filter((a) =>
    edges.some((e) => e.arrow === a),
  );
  const lines: LegendEntry[] = [
    ...styles.map((st) => ({
      key: legendKey.edge(st),
      fallback: st === "solid" ? "Solid line" : "Dashed line",
      swatch: { type: "edge", style: st } as LegendSwatch,
    })),
    ...arrows.map((a) => ({
      key: legendKey.arrow(a),
      fallback: ARROW_LABELS[a],
      swatch: { type: "arrow", arrow: a } as LegendSwatch,
    })),
  ];
  if (lines.length) groups.push({ title: "Lines", entries: lines });
  return groups;
}

/** SVG markup for a legend swatch centred on (x, y). Shared by the on-screen
 * legend and the SVG/PNG export, so they always match. Only built from
 * internal constants, never from user text. */
function swatchMarkup(d: LegendSwatch, x: number, y: number): string {
  const ink = "#1b1b1b";
  switch (d.type) {
    case "color": {
      const c = colorOf(d.color);
      const fill = d.color === "paper" ? "#fafaf7" : c.fill;
      return `<circle cx="${x}" cy="${y}" r="6" fill="${fill}" stroke="${ink}" stroke-width="1"/>`;
    }
    case "size": {
      const r = { sm: 3.5, md: 5, lg: 6.5, xl: 8 }[d.size];
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fafaf7" stroke="${ink}" stroke-width="1"/>`;
    }
    case "dimmed":
      return `<circle cx="${x}" cy="${y}" r="6" fill="#fafaf7" stroke="${ink}" stroke-width="1" opacity="0.42"/>`;
    case "edge":
      return `<line x1="${x - 10}" y1="${y}" x2="${x + 10}" y2="${y}" stroke="${ink}" stroke-width="1.6" ${d.style === "dashed" ? `stroke-dasharray="4 3"` : ""}/>`;
    case "arrow": {
      const head = (tip: number, dir: 1 | -1) =>
        `<path d="M ${tip} ${y} L ${tip - 5 * dir} ${y - 3.5} L ${tip - 5 * dir} ${y + 3.5} z" fill="${ink}"/>`;
      return (
        `<line x1="${x - 10}" y1="${y}" x2="${x + 10}" y2="${y}" stroke="${ink}" stroke-width="1.6"/>` +
        (d.arrow !== "none" ? head(x + 10, 1) : "") +
        (d.arrow === "both" ? head(x - 10, -1) : "")
      );
    }
  }
}

function Swatch({ d }: { d: LegendSwatch }) {
  return (
    <svg
      aria-hidden
      width={24}
      height={18}
      viewBox="0 0 24 18"
      className="shrink-0"
      dangerouslySetInnerHTML={{ __html: swatchMarkup(d, 12, 9) }}
    />
  );
}

/** Floating, collapsible legend on the canvas. Meanings are edited in place. */
/** Floating legend panel, toggled from the toolbar. Meanings are edited in
 * place. Bottom-left above the navigation on wide screens, top-left under
 * the menu on narrow ones. */
const LegendPanel = memo(function LegendPanel({
  groups,
  legend,
  wide,
  onChange,
  onClose,
}: {
  groups: ReturnType<typeof legendGroups>;
  legend: Legend;
  wide: boolean;
  onChange: (key: string, meaning: string) => void;
  onClose: () => void;
}) {
  return (
    <section
      id="gb-legend"
      aria-label="Legend"
      data-viewport-ui="left"
      className={`gb-island gb-island-enter absolute left-2 z-30 ml-safe flex w-64 max-w-[calc(100%-1rem)] flex-col ${
        wide
          ? "bottom-[calc(3.75rem+env(safe-area-inset-bottom))] max-h-[calc(100%-8.5rem)]"
          : "top-[calc(3.75rem+env(safe-area-inset-top))] max-h-[calc(100%-8rem)]"
      }`}
    >
      <div className="flex shrink-0 items-center border-b border-[var(--border)] py-1 pl-3 pr-1">
        <h2 className="gb-label mr-auto">Legend</h2>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Close legend"
          onClick={onClose}
          className="gb-icon-btn"
        >
          <CloseIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-3 py-2.5">
        {groups.length === 0 ? (
          <p className="text-sm text-[var(--dim)]">
            Colours, sizes and line styles you use will be listed here, so you can
            say what each one means.
          </p>
        ) : (
          <>
            {groups.map((g) => (
              <section key={g.title} aria-label={g.title}>
                <p className="gb-mono mb-1 text-[9px] uppercase tracking-widest text-[var(--dim)]">
                  {g.title}
                </p>
                <ul className="flex flex-col">
                  {g.entries.map((e) => (
                    <li key={e.key} className="flex items-center gap-2">
                      <Swatch d={e.swatch} />
                      <input
                        aria-label={`Meaning of ${e.fallback.toLowerCase()}`}
                        value={legend[e.key] ?? ""}
                        placeholder={e.fallback}
                        maxLength={80}
                        onChange={(ev) => onChange(e.key, ev.target.value)}
                        className="gb-legend-input min-w-0 flex-1 bg-transparent py-1 text-sm text-[var(--text)] placeholder:text-[var(--dim)]"
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <p className="text-xs text-[var(--dim)]">Click a label to say what it means in this graph.</p>
          </>
        )}
      </div>
    </section>
  );
});

/** A pick-one row of segments: real radio inputs (arrow keys rove natively),
 * drawn as a segmented control by theme.css. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <ChoiceGroup variant="segmented" label={label} value={value} options={options} onChange={onChange} />
  );
}

/** A group inside the editor panel. Groups are separated by hairlines (see
 * .gb-panel-sections). Only groups whose heading adds information get one;
 * those are role="group" (not <section>, which would add a landmark per
 * group to screen readers' landmark lists). */
function PanelSection({ title, children }: { title?: string; children: React.ReactNode }) {
  const id = useId();
  if (!title) return <div className="gb-panel-section">{children}</div>;
  return (
    <div role="group" aria-labelledby={id} className="gb-panel-section">
      <h3 id={id} className="gb-section-label">
        {title}
      </h3>
      {children}
    </div>
  );
}

/** "Means: …" under a picker, when the legend gives the current option a meaning. */
function Meaning({ legend, k }: { legend: Legend; k: string }) {
  const m = legend[k]?.trim();
  if (!m) return null;
  return (
    <p className="mt-1 text-xs text-[var(--dim)]">
      Means: <span className="text-[var(--text)]">{m}</span>
    </p>
  );
}

const NodePanel = memo(function NodePanel({
  node,
  edges,
  titleById,
  legend,
  onChange: onChangeById,
  onDelete: onDeleteById,
  onSelectEdge,
}: {
  node: GraphNode;
  edges: GraphEdge[];
  titleById: Map<string, string>;
  legend: Legend;
  onChange: (id: string, patch: Partial<GraphNode>) => void;
  onDelete: (id: string) => void;
  onSelectEdge: (id: string) => void;
}) {
  const onChange = (patch: Partial<GraphNode>) => onChangeById(node.id, patch);
  const onDelete = () => onDeleteById(node.id);
  const [confirming, setConfirming] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  useEffect(() => {
    setLinkDraft(null);
    setConfirming(false);
    setImageError(null);
  }, [node.id]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const connected = edges.filter((e) => e.from === node.id || e.to === node.id);
  return (
    <div className="gb-panel-sections">
      <PanelSection>
        <TextField
          label="Title"
          value={node.title}
          maxLength={120}
          placeholder="Node title"
          onChange={(e) => onChange({ title: e.target.value })}
        />
        <TextField
          label="Subtitle"
          value={node.subtitle}
          maxLength={200}
          placeholder="e.g. Main idea · the centre"
          onChange={(e) => onChange({ subtitle: e.target.value })}
        />
        <Textarea
          label="Notes"
          value={node.body}
          maxLength={4000}
          rows={3}
          placeholder="What this node means in the story — why it's here, what it connects to…"
          onChange={(e) => onChange({ body: e.target.value })}
        />
      </PanelSection>

      <PanelSection title="Appearance">
        <div>
          <Segmented
            label="Shape"
            value={node.shape}
            options={[
              { value: "circle", label: "Circle" },
              { value: "emoji", label: "Emoji" },
              { value: "image", label: "Image" },
            ]}
            onChange={(shape) =>
              onChange(shape === "emoji" && !node.emoji ? { shape, emoji: "💡" } : { shape })
            }
          />

          {node.shape === "emoji" && (
            <div className="mt-2 flex flex-wrap items-end gap-1.5">
              <TextField
                label="Emoji"
                hideLabel
                size="sm"
                value={node.emoji}
                maxLength={32}
                placeholder="🙂"
                onChange={(e) => onChange({ emoji: e.target.value.trim() })}
                wrapperClassName="w-16"
                className="text-center text-lg"
              />
              {EMOJI_PICKS.map((em) => (
                <Button
                  key={em}
                  size="sm"
                  variant={node.emoji === em ? "secondary" : "ghost"}
                  aria-label={`Use ${em}`}
                  aria-pressed={node.emoji === em}
                  onClick={() => onChange({ emoji: em })}
                >
                  {em}
                </Button>
              ))}
            </div>
          )}

          {node.shape === "image" && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => imageInputRef.current?.click()}>
                  Upload image…
                </Button>
                {node.image && (
                  <Button size="sm" variant="ghost" onClick={() => onChange({ image: "" })}>
                    Remove
                  </Button>
                )}
              </div>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setImageError(null);
                  try {
                    onChange({ image: await imageFileToDataUrl(file) });
                    setLinkDraft(null);
                  } catch {
                    setImageError("Couldn't read that image — try a PNG, JPEG or WebP.");
                  }
                }}
              />
              <TextField
                label="Image link"
                size="sm"
                value={linkDraft ?? (node.image.startsWith("data:") ? "" : node.image)}
                placeholder={node.image.startsWith("data:") ? "Using an uploaded image" : "https://…"}
                invalid={!!imageError}
                errorMessage={imageError}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  // Only commit complete links; a half-typed one would fail the save.
                  if (v === "" || /^https?:\/\/\S+\.\S+/.test(v)) {
                    setLinkDraft(null);
                    onChange({ image: v });
                  } else {
                    setLinkDraft(e.target.value);
                  }
                }}
              />
            </div>
          )}
        </div>

        {node.shape === "circle" && (
          <div>
            <ChoiceGroup
              variant="swatches"
              label="Colour"
              value={node.color}
              onChange={(color) => onChange({ color })}
              options={COLOR_KEYS.map((key, i) => ({
                value: key,
                ariaLabel: legend[legendKey.color(key)]?.trim() || COLOR_NAMES[key] || key,
                tip: [COLOR_NAMES[key] ?? key, legend[legendKey.color(key)]?.trim()]
                  .filter(Boolean)
                  .join(" — "),
                // Left half opens rightwards, right half leftwards, so the
                // scrolling panel never clips a tooltip at its edges.
                tipPlacement: i < COLOR_KEYS.length / 2 ? "top-start" : "top-end",
                label: (
                  <span
                    aria-hidden
                    className="gb-swatch"
                    style={{ backgroundColor: key === "paper" ? "var(--node-paper)" : colorOf(key).fill }}
                  />
                ),
              }))}
            />
            <Meaning legend={legend} k={legendKey.color(node.color)} />
          </div>
        )}

        <div>
          <Segmented
            label="Size"
            value={node.size}
            options={(Object.keys(SIZES) as NodeSize[]).map((s) => ({ value: s, label: SIZES[s].label }))}
            onChange={(size) => onChange({ size })}
          />
          <Meaning legend={legend} k={legendKey.size(node.size)} />
        </div>

        <div>
          <Switch checked={node.dimmed} onCheckedChange={(dimmed) => onChange({ dimmed })}>
            Greyed out
          </Switch>
          {node.dimmed && <Meaning legend={legend} k={legendKey.dimmed} />}
        </div>
      </PanelSection>

      {connected.length > 0 && (
        <PanelSection title={`Connections · ${connected.length}`}>
          <ul className="-mx-2 flex flex-col">
            {connected.map((e) => {
              const outgoing = e.from === node.id;
              const otherTitle = titleById.get(outgoing ? e.to : e.from);
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onSelectEdge(e.id)}
                    className="gb-connection"
                  >
                    <span aria-hidden>{outgoing ? "→" : "←"}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {otherTitle || "Untitled"}
                    </span>
                    {e.label && (
                      <span className="gb-mono truncate text-[10px] uppercase tracking-wide text-[var(--dim)]">
                        {e.label}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </PanelSection>
      )}

      <DeleteRow
        what="node"
        confirming={confirming}
        onConfirming={setConfirming}
        onDelete={onDelete}
      />
    </div>
  );
});

function DeleteRow({
  what,
  confirming,
  onConfirming,
  onDelete,
}: {
  what: string;
  confirming: boolean;
  onConfirming: (v: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
      {confirming ? (
        <>
          <span className="mr-auto text-sm text-[var(--dim)]">Delete this {what}?</span>
          <Button size="sm" onClick={() => onConfirming(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={onDelete}>
            Delete
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" className="gb-danger-text" onClick={() => onConfirming(true)}>
          Delete {what}
        </Button>
      )}
    </div>
  );
}

const EdgePanel = memo(function EdgePanel({
  edge,
  titleById,
  legend,
  onChange: onChangeById,
  onDelete: onDeleteById,
}: {
  edge: GraphEdge;
  titleById: Map<string, string>;
  legend: Legend;
  onChange: (id: string, patch: Partial<GraphEdge>) => void;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [edge.id]);
  const onChange = (patch: Partial<GraphEdge>) => onChangeById(edge.id, patch);
  const onDelete = () => onDeleteById(edge.id);
  const fromTitle = titleById.get(edge.from);
  const toTitle = titleById.get(edge.to);
  return (
    <div className="gb-panel-sections">
      <PanelSection>
        <p className="gb-sans text-base font-bold leading-snug text-[var(--text)]">
          {fromTitle || "Untitled"} <span aria-hidden className="text-[var(--dim)]">→</span>{" "}
          {toTitle || "Untitled"}
        </p>
        <TextField
          label="Label"
          value={edge.label}
          maxLength={120}
          placeholder="e.g. supports, leads to, steered to"
          onChange={(e) => onChange({ label: e.target.value })}
        />
      </PanelSection>

      <PanelSection title="Line">
        <div>
          <Segmented
            label="Style"
            value={edge.style}
            options={[
              { value: "solid", label: "Solid" },
              { value: "dashed", label: "Dashed" },
            ]}
            onChange={(style) => onChange({ style })}
          />
          <Meaning legend={legend} k={legendKey.edge(edge.style)} />
        </div>
        <div>
          <Segmented
            label="Arrows"
            value={edge.arrow}
            options={(["forward", "both", "none"] as ArrowKind[]).map((a) => ({
              value: a,
              label: ARROW_LABELS[a],
            }))}
            onChange={(arrow) => onChange({ arrow })}
          />
          <Meaning legend={legend} k={legendKey.arrow(edge.arrow)} />
        </div>
        <div>
          <Button size="sm" onClick={() => onChange({ from: edge.to, to: edge.from })}>
            Reverse direction
          </Button>
        </div>
      </PanelSection>
      <DeleteRow
        what="edge"
        confirming={confirming}
        onConfirming={setConfirming}
        onDelete={onDelete}
      />
    </div>
  );
});

function Library({ onOpen }: { onOpen: (id: number) => void }) {
  const queryClient = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const list = useQuery({
    queryKey: ["graphs"],
    queryFn: () => api.listGraphs({}),
  });

  const createMutation = useMutation({
    mutationFn: (args: { title: string }) => api.createGraph({ title: args.title }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["graphs"] });
      setNewTitle("");
      setTitleError(null);
      onOpen(data.graph.id);
    },
    onError: (e) =>
      setTitleError(e instanceof Error ? e.message : "Couldn't create the graph."),
  });

  const exampleMutation = useMutation({
    mutationFn: () => api.seedExampleGraph({}),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["graphs"] });
      onOpen(data.graph.id);
    },
    onError: (e) =>
      setTitleError(e instanceof Error ? e.message : "Couldn't add the example."),
  });

  const create = () => {
    if (!newTitle.trim()) {
      setTitleError("Give the graph a title first.");
      return;
    }
    createMutation.mutate({ title: newTitle.trim() });
  };

  // Accepts any project file this app has exported, old or new. The server
  // migrates and validates it (core/schema.ts), so the browser bundle
  // doesn't need a validation library.
  const importMutation = useMutation({
    mutationFn: (args: { document: unknown; fallbackTitle: string }) => api.importProject(args),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["graphs"] });
      onOpen(data.graph.id);
    },
    onError: (e) =>
      setImportError(e instanceof Error ? e.message : "That file doesn't look like a graph exported from here."),
  });
  const importFile = async (file: File) => {
    setImportError(null);
    const fallbackTitle = file.name.replace(/\.json$/i, "").trim().slice(0, 120) || "Imported graph";
    let document: unknown;
    try {
      document = JSON.parse(await file.text());
    } catch {
      setImportError("That file isn't valid JSON.");
      return;
    }
    importMutation.mutate({ document, fallbackTitle });
  };

  const graphs: GraphSummary[] = list.data?.graphs ?? [];

  // Hovering or focusing a row is intent to open it: fetch it now so the
  // editor can open instantly instead of showing a loading screen.
  const prefetch = (id: number) =>
    void queryClient.prefetchQuery({
      queryKey: ["graph", id],
      queryFn: () => api.getGraph({ id }),
      staleTime: 10_000,
    });

  // Every block shares one left edge: headings and section labels sit on the
  // page column's edge, and content inside the two cards is inset by the
  // same px-4, so titles, inputs and list rows all line up.
  return (
    <div className="gb-paper min-h-dvh">
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-safe-or-6 pb-safe-or-12 pt-safe-or-8 sm:pt-safe-or-16">
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="gb-sans text-3xl font-bold leading-tight text-[var(--text)]">
              Your graphs
            </h1>
            <p className="mt-1 text-sm text-[var(--dim)]">
              Idea maps you can rearrange whenever the story changes.
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            aria-label="Import a graph JSON file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = "";
            }}
          />
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            Import JSON…
          </Button>
          {importError && (
            <p role="alert" className="basis-full text-sm text-[var(--danger-text)]">
              {importError}
            </p>
          )}
        </header>

        <section aria-labelledby="gb-new-heading" className="flex flex-col gap-2">
          <h2 id="gb-new-heading" className="gb-section-label">
            New graph
          </h2>
          <form
            className="gb-card flex items-start gap-2 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <TextField
              label="Title"
              hideLabel
              maxLength={120}
              value={newTitle}
              onChange={(e) => {
                setNewTitle(e.target.value);
                if (titleError) setTitleError(null);
              }}
              placeholder="Give it a title — e.g. Project map"
              invalid={!!titleError}
              errorMessage={titleError}
              wrapperClassName="min-w-0 flex-1"
            />
            <Button type="submit" variant="primary" loading={createMutation.isPending}>
              Create
            </Button>
          </form>
        </section>

        <section aria-labelledby="gb-saved-heading" className="flex flex-col gap-2">
          <h2 id="gb-saved-heading" className="gb-section-label">
            Saved{list.data && graphs.length > 0 ? ` · ${graphs.length}` : ""}
          </h2>

          {list.isPending && (
            <div className="gb-card" aria-busy="true" aria-label="Loading graphs">
              {[0, 1, 2].map((i) => (
                <div key={i} className="gb-row-skeleton px-4 py-3.5">
                  <span className="block h-4 w-2/5 rounded bg-[var(--surface-alt)]" />
                  <span className="mt-2 block h-2.5 w-1/4 rounded bg-[var(--surface-alt)]" />
                </div>
              ))}
            </div>
          )}

          {list.error && (
            <div className="gb-card flex items-center justify-between gap-3 px-4 py-3.5">
              <p className="text-sm text-[var(--text)]">Couldn't load your graphs.</p>
              <Button size="sm" onClick={() => list.refetch()}>
                Retry
              </Button>
            </div>
          )}

          {list.data && graphs.length === 0 && (
            <div className="gb-card flex flex-col items-center gap-3 px-4 py-10 text-center">
              <p className="gb-sans text-base font-bold text-[var(--text)]">No graphs yet</p>
              <p className="max-w-xs text-sm text-[var(--dim)]">
                Create one above, or start from an example to see how nodes,
                lines and the legend work.
              </p>
              <Button loading={exampleMutation.isPending} onClick={() => exampleMutation.mutate()}>
                Open an example graph
              </Button>
            </div>
          )}

          {graphs.length > 0 && (
            <ul className="gb-card">
              {graphs.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(g.id)}
                    onPointerEnter={() => prefetch(g.id)}
                    onFocus={() => prefetch(g.id)}
                    className="gb-row"
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className="gb-sans block truncate text-base font-bold text-[var(--text)]"
                        style={{ viewTransitionName: `gb-title-${g.id}` }}
                      >
                        {g.title}
                      </span>
                      <span className="gb-mono mt-0.5 block text-[10px] uppercase tracking-widest text-[var(--dim)]">
                        {g.nodeCount} {g.nodeCount === 1 ? "node" : "nodes"} · edited{" "}
                        {new Date(g.updatedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </span>
                    <span aria-hidden className="gb-row-arrow">
                      →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

/** Run a navigation inside a View Transition where supported, so the graph
 * title travels from its library row into the editor header (and back).
 * Elsewhere, or with reduced motion, the screen simply swaps. */
function withViewTransition(update: () => void) {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => unknown;
  };
  if (!doc.startViewTransition || prefersReducedMotion()) {
    update();
    return;
  }
  doc.startViewTransition(() => flushSync(update));
}

export function App() {
  const [openId, setOpenId] = useState<number | null>(null);
  const open = (id: number | null) => withViewTransition(() => setOpenId(id));
  return (
    <>
      {openId != null ? (
        <div className="flex h-dvh flex-col bg-[var(--bg)]">
          <Editor graphId={openId} onBack={() => open(null)} />
        </div>
      ) : (
        <Library onOpen={open} />
      )}
      <Toaster />
    </>
  );
}
