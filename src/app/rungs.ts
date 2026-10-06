import type { Editor } from '../ui/editor';
import type { FileList } from '../ui/fileList';
import type { LayersPanel } from '../ui/layersPanel';
import type { Pattern } from '../model/pattern';
import type { Pt } from '../digitize/skeleton';
import type { Sequence } from './types';
import type { Settings } from '../settings';
import type { StitchInfo, StitchPanel } from '../ui/stitchPanel';
import { RungTool } from '../ui/rungTool';
import { outline } from '../digitize/region';
import { atShare, regionBox, swirlCenters } from '../digitize/deco';
import { inside, railsFromOutline, stripsOfOutline } from '../digitize/rungs';
import { t, type Key } from '../i18n';
import { DECO_DEFAULTS, MAX_SWIRLS, type FillSettings, type Rails, type SatinSettings, analyze, remembered, keepShape, remember, restitch, measureSatin, forget, type RestitchResult, type Settings as RestitchSettings } from '../model/restitch';
import { ui } from './state';

/** What bindRungs needs from the rest of the app. */
export interface RungsApp {
  readonly applyRestitched: (r: RestitchResult | null, failed: Key, remeasure?: boolean) => void;
  readonly convertSettings: (to: 'fill' | 'satin', info: StitchInfo) => RestitchSettings | null;
  readonly editor: Editor;
  readonly files: FileList;
  readonly layers: LayersPanel;
  readonly redraw: () => void;
  readonly seq: (p: Pattern) => Sequence;
  readonly setEditing: (on: boolean) => void;
  readonly settings: Settings;
  readonly stage: HTMLElement;
  readonly stitchInfo: (p: Pattern, q: Sequence) => StitchInfo;
  readonly stitchPanel: StitchPanel;
}

/** The rung tool: satin columns drawn and edited by their rungs, and the guides that go with them. */
export function bindRungs(app: RungsApp) {
  let rungPattern: Pattern | null = null;

  const rungTool = new RungTool({
    change: (columns, final) => {
      if (final) applyRungs(columns);
      else if (!rungFrame) {
        rungFrame = requestAnimationFrame(() => {
          rungFrame = 0;
          ui.flowPreview = rungTool.active ? (withRungs(rungTool.mode === 'satin' ? pendingColumns : null)?.pattern ?? null) : null;
          app.redraw();
        });
      }
      if (!final) pendingColumns = columns;
    },
    lines: () => app.redraw(),
    guides: (g) => app.stitchPanel.setGuides(g),
    points: (pts) => {
      // Kept as shares of the shape's extent, so they move with it (see transformRemembered).
      const box = pointsBox();
      if (!box) return;
      const share = (v: number, lo: number, hi: number) => Math.round(Math.min(1, Math.max(0, hi > lo ? (v - lo) / (hi - lo) : 0.5)) * 1000) / 1000;
      app.stitchPanel.setPoints(pts.map((q) => [share(q[0], box[0], box[2]), share(q[1], box[1], box[3])] as Pt));
    },
    redraw: () => app.redraw(),
    say: (key) => {
      app.layers.say(t(key), true);
      app.redraw();
    },
  });
  let rungFrame = 0;
  let pendingColumns: Rails[][] | null = null;

  /** The one selected object, if the rung tool can work on it: a satin with columns, or a fill with an area. */
  function rungTarget(p: Pattern, q: Sequence): { o: number; mode: 'satin' | 'fill' } | null {
    if (app.settings.mode !== 'flow' || ui.selectedObjects.size !== 1) return null;
    const o = [...ui.selectedObjects][0];
    const obj = q.objects[o];
    if (!obj) return null;
    const an = analyze(p, obj, q.kinds);
    if (an.parts.some((pt) => pt.kind === 'satin')) return { o, mode: 'satin' };
    if (an.fill) return { o, mode: 'fill' };
    return null;
  }

  /** What the stitch panel shows about the rung tool. */
  function rungInfo(p: Pattern, q: Sequence): Pick<StitchInfo, 'direction' | 'draw' | 'guide' | 'points'> {
    const single = ui.selectedObjects.size === 1;
    const on = rungTool.active && ui.rungObject !== null && ui.selectedObjects.has(ui.rungObject);
    const out: Pick<StitchInfo, 'direction' | 'draw' | 'guide' | 'points'> = {};
    const info = app.stitchInfo(p, q);
    if (info.measured.satin) {
      let rungs: number | null = null;
      if (on && rungTool.mode === 'satin') rungs = rungTool.count;
      else if (single) {
        const cols = remembered(p, q.objects[[...ui.selectedObjects][0]])?.columns?.flat() ?? [];
        rungs = cols.some((c) => c.rungs) ? cols.reduce((a, c) => a + (c.rungs?.length ?? 0), 0) : null;
      }
      if (!on || rungTool.mode !== 'satin') {
        // Free rungs count as rungs.
        if (single && rungs !== null) rungs += (remembered(p, q.objects[[...ui.selectedObjects][0]])?.columns?.flat() ?? []).reduce((a, c) => a + (c.spans?.length ?? 0), 0);
      }
      let cuts = 0;
      if (on && rungTool.mode === 'satin') cuts = rungTool.columns.reduce((a, c) => a + c.cuts.length, 0);
      else if (single) cuts = (remembered(p, q.objects[[...ui.selectedObjects][0]])?.columns?.flat() ?? []).reduce((a, c) => a + (c.cuts?.length ?? 0), 0);
      const here = on && rungTool.mode === 'satin' ? rungTool.spacingHere : undefined;
      out.direction = { tool: on && rungTool.mode === 'satin', rungs, single, cuts, cutMode: rungTool.cutMode, chain: on && rungTool.badges.length > 0, ...(here !== undefined ? { spacingHere: here } : {}) };
    }
    if (info.measured.fill && !info.measured.satin) out.draw = { tool: on && rungTool.mode === 'fill', lines: on ? rungTool.lines.length : 0, single, cuts: on ? rungTool.cutLines.length : 0, cutMode: rungTool.cutMode };
    if (info.measured.fill) out.guide = { tool: on && rungTool.mode === 'guide', single };
    if (info.measured.fill) out.points = { tool: on && rungTool.mode === 'points', single };
    return out;
  }

  /** Outline of the one selected object's fill (its longest loop), or null when it has no fill. */
  function fillLoop(p: Pattern, q: Sequence, o: number): Pt[] | null {
    const obj = q.objects[o];
    const an = obj && analyze(p, obj, q.kinds);
    if (!an?.fill) return null;
    const area = remembered(p, obj)?.shape ?? an.fill;
    const loops = outline(area);
    return loops.reduce((a, b) => (b.length > a.length ? b : a), [] as [number, number][]) as Pt[];
  }

  /** The guide line tool on or off for the one selected fill (key G). */
  function toggleGuides(): void {
    if (rungTool.active) {
      const was = rungTool.mode;
      closeRungs();
      if (was === 'guide') return;
    }
    const p = app.files.active?.pattern;
    if (!p || app.settings.mode !== 'flow' || ui.selectedObjects.size !== 1) return;
    const q = app.seq(p);
    const o = [...ui.selectedObjects][0];
    const loop = fillLoop(p, q, o);
    if (!loop) return;
    if (app.editor.active) app.setEditing(false);
    rungTool.openGuides(loop, remembered(p, q.objects[o])?.fill?.guides ?? []);
    ui.rungObject = o;
    rungPattern = p;
    app.stage.classList.add('rungs');
    app.redraw();
  }

  /** Patterns with points on the area: the middle of rays and circles, the eyes of swirls. */
  const POINTED = new Set(['rays', 'circles', 'swirl']);

  /** The extent (mm) of the area of the object the point tool is on. */
  function pointsBox(): [number, number, number, number] | null {
    const p = app.files.active?.pattern;
    if (!p || ui.rungObject === null) return null;
    const region = remembered(p, app.seq(p).objects[ui.rungObject])?.region;
    return region ? regionBox(region) : null;
  }

  /** The points of a fill's pattern on the design (mm), as it is sewn now. */
  function pointsOf(f: FillSettings, box: [number, number, number, number], region: Parameters<typeof swirlCenters>[0]): Pt[] {
    const d = f.deco ?? {};
    if (f.pattern === 'swirl') return d.centers?.map((c) => atShare(box, c)) ?? swirlCenters(region, d.seed ?? DECO_DEFAULTS.seed);
    return [atShare(box, d.focus ?? (f.pattern === 'circles' ? [0.5, 0.5] : DECO_DEFAULTS.focus))];
  }

  /** The point tool on or off for the one selected fill with rays, circles or swirls. */
  function togglePoints(): void {
    if (rungTool.active) {
      const was = rungTool.mode;
      closeRungs();
      if (was === 'points') return;
    }
    const p = app.files.active?.pattern;
    if (!p || app.settings.mode !== 'flow' || ui.selectedObjects.size !== 1) return;
    const q = app.seq(p);
    const o = [...ui.selectedObjects][0];
    const known = remembered(p, q.objects[o]);
    const loop = fillLoop(p, q, o);
    if (!loop || !known?.fill || !known.region || !POINTED.has(known.fill.pattern)) return;
    if (app.editor.active) app.setEditing(false);
    const box = regionBox(known.region);
    rungTool.openPoints(loop, pointsOf(known.fill, box, known.region), known.fill.pattern === 'swirl' ? MAX_SWIRLS : 1);
    ui.rungObject = o;
    rungPattern = p;
    app.stage.classList.add('rungs');
    app.redraw();
  }

  /** The rung tool on or off for the selected object (key R). */
  function toggleRungs(): void {
    if (rungTool.active) return closeRungs();
    const p = app.files.active?.pattern;
    if (!p) return;
    const q = app.seq(p);
    const target = rungTarget(p, q);
    if (!target) return;
    if (app.editor.active) app.setEditing(false);
    const obj = q.objects[target.o];
    if (target.mode === 'satin') {
      const columns = keepShape(p, obj, q.kinds).columns;
      if (!columns?.length) return app.layers.say(t('stitch.direction.miss'), true);
      rungTool.openSatin(columns);
      rungTool.satin = satinOf(p, q, obj);
    } else {
      const an = analyze(p, obj, q.kinds);
      const area = remembered(p, obj)?.shape ?? an.fill;
      if (!area) return;
      // The longest outline is the outside; holes are covered by the satin anyway.
      const loops = outline(area);
      const loop = loops.reduce((a, b) => (b.length > a.length ? b : a), [] as [number, number][]);
      rungTool.openFill(loop as Pt[]);
    }
    ui.rungObject = target.o;
    rungPattern = p;
    app.stage.classList.add('rungs');
    app.redraw();
  }

  function closeRungs(): void {
    if (!rungTool.active) return;
    rungTool.close();
    ui.rungObject = null;
    rungPattern = null;
    pendingColumns = null;
    ui.flowPreview = null;
    app.stage.classList.remove('rungs');
    app.redraw();
  }

  /** The satin settings an object is sewn with (as withRungs sews it). */
  function satinOf(p: Pattern, q: Sequence, obj: Sequence['objects'][number]): SatinSettings | null {
    const known = remembered(p, obj)?.satin;
    if (known) return known;
    const part = analyze(p, obj, q.kinds).parts.find((pt) => pt.kind === 'satin');
    return part ? measureSatin(p, part, q.kinds) : null;
  }

  /** Keeps the rung tool on its object: after new stitches its columns are read again; it closes when the object is gone. */
  function syncRungs(): void {
    if (!rungTool.active) return;
    const p = app.files.active?.pattern;
    if (!p || app.settings.mode !== 'flow' || ui.selectedObjects.size !== 1) return closeRungs();
    if (p === rungPattern) return;
    const q = app.seq(p);
    const o = [...ui.selectedObjects][0];
    if (rungTool.mode === 'points') {
      // The fill sewn anew around its points: the tool stays on it while the pattern has points.
      const known = q.objects[o] && remembered(p, q.objects[o]);
      if (!known?.fill || !known.region || !POINTED.has(known.fill.pattern) || !fillLoop(p, q, o)) return closeRungs();
      rungTool.points = pointsOf(known.fill, regionBox(known.region), known.region);
      ui.rungObject = o;
      rungPattern = p;
      return;
    }
    if (rungTool.mode === 'guide') {
      // The fill sewn anew along the guide lines: the tool stays on it.
      if (!q.objects[o] || !fillLoop(p, q, o)) return closeRungs();
      // After an undo the lines are the ones the stitches were made with.
      const guides = remembered(p, q.objects[o])?.fill?.guides;
      if (guides) rungTool.guides = guides.map((g) => g.slice());
      ui.rungObject = o;
      rungPattern = p;
      return;
    }
    const obj = q.objects[o];
    const columns = obj && rungTool.mode === 'satin' ? keepShape(p, obj, q.kinds).columns : null;
    if (!columns?.length) return closeRungs();
    rungTool.setColumns(columns);
    rungTool.satin = satinOf(p, q, obj);
    ui.rungObject = o;
    rungPattern = p;
  }

  /**
   * New stitches for the rung tool's object along `columns` (rails with their rungs), in its own
   * satin settings. The old stitches keep what they remembered: undo brings back the rungs with
   * them (the new stitches get theirs from the result).
   */
  function withRungs(columns: Rails[][] | null) {
    const p = app.files.active?.pattern;
    if (!p || ui.rungObject === null || !columns) return null;
    const q = app.seq(p);
    const obj = q.objects[ui.rungObject];
    if (!obj) return null;
    const before = remembered(p, obj);
    const shape = keepShape(p, obj, q.kinds);
    remember(p, obj, { ...shape, columns, read: false });
    const r = restitch(
      p,
      q.objects,
      [ui.rungObject],
      (_o, an, known) => {
        const part = an.parts.find((pt) => pt.kind === 'satin');
        return part ? { kind: 'satin', s: known?.satin ?? measureSatin(p, part, q.kinds) } : null;
      },
      q.kinds,
      app.settings.trimMm,
    );
    forget(p, obj, before);
    return r;
  }

  function applyRungs(columns: Rails[][]): void {
    pendingColumns = null;
    cancelAnimationFrame(rungFrame);
    rungFrame = 0;
    app.applyRestitched(withRungs(columns), 'stitch.failed');
  }

  /** Twice the area of a closed outline (mm²). */
  const area2 = (ring: Pt[]) => ring.reduce((a, p, i) => a + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0);

  /** Sews the selected fill as satin along the lines drawn across it. */
  function sewAlongLines(): void {
    const p = app.files.active?.pattern;
    if (!p || ui.rungObject === null || rungTool.mode !== 'fill') return;
    const q = app.seq(p);
    const obj = q.objects[ui.rungObject];
    const an = obj && analyze(p, obj, q.kinds);
    const area = an && (remembered(p, obj)?.shape ?? an.fill);
    if (!area) return;
    const loops = outline(area);
    const loop = loops.reduce((a, b) => (b.length > a.length ? b : a), [] as [number, number][]) as Pt[];
    // Holes: the other outlines lying inside it (the counter of an e, both of an 8).
    const holes = loops.filter((l) => l !== loop && l.length > 2 && inside(loop, l[0] as Pt) && Math.abs(area2(l as Pt[])) > 0.5) as Pt[][];
    let columns: Rails[];
    if (rungTool.cutLines.length || holes.length) {
      // Cut into parts: each its own column, sewn on one into the next without a trim.
      const made = stripsOfOutline(loop, rungTool.lines, rungTool.cutLines, holes);
      if (made.hole >= 0) {
        rungTool.showBad(holes[made.hole]);
        return app.layers.say(t('stitch.draw.openHole'), true);
      }
      if (made.bad >= 0) {
        rungTool.showBad(made.parts[made.bad]);
        return app.layers.say(t('stitch.draw.notStripPart'), true);
      }
      columns = made.strips.map((r) => ({ ...r, chain: 0 }));
      // The fill and its cut lines kept: the cut lines can be moved later (see Rails.split).
      columns[0].split = { outline: loop, holes, cuts: rungTool.cutLines.map(([a, b]) => [a, b] as [Pt, Pt]) };
    } else {
      const rails = railsFromOutline(loop, rungTool.lines);
      if (!rails) return app.layers.say(t('stitch.draw.notStrip'), true);
      columns = [rails];
    }
    const s = app.convertSettings('satin', app.stitchInfo(p, q));
    if (!s) return;
    const o = ui.rungObject;
    closeRungs();
    const r = restitch(p, q.objects, [o], s, q.kinds, app.settings.trimMm, 'fill', false, new Map([[o, columns]]));
    app.applyRestitched(r, 'stitch.toSatin.failed', true);
  }

  return { closeRungs, rungInfo, rungTool, sewAlongLines, syncRungs, toggleGuides, togglePoints, toggleRungs };
}
