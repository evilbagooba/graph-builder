import {
useCallback,
useEffect,
useMemo,
useRef,
useState,
type PointerEvent as ReactPointerEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

type GraphNode = ApiResponse<typeof api, "getGraph">["graph"]["nodes"][number];
type GraphEdge = ApiResponse<typeof api, "getGraph">["graph"]["edges"][number];
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

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Emoji and image nodes carry their title as a caption below the shape. */
const CAPTION_H = 48;

function nodeRect(n: GraphNode) {
  const s = SIZES[n.size];
  const extra = n.kind === "circle" ? 0 : CAPTION_H;
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
  if (a.kind === "image") {
    const t = half / Math.max(Math.abs(dx), Math.abs(dy));
    return { x: a.x + dx * t, y: a.y + dy * t };
  }
  const len = Math.hypot(dx, dy) || 1;
  const radius = a.kind === "emoji" ? half * 0.8 : half;
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

function wrapTitle(title: string, size: NodeSize): string[] {
  const perLine = size === "sm" ? 11 : size === "md" ? 14 : size === "lg" ? 17 : 20;
  const words = title.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && (line + " " + w).length > perLine) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

/** Up to two caption lines under an emoji / image node. */
function captionLines(n: GraphNode): string[] {
  return n.title ? wrapTitle(n.title, "xl").slice(0, 2) : [];
}

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

  const [title, setTitle] = useState("");
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, k: 1 });
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDeleteGraph, setConfirmDeleteGraph] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; camera: typeof camera } | null>(null);
  const panVelRef = useRef({ x: 0, y: 0, t: 0, vx: 0, vy: 0, fromPinch: false });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const fittedForRef = useRef<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({ title: "", nodes: [] as GraphNode[], edges: [] as GraphEdge[] });
  latestRef.current = { title, nodes, edges };

  const saveMutation = useMutation({
    mutationFn: async (doc: { title: string; nodes: GraphNode[]; edges: GraphEdge[] }) =>
      api.saveGraph({ id: graphId, ...doc }),
    onError: (e) => setNotice(e instanceof Error ? e.message : "Save failed — try again."),
  });

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const { title: t, nodes: n, edges: e } = latestRef.current;
      if (!t.trim()) {
        setNotice("The graph needs a title — type one in the header to keep saving.");
        return;
      }
      saveMutation.mutate({ title: t, nodes: n, edges: e });
    }, 600);
  }, [saveMutation]);

  // Load the server document once per graph. Later refetches only refresh
  // the stored copy if the user has no unsaved local edits in flight.
  useEffect(() => {
    if (!query.data) return;
    if (loadedId === graphId) return;
    const g = query.data.graph;
    setTitle(g.title);
    setNodes(g.nodes);
    setEdges(g.edges);
    setSelection(g.nodes[0] ? { kind: "node", id: g.nodes[0].id } : null);
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

  type Camera = { x: number; y: number; k: number };
  const cameraRef = useRef<Camera>(camera);
  cameraRef.current = camera;
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
    [stopCameraAnim],
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
    [stopCameraAnim],
  );

  useEffect(() => stopCameraAnim, [stopCameraAnim]);

  const fitView = useCallback(
    (list: GraphNode[], animate = true) => {
      const el = svgRef.current;
      if (!el || list.length === 0) return;
      const rect = el.getBoundingClientRect();
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
      const k = Math.min(1.15, Math.max(0.15, Math.min(rect.width / w, rect.height / h)));
      moveCamera(
        {
          k,
          x: rect.width / 2 - ((minX + maxX) / 2) * k,
          y: rect.height / 2 - ((minY + maxY) / 2) * k,
        },
        animate,
      );
    },
    [moveCamera],
  );

  // Fit the camera the first time each graph's nodes arrive.
  useEffect(() => {
    if (loadedId !== graphId || nodes.length === 0) return;
    if (fittedForRef.current === graphId) return;
    fittedForRef.current = graphId;
    fitView(nodes, false);
  }, [loadedId, graphId, nodes, fitView]);

  const zoomBy = (factor: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Repeated taps compound from where the previous glide was heading.
    const c = cameraTargetRef.current ?? cameraRef.current;
    const k = Math.min(2.5, Math.max(0.15, c.k * factor));
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    moveCamera({ k, x: cx - ((cx - c.x) / c.k) * k, y: cy - ((cy - c.y) / c.k) * k });
  };

  // ---- node / edge mutations (local state + autosave) ----

  const updateNode = (id: string, patch: Partial<GraphNode>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    scheduleSave();
  };

  const addNode = () => {
    const rect = svgRef.current?.getBoundingClientRect();
    const cx = rect ? (rect.width / 2 - camera.x) / camera.k : 0;
    const cy = rect ? (rect.height / 2 - camera.y) / camera.k : 0;
    const n: GraphNode = {
      id: uid(),
      title: "New idea",
      subtitle: "",
      body: "",
      color: "paper",
      size: "md",
      dimmed: false,
      kind: "circle",
      emoji: "",
      image: "",
      x: Math.round(cx + (Math.random() * 60 - 30)),
      y: Math.round(cy + (Math.random() * 60 - 30)),
    };
    setNodes((ns) => [...ns, n]);
    setSelection({ kind: "node", id: n.id });
    setConnectFrom(null);
    scheduleSave();
  };

  const deleteNode = (id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.from !== id && e.to !== id));
    setSelection(null);
    if (connectFrom === id) setConnectFrom(null);
    scheduleSave();
  };

  const updateEdge = (id: string, patch: Partial<GraphEdge>) => {
    setEdges((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    scheduleSave();
  };

  const deleteEdge = (id: string) => {
    setEdges((es) => es.filter((e) => e.id !== id));
    setSelection(null);
    scheduleSave();
  };

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
          setEdges((es) => [...es, e]);
          setSelection({ kind: "edge", id: e.id });
          scheduleSave();
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
      setCamera((c) => ({
        ...c,
        x: drag.origX + (e.clientX - drag.startX),
        y: drag.origY + (e.clientY - drag.startY),
      }));
    } else {
      const dx = (e.clientX - drag.startX) / camera.k;
      const dy = (e.clientY - drag.startY) / camera.k;
      if (
        !drag.moved &&
        Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 4
      ) {
        drag.moved = true;
        setDraggingId(drag.id);
      }
      if (drag.moved) {
        const nx = Math.round(drag.origX + dx);
        const ny = Math.round(drag.origY + dy);
        setNodes((ns) => ns.map((n) => (n.id === drag.id ? { ...n, x: nx, y: ny } : n)));
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
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
      if (drag.moved) scheduleSave();
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
  }, [loadedId, stopCameraAnim]);

  // ---- export ----

  const exportJson = () => {
    download(
      `${title.trim() || "graph"}.json`,
      new Blob([JSON.stringify({ title, nodes, edges }, null, 2)], {
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
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
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
      if (e.label) {
        const lp = quadPoint(g, 0.5);
        parts.push(
          `<text x="${lp.x + ox}" y="${lp.y + oy - 6}" text-anchor="middle" font-family="monospace" font-size="11" letter-spacing="1" fill="#1b1b1b">${escapeXml(e.label.toUpperCase())}</text>`,
        );
      }
    }
    for (const n of nodes) {
      if (n.kind !== "circle") {
        const half = SIZES[n.size].w / 2;
        const cx = n.x + ox;
        const cy = n.y + oy;
        const shape =
          n.kind === "emoji"
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
      const lines = wrapTitle(n.title || "Untitled", n.size);
      const fontSize = n.size === "sm" ? 13 : n.size === "md" ? 15 : n.size === "lg" ? 17 : 20;
      const startY = n.y + oy - ((lines.length - 1) * (fontSize + 3)) / 2 + (n.subtitle ? -6 : 4);
      const texts = lines
        .map(
          (ln, i) =>
            `<text x="${n.x + ox}" y="${startY + i * (fontSize + 3)}" text-anchor="middle" font-family="'Helvetica Neue', Helvetica, sans-serif" font-weight="bold" font-size="${fontSize}" fill="${ink}">${escapeXml(ln)}</text>`,
        )
        .join("");
      const sub = n.subtitle
        ? `<text x="${n.x + ox}" y="${startY + lines.length * (fontSize + 3) + 2}" text-anchor="middle" font-family="monospace" font-size="9" letter-spacing="1" fill="${ink}" opacity="0.75">${escapeXml(n.subtitle.toUpperCase())}</text>`
        : "";
      parts.push(
        `<g opacity="${n.dimmed ? 0.45 : 1}"><circle cx="${n.x + ox}" cy="${n.y + oy}" r="${r.w / 2}" fill="${fill}" stroke="#1b1b1b" stroke-width="1.4"/>${texts}${sub}</g>`,
      );
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

  // Close the graph menu on Escape or on a press anywhere outside it.
  useEffect(() => {
    if (!showExport) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setShowExport(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowExport(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showExport]);

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
      setNotice("Duplicated — find the copy in your library.");
    },
    onError: (e) => setNotice(e instanceof Error ? e.message : "Duplicate failed."),
  });

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
        <button
          type="button"
          onClick={onBack}
          className="rounded border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm"
        >
          Back to library
        </button>
      </div>
    );
  }

  const connectSource = connectFrom ? byId.get(connectFrom) : undefined;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="z-20 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 pt-safe">
        <button
          type="button"
          aria-label="Back to library"
          onClick={onBack}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-[var(--border)] text-lg"
        >
          ←
        </button>
        <input
          maxLength={120}
          aria-label="Graph title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleSave();
          }}
          className="gb-sans min-w-0 flex-1 bg-transparent text-lg font-bold text-[var(--text)] outline-none"
        />
        <span aria-live="polite" className="gb-mono hidden shrink-0 text-[10px] uppercase tracking-widest text-[var(--dim)] sm:block">
          {saveMutation.isPending ? "Saving…" : "Saved"}
        </span>
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="Graph menu"
            aria-expanded={showExport}
            onClick={() => setShowExport((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded border border-[var(--border)] text-lg"
          >
            ⋯
          </button>
          {showExport && (
            <div className="absolute right-0 top-11 z-30 w-52 rounded-md border border-[var(--border)] bg-[var(--surface)] p-1.5">
              {[
                { label: "Export PNG", fn: exportPng },
                { label: "Export SVG", fn: exportSvg },
                { label: "Export JSON", fn: exportJson },
                { label: "Duplicate graph", fn: () => duplicateMutation.mutate() },
                { label: "Fit view", fn: () => fitView(nodes) },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    item.fn();
                    setShowExport(false);
                  }}
                  className="block w-full rounded px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-alt)]"
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setShowExport(false);
                  setConfirmDeleteGraph(true);
                }}
                className="block w-full rounded px-3 py-2 text-left text-sm text-[var(--accent)] hover:bg-[var(--surface-alt)]"
              >
                Delete graph…
              </button>
            </div>
          )}
        </div>
      </header>

      {connectFrom && (
        <div className="z-10 flex items-center justify-between gap-2 bg-[var(--accent-2)] px-3 py-2 text-sm text-white">
          <span>
            Connecting from <strong>{connectSource?.title || "node"}</strong> — tap the
            node it points to.
          </span>
          <button
            type="button"
            onClick={() => setConnectFrom(null)}
            className="shrink-0 rounded-md bg-white/20 px-2.5 py-1 text-xs font-semibold"
          >
            Cancel
          </button>
        </div>
      )}
      {notice && (
        <div className="z-10 flex items-center justify-between gap-2 bg-[var(--text)] px-3 py-2 text-sm text-[var(--bg)]">
          <span>{notice}</span>
          <button
            type="button"
            aria-label="Dismiss notice"
            onClick={() => setNotice(null)}
            className="shrink-0 px-2 text-base"
          >
            ×
          </button>
        </div>
      )}

      {/* Canvas */}
      <div className="relative min-h-0 flex-1">
        <svg
          ref={svgRef}
          className="gb-paper block h-full w-full touch-none select-none"
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
          <g transform={`translate(${camera.x},${camera.y}) scale(${camera.k})`}>
            {edges.map((e) => {
              const g = edgeGeometry(e, byId);
              if (!g) return null;
              const isSel = selection?.kind === "edge" && selection.id === e.id;
              const lp = quadPoint(g, 0.5);
              const stroke = isSel ? "var(--accent)" : "var(--text)";
              return (
                <g key={e.id}>
                  <path
                    d={g.path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={18}
                    style={{ cursor: "pointer" }}
                    onPointerDown={(ev) => ev.stopPropagation()}
                    onClick={() => setSelection({ kind: "edge", id: e.id })}
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
                  {e.label && (
                    <text
                      x={lp.x}
                      y={lp.y - 7}
                      textAnchor="middle"
                      className="gb-mono"
                      fontSize={10.5}
                      letterSpacing={1}
                      fill={stroke}
                      pointerEvents="none"
                    >
                      {e.label.toUpperCase()}
                    </text>
                  )}
                </g>
              );
            })}
            {nodes.map((n) => {
              const c = colorOf(n.color);
              const r = nodeRect(n);
              const isSel = selection?.kind === "node" && selection.id === n.id;
              const isSource = connectFrom === n.id;
              if (n.kind !== "circle") {
                const half = r.w / 2;
                const ring = isSel || isSource ? "var(--accent)" : "var(--border)";
                return (
                  <g
                    key={n.id}
                    opacity={n.dimmed ? 0.42 : 1}
                    className="gb-node"
                    data-dragging={draggingId === n.id || undefined}
                    tabIndex={0}
                    role="button"
                    aria-label={`${n.title || "Untitled"} node`}
                    aria-pressed={isSel}
                    onKeyDown={(ev) => onNodeKeyDown(ev, n)}
                    onPointerDown={(ev) => onNodePointerDown(ev, n.id)}
                  >
                    {n.kind === "emoji" ? (
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
              const lines = wrapTitle(n.title || "Untitled", n.size);
              const fontSize = n.size === "sm" ? 13 : n.size === "md" ? 15 : n.size === "lg" ? 17 : 20;
              const lineH = fontSize + 3;
              const blockH = lines.length * lineH + (n.subtitle ? 15 : 0);
              const startY = n.y - blockH / 2 + fontSize * 0.85;
              return (
                <g
                  key={n.id}
                  opacity={n.dimmed ? 0.42 : 1}
                  className="gb-node"
                  data-dragging={draggingId === n.id || undefined}
                  tabIndex={0}
                  role="button"
                  aria-label={`${n.title || "Untitled"} node`}
                  aria-pressed={isSel}
                  onKeyDown={(ev) => onNodeKeyDown(ev, n)}
                  onPointerDown={(ev) => onNodePointerDown(ev, n.id)}
                >
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={r.w / 2}
                    fill={c.fill}
                    stroke={isSel || isSource ? "var(--accent)" : c.border}
                    strokeWidth={isSel || isSource ? 3 : 1.4}
                  />
                  {lines.map((ln, i) => (
                    <text
                      key={i}
                      x={n.x}
                      y={startY + i * lineH}
                      textAnchor="middle"
                      className="gb-sans"
                      fontWeight="bold"
                      fontSize={fontSize}
                      fill={c.ink}
                      pointerEvents="none"
                    >
                      {ln}
                    </text>
                  ))}
                  {n.subtitle && (
                    <text
                      x={n.x}
                      y={startY + lines.length * lineH + 3}
                      textAnchor="middle"
                      className="gb-mono"
                      fontSize={8.5}
                      letterSpacing={0.8}
                      fill={c.ink}
                      opacity={0.78}
                      pointerEvents="none"
                    >
                      {n.subtitle
                        .toUpperCase()
                        .slice(0, n.size === "sm" ? 18 : n.size === "md" ? 22 : n.size === "lg" ? 26 : 30)}
                    </text>
                  )}
                </g>
              );
            })}
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

        {/* Zoom controls */}
        <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => zoomBy(1.25)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-lg"
          >
            +
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => zoomBy(0.8)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-lg"
          >
            −
          </button>
          <button
            type="button"
            aria-label="Fit graph to view"
            onClick={() => fitView(nodes)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-sm"
          >
            ⤢
          </button>
        </div>
      </div>

      {/* Bottom toolbar */}
      <div className="z-20 flex items-center gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-3 py-2 pb-safe">
        <button
          type="button"
          onClick={addNode}
          className="rounded bg-[var(--text)] px-4 py-2 text-sm font-semibold text-[var(--bg)]"
        >
          + Node
        </button>
        <button
          type="button"
          disabled={!selectedNode}
          onClick={() => selectedNode && setConnectFrom(selectedNode.id)}
          className="rounded border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] disabled:opacity-40"
        >
          Connect →
        </button>
        <span className="gb-mono ml-auto text-[10px] uppercase tracking-widest text-[var(--dim)]">
          {nodes.length} nodes · {edges.length} edges
        </span>
      </div>

      {/* Detail sheet */}
      {(selectedNode || selectedEdge) && (
        <div className="gb-sheet z-20 max-h-[46%] overflow-y-auto overscroll-contain border-t-2 border-[var(--text)] bg-[var(--surface)] px-4 py-3 pb-safe">
          {selectedNode && (
            <NodePanel
              node={selectedNode}
              edges={edges}
              byId={byId}
              onChange={(patch) => updateNode(selectedNode.id, patch)}
              onDelete={() => deleteNode(selectedNode.id)}
              onSelectEdge={(id) => setSelection({ kind: "edge", id })}
              onClose={() => setSelection(null)}
            />
          )}
          {selectedEdge && (
            <EdgePanel
              edge={selectedEdge}
              byId={byId}
              onChange={(patch) => updateEdge(selectedEdge.id, patch)}
              onDelete={() => deleteEdge(selectedEdge.id)}
              onClose={() => setSelection(null)}
            />
          )}
        </div>
      )}

      {/* Delete-graph confirmation */}
      {confirmDeleteGraph && (
        // Native modal: focus moves in and is contained, Escape closes it,
        // and the page behind is inert. "Keep it" is first so it takes focus.
        <dialog
          ref={(el) => {
            if (el && !el.open) el.showModal();
          }}
          onClose={() => setConfirmDeleteGraph(false)}
          aria-labelledby="gb-delete-title"
          className="gb-dialog m-auto w-[calc(100%-2rem)] max-w-sm rounded-md bg-[var(--surface)] p-5"
        >
          <div>
            <h2 id="gb-delete-title" className="gb-sans text-lg font-bold text-[var(--text)]">
              Delete “{title}”?
            </h2>
            <p className="mt-1 text-sm text-[var(--dim)]">
              The graph and all its nodes and edges will be gone. This can't be
              undone.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteGraph(false)}
                className="flex-1 rounded border border-[var(--border)] px-4 py-2.5 text-sm font-medium"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => deleteGraphMutation.mutate()}
                className="flex-1 rounded bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white"
              >
                Delete graph
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}

function NodePanel({
  node,
  edges,
  byId,
  onChange,
  onDelete,
  onSelectEdge,
  onClose,
}: {
  node: GraphNode;
  edges: GraphEdge[];
  byId: Map<string, GraphNode>;
  onChange: (patch: Partial<GraphNode>) => void;
  onDelete: () => void;
  onSelectEdge: (id: string) => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  useEffect(() => setLinkDraft(null), [node.id]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const connected =edges.filter((e) => e.from === node.id || e.to === node.id);
  return (
    <div>
      <div className="flex items-start gap-2">
        <input
          maxLength={120}
          aria-label="Node title"
          value={node.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Node title"
          className="gb-sans min-w-0 flex-1 bg-transparent text-xl font-bold text-[var(--text)] outline-none"
        />
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--border)] text-base"
        >
          ×
        </button>
      </div>
      <input
        maxLength={200}
        aria-label="Node subtitle"
        value={node.subtitle}
        onChange={(e) => onChange({ subtitle: e.target.value })}
        placeholder="Subtitle — e.g. Main idea · the centre"
        className="gb-mono mt-1 w-full bg-transparent text-xs uppercase tracking-wide text-[var(--dim)] outline-none"
      />
      <textarea
        maxLength={4000}
        aria-label="Node notes"
        value={node.body}
        onChange={(e) => onChange({ body: e.target.value })}
        placeholder="What this node means in the story — why it's here, what it connects to…"
        rows={3}
        className="mt-2 w-full resize-y rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm leading-relaxed text-[var(--text)] outline-none"
      />

      <div className="mt-3 flex items-center gap-1" role="group" aria-label="Node shape">
        {(
          [
            { kind: "circle", label: "Circle" },
            { kind: "emoji", label: "Emoji" },
            { kind: "image", label: "Image" },
          ] as const
        ).map((opt) => (
          <button
            key={opt.kind}
            type="button"
            aria-pressed={node.kind === opt.kind}
            onClick={() =>
              onChange(
                opt.kind === "emoji" && !node.emoji
                  ? { kind: "emoji", emoji: "💡" }
                  : { kind: opt.kind },
              )
            }
            className={`rounded px-2.5 py-1.5 text-xs font-medium ${
              node.kind === opt.kind
                ? "bg-[var(--text)] text-[var(--bg)]"
                : "border border-[var(--border)] text-[var(--text)]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {node.kind === "emoji" && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <input
            aria-label="Node emoji"
            value={node.emoji}
            maxLength={32}
            onChange={(e) => onChange({ emoji: e.target.value.trim() })}
            placeholder="🙂"
            className="h-9 w-16 rounded border border-[var(--border)] bg-[var(--bg)] text-center text-xl outline-none"
          />
          {EMOJI_PICKS.map((em) => (
            <button
              key={em}
              type="button"
              aria-label={`Use ${em}`}
              aria-pressed={node.emoji === em}
              onClick={() => onChange({ emoji: em })}
              className="h-9 w-9 rounded border text-xl"
              style={{ borderColor: node.emoji === em ? "var(--accent)" : "var(--border)" }}
            >
              {em}
            </button>
          ))}
        </div>
      )}

      {node.kind === "image" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="rounded border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--text)]"
          >
            Upload image…
          </button>
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
          <input
            aria-label="Image link"
            value={linkDraft ?? (node.image.startsWith("data:") ? "" : node.image)}
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
            placeholder={node.image.startsWith("data:") ? "Uploaded image — or paste a link" : "…or paste an https:// image link"}
            className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--text)] outline-none"
          />
          {node.image && (
            <button
              type="button"
              onClick={() => onChange({ image: "" })}
              className="rounded px-2 py-1.5 text-sm text-[var(--accent)]"
            >
              Remove
            </button>
          )}
          {imageError && <p className="w-full text-sm text-[var(--accent)]">{imageError}</p>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div
          className={`flex items-center gap-1.5 ${node.kind === "circle" ? "" : "hidden"}`}
          role="group"
          aria-label="Node colour"
        >
          {COLOR_KEYS.map((key) => {
            const c = colorOf(key);
            const active = node.color === key;
            return (
              <button
                key={key}
                type="button"
                aria-label={`Colour ${key}`}
                aria-pressed={active}
                onClick={() => onChange({ color: key })}
                className="h-8 w-8 rounded-full border-2"
                style={{
                  backgroundColor: key === "paper" ? "var(--node-paper)" : c.fill,
                  borderColor: active ? "var(--accent)" : "var(--border)",
                }}
              />
            );
          })}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Node size">
          {(Object.keys(SIZES) as NodeSize[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={node.size === s}
              onClick={() => onChange({ size: s })}
              className={`rounded px-2.5 py-1.5 text-xs font-medium ${
                node.size === s
                  ? "bg-[var(--text)] text-[var(--bg)]"
                  : "border border-[var(--border)] text-[var(--text)]"
              }`}
            >
              {SIZES[s].label}
            </button>
          ))}
        </div>
        <label className="flex min-h-8 cursor-pointer items-center gap-2 text-sm text-[var(--text)]">
          <input
            type="checkbox"
            aria-label="Greyed out (cut / background)"
            checked={node.dimmed}
            onChange={(e) => onChange({ dimmed: e.target.checked })}
            className="h-4 w-4"
          />
          Greyed out (cut / background)
        </label>
      </div>

      {connected.length > 0 && (
        <div className="mt-3 border-t border-[var(--border)] pt-2">
          <p className="gb-mono text-[10px] uppercase tracking-widest text-[var(--dim)]">
            Connections
          </p>
          <ul className="mt-1 divide-y divide-[var(--border)]">
            {connected.map((e) => {
              const outgoing = e.from === node.id;
              const other = byId.get(outgoing ? e.to : e.from);
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onSelectEdge(e.id)}
                    className="flex w-full items-center gap-2 py-2 text-left text-sm text-[var(--text)]"
                  >
                    <span aria-hidden>{outgoing ? "→" : "←"}</span>
                    <span className="font-medium">{other?.title || "Untitled"}</span>
                    {e.label && (
                      <span className="gb-mono text-[10px] uppercase tracking-wide text-[var(--dim)]">
                        {e.label}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-3 flex justify-end border-t border-[var(--border)] pt-3">
        {confirming ? (
          <span className="flex items-center gap-2">
            <span className="text-sm text-[var(--dim)]">Delete this node?</span>
            <button
              type="button"
              onClick={onDelete}
              className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded px-3 py-1.5 text-sm font-medium text-[var(--accent)]"
          >
            Delete node
          </button>
        )}
      </div>
    </div>
  );
}

function EdgePanel({
  edge,
  byId,
  onChange,
  onDelete,
  onClose,
}: {
  edge: GraphEdge;
  byId: Map<string, GraphNode>;
  onChange: (patch: Partial<GraphEdge>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const from = byId.get(edge.from);
  const to = byId.get(edge.to);
  return (
    <div>
      <div className="flex items-center gap-2">
        <p className="gb-sans min-w-0 flex-1 truncate text-lg font-bold text-[var(--text)]">
          {from?.title || "Untitled"} <span aria-hidden>→</span> {to?.title || "Untitled"}
        </p>
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--border)] text-base"
        >
          ×
        </button>
      </div>
      <input
        maxLength={120}
        aria-label="Edge label"
        value={edge.label}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder="Label — e.g. same shape found in, steered to, supports"
        className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none"
      />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1" role="group" aria-label="Line style">
          {(["solid", "dashed"] as EdgeStyle[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={edge.style === s}
              onClick={() => onChange({ style: s })}
              className={`rounded px-2.5 py-1.5 text-xs font-medium capitalize ${
                edge.style === s
                  ? "bg-[var(--text)] text-[var(--bg)]"
                  : "border border-[var(--border)] text-[var(--text)]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Arrowheads">
          {(
            [
              { v: "forward", label: "Arrow →" },
              { v: "both", label: "Both ↔" },
              { v: "none", label: "No arrow" },
            ] as { v: ArrowKind; label: string }[]
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              aria-pressed={edge.arrow === o.v}
              onClick={() => onChange({ arrow: o.v })}
              className={`rounded px-2.5 py-1.5 text-xs font-medium ${
                edge.arrow === o.v
                  ? "bg-[var(--text)] text-[var(--bg)]"
                  : "border border-[var(--border)] text-[var(--text)]"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onChange({ from: edge.to, to: edge.from })}
          className="rounded border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--text)]"
        >
          Reverse direction
        </button>
      </div>
      <div className="mt-3 flex justify-end border-t border-[var(--border)] pt-3">
        {confirming ? (
          <span className="flex items-center gap-2">
            <span className="text-sm text-[var(--dim)]">Delete this edge?</span>
            <button
              type="button"
              onClick={onDelete}
              className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded px-3 py-1.5 text-sm font-medium text-[var(--accent)]"
          >
            Delete edge
          </button>
        )}
      </div>
    </div>
  );
}

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
    mutationFn: async (args: {
      title: string;
      nodes: GraphNode[];
      edges: GraphEdge[];
    }) => {
      const created = await api.createGraph({ title: args.title });
      if (args.nodes.length > 0) {
        await api.saveGraph({
          id: created.graph.id,
          title: args.title,
          nodes: args.nodes,
          edges: args.edges,
        });
      }
      return created;
    },
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
    createMutation.mutate({ title: newTitle.trim(), nodes: [], edges: [] });
  };

  const importFile = async (file: File) => {
    setImportError(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const obj = parsed as {
        title?: unknown;
        nodes?: unknown;
        edges?: unknown;
      };
      if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
        throw new Error("not a graph file");
      }
      const nodes = (obj.nodes as GraphNode[]).filter(
        (n) => n && typeof n.id === "string" && typeof n.title === "string",
      );
      const ids = new Set(nodes.map((n) => n.id));
      const edges = (obj.edges as GraphEdge[]).filter(
        (e) => e && ids.has(e.from) && ids.has(e.to),
      );
      const title =
        typeof obj.title === "string" && obj.title.trim()
          ? obj.title.trim().slice(0, 120)
          : "Imported graph";
      createMutation.mutate({ title, nodes, edges });
    } catch {
      setImportError("That file doesn't look like a graph exported from here.");
    }
  };

  const graphs: GraphSummary[] = list.data?.graphs ?? [];

  return (
    <div className="gb-paper min-h-screen">
      <main className="mx-auto w-full max-w-2xl px-4 pb-10 pt-safe">
        <h1 className="gb-sans pt-6 text-3xl font-bold text-[var(--text)]">
          Your graphs
        </h1>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Idea maps you can rearrange whenever the story changes.
        </p>

        <section aria-label="New graph" className="mt-6">
          <div className="flex gap-2">
            <input
              maxLength={120}
              aria-label="New graph title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
              }}
              placeholder="New graph — e.g. Project map"
              className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-base text-[var(--text)] outline-none"
            />
            <button
              type="button"
              onClick={create}
              disabled={createMutation.isPending}
              className="shrink-0 rounded-md bg-[var(--text)] px-4 py-2.5 text-sm font-semibold text-[var(--bg)] disabled:opacity-50"
            >
              Create
            </button>
          </div>
          {titleError && (
            <p role="alert" className="mt-1.5 text-sm text-[var(--accent)]">
              {titleError}
            </p>
          )}
          <div className="mt-2">
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
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-sm font-medium text-[var(--accent-2)] underline underline-offset-2"
            >
              Import a graph from JSON
            </button>
            {importError && (
              <p role="alert" className="mt-1.5 text-sm text-[var(--accent)]">
                {importError}
              </p>
            )}
          </div>
        </section>

        <section aria-label="Saved graphs" className="mt-8">
          {list.isPending && <p className="text-sm text-[var(--dim)]">Loading…</p>}
          {list.error && (
            <p className="text-sm text-[var(--accent)]">
              Couldn't load your graphs.{" "}
              <button
                type="button"
                onClick={() => list.refetch()}
                className="underline underline-offset-2"
              >
                Retry
              </button>
            </p>
          )}
          {list.data && graphs.length === 0 && (
            <div className="rounded-md border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--dim)]">
              <p>No graphs yet — create your first one above.</p>
              <button
                type="button"
                onClick={() => exampleMutation.mutate()}
                disabled={exampleMutation.isPending}
                className="mt-2 font-medium text-[var(--text)] underline underline-offset-2 disabled:opacity-50"
              >
                Or open an example graph
              </button>
            </div>
          )}
          <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {graphs.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => onOpen(g.id)}
                  className="flex w-full items-center gap-3 py-3.5 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="gb-sans block truncate text-lg font-bold text-[var(--text)]">
                      {g.title}
                    </span>
                    <span className="gb-mono block text-[10px] uppercase tracking-widest text-[var(--dim)]">
                      {g.nodeCount} nodes · edited{" "}
                      {new Date(g.updatedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </span>
                  <span aria-hidden className="text-lg text-[var(--dim)]">
                    →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

export function App() {
  const [openId, setOpenId] = useState<number | null>(null);
  if (openId != null) {
    return (
      <div className="flex h-dvh flex-col bg-[var(--bg)]">
        <Editor graphId={openId} onBack={() => setOpenId(null)} />
      </div>
    );
  }
  return <Library onOpen={setOpenId} />;
}
