import { nextVersion, type Pattern } from './pattern';

/**
 * The tracing image of a design ("Vorlage"): a picture under the stitches to draw along, never
 * sewn. Where it lies belongs to a version of the pattern like its stitches, so undo takes a
 * placement back with it; whether it is shown or locked is how the design is looked at and
 * belongs to the file.
 */

export interface Trace {
  name: string;
  /** Media type of `data` (image/webp, image/png, image/jpeg ...). */
  type: string;
  /** The encoded image. Shared, never changed, by every version that keeps the picture. */
  data: Uint8Array;
  /** Top left corner and size in mm, in the design's coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How a design's tracing image is looked at. */
export interface TraceView {
  shown: boolean;
  locked: boolean;
  /** How much of the picture shows over the fabric, 0..1: less makes the stitches stand out. */
  opacity: number;
}

/** A trace with its view, as projects and the page storage keep it. */
export type StoredTrace = Trace & Partial<TraceView>;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** How much of the picture shows by default: enough to draw along, never competing with the stitches. */
export const TRACE_OPACITY = 0.5;
/** The faintest and the strongest picture the slider gives. */
export const TRACE_OPACITY_MIN = 0.1;
export const TRACE_OPACITY_MAX = 1;

/** A freshly laid image is shown and can be moved right away. */
export const TRACE_VIEW: TraceView = { shown: true, locked: false, opacity: TRACE_OPACITY };

/** A usable opacity from anything stored: the default when there is none. */
export const traceOpacity = (v: unknown): number =>
  finite(v) ? Math.min(TRACE_OPACITY_MAX, Math.max(TRACE_OPACITY_MIN, v)) : TRACE_OPACITY;

/** Smallest side in mm: smaller would leave nothing to trace and nothing to grab. */
export const TRACE_MIN_MM = 5;
/** Largest side in mm: bigger than any hoop by far. */
export const TRACE_MAX_MM = 2000;

const traces = new WeakMap<Pattern, Trace | null>();

/** The tracing image of this version of the pattern, or null. */
export const traceOf = (p: Pattern | null | undefined): Trace | null => (p && traces.get(p)) || null;

/** A version of `p` (same stitches) with `t` as its tracing image: a new undo step without new stitches. */
export function withTrace(p: Pattern, t: Trace | null): Pattern {
  const next = nextVersion(p, {});
  traces.set(next, t);
  return next;
}

/** A new version of the pattern keeps the tracing image of the one before (unless it has its own). */
export function inheritTrace(from: Pattern, to: Pattern): void {
  if (!traces.has(to)) traces.set(to, traceOf(from));
}

export function setTraceOf(p: Pattern, t: Trace | null): void {
  traces.set(p, t);
}

/** `t` moved by `dx`, `dy` mm. */
export const movedTrace = (t: Trace, dx: number, dy: number): Trace => ({ ...t, x: t.x + dx, y: t.y + dy });

/** `t` scaled about its center to `w` mm wide, keeping its aspect ratio (and the size limits). */
export function sizedTrace(t: Trace, w: number): Trace {
  const k = t.h / t.w;
  const lo = Math.max(TRACE_MIN_MM, TRACE_MIN_MM / k);
  const hi = Math.min(TRACE_MAX_MM, TRACE_MAX_MM / k);
  const nw = Math.min(hi, Math.max(lo, w));
  const nh = nw * k;
  return { ...t, x: t.x + (t.w - nw) / 2, y: t.y + (t.h - nh) / 2, w: nw, h: nh };
}

/** How much of the hoop's field a new image takes, so the field's line stays in sight around it. */
const ROOM_SHARE = 0.9;

/**
 * Where a new image of `aspect` (height / width) goes: centered on `center`, as large as fits into
 * `room` (the hoop's field, else 100 mm wide) with a little room around it.
 */
export function placeTrace(aspect: number, center: [number, number], room: { w: number; h: number } | null): Pick<Trace, 'x' | 'y' | 'w' | 'h'> {
  let w = room ? ROOM_SHARE * Math.min(room.w, room.h / aspect) : 100;
  w = Math.max(TRACE_MIN_MM, w);
  const h = w * aspect;
  return { x: center[0] - w / 2, y: center[1] - h / 2, w, h };
}

/** A trace read from a project or the page storage, or null when it is not a usable one. */
export function readTrace(v: unknown): StoredTrace | null {
  const t = v as Partial<StoredTrace> | null;
  if (!t || typeof t !== 'object' || !(t.data instanceof Uint8Array) || !t.data.length) return null;
  if (typeof t.type !== 'string' || !t.type.startsWith('image/')) return null;
  if (![t.x, t.y, t.w, t.h].every(finite) || !(t.w! > 0) || !(t.h! > 0)) return null;
  return {
    name: typeof t.name === 'string' ? t.name : '',
    type: t.type,
    data: t.data,
    x: t.x!,
    y: t.y!,
    w: t.w!,
    h: t.h!,
    shown: t.shown !== false,
    locked: t.locked === true,
    opacity: traceOpacity(t.opacity),
  };
}

/** The trace and its view as kept in a project or the page storage. */
export const storeTrace = (t: Trace, view: TraceView): StoredTrace => ({ name: t.name, type: t.type, data: t.data, x: t.x, y: t.y, w: t.w, h: t.h, shown: view.shown, locked: view.locked, opacity: view.opacity });

/** The trace part of a stored one (without its view). */
export const traceFrom = (s: StoredTrace): Trace => ({ name: s.name, type: s.type, data: s.data, x: s.x, y: s.y, w: s.w, h: s.h });
