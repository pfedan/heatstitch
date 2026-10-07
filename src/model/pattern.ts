/** Commands stored per record. Coordinates are absolute, in 0.1 mm, y pointing down. */
export const STITCH = 0;
export const JUMP = 1;
export const TRIM = 2;
export const COLOR_CHANGE = 3;
export const END = 4;

export type Command = typeof STITCH | typeof JUMP | typeof TRIM | typeof COLOR_CHANGE | typeof END;

export interface ThreadColor {
  r: number;
  g: number;
  b: number;
  name?: string;
  /** Index in the Brother PEC palette, kept so PES files save with their original thread slots. */
  pecIndex?: number;
  /** Thread brand and catalog number, when the file names them (PES v5+, VP3). */
  brand?: string;
  catalog?: string;
}

/** Embroidery file formats heatstitch reads (and writes). */
export type FileFormat = 'dst' | 'pes' | 'pec' | 'jef' | 'exp' | 'vp3';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Pattern {
  name: string;
  format: FileFormat;
  /** Absolute x per record, 0.1 mm. */
  x: Int32Array;
  /** Absolute y per record, 0.1 mm, y down. */
  y: Int32Array;
  cmd: Uint8Array;
  /** One entry per color block (block i starts after the i-th COLOR_CHANGE). */
  colors: ThreadColor[];
  /** Bounds of STITCH records only, 0.1 mm. */
  bounds: Bounds;
  /** Sewing field the file names in its header (PES 5+, JEF), mm; only set by the readers. */
  hoop?: { w: number; h: number };
}

/** Designs read from a file, and every version made from one (see readFromFile). */
const read = new WeakSet<Pattern>();

/**
 * Marks `p` as read from a file: its objects are recognized from its stitches, split where their
 * stitches change (see objects.ts). Its later versions too: stitches changed by an edit that does
 * not carry its objects over are split the same way, so objects next to each other stay apart.
 */
export function readFromFile(p: Pattern): Pattern {
  read.add(p);
  return p;
}

export const isReadFromFile = (p: Pattern): boolean => read.has(p);

/**
 * The version each version of a design was made from. A new version takes over what the objects of
 * the one before knew (see objects.ts), so every way of making one from another goes through
 * `nextVersion` (or withRecords, which uses it).
 */
const parents = new WeakMap<Pattern, Pattern>();

/** A new version of `p` with `changes`; it knows it came from `p`. */
export function nextVersion(p: Pattern, changes: Partial<Pattern>): Pattern {
  const next: Pattern = { ...p, ...changes };
  parents.set(next, p);
  if (read.has(p)) read.add(next);
  return next;
}

/** The version `p` was made from, if it was made from one. */
export const parentOf = (p: Pattern): Pattern | undefined => parents.get(p);

/** Forgets where `p` came from (it knows its objects now, or never will). */
export function dropParent(p: Pattern): void {
  parents.delete(p);
}

/** Growable record list used by the parsers. */
export class PatternBuilder {
  private xs: number[] = [];
  private ys: number[] = [];
  private cmds: number[] = [];
  private cx = 0;
  private cy = 0;

  /** Relative move in 0.1 mm. */
  add(dx: number, dy: number, cmd: Command): void {
    this.cx += dx;
    this.cy += dy;
    this.xs.push(this.cx);
    this.ys.push(this.cy);
    this.cmds.push(cmd);
  }

  /** Record without movement (TRIM, COLOR_CHANGE, END). */
  mark(cmd: Command): void {
    this.add(0, 0, cmd);
  }

  get length(): number {
    return this.cmds.length;
  }

  build(name: string, format: Pattern['format'], colors: ThreadColor[]): Pattern {
    const x = Int32Array.from(this.xs);
    const y = Int32Array.from(this.ys);
    const cmd = Uint8Array.from(this.cmds);
    return { name, format, x, y, cmd, colors, bounds: computeBounds(x, y, cmd) };
  }
}

export function computeBounds(x: Int32Array, y: Int32Array, cmd: Uint8Array): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < cmd.length; i++) {
    if (cmd[i] !== STITCH) continue;
    if (x[i] < minX) minX = x[i];
    if (x[i] > maxX) maxX = x[i];
    if (y[i] < minY) minY = y[i];
    if (y[i] > maxY) maxY = y[i];
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

export interface PatternStats {
  stitches: number;
  jumps: number;
  trims: number;
  colorChanges: number;
  /** Thread length of real stitches in mm. */
  threadLength: number;
  widthMm: number;
  heightMm: number;
}

/**
 * Calls `cb` for every straight piece of thread lying on the fabric (0.1 mm coords);
 * `end` is the index of the stitch record the piece ends at.
 * A stitch following a stitch is thread. A run of jumps between two stitches leaves a
 * straight thread from the last to the next penetration, unless the run contains a trim
 * or color change; such segments are reported only when `includeJumps` is set.
 */
export function forEachThreadSegment(
  p: Pattern,
  includeJumps: boolean,
  cb: (x0: number, y0: number, x1: number, y1: number, end: number) => void,
): void {
  let hasLast = false;
  let lastX = 0;
  let lastY = 0;
  let prevCmd: number = TRIM;
  let cut = true;
  for (let i = 0; i < p.cmd.length; i++) {
    const c = p.cmd[i];
    if (c === STITCH) {
      if (hasLast) {
        if (prevCmd === STITCH) cb(lastX, lastY, p.x[i], p.y[i], i);
        else if (includeJumps && !cut) cb(lastX, lastY, p.x[i], p.y[i], i);
      }
      hasLast = true;
      lastX = p.x[i];
      lastY = p.y[i];
      cut = false;
    } else if (c === TRIM || c === COLOR_CHANGE) {
      cut = true;
    }
    prevCmd = c;
  }
}

export function patternStats(p: Pattern): PatternStats {
  let stitches = 0;
  let jumps = 0;
  let trims = 0;
  let colorChanges = 0;
  let len = 0;
  forEachThreadSegment(p, false, (x0, y0, x1, y1) => {
    len += Math.hypot(x1 - x0, y1 - y0);
  });
  // A move can carry its trim on several records (PES marks every jump of a trimmed move); the
  // machine cuts once per move, and not before the first stitch.
  let cutSince = true;
  for (let i = 0; i < p.cmd.length; i++) {
    switch (p.cmd[i]) {
      case STITCH:
        stitches++;
        cutSince = false;
        break;
      case JUMP:
        jumps++;
        break;
      case TRIM:
        if (!cutSince) trims++;
        cutSince = true;
        break;
      case COLOR_CHANGE:
        colorChanges++;
        break;
    }
  }
  return {
    stitches,
    jumps,
    trims,
    colorChanges,
    threadLength: len / 10,
    widthMm: (p.bounds.maxX - p.bounds.minX) / 10,
    heightMm: (p.bounds.maxY - p.bounds.minY) / 10,
  };
}
