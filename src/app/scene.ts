import type { FileList } from '../ui/fileList';
import type { TraceScene } from '../render/trace';
import type { FlatArea } from '../render/shapeOverlay';
import type { FlowScene } from '../render/scene';
import { flatten, type Form } from '../shape/path';
import type { FrameTool } from '../ui/frameTool';
import type { Highlight, StitchInfo } from '../ui/stitchPanel';
import type { LayersPanel } from '../ui/layersPanel';
import type { OrderCard } from '../ui/objectPanel';
import type { Player } from '../ui/player';
import type { Pt } from '../digitize/skeleton';
import type { RungTool } from '../ui/rungTool';
import type { Sequence } from './types';
import type { Settings } from '../settings';
import type { ShapeTool } from '../ui/shapeTool';
import { borderLines, type PathStitch } from '../model/along';
import { echoCopyLines, nearestCopy } from '../model/line';
import { borderRanges } from '../model/border';
import { borderOf, designObjects, remembered, underlayRanges, type RestitchResult, analyze, restitchedPieces } from '../model/restitch';
import { overlaps, type SewObject } from '../model/objects';
import { stitchNumbers, colorBlocks, markers as findMarkers, transitions, sewingSeconds, recordOfStitch, carriedJumps } from '../model/sequence';
import { type Pattern, TRIM, COLOR_CHANGE, STITCH, type ThreadColor } from '../model/pattern';
import { type StitchStyle, stitchColors, stitchAlpha } from '../render/flow';
import { ui } from './state';
import { wholeOf } from '../model/knockout';
import { guessArea, lineGeoOf, openOf, satinOutline } from '../model/geo';

/** What bindScene needs from the rest of the app. */
export interface SceneApp {
  readonly files: FileList;
  readonly frameTool: FrameTool;
  readonly layers: LayersPanel;
  readonly orderCard: OrderCard;
  readonly player: Player;
  readonly rungTool: RungTool;
  readonly settings: Settings;
  readonly shapeTool: ShapeTool;
  readonly stitchInfo: (p: Pattern, q: Sequence) => StitchInfo;
  readonly traceScene: () => TraceScene | null;
}

/**
 * What the canvas shows in the Ablauf mode, worked out from the pattern and cached per pattern: the
 * objects, which stitches are faded or hidden, the underlay and contour marks, and the player.
 */
export function bindScene(app: SceneApp) {
  const seqCache = new WeakMap<Pattern, Sequence>();
  function seq(p: Pattern): Sequence {
    let q = seqCache.get(p);
    if (q) return q;
    const numbers = stitchNumbers(p);
    const trimsAt: number[] = [];
    const colorsAt: number[] = [];
    let cut = true;
    for (let i = 0; i < p.cmd.length; i++) {
      if (p.cmd[i] === TRIM && !cut) trimsAt.push(numbers[i]);
      else if (p.cmd[i] === COLOR_CHANGE) colorsAt.push(numbers[i]);
      if (p.cmd[i] === TRIM) cut = true;
      else if (p.cmd[i] === STITCH) cut = false;
    }
    const { kinds, objects } = designObjects(p);
    const objectAt = new Int32Array(p.cmd.length).fill(-1);
    for (const o of objects) objectAt.fill(o.index, o.first, o.last + 1);
    q = {
      blocks: colorBlocks(p),
      kinds,
      objects,
      objectAt,
      markers: findMarkers(p),
      transitions: transitions(p),
      numbers,
      total: numbers.length ? numbers[numbers.length - 1] : 0,
      colors: {},
      trimsAt,
      colorsAt,
    };
    seqCache.set(p, q);
    return q;
  }

  let alphaCache: { p: Pattern; hidden: ReadonlySet<number>; focus: number | null; objects: ReadonlySet<number> | null; a: Float32Array } | null = null;
  let underCache: { p: Pattern; key: number; what: Highlight; mask: Uint8Array | null } | null = null;
  /** Nothing to pick: in the Ablauf mode the first click on the stitches chooses the object. */
  const NO_RANGE = { first: 0, last: -1 };
  /** One empty list, so the colors list is not rebuilt on every redraw (it compares by identity). */
  const NO_COLORS: readonly ThreadColor[] = [];

  const overOf = (q: Sequence, p: Pattern) => (q.over ??= overlaps(p, q.objects));

  function resetFlow(): void {
    ui.hiddenBlocks = new Set();
    ui.focusBlock = ui.hoverBlock = ui.selectedJump = ui.hoverJump = ui.hoverObject = ui.editObject = null;
    ui.selectedObjects = new Set();
    ui.selectionKey++;
    ui.flowPreview = null;
    app.layers.collapse();
    app.orderCard.close(false);
    app.player.pause();
    const p = app.files.active?.pattern;
    app.player.setModel(playerModel(p ?? null));
  }

  const count = (sorted: number[], k: number) => {
    let n = 0;
    for (const v of sorted) if (v <= k) n++;
    return n;
  };

  function playerModel(p: Pattern | null) {
    if (!p) return { total: 0, blockStarts: [], sections: [], timeAt: () => 0 };
    const q = seq(p);
    let at = 0;
    const sections = q.blocks.map((b) => {
      const start = at;
      at += b.stitches;
      return { start, end: at, color: `rgb(${b.color.r}, ${b.color.g}, ${b.color.b})` };
    });
    return {
      total: q.total,
      sections,
      blockStarts: q.markers.colorStarts.map((i) => q.numbers[i]),
      timeAt: (k: number) => sewingSeconds(k, count(q.trimsAt, k), count(q.colorsAt, k), app.settings),
    };
  }

  /** The underlay or the border of the selected objects, per record (null while it is not shown). */
  function underMask(p: Pattern): Uint8Array | null {
    if (!ui.highlight || !ui.selectedObjects.size || !app.settings.autoHighlight) return null;
    if (underCache?.p === p && underCache.key === ui.selectionKey && underCache.what === ui.highlight) return underCache.mask;
    const q = seq(p);
    const mask = new Uint8Array(p.cmd.length);
    if (ui.highlight !== 'under' && ui.highlight !== 'border') {
      partsMask(p, q, ui.highlight, mask);
      const any = mask.includes(1) ? mask : null;
      underCache = { p, key: ui.selectionKey, what: ui.highlight, mask: any };
      return any;
    }
    const r = ui.previewResult?.pattern === p ? ui.previewResult : null;
    if (r) {
      // A preview: the new stitches of each object, its first `under` of them.
      // A preview: the new stitches of each object, its first `under` of them, or the ones from
      // where its border starts.
      r.starts.forEach((a, k) => {
        const m = r.memory[k];
        const skip = m?.underFrom ?? 0;
        const [s, e] = ui.highlight === 'under' ? [skip + 1, skip + (m?.under ?? 0)] : [(m?.borderAt ?? Infinity) + 1, r.ends[k] - a];
        if (!(e >= s)) return;
        const from = recordOfStitch(q.numbers, a + s);
        const to = recordOfStitch(q.numbers, a + e);
        for (let i = from; i <= to; i++) mask[i] = 1;
      });
    } else {
      for (const o of ui.selectedObjects) {
        const obj = q.objects[o];
        if (!obj) continue;
        // A border of its own thread selected: it is all border.
        const own = ui.highlight === 'border' && remembered(p, obj)?.outline;
        const ranges = own ? [[obj.first, obj.last] as [number, number]] : ui.highlight === 'under' ? underlayRanges(p, obj, q.kinds) : borderRanges(p, q.objects, obj);
        for (const [a, b] of ranges) for (let i = a; i <= b; i++) mask[i] = 1;
      }
    }
    // Nothing to show (no underlay): the stitches stay as they are.
    const any = mask.includes(1) ? mask : null;
    underCache = { p, key: ui.selectionKey, what: ui.highlight, mask: any };
    return any;
  }

  /** Per pattern and object: the echo copy each record of it lies on (see nearestCopy). */
  const copyCache = new WeakMap<Pattern, Map<number, Int8Array>>();
  function copiesOf(p: Pattern, o: SewObject, form: Form, st: PathStitch): Int8Array {
    let byObject = copyCache.get(p);
    if (!byObject) copyCache.set(p, (byObject = new Map()));
    let k = byObject.get(o.index);
    if (!k) {
      const pts: Pt[] = [];
      for (let i = o.first; i <= o.last; i++) pts.push([p.x[i] / 10, p.y[i] / 10]);
      k = nearestCopy(echoCopyLines(form, st), pts);
      byObject.set(o.index, k);
    }
    return k;
  }

  /**
   * The stitches of the selected lines' echo copies (all, or copy n on either side) or shadows,
   * in the line itself and in the objects of copies or shadows in threads of their own.
   */
  function partsMask(p: Pattern, q: Sequence, what: Highlight, mask: Uint8Array): void {
    const only = what.startsWith('copy') && what !== 'copies' ? Number(what.slice(4)) : 0;
    const mark = (o: SewObject, form: Form, st: PathStitch) => {
      const k = copiesOf(p, o, form, st);
      for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH && (only ? Math.abs(k[i - o.first]) === only : k[i - o.first] !== 0)) mask[i] = 1;
    };
    for (const index of selectedIn(p)) {
      const o = q.objects[index];
      const m = o && remembered(p, o);
      const path = lineGeoOf(m);
      if (!m || !path || !m.line) continue;
      // A part selected on its own: its own stitches.
      if (m.shadowOf) {
        if (what === 'shadow') mask.fill(1, o.first, o.last + 1);
        continue;
      }
      const link = what === 'shadow' ? m.line.shadow?.link : m.line.echo?.link;
      if (what !== 'shadow' && m.line.echo) mark(o, path, m.line);
      if (!link) continue;
      for (const x of q.objects) {
        const xm = remembered(p, x);
        if (what === 'shadow' ? xm?.shadowOf === link : xm?.echoOf?.startsWith(`${link}:`) && lineGeoOf(xm) && xm.line) {
          if (what === 'shadow' || !only) mask.fill(1, x.first, x.last + 1);
          else mark(x, lineGeoOf(xm)!, xm!.line!);
        }
      }
    }
  }

  /** The line the border of each selected fill lies on (mm), while the border settings are pointed at. */
  let contourCache: { p: Pattern; key: number; r: RestitchResult | null; lines: Pt[][] | null } | null = null;
  function contourLines(p: Pattern): Pt[][] | null {
    const r = ui.previewResult?.pattern === p ? ui.previewResult : null;
    if (contourCache?.p === p && contourCache.key === ui.selectionKey && contourCache.r === r) return contourCache.lines;
    const q = seq(p);
    const out: Pt[][] = [];
    for (const o of ui.selectedObjects) {
      const obj = q.objects[o];
      const m = obj && remembered(p, obj);
      // A border of its own thread: on the area of the fill it was sewn on.
      if (m?.outline && m.region) {
        out.push(...borderLines(m.region, m.border?.offset ?? 0, null).map((l) => l.line));
        continue;
      }
      if (!obj || obj.kind !== 'fill') continue;
      // A fill read from the file: its area as recognized.
      const region = m?.region ?? analyze(p, obj, q.kinds).fill;
      if (!region) continue;
      // While a change is previewed, the border where it would go.
      const b = r ? borderOf(r.memory[0]) : borderOf(m);
      // Without the edges shapes on top cut: no border goes there.
      out.push(...borderLines(region, b?.offset ?? 0, wholeOf(region, m)).map((l) => l.line));
      // Along its open paths too.
      for (const path of openOf(m)?.paths ?? []) out.push(flatten(path));
    }
    contourCache = { p, key: ui.selectionKey, r, lines: out.length ? out : null };
    return contourCache.lines;
  }

  /**
   * The selected objects as numbered in `p`. In a preview the selected objects are sewn anew and can
   * come out in several pieces (trims inside): all of them count, as once the change is applied.
   */
  let selectedCache: { p: Pattern; r: RestitchResult; sel: ReadonlySet<number>; out: ReadonlySet<number> } | null = null;
  function selectedIn(p: Pattern): ReadonlySet<number> {
    const r = ui.previewResult?.pattern === p ? ui.previewResult : null;
    if (!r) return ui.selectedObjects;
    if (selectedCache?.p === p && selectedCache.r === r && selectedCache.sel === ui.selectedObjects) return selectedCache.out;
    const q = seq(p);
    const out = new Set(restitchedPieces(r, q.numbers, q.objectAt).flatMap((s) => [...s]));
    selectedCache = { p, r, sel: ui.selectedObjects, out };
    return out;
  }

  function styleFor(p: Pattern): StitchStyle {
    const q = seq(p);
    const rgb = (q.colors[app.settings.colorBy] ??= stitchColors(p, app.settings.colorBy, q.kinds));
    // Without auto highlight only a color picked in the list stands out.
    const auto = app.settings.autoHighlight;
    const focus = (auto ? ui.hoverBlock : null) ?? ui.focusBlock;
    // A hovered object wins over the selection, the selection over a highlighted color.
    const shown = !auto ? null : ui.hoverObject !== null ? new Set([ui.hoverObject]) : ui.selectedObjects.size ? selectedIn(p) : null;
    const under = ui.hoverObject === null ? underMask(p) : null;
    const objKey = shown && ui.hoverObject !== null ? `h${ui.hoverObject}` : under ? under : shown;
    if (alphaCache?.p !== p || alphaCache.hidden !== ui.hiddenBlocks || alphaCache.focus !== focus || (alphaCache.objects as unknown) !== objKey) {
      const a = stitchAlpha(p, ui.hiddenBlocks, shown ? null : focus);
      if (shown) {
        for (let i = 0; i < a.length; i++) if (a[i] > 0 && !shown.has(q.objectAt[i])) a[i] = 0.15;
      }
      // The underlay shown: the rows over it fade, so it can be seen through them. Echo copies or a
      // shadow shown: they stand out as a selected object does, the rest (the line too) fades as far.
      const fade = ui.highlight === 'under' || ui.highlight === 'border' ? 0.3 : 0.15;
      if (under) for (let i = 0; i < a.length; i++) if (a[i] === 1 && !under[i]) a[i] = fade;
      else if (under[i] && a[i] > 0) a[i] = 1;
      alphaCache = { p, hidden: ui.hiddenBlocks, focus, objects: objKey as ReadonlySet<number> | null, a };
    }
    const limit = app.player.complete ? p.cmd.length - 1 : recordOfStitch(q.numbers, app.player.pos);
    const carried = app.settings.marks.threads ? (q.carried ??= carriedJumps(p, q.transitions)) : null;
    return { rgb, alpha: alphaCache.a, limit, carried };
  }

  /**
   * Objects with a known shape, per pattern: drawn as flat areas in the view "Shapes instead of
   * stitches". Drawn lines come as their curves with how they are sewn, drawn in their width.
   */
  const shapeCache = new WeakMap<Pattern, { o: SewObject; form: Form; line?: PathStitch }[]>();
  function shapesOf(p: Pattern): { o: SewObject; form: Form; line?: PathStitch }[] {
    let list = shapeCache.get(p);
    if (!list) {
      const q = seq(p);
      list = [];
      for (const o of q.objects) {
        const known = remembered(p, o);
        // A line with an echo: the line and its copies (a shadow is an object of its own).
        const path = lineGeoOf(known);
        if (known && path && known.line && !known.lettering) {
          const form: Form = known.line.echo ? { paths: echoCopyLines(path, known.line).map((l) => polyline(l.line, l.closed)) } : path;
          list.push({ o, form, line: known.line });
          continue;
        }
        if (o.kind === 'satin') {
          const area = satinOutline(p, o, q.kinds);
          if (area) list.push({ o, form: area });
        }
        if (o.kind !== 'fill') continue;
        const form = guessArea(p, o, q.kinds);
        if (form?.paths.some((x) => x.closed)) list.push({ o, form });
      }
      shapeCache.set(p, list);
    }
    return list;
  }

  /** A path through points, straight from one to the next. */
  const polyline = (pts: Pt[], closed: boolean): Form['paths'][number] => ({ closed, nodes: (closed ? pts.slice(0, -1) : pts).map((p) => ({ p, a: p, b: p, smooth: false })) });

  /** How wide a line looks: running and triple stitch as thread, the others across their width. */
  function lineWidthMm(line: PathStitch, threadMm: number): number {
    if (line.type === 'run') return threadMm;
    if (line.type === 'triple') return threadMm * 1.6;
    return line.width + 2 * (line.pull ?? 0);
  }

  let flatAlpha: { from: Float32Array; a: Float32Array } | null = null;

  /** The style with the stitches of objects shown as areas left out, and those areas. */
  function asAreas(p: Pattern, style: StitchStyle): { style: StitchStyle; areas: FlatArea[] } {
    const list = shapesOf(p);
    if (flatAlpha?.from !== style.alpha) {
      const a = style.alpha.slice();
      for (const { o } of list) a.fill(0, o.first, o.last + 1);
      flatAlpha = { from: style.alpha, a };
    }
    const areas = list.filter(({ o }) => o.first <= style.limit).map(({ o, form, line }) => ({ form, color: o.color, alpha: style.alpha[o.first], ...(line ? { stroke: lineWidthMm(line, app.settings.threadMm) } : {}) }));
    return { style: { ...style, alpha: flatAlpha.a }, areas };
  }

  function flowScene(): FlowScene | null {
    const p = ui.flowPreview ?? app.files.active?.pattern;
    if (app.settings.mode !== 'flow' || !p) return null;
    const q = seq(p);
    const plain = styleFor(p);
    const flat = app.settings.shapesView ? asAreas(p, plain) : null;
    const style = flat?.style ?? plain;
    return {
      style,
      areas: flat?.areas ?? null,
      markers: q.markers,
      hover: ui.hoverJump !== null ? (q.transitions[ui.hoverJump] ?? null) : null,
      selected: ui.selectedJump !== null ? (q.transitions[ui.selectedJump] ?? null) : null,
      needle: app.player.complete ? -1 : style.limit,
      // The areas as recognized on the file itself, also while a change is previewed (not while
      // their shape is edited or the object is dragged: those show their own outline).
      outlines: app.files.active?.pattern && ui.selectedObjects.size && !app.shapeTool.active && app.frameTool.dragging === null ? app.stitchInfo(app.files.active.pattern, seq(app.files.active.pattern)).outlines : undefined,
      // Drawn over the stitches for the underlay and the border; echo copies and a shadow show as they are sewn.
      under: ui.hoverObject === null && (ui.highlight === 'under' || ui.highlight === 'border') ? underMask(p) : null,
      contour: ui.hoverObject === null && ui.highlight === 'border' && app.settings.autoHighlight ? contourLines(p) : null,
      rungs: app.rungTool.active ? app.rungTool : null,
      shape: app.shapeTool.active && app.frameTool.dragging === null ? { view: app.shapeTool, handles: app.shapeTool.handles() } : null,
      frame: app.frameTool.active ? { view: app.frameTool, mapped: app.frameTool.mappedCorners() } : null,
      band: ui.objectBand,
      trace: app.traceScene(),
    };
  }

  return { NO_COLORS, NO_RANGE, flowScene, overOf, playerModel, resetFlow, seq, seqCache, styleFor };
}
