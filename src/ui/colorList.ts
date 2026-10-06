import { formatNumber, t } from '../i18n';
import { blockIndex, colorBlocks, sewingSeconds } from '../model/sequence';
import { forEachThreadSegment, patternStats, type Pattern, type ThreadColor } from '../model/pattern';
import { catalogsNow, chooseCatalog, chosenCatalog, closeness, inCatalog, loadCatalogs, nearest, threadCode, threadNumber, type Catalog } from '../threads/catalog';
import { cssColor } from './threadPicker';

export interface ColorListInfo {
  pattern: Pattern;
  name: string;
  /** Machine speed for the sewing time. */
  spm: number;
  /** All color blocks get these threads, as one edit. */
  apply: (colors: ThreadColor[]) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const same = (a: ThreadColor, b: ThreadColor) => a.r === b.r && a.g === b.g && a.b === b.b && a.name === b.name && a.catalog === b.catalog;

/**
 * The threads of the design in sewing order, to lay out the spools and print. With a thread brand
 * chosen, each color also shows the nearest thread of that brand, and the whole design can be
 * switched to them in one step.
 */
export class ColorList {
  private dialog: HTMLDialogElement | null = null;
  private info: ColorListInfo | null = null;
  private done = '';

  open(info: ColorListInfo): void {
    this.info = info;
    this.done = '';
    if (!this.dialog) {
      const d = el('dialog', 'color-list');
      d.setAttribute('aria-labelledby', 'color-list-title');
      d.addEventListener('click', (e) => {
        // A click on the backdrop closes it.
        if (e.target === d) d.close();
      });
      d.addEventListener('close', () => document.body.classList.remove('printing-colors'));
      document.body.append(d);
      this.dialog = d;
    }
    this.render();
    document.body.classList.add('printing-colors');
    this.dialog.showModal();
    void loadCatalogs()
      .then(() => this.dialog?.open && this.render())
      .catch(() => {});
  }

  /** The design changed (after switching the threads): shown again with the new colors. */
  update(p: Pattern): void {
    if (!this.info || !this.dialog?.open || this.info.pattern === p) return;
    this.info = { ...this.info, pattern: p };
    this.render();
  }

  private render(): void {
    const d = this.dialog!;
    const { pattern: p, name, spm } = this.info!;
    const blocks = colorBlocks(p);
    const st = patternStats(p);
    const all = catalogsNow();
    const cat: Catalog | undefined = all.find((c) => c.id === chosenCatalog());
    const matches = blocks.map((b) => (cat && !inCatalog(b.color, cat) ? nearest(b.color, cat, 1)[0] : undefined));
    const compare = cat && matches.some(Boolean);

    const head = el('div', 'cl-head');
    const title = el('h2', '', t('colorList.title'));
    title.id = 'color-list-title';
    const close = el('button', 'icon cl-close', '×');
    close.type = 'button';
    close.title = t('colorList.close');
    close.setAttribute('aria-label', close.title);
    close.addEventListener('click', () => d.close());
    head.append(title, close);

    // What is printed.
    const sheet = el('div', 'cl-sheet');
    const top = el('div', 'cl-top');
    top.append(thumbnail(p));
    const facts = el('dl', 'cl-facts');
    const w = (p.bounds.maxX - p.bounds.minX) / 10;
    const h = (p.bounds.maxY - p.bounds.minY) / 10;
    const spools = new Set(blocks.map((b) => `${b.color.r},${b.color.g},${b.color.b},${b.color.name ?? ''}`)).size;
    const rows: [string, string][] = [
      [t('colorList.size'), `${formatNumber(w, 1)} × ${formatNumber(h, 1)} mm`],
      [t('colorList.stitches'), formatNumber(st.stitches)],
      [t('colorList.changes'), t('colorList.changesValue', { colors: blocks.length, spools })],
      [t('colorList.thread'), `${formatNumber(st.threadLength / 1000, 1)} m`],
      [t('colorList.time'), t('stats.minutes', { m: formatNumber(sewingSeconds(st.stitches, st.trims, st.colorChanges, spm) / 60) })],
    ];
    for (const [k, v] of rows) facts.append(el('dt', '', k), el('dd', '', v));
    const named = el('div', 'cl-named');
    named.append(el('h3', '', name), facts);
    top.append(named);
    sheet.append(top);

    const table = el('table', 'cl-table');
    const hr = el('tr');
    hr.append(el('th', 'num', '#'), el('th', '', t('colorList.colThread')), el('th', 'num', t('colorList.colStitches')), el('th', 'num', t('colorList.colThreadM')));
    if (compare) hr.append(el('th', 'cl-alt-head', t('colorList.colIn', { catalog: cat!.name })));
    table.append(el('thead'));
    table.tHead!.append(hr);
    const body = el('tbody');
    blocks.forEach((b, i) => {
      const tr = el('tr');
      tr.append(el('td', 'num', String(i + 1)), threadCell(b.color), el('td', 'num', formatNumber(b.stitches)), el('td', 'num', formatNumber(b.threadMm / 1000, 1)));
      if (compare) {
        const m = matches[i];
        const td = m ? threadCell(m.thread, t(`threads.dE.${closeness(m.dE)}`)) : el('td', 'muted', t('colorList.already'));
        td.classList.add('cl-alt');
        tr.append(td);
      }
      body.append(tr);
    });
    table.append(body);
    sheet.append(table);

    // Not printed: the brand to compare with, switching to it, printing.
    const actions = el('div', 'cl-actions');
    const label = el('label', 'cl-brand');
    label.append(el('span', '', t('colorList.brand')));
    const select = el('select');
    for (const c of all) select.append(new Option(c.name, c.id));
    select.value = cat?.id ?? '';
    select.addEventListener('change', () => {
      chooseCatalog(select.value);
      this.done = '';
      this.render();
    });
    label.append(select);
    actions.append(label);
    if (compare) {
      const sw = el('button', '', t('colorList.switch', { catalog: cat!.name }));
      sw.type = 'button';
      sw.title = t('colorList.switchHint');
      sw.addEventListener('click', () => {
        const colors = blocks.map((b, i) => {
          const m = matches[i];
          return m ? { ...m.thread } : b.color;
        });
        if (colors.every((c, i) => same(c, blocks[i].color))) return;
        this.done = t('colorList.switched', { catalog: cat!.name });
        this.info!.apply(colors);
      });
      actions.append(sw);
    }
    const print = el('button', 'primary', t('colorList.print'));
    print.type = 'button';
    print.addEventListener('click', () => window.print());
    actions.append(print);

    const note = el('p', 'muted small cl-note', this.done || (compare ? t('colorList.compareNote') : ''));
    note.setAttribute('role', 'status');
    note.hidden = !note.textContent;

    d.replaceChildren(head, sheet, note, actions);
  }
}

/** Swatch, maker and number, and name of a thread; `extra` says how close a suggested one comes. */
function threadCell(c: ThreadColor, extra = ''): HTMLTableCellElement {
  const td = el('td');
  const box = el('div', 'cl-thread');
  const sw = el('span', 'sw');
  sw.style.background = cssColor(c);
  const text = el('span', 'cl-thread-text');
  // A suggestion sits under the brand's name already: its number is enough.
  const code = extra ? threadNumber(c) : threadCode(c);
  text.append(el('strong', '', code || c.name || t('colorList.noName')));
  if (code && c.name) text.append(el('span', '', c.name));
  if (extra) text.append(el('span', 'muted', extra));
  box.append(sw, text);
  td.append(box);
  return td;
}

/** A small picture of the design: the threads drawn as lines on light ground. */
function thumbnail(p: Pattern): HTMLCanvasElement {
  const size = 180;
  const dpr = Math.max(2, window.devicePixelRatio || 1);
  const c = el('canvas', 'cl-thumb');
  c.width = c.height = size * dpr;
  c.style.width = c.style.height = `${size}px`;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const b = p.bounds;
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const pad = 8;
  const s = (size - 2 * pad) / Math.max(w, h);
  const ox = pad + (size - 2 * pad - w * s) / 2 - b.minX * s;
  const oy = pad + (size - 2 * pad - h * s) / 2 - b.minY * s;
  ctx.fillStyle = '#f4f2f6';
  ctx.fillRect(0, 0, size, size);
  ctx.lineWidth = Math.max(0.5, 4 * s);
  ctx.lineCap = 'round';
  const blk = blockIndex(p);
  const last = p.colors[p.colors.length - 1] ?? { r: 128, g: 128, b: 128 };
  let cur = -1;
  forEachThreadSegment(p, false, (x0, y0, x1, y1, end) => {
    if (blk[end] !== cur) {
      if (cur >= 0) ctx.stroke();
      cur = blk[end];
      ctx.strokeStyle = cssColor(p.colors[cur] ?? last);
      ctx.beginPath();
    }
    ctx.moveTo(ox + x0 * s, oy + y0 * s);
    ctx.lineTo(ox + x1 * s, oy + y1 * s);
  });
  if (cur >= 0) ctx.stroke();
  return c;
}
