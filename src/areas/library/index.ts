import './library.css';
import { formatNumber, getLang, onLangChange, t, type Key } from '../../i18n';
import type { Settings, Mode } from '../../settings';
import type { Pattern } from '../../model/pattern';
import type { FileList } from '../../ui/fileList';
import type { Viewport } from '../../render/viewport';
import { command, commandTitle, getCommand, runCommand } from '../../shell/commands';
import { h } from '../../shell/h';
import { ui } from '../../app/state';
import { digitizeDefaults } from '../../digitize/digitize';
import { appendDesign } from '../../model/appendDesign';
import { sewObjects } from '../../model/objects';
import { rememberedIn } from '../../model/restitch';
import { writePattern } from '../../writers';
import { type Library, type Motif, type Source, loadLibrary, loadPack, motifFile, searchMotifs } from '../../library/catalog';
import { MOTIF_MM, sewMotif } from '../../library/sew';

/** What the motif library needs from the rest of the app. */
export interface LibraryApp {
  readonly settings: Settings;
  readonly setMode: (m: Mode) => void;
  readonly files: FileList;
  readonly vp: Viewport;
  readonly stage: HTMLElement;
  /** Leaves a drawing tool, so only one tool has the pointer. */
  readonly stopDrawing: () => void;
  /** Takes a changed design as one undo step, with these objects selected. */
  readonly takeShapes: (next: Pattern, select: number[]) => void;
  readonly redraw: () => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Shown as ideas when a search finds nothing. */
const IDEAS: Record<'de' | 'en', string> = { de: 'Herz, Stern, Blume, Hund', en: 'heart, star, flower, dog' };

/** The motif being dragged onto the stage (the drag carries only its key). */
const DRAG_TYPE = 'application/x-heatstitch-motif';

/** Room between the design and a motif put in beside it (mm). */
const GAP_MM = 5;

/**
 * Motive: ready-made motifs, found by name or category and put into the design with a click (in
 * the middle of what the stage shows, beside the design when that lies there) or by dragging them
 * to a place on the stage. The panel takes
 * the place of the object list while it is open; the button in the tool rail (key U) or Esc closes it.
 */
export function initLibrary(app: LibraryApp): { draw: (ctx: CanvasRenderingContext2D) => void; close: () => void } {
  const panel = $('library-panel');
  const layers = $('layers-panel');
  const button = $<HTMLButtonElement>('library-open');
  const search = $<HTMLInputElement>('library-search');
  const chips = $('library-chips');
  const grid = $('library-grid');
  const note = $('library-note');
  const count = $('library-count');
  const credit = $('library-credit');

  let lib: Library | null = null;
  let category = '';
  /** Changes with each new list, so late packs don't fill an old one. */
  let drawn = 0;
  /** The motif under the pointer or keyboard focus: its place is shown on the stage. */
  let hover: { source: Source; m: Motif; img: HTMLImageElement } | null = null;
  let busy = false;

  const isOpen = () => !panel.hidden;
  const name = (m: Motif) => m[getLang() === 'de' ? 'de' : 'en'];
  const say = (text: string, error = false) => {
    note.hidden = !text;
    note.textContent = text;
    note.classList.toggle('error', error);
  };

  /** Narrow screens: the object list (and so this panel) is a drawer over the stage. */
  const narrow = () => !!getCommand('layout.objects')?.when?.();
  const drawerOpen = () => !!document.getElementById('layout')?.classList.contains('rs-side-open');

  function open(on: boolean): void {
    if (on === isOpen()) return;
    if (on) {
      if (app.settings.mode !== 'flow') app.setMode('flow');
      app.stopDrawing();
      // On a narrow screen the panel is in the drawer of the object list: it opens with it.
      if (!drawerOpen() && narrow()) runCommand('layout.objects');
    }
    panel.hidden = !on;
    layers.hidden = on;
    button.setAttribute('aria-pressed', String(on));
    hover = null;
    if (on) {
      void show();
      // Not on touch: the keyboard would cover the motifs before anyone wants to type.
      if (!matchMedia('(pointer: coarse)').matches) search.focus();
    } else app.redraw();
  }

  async function show(): Promise<void> {
    if (!lib) {
      say(t('library.loading'));
      try {
        lib = await loadLibrary();
      } catch {
        return say(t('library.loadFailed'), true);
      }
      say('');
      category ||= lib.sources[0]?.categories[0] ?? '';
    }
    renderChips();
    renderCredit();
    void renderList();
  }

  function renderChips(): void {
    if (!lib) return;
    const cats = [...new Set(lib.sources.flatMap((s) => s.categories))];
    const searching = !!search.value.trim();
    chips.replaceChildren(
      ...cats.map((c) =>
        h('button', {
          type: 'button',
          class: 'library-chip',
          'aria-pressed': String(!searching && c === category),
          text: t(`library.cat.${c}` as Key),
          onclick: () => {
            category = c;
            search.value = '';
            renderChips();
            void renderList();
          },
        }),
      ),
    );
  }

  function renderCredit(): void {
    if (!lib) return;
    credit.replaceChildren(
      ...lib.sources.map((s) => {
        const text = t('library.credit', { credit: s.credit, license: s.license.replace(/-/g, ' ').replace(/ (\d)/, ' $1') });
        const [before, after] = text.split(s.credit);
        return h('span', null, before, h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.credit), after);
      }),
    );
  }

  /** The motifs to show now: the search over all sources, else the chosen category. */
  function listed(): { source: Source; m: Motif }[] {
    if (!lib) return [];
    const q = search.value.trim();
    const lang = getLang() === 'de' ? 'de' : 'en';
    return lib.sources.flatMap((source) => (q ? searchMotifs(source.motifs, q, lang) : source.motifs.filter((m) => m.c === category)).map((m) => ({ source, m })));
  }

  async function renderList(): Promise<void> {
    const my = ++drawn;
    const items = listed();
    const q = search.value.trim();
    count.textContent = q ? (items.length === 1 ? t('library.found.one') : t('library.found', { n: formatNumber(items.length) })) : '';
    if (!items.length) {
      grid.replaceChildren();
      if (q) say(t('library.none', { q, ideas: IDEAS[getLang() === 'de' ? 'de' : 'en'] }));
      return;
    }
    if (!busy) say('');
    const tiles = items.map(({ source, m }) => tile(source, m));
    grid.replaceChildren(...tiles.map((x) => x.el));
    // The pictures come with their category's file, the first ones first.
    const wanted = [...new Set(items.map(({ source, m }) => `${source.id} ${m.c}`))];
    for (const key of wanted) {
      const [sid, c] = key.split(' ');
      const source = lib!.sources.find((s) => s.id === sid)!;
      let pack: Record<string, string>;
      try {
        pack = await loadPack(source, c);
      } catch {
        if (my === drawn) say(t('library.loadFailed'), true);
        return;
      }
      if (my !== drawn) return;
      for (const x of tiles) if (x.source === source && x.m.c === c) x.fill(pack[x.m.id]);
    }
  }

  function tile(source: Source, m: Motif) {
    const img = h('img', { alt: '', draggable: false, decoding: 'async' });
    const el = h(
      'button',
      {
        type: 'button',
        class: 'library-tile',
        draggable: true,
        title: t('library.tile.hint', { name: name(m) }),
        'aria-label': name(m),
        onclick: () => void put(source, m),
        onmouseenter: () => setHover({ source, m, img }),
        onmouseleave: () => setHover(null),
        onfocus: () => setHover({ source, m, img }),
        onblur: () => setHover(null),
        ondragstart: (e: Event) => {
          const dt = (e as DragEvent).dataTransfer;
          if (!dt) return;
          dt.setData(DRAG_TYPE, `${source.id} ${m.id}`);
          dt.effectAllowed = 'copy';
          dt.setDragImage(img, 24, 24);
          setHover(null);
        },
      },
      img,
    );
    return {
      el,
      source,
      m,
      fill: (svg: string | undefined) => {
        if (svg) img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      },
    };
  }

  function setHover(next: typeof hover): void {
    if (hover?.m === next?.m) return;
    hover = next;
    app.redraw();
  }

  // Arrow keys move between the tiles like in a grid; Enter puts the motif in (it is a button).
  grid.addEventListener('keydown', (e) => {
    const tiles = [...grid.querySelectorAll<HTMLButtonElement>('.library-tile')];
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const cols = Math.max(1, Math.round(grid.clientWidth / (tiles[0].offsetWidth || 1)));
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (!step) return;
    e.preventDefault();
    tiles[Math.max(0, Math.min(tiles.length - 1, at + step))].focus();
  });
  search.addEventListener('input', () => {
    renderChips();
    void renderList();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      const first = grid.querySelector<HTMLButtonElement>('.library-tile');
      if (!first) return;
      e.preventDefault();
      if (e.key === 'Enter') first.click();
      else first.focus();
    }
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // A search is cleared first, then the panel closes.
    if (document.activeElement === search && search.value) return;
    e.preventDefault();
    open(false);
    button.focus();
  });

  /** Size of a new motif (mm): the usual width, smaller in a small hoop. */
  function motifMm(): number {
    const hoop = app.settings.hoop;
    return hoop ? Math.min(MOTIF_MM, Math.floor(Math.min(hoop.w, hoop.h) * 0.8)) : MOTIF_MM;
  }

  /** The middle of what the stage shows (mm). */
  function viewMiddle(): [number, number] {
    return app.vp.toWorld(ui.stageW / 2, ui.stageH / 2);
  }

  /** The stitches of the open design (mm), if it has any. */
  function designBox(): { x0: number; y0: number; x1: number; y1: number } | null {
    const p = app.files.active?.pattern;
    if (!p || !p.cmd.some((c) => c === 0)) return null;
    const b = p.bounds;
    return { x0: b.minX / 10, y0: b.minY / 10, x1: b.maxX / 10, y1: b.maxY / 10 };
  }

  /**
   * Where a click puts a motif `w` x `h` mm: the middle of the view, or beside the design when it
   * would land on it there (sewn over other stitches it would be too thick). Dropped, it goes where
   * it is let go.
   */
  function spot(w: number, h: number): [number, number] {
    const at = viewMiddle();
    const d = designBox();
    if (!d || at[0] + w / 2 <= d.x0 || at[0] - w / 2 >= d.x1 || at[1] + h / 2 <= d.y0 || at[1] - h / 2 >= d.y1) return at;
    return [d.x1 + GAP_MM + w / 2, (d.y0 + d.y1) / 2];
  }

  /** The view moved out to show all of the design when the motif put in lies outside it. */
  function keepInView(): void {
    const d = designBox();
    if (!d) return;
    const [sx0, sy0] = app.vp.toScreen(d.x0, d.y0);
    const [sx1, sy1] = app.vp.toScreen(d.x1, d.y1);
    if (sx0 >= 0 && sy0 >= 0 && sx1 <= ui.stageW && sy1 <= ui.stageH) return;
    app.vp.fit(d.x0, d.y0, d.x1, d.y1, ui.stageW, ui.stageH, 48);
    app.redraw();
  }

  /** Sews the motif and puts it in the open design, its middle at `at` (mm, else see spot); a new design without one. */
  async function put(source: Source, m: Motif, at?: [number, number]): Promise<void> {
    if (busy) return;
    busy = true;
    const label = name(m);
    say(t('library.sewing', { name: label }));
    try {
      const svg = await motifFile(source, m);
      const options = { ...digitizeDefaults(app.settings.profile), trimMm: app.settings.trimMm };
      const motif = await sewMotif(svg, m.en, motifMm(), app.settings.image.prepare, options);
      const f = app.files.active;
      const p = f?.pattern;
      const n = sewObjects(motif).length;
      if (!f || !p) {
        const data = writePattern(motif, 'pes');
        await app.files.addWithObjects(`${label}.pes`, data.slice().buffer, rememberedIn(motif, sewObjects(motif)), [], undefined, true);
        const np = app.files.active?.pattern;
        if (np) app.takeShapes(np, sewObjects(np).map((o) => o.index));
      } else {
        const b = motif.bounds;
        const [x, y] = at ?? spot((b.maxX - b.minX) / 10, (b.maxY - b.minY) / 10);
        const r = appendDesign(p, motif, x, y, app.settings.trimMm);
        if (!r) throw new Error('not placed');
        app.takeShapes(r.pattern, r.objects);
        keepInView();
      }
      // In a drawer the panel covers the stage: it steps aside to show the motif put in.
      if (narrow() && drawerOpen()) runCommand('layout.objects');
      say(n === 1 ? t('library.added.one', { name: label }) : t('library.added', { name: label, n: formatNumber(n) }));
    } catch (err) {
      console.warn('motif', source.id, m.id, err);
      say(t('library.failed', { name: label }), true);
    } finally {
      busy = false;
    }
  }

  // Dropped on the stage: the motif goes where it was let go.
  app.stage.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  app.stage.addEventListener('drop', (e) => {
    const key = e.dataTransfer?.getData(DRAG_TYPE);
    if (!key || !lib) return;
    e.preventDefault();
    const [sid, id] = key.split(' ');
    const source = lib.sources.find((s) => s.id === sid);
    const m = source?.motifs.find((x) => x.id === id);
    if (!source || !m) return;
    const r = app.stage.getBoundingClientRect();
    void put(source, m, app.vp.toWorld(e.clientX - r.left, e.clientY - r.top));
  });

  command({
    id: 'library.open',
    label: 'library.tool',
    group: 'library.title',
    keys: ['U'],
    when: () => app.settings.mode !== 'image',
    run: () => open(!isOpen()),
  });

  const texts = () => {
    search.placeholder = t('library.search');
    button.title = commandTitle({ ...getCommand('library.open')!, label: 'library.tool.hint' });
    button.setAttribute('aria-label', t('library.tool'));
    if (isOpen() && lib) {
      renderChips();
      renderCredit();
      void renderList();
    }
  };
  texts();
  onLangChange(texts);

  /** Where the motif under the pointer would go (see spot): its picture, faint. */
  function draw(ctx: CanvasRenderingContext2D): void {
    if (!hover || !isOpen() || !hover.img.complete || !hover.img.naturalWidth) return;
    const size = motifMm();
    const aspect = hover.img.naturalHeight / hover.img.naturalWidth || 1;
    const [cx, cy] = spot(size, size * aspect);
    const [x0, y0] = app.vp.toScreen(cx - size / 2, cy - (size * aspect) / 2);
    const [x1, y1] = app.vp.toScreen(cx + size / 2, cy + (size * aspect) / 2);
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.drawImage(hover.img, x0, y0, x1 - x0, y1 - y0);
    ctx.globalAlpha = 1;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 0.5, y0 - 0.5, x1 - x0 + 1, y1 - y0 + 1);
    ctx.restore();
  }

  return { draw, close: () => open(false) };
}
