import { formatNumber, t, type Key } from '../i18n';
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
import { autoUnder, type PathStitch } from '../model/along';
import { ECHO_COUNT, ECHO_DEFAULT, ECHO_GAP, ECHO_SIDES, type EchoSide } from '../digitize/echo';
import { SHADOW_COLOR, SHADOW_DEFAULT_DIST, SHADOW_DIRS, SHADOW_DIST, type ShadowDir } from '../model/shadow';
import { cssColor, hexColor, ThreadPicker } from './threadPicker';
import { CROSS_KINDS, GRID_KINDS, MOTIFS, type CrossKind, type GridKind, type Motif } from '../digitize/deco';

type FillUnder = 'off' | 'single' | 'cross';
const FILL_UNDERS: FillUnder[] = ['off', 'single', 'cross'];
type BorderChoice = 'off' | BorderType;
/** What hovering a group of settings shows on the canvas. */
export type Highlight = 'under' | 'border';
const BORDERS: BorderChoice[] = ['off', 'run', 'triple', 'satin'];
const sameColor = (a: ThreadColor, b: ThreadColor) => a.r === b.r && a.g === b.g && a.b === b.b;

/**
 * Stitch settings of the selected objects: per kind of stitch the values that matter for it. The
 * values start as measured on the first selected object; moving a slider shows the result on the
 * canvas at once, letting go applies it (one undo step).
 */

export interface StitchInfo {
  /** Changes when the user selects something else, so the values are measured again. */
  key: number;
  /** Kinds among the selected objects, and what the first object of each kind has now. */
  measured: Partial<{ fill: FillSettings; satin: SatinSettings; run: RunSettings }>;
  /** Recommended fill spacing for the material (mm). */
  recommended: [number, number];
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
  /** The one selected object is the border of a fill in its own thread (the fill's number, or null when gone). */
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
  /** Sews the selected objects of the other kind (fill to satin or satin to fill). */
  /** Sews the selection anew as another kind: fill or satin, a wide line as a fill and back. */
  convert: (to: 'fill' | 'satin' | 'line') => void;
  /** Rungs of a satin: the tool on or off, corners suggested, all removed, back to the stitches' own direction. */
  direction: (action: 'tool' | 'corners' | 'sections' | 'even' | 'follow' | 'rung' | 'cut') => void;
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
  open: ['meander', 'maze', 'grid', 'echo', 'cross'],
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

const TRUST_ICON = {
  ok: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  warn: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5l6 11H2z"/><path d="M8 6.5v3.2M8 11.8v.1"/></svg>',
};

/** Stitches loosed from their shape: a dashed shape beside free stitches. */
const FREE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1.5" y="1.5" width="8" height="8" rx="1.5" stroke-dasharray="2 2"/><path d="M7 14.5l2.5-4 2 3 3-5"/></svg>';

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
  /** The rung tools as last drawn. */
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
  ) {}

  update(info: StitchInfo | null): void {
    this.info = info;
    if (!info || !Object.keys(info.measured).length) {
      this.root.replaceChildren();
      this.key = -1;
      return;
    }
    if (info.key === this.key) {
      // The rung tool changes without a new selection: only its part is drawn anew.
      const tools = JSON.stringify([info.direction, info.draw, info.guide, info.knockout, info.free]);
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
    this.tools = JSON.stringify([info.direction, info.draw, info.guide, info.knockout, info.free]);
    const head = document.createElement('div');
    head.className = 'stitch-head';
    const h = Object.assign(document.createElement('h3'), { textContent: t('stitch.title') });
    head.append(h);
    const present = KINDS.filter((k) => info.measured[k]);
    const parts: HTMLElement[] = [head];
    if (present.length > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'segmented stitch-tabs';
      tabs.setAttribute('role', 'tablist');
      for (const k of present) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(k === this.kind));
        b.className = k === this.kind ? 'active' : '';
        b.innerHTML = `<span class="kind-icon">${KIND_ICON[k]}</span>`;
        b.append(kindLabel(k));
        b.addEventListener('click', () => {
          this.kind = k;
          this.hooks.preview(null);
          this.render();
        });
        tabs.append(b);
      }
      parts.push(tabs);
    } else {
      h.innerHTML = '';
      h.append(Object.assign(document.createElement('span'), { className: 'kind-icon', innerHTML: KIND_ICON[this.kind] }), t('stitch.titleOf', { kind: kindLabel(this.kind) }));
    }
    const n = info.counts[this.kind] ?? 0;
    if (info.outline) {
      // Its settings are the fill's: changed there, it follows.
      h.innerHTML = '';
      const of = info.outline.echo ? 'stitch.echoOf' : info.outline.shadow ? 'stitch.shadowOf' : info.outline.blend ? 'stitch.blendOf' : 'stitch.outline';
      h.append(Object.assign(document.createElement('span'), { className: 'kind-icon', innerHTML: KIND_ICON[this.kind] }), t(`${of}.title` as Key));
      const row = document.createElement('div');
      row.className = 'direction-buttons';
      if (info.outline.fill !== null) row.append(info.outline.shadow || info.outline.echo ? this.button('stitch.shadowOf.line', 'stitch.shadowOf.line.hint', () => this.hooks.outline('fill'), true) : this.button('stitch.outline.fill', 'stitch.outline.fill.hint', () => this.hooks.outline('fill'), true));
      row.append(this.button('stitch.outline.detach', `${of}.detach.hint` as Key, () => this.hooks.outline('detach')));
      parts.push(Object.assign(document.createElement('p'), { className: 'muted small', textContent: t(`${of}.text` as Key) }), row);
      this.picker.close();
      this.root.replaceChildren(...parts);
      return;
    }
    if (info.path && this.lineDraft && !info.free?.on) {
      parts.push(...this.lineGroup(h, info));
      if (info.free?.can) parts.push(this.looseRow());
      this.picker.close();
      this.root.replaceChildren(...parts);
      return;
    }
    if (n > 1) parts.push(Object.assign(document.createElement('p'), { className: 'muted small', textContent: t('stitch.many', { n }) }));
    if (this.kind === 'fill' && info.shape && !info.free?.on) {
      const trust = document.createElement('p');
      trust.className = `shape-trust ${info.shape}`;
      trust.setAttribute('role', 'status');
      trust.innerHTML = info.shape === 'approximate' ? TRUST_ICON.warn : TRUST_ICON.ok;
      trust.append(Object.assign(document.createElement('span'), { textContent: t(`stitch.shape.${info.shape}`) }));
      parts.push(trust);
    }
    if (info.hand) {
      const hand = document.createElement('p');
      hand.className = 'shape-trust approximate';
      hand.setAttribute('role', 'status');
      hand.innerHTML = TRUST_ICON.warn;
      hand.append(Object.assign(document.createElement('span'), { textContent: t('stitch.hand', { n: formatNumber(info.hand) }) }));
      parts.push(hand);
    }
    if (info.fixed?.length) {
      const fixed = document.createElement('p');
      fixed.className = 'muted small fixed-note';
      fixed.textContent = t('plan.fixed', { list: info.fixed.map(fixText).join(', ') });
      parts.push(fixed);
    }
    if (info.free?.on) {
      // Loosed stitches: no setting sews them anew, they are edited as stitches.
      parts.push(this.freeBlock(info.free.on), this.lockSwitch(info.lock));
      this.picker.close();
      this.root.replaceChildren(...parts);
      if (this.lit) this.light(null);
      return;
    }
    if (this.kind === 'fill' && info.knockout) parts.push(this.knockoutSwitch(info.knockout));
    if (this.kind === 'fill' && info.asLine) parts.push(this.kindSwitch('fill', ['fill', 'line']), ...this.lineFillControls());
    else if (this.kind === 'fill' || this.kind === 'satin') parts.push(this.kindSwitch(this.kind));
    // A fill along a line becomes satin by its line, not by rungs drawn across it.
    if (this.kind === 'fill' && info.draw?.single && !info.asLine) parts.push(this.drawTool(info.draw));
    if (this.kind === 'satin' && info.direction) parts.push(this.directionTool(info.direction));
    parts.push(...this.controls());
    parts.push(this.lockSwitch(info.lock));
    if (info.free?.can) parts.push(this.looseRow());
    const note = Object.assign(document.createElement('p'), { className: 'muted small stitch-note', textContent: t(this.kind === 'fill' && info.shape ? 'stitch.undo' : this.kind === 'run' && info.line ? 'stitch.lineNote' : 'stitch.note') });
    parts.push(note);
    this.picker.close();
    this.root.replaceChildren(...parts);
    // Its settings went away under the pointer (underlay off): nothing to show any more.
    if (this.lit && !this.root.querySelector(`.lit-${this.lit}`)) this.light(null);
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
  private lights(el: HTMLElement, what: Highlight): HTMLElement {
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

  private controls(): HTMLElement[] {
    const mm = (d: number) => (v: number) => `${formatNumber(v, d)} mm`;
    const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${formatNumber(Math.abs(v), 2)} mm`;
    if (this.kind === 'fill') {
      const s = this.draft.fill!;
      const density = (label: Key, get: () => number, set: (v: number) => void) =>
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
        });
      const out: HTMLElement[] = [this.patterns(s)];
      // An open pattern is one line: no density, edges or underlay to set.
      if (isOpenPattern(s.pattern)) {
        out.push(
          ...this.openControls(s),
          this.slider({ label: 'stitch.expand', hint: 'stitch.expand.hint', min: -3, max: 3, step: 0.05, get: () => s.expand ?? 0, set: (v) => (s.expand = v), fmt: signed }),
          this.borderGroup(s),
        );
        return out;
      }
      const d = this.deco(s);
      if (s.pattern === 'guided') out.push(this.guideTool(s, this.info!.guide));
      if (POINTED.includes(s.pattern)) out.push(this.pointTool(s, this.info!.points));
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
      } else out.push(density('stitch.density', () => s.spacing, (v) => (s.spacing = v)));
      // A gradient is where a color blend is looked for: the same action as in the object panel.
      if (s.pattern === 'gradient' && this.info!.blend) {
        const b: HTMLButtonElement = this.button(d.blend ? 'stitch.blend.change' : 'object.blend', 'object.blend.hint', () => this.hooks.blend(b));
        const row = Object.assign(document.createElement('div'), { className: 'direction-buttons' });
        row.append(b);
        out.push(row);
      }
      if (ANGLED.includes(s.pattern)) out.push(this.angle(s));
      if (s.pattern === 'waves') {
        out.push(
          this.slider({ label: 'stitch.waveHeight', hint: 'stitch.waveHeight.hint', min: 0.5, max: 8, step: 0.1, get: () => d.height ?? DECO_DEFAULTS.height, set: (v) => (d.height = v), fmt: mm(1) }),
          this.slider({ label: 'stitch.waveLength', hint: 'stitch.waveLength.hint', min: 6, max: 50, step: 0.5, get: () => d.length ?? DECO_DEFAULTS.length, set: (v) => (d.length = v), fmt: mm(1) }),
        );
      }
      if (s.pattern === 'grain') {
        out.push(
          this.slider({ label: 'stitch.grainStrength', hint: 'stitch.grainStrength.hint', min: 0.1, max: 1, step: 0.05, get: () => d.strength ?? DECO_DEFAULTS.strength, set: (v) => (d.strength = v), fmt: (v) => `${formatNumber(v * 100, 0)} %` }),
          this.reroll(s),
        );
      }
      if (s.pattern === 'swirl') out.push(this.reroll(s, true));
      out.push(this.slider({ label: 'stitch.length', hint: 'stitch.length.hint', min: 1.5, max: 7, step: 0.1, get: () => s.stitch, set: (v) => (s.stitch = v), fmt: mm(1) }));
      if (s.pattern === 'tatami') out.push(this.offsets(s), ...this.embossControls(s));
      // Straight rows cannot stray from their line; curved ones get shorter stitches in tight bends.
      if (CURVED.includes(s.pattern)) out.push(this.toleranceSlider(s));
      out.push(
        this.slider({ label: 'stitch.edge', hint: 'stitch.edge.hint', min: -0.4, max: 0.6, step: 0.05, get: () => s.edge, set: (v) => ((s.edge = v), delete s.edgeAuto), fmt: signed }),
        this.check('stitch.edgeAuto', 'stitch.edgeAuto.hint', () => !!s.edgeAuto, (v) => {
          const e = this.info!.fabricPull?.fill;
          if (v && e !== undefined) {
            s.edgeAuto = true;
            s.edge = e;
          } else delete s.edgeAuto;
          this.render();
        }),
        this.slider({ label: 'stitch.expand', hint: 'stitch.expand.hint', min: -3, max: 3, step: 0.05, get: () => s.expand ?? 0, set: (v) => (s.expand = v), fmt: signed }),
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
      );
      if (s.underlay) {
        out.push(this.under(this.check('stitch.underCover', 'stitch.underCover.hint', () => !!s.underCover, (v) => (v ? (s.underCover = true) : delete s.underCover))));
        out.push(
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
            }),
          ),
        );
      }
      out.push(this.borderGroup(s));
      return out;
    }
    if (this.kind === 'satin') {
      const s = this.draft.satin!;
      const e = s.type === 'e';
      const width = (label: Key, get: () => number, set: (v: number) => void) =>
        this.slider({ label, hint: 'stitch.width.hint', min: -3, max: 3, step: 0.05, get, set, fmt: signed });
      this.sides ||= s.edgeB !== undefined && s.edgeB !== s.edge;
      const out: HTMLElement[] = [
        this.choice<SatinType>('stitch.satinType', ['satin', 'e'], s.type ?? 'satin', (v) => `stitch.satinType.${v}` as Key, (v) => {
          s.type = v;
          // An E stitch has its stitches across a few mm apart, a satin a fraction of a mm.
          s.spacing = v === 'e' ? Math.max(s.spacing, 2.5) : Math.min(s.spacing, 0.4);
        }),
        e
          ? this.slider({ label: 'stitch.density', hint: 'stitch.eSpacing.hint', min: 1, max: 6, step: 0.1, get: () => s.spacing, set: (v) => (s.spacing = v), fmt: mm(1) })
          : this.slider({ label: 'stitch.density', hint: 'stitch.satinDensity.hint', min: 0.2, max: 1, step: 0.01, get: () => s.spacing, set: (v) => (s.spacing = v), fmt: mm(2), band: this.info!.recommended }),
      ];
      if (this.sides) {
        out.push(
          width('stitch.widthLeft', () => s.edge, (v) => ((s.edge = v), delete s.edgeAuto)),
          width('stitch.widthRight', () => s.edgeB ?? s.edge, (v) => ((s.edgeB = v), delete s.edgeAuto)),
        );
      } else out.push(width('stitch.width', () => s.edge, (v) => ((s.edge = v), delete s.edgeB, delete s.edgeAuto)));
      out.push(
        this.check('stitch.edgeAuto', 'stitch.edgeAuto.satin.hint', () => !!s.edgeAuto, (v) => {
          const e = this.info!.fabricPull?.satin;
          if (v && e) {
            s.edgeAuto = true;
            s.edge = e.edge;
            s.edgeShare = e.edgeShare;
            delete s.edgeB;
            this.sides = false;
          } else delete s.edgeAuto;
          this.render();
        }),
      );
      out.push(
        this.check('stitch.sides', 'stitch.sides.hint', () => this.sides, (v) => {
          this.sides = v;
          if (v) s.edgeB = s.edge;
          else delete s.edgeB;
          this.render();
        }),
        this.slider({
          label: 'stitch.widthShare',
          hint: 'stitch.widthShare.hint',
          min: 0,
          max: 0.2,
          step: 0.01,
          get: () => s.edgeShare ?? 0,
          set: (v) => ((s.edgeShare = v), delete s.edgeAuto),
          fmt: (v) => `+${formatNumber(v * 100, 0)} %`,
        }),
      );
      if (!e) out.push(this.check('stitch.short', 'stitch.short.hint', () => s.short, (v) => (s.short = v)));
      if (!e) out.push(this.check('stitch.byWidth', 'stitch.byWidth.hint', () => !!s.byWidth, (v) => (v ? (s.byWidth = true) : delete s.byWidth)));
      out.push(
        this.slider({ label: 'stitch.split', hint: 'stitch.split.hint', min: 4, max: SATIN_SPLIT, step: 0.5, get: () => s.split ?? SATIN_SPLIT, set: (v) => (s.split = v), fmt: mm(1) }),
        this.check('stitch.stagger', 'stitch.stagger.hint', () => s.stagger ?? true, (v) => (s.stagger = v)),
        this.under(
          this.check('stitch.underlay', 'stitch.underlay.satin', () => s.underlay, (v) => {
            s.underlay = v;
            this.render();
          }),
        ),
      );
      if (s.underlay) out.push(this.under(this.choice<UnderlayKind>('stitch.under.kind', UNDERLAYS, s.under ?? 'auto', (v) => `stitch.under.${v}` as Key, (v) => (s.under = v), true)));
      // Along the middle there is nothing to keep inside.
      if (s.underlay && s.under !== 'center') {
        out.push(
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
              ? this.slider({ label: 'stitch.underInset', hint: 'stitch.satinUnderInset.hint', min: 0, max: 3, step: 0.05, get: () => s.underInset ?? 0.4, set: (v) => (s.underInset = v), fmt: mm(2) })
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
      return out;
    }
    const s = this.draft.run!;
    return [
      this.slider({ label: 'stitch.length', hint: 'stitch.runLength.hint', min: 1, max: 6, step: 0.1, get: () => s.stitch, set: (v) => (s.stitch = v), fmt: mm(1) }),
      this.toleranceSlider(s),
      this.check('stitch.triple', 'stitch.triple.hint', () => s.triple, (v) => (s.triple = v)),
    ];
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

  /** Fill or satin: picking the other one sews the objects anew in that kind. */
  private kindSwitch(now: 'fill' | 'satin' | 'line', kinds: ('fill' | 'satin' | 'line')[] = ['fill', 'satin']): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'field stitch-field';
    const label = Object.assign(document.createElement('span'), { className: 'label', textContent: t('stitch.kind') });
    const row = document.createElement('div');
    row.className = 'segmented kind-switch';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('stitch.kind'));
    const blocked = now === 'fill' && kinds.includes('satin') && !this.info!.toSatin;
    for (const k of kinds) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = k === now ? 'active' : '';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(k === now));
      b.innerHTML = `<span class="kind-icon">${KIND_ICON[k === 'line' ? 'satin' : k]}</span>`;
      b.append(k === 'line' ? t('stitch.kind.line') : kindLabel(k));
      if (k !== now && k === 'satin' && blocked) {
        b.disabled = true;
        b.title = t('stitch.kind.noSatin');
      } else if (k !== now) b.title = t(k === 'satin' ? 'stitch.kind.toSatin' : k === 'line' ? 'stitch.kind.toLine' : now === 'line' ? 'stitch.kind.lineToFill' : 'stitch.kind.toFill');
      b.addEventListener('click', () => {
        if (k === now) return;
        this.hooks.preview(null);
        this.hooks.convert(k);
      });
      row.append(b);
    }
    wrap.append(label, row);
    if (blocked) wrap.append(Object.assign(document.createElement('span'), { className: 'muted small', textContent: t('stitch.kind.noSatin') }));
    return wrap;
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
      note: () => t('stitch.toleranceNote'),
    });
  }

  private slider(d: SliderDef): HTMLElement {
    const label = document.createElement('label');
    label.className = 'field stitch-field';
    if (d.hint) label.title = t(d.hint);
    const top = document.createElement('span');
    top.className = 'label';
    const out = document.createElement('output');
    top.append(t(d.label), ' ', out);
    const input = Object.assign(document.createElement('input'), { type: 'range', min: String(d.min), max: String(d.max), step: String(d.step), value: String(d.get()) });
    let track: HTMLElement = input;
    if (d.band) {
      // A green strip under the track marks the recommended range.
      const a = Math.max(0, ((d.band[0] - d.min) / (d.max - d.min)) * 100);
      const b = Math.min(100, ((d.band[1] - d.min) / (d.max - d.min)) * 100);
      track = Object.assign(document.createElement('span'), { className: 'band-track', title: t(d.bandHint ?? 'stitch.band', { a: formatNumber(d.band[0], 2), b: formatNumber(d.band[1], 2) }) });
      const band = Object.assign(document.createElement('span'), { className: 'band' });
      band.style.left = `${a}%`;
      band.style.width = `${Math.max(0, b - a)}%`;
      track.append(input, band);
    }
    const note = document.createElement('span');
    note.className = 'muted small';
    const show = () => {
      out.textContent = d.fmt(d.get());
      if (d.note) note.textContent = d.note(d.get());
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
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = Object.assign(document.createElement('span'), { className: 'label', textContent: t('stitch.pattern') });
    const now = tileOf(s);
    const group = this.group ?? groupOf(now);
    const tabs = document.createElement('div');
    tabs.className = 'pattern-groups';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', t('stitch.pattern'));
    for (const g of TILE_GROUPS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = (g === group ? 'active' : '') + (g === groupOf(now) ? ' holds' : '');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(g === group));
      b.textContent = t(`stitch.group.${g}` as Key);
      b.title = t(`stitch.group.${g}.hint` as Key);
      b.addEventListener('click', () => {
        if (g === group) return;
        this.group = g;
        this.render();
      });
      tabs.append(b);
    }
    const row = document.createElement('div');
    row.className = 'pattern-tiles';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t(`stitch.group.${group}` as Key));
    const apply = (to: FillSettings, tile: Tile) => {
      // Points belong to the pattern they were set for: rays and circles start anew in their place.
      // A fade and its second thread belong to the gradient: another pattern takes the second one out.
      const { focus: _f, centers: _c, fade: _d, blend: _b, ...rest } = to.deco ?? {};
      to.pattern = tile;
      to.deco = rest;
    };
    for (const tile of GROUPS[group]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pattern-tile' + (tile === now ? ' active' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(tile === now));
      b.title = t(`stitch.pattern.${tile}.hint` as Key);
      b.innerHTML = PATTERN_ICON[tile];
      b.append(Object.assign(document.createElement('span'), { textContent: t(`stitch.pattern.${tile}` as Key) }));
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
    const hint = Object.assign(document.createElement('span'), { className: 'muted small', textContent: t(`stitch.pattern.${now}.hint` as Key) });
    wrap.append(label, tabs, row, hint);
    return wrap;
  }

  /** The settings of decorative and open patterns, made when first set. */
  private deco(s: FillSettings): DecoSettings {
    return (s.deco ??= {});
  }

  /** A new random variant of grain, swirls, meander and maze; for swirls (`points`) new eyes too. */
  private reroll(s: FillSettings, points = false): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'field stitch-field reroll-row';
    const b = this.button('stitch.reroll', 'stitch.reroll.hint', () => {
      const d = this.deco(s);
      let seed = d.seed ?? DECO_DEFAULTS.seed;
      while (seed === (d.seed ?? DECO_DEFAULTS.seed)) seed = 1 + Math.floor(Math.random() * 99999);
      d.seed = seed;
      if (points) delete d.centers;
      this.changed(true);
    });
    b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="2.5"/><circle cx="5.5" cy="5.5" r=".9" fill="currentColor"/><circle cx="10.5" cy="10.5" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/></svg>';
    b.append(t('stitch.reroll'));
    wrap.append(b);
    return wrap;
  }

  /**
   * Embossing of a tatami: none or a motif drawn by the needle points (small pictures), and its
   * size when one is set.
   */
  private embossControls(s: FillSettings): HTMLElement[] {
    const d = this.deco(s);
    const wrap = document.createElement('div');
    wrap.className = 'field stitch-field';
    wrap.title = t('stitch.motif.hint');
    const head = Object.assign(document.createElement('span'), { className: 'label', textContent: t('stitch.motif') });
    const row = document.createElement('div');
    row.className = 'segmented motif-row';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('stitch.motif'));
    for (const m of [null, ...MOTIFS] as (Motif | null)[]) {
      const b = document.createElement('button');
      b.type = 'button';
      const on = (d.emboss ?? null) === m;
      b.className = on ? 'active' : '';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(on));
      const key = (m ? `stitch.motif.${m}` : 'stitch.motif.none') as Key;
      b.title = t(key);
      b.innerHTML = m ? MOTIF_ICON[m] : MOTIF_NONE;
      b.append(Object.assign(document.createElement('span'), { textContent: t(key) }));
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
    wrap.append(head, row);
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
      this.slider({ label: 'stitch.motifSize', hint: 'stitch.motifSize.hint', min: 4, max: 30, step: 0.5, get: () => d.embossSize ?? DECO_DEFAULTS.embossSize, set: (v) => (d.embossSize = v), fmt: (v) => `${formatNumber(v, 1)} mm` }),
    ];
  }

  /** Points of rays, circles and swirls: set and moved on the canvas with their tool. */
  private pointTool(s: FillSettings, d: StitchInfo['points']): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'field stitch-field direction-field' + (d?.tool ? ' on' : '');
    const head = Object.assign(document.createElement('span'), { className: 'label', textContent: t(`stitch.points.${s.pattern}` as Key) });
    wrap.append(head);
    if (!d?.single) {
      wrap.append(Object.assign(document.createElement('span'), { className: 'muted small', textContent: t('stitch.points.single') }));
      return wrap;
    }
    const row = document.createElement('div');
    row.className = 'direction-buttons';
    row.append(this.button(d.tool ? 'stitch.direction.done' : 'stitch.points.tool', 'stitch.points.tool.hint', () => this.hooks.points('tool'), !d.tool));
    wrap.append(row);
    if (d.tool) wrap.append(Object.assign(document.createElement('span'), { className: 'muted small', textContent: t(s.pattern === 'swirl' ? 'stitch.points.help.swirl' : 'stitch.points.help') }));
    return wrap;
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
      }),
    );
    if (pat !== 'cross') out.push(this.slider({ label: 'stitch.length', hint: 'stitch.openLength.hint', min: 1, max: 3, step: 0.1, get: () => Math.min(3, s.stitch), set: (v) => (s.stitch = v), fmt: (v) => `${formatNumber(v, 1)} mm` }));
    out.push(this.check('stitch.triple', 'stitch.openTriple.hint', () => !!d.triple, (v) => (d.triple = v)));
    if (pat === 'meander' || pat === 'maze') out.push(this.reroll(s));
    return out;
  }

  /** Tatami offset: how far the needle points shift from row to row. */
  private offsets(s: FillSettings): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'field stitch-field';
    wrap.title = t('stitch.offset.hint');
    const label = Object.assign(document.createElement('span'), { className: 'label', textContent: t('stitch.offset') });
    const row = document.createElement('div');
    row.className = 'segmented offset-buttons';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('stitch.offset'));
    const options: [number, string][] = [...OFFSETS, [0, t('stitch.offset.random')]];
    for (const [v, text] of options) {
      const b = document.createElement('button');
      b.type = 'button';
      const on = Math.abs(s.offset - v) < 1e-3;
      b.className = on ? 'active' : '';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(on));
      b.textContent = text;
      b.addEventListener('click', () => {
        if (Math.abs(s.offset - v) < 1e-3) return;
        s.offset = v;
        this.render();
        this.changed(true);
      });
      row.append(b);
    }
    wrap.append(label, row);
    return wrap;
  }

  /** Angle: a dial that shows the row direction, and a slider. */
  private angle(s: FillSettings): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'field stitch-field';
    wrap.title = t('stitch.angle.hint');
    const top = document.createElement('span');
    top.className = 'label';
    const out = document.createElement('output');
    top.append(t('stitch.angle'), ' ', out);
    const row = document.createElement('span');
    row.className = 'angle-row';
    const dial = document.createElement('span');
    dial.className = 'angle-dial';
    dial.setAttribute('aria-hidden', 'true');
    const needle = document.createElement('span');
    dial.append(needle);
    const input = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '175', step: '5', value: String(Math.round(s.angle / 5) * 5 % 180) });
    const show = () => {
      out.textContent = `${Math.round(s.angle)}°`;
      // Screen y points down, so the rows' angle turns clockwise.
      needle.style.transform = `rotate(${s.angle}deg)`;
    };
    show();
    input.addEventListener('input', () => {
      s.angle = parseFloat(input.value);
      show();
      this.changed(false);
    });
    input.addEventListener('change', () => this.changed(true));
    row.append(dial, input);
    wrap.append(top, row);
    return wrap;
  }

  /** A row of buttons, one per value; picking one applies it. With `hints`, each has `<label>.hint` as its title. */
  private choice<T extends string>(label: Key, values: readonly T[], now: T, text: (v: T) => Key, set: (v: T) => void, small = false, peek?: (v: T | null) => void): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'field stitch-field';
    const head = Object.assign(document.createElement('span'), { className: 'label', textContent: t(label) });
    const row = document.createElement('div');
    row.className = 'segmented choice-row' + (small ? ' small' : '');
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t(label));
    for (const v of values) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = v === now ? 'active' : '';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(v === now));
      b.textContent = t(text(v));
      b.title = t(`${text(v)}.hint` as Key);
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
    wrap.append(head, row);
    return wrap;
  }

  /** A small button for the rung tools. */
  private button(text: Key, hint: Key, on: () => void, primary = false, disabled = false): HTMLButtonElement {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: primary ? 'primary small' : 'small', textContent: t(text), title: t(hint), disabled });
    b.addEventListener('click', on);
    return b;
  }

  /** Direction of a satin: what sets it now, and the rung tool. */
  private directionTool(d: NonNullable<StitchInfo['direction']>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'field stitch-field direction-field' + (d.tool ? ' on' : '');
    const head = Object.assign(document.createElement('span'), { className: 'label', textContent: t('stitch.direction') });
    const state = d.rungs === null ? t('stitch.direction.follow') : d.rungs === 0 ? t('stitch.direction.even') : t(d.rungs === 1 ? 'stitch.direction.rungs.one' : 'stitch.direction.rungs', { n: d.rungs });
    const line = Object.assign(document.createElement('span'), { className: 'muted small', textContent: d.single ? state : t('stitch.direction.single') });
    wrap.append(head, line);
    if (!d.single) return wrap;
    const row = document.createElement('div');
    row.className = 'direction-buttons';
    row.append(this.button(d.tool ? 'stitch.direction.done' : 'stitch.direction.tool', 'stitch.direction.tool.hint', () => this.hooks.direction('tool'), !d.tool));
    if (d.tool) {
      row.append(
        this.button('stitch.direction.corners', 'stitch.direction.corners.hint', () => this.hooks.direction('corners')),
        this.button('stitch.sections', 'stitch.sections.hint', () => this.hooks.direction('sections')),
        this.button('stitch.direction.even.button', 'stitch.direction.even.hint', () => this.hooks.direction('even'), false, d.rungs === 0),
        this.button('stitch.direction.follow.button', 'stitch.direction.follow.hint', () => this.hooks.direction('follow'), false, d.rungs === null),
      );
    }
    wrap.append(row);
    if (d.tool) wrap.append(this.penSwitch(!!d.cutMode));
    if (d.cuts) wrap.append(Object.assign(document.createElement('span'), { className: 'small', textContent: t(d.cuts === 1 ? 'stitch.sections.count.one' : 'stitch.sections.count', { n: d.cuts + 1 }) }));
    if (d.tool && d.spacingHere !== undefined) wrap.append(this.spacingHereField(d.spacingHere));
    if (d.tool && d.chain) wrap.append(Object.assign(document.createElement('span'), { className: 'small', textContent: t('stitch.direction.chain') }));
    if (d.tool) wrap.append(Object.assign(document.createElement('span'), { className: 'muted small', textContent: t('stitch.direction.help') }));
    return wrap;
  }

  /** What a line drawn across the satin or the fill makes: a rung or a cut line. */
  private penSwitch(cut: boolean): HTMLElement {
    const l = Object.assign(document.createElement('div'), { className: 'pen-switch' });
    const row = document.createElement('div');
    row.className = 'segmented choice-row small';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('stitch.pen'));
    for (const v of ['rung', 'cut'] as const) {
      const on = (v === 'cut') === cut;
      const b = Object.assign(document.createElement('button'), { type: 'button', className: (on ? 'active ' : '') + 'pen-' + v, textContent: t(`stitch.pen.${v}`), title: t(`stitch.pen.${v}.hint`) });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(on));
      b.addEventListener('click', () => !on && this.hooks.direction(v));
      row.append(b);
    }
    l.append(Object.assign(document.createElement('span'), { className: 'small', textContent: t('stitch.pen') }), row);
    return l;
  }

  /** The spacing at the selected rung: empty keeps the column's. */
  private spacingHereField(v: number | null): HTMLElement {
    const l = Object.assign(document.createElement('label'), { className: 'spacing-here', title: t('stitch.spacingHere.hint') });
    const i = Object.assign(document.createElement('input'), { type: 'number', min: '0.2', max: '1.5', step: '0.05', placeholder: t('stitch.spacingHere.column'), value: v === null ? '' : String(v) });
    i.addEventListener('change', () => {
      const n = Number(i.value.replace(',', '.'));
      this.hooks.spacingHere(i.value.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : Math.min(1.5, Math.max(0.2, n)));
    });
    l.append(Object.assign(document.createElement('span'), { textContent: t('stitch.spacingHere') }), i, Object.assign(document.createElement('span'), { className: 'muted', textContent: 'mm' }));
    return l;
  }

  /** Guide lines of a guided fill: how many, and their tool. */
  private guideTool(s: FillSettings, d: StitchInfo['guide']): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'field stitch-field direction-field' + (d?.tool ? ' on' : '');
    const n = s.guides?.length ?? 0;
    const head = Object.assign(document.createElement('span'), { className: 'label', textContent: t('stitch.guide') });
    const line = Object.assign(document.createElement('span'), { className: 'muted small', textContent: n ? t(n === 1 ? 'stitch.guide.one' : 'stitch.guide.count', { n }) : t('stitch.guide.none') });
    wrap.append(head, line);
    if (!d?.single) return wrap;
    const row = document.createElement('div');
    row.className = 'direction-buttons';
    row.append(this.button(d.tool ? 'stitch.direction.done' : 'stitch.guide.tool', 'stitch.guide.tool.hint', () => this.hooks.guide('tool'), !d.tool));
    wrap.append(row);
    if (d.tool) wrap.append(Object.assign(document.createElement('span'), { className: 'muted small', textContent: t('stitch.guide.help') }));
    return wrap;
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

  /** Rungs drawn across a fill, to sew it as satin along them. */
  private drawTool(d: NonNullable<StitchInfo['draw']>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'field stitch-field direction-field' + (d.tool ? ' on' : '');
    if (!d.single) return wrap;
    const row = document.createElement('div');
    row.className = 'direction-buttons';
    if (!d.tool) row.append(this.button('stitch.draw', 'stitch.draw.hint', () => this.hooks.draw('tool')));
    else {
      row.append(
        this.button('stitch.draw.sew', 'stitch.draw.hint', () => this.hooks.draw('sew'), true, d.lines < (d.cuts ? 1 : 2)),
        this.button('stitch.draw.cancel', 'stitch.draw.hint', () => this.hooks.draw('tool')),
      );
    }
    wrap.append(row);
    if (d.tool) {
      wrap.append(
        this.penSwitch(!!d.cutMode),
        Object.assign(document.createElement('span'), { className: 'small', textContent: t('stitch.draw.count', { n: d.lines }) + (d.cuts ? ' ' + t('stitch.draw.parts') : '') }),
        Object.assign(document.createElement('span'), { className: 'muted small', textContent: t('stitch.draw.help') }),
      );
    }
    return wrap;
  }

  /** The way to loose the stitches from their shape. */
  private looseRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'direction-buttons free-row';
    row.append(this.button('free.loose', 'free.loose.hint', () => this.hooks.free(true)));
    return row;
  }

  /** Stitches loosed from their shape: what that means, and the way back. */
  private freeBlock(on: true | 'mixed'): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'free-block';
    const status = document.createElement('p');
    status.className = 'shape-trust free';
    status.setAttribute('role', 'status');
    status.innerHTML = FREE_ICON;
    status.append(Object.assign(document.createElement('span'), { textContent: t(on === 'mixed' ? 'free.someText' : 'free.text') }));
    const row = document.createElement('div');
    row.className = 'direction-buttons';
    row.append(this.button('free.back', 'free.back.hint', () => this.hooks.free(false)));
    if (on === 'mixed') row.append(this.button('free.looseAll', 'free.loose.hint', () => this.hooks.free(true)));
    wrap.append(status, row, Object.assign(document.createElement('p'), { className: 'muted small', textContent: t('free.edit') }));
    return wrap;
  }

  /** Left out of the correction: a switch, taken over at once. */
  private lockSwitch(on: boolean | 'mixed'): HTMLElement {
    const l = Object.assign(document.createElement('label'), { className: 'check lock-switch', title: t('plan.lock.hint') });
    const i = Object.assign(document.createElement('input'), { type: 'checkbox', checked: on === true, indeterminate: on === 'mixed' });
    i.addEventListener('change', () => this.hooks.lock(i.checked));
    l.append(i, Object.assign(document.createElement('span'), { textContent: t('plan.lock') }));
    return l;
  }

  /** A line: how it is sewn along its curve, for all kinds of stitch in one place. */
  private lineGroup(h: HTMLElement, info: StitchInfo): HTMLElement[] {
    const st = this.lineDraft!;
    h.innerHTML = '';
    h.append(Object.assign(document.createElement('span'), { className: 'kind-icon', innerHTML: KIND_ICON[st.type === 'satin' ? 'satin' : 'run'] }), t('stitch.line.title'));
    const out: HTMLElement[] = [];
    if (info.hand) {
      const hand = document.createElement('p');
      hand.className = 'shape-trust approximate';
      hand.setAttribute('role', 'status');
      hand.innerHTML = TRUST_ICON.warn;
      hand.append(Object.assign(document.createElement('span'), { textContent: t('stitch.hand', { n: formatNumber(info.hand) }) }));
      out.push(hand);
    }
    // A wide line can also be sewn as a fill of its area.
    if (st.type === 'satin' && !info.path!.traced) out.push(this.kindSwitch('line', ['line', 'fill']));
    out.push(
      ...this.pathStitch(
        st,
        (v) => {
          if (v) this.lineDraft = Object.assign(this.lineDraft ?? v, v);
        },
        false,
      ),
    );
    if (st.type !== 'satin') {
      st.tolerance ??= this.tolerance ?? TOLERANCE;
      out.push(this.toleranceSlider(st as { tolerance: number }));
    }
    out.push(this.echoGroup(st, info.path!.closed, info.path!.color));
    if (!info.path!.traced) out.push(this.shadowGroup(st, info.path!.color));
    out.push(Object.assign(document.createElement('p'), { className: 'muted small stitch-note', textContent: t(info.path!.traced ? 'stitch.lineTraced' : 'stitch.lineNote') }));
    return out;
  }

  /**
   * A line's shadow, as a block of its own: off, or where it falls, how far, in which thread. It is
   * an object of its own in that thread, sewn before the line (see model/shadow.ts).
   */
  private shadowGroup(st: PathStitch, line: ThreadColor): HTMLElement {
    const box = document.createElement('section');
    box.className = 'border-group shadow-group';
    const sh = st.shadow;
    box.append(
      Object.assign(document.createElement('h4'), { textContent: t('stitch.shadow') }),
      Object.assign(document.createElement('p'), { className: 'muted small', textContent: t('stitch.shadow.intro') }),
      this.choice<ShadowDir | 'off'>('stitch.shadow.dir', ['off', ...SHADOW_DIRS], sh?.dir ?? 'off', (v) => `stitch.shadow.${v}` as Key, (v) => {
        if (v === 'off') delete st.shadow;
        else st.shadow = sh ? { ...sh, dir: v } : { color: { ...SHADOW_COLOR }, link: newLink(), dir: v, dist: SHADOW_DEFAULT_DIST };
      }),
    );
    if (!sh) return box;
    box.append(this.slider({ label: 'stitch.shadow.dist', hint: 'stitch.shadow.dist.hint', min: SHADOW_DIST[0], max: SHADOW_DIST[1], step: 0.1, get: () => sh.dist, set: (v) => (sh.dist = v), fmt: (v) => `${formatNumber(v, 1)} mm` }));
    const wrap = document.createElement('div');
    wrap.className = 'field stitch-field border-field';
    const row = document.createElement('div');
    row.className = 'border-row';
    const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'border-thread', title: t('stitch.shadow.thread.hint') });
    const sw = Object.assign(document.createElement('span'), { className: 'sw' });
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
    row.append(btn);
    wrap.append(Object.assign(document.createElement('span'), { className: 'label', textContent: t('stitch.shadow.thread') }), row);
    box.append(wrap);
    return box;
  }

  /**
   * A thread for each copy of an echo, nearest first: the line's, or one of its own (then the
   * copies of that thread are an object of their own, linked to the line).
   */
  private echoThreads(e: NonNullable<PathStitch['echo']>, line: ThreadColor): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'field stitch-field border-field';
    wrap.title = t('stitch.echo.threads.hint');
    const row = document.createElement('div');
    row.className = 'border-row echo-threads';
    for (let k = 1; k <= e.count; k++) {
      if (e.skip?.includes(k)) continue;
      const own = e.colors?.[k - 1] ?? null;
      const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'border-thread', title: own ? (own.name ?? hexColor(own)) : t('stitch.echo.same') });
      const sw = Object.assign(document.createElement('span'), { className: 'sw' });
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
    wrap.append(Object.assign(document.createElement('span'), { className: 'label', textContent: t('stitch.echo.threads') }), row);
    return wrap;
  }

  /**
   * A line's echo, as a block of its own: off, or on which side, how many copies, how far apart.
   * A closed line has an outside and an inside; an open line one side or the other (which one is
   * left of its drawing direction is not to be seen, so the side is switched with a button).
   */
  private echoGroup(st: PathStitch, closed: boolean, line: ThreadColor): HTMLElement {
    const box = document.createElement('section');
    box.className = 'border-group echo-group';
    type Choice = EchoSide | 'off' | 'one';
    const now: Choice = !st.echo ? 'off' : closed || st.echo.side === 'both' ? st.echo.side : 'one';
    const values: Choice[] = closed ? ['off', ...ECHO_SIDES] : ['off', 'one', 'both'];
    box.append(
      Object.assign(document.createElement('h4'), { textContent: t('stitch.echo') }),
      Object.assign(document.createElement('p'), { className: 'muted small', textContent: t('stitch.echo.intro') }),
      this.choice<Choice>('stitch.echo.side', values, now, (v) => `stitch.echo.${v}` as Key, (v) => {
        if (v === 'off') delete st.echo;
        else st.echo = { ...(st.echo ?? ECHO_DEFAULT), side: v === 'one' ? (st.echo && st.echo.side !== 'both' ? st.echo.side : 'out') : v };
      }),
    );
    if (now === 'one') {
      const row = document.createElement('div');
      row.className = 'direction-buttons';
      row.append(
        this.button('stitch.echo.flip', 'stitch.echo.flip.hint', () => {
          st.echo!.side = st.echo!.side === 'out' ? 'in' : 'out';
          this.changed(true);
        }),
      );
      box.append(row);
    }
    const e = st.echo;
    if (!e) return box;
    // Satin columns side by side need their width.
    const least = st.type === 'satin' ? Math.min(ECHO_GAP[1], Math.round((st.width + 0.5) * 10) / 10) : ECHO_GAP[0];
    box.append(
      this.slider({ label: 'stitch.echo.count', hint: 'stitch.echo.count.hint', min: ECHO_COUNT[0], max: ECHO_COUNT[1], step: 1, get: () => e.count, set: (v) => (e.count = Math.round(v)), fmt: (v) => formatNumber(v) }),
      this.slider({ label: 'stitch.echo.gap', hint: 'stitch.echo.gap.hint', min: least, max: ECHO_GAP[1], step: 0.1, get: () => Math.max(least, e.gap), set: (v) => (e.gap = v), fmt: (v) => `${formatNumber(v, 1)} mm` }),
    );
    box.append(
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
    const wrap = document.createElement('div');
    wrap.className = 'knockout';
    const l = Object.assign(document.createElement('label'), { className: 'check', title: t('knockout.switch.hint') });
    const i = Object.assign(document.createElement('input'), { type: 'checkbox', checked: k.on === true, indeterminate: k.on === 'mixed' });
    i.addEventListener('change', () => this.hooks.knockout(i.checked));
    l.append(i, Object.assign(document.createElement('span'), { textContent: t('knockout.switch') }));
    wrap.append(l);
    if (!k.covered) wrap.append(Object.assign(document.createElement('span'), { className: 'muted small', textContent: t('knockout.nothingOnTop') }));
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
        }),
      );
    }
    return wrap;
  }

  /**
   * Settings of stitches along a line (see along.ts): the kind, Aus first when `off` is allowed,
   * then what that kind needs. The same fields for a fill's border and for a line of its own;
   * `offset` adds where the line lies to the edge (borders only).
   */
  pathStitch(st: PathStitch | undefined, set: (v: PathStitch | undefined) => void, off = true, offset = false): HTMLElement[] {
    const mm = (d: number) => (v: number) => `${formatNumber(v, d)} mm`;
    const kinds = off ? BORDERS : BORDERS.filter((v) => v !== 'off');
    const out = [
      this.choice<BorderChoice>('stitch.borderType', kinds, st?.type ?? 'off', (v) => `stitch.border.${v}` as Key, (v) => {
        set(v === 'off' ? undefined : { ...st, type: v, width: st?.width ?? BORDER_WIDTH });
      }),
    ];
    if (!st) return out;
    const change = (f: (s: PathStitch) => void) => (v: number) => {
      f(st);
      set(st);
      void v;
    };
    if (offset) {
      out.push(
        this.slider({
          label: 'stitch.borderOffset',
          hint: 'stitch.borderOffset.hint',
          min: -3,
          max: 3,
          step: 0.05,
          get: () => st.offset ?? 0,
          set: (v) => change((s) => (s.offset = v || undefined))(v),
          fmt: (v) => (v ? `${v > 0 ? '+' : '−'}${formatNumber(Math.abs(v), 2)} mm ${t(v > 0 ? 'stitch.borderOffset.out' : 'stitch.borderOffset.in')}` : t('stitch.borderOffset.edge')),
        }),
      );
    }
    if (st.type !== 'satin') {
      out.push(this.slider({ label: 'stitch.length', hint: 'stitch.runLength.hint', min: 1, max: 6, step: 0.1, get: () => st.length ?? BORDER_STITCH, set: (v) => change((s) => (s.length = v))(v), fmt: mm(1) }));
      return out;
    }
    out.push(
      this.slider({ label: offset ? 'stitch.borderWidth' : 'stitch.lineWidth', hint: offset ? 'stitch.borderWidth.hint' : 'stitch.lineWidth.hint', min: 0.8, max: Math.max(6, Math.ceil(st.width)), step: 0.1, get: () => st.width, set: (v) => change((s) => (s.width = v))(v), fmt: mm(1) }),
      this.slider({ label: 'stitch.density', hint: 'stitch.satinDensity.hint', min: 0.2, max: 1, step: 0.01, get: () => st.spacing ?? 0.4, set: (v) => change((s) => (s.spacing = v))(v), fmt: mm(2) }),
      this.slider({ label: 'stitch.borderPull', hint: 'stitch.borderPull.hint', min: 0, max: 0.6, step: 0.05, get: () => st.pull ?? 0, set: (v) => change((s) => (s.pull = v || undefined))(v), fmt: mm(2) }),
      this.choice<UnderlayKind | 'off'>('stitch.under.kind', ['off', ...UNDERLAYS], autoUnder(st), (v) => (v === 'off' ? 'stitch.borderUnder.off' : (`stitch.under.${v}` as Key)), (v) => {
        st.under = v;
        set(st);
      }, true),
    );
    return out;
  }

  /** A fill's border, as a block of its own: what it is, its stitches, its thread. */
  private borderGroup(s: FillSettings): HTMLElement {
    const box = document.createElement('section');
    box.className = 'border-group';
    box.append(
      Object.assign(document.createElement('h4'), { textContent: t('stitch.border') }),
      Object.assign(document.createElement('p'), { className: 'muted small', textContent: t('stitch.border.intro') }),
      ...this.pathStitch(
        s.border,
        (b) => {
          if (b) s.border = Object.assign(s.border ?? b, b);
          else delete s.border;
        },
        true,
        true,
      ),
    );
    if (s.border) box.append(this.borderThread(s.border));
    return this.lights(box, 'border');
  }

  /**
   * The border's thread: the fill's, or one of its own (then it is sewn as an object of its own in
   * that thread, right after the fill's color, and follows the fill's shape).
   */
  private borderThread(b: NonNullable<FillSettings['border']>): HTMLElement {
    const fill = this.info!.color;
    const wrap = document.createElement('div');
    wrap.className = 'field stitch-field border-field';
    const head = Object.assign(document.createElement('span'), { className: 'label', textContent: t('stitch.borderThread') });
    const row = document.createElement('div');
    row.className = 'border-row';
    const now = b.color ?? fill;
    const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'border-thread', title: t('stitch.borderThread.hint') });
    const sw = Object.assign(document.createElement('span'), { className: 'sw' });
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
    row.append(btn);
    wrap.append(head, row);
    if (b.color) wrap.append(Object.assign(document.createElement('span'), { className: 'muted small', textContent: t('stitch.borderThread.own') }));
    return wrap;
  }

  private check(label: Key, hint: Key, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const l = Object.assign(document.createElement('label'), { className: 'check', title: t(hint) });
    const i = Object.assign(document.createElement('input'), { type: 'checkbox', checked: get() });
    i.addEventListener('change', () => {
      set(i.checked);
      this.changed(true);
    });
    l.append(i, Object.assign(document.createElement('span'), { textContent: t(label) }));
    return l;
  }
}
