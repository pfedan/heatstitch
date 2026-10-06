import { formatNumber, onLangChange, t, type Key } from '../i18n';
import type { ObjectKind } from '../model/objects';
import { DECO_DEFAULTS, isOpenPattern, OPEN_SIZE, OPEN_SIZE_RANGE, SATIN_SPLIT, UNDERLAYS, type DecoSettings, type FillPattern, type FillSettings, type OpenPattern, type RunSettings, type SatinSettings, type SatinType, type Settings, type ShapeTrust, type Fixed } from '../model/restitch';
import { fixText } from './fixText';
import type { UnderlayKind } from '../digitize/satin';
import type { ShapeOutline } from '../render/scene';
import { UNDERLAY_INSET } from '../digitize/fill';
import type { Pt } from '../digitize/skeleton';
import { KIND_ICON, kindLabel } from './layersPanel';
import type { LineCap } from '../shape/rasterize';
import { BORDER_STITCH, BORDER_WIDTH, type BorderType } from '../digitize/border';
import { TOLERANCE } from '../digitize/run';
import type { ThreadColor } from '../model/pattern';
import { newLink } from '../model/border';
import { SATIN_SHARE } from '../model/covers';
import { autoUnder, E_SPACING, isRunType, spacingOf, ZIGZAG_SPACING, type PathStitch } from '../model/along';
import { LINE_MOTIFS, MOTIF_PERIOD, MOTIF_WIDTH, motifMaxSize, SIDED_MOTIFS, type LineMotif } from '../digitize/motif';
import { ECHO_COUNT, ECHO_DEFAULT, ECHO_GAP, ECHO_SIDES, type EchoSide } from '../digitize/echo';
import { SHADOW_COLOR, SHADOW_DEFAULT_DIST, SHADOW_DIRS, SHADOW_DIST, type ShadowDir } from '../model/shadow';
import { cssColor, hexColor, ThreadPicker } from './threadPicker';
import { CROSS_KINDS, GRID_KINDS, MOTIFS, type CrossKind, type GridKind, type Motif } from '../digitize/deco';
import { canRun, getCommand, keyLabel, runCommand } from '../shell/commands';
import { h } from '../shell/h';
import { section } from '../shell/ui';
import { setThinShare, THIN_SHARES, thinShare } from '../areas/stitches/state';

type FillUnder = 'off' | 'single' | 'cross';
const FILL_UNDERS: FillUnder[] = ['off', 'single', 'cross'];
type BorderChoice = 'off' | BorderType;
/** What hovering a group of settings shows on the canvas. */
export type Highlight = 'under' | 'border';
/** Kinds of stitch along a line, as buttons: a triple stitch is a running stitch sewn more often. */
const BORDERS: BorderChoice[] = ['off', 'run', 'satin', 'zigzag', 'e', 'motif'];
/** How often each stitch of a running stitch is sewn. */
const REPEATS = ['1', '3', '5'] as const;
const sameColor = (a: ThreadColor, b: ThreadColor) => a.r === b.r && a.g === b.g && a.b === b.b;

/**
 * Stitch settings of the selected objects, in fixed groups (konzept.md section 5): Stichart and
 * Muster, Gestaltung, Umrandung or Effekte, Stoff und Halt, Werkzeuge. Each group folds and is
 * remembered. The values start as measured on the first selected object; moving a slider shows the
 * result on the canvas at once, letting go applies it (one undo step). A value that is chosen
 * automatically says so; a small dot takes an own value back to automatic.
 */

export interface StitchInfo {
  /** Changes when the user selects something else, so the values are measured again. */
  key: number;
  /** Kinds among the selected objects, and what the first object of each kind has now. */
  measured: Partial<{ fill: FillSettings; satin: SatinSettings; run: RunSettings }>;
  /** Recommended fill spacing for the material (mm). */
  recommended: [number, number];
  /** Values chosen automatically for the material: what "Nach Stoff" gives. */
  auto?: { fillSpacing: number; satinSpacing: number; stitch: number };
  /** How many selected objects have stitches of each kind. */
  counts: Partial<Record<ObjectKind, number>>;
  /** How far the fill areas can be trusted (the least of the selected objects). */
  shape?: ShapeTrust;
  /** Fill areas, drawn on the canvas. */
  outlines: ShapeOutline[];
  /** Points changed by hand in the selected objects (new settings replace them). */
  hand?: number;
  /** Whether the fill areas are strokes that can be sewn as satin. */
  toSatin: boolean;
  /** Rungs of the one selected satin: whether the tool is on, how many (null: the stitches' own direction). */
  direction?: {
    tool: boolean;
    rungs: number | null;
    single: boolean;
    /** Cut lines on the column (sections). */
    cuts: number;
    /** Lines drawn are cut lines (else rungs). */
    cutMode?: boolean;
    /** A rung is selected: the spacing set there (null: the column's). */
    spacingHere?: number | null;
    /** Chained columns show their order, direction and trims on the canvas. */
    chain?: boolean;
    /** Some chain has more than one column: their order can be chosen by itself. */
    order?: boolean;
  };
  /** Rungs drawn across the one selected fill to sew it as satin. */
  draw?: { tool: boolean; lines: number; single: boolean; cuts?: number; cutMode?: boolean };
  /** Guide lines of the one selected fill: whether their tool is on. */
  guide?: { tool: boolean; single: boolean };
  /** Points of rays, circles and swirls on the one selected fill: whether their tool is on. */
  points?: { tool: boolean; single: boolean };
  /**
   * Fills with their shape as curves: whether they leave out what later fills cover (`mixed` when
   * only some do), and whether anything lies on top of them at all.
   */
  knockout?: { on: boolean | 'mixed'; covered: boolean; share: number };
  /** The selected running stitches are lines sewn along their curves. */
  line?: boolean;
  /**
   * The one selected object is a line (drawn, from an SVG, or a running stitch of a file): how it
   * is sewn along its curve. `traced`: its curve is read from its stitches (none was drawn).
   * `closed`: all its paths are loops (its echo lies outside or inside, not left or right).
   */
  path?: { st: PathStitch; traced: boolean; closed: boolean; color: ThreadColor };
  /** The one selected fill was a wide line, and can be one again. */
  asLine?: boolean;
  /** How deep the selected fills reach at their deepest point (mm; the shallowest of them): an underlay inset beyond it leaves none. */
  depth?: number;
  /** Thread of the first selected fill (its border is sewn in it unless it has its own). */
  color?: ThreadColor;
  /** A border of its own thread, or the second thread of a color blend (`blend`), following its fill. */
  outline?: { fill: number | null; blend?: boolean; shadow?: boolean; echo?: boolean };
  /** The one selected fill can blend into a second thread (see blendObject). */
  blend?: boolean;
  /** Left out of the correction (`mixed`: only some of the selected objects). */
  lock: boolean | 'mixed';
  /** Stitches loosed from their shape (`mixed`: only some), and whether any selected object has a shape to loose them from. */
  free?: { on: boolean | 'mixed'; can: boolean };
  /** What the correction changed on the one selected object. */
  fixed?: Fixed[];
  /** Pull compensation by the fabric for the first selected fill and satin (see pullFor). */
  fabricPull?: { fill?: number; satin?: { edge: number; edgeShare?: number } };
}

export interface StitchHooks {
  preview: (s: Settings | null) => void;
  apply: (s: Settings) => void;
  /** Sews the selection anew as another kind: fill or satin, a wide line as a fill and back. */
  convert: (to: 'fill' | 'satin' | 'line') => void;
  /** Rungs of a satin: the tool on or off, corners suggested, all removed, back to the stitches' own direction. */
  direction: (action: 'tool' | 'corners' | 'sections' | 'even' | 'follow' | 'rung' | 'cut' | 'order') => void;
  /** The spacing at the selected rung (null: as the column). */
  spacingHere: (v: number | null) => void;
  /** Rungs drawn across a fill: the tool on or off, sewn as satin along them. */
  draw: (action: 'tool' | 'sew') => void;
  /** Guide lines on a fill: their tool on or off (`off` only closes it). */
  guide: (action: 'tool' | 'off') => void;
  /** Points of rays, circles and swirls: their tool on or off (`off` only closes it). */
  points: (action: 'tool' | 'off') => void;
  /** Leaving out what later fills cover, on or off for the selected fills. */
  knockout: (on: boolean) => void;
  /** How far the selected fills reach under a satin on top (share of its width). */
  overlapShare: (share: number) => void;
  /**
   * The pointer or focus on the underlay settings ('under') or on the border settings ('border'),
   * or away from both (null): what they set is shown on the canvas.
   */
  highlight: (what: Highlight | null) => void;
  /** The one selected line sewn with `st`: shown while sliding (`final` false), then applied. */
  line: (st: PathStitch, final: boolean) => void;
  /** A border object: select its fill, or make it an object of its own (no longer following the fill). */
  outline: (action: 'fill' | 'detach') => void;
  /** Opens the thread picker for a second color of a blend at `anchor`. */
  blend: (anchor: HTMLElement) => void;
  /** The selected objects left out of the correction, or not. */
  lock: (on: boolean) => void;
  /** The selected objects' stitches loosed from their shape (true), or sewn from it again (false). */
  free: (on: boolean) => void;
}

const KINDS: ObjectKind[] = ['fill', 'satin', 'run'];

/**
 * The fill patterns as tiles in two groups: covering ones (straight, bent and decorative rows) and
 * open ones (one line, the fabric showing).
 */
type Tile = FillPattern;
type TileGroup = 'cover' | 'open';
const GROUPS: Record<TileGroup, Tile[]> = {
  cover: ['tatami', 'gradient', 'contour', 'spiral', 'follow', 'guided', 'waves', 'rays', 'swirl', 'grain', 'circles'],
  open: ['none', 'meander', 'maze', 'grid', 'echo', 'cross'],
};
const TILE_GROUPS: TileGroup[] = ['cover', 'open'];
const tileOf = (s: FillSettings): Tile => s.pattern;
const groupOf = (t: Tile): TileGroup => TILE_GROUPS.find((g) => GROUPS[g].includes(t))!;
/** Patterns whose rows bend: their stitches get shorter in tight bends. */
const CURVED: FillPattern[] = ['contour', 'spiral', 'follow', 'waves', 'grain', 'rays', 'swirl', 'circles'];
/** Patterns with a row direction to set. */
const ANGLED: FillPattern[] = ['tatami', 'gradient', 'waves', 'grain'];
/** Patterns with points on the area (the middle of rays and circles, the eyes of swirls). */
const POINTED: FillPattern[] = ['rays', 'circles', 'swirl'];

/** Small pictures of the fill patterns (24 × 24, drawn with the current color). */
const SVG = (body: string, w = 1.6) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const PATTERN_ICON: Record<Tile, string> = {
  tatami: SVG('<path d="M3 5h7m3 0h8M3 9.5h4m3 0h11M3 14h9m3 0h6M3 18.5h2m3 0h13"/>'),
  gradient: SVG('<path d="M3 3.5h18M3 6h18M3 9h18M3 13h18M3 18.5h18"/>'),
  contour: SVG('<rect x="3" y="3" width="18" height="18" rx="5"/><rect x="7" y="7" width="10" height="10" rx="2.5"/><path d="M11 11h2v2h-2z"/>'),
  spiral: SVG('<path d="M12 12c0-1 1.5-1.2 2-.2.8 1.6-1 3.2-2.6 3-2.6-.3-3.4-3.6-1.8-5.6 2.2-2.8 6.6-1.8 7.6 1.4 1.3 4-2.2 7.6-6 7.2-4.4-.4-7-5-5.6-9C7 5 11.6 3 15.6 4.2"/>'),
  follow: SVG('<path d="M3 6c5-3 9 3 18 0M3 11c5-3 9 3 18 0M3 16c5-3 9 3 18 0M3 21c5-3 9 3 18 0"/>'),
  guided: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path stroke-width="1.2" opacity=".6" d="M4 4c3 0 5 5 8 5s5-4 8-4M4 15c3 0 5 5 8 5s5-4 8-4"/><path stroke-width="2.4" d="M4 9.5c3 0 5 5 8 5s5-4 8-4"/></svg>',
  waves: SVG('<path d="M3 7c3-3 6 3 9 0s6-3 9 0M3 12c3-3 6 3 9 0s6-3 9 0M3 17c3-3 6 3 9 0s6-3 9 0"/>'),
  grain: SVG('<path d="M3 5.5c4 1.5 6-2 10-1s6 2 8 .5M3 10.5c3-1.5 7 2 10 0s5-2 8-.5M3 15.5c4 2 6-1.5 9 0s6 2 9 0M3 20c4-1.5 7 1 18-.5"/>'),
  rays: SVG('<path d="M12 21L3 7M12 21L6.5 3.5M12 21V3M12 21l5.5-17.5M12 21l9-14"/>'),
  circles: SVG('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="3"/>', 1.4),
  swirl: SVG('<path d="M12 12.5c.8-.6.3-2-.8-1.8-1.6.3-1.6 2.7-.2 3.4 2.2 1.1 4.4-1.1 3.8-3.5-.8-3-4.6-3.8-6.8-1.8-3 2.7-1.7 7.8 2.2 8.6 4.6.9 8.2-3.4 7.2-7.9"/><path d="M3 6c2.5-2.2 6-3 9-2.4"/>'),
  meander: SVG('<path d="M4 20c-1.5-3 2-4 .5-7S2.6 8 4.6 6.5 8 7.4 8.3 10s-1.5 4.5.4 6 4.1-.3 4.2-2.6-2.3-4.2-1.3-6.4 4-2.5 5.4-.6.2 4.4 1.7 6.3 3.5.9 3.3 3.3S18 20 16 20"/>'),
  maze: SVG('<path d="M3 3h18v18H3zM7 3v10h5M7 17h10V7M12 7v6"/>'),
  grid: SVG('<path d="M7 2.8l4 2.3v4.6l-4 2.3-4-2.3V5.1zM17 2.8l4 2.3v4.6l-4 2.3-4-2.3V5.1zM12 11.6l4 2.3v4.6L12 20.8l-4-2.3v-4.6z"/>', 1.4),
  echo: SVG('<path d="M12 20.5S3 15 3 9.3a4.6 4.6 0 0 1 9-1.4 4.6 4.6 0 0 1 9 1.4C21 15 12 20.5 12 20.5z"/><path d="M12 15.6s-4.4-2.8-4.4-5.6a2.2 2.2 0 0 1 4.4-.7 2.2 2.2 0 0 1 4.4.7c0 2.8-4.4 5.6-4.4 5.6z"/>', 1.4),
  cross: SVG('<path d="M4 4l6 6M10 4l-6 6M14 4l6 6M20 4l-6 6M4 14l6 6M10 14l-6 6M14 14l6 6M20 14l-6 6"/>'),
  none: SVG('<rect x="3.5" y="3.5" width="17" height="17" rx="3"/>', 2),
};

/** No embossing: plain rows. */
const MOTIF_NONE = SVG('<path d="M4 7h16M4 12h16M4 17h16"/>', 1.4);

/** The motifs of embossing as small pictures. */
const MOTIF_ICON: Record<Motif, string> = {
  diamonds: SVG('<path d="M12 3l6 9-6 9-6-9z"/>'),
  waves: SVG('<path d="M8 3c-3 3 3 6 0 9s3 6 0 9M16 3c-3 3 3 6 0 9s3 6 0 9"/>'),
  stars: SVG('<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4l-5.3 3 1.2-6-4.5-4.1 6-.7z"/>'),
  hearts: SVG('<path d="M12 20S4 14.8 4 9.5a4 4 0 0 1 8-1.3 4 4 0 0 1 8 1.3C20 14.8 12 20 12 20z"/>'),
};

/** Small status icons (16 × 16). */
const STATUS_ICON = {
  ok: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  warn: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5l6 11H2z"/><path d="M8 6.5v3.2M8 11.8v.1"/></svg>',
  info: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 7.2v4M8 4.9v.1"/></svg>',
  fix: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.5a3 3 0 0 0-3.6 3.9L2.5 10.8a1.3 1.3 0 0 0 1.8 1.8l4.4-4.4a3 3 0 0 0 3.9-3.6l-1.8 1.8-1.7-.4-.4-1.7z"/></svg>',
  /** Stitches loosed from their shape: a dashed shape beside free stitches. */
  free: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1.5" y="1.5" width="8" height="8" rx="1.5" stroke-dasharray="2 2"/><path d="M7 14.5l2.5-4 2 3 3-5"/></svg>',
};

const OFFSETS: [number, string][] = [
  [0.5, '1/2'],
  [1 / 3, '1/3'],
  [0.25, '1/4'],
  [0.2, '1/5'],
];

interface SliderDef {
  label: Key;
  hint?: Key;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  fmt: (v: number) => string;
  /** Range to mark on the track (recommended). */
  band?: [number, number];
  /** What the band means (its title); the material's recommendation by default. */
  bandHint?: Key;
  /** Extra line under the value. */
  note?: (v: number) => string;
  /** Taken over on its own when let go, instead of as a stitch setting (no preview while dragging). */
  commit?: () => void;
  /**
   * The value can be chosen automatically: `is` says whether it is now, `reset` goes back to it.
   * `fabric`: the automatic value follows the material ("Nach Stoff").
   */
  auto?: { is: () => boolean; reset: () => void; fabric?: boolean };
}

/** The pieces of stitches along a line: their kind, what they look like, what holds them. */
interface PathParts {
  type: HTMLElement;
  look: HTMLElement[];
  hold: HTMLElement[];
}

export class StitchPanel {
  private key = -1;
  private kind: ObjectKind = 'fill';
  /** Settings of the one selected line while they are changed (see StitchInfo.path). */
  private lineDraft: PathStitch | null = null;
  private draft: Partial<{ fill: FillSettings; satin: SatinSettings; run: RunSettings }> = {};
  private info: StitchInfo | null = null;
  private frame = 0;
  /** Max. deviation chosen last: the next objects start with it (they cannot be measured for it). */
  private tolerance: number | null = null;
  /** The tool state as last drawn. */
  private tools = '';
  /** Left and right width set apart. */
  private sides = false;
  private picker = new ThreadPicker('.border-thread');
  /** Whether the underlay is shown now (the pointer or focus on its settings). */
  private lit: Highlight | null = null;
  /** The tab of fill patterns looked at; the one holding the pattern now when not set. */
  private group: TileGroup | null = null;

  constructor(
    private root: HTMLElement,
    private hooks: StitchHooks,
  ) {
    // Drawn anew in the other language, with the values being changed kept.
    onLangChange(() => {
      if (this.info && this.key !== -1) this.render();
    });
  }

  /** What the panel shows now (null: nothing selected). */
  get current(): StitchInfo | null {
    return this.key === -1 ? null : this.info;
  }

  /** The kind of stitch whose settings are shown (in a mixed selection, the tab picked). */
  get shownKind(): ObjectKind {
    return this.kind;
  }

  update(info: StitchInfo | null): void {
    this.info = info;
    if (!info || !Object.keys(info.measured).length) {
      this.root.replaceChildren();
      this.key = -1;
      return;
    }
    if (info.key === this.key) {
      // A tool changes without a new selection: the panel is drawn anew for its buttons.
      const tools = this.toolKey(info);
      if (tools !== this.tools) this.render();
      return;
    }
    this.key = info.key;
    this.group = null;
    this.draft = structuredClone(info.measured);
    this.lineDraft = info.path ? structuredClone(info.path.st) : null;
    if (this.tolerance !== null) for (const k of KINDS) if (this.draft[k]) this.draft[k]!.tolerance = this.tolerance;
    if (!info.measured[this.kind]) this.kind = KINDS.find((k) => info.measured[k])!;
    this.render();
  }

  private toolKey(info: StitchInfo): string {
    return JSON.stringify([info.direction?.tool, info.direction?.rungs, info.direction?.cuts, info.draw?.tool, info.guide?.tool, info.points?.tool, info.knockout, info.free]);
  }

  /** Whether the selection can be sewn as `to` now (see the kind switch). */
  canConvert(to: 'fill' | 'satin' | 'line'): boolean {
    const info = this.current;
    if (!info || info.outline || info.free?.on) return false;
    const now = this.nowKind();
    if (!now || now === to) return false;
    if (to === 'fill') return now === 'satin' || (now === 'line' && info.path?.st.type === 'satin' && !info.path.traced);
    if (to === 'satin') return now === 'fill' && !info.asLine && info.toSatin;
    return now === 'fill' && !!info.asLine;
  }

  convert(to: 'fill' | 'satin' | 'line'): void {
    if (!this.canConvert(to)) return;
    this.hooks.preview(null);
    this.hooks.convert(to);
  }

  /** A new random variant of the pattern (grain, swirls, meander, maze), when it has one. */
  canReroll(): boolean {
    const s = this.current && !this.current.path && this.kind === 'fill' ? this.draft.fill : null;
    return !!s && ['grain', 'swirl', 'meander', 'maze'].includes(s.pattern);
  }

  reroll(): void {
    const s = this.draft.fill;
    if (!s || !this.canReroll()) return;
    const d = this.deco(s);
    let seed = d.seed ?? DECO_DEFAULTS.seed;
    while (seed === (d.seed ?? DECO_DEFAULTS.seed)) seed = 1 + Math.floor(Math.random() * 99999);
    d.seed = seed;
    if (s.pattern === 'swirl') delete d.centers;
    this.changed(true);
  }

  /** The actions of the panel for commands: left out of the correction, loosed, knocked out, a border's fill. */
  lock(on: boolean): void {
    this.hooks.lock(on);
  }

  free(on: boolean): void {
    this.hooks.free(on);
  }

  knockout(on: boolean): void {
    this.hooks.knockout(on);
  }

  outline(action: 'fill' | 'detach'): void {
    this.hooks.outline(action);
  }

  /** The kind switch's position: a line, a fill, a satin, or none (running stitches). */
  private nowKind(): 'fill' | 'satin' | 'line' | null {
    const info = this.info;
    if (!info) return null;
    if (info.path && this.lineDraft) return 'line';
    if (this.kind === 'fill' || this.kind === 'satin') return this.kind;
    return null;
  }

  private settings(): Settings {
    if (this.kind === 'fill') return { kind: 'fill', s: { ...this.draft.fill! } };
    if (this.kind === 'satin') return { kind: 'satin', s: { ...this.draft.satin! } };
    return { kind: 'run', s: { ...this.draft.run! } };
  }

  private changed(final: boolean): void {
    if (this.lineDraft) {
      const st = structuredClone(this.lineDraft);
      if (final) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.hooks.line(st, true);
        return;
      }
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        if (this.lineDraft) this.hooks.line(structuredClone(this.lineDraft), false);
      });
      return;
    }
    if (final) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.hooks.apply(this.settings());
      return;
    }
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.hooks.preview(this.settings());
    });
  }

  private render(): void {
    const info = this.info!;
    this.tools = this.toolKey(info);
    const parts: HTMLElement[] = [];
    if (info.outline) {
      parts.push(this.outlineBlock(info));
      return this.show(parts);
    }
    const present = KINDS.filter((k) => info.measured[k]);
    const line = !!(info.path && this.lineDraft);
    if (present.length > 1 && !line) parts.push(this.kindTabs(present));
    const status = this.statusLine(info);
    if (status) parts.push(status);
    if (info.free?.on) {
      parts.push(this.sec('tools', 'stitches.sec.tools', [...this.freeRows(info.free.on), this.handRow(), this.lockSwitch(info.lock)]));
      return this.show(parts);
    }
    if (line) parts.push(...this.lineSections(info));
    else if (this.kind === 'fill') parts.push(...this.fillSections(info));
    else if (this.kind === 'satin') parts.push(...this.satinSections(info));
    else parts.push(...this.runSections(info));
    this.show(parts);
  }

  private show(parts: HTMLElement[]): void {
    this.picker.close();
    this.root.replaceChildren(...parts);
    // Its settings went away under the pointer (underlay off): nothing to show any more.
    if (this.lit && !this.root.querySelector(`.lit-${this.lit}`)) this.light(null);
  }

  /** One group of the panel, folded or open as the user left it. */
  private sec(id: string, title: Key, body: (HTMLElement | null | false)[], extra?: string): HTMLDetailsElement {
    const nodes = body.filter((n): n is HTMLElement => !!n);
    return section(`stitches.${id}`, title, nodes, extra ? { extra: h('span', { class: 'sec-extra' }, extra) } : {});
  }

  // Head ----------------------------------------------------------------------------------------

  /** Which kind of the mixed selection the settings are for. */
  private kindTabs(present: ObjectKind[]): HTMLElement {
    const info = this.info!;
    const row = h('div', { class: 'segmented stitch-tabs', role: 'tablist', 'aria-label': t('stitches.editFor') });
    for (const k of present) {
      const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === this.kind), class: k === this.kind ? 'active' : '' });
      b.innerHTML = `<span class="kind-icon">${KIND_ICON[k]}</span>`;
      b.append(kindLabel(k), h('span', { class: 'tab-count' }, formatNumber(info.counts[k] ?? 0)));
      b.addEventListener('click', () => {
        if (k === this.kind) return;
        this.kind = k;
        this.hooks.preview(null);
        this.render();
      });
      row.append(b);
    }
    return h('div', { class: 'field stitch-for' }, h('span', { class: 'label' }, t('stitches.editFor')), row);
  }

  /**
   * One compact line about the selection: how many objects, how far the shape is trusted, changes
   * by hand that new settings replace, what the correction changed. The details are hints.
   */
  private statusLine(info: StitchInfo): HTMLElement | null {
    const chips: HTMLElement[] = [];
    const chip = (icon: keyof typeof STATUS_ICON | null, text: string, hint: string, tone = '') => {
      const c = h('span', { class: `stitch-chip ${tone}`, title: hint, tabindex: 0 });
      if (icon) c.innerHTML = STATUS_ICON[icon];
      c.append(h('span', null, text));
      chips.push(c);
    };
    const line = !!(info.path && this.lineDraft);
    const n = info.counts[this.kind] ?? 0;
    if (!line && n > 1) chip(null, t('stitches.many', { n: formatNumber(n) }), t('stitch.many', { n }));
    if (line) chip('info', t(info.path!.traced ? 'stitches.line.traced' : 'stitches.line.drawn'), t(info.path!.traced ? 'stitch.lineTraced' : 'stitch.lineNote'));
    else if (this.kind === 'fill' && info.shape && !info.free?.on) {
      const warn = info.shape === 'approximate';
      chip(warn ? 'warn' : 'ok', t(`stitches.trust.${info.shape}`), `${t(`stitch.shape.${info.shape}`)} ${t('stitch.undo')}`, warn ? 'warn' : 'ok');
    }
    if (info.hand) chip('warn', t('stitches.hand', { n: formatNumber(info.hand) }), t('stitch.hand', { n: formatNumber(info.hand) }), 'warn');
    if (info.fixed?.length) chip('fix', t('stitches.fixed'), t('plan.fixed', { list: info.fixed.map(fixText).join(', ') }));
    if (info.free?.on) chip('free', t(info.free.on === 'mixed' ? 'stitches.free.some' : 'stitches.free'), t(info.free.on === 'mixed' ? 'free.someText' : 'free.text'));
    if (!chips.length) return null;
    return h('div', { class: 'stitch-status', role: 'status' }, chips);
  }

  /** A border, second thread, shadow or echo: its settings are its parent's. */
  private outlineBlock(info: StitchInfo): HTMLElement {
    const o = info.outline!;
    const of = o.echo ? 'stitch.echoOf' : o.shadow ? 'stitch.shadowOf' : o.blend ? 'stitch.blendOf' : 'stitch.outline';
    const head = h('p', { class: 'stitch-chip outline-head', title: t(`${of}.text` as Key) });
    head.innerHTML = STATUS_ICON.info;
    head.append(h('span', null, t(`${of}.title` as Key)));
    const row = h('div', { class: 'tool-row' });
    if (o.fill !== null) row.append(this.button(o.shadow || o.echo ? 'stitch.shadowOf.line' : 'stitch.outline.fill', o.shadow || o.echo ? 'stitch.shadowOf.line.hint' : 'stitch.outline.fill.hint', () => this.hooks.outline('fill'), true));
    row.append(this.button('stitch.outline.detach', `${of}.detach.hint` as Key, () => this.hooks.outline('detach')));
    return h('div', { class: 'outline-block' }, head, h('p', { class: 'muted small' }, t(`${of}.text` as Key)), row);
  }

  // Sections per kind -------------------------------------------------------------------------------

  private fillSections(info: StitchInfo): HTMLElement[] {
    const s = this.draft.fill!;
    const open = isOpenPattern(s.pattern);
    const look: (HTMLElement | null)[] = [];
    const hold: (HTMLElement | null)[] = [];
    const tools: (HTMLElement | null)[] = [];
    if (info.asLine) look.push(...this.lineFillControls());
    if (open) {
      look.push(...this.openControls(s));
      hold.push(this.expandSlider(s));
    } else {
      look.push(...this.coverLook(s));
      hold.push(...this.coverHold(s));
    }
    if (s.pattern === 'guided') tools.push(this.guideRow(s, info.guide));
    if (POINTED.includes(s.pattern)) tools.push(this.pointRow(s, info.points));
    // A fill along a line becomes satin by its line, not by rungs drawn across it.
    if (!info.asLine && info.draw) tools.push(this.toolRow('stitch.direction', 'stitches.tool.toSatin', 'stitch.draw.hint', !!info.draw.tool, info.draw.single ? null : t('stitch.direction.single')));
    if (info.knockout) tools.push(this.knockoutSwitch(info.knockout));
    tools.push(this.handRow(), this.lockSwitch(info.lock), info.free?.can ? this.looseRow() : null);
    const border = s.border ? t(`stitch.border.${isRunType(s.border.type) ? 'run' : s.border.type}` as Key) : t('stitches.sec.off');
    // Empty: its border is all there is to set.
    if (s.pattern === 'none')
      return [
        this.sec('kind', 'stitches.sec.kind', [this.kindSwitch(info), this.patterns(s)], t('stitch.pattern.none')),
        this.borderSection(s, border),
        this.sec('tools', 'stitches.sec.tools', tools),
      ];
    return [
      this.sec('kind', 'stitches.sec.kind', [this.kindSwitch(info), this.patterns(s)], t(`stitch.pattern.${s.pattern}` as Key)),
      this.sec('look', 'stitches.sec.look', look),
      this.borderSection(s, border),
      hold.some(Boolean) ? this.sec('hold', 'stitches.sec.hold', hold) : null,
      this.sec('tools', 'stitches.sec.tools', tools),
    ].filter((x): x is HTMLDetailsElement => !!x);
  }

  /** Gestaltung of a covering fill: the rows' spacing and direction, the stitches, decorations. */
  private coverLook(s: FillSettings): HTMLElement[] {
    const mm = (d: number) => (v: number) => `${formatNumber(v, d)} mm`;
    const auto = this.info!.auto;
    const density = (label: Key, get: () => number, set: (v: number) => void, own = false) =>
      this.slider({
        label,
        hint: 'stitch.density.hint',
        min: 0.2,
        max: 1.2,
        step: 0.01,
        get,
        set,
        fmt: mm(2),
        band: this.info!.recommended,
        note: (v) => t('stitch.densityNote', { d: formatNumber(1 / v, 1) }),
        ...(own && auto ? { auto: { is: () => Math.abs(get() - auto.fillSpacing) < 0.005, reset: () => set(auto.fillSpacing), fabric: true } } : {}),
      });
    const out: HTMLElement[] = [];
    const d = this.deco(s);
    if (s.pattern === 'gradient' && d.fade) {
      // One layer of a two-color blend (see blendObject): its density fades evenly to nothing.
      out.push(
        density('stitch.density', () => s.spacing, (v) => (s.spacing = v)),
        this.choice<'out' | 'in'>('stitch.fade', ['out', 'in'], d.fade, (v) => `stitch.fade.${v}` as Key, (v) => (d.fade = v)),
      );
    } else if (s.pattern === 'gradient') {
      out.push(
        density('stitch.densityFrom', () => s.spacing, (v) => (s.spacing = v)),
        density('stitch.densityTo', () => s.spacingEnd, (v) => (s.spacingEnd = v)),
      );
    } else out.push(density('stitch.density', () => s.spacing, (v) => (s.spacing = v), true));
    // A gradient is where a color blend is looked for: the same action as in the object panel.
    if (s.pattern === 'gradient' && this.info!.blend) {
      const b: HTMLButtonElement = this.button(d.blend ? 'stitch.blend.change' : 'object.blend', 'object.blend.hint', () => this.hooks.blend(b));
      out.push(h('div', { class: 'tool-row' }, b));
    }
    if (ANGLED.includes(s.pattern)) out.push(this.angle(s));
    if (s.pattern === 'waves') {
      out.push(
        this.slider({ label: 'stitch.waveHeight', hint: 'stitch.waveHeight.hint', min: 0.5, max: 8, step: 0.1, get: () => d.height ?? DECO_DEFAULTS.height, set: (v) => (d.height = v), fmt: mm(1), auto: this.unset(d, 'height') }),
        this.slider({ label: 'stitch.waveLength', hint: 'stitch.waveLength.hint', min: 6, max: 50, step: 0.5, get: () => d.length ?? DECO_DEFAULTS.length, set: (v) => (d.length = v), fmt: mm(1), auto: this.unset(d, 'length') }),
      );
    }
    if (s.pattern === 'grain') {
      out.push(
        this.slider({ label: 'stitch.grainStrength', hint: 'stitch.grainStrength.hint', min: 0.1, max: 1, step: 0.05, get: () => d.strength ?? DECO_DEFAULTS.strength, set: (v) => (d.strength = v), fmt: (v) => `${formatNumber(v * 100, 0)} %`, auto: this.unset(d, 'strength') }),
        this.rerollRow(),
      );
    }
    if (s.pattern === 'swirl') out.push(this.rerollRow());
    out.push(
      this.slider({
        label: 'stitch.length',
        hint: 'stitch.length.hint',
        min: 1.5,
        max: 7,
        step: 0.1,
        get: () => s.stitch,
        set: (v) => (s.stitch = v),
        fmt: mm(1),
        ...(auto ? { auto: { is: () => Math.abs(s.stitch - auto.stitch) < 0.05, reset: () => (s.stitch = auto.stitch) } } : {}),
      }),
    );
    if (s.pattern === 'tatami') out.push(this.offsets(s), ...this.embossControls(s));
    return out;
  }

  /** Stoff und Halt of a covering fill: underlay, edges against the pull, how exact curves are. */
  private coverHold(s: FillSettings): HTMLElement[] {
    const mm = (d: number) => (v: number) => `${formatNumber(v, d)} mm`;
    const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${formatNumber(Math.abs(v), 2)} mm`;
    const pull = this.info!.fabricPull?.fill;
    const out: HTMLElement[] = [
      this.under(
        this.choice<FillUnder>(
          'stitch.underlay',
          FILL_UNDERS,
          !s.underlay ? 'off' : s.underCross ? 'cross' : 'single',
          (v) => `stitch.fillUnder.${v}` as Key,
          (v) => {
            s.underlay = v !== 'off';
            s.underCross = v === 'cross';
          },
          false,
          // Pointing at another kind shows it on the canvas before it is picked.
          (v) => this.hooks.preview(v === null ? null : { kind: 'fill', s: { ...s, underlay: v !== 'off', underCross: v === 'cross' } }),
        ),
      ),
    ];
    if (s.underlay) {
      out.push(
        this.under(this.check('stitch.underCover', 'stitch.underCover.hint', () => !!s.underCover, (v) => (v ? (s.underCover = true) : delete s.underCover))),
        this.under(
          this.choice<'mm' | 'share'>(
            'stitch.underInsetBy',
            ['mm', 'share'],
            s.underInsetShare === undefined ? 'mm' : 'share',
            (v) => `stitch.underInsetBy.${v}` as Key,
            (v) => (s.underInsetShare = v === 'share' ? 0.1 : undefined),
            true,
          ),
        ),
        this.under(
          s.underInsetShare === undefined
            ? this.slider({
                label: 'stitch.underInset',
                hint: 'stitch.underInset.hint',
                min: 0,
                max: 10,
                step: 0.05,
                get: () => s.underInset ?? UNDERLAY_INSET,
                set: (v) => (s.underInset = v),
                fmt: mm(2),
                // Up to where the underlay still has room (the deepest point less what is too thin to sew).
                band: this.info!.depth === undefined ? undefined : [0, Math.max(0, this.info!.depth - 0.6)],
                bandHint: 'stitch.underInset.band',
                auto: this.unset(s, 'underInset'),
              })
            : this.slider({
                label: 'stitch.underInsetShare',
                hint: 'stitch.underInsetShare.hint',
                min: 0,
                max: 0.3,
                step: 0.01,
                get: () => s.underInsetShare ?? 0,
                set: (v) => (s.underInsetShare = v),
                fmt: (v) => `${formatNumber(v * 100, 0)} %`,
              }),
        ),
        this.under(
          this.slider({
            label: 'stitch.underSpacing',
            hint: 'stitch.underSpacing.hint',
            min: 0.6,
            max: 5,
            step: 0.1,
            get: () => s.underSpacing ?? Math.max(1.2, 3 * s.spacing),
            set: (v) => (s.underSpacing = v),
            fmt: mm(1),
            auto: this.unset(s, 'underSpacing'),
          }),
        ),
      );
    }
    out.push(
      this.slider({
        label: 'stitch.edge',
        hint: 'stitch.edgeAuto.hint',
        min: -0.4,
        max: 0.6,
        step: 0.05,
        get: () => s.edge,
        set: (v) => ((s.edge = v), delete s.edgeAuto),
        fmt: signed,
        ...(pull !== undefined
          ? {
              auto: {
                is: () => !!s.edgeAuto,
                reset: () => {
                  s.edgeAuto = true;
                  s.edge = pull;
                },
                fabric: true,
              },
            }
          : {}),
      }),
      this.expandSlider(s),
    );
    // Straight rows cannot stray from their line; curved ones get shorter stitches in tight bends.
    if (CURVED.includes(s.pattern)) out.push(this.toleranceSlider(s));
    return out;
  }

  private expandSlider(s: FillSettings): HTMLElement {
    const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${formatNumber(Math.abs(v), 2)} mm`;
    return this.slider({ label: 'stitch.expand', hint: 'stitch.expand.hint', min: -3, max: 3, step: 0.05, get: () => s.expand ?? 0, set: (v) => (s.expand = v || undefined), fmt: signed, auto: this.unset(s, 'expand') });
  }

  private satinSections(info: StitchInfo): HTMLElement[] {
    const s = this.draft.satin!;
    const e = s.type === 'e';
    const mm = (d: number) => (v: number) => `${formatNumber(v, d)} mm`;
    const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${formatNumber(Math.abs(v), 2)} mm`;
    const auto = info.auto;
    const pull = info.fabricPull?.satin;
    const pullAuto = pull
      ? {
          is: () => !!s.edgeAuto,
          reset: () => {
            s.edgeAuto = true;
            s.edge = pull.edge;
            s.edgeShare = pull.edgeShare;
            delete s.edgeB;
            this.sides = false;
          },
          fabric: true,
        }
      : undefined;
    const width = (label: Key, get: () => number, set: (v: number) => void) => this.slider({ label, hint: 'stitch.edgeAuto.satin.hint', min: -3, max: 3, step: 0.05, get, set, fmt: signed, auto: pullAuto });
    this.sides ||= s.edgeB !== undefined && s.edgeB !== s.edge;
    const kind = [
      this.kindSwitch(info),
      this.choice<SatinType>('stitch.satinType', ['satin', 'e'], s.type ?? 'satin', (v) => `stitch.satinType.${v}` as Key, (v) => {
        s.type = v;
        // An E stitch has its stitches across a few mm apart, a satin a fraction of a mm.
        s.spacing = v === 'e' ? Math.max(s.spacing, 2.5) : Math.min(s.spacing, 0.4);
      }),
    ];
    const look: HTMLElement[] = [
      e
        ? this.slider({ label: 'stitch.density', hint: 'stitch.eSpacing.hint', min: 1, max: 6, step: 0.1, get: () => s.spacing, set: (v) => (s.spacing = v), fmt: mm(1) })
        : this.slider({
            label: 'stitch.density',
            hint: 'stitch.satinDensity.hint',
            min: 0.2,
            max: 1,
            step: 0.01,
            get: () => s.spacing,
            set: (v) => (s.spacing = v),
            fmt: mm(2),
            band: info.recommended,
            ...(auto ? { auto: { is: () => Math.abs(s.spacing - auto.satinSpacing) < 0.005, reset: () => (s.spacing = auto.satinSpacing), fabric: true } } : {}),
          }),
    ];
    if (!e) look.push(this.check('stitch.short', 'stitch.short.hint', () => s.short, (v) => (s.short = v)));
    if (!e) look.push(this.check('stitch.byWidth', 'stitch.byWidth.hint', () => !!s.byWidth, (v) => (v ? (s.byWidth = true) : delete s.byWidth)));
    look.push(
      this.slider({ label: 'stitch.split', hint: 'stitch.split.hint', min: 4, max: SATIN_SPLIT, step: 0.5, get: () => s.split ?? SATIN_SPLIT, set: (v) => (s.split = v), fmt: mm(1), auto: this.unset(s, 'split') }),
      this.check('stitch.stagger', 'stitch.stagger.hint', () => s.stagger ?? true, (v) => (s.stagger = v)),
    );
    const hold: HTMLElement[] = [];
    if (this.sides) {
      hold.push(
        width('stitch.widthLeft', () => s.edge, (v) => ((s.edge = v), delete s.edgeAuto)),
        width('stitch.widthRight', () => s.edgeB ?? s.edge, (v) => ((s.edgeB = v), delete s.edgeAuto)),
      );
    } else hold.push(width('stitch.width', () => s.edge, (v) => ((s.edge = v), delete s.edgeB, delete s.edgeAuto)));
    hold.push(
      this.slider({
        label: 'stitch.widthShare',
        hint: 'stitch.widthShare.hint',
        min: 0,
        max: 0.2,
        step: 0.01,
        get: () => s.edgeShare ?? 0,
        set: (v) => ((s.edgeShare = v), delete s.edgeAuto),
        fmt: (v) => `+${formatNumber(v * 100, 0)} %`,
        auto: pullAuto,
      }),
      this.check('stitch.sides', 'stitch.sides.hint', () => this.sides, (v) => {
        this.sides = v;
        if (v) s.edgeB = s.edge;
        else delete s.edgeB;
        this.render();
      }),
      this.under(
        this.check('stitch.underlay', 'stitch.underlay.satin', () => s.underlay, (v) => {
          s.underlay = v;
          this.render();
        }),
      ),
    );
    if (s.underlay) hold.push(this.under(this.choice<UnderlayKind>('stitch.under.kind', UNDERLAYS, s.under ?? 'auto', (v) => `stitch.under.${v}` as Key, (v) => (s.under = v), true)));
    // Along the middle there is nothing to keep inside.
    if (s.underlay && s.under !== 'center') {
      hold.push(
        this.under(
          this.choice<'mm' | 'share'>(
            'stitch.underInsetBy',
            ['mm', 'share'],
            s.underInsetShare === undefined ? 'mm' : 'share',
            (v) => `stitch.underInsetBy.${v}` as Key,
            (v) => (s.underInsetShare = v === 'share' ? 0.15 : undefined),
            true,
          ),
        ),
        this.under(
          s.underInsetShare === undefined
            ? this.slider({ label: 'stitch.underInset', hint: 'stitch.satinUnderInset.hint', min: 0, max: 3, step: 0.05, get: () => s.underInset ?? 0.4, set: (v) => (s.underInset = v), fmt: mm(2), auto: this.unset(s, 'underInset') })
            : this.slider({
                label: 'stitch.underInsetShare',
                hint: 'stitch.satinUnderInsetShare.hint',
                min: 0,
                max: 0.45,
                step: 0.01,
                get: () => s.underInsetShare ?? 0,
                set: (v) => (s.underInsetShare = v),
                fmt: (v) => `${formatNumber(v * 100, 0)} %`,
              }),
        ),
      );
    }
    const d = info.direction;
    const state = !d ? null : !d.single ? t('stitch.direction.single') : d.rungs === null ? t('stitches.bar.follow') : d.rungs === 0 ? t('stitches.bar.even') : t('stitches.bar.rungs', { n: d.rungs });
    const sections = d?.cuts ? `${state} · ${t('stitches.bar.cuts', { n: d.cuts + 1 })}` : state;
    const tools = [
      d ? this.toolRow('stitch.direction', 'stitches.tool.direction', 'stitch.direction.tool.hint', d.tool, sections) : null,
      this.handRow(),
      this.lockSwitch(info.lock),
      info.free?.can ? this.looseRow() : null,
    ];
    return [
      this.sec('kind', 'stitches.sec.kind', kind, t(`stitch.satinType.${s.type ?? 'satin'}` as Key)),
      this.sec('look', 'stitches.sec.look', look),
      this.sec('hold', 'stitches.sec.hold', hold),
      this.sec('tools', 'stitches.sec.tools', tools),
    ];
  }

  private runSections(info: StitchInfo): HTMLElement[] {
    const s = this.draft.run!;
    return [
      this.sec('look', 'stitches.sec.look', [
        this.slider({ label: 'stitch.length', hint: 'stitch.runLength.hint', min: 1, max: 6, step: 0.1, get: () => s.stitch, set: (v) => (s.stitch = v), fmt: (v) => `${formatNumber(v, 1)} mm` }),
        this.check('stitch.triple', 'stitch.triple.hint', () => s.triple, (v) => (s.triple = v)),
      ]),
      this.sec('hold', 'stitches.sec.hold', [this.toleranceSlider(s)]),
      this.sec('tools', 'stitches.sec.tools', [this.handRow(), this.lockSwitch(info.lock), info.free?.can ? this.looseRow() : null]),
    ];
  }

  /** A line: how it is sewn along its curve, its echo and shadow. */
  private lineSections(info: StitchInfo): HTMLElement[] {
    const st = this.lineDraft!;
    const parts = this.pathStitch(
      st,
      (v) => {
        if (v) this.lineDraft = Object.assign(this.lineDraft ?? v, v);
      },
      false,
    );
    if (isRunType(st.type)) {
      st.tolerance ??= this.tolerance ?? TOLERANCE;
      parts.hold.push(this.toleranceSlider(st as { tolerance: number }));
    }
    const kindName = t(`stitch.border.${isRunType(st.type) ? 'run' : st.type}` as Key);
    const fx = [st.echo ? t('stitch.echo') : '', st.shadow ? t('stitch.shadow') : ''].filter(Boolean).join(', ');
    return [
      this.sec('kind', 'stitches.sec.kind', [this.kindSwitch(info), parts.type], kindName),
      this.sec('look', 'stitches.sec.look', parts.look),
      this.sec('effects', 'stitches.sec.effects', [this.echoGroup(st, info.path!.closed, info.path!.color), info.path!.traced ? null : this.shadowGroup(st, info.path!.color)], fx || t('stitches.sec.off')),
      parts.hold.length ? this.sec('hold', 'stitches.sec.hold', parts.hold) : null,
      this.sec('tools', 'stitches.sec.tools', [this.handRow(), this.lockSwitch(info.lock), info.free?.can ? this.looseRow() : null]),
    ].filter((x): x is HTMLDetailsElement => !!x);
  }

  // Building blocks -------------------------------------------------------------------------------

  /** Automatic while `key` of `o` is not set: going back takes it out. */
  private unset<T extends object>(o: T, key: keyof T): SliderDef['auto'] {
    return { is: () => o[key] === undefined, reset: () => delete o[key] };
  }

  /** A fill along a line: the width of the line and its ends make the area (the line stays the shape). */
  private lineFillControls(): HTMLElement[] {
    const s = this.draft.fill!;
    const width = s.lineWidth ?? 3;
    return [
      this.slider({ label: 'stitch.lineWidth', hint: 'stitch.lineFill.width.hint', min: 0.8, max: Math.max(12, Math.ceil(width)), step: 0.1, get: () => s.lineWidth ?? width, set: (v) => (s.lineWidth = v), fmt: (v) => `${formatNumber(v, 1)} mm` }),
      this.choice<LineCap>('stitch.lineCap', ['flat', 'round'], s.lineCap ?? 'flat', (v) => `stitch.lineCap.${v}` as Key, (v) => (s.lineCap = v)),
    ];
  }

  /** Füllung, Satin, Linie: picking another one sews the objects anew in that kind. */
  private kindSwitch(info: StitchInfo): HTMLElement {
    const now = this.nowKind();
    const row = h('div', { class: 'segmented kind-switch', role: 'radiogroup', 'aria-label': t('stitch.kind') });
    for (const k of ['fill', 'satin', 'line'] as const) {
      const on = k === now;
      const b = h('button', { type: 'button', class: on ? 'active' : '', role: 'radio', 'aria-checked': String(on) });
      b.innerHTML = `<span class="kind-icon">${KIND_ICON[k === 'line' ? 'run' : k]}</span>`;
      b.append(k === 'line' ? t('stitch.kind.line') : kindLabel(k));
      const can = on || this.canConvert(k);
      b.disabled = !can;
      const cmd = getCommand(`stitch.kind.${k}`);
      const key = cmd?.keys?.[0] ? ` (${keyLabel(cmd.keys[0])})` : '';
      if (!on)
        b.title = !can
          ? k === 'satin'
            ? now === 'fill' && !info.asLine
              ? t('stitch.kind.noSatin')
              : t('stitches.kind.notForLine')
            : k === 'line'
              ? t('stitches.kind.lineOnly')
              : t('stitch.kind.toFill')
          : t(k === 'satin' ? 'stitch.kind.toSatin' : k === 'line' ? 'stitch.kind.toLine' : now === 'line' ? 'stitch.kind.lineToFill' : 'stitch.kind.toFill') + key;
      b.addEventListener('click', () => {
        if (!on) this.convert(k);
      });
      row.append(b);
    }
    return h('div', { class: 'field stitch-field' }, row);
  }

  /** Max. deviation from the line; remembered for the next objects. */
  private toleranceSlider(s: { tolerance: number }): HTMLElement {
    return this.slider({
      label: 'stitch.tolerance',
      hint: 'stitch.tolerance.hint',
      min: 0.05,
      max: 0.5,
      step: 0.05,
      get: () => s.tolerance,
      set: (v) => (s.tolerance = this.tolerance = v),
      fmt: (v) => `${formatNumber(v, 2)} mm`,
      auto: {
        is: () => Math.abs(s.tolerance - TOLERANCE) < 0.001,
        reset: () => {
          s.tolerance = TOLERANCE;
          this.tolerance = null;
        },
      },
    });
  }

  private slider(d: SliderDef): HTMLElement {
    const label = h('label', { class: 'field stitch-field' + (d.auto ? ' has-auto' : '') });
    if (d.hint) label.title = t(d.hint);
    const out = h('output');
    const name = h('span', { class: 'name' }, t(d.label));
    const top = h('span', { class: 'label' }, name);
    const input = h('input', { type: 'range', min: String(d.min), max: String(d.max), step: String(d.step), value: String(d.get()) });
    let track: HTMLElement = input;
    if (d.band) {
      // A green strip under the track marks the recommended range.
      const a = Math.max(0, ((d.band[0] - d.min) / (d.max - d.min)) * 100);
      const b = Math.min(100, ((d.band[1] - d.min) / (d.max - d.min)) * 100);
      track = h('span', { class: 'band-track', title: t(d.bandHint ?? 'stitch.band', { a: formatNumber(d.band[0], 2), b: formatNumber(d.band[1], 2) }) });
      const band = h('span', { class: 'band' });
      band.style.left = `${a}%`;
      band.style.width = `${Math.max(0, b - a)}%`;
      track.append(input, band);
    }
    const note = h('span', { class: 'muted small' });
    let tag: HTMLElement | null = null;
    let dot: HTMLButtonElement | null = null;
    const auto = d.auto;
    if (auto) {
      tag = h('span', { class: 'auto-tag' }, t(auto.fabric ? 'stitches.auto.fabric' : 'stitches.auto'));
      dot = h('button', { type: 'button', class: 'auto-dot' });
      dot.addEventListener('click', (e) => {
        e.preventDefault();
        if (auto.is()) return;
        auto.reset();
        this.render();
        if (d.commit) d.commit();
        else this.changed(true);
      });
      top.append(tag);
    }
    top.append(out);
    if (dot) top.append(dot);
    const show = () => {
      out.textContent = d.fmt(d.get());
      if (d.note) note.textContent = d.note(d.get());
      if (auto && dot && tag) {
        const on = auto.is();
        dot.classList.toggle('on', on);
        dot.disabled = on;
        const hint = t(on ? (auto.fabric ? 'stitches.auto.onFabric' : 'stitches.auto.on') : 'stitches.auto.own');
        dot.title = hint;
        dot.setAttribute('aria-label', hint);
        tag.hidden = !on;
        label.classList.toggle('own', !on);
      }
    };
    show();
    input.addEventListener('input', () => {
      d.set(parseFloat(input.value));
      show();
      if (!d.commit) this.changed(false);
    });
    input.addEventListener('change', () => (d.commit ? d.commit() : this.changed(true)));
    label.append(top, track);
    if (d.note) label.append(note);
    return label;
  }

  /**
   * The fill patterns as small pictures under two tabs (covering, open); picking one
   * applies it, pointing at one shows it on the canvas first.
   */
  private patterns(s: FillSettings): HTMLElement {
    const now = tileOf(s);
    const group = this.group ?? groupOf(now);
    const tabs = h('div', { class: 'pattern-groups', role: 'tablist', 'aria-label': t('stitch.pattern') });
    for (const g of TILE_GROUPS) {
      const b = h('button', { type: 'button', class: (g === group ? 'active' : '') + (g === groupOf(now) ? ' holds' : ''), role: 'tab', 'aria-selected': String(g === group), title: t(`stitch.group.${g}.hint` as Key) }, t(`stitch.group.${g}` as Key));
      b.addEventListener('click', () => {
        if (g === group) return;
        this.group = g;
        this.render();
      });
      tabs.append(b);
    }
    const row = h('div', { class: 'pattern-tiles', role: 'radiogroup', 'aria-label': t(`stitch.group.${group}` as Key) });
    const apply = (to: FillSettings, tile: Tile) => {
      // Points belong to the pattern they were set for: rays and circles start anew in their place.
      // A fade and its second thread belong to the gradient: another pattern takes the second one out.
      const { focus: _f, centers: _c, fade: _d, blend: _b, ...rest } = to.deco ?? {};
      to.pattern = tile;
      to.deco = rest;
      // Empty: only the border is sewn, as the object in its thread (a triple stitch when it had none).
      if (tile === 'none') {
        if (to.border) {
          delete to.border.color;
          delete to.border.link;
        } else to.border = { type: 'triple', width: BORDER_WIDTH };
      }
    };
    for (const tile of GROUPS[group]) {
      const b = h('button', { type: 'button', class: 'pattern-tile' + (tile === now ? ' active' : ''), role: 'radio', 'aria-checked': String(tile === now), title: t(`stitch.pattern.${tile}.hint` as Key) });
      b.innerHTML = PATTERN_ICON[tile];
      b.append(h('span', null, t(`stitch.pattern.${tile}` as Key)));
      // Guide lines belong to one object.
      const blocked = tile === 'guided' && !this.info!.guide?.single;
      if (blocked) {
        b.disabled = true;
        b.title = t('stitch.guide.single');
      }
      b.addEventListener('click', () => {
        if (tileOf(s) === tile) return;
        this.hooks.preview(null);
        apply(s, tile);
        this.render();
        // Without guide lines there is nothing to follow yet: their tool opens, and the stitches
        // change with the first line.
        if (tile === 'guided' && !s.guides?.length) return this.hooks.guide('tool');
        if (tile !== 'guided' && this.info!.guide?.tool) this.hooks.guide('off');
        if (!POINTED.includes(tile) && this.info!.points?.tool) this.hooks.points('off');
        this.changed(true);
      });
      // Pointing at a pattern shows it on the canvas before it is picked (guided needs its lines first).
      if (tile !== now && tile !== 'guided' && !blocked) {
        b.addEventListener('pointerenter', () => {
          const peek = structuredClone(s);
          apply(peek, tile);
          this.hooks.preview({ kind: 'fill', s: peek });
        });
        b.addEventListener('pointerleave', () => this.hooks.preview(null));
      }
      row.append(b);
    }
    return h('div', { class: 'field stitch-field', title: t(`stitch.pattern.${now}.hint` as Key) }, h('span', { class: 'label' }, t('stitch.pattern')), tabs, row);
  }

  /** The settings of decorative and open patterns, made when first set. */
  private deco(s: FillSettings): DecoSettings {
    return (s.deco ??= {});
  }

  /** A new random variant of grain, swirls, meander and maze; for swirls new eyes too. */
  private rerollRow(): HTMLElement {
    const b = this.button('stitch.reroll', 'stitch.reroll.hint', () => this.reroll());
    b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="2.5"/><circle cx="5.5" cy="5.5" r=".9" fill="currentColor"/><circle cx="10.5" cy="10.5" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/></svg>';
    b.append(t('stitch.reroll'));
    return h('div', { class: 'field stitch-field reroll-row' }, b);
  }

  /**
   * Embossing of a tatami: none or a motif drawn by the needle points (small pictures), and its
   * size when one is set.
   */
  private embossControls(s: FillSettings): HTMLElement[] {
    const d = this.deco(s);
    const row = h('div', { class: 'segmented motif-row', role: 'radiogroup', 'aria-label': t('stitch.motif') });
    for (const m of [null, ...MOTIFS] as (Motif | null)[]) {
      const on = (d.emboss ?? null) === m;
      const key = (m ? `stitch.motif.${m}` : 'stitch.motif.none') as Key;
      const b = h('button', { type: 'button', class: on ? 'active' : '', role: 'radio', 'aria-checked': String(on), title: t(key) });
      b.innerHTML = m ? MOTIF_ICON[m] : MOTIF_NONE;
      b.append(h('span', null, t(key)));
      b.addEventListener('click', () => {
        if (on) return;
        if (m) d.emboss = m;
        else delete d.emboss;
        this.hooks.preview(null);
        this.render();
        this.changed(true);
      });
      // Pointing at a motif shows it on the canvas before it is picked.
      if (!on) {
        b.addEventListener('pointerenter', () => {
          const peek = structuredClone(s);
          const pd = (peek.deco ??= {});
          if (m) pd.emboss = m;
          else delete pd.emboss;
          this.hooks.preview({ kind: 'fill', s: peek });
        });
        b.addEventListener('pointerleave', () => this.hooks.preview(null));
      }
      row.append(b);
    }
    const wrap = h('div', { class: 'field stitch-field', title: t('stitch.motif.hint') }, h('span', { class: 'label' }, t('stitch.motif')), row);
    if (!d.emboss) return [wrap];
    return [
      wrap,
      this.choice<'soft' | 'strong'>(
        'stitch.motifStrength',
        ['soft', 'strong'],
        d.embossStrong ? 'strong' : 'soft',
        (v) => `stitch.motifStrength.${v}` as Key,
        (v) => (v === 'strong' ? (d.embossStrong = true) : delete d.embossStrong),
        false,
        (v) => {
          if (!v) return this.hooks.preview(null);
          const peek = structuredClone(s);
          const pd = (peek.deco ??= {});
          if (v === 'strong') pd.embossStrong = true;
          else delete pd.embossStrong;
          this.hooks.preview({ kind: 'fill', s: peek });
        },
      ),
      this.slider({ label: 'stitch.motifSize', hint: 'stitch.motifSize.hint', min: 4, max: 30, step: 0.5, get: () => d.embossSize ?? DECO_DEFAULTS.embossSize, set: (v) => (d.embossSize = v), fmt: (v) => `${formatNumber(v, 1)} mm`, auto: this.unset(d, 'embossSize') }),
    ];
  }

  /** Points of rays, circles and swirls: set and moved on the canvas with their tool. */
  private pointRow(s: FillSettings, d: StitchInfo['points']): HTMLElement {
    return this.toolRow('stitch.points', 'stitches.tool.points', 'stitch.points.tool.hint', !!d?.tool, d?.single ? t(`stitch.points.${s.pattern}` as Key) : t('stitch.points.single'));
  }

  /** Points set on the canvas (shares of the shape's extent): the fill is sewn anew around them. */
  setPoints(points: Pt[]): void {
    const s = this.draft.fill;
    if (!s || this.kind !== 'fill' || !POINTED.includes(s.pattern)) return;
    const d = this.deco(s);
    if (s.pattern === 'swirl') d.centers = points;
    else d.focus = points[0];
    this.render();
    this.changed(true);
  }

  /** Open patterns: distance of the lines (or size of a cell), their kind, the stitch. */
  private openControls(s: FillSettings): HTMLElement[] {
    const pat = s.pattern as OpenPattern;
    const d = this.deco(s);
    const [lo, hi] = OPEN_SIZE_RANGE[pat];
    const cells = pat === 'grid' || pat === 'cross';
    const out: HTMLElement[] = [];
    if (pat === 'grid') out.push(this.choice<GridKind>('stitch.grid', GRID_KINDS, d.grid ?? DECO_DEFAULTS.grid, (v) => `stitch.grid.${v}` as Key, (v) => (d.grid = v)));
    if (pat === 'cross') out.push(this.choice<CrossKind>('stitch.cross', CROSS_KINDS, d.cross ?? DECO_DEFAULTS.cross, (v) => `stitch.cross.${v}` as Key, (v) => (d.cross = v)));
    out.push(
      this.slider({
        label: cells ? 'stitch.openCell' : 'stitch.openSize',
        hint: cells ? 'stitch.openCell.hint' : 'stitch.openSize.hint',
        min: lo,
        max: hi,
        step: 0.1,
        get: () => Math.min(hi, Math.max(lo, d.size ?? OPEN_SIZE[pat])),
        set: (v) => (d.size = v),
        fmt: (v) => `${formatNumber(v, 1)} mm`,
        auto: this.unset(d, 'size'),
      }),
    );
    if (pat !== 'cross') out.push(this.slider({ label: 'stitch.length', hint: 'stitch.openLength.hint', min: 1, max: 3, step: 0.1, get: () => Math.min(3, s.stitch), set: (v) => (s.stitch = v), fmt: (v) => `${formatNumber(v, 1)} mm` }));
    out.push(this.check('stitch.triple', 'stitch.openTriple.hint', () => !!d.triple, (v) => (d.triple = v)));
    if (pat === 'meander' || pat === 'maze') out.push(this.rerollRow());
    return out;
  }

  /** Tatami offset: how far the needle points shift from row to row. */
  private offsets(s: FillSettings): HTMLElement {
    const row = h('div', { class: 'segmented offset-buttons', role: 'radiogroup', 'aria-label': t('stitch.offset') });
    const options: [number, string][] = [...OFFSETS, [0, t('stitch.offset.random')]];
    for (const [v, text] of options) {
      const on = Math.abs(s.offset - v) < 1e-3;
      const b = h('button', { type: 'button', class: on ? 'active' : '', role: 'radio', 'aria-checked': String(on) }, text);
      b.addEventListener('click', () => {
        if (Math.abs(s.offset - v) < 1e-3) return;
        s.offset = v;
        this.render();
        this.changed(true);
      });
      row.append(b);
    }
    return h('div', { class: 'field stitch-field', title: t('stitch.offset.hint') }, h('span', { class: 'label' }, t('stitch.offset')), row);
  }

  /** Angle: a dial that shows the row direction, and a slider. */
  private angle(s: FillSettings): HTMLElement {
    const out = h('output');
    const needle = h('span');
    const dial = h('span', { class: 'angle-dial', 'aria-hidden': 'true' }, needle);
    const input = h('input', { type: 'range', min: '0', max: '175', step: '5', value: String(((Math.round(s.angle / 5) * 5) % 180) || 0) });
    const show = () => {
      out.textContent = Number.isFinite(s.angle) ? `${Math.round(s.angle)}°` : t('stitches.auto');
      // Screen y points down, so the rows' angle turns clockwise.
      needle.style.transform = `rotate(${Number.isFinite(s.angle) ? s.angle : 0}deg)`;
    };
    show();
    input.addEventListener('input', () => {
      s.angle = parseFloat(input.value);
      show();
      this.changed(false);
    });
    input.addEventListener('change', () => this.changed(true));
    return h('label', { class: 'field stitch-field', title: t('stitch.angle.hint') }, h('span', { class: 'label' }, h('span', { class: 'name' }, t('stitch.angle')), out), h('span', { class: 'angle-row' }, dial, input));
  }

  /** A row of buttons, one per value; picking one applies it. Each has `<text>.hint` as its title. */
  private choice<T extends string>(label: Key, values: readonly T[], now: T, text: (v: T) => Key, set: (v: T) => void, small = false, peek?: (v: T | null) => void): HTMLElement {
    const row = h('div', { class: 'segmented choice-row' + (small ? ' small' : ''), role: 'radiogroup', 'aria-label': t(label) });
    for (const v of values) {
      const b = h('button', { type: 'button', class: v === now ? 'active' : '', role: 'radio', 'aria-checked': String(v === now), title: t(`${text(v)}.hint` as Key) }, t(text(v)));
      b.addEventListener('click', () => {
        if (v === now) return;
        set(v);
        this.render();
        this.changed(true);
      });
      if (peek && v !== now) {
        b.addEventListener('pointerenter', () => peek(v));
        b.addEventListener('pointerleave', () => peek(null));
      }
      row.append(b);
    }
    return h('div', { class: 'field stitch-field' }, h('span', { class: 'label' }, t(label)), row);
  }

  /** A small button. */
  private button(text: Key, hint: Key, on: () => void, primary = false, disabled = false): HTMLButtonElement {
    const b = h('button', { type: 'button', class: primary ? 'primary small' : 'small', title: t(hint), disabled }, t(text));
    b.addEventListener('click', on);
    return b;
  }

  /**
   * A tool of the canvas as a button that stays pressed while the tool is on (its options then show
   * over the stage), with what it holds now beside it.
   */
  private toolRow(cmd: string, label: Key, hint: Key, on: boolean, state: string | null): HTMLElement {
    const c = getCommand(cmd);
    const key = c?.keys?.[0] ? ` (${keyLabel(c.keys[0])})` : '';
    const b = h('button', { type: 'button', class: 'tool-toggle', 'aria-pressed': String(on), title: t(hint) + key, disabled: !on && !canRun(cmd) }, t(label));
    b.addEventListener('click', () => runCommand(cmd));
    return h('div', { class: 'tool-row' }, b, state ? h('span', { class: 'tool-state muted small' }, state) : null);
  }

  /** Guide lines of a guided fill: how many, and their tool. */
  private guideRow(s: FillSettings, d: StitchInfo['guide']): HTMLElement {
    const n = s.guides?.length ?? 0;
    return this.toolRow('stitch.guides', 'stitches.tool.guides', 'stitch.guide.tool.hint', !!d?.tool, d?.single ? (n ? t(n === 1 ? 'stitch.guide.one' : 'stitch.guide.count', { n }) : t('stitches.guides.none')) : t('stitch.guide.single'));
  }

  /**
   * Guide lines drawn on the canvas: the fill follows them from now on. Without any left it goes
   * back to straight rows.
   */
  setGuides(guides: Pt[][]): void {
    const s = this.draft.fill;
    if (!s || this.kind !== 'fill') return;
    s.guides = guides;
    s.pattern = guides.length ? 'guided' : 'tatami';
    this.render();
    this.changed(true);
  }

  /** Stitches by hand, and thinning out the object's rows by a share. */
  private handRow(): HTMLElement {
    const edit = this.toolRow('edit.stitches', 'stitches.tool.hand', 'level.stitches.hint', false, null);
    const thin = h('button', { type: 'button', class: 'small', title: t('stitches.cmd.thin'), disabled: !canRun('edit.thin') }, t('stitches.tool.thin'));
    thin.addEventListener('click', () => runCommand('edit.thin'));
    const share = h('select', { class: 'thin-share', 'aria-label': t('stitches.thin.share'), title: t('stitches.thin.share') });
    for (const [v, text] of THIN_SHARES) share.append(h('option', { value: String(v), selected: v === thinShare.peek() }, text));
    share.addEventListener('change', () => setThinShare(Number(share.value)));
    edit.append(h('span', { class: 'thin-group' }, thin, share));
    return edit;
  }

  /** The way to loose the stitches from their shape. */
  private looseRow(): HTMLElement {
    const b = h('button', { type: 'button', class: 'link', title: t('free.loose.hint') }, t('free.loose'));
    b.addEventListener('click', () => this.hooks.free(true));
    return h('div', { class: 'tool-row' }, b);
  }

  /** Stitches loosed from their shape: the way back (and to loose the rest). */
  private freeRows(on: true | 'mixed'): HTMLElement[] {
    const row = h('div', { class: 'tool-row' }, this.button('free.back', 'free.back.hint', () => this.hooks.free(false)));
    if (on === 'mixed') row.append(this.button('free.looseAll', 'free.loose.hint', () => this.hooks.free(true)));
    return [row];
  }

  /** Left out of the correction: a switch, taken over at once. */
  private lockSwitch(on: boolean | 'mixed'): HTMLElement {
    const i = h('input', { type: 'checkbox', checked: on === true, indeterminate: on === 'mixed' });
    i.addEventListener('change', () => this.hooks.lock(i.checked));
    return h('label', { class: 'check lock-switch', title: t('plan.lock.hint') }, i, h('span', null, t('plan.lock')));
  }

  /**
   * A line's shadow: off, or where it falls, how far, in which thread. It is an object of its own in
   * that thread, sewn before the line (see model/shadow.ts).
   */
  private shadowGroup(st: PathStitch, line: ThreadColor): HTMLElement {
    const sh = st.shadow;
    const box = h('div', { class: 'fx-group', title: t('stitch.shadow.intro') });
    box.append(
      this.choice<ShadowDir | 'off'>('stitch.shadow', ['off', ...SHADOW_DIRS], sh?.dir ?? 'off', (v) => `stitch.shadow.${v}` as Key, (v) => {
        if (v === 'off') delete st.shadow;
        else st.shadow = sh ? { ...sh, dir: v } : { color: { ...SHADOW_COLOR }, link: newLink(), dir: v, dist: SHADOW_DEFAULT_DIST };
      }),
    );
    if (!sh) return box;
    box.append(
      this.slider({
        label: 'stitch.shadow.dist',
        hint: 'stitch.shadow.dist.hint',
        min: SHADOW_DIST[0],
        max: SHADOW_DIST[1],
        step: 0.1,
        get: () => sh.dist,
        set: (v) => (sh.dist = v),
        fmt: (v) => `${formatNumber(v, 1)} mm`,
        auto: { is: () => sh.dist === SHADOW_DEFAULT_DIST, reset: () => (sh.dist = SHADOW_DEFAULT_DIST) },
      }),
    );
    const btn = h('button', { type: 'button', class: 'border-thread', title: t('stitch.shadow.thread.hint') });
    const sw = h('span', { class: 'sw' });
    sw.style.background = cssColor(sh.color);
    btn.append(sw, sh.color.name ?? (sameColor(sh.color, SHADOW_COLOR) ? t('stitch.shadow.thread.grey') : hexColor(sh.color)));
    btn.addEventListener('click', () => {
      this.picker.toggle(btn, {
        key: 'shadow',
        title: t('stitch.shadow.thread'),
        current: sh.color,
        original: { color: SHADOW_COLOR, label: t('stitch.shadow.thread.grey') },
        note: t('stitch.shadow.thread.note'),
        onPick: (c) => {
          // In the line's own thread a shadow would only be a thicker line.
          if (sameColor(c, line)) return;
          sh.color = { ...c };
          this.render();
          this.changed(true);
        },
      });
    });
    box.append(h('div', { class: 'field stitch-field border-field' }, h('span', { class: 'label' }, t('stitch.shadow.thread')), h('div', { class: 'border-row' }, btn)));
    return box;
  }

  /**
   * A thread for each copy of an echo, nearest first: the line's, or one of its own (then the
   * copies of that thread are an object of their own, linked to the line).
   */
  private echoThreads(e: NonNullable<PathStitch['echo']>, line: ThreadColor): HTMLElement {
    const row = h('div', { class: 'border-row echo-threads' });
    for (let k = 1; k <= e.count; k++) {
      if (e.skip?.includes(k)) continue;
      const own = e.colors?.[k - 1] ?? null;
      const btn = h('button', { type: 'button', class: 'border-thread', title: own ? (own.name ?? hexColor(own)) : t('stitch.echo.same') });
      const sw = h('span', { class: 'sw' });
      sw.style.background = cssColor(own ?? line);
      btn.append(sw, String(k));
      btn.addEventListener('click', () => {
        this.picker.toggle(btn, {
          key: `echo${k}`,
          title: t('stitch.echo.copy', { n: k }),
          current: own ?? line,
          original: { color: line, label: t('stitch.echo.same') },
          onPick: (c) => {
            const colors = Array.from({ length: e.count }, (_, i) => e.colors?.[i] ?? null);
            colors[k - 1] = sameColor(c, line) ? null : { ...c };
            if (colors.some(Boolean)) {
              e.colors = colors;
              e.link ??= newLink();
            } else delete e.colors;
            this.render();
            this.changed(true);
          },
        });
      });
      row.append(btn);
    }
    return h('div', { class: 'field stitch-field border-field', title: t('stitch.echo.threads.hint') }, h('span', { class: 'label' }, t('stitch.echo.threads')), row);
  }

  /**
   * A line's echo: off, or on which side, how many copies, how far apart. A closed line has an
   * outside and an inside; an open line one side or the other (which one is left of its drawing
   * direction is not to be seen, so the side is switched with a button).
   */
  private echoGroup(st: PathStitch, closed: boolean, line: ThreadColor): HTMLElement {
    type Choice = EchoSide | 'off' | 'one';
    const now: Choice = !st.echo ? 'off' : closed || st.echo.side === 'both' ? st.echo.side : 'one';
    const values: Choice[] = closed ? ['off', ...ECHO_SIDES] : ['off', 'one', 'both'];
    const box = h('div', { class: 'fx-group', title: t('stitch.echo.intro') });
    box.append(
      this.choice<Choice>('stitch.echo', values, now, (v) => `stitch.echo.${v}` as Key, (v) => {
        if (v === 'off') delete st.echo;
        else st.echo = { ...(st.echo ?? ECHO_DEFAULT), side: v === 'one' ? (st.echo && st.echo.side !== 'both' ? st.echo.side : 'out') : v };
      }),
    );
    if (now === 'one') {
      box.append(
        h(
          'div',
          { class: 'tool-row' },
          this.button('stitch.echo.flip', 'stitch.echo.flip.hint', () => {
            st.echo!.side = st.echo!.side === 'out' ? 'in' : 'out';
            this.changed(true);
          }),
        ),
      );
    }
    const e = st.echo;
    if (!e) return box;
    // Satin columns side by side need their width.
    const least = !isRunType(st.type) ? Math.min(ECHO_GAP[1], Math.round((st.width + 0.5) * 10) / 10) : ECHO_GAP[0];
    box.append(
      this.slider({ label: 'stitch.echo.count', hint: 'stitch.echo.count.hint', min: ECHO_COUNT[0], max: ECHO_COUNT[1], step: 1, get: () => e.count, set: (v) => (e.count = Math.round(v)), fmt: (v) => formatNumber(v) }),
      this.slider({ label: 'stitch.echo.gap', hint: 'stitch.echo.gap.hint', min: least, max: ECHO_GAP[1], step: 0.1, get: () => Math.max(least, e.gap), set: (v) => (e.gap = v), fmt: (v) => `${formatNumber(v, 1)} mm` }),
      this.choice<'joined' | 'cut'>('stitch.echo.link', ['joined', 'cut'], e.cut ? 'cut' : 'joined', (v) => `stitch.echo.${v}` as Key, (v) => {
        if (v === 'cut') e.cut = true;
        else delete e.cut;
      }),
      this.echoThreads(e, line),
    );
    return box;
  }

  /** Leaving out what lies on top: a switch, taken over at once (the shape itself stays). */
  private knockoutSwitch(k: NonNullable<StitchInfo['knockout']>): HTMLElement {
    const i = h('input', { type: 'checkbox', checked: k.on === true, indeterminate: k.on === 'mixed' });
    i.addEventListener('change', () => this.hooks.knockout(i.checked));
    const wrap = h('div', { class: 'knockout' }, h('label', { class: 'check', title: t('knockout.switch.hint') + (k.covered ? '' : ` ${t('knockout.nothingOnTop')}`) }, i, h('span', null, t('knockout.switch'))));
    if (k.on) {
      const share = { v: k.share };
      wrap.append(
        this.slider({
          label: 'knockout.share',
          hint: 'knockout.share.hint',
          min: 0.1,
          max: 0.5,
          step: 0.05,
          get: () => share.v,
          set: (v) => (share.v = v),
          fmt: (v) => `${formatNumber(v * 100, 0)} %`,
          commit: () => this.hooks.overlapShare(share.v),
          auto: { is: () => Math.abs(share.v - SATIN_SHARE) < 0.001, reset: () => (share.v = SATIN_SHARE) },
        }),
      );
    }
    return wrap;
  }

  /**
   * Settings of stitches along a line (see along.ts): the kind, Aus first when `off` is allowed,
   * then what that kind looks like and what holds it. The same fields for a fill's border and for a
   * line of its own; `offset` adds where the line lies to the edge (borders only).
   */
  pathStitch(st: PathStitch | undefined, set: (v: PathStitch | undefined) => void, off = true, offset = false): PathParts {
    const mm = (d: number) => (v: number) => `${formatNumber(v, d)} mm`;
    const kinds = off ? BORDERS : BORDERS.filter((v) => v !== 'off');
    const type = this.choice<BorderChoice>('stitch.borderType', kinds, st ? (isRunType(st.type) ? 'run' : st.type) : 'off', (v) => `stitch.border.${v}` as Key, (v) => {
      if (v === 'off') return set(undefined);
      // Each kind starts with its own spacing; a satin's 0.4 mm would make a zigzag a satin.
      const next: PathStitch = { ...st, type: v, width: st?.width ?? BORDER_WIDTH };
      delete next.spacing;
      // A motif needs a few mm to show its figures.
      if (v === 'motif') next.width = Math.max(next.width, MOTIF_WIDTH);
      set(next);
    });
    // Five or six kinds: in even rows of three, not one left alone on a second row.
    type.querySelector('.choice-row')?.classList.add('kinds');
    const out: PathParts = { type, look: [], hold: [] };
    if (!st) return out;
    const change = (f: (s: PathStitch) => void) => (v: number) => {
      f(st);
      set(st);
      void v;
    };
    const unset = (key: keyof PathStitch) => ({
      is: () => st[key] === undefined,
      reset: () => {
        delete st[key];
        set(st);
      },
    });
    if (offset) {
      out.look.push(
        this.slider({
          label: 'stitch.borderOffset',
          hint: 'stitch.borderOffset.hint',
          min: -3,
          max: 3,
          step: 0.05,
          get: () => st.offset ?? 0,
          set: (v) => change((s) => (s.offset = v || undefined))(v),
          fmt: (v) => (v ? `${v > 0 ? '+' : '−'}${formatNumber(Math.abs(v), 2)} mm ${t(v > 0 ? 'stitch.borderOffset.out' : 'stitch.borderOffset.in')}` : t('stitch.borderOffset.edge')),
          auto: unset('offset'),
        }),
      );
    }
    if (isRunType(st.type)) {
      const times = st.type === 'triple' ? (st.repeat === 5 ? '5' : '3') : '1';
      out.look.push(
        this.choice<(typeof REPEATS)[number]>('stitch.repeat', REPEATS, times, (v) => `stitch.repeat.${v}` as Key, (v) => {
          st.type = v === '1' ? 'run' : 'triple';
          if (v === '5') st.repeat = 5;
          else delete st.repeat;
          set(st);
        }, true),
        this.slider({ label: 'stitch.length', hint: 'stitch.runLength.hint', min: 1, max: 6, step: 0.1, get: () => st.length ?? BORDER_STITCH, set: (v) => change((s) => (s.length = v))(v), fmt: mm(1), auto: unset('length') }),
      );
      return out;
    }
    const width = this.slider({ label: offset ? 'stitch.borderWidth' : 'stitch.lineWidth', hint: offset ? 'stitch.borderWidth.hint' : 'stitch.lineWidth.hint', min: 0.8, max: Math.max(6, Math.ceil(st.width)), step: 0.1, get: () => st.width, set: (v) => change((s) => (s.width = v))(v), fmt: mm(1) });
    if (st.type === 'motif') {
      const motif = st.motif ?? 'waves';
      const fits = Math.round(motifMaxSize(motif, spacingOf(st)) * 10) / 10;
      out.look.push(
        this.choice<LineMotif>('stitch.lineMotif', LINE_MOTIFS, motif, (v) => `stitch.lineMotif.${v}` as Key, (v) => {
          st.motif = v;
          delete st.spacing;
          set(st);
        }, true),
        this.slider({
          label: 'stitch.lineMotifSize',
          hint: 'stitch.lineMotifSize.hint',
          min: 1,
          max: 8,
          step: 0.1,
          get: () => st.width,
          set: (v) => change((s) => (s.width = v))(v),
          fmt: mm(1),
          // Where the spacing caps the size, only the part below the cap makes a difference.
          ...(fits < 8 ? { band: [1, fits] as [number, number], bandHint: 'stitch.lineMotifSize.band' as Key } : {}),
        }),
        this.slider({ label: 'stitch.gap', hint: 'stitch.motifSpacing.hint', min: 1.5, max: 15, step: 0.1, get: () => spacingOf(st), set: (v) => change((s) => (s.spacing = v === MOTIF_PERIOD[motif] ? undefined : v))(v), fmt: mm(1), auto: unset('spacing') }),
      );
      if (SIDED_MOTIFS.includes(motif)) out.look.push(this.sideChoice(st, set, offset));
      const times = st.repeat === 3 || st.repeat === 5 ? (String(st.repeat) as '3' | '5') : '1';
      out.look.push(
        this.choice<(typeof REPEATS)[number]>('stitch.repeat', REPEATS, times, (v) => `stitch.repeat.${v}` as Key, (v) => {
          if (v === '1') delete st.repeat;
          else st.repeat = Number(v);
          set(st);
        }, true),
      );
      return out;
    }
    if (st.type === 'zigzag' || st.type === 'e') {
      const e = st.type === 'e';
      out.look.push(
        width,
        this.slider({ label: 'stitch.gap', hint: e ? 'stitch.eSpacing.hint' : 'stitch.zigzagSpacing.hint', min: e ? 1 : 0.5, max: 6, step: 0.1, get: () => spacingOf(st), set: (v) => change((s) => (s.spacing = v === (e ? E_SPACING : ZIGZAG_SPACING) ? undefined : v))(v), fmt: mm(1), auto: unset('spacing') }),
      );
      if (e) out.look.push(this.sideChoice(st, set, offset));
      return out;
    }
    out.look.push(
      width,
      this.slider({ label: 'stitch.density', hint: 'stitch.satinDensity.hint', min: 0.2, max: 1, step: 0.01, get: () => st.spacing ?? 0.4, set: (v) => change((s) => (s.spacing = v))(v), fmt: mm(2), auto: unset('spacing') }),
    );
    out.hold.push(
      this.slider({ label: 'stitch.borderPull', hint: 'stitch.borderPull.hint', min: 0, max: 0.6, step: 0.05, get: () => st.pull ?? 0, set: (v) => change((s) => (s.pull = v || undefined))(v), fmt: mm(2), auto: unset('pull') }),
      this.choice<UnderlayKind | 'off'>('stitch.under.kind', ['off', ...UNDERLAYS], autoUnder(st), (v) => (v === 'off' ? 'stitch.borderUnder.off' : (`stitch.under.${v}` as Key)), (v) => {
        st.under = v;
        set(st);
      }, true),
    );
    return out;
  }

  /** Which side an E stitch's prongs or a motif's figures are on: of a line right or left, of a border inside or outside. */
  private sideChoice(st: PathStitch, set: (v: PathStitch) => void, border: boolean): HTMLElement {
    const sides = border ? (['in', 'out'] as const) : (['right', 'left'] as const);
    return this.choice<(typeof sides)[number]>(st.type === 'e' ? 'stitch.eSide' : 'stitch.motifSide', sides, sides[st.flip ? 1 : 0], (v) => `stitch.eSide.${v}` as Key, (v) => {
      if (v === sides[1]) st.flip = true;
      else delete st.flip;
      set(st);
    }, true);
  }

  /** A fill's border, as a group of its own: what it is, its stitches, its thread. */
  private borderSection(s: FillSettings, extra: string): HTMLElement {
    const parts = this.pathStitch(
      s.border,
      (b) => {
        if (b) s.border = Object.assign(s.border ?? b, b);
        else {
          delete s.border;
          // An empty fill is its border: without it, it is filled again (and picking Empty gives a
          // fill a border).
          if (s.pattern === 'none') {
            s.pattern = 'tatami';
            this.group = null;
          }
        }
      },
      true,
      true,
    );
    const box = this.sec('border', 'stitches.sec.border', [parts.type, ...parts.look, ...parts.hold, s.border && s.pattern !== 'none' ? this.borderThread(s.border) : null], extra);
    box.title = t('stitch.border.intro');
    return this.lights(box, 'border');
  }

  /**
   * The border's thread: the fill's, or one of its own (then it is sewn as an object of its own in
   * that thread, right after the fill's color, and follows the fill's shape).
   */
  private borderThread(b: NonNullable<FillSettings['border']>): HTMLElement {
    const fill = this.info!.color;
    const now = b.color ?? fill;
    const btn = h('button', { type: 'button', class: 'border-thread', title: t('stitch.borderThread.hint') + (b.color ? ` ${t('stitch.borderThread.own')}` : '') });
    const sw = h('span', { class: 'sw' });
    if (now) sw.style.background = cssColor(now);
    btn.append(sw, b.color ? (b.color.name ?? hexColor(b.color)) : t('stitch.borderThread.same'));
    btn.addEventListener('click', () => {
      if (!fill) return;
      this.picker.toggle(btn, {
        key: 'border',
        title: t('stitch.borderThread'),
        current: now ?? fill,
        original: { color: fill, label: t('stitch.borderThread.same') },
        note: t('stitch.borderThread.note'),
        onPick: (c) => {
          if (sameColor(c, fill)) delete b.color;
          else {
            b.color = c;
            b.link ??= newLink();
          }
          this.render();
          this.changed(true);
        },
      });
    });
    return h('div', { class: 'field stitch-field border-field' }, h('span', { class: 'label' }, t('stitch.borderThread')), h('div', { class: 'border-row' }, btn));
  }

  private check(label: Key, hint: Key, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const i = h('input', { type: 'checkbox', checked: get() });
    i.addEventListener('change', () => {
      set(i.checked);
      this.changed(true);
    });
    return h('label', { class: 'check', title: t(hint) }, i, h('span', null, t(label)));
  }

  private light(what: Highlight | null): void {
    if (what === this.lit) return;
    this.lit = what;
    this.hooks.highlight(what);
  }

  /** Marks settings of the underlay: while the pointer or focus is on them, the underlay is shown on the canvas. */
  private under(el: HTMLElement): HTMLElement {
    return this.lights(el, 'under');
  }

  /** While the pointer or focus is on `el`, what it sets (`what`) is shown on the canvas. */
  private lights<E extends HTMLElement>(el: E, what: Highlight): E {
    el.classList.add(`lit-${what}`);
    el.addEventListener('pointerenter', () => this.light(what));
    el.addEventListener('pointerleave', () => {
      if (!el.contains(document.activeElement)) this.light(null);
    });
    el.addEventListener('focusin', () => this.light(what));
    el.addEventListener('focusout', (e) => {
      if (!el.contains(e.relatedTarget as Node | null) && !el.matches(':hover')) this.light(null);
    });
    return el;
  }
}
