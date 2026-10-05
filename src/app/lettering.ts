import type { DrawTool, DrawKind } from '../ui/drawTool';
import type { FileList } from '../ui/fileList';
import type { LayersPanel } from '../ui/layersPanel';
import type { Measurement } from '../validation/measure';
import type { Mode, Settings } from '../settings';
import type { Sequence } from './types';
import type { ThreadColor, Pattern } from '../model/pattern';
import type { Viewport } from '../render/viewport';
import { LetteringPanel } from '../ui/letteringPanel';
import { letteringOf, placeLettering, letteringObjects, withoutObjects } from '../lettering/place';
import { rememberedIn, remembered, remember } from '../model/restitch';
import { sewLettering } from '../lettering/sew';
import { sewObjects, type SewObject } from '../model/objects';
import { t, getLang } from '../i18n';
import { type Catalog, loadCatalog, fontNow, loadFont } from '../lettering/font';
import { type Lettering, LETTERING_DEFAULTS, followText, layout } from '../lettering/layout';
import { type Mat, apply } from '../shape/path';
import { ui } from './state';
import { writePattern } from '../writers';

/** What bindLettering needs from the rest of the app. */
export interface LetteringApp {
  readonly applyEdit: (p: Pattern, measurement?: Measurement | undefined) => void;
  readonly ctx: CanvasRenderingContext2D;
  readonly drawTool: DrawTool;
  readonly files: FileList;
  readonly layers: LayersPanel;
  readonly recompute: () => void;
  readonly redraw: () => void;
  readonly selectObjects: (objs: number[], toggle: boolean) => void;
  readonly seq: (p: Pattern) => Sequence;
  readonly setDrawing: (kind: DrawKind | null) => void;
  readonly setMode: (mode: Mode) => void;
  readonly settings: Settings;
  readonly syncPlayer: () => void;
  readonly updateLevel: () => void;
  readonly vp: Viewport;
}

/** Lettering: the text card, fonts, sewing the text, and moving single letters. */
export function bindLettering(app: LetteringApp) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  /** The fonts that come with the app (loaded on start, the fonts themselves when first used). */
  let catalog: Catalog | null = null;
  void loadCatalog()
    .then((c) => {
      catalog = c;
      app.redraw();
    })
    .catch((err) => console.warn('No font catalog', err));

  /** The font a new lettering starts with: the one used last. */
  let lastFont = 'barstitch_regular';
  /** A red that shows on light and dark fabric alike, for a lettering in a new design. */
  const LETTERING_RED: ThreadColor = { r: 237, g: 23, b: 31, name: 'Red', pecIndex: 5 };

  const letteringsOf = (p: Pattern, q: Sequence) => (q.letterings ??= q.objects.map((o) => letteringOf(p, o)));

  /** The lettering all selected objects belong to, if they do. */
  function selectedLettering(p: Pattern, q: Sequence): Lettering | null {
    if (app.settings.mode !== 'flow' || !ui.selectedObjects.size) return null;
    const all = letteringsOf(p, q);
    let l: Lettering | null = null;
    for (const o of ui.selectedObjects) {
      const x = all[o];
      if (!x || (l && x.id !== l.id)) return null;
      l = x;
    }
    return l;
  }

  /** Follows the selection: the card is on while a lettering is chosen, with its font loaded. */
  function syncLettering(): void {
    const f = app.files.active;
    const p = f?.pattern;
    const l = p ? selectedLettering(p, app.seq(p)) : null;
    const was = !!ui.lettering;
    const wasLetters = ui.letterMode;
    if (!l || !f) {
      ui.lettering = null;
      ui.letterMode = false;
      ui.letterAt = null;
    } else if (!ui.lettering || ui.lettering.l.id !== l.id || ui.lettering.f !== f) {
      ui.lettering = { l, f, recorded: false, sewn: JSON.stringify(l) };
      ui.letterMode = false;
      ui.letterAt = null;
    }
    if (ui.lettering && !fontNow(ui.lettering.l.font)) {
      const want = ui.lettering.l.font;
      void loadFont(want)
        .then(() => app.redraw())
        .catch(() => app.layers.say(t('lettering.loadFailed'), true));
    }
    if (was !== !!ui.lettering || wasLetters !== ui.letterMode) app.updateLevel();
  }

  /** What the card shows about the chosen lettering. */
  function letteringInfo(q: Sequence) {
    const objs = [...ui.selectedObjects].map((o) => q.objects[o]).filter(Boolean);
    const l = ui.lettering!.l;
    return {
      lettering: l,
      font: fontNow(l.font) ?? null,
      catalog,
      width: (Math.max(...objs.map((o) => o.maxX)) - Math.min(...objs.map((o) => o.minX))) / 10,
      height: (Math.max(...objs.map((o) => o.maxY)) - Math.min(...objs.map((o) => o.minY))) / 10,
      stitches: objs.reduce((a, o) => a + o.stitches, 0),
      letters: ui.letterMode,
      letter: ui.letterAt,
    };
  }

  /** Names of lettering objects in the list: the text, numbered when it is sewn in pieces. */
  function letteringNames(p: Pattern, q: Sequence): ReadonlyMap<number, string> | undefined {
    if (q.letteringNames?.lang !== getLang()) q.letteringNames = { lang: getLang(), names: namesOf(p, q) };
    return q.letteringNames.names;
  }

  function namesOf(p: Pattern, q: Sequence): ReadonlyMap<number, string> | undefined {
    const all = letteringsOf(p, q);
    if (!all.some(Boolean)) return undefined;
    const names = new Map<number, string>();
    const pieces = new Map<string, number[]>();
    all.forEach((l, o) => {
      if (l) pieces.set(l.id, [...(pieces.get(l.id) ?? []), o]);
    });
    for (const list of pieces.values()) {
      const l = all[list[0]]!;
      const one = l.text.replace(/\s+/g, ' ').trim();
      const text = one.length > 20 ? `${one.slice(0, 19)}…` : one;
      list.forEach((o, k) => names.set(o, t('lettering.name', { text }) + (list.length > 1 ? ` ${k + 1}` : '')));
    }
    return names;
  }

  /** A new lettering: under the design (or as a new design), its text selected to type over. */
  async function newLettering(): Promise<void> {
    if (app.settings.mode !== 'flow') app.setMode('flow');
    if (app.drawTool.active) app.setDrawing(null);
    let font;
    try {
      font = await loadFont(lastFont);
    } catch {
      app.layers.say(t('lettering.loadFailed'), true);
      return;
    }
    const f = app.files.active;
    const p = f?.pattern ?? null;
    const height = Math.max(font.min * font.cap, Math.min(15, font.max * font.cap));
    const b = p?.bounds;
    const colors = p?.colors ?? [];
    const l: Lettering = {
      ...LETTERING_DEFAULTS,
      id: `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      text: t('lettering.new'),
      font: font.id,
      height: Math.round(height * 2) / 2,
      align: 'center',
      // Under the design, in its last thread (no color change for it).
      x: b ? Math.round((b.minX + b.maxX) / 20) : 0,
      y: b ? Math.round(b.maxY / 10 + 6 + height) : 0,
      color: { ...(colors[colors.length - 1] ?? LETTERING_RED) },
    };
    const sewn = sewLettering(font, l, app.settings.trimMm);
    if (!f || !p) {
      // A new design of the lettering alone.
      const placed = placeLettering(null, [], sewn, l, t('lettering.title'));
      if (!placed) return;
      const data = writePattern(placed.pattern, 'pes');
      await app.files.addWithObjects(`${t('lettering.title')}.pes`, data.slice().buffer, rememberedIn(placed.pattern, sewObjects(placed.pattern)));
      const np = app.files.active?.pattern;
      if (!np) return;
      const nb = np.bounds;
      const cx = (nb.minX + nb.maxX) / 20;
      const cy = (nb.minY + nb.maxY) / 20;
      app.vp.fit(cx - 50, cy - 35, cx + 50, cy + 35, ui.stageW, ui.stageH);
      ui.selectedObjects = new Set(letteringObjects(np, app.seq(np).objects, l.id).map((o) => o.index));
    } else {
      const placed = placeLettering(p, [], sewn, l);
      if (!placed) return;
      app.applyEdit(placed.pattern);
      app.files.setObjects(f, rememberedIn(placed.pattern, app.seq(placed.pattern).objects));
      ui.selectedObjects = new Set(placed.objects.map((o) => o.index));
      keepInView(placed.pattern, placed.objects);
    }
    ui.selectionKey++;
    ui.focusText = true;
    app.layers.reveal([...ui.selectedObjects]);
    app.redraw();
  }
  $('lettering-new').addEventListener('click', () => void newLettering());

  /**
   * The chosen lettering changed in the card or by the frame: its stitches are made anew in its
   * place. Changes while typing or dragging a slider are one undo step, ended by `final`.
   */
  function changeLettering(next: Lettering, final: boolean): void {
    const cur = ui.lettering;
    if (!cur) return;
    // Moved letters stay with their letters when the text changes.
    if (next.text !== cur.l.text && next.letters.length) next = { ...next, letters: followText(cur.l.text, next.text, next.letters) };
    cur.l = next;
    lastFont = next.font;
    const font = fontNow(next.font);
    if (!font) {
      void loadFont(next.font)
        .then(() => {
          if (ui.lettering === cur) sewLetteringNow(cur, final);
        })
        .catch(() => app.layers.say(t('lettering.loadFailed'), true));
      return app.redraw();
    }
    sewLetteringNow(cur, final);
  }

  function sewLetteringNow(cur: NonNullable<typeof ui.lettering>, final: boolean): void {
    const f = cur.f;
    const p = f.pattern;
    const font = fontNow(cur.l.font);
    if (app.files.active !== f || !p || !font) return;
    const key = JSON.stringify(cur.l);
    if (key === cur.sewn) {
      if (final) cur.recorded = false;
      return app.redraw();
    }
    const q = app.seq(p);
    const old = letteringObjects(p, q.objects, cur.l.id);
    const sewn = sewLettering(font, cur.l, app.settings.trimMm);
    let next: Pattern | null;
    let mine: number[] = [];
    if (sewn.recs.length) {
      const placed = placeLettering(p, old, sewn, cur.l);
      next = placed?.pattern ?? null;
      mine = placed?.objects.map((o) => o.index) ?? [];
    } else {
      // No text: the letters go once the text field is left empty (and come back with undo).
      if (!final) return app.redraw();
      next = withoutObjects(p, old);
    }
    if (!next) return app.redraw();
    ui.hoverZone = ui.selectedZone = null;
    app.files.setPattern(f, next, { record: !cur.recorded });
    cur.recorded = !final;
    cur.sewn = key;
    app.syncPlayer();
    app.recompute();
    app.files.setObjects(f, rememberedIn(next, app.seq(next).objects));
    ui.selectedObjects = new Set(mine);
    ui.selectionKey++;
    if (final) keepInView(next, mine.map((o) => app.seq(next).objects[o]));
    app.redraw();
  }

  /** Shows the whole design when the lettering went (partly) off the stage, or under the tools. */
  function keepInView(p: Pattern, objs: SewObject[]): void {
    if (!objs.length) return;
    const [ax, ay] = app.vp.toScreen(Math.min(...objs.map((o) => o.minX)) / 10, Math.min(...objs.map((o) => o.minY)) / 10);
    const [bx, by] = app.vp.toScreen(Math.max(...objs.map((o) => o.maxX)) / 10, Math.max(...objs.map((o) => o.maxY)) / 10);
    if (ax >= 20 && ay >= 60 && bx <= ui.stageW - 20 && by <= ui.stageH - 110) return;
    const b = p.bounds;
    app.vp.fit(b.minX / 10, b.minY / 10, b.maxX / 10, b.maxY / 10, ui.stageW, ui.stageH);
  }

  /** The frame moved, turned or scaled the lettering: its place, angle and size follow. */
  function transformLettering(m: Mat): void {
    const l = ui.lettering!.l;
    const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    const turn = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
    const [x, y] = apply(m, [l.x, l.y]);
    const angle = ((((l.angle + turn) % 360) + 540) % 360) - 180;
    const round = (v: number, k = 100) => Math.round(v * k) / k;
    changeLettering(
      {
        ...l,
        x: round(x),
        y: round(y),
        angle: round(angle, 10),
        height: round(l.height * s),
        radius: round(l.radius * s),
        spacing: round(l.spacing * s),
        wordSpacing: round(l.wordSpacing * s),
        letters: l.letters.map((o) => ({ ...o, dx: round(o.dx * s), dy: round(o.dy * s) })),
      },
      true,
    );
  }

  /** The letters become ordinary objects: they forget their lettering. */
  function releaseLettering(): void {
    const f = app.files.active;
    const p = f?.pattern;
    if (!f || !p || !ui.lettering) return;
    const q = app.seq(p);
    for (const o of letteringObjects(p, q.objects, ui.lettering.l.id)) {
      const { lettering: _, ...rest } = remembered(p, o)!;
      remember(p, o, rest);
    }
    q.letterings = undefined;
    q.letteringNames = undefined;
    app.files.setObjects(f, rememberedIn(p, q.objects));
    ui.lettering = null;
    ui.letterMode = false;
    ui.selectionKey++;
    app.layers.say(t('lettering.released'));
    app.updateLevel();
    app.redraw();
  }

  function setLetterMode(on: boolean): void {
    ui.letterMode = on && !!ui.lettering;
    ui.letterAt = null;
    ui.letterDrag = null;
    app.updateLevel();
    app.redraw();
  }

  const letteringPanel = new LetteringPanel({
    change: (next, final) => changeLettering(next, final),
    close: () => app.selectObjects([], false),
    letters: (on) => setLetterMode(on),
    release: () => releaseLettering(),
    hoop: () => app.settings.hoop,
  });

  /** The letters of the chosen lettering where they are now, or null while its font loads. */
  function letterLayout() {
    const font = ui.lettering && fontNow(ui.lettering.l.font);
    return font ? layout(font, ui.lettering!.l) : null;
  }

  /** The letter whose box contains the point (mm), or null. */
  function letterHit(x: number, y: number, pad: number): number | null {
    const lay = letterLayout();
    if (!lay) return null;
    for (const pl of lay.letters) {
      if (!pl.glyph) continue;
      // Inside the (turned) box: on the same side of all four edges.
      const b = pl.box;
      let sign = 0;
      let inside = true;
      for (let k = 0; k < 4 && inside; k++) {
        const [ax, ay] = b[k];
        const [bx, by] = b[(k + 1) % 4];
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const c = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / len;
        if (Math.abs(c) <= pad) continue;
        if (sign && Math.sign(c) !== sign) inside = false;
        sign = Math.sign(c);
      }
      if (inside) return pl.at;
    }
    return null;
  }

  /** A letter's offset moved by `wx`, `wy` (mm on the design), turned into the lettering's frame. */
  function letterMoved(at: number, dx0: number, dy0: number, wx: number, wy: number, final: boolean): void {
    const l = ui.lettering!.l;
    const r = (-l.angle * Math.PI) / 180;
    const dx = Math.round((dx0 + wx * Math.cos(r) - wy * Math.sin(r)) * 100) / 100;
    const dy = Math.round((dy0 + wx * Math.sin(r) + wy * Math.cos(r)) * 100) / 100;
    const ch = [...l.text][at] ?? '';
    const old = l.letters.find((o) => o.at === at) ?? { at, ch, dx: 0, dy: 0, rot: 0 };
    const rest = l.letters.filter((o) => o.at !== at);
    const moved = { ...old, dx, dy };
    changeLettering({ ...l, letters: moved.dx || moved.dy || moved.rot ? [...rest, moved] : rest }, final);
  }

  let letterFrame = 0;
  let pendingLetter: [number, number] | null = null;

  function letterDown(x: number, y: number): boolean {
    const at = letterHit(x, y, 4 / app.vp.scale);
    if (at === null) return false;
    const o = ui.lettering!.l.letters.find((v) => v.at === at);
    ui.letterDrag = { at, from: [x, y], dx: o?.dx ?? 0, dy: o?.dy ?? 0, moved: false };
    if (ui.letterAt !== at) {
      ui.letterAt = at;
      app.redraw();
    }
    return true;
  }

  function letterDragTo(x: number, y: number): boolean {
    const d = ui.letterDrag;
    if (!d) return false;
    if (!d.moved && Math.hypot(x - d.from[0], y - d.from[1]) * app.vp.scale < 3) return true;
    d.moved = true;
    pendingLetter = [x - d.from[0], y - d.from[1]];
    if (!letterFrame) {
      letterFrame = requestAnimationFrame(() => {
        letterFrame = 0;
        if (ui.letterDrag && pendingLetter) letterMoved(ui.letterDrag.at, ui.letterDrag.dx, ui.letterDrag.dy, ...pendingLetter, false);
      });
    }
    return true;
  }

  function letterUp(): void {
    const d = ui.letterDrag;
    ui.letterDrag = null;
    cancelAnimationFrame(letterFrame);
    letterFrame = 0;
    if (d?.moved && pendingLetter) letterMoved(d.at, d.dx, d.dy, ...pendingLetter, true);
    pendingLetter = null;
  }

  /** The letter boxes over the stitches while single letters are moved; the chosen one stands out. */
  function drawLetterBoxes(): void {
    const lay = letterLayout();
    if (!lay) return;
    app.ctx.save();
    app.ctx.lineWidth = 1;
    for (const pl of lay.letters) {
      if (!pl.glyph) continue;
      const on = pl.at === ui.letterAt;
      app.ctx.strokeStyle = on ? '#ffd23f' : 'rgba(255, 255, 255, 0.55)';
      app.ctx.setLineDash(on ? [] : [3, 3]);
      app.ctx.lineWidth = on ? 1.5 : 1;
      app.ctx.beginPath();
      pl.box.forEach(([x, y], k) => {
        const [sx, sy] = app.vp.toScreen(x, y);
        if (k) app.ctx.lineTo(sx, sy);
        else app.ctx.moveTo(sx, sy);
      });
      app.ctx.closePath();
      app.ctx.stroke();
    }
    app.ctx.restore();
  }

  return { drawLetterBoxes, letterDown, letterDragTo, letterMoved, letterUp, letteringInfo, letteringNames, letteringPanel, letteringsOf, newLettering, setLetterMode, syncLettering, transformLettering };
}
