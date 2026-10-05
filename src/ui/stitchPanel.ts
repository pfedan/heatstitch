import { formatNumber, t, type Key } from '../i18n';
import type { ObjectKind } from '../model/objects';
import { SATIN_SPLIT, UNDERLAYS, type FillPattern, type FillSettings, type RunSettings, type SatinSettings, type SatinType, type Settings, type ShapeTrust } from '../model/restitch';
import type { UnderlayKind } from '../digitize/satin';
import type { ShapeOutline } from '../render/scene';
import { UNDERLAY_INSET } from '../digitize/fill';
import type { Pt } from '../digitize/skeleton';
import { KIND_ICON, kindLabel } from './layersPanel';
import { BORDER_STITCH, BORDER_WIDTH, type BorderType } from '../digitize/border';
import { TOLERANCE } from '../digitize/run';
import type { ThreadColor } from '../model/pattern';
import { newLink } from '../model/border';
import { autoUnder, type PathStitch } from '../model/along';
import { cssColor, hexColor, ThreadPicker } from './threadPicker';

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
  direction?: { tool: boolean; rungs: number | null; single: boolean };
  /** Rungs drawn across the one selected fill to sew it as satin. */
  draw?: { tool: boolean; lines: number; single: boolean };
  /** Guide lines of the one selected fill: whether their tool is on. */
  guide?: { tool: boolean; single: boolean };
  /**
   * Fills with their shape as curves: whether they leave out what later fills cover (`mixed` when
   * only some do), and whether anything lies on top of them at all.
   */
  knockout?: { on: boolean | 'mixed'; covered: boolean };
  /** The selected running stitches are lines sewn along their curves. */
  line?: boolean;
  /**
   * The one selected object is a line (drawn, from an SVG, or a running stitch of a file): how it
   * is sewn along its curve. `traced`: its curve is read from its stitches (none was drawn).
   */
  path?: { st: PathStitch; traced: boolean };
  /** Thread of the first selected fill (its border is sewn in it unless it has its own). */
  color?: ThreadColor;
  /** The one selected object is the border of a fill in its own thread (the fill's number, or null when gone). */
  outline?: { fill: number | null };
}

export interface StitchHooks {
  preview: (s: Settings | null) => void;
  apply: (s: Settings) => void;
  /** Sews the selected objects of the other kind (fill to satin or satin to fill). */
  convert: (to: 'fill' | 'satin') => void;
  /** Rungs of a satin: the tool on or off, corners suggested, all removed, back to the stitches' own direction. */
  direction: (action: 'tool' | 'corners' | 'even' | 'follow') => void;
  /** Rungs drawn across a fill: the tool on or off, sewn as satin along them. */
  draw: (action: 'tool' | 'sew') => void;
  /** Guide lines on a fill: their tool on or off (`off` only closes it). */
  guide: (action: 'tool' | 'off') => void;
  /** Leaving out what later fills cover, on or off for the selected fills. */
  knockout: (on: boolean) => void;
  /**
   * The pointer or focus on the underlay settings ('under') or on the border settings ('border'),
   * or away from both (null): what they set is shown on the canvas.
   */
  highlight: (what: Highlight | null) => void;
  /** The one selected line sewn with `st`: shown while sliding (`final` false), then applied. */
  line: (st: PathStitch, final: boolean) => void;
  /** A border object: select its fill, or make it an object of its own (no longer following the fill). */
  outline: (action: 'fill' | 'detach') => void;
}

const KINDS: ObjectKind[] = ['fill', 'satin', 'run'];

const PATTERNS: FillPattern[] = ['tatami', 'gradient', 'contour', 'spiral', 'follow', 'guided'];

/** Small pictures of the fill patterns (24 × 24, drawn with the current color). */
const PATTERN_ICON: Record<FillPattern, string> = {
  tatami: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5h7m3 0h8M3 9.5h4m3 0h11M3 14h9m3 0h6M3 18.5h2m3 0h13"/></svg>',
  gradient: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 3.5h18M3 6h18M3 9h18M3 13h18M3 18.5h18"/></svg>',
  contour: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="5"/><rect x="7" y="7" width="10" height="10" rx="2.5"/><path d="M11 11h2v2h-2z"/></svg>',
  spiral: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 12c0-1 1.5-1.2 2-.2.8 1.6-1 3.2-2.6 3-2.6-.3-3.4-3.6-1.8-5.6 2.2-2.8 6.6-1.8 7.6 1.4 1.3 4-2.2 7.6-6 7.2-4.4-.4-7-5-5.6-9C7 5 11.6 3 15.6 4.2"/></svg>',
  follow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 6c5-3 9 3 18 0M3 11c5-3 9 3 18 0M3 16c5-3 9 3 18 0M3 21c5-3 9 3 18 0"/></svg>',
  guided: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path stroke-width="1.2" opacity=".6" d="M4 4c3 0 5 5 8 5s5-4 8-4M4 15c3 0 5 5 8 5s5-4 8-4"/><path stroke-width="2.4" d="M4 9.5c3 0 5 5 8 5s5-4 8-4"/></svg>',
};

const TRUST_ICON = {
  ok: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  warn: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5l6 11H2z"/><path d="M8 6.5v3.2M8 11.8v.1"/></svg>',
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
  /** Extra line under the value. */
  note?: (v: number) => string;
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
      const tools = JSON.stringify([info.direction, info.draw, info.guide, info.knockout]);
      if (tools !== this.tools) this.render();
      return;
    }
    this.key = info.key;
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
    this.tools = JSON.stringify([info.direction, info.draw, info.guide, info.knockout]);
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
      h.append(Object.assign(document.createElement('span'), { className: 'kind-icon', innerHTML: KIND_ICON[this.kind] }), t('stitch.outline.title'));
      const row = document.createElement('div');
      row.className = 'direction-buttons';
      if (info.outline.fill !== null) row.append(this.button('stitch.outline.fill', 'stitch.outline.fill.hint', () => this.hooks.outline('fill'), true));
      row.append(this.button('stitch.outline.detach', 'stitch.outline.detach.hint', () => this.hooks.outline('detach')));
      parts.push(Object.assign(document.createElement('p'), { className: 'muted small', textContent: t('stitch.outline.text') }), row);
      this.picker.close();
      this.root.replaceChildren(...parts);
      return;
    }
    if (info.path && this.lineDraft) {
      parts.push(...this.lineGroup(h, info));
      this.picker.close();
      this.root.replaceChildren(...parts);
      return;
    }
    if (n > 1) parts.push(Object.assign(document.createElement('p'), { className: 'muted small', textContent: t('stitch.many', { n }) }));
    if (this.kind === 'fill' && info.shape) {
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
    if (this.kind === 'fill' && info.knockout) parts.push(this.knockoutSwitch(info.knockout));
    if (this.kind === 'fill' || this.kind === 'satin') parts.push(this.kindSwitch(this.kind));
    if (this.kind === 'fill' && info.draw?.single) parts.push(this.drawTool(info.draw));
    if (this.kind === 'satin' && info.direction) parts.push(this.directionTool(info.direction));
    parts.push(...this.controls());
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
      if (s.pattern === 'guided') out.push(this.guideTool(s, this.info!.guide));
      if (s.pattern === 'gradient') {
        out.push(
          density('stitch.densityFrom', () => s.spacing, (v) => (s.spacing = v)),
          density('stitch.densityTo', () => s.spacingEnd, (v) => (s.spacingEnd = v)),
        );
      } else out.push(density('stitch.density', () => s.spacing, (v) => (s.spacing = v)));
      if (s.pattern === 'tatami' || s.pattern === 'gradient') out.push(this.angle(s));
      out.push(this.slider({ label: 'stitch.length', hint: 'stitch.length.hint', min: 1.5, max: 7, step: 0.1, get: () => s.stitch, set: (v) => (s.stitch = v), fmt: mm(1) }));
      if (s.pattern === 'tatami') out.push(this.offsets(s));
      // Straight rows cannot stray from their line; curved ones get shorter stitches in tight bends.
      if (s.pattern === 'contour' || s.pattern === 'spiral' || s.pattern === 'follow') out.push(this.toleranceSlider(s));
      out.push(
        this.slider({ label: 'stitch.edge', hint: 'stitch.edge.hint', min: -0.4, max: 0.6, step: 0.05, get: () => s.edge, set: (v) => (s.edge = v), fmt: signed }),
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
              ? this.slider({ label: 'stitch.underInset', hint: 'stitch.underInset.hint', min: 0, max: 1.5, step: 0.05, get: () => s.underInset ?? UNDERLAY_INSET, set: (v) => (s.underInset = v), fmt: mm(2) })
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
          width('stitch.widthLeft', () => s.edge, (v) => (s.edge = v)),
          width('stitch.widthRight', () => s.edgeB ?? s.edge, (v) => (s.edgeB = v)),
        );
      } else out.push(width('stitch.width', () => s.edge, (v) => ((s.edge = v), delete s.edgeB)));
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
          set: (v) => (s.edgeShare = v),
          fmt: (v) => `+${formatNumber(v * 100, 0)} %`,
        }),
      );
      if (!e) out.push(this.check('stitch.short', 'stitch.short.hint', () => s.short, (v) => (s.short = v)));
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
      return out;
    }
    const s = this.draft.run!;
    return [
      this.slider({ label: 'stitch.length', hint: 'stitch.runLength.hint', min: 1, max: 6, step: 0.1, get: () => s.stitch, set: (v) => (s.stitch = v), fmt: mm(1) }),
      this.toleranceSlider(s),
      this.check('stitch.triple', 'stitch.triple.hint', () => s.triple, (v) => (s.triple = v)),
    ];
  }

  /** Fill or satin: picking the other one sews the objects anew in that kind. */
  private kindSwitch(now: 'fill' | 'satin'): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'field stitch-field';
    const label = Object.assign(document.createElement('span'), { className: 'label', textContent: t('stitch.kind') });
    const row = document.createElement('div');
    row.className = 'segmented kind-switch';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('stitch.kind'));
    const blocked = now === 'fill' && !this.info!.toSatin;
    for (const k of ['fill', 'satin'] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = k === now ? 'active' : '';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(k === now));
      b.innerHTML = `<span class="kind-icon">${KIND_ICON[k]}</span>`;
      b.append(kindLabel(k));
      if (k !== now && k === 'satin' && blocked) {
        b.disabled = true;
        b.title = t('stitch.kind.noSatin');
      } else if (k !== now) b.title = t(k === 'satin' ? 'stitch.kind.toSatin' : 'stitch.kind.toFill');
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
      track = Object.assign(document.createElement('span'), { className: 'band-track', title: t('stitch.band', { a: formatNumber(d.band[0], 2), b: formatNumber(d.band[1], 2) }) });
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
      this.changed(false);
    });
    input.addEventListener('change', () => this.changed(true));
    label.append(top, track);
    if (d.note) label.append(note);
    return label;
  }

  /** The fill patterns as small pictures; picking one applies it. */
  private patterns(s: FillSettings): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = Object.assign(document.createElement('span'), { className: 'label', textContent: t('stitch.pattern') });
    const row = document.createElement('div');
    row.className = 'pattern-tiles';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('stitch.pattern'));
    for (const pat of PATTERNS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pattern-tile' + (pat === s.pattern ? ' active' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(pat === s.pattern));
      b.title = t(`stitch.pattern.${pat}.hint` as Key);
      b.innerHTML = PATTERN_ICON[pat];
      b.append(Object.assign(document.createElement('span'), { textContent: t(`stitch.pattern.${pat}` as Key) }));
      // Guide lines belong to one object.
      const blocked = pat === 'guided' && !this.info!.guide?.single;
      if (blocked) {
        b.disabled = true;
        b.title = t('stitch.guide.single');
      }
      b.addEventListener('click', () => {
        if (s.pattern === pat) return;
        s.pattern = pat;
        this.render();
        // Without guide lines there is nothing to follow yet: their tool opens, and the stitches
        // change with the first line.
        if (pat === 'guided' && !s.guides?.length) return this.hooks.guide('tool');
        if (pat !== 'guided' && this.info!.guide?.tool) this.hooks.guide('off');
        this.changed(true);
      });
      row.append(b);
    }
    const hint = Object.assign(document.createElement('span'), { className: 'muted small', textContent: t(`stitch.pattern.${s.pattern}.hint` as Key) });
    wrap.append(label, row, hint);
    return wrap;
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
        this.button('stitch.direction.even.button', 'stitch.direction.even.hint', () => this.hooks.direction('even'), false, d.rungs === 0),
        this.button('stitch.direction.follow.button', 'stitch.direction.follow.hint', () => this.hooks.direction('follow'), false, d.rungs === null),
      );
    }
    wrap.append(row);
    if (d.tool) wrap.append(Object.assign(document.createElement('span'), { className: 'muted small', textContent: t('stitch.direction.help') }));
    return wrap;
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
        this.button('stitch.draw.sew', 'stitch.draw.hint', () => this.hooks.draw('sew'), true, d.lines < 2),
        this.button('stitch.draw.cancel', 'stitch.draw.hint', () => this.hooks.draw('tool')),
      );
    }
    wrap.append(row);
    if (d.tool) {
      wrap.append(
        Object.assign(document.createElement('span'), { className: 'small', textContent: t('stitch.draw.count', { n: d.lines }) }),
        Object.assign(document.createElement('span'), { className: 'muted small', textContent: t('stitch.draw.help') }),
      );
    }
    return wrap;
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
    out.push(Object.assign(document.createElement('p'), { className: 'muted small stitch-note', textContent: t(info.path!.traced ? 'stitch.lineTraced' : 'stitch.lineNote') }));
    return out;
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
      this.slider({ label: offset ? 'stitch.borderWidth' : 'stitch.lineWidth', hint: offset ? 'stitch.borderWidth.hint' : 'stitch.lineWidth.hint', min: 0.8, max: 6, step: 0.1, get: () => st.width, set: (v) => change((s) => (s.width = v))(v), fmt: mm(1) }),
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
