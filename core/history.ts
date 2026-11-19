// Undo/redo over the operations layer. Projects are immutable and share
// structure between versions, so history keeps whole snapshots cheaply.

import { applyOps, type Op } from "./ops";
import type { Project } from "./project";

const LIMIT = 200;
/** Consecutive edits with the same coalesce key inside this window become
 * one undo step (typing a title is one step, not one per keystroke). */
const COALESCE_MS = 1000;

export type History = {
  readonly past: readonly Project[];
  readonly present: Project;
  readonly future: readonly Project[];
  readonly last?: { readonly key: string; readonly at: number };
};

export function createHistory(present: Project): History {
  return { past: [], present, future: [] };
}

/** Apply ops as one undoable step. Throws OpError (history unchanged) if
 * any op can't apply. */
export function commit(
  h: History,
  ops: readonly Op[],
  opts: { coalesceKey?: string; now?: number } = {},
): History {
  const present = applyOps(h.present, ops);
  if (present === h.present) return h;
  const now = opts.now ?? Date.now();
  const key = opts.coalesceKey;
  const coalesce = key !== undefined && h.last?.key === key && now - h.last.at < COALESCE_MS;
  return {
    past: coalesce ? h.past : [...h.past, h.present].slice(-LIMIT),
    present,
    future: [],
    last: key !== undefined ? { key, at: now } : undefined,
  };
}

/** Apply ops without recording a step: for continuous gestures (a drag)
 * whose intermediate states shouldn't be undoable. Pair with commitFrom. */
export function preview(h: History, ops: readonly Op[]): History {
  return { ...h, present: applyOps(h.present, ops) };
}

/** Record one step from `base` (the state before a previewed gesture) to
 * the current present. */
export function commitFrom(h: History, base: Project): History {
  if (base === h.present) return h;
  return { past: [...h.past, base].slice(-LIMIT), present: h.present, future: [] };
}

export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;

export function undo(h: History): History {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  const next = h.future[0];
  if (!next) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}
