import { formatNumber, getLang, t, type Key } from '../../i18n';
import type { Hoop } from '../../model/hoop';
import { blockIndex, colorBlocks, sewingSeconds } from '../../model/sequence';
import { forEachThreadSegment, patternStats, type Pattern, type ThreadColor } from '../../model/pattern';
import { hoopRect } from '../../render/hoop';
import { BROTHER, catalogOf, catalogPicked, catalogsNow, chosenCatalog, closeness, inCatalog, nearest, threadCode, threadNumber, type Catalog } from '../../threads/catalog';
import type { Profile } from '../../validation/profiles';
import type { Basis } from './recipes';
import type { CardView, Note } from './card';
import { spriteMarkup } from './icons';

/**
 * The printable stitch sheet: page 1 the design at true size (1:1 in mm) with crosshair, center,
 * "top" arrow, hoop outline and a ruler to check the print scale, split over several sheets when
 * it is larger than one; then the colors in sewing order to tick off, with the numbers of the
 * chosen thread brand, stitches and time, and the card "Bereit zum Sticken".
 *
 * It opens as a page of its own in a new window (no dialog in the app): the user looks at it and
 * prints from there. Sizes are in mm and the page has 10 mm margins, so A4 and Letter both take it
 * at 100 % without the browser shrinking it.
 */
export interface SheetInput {
  pattern: Pattern;
  name: string;
  hoop: Hoop | null;
  profile: Profile;
  /** Machine speed for the times (the user's own setting). */
  spm: number;
  card: CardView;
}

/** Room for the drawing on one sheet (mm): 190 wide, leaving head and ruler on A4 and Letter. */
export const BOX = { w: 190, h: 212 };
/** One sheet of several: less high, as the note on how to join them takes room too. */
const TILE = { w: 190, h: 188 };
/** Tiles overlap by this much (mm). */
const OVERLAP = 10;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const n1 = (v: number) => Math.round(v * 100) / 100;
const mm = (v: number) => formatNumber(v, Number.isInteger(Math.round(v * 10) / 10) ? 0 : 1);
const css = (c: ThreadColor) => `rgb(${c.r},${c.g},${c.b})`;
const minutes = (s: number) => t('stats.minutes', { m: formatNumber(s / 60, 1) });
const ico = (name: string) => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const tag = (b: Basis | undefined) => (!b || b === 'source' ? '' : ` <span class="tag">${esc(t(`ready.basis.${b}` as Key))}</span>`);
const note = (n: Note) => `<small>${esc(n.text)}${tag(n.basis)}</small>`;

/** Where the drawing lies and how it is split into sheets. */
export function layout(p: Pattern, hoop: Hoop | null): { area: Rect; tiles: Rect[]; cols: number; rows: number; hoop: Rect | null; hoopWhole: boolean } {
  const b = p.bounds;
  const d = { x: b.minX / 10, y: b.minY / 10, w: (b.maxX - b.minX) / 10, h: (b.maxY - b.minY) / 10 };
  // Room for the crosshair's arms and, above, the arrow.
  let area: Rect = { x: d.x - 12, y: d.y - 20, w: d.w + 24, h: d.h + 32 };
  const hr = hoop ? hoopRect(b, hoop) : null;
  if (hr) {
    const x0 = Math.min(area.x, hr.x - 3);
    const y0 = Math.min(area.y, hr.y - 3);
    const x1 = Math.max(area.x + area.w, hr.x + hr.w + 3);
    const y1 = Math.max(area.y + area.h, hr.y + hr.h + 3);
    // The whole hoop when it fits on a sheet, otherwise the design alone (the hoop's edge where near).
    if (x1 - x0 <= BOX.w && y1 - y0 <= BOX.h) area = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const hoopWhole = !!hr && hr.x >= area.x && hr.y >= area.y && hr.x + hr.w <= area.x + area.w && hr.y + hr.h <= area.y + area.h;
  if (area.w <= BOX.w && area.h <= BOX.h) return { area, tiles: [area], cols: 1, rows: 1, hoop: hr, hoopWhole };
  const stepX = TILE.w - OVERLAP;
  const stepY = TILE.h - OVERLAP;
  const cols = Math.max(1, Math.ceil((area.w - OVERLAP) / stepX));
  const rows = Math.max(1, Math.ceil((area.h - OVERLAP) / stepY));
  const x0 = area.x - (cols * stepX + OVERLAP - area.w) / 2;
  const y0 = area.y - (rows * stepY + OVERLAP - area.h) / 2;
  const tiles: Rect[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tiles.push({ x: x0 + c * stepX, y: y0 + r * stepY, w: TILE.w, h: TILE.h });
  return { area: { x: x0, y: y0, w: cols * stepX + OVERLAP, h: rows * stepY + OVERLAP }, tiles, cols, rows, hoop: hr, hoopWhole };
}

/** The stitches as SVG paths in mm, one per color block; light threads get a grey edge to show on paper. */
function designPaths(p: Pattern): string {
  const blk = blockIndex(p);
  const parts: string[][] = p.colors.map(() => []);
  const fallback = p.colors.length - 1;
  let lastEnd = -1;
  let lx = NaN;
  let ly = NaN;
  forEachThreadSegment(p, false, (x0, y0, x1, y1, end) => {
    const b = Math.min(blk[end], Math.max(0, fallback));
    const list = (parts[b] ??= []);
    if (end - 1 !== lastEnd || x0 !== lx || y0 !== ly) list.push(`M${n1(x0 / 10)} ${n1(y0 / 10)}`);
    list.push(`L${n1(x1 / 10)} ${n1(y1 / 10)}`);
    lastEnd = end;
    lx = x1;
    ly = y1;
  });
  return parts
    .map((list, i) => {
      if (!list.length) return '';
      const c = p.colors[i] ?? { r: 128, g: 128, b: 128 };
      const light = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 205;
      const d = list.join('');
      return (light ? `<path d="${d}" stroke="#8a8a8a" stroke-width="0.6"/>` : '') + `<path d="${d}" stroke="${css(c)}" stroke-width="0.4"/>`;
    })
    .join('');
}

/** Crosshair, center, arrow "top", hoop and the overlap lines, in mm over the whole area. */
function guides(p: Pattern, l: ReturnType<typeof layout>): string {
  const b = p.bounds;
  const cx = (b.minX + b.maxX) / 20;
  const cy = (b.minY + b.maxY) / 20;
  const a = l.area;
  const out: string[] = [];
  if (l.hoop) {
    const r = l.hoop;
    out.push(`<rect class="hoop" x="${n1(r.x)}" y="${n1(r.y)}" width="${r.w}" height="${r.h}" rx="6"/>`);
  }
  out.push(`<path class="cross" d="M${n1(cx)} ${n1(a.y)}V${n1(a.y + a.h)}M${n1(a.x)} ${n1(cy)}H${n1(a.x + a.w)}"/>`);
  // Ticks every 10 mm along the crosshair, to place and to check.
  const ticks: string[] = [];
  for (let v = 10; cy - v >= a.y || cy + v <= a.y + a.h || cx - v >= a.x || cx + v <= a.x + a.w; v += 10) {
    const s = v % 50 === 0 ? 2.5 : 1.5;
    for (const y of [cy - v, cy + v]) if (y >= a.y && y <= a.y + a.h) ticks.push(`M${n1(cx - s)} ${n1(y)}h${2 * s}`);
    for (const x of [cx - v, cx + v]) if (x >= a.x && x <= a.x + a.w) ticks.push(`M${n1(x)} ${n1(cy - s)}v${2 * s}`);
    if (v > 2000) break;
  }
  if (ticks.length) out.push(`<path class="tick" d="${ticks.join('')}"/>`);
  out.push(`<circle class="center" cx="${n1(cx)}" cy="${n1(cy)}" r="2"/><circle cx="${n1(cx)}" cy="${n1(cy)}" r="0.5" fill="#000"/>`);
  const top = b.minY / 10;
  const tip = top - 17;
  out.push(
    `<path class="arrow" d="M${n1(cx)} ${n1(top - 5)}V${n1(tip)}M${n1(cx - 2.4)} ${n1(tip + 3.6)}L${n1(cx)} ${n1(tip)}L${n1(cx + 2.4)} ${n1(tip + 3.6)}"/>`,
    `<text class="up" x="${n1(cx + 3)}" y="${n1(tip + 3.2)}">${esc(t('ready.sheet.up'))}</text>`,
  );
  // Where the next sheet starts and the one before ends.
  const lines: string[] = [];
  const t0 = l.tiles[0];
  for (let c = 1; c < l.cols; c++) {
    const x = t0.x + c * (TILE.w - OVERLAP);
    lines.push(`M${n1(x)} ${n1(a.y)}V${n1(a.y + a.h)}M${n1(x + OVERLAP)} ${n1(a.y)}V${n1(a.y + a.h)}`);
  }
  for (let r = 1; r < l.rows; r++) {
    const y = t0.y + r * (TILE.h - OVERLAP);
    lines.push(`M${n1(a.x)} ${n1(y)}H${n1(a.x + a.w)}M${n1(a.x)} ${n1(y + OVERLAP)}H${n1(a.x + a.w)}`);
  }
  if (lines.length) out.push(`<path class="seam" d="${lines.join('')}"/>`);
  return out.join('');
}

/** A 5 cm ruler with mm ticks and a 1 inch bar under it, to check the print scale. */
function ruler(): string {
  const ticks: string[] = [];
  const labels: string[] = [];
  for (let i = 0; i <= 50; i++) {
    const len = i % 10 === 0 ? 4 : i % 5 === 0 ? 2.8 : 1.6;
    ticks.push(`M${i + 1} 1v${len}`);
    if (i % 10 === 0) labels.push(`<text x="${i + 1}" y="8.6">${i / 10}</text>`);
  }
  return `<svg class="ruler" width="56mm" height="16mm" viewBox="0 0 56 16" aria-hidden="true">
<path d="M1 1h50" stroke="#000" stroke-width="0.3"/><path d="${ticks.join('')}" stroke="#000" stroke-width="0.2"/>${labels.join('')}<text x="52.5" y="4.4">cm</text>
<rect x="1" y="11" width="25.4" height="2.4" fill="#000"/><text x="28" y="13.4">${esc(t('ready.sheet.inch'))}</text></svg>`;
}

function headLine(name: string, right: string, sub: string[]): string {
  return `<header class="head"><div><h1>${esc(name)}</h1><p>${sub.map(esc).join(' · ')}</p></div><div class="right">${esc(right)}</div></header>`;
}

/** The brand whose numbers the list shows: the chosen one, else the one most threads come from. */
function brandOf(colors: ThreadColor[]): Catalog | undefined {
  return (catalogPicked() ? undefined : catalogOf(colors)) ?? catalogsNow().find((c) => c.id === chosenCatalog()) ?? catalogsNow().find((c) => c.id === BROTHER);
}

function threadCell(c: ThreadColor): string {
  const code = threadCode(c);
  const name = c.name ?? '';
  return `<span class="sw" style="background:${css(c)}"></span><span class="tt"><b>${esc(code || name || t('colorList.noName'))}</b>${code && name ? `<span>${esc(name)}</span>` : ''}</span>`;
}

function colorPage(i: SheetInput, sub: string[]): string {
  const p = i.pattern;
  const blocks = colorBlocks(p);
  const st = patternStats(p);
  const cat = brandOf(blocks.map((b) => b.color));
  const matches = blocks.map((b) => (cat && !inCatalog(b.color, cat) ? nearest(b.color, cat, 1)[0] : undefined));
  const compare = !!cat && matches.some(Boolean);
  const rows = blocks
    .map((b, k) => {
      const m = matches[k];
      const alt = !compare
        ? ''
        : `<td class="alt">${m ? `<span class="sw" style="background:${css(m.thread)}"></span><span class="tt"><b>${esc(threadNumber(m.thread) || m.thread.name || '')}</b><span>${esc(t(`threads.dE.${closeness(m.dE)}` as Key))}</span></span>` : `<span class="muted">${esc(t('colorList.already'))}</span>`}</td>`;
      return `<tr><td class="box"><span></span></td><td class="num">${k + 1}</td><td class="th">${threadCell(b.color)}</td>${alt}<td class="num">${formatNumber(b.stitches)}</td><td class="num">${minutes(sewingSeconds(b.stitches, b.trims, 0, i.spm))}</td></tr>`;
    })
    .join('');
  const total = sewingSeconds(st.stitches, st.trims, st.colorChanges, i.spm);
  const head = `<tr><th class="box"><span class="sr">${esc(t('ready.sheet.colDone'))}</span></th><th class="num">#</th><th>${esc(t('ready.sheet.colThread'))}</th>${compare ? `<th>${esc(t('ready.sheet.colIn', { catalog: cat!.name }))}</th>` : ''}<th class="num">${esc(t('ready.sheet.colStitches'))}</th><th class="num">${esc(t('ready.sheet.colTime'))}</th></tr>`;
  const foot = `<tr class="sum"><td></td><td></td><td colspan="${compare ? 2 : 1}">${esc(t('ready.sheet.total'))}</td><td class="num">${formatNumber(st.stitches)}</td><td class="num">${minutes(total)}</td></tr>`;

  const c = i.card;
  const recipe = c.rows
    .map(
      (r) =>
        `<tr><td class="box"><span></span></td><td class="ic">${ico(r.icon)}</td><th>${esc(r.label)}</th><td>${r.step ? `<span class="meter" data-step="${r.step}"><i></i><i></i><i></i></span>` : ''}${esc(r.value)}${tag(r.basis)}${r.notes.map(note).join('')}</td></tr>`,
    )
    .join('');
  const hints = c.hints.length ? `<ul class="hints">${c.hints.map((x) => `<li>${ico(x.level === 'warn' ? 'ready-alert' : 'ready-tip')}<span>${esc(x.text)}${tag(x.basis)}</span></li>`).join('')}</ul>` : '';
  const tips = `<ul class="tips"><li>${ico('ready-hoop')}<span>${esc(c.hooping.text)}${tag(c.hooping.basis)}</span></li>${c.tips.map((x) => `<li>${ico('ready-tip')}<span>${esc(x.text)}${tag(x.basis)}</span></li>`).join('')}</ul>`;

  return `<section class="page colors">
${headLine(i.name, t('ready.sheet.title'), sub)}
<div class="two">
<div class="grow">
<h2>${esc(t('ready.sheet.colors'))}</h2>
<table class="list"><thead>${head}</thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot></table>
<p class="small muted">${esc(t('ready.sheet.timeNote', { spm: formatNumber(i.spm) }))}</p>
</div>
<figure class="overview"><svg viewBox="${n1(p.bounds.minX / 10 - 2)} ${n1(p.bounds.minY / 10 - 2)} ${n1((p.bounds.maxX - p.bounds.minX) / 10 + 4)} ${n1((p.bounds.maxY - p.bounds.minY) / 10 + 4)}" preserveAspectRatio="xMidYMid meet"><use href="#hs-design"/></svg><figcaption>${esc(t('ready.sheet.overview'))}</figcaption></figure>
</div>
<h2>${esc(t('ready.title'))}</h2>
<p class="small">${esc(t('ready.sheet.material', { fabric: t(`fabric.${i.profile.fabric}` as Key), thread: i.profile.thread }))}</p>
<table class="recipe">${recipe}</table>
${hints}
${tips}
<p class="small muted">${esc(t('ready.note'))} ${esc(t('ready.legend'))}</p>
<h2>${esc(t('ready.sheet.notes'))}</h2>
<div class="notes"></div>
</section>`;
}

const STYLE = `
@page { margin: 10mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 10pt/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #000; background: #e9e6ee; }
.bar { position: sticky; top: 0; z-index: 1; display: flex; gap: 12px; align-items: center; justify-content: center; padding: 10px 16px; background: #fff; border-bottom: 1px solid #ddd; font-size: 13px; color: #333; }
.bar button { font: inherit; font-weight: 600; padding: 7px 16px; border-radius: 6px; border: 0; background: #b5317a; color: #fff; cursor: pointer; }
.bar button:focus-visible { outline: 2px solid #1d1a22; outline-offset: 2px; }
.bar p { margin: 0; max-width: 640px; }
.page { width: 210mm; margin: 12px auto; padding: 10mm; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.15); }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm; border-bottom: 0.3mm solid #000; padding-bottom: 2mm; margin-bottom: 3mm; }
.head h1 { margin: 0; font-size: 13pt; }
.head p { margin: 0.5mm 0 0; color: #444; }
.head .right { font-weight: 600; white-space: nowrap; }
.warn { margin: 0 0 3mm; padding: 2mm 3mm; border: 0.3mm solid #000; border-radius: 1.5mm; }
.drawing { display: block; margin: 0 auto; overflow: hidden; }
.drawing .d path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.hoop { fill: none; stroke: #555; stroke-width: 0.35; stroke-dasharray: 3 2; }
.cross { fill: none; stroke: #000; stroke-width: 0.2; stroke-dasharray: 5 1.5 1 1.5; }
.tick { stroke: #000; stroke-width: 0.2; }
.center { fill: none; stroke: #000; stroke-width: 0.3; }
.arrow { fill: none; stroke: #000; stroke-width: 0.5; stroke-linecap: round; stroke-linejoin: round; }
.up { font-size: 3.6px; font-weight: 700; }
.seam { fill: none; stroke: #000; stroke-width: 0.25; stroke-dasharray: 0.6 1.2; }
.foot { display: flex; align-items: center; gap: 4mm; margin-top: 3mm; }
.foot p { margin: 0; font-size: 8.5pt; color: #333; }
.ruler { flex: none; }
.ruler text { font-size: 3px; }
h2 { font-size: 11pt; margin: 5mm 0 2mm; }
.small { font-size: 8.5pt; }
.muted { color: #555; }
.two { display: flex; gap: 6mm; align-items: flex-start; }
.grow { flex: 1; min-width: 0; }
.overview { flex: none; width: 42mm; margin: 5mm 0 0; text-align: center; }
.overview svg { width: 42mm; height: 42mm; border: 0.2mm solid #bbb; border-radius: 1mm; }
.overview svg path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.overview figcaption { font-size: 7.5pt; color: #555; margin-top: 1mm; }
table { border-collapse: collapse; width: 100%; }
.list th, .list td { padding: 1.2mm 1.5mm; border-bottom: 0.2mm solid #bbb; text-align: left; vertical-align: middle; }
.list th { font-size: 8.5pt; font-weight: 600; border-bottom: 0.3mm solid #000; }
.list tr { break-inside: avoid; }
.list .sum td { font-weight: 600; border-bottom: 0; border-top: 0.3mm solid #000; }
.num { text-align: right !important; font-variant-numeric: tabular-nums; white-space: nowrap; }
.box { width: 7mm; }
.box span { display: inline-block; width: 4mm; height: 4mm; border: 0.3mm solid #000; border-radius: 0.6mm; vertical-align: middle; }
.th, .alt { white-space: nowrap; }
.sw { display: inline-block; width: 5mm; height: 5mm; border-radius: 1mm; border: 0.2mm solid rgba(0,0,0,.35); vertical-align: middle; margin-right: 2mm; }
.tt { display: inline-flex; flex-direction: column; vertical-align: middle; line-height: 1.2; }
.tt span { font-size: 8pt; color: #444; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.recipe th, .recipe td { padding: 1.3mm 1.5mm; border-bottom: 0.2mm solid #ccc; text-align: left; vertical-align: top; }
.recipe th { width: 24mm; font-weight: 600; }
.recipe .ic { width: 6mm; }
.recipe small { display: block; color: #444; font-size: 8.5pt; }
.recipe tr { break-inside: avoid; }
.i { width: 4.2mm; height: 4.2mm; fill: none; stroke: #000; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; vertical-align: -1mm; flex: none; }
.i .fill { fill: #000; stroke: none; }
.tag { font-size: 7.5pt; border: 0.2mm solid #777; border-radius: 0.8mm; padding: 0 0.8mm; color: #333; white-space: nowrap; }
.meter { display: inline-flex; gap: 0.6mm; margin-right: 1.5mm; vertical-align: 0.2mm; }
.meter i { width: 1.4mm; height: 2.6mm; border: 0.2mm solid #000; border-radius: 0.3mm; }
.meter[data-step="3"] i, .meter[data-step="2"] i:nth-child(-n+2), .meter[data-step="1"] i:first-child { background: #000; }
.hints, .tips { list-style: none; padding: 0; margin: 2mm 0; }
.hints li, .tips li { display: flex; gap: 2mm; margin: 1.2mm 0; break-inside: avoid; }
.notes { height: 30mm; background: repeating-linear-gradient(to bottom, transparent 0, transparent 7.3mm, #bbb 7.3mm, #bbb 7.5mm); }
@media print {
  body { background: #fff; }
  .bar { display: none; }
  .page { width: auto; margin: 0; padding: 0; box-shadow: none; break-after: page; }
  .page:last-child { break-after: auto; }
}
`;

/** The whole sheet as one HTML document. */
export function sheetHtml(i: SheetInput): string {
  const p = i.pattern;
  const l = layout(p, i.hoop);
  const b = p.bounds;
  const w = (b.maxX - b.minX) / 10;
  const hgt = (b.maxY - b.minY) / 10;
  const turned = !!i.hoop && !!l.hoop && l.hoop.w !== i.hoop.w;
  const sub = [
    t('ready.sheet.size', { w: mm(w), h: mm(hgt) }),
    i.hoop ? t(turned ? 'ready.sheet.hoopTurned' : 'ready.sheet.hoop', { w: i.hoop.w, h: i.hoop.h }) : t('ready.sheet.noHoop'),
    t(`fabric.${i.profile.fabric}` as Key),
  ];
  const n = l.tiles.length;
  const pages = l.tiles
    .map((tile, k) => {
      const r = Math.floor(k / l.cols) + 1;
      const c = (k % l.cols) + 1;
      const notes: string[] = [];
      if (n > 1) notes.push(`<p class="warn">${ico('ready-alert')} ${esc(t('ready.sheet.tiles', { n }))}</p>`);
      if (l.hoop && !l.hoopWhole && k === 0) notes.push(`<p class="small muted">${esc(t('ready.sheet.hoopPart'))}</p>`);
      const right = n > 1 ? t('ready.sheet.tile', { i: k + 1, n, r, c }) : t('ready.sheet.template');
      return `<section class="page template">
${headLine(i.name, right, sub)}
${notes.join('')}
<svg class="drawing" width="${n1(tile.w)}mm" height="${n1(tile.h)}mm" viewBox="${n1(tile.x)} ${n1(tile.y)} ${n1(tile.w)} ${n1(tile.h)}"><use href="#hs-design"/><g>${guides(p, l)}</g></svg>
<div class="foot">${ruler()}<p>${esc(t('ready.sheet.ruler'))}</p></div>
</section>`;
    })
    .join('');
  const title = `${t('ready.sheet.title')}: ${i.name}`;
  return `<!doctype html>
<html lang="${getLang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body>
${spriteMarkup()}
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><g id="hs-design" class="d" fill="none" stroke-linecap="round" stroke-linejoin="round">${designPaths(p)}</g></defs></svg>
<div class="bar"><button type="button" id="print">${esc(t('ready.sheet.print'))}</button><p>${esc(t('ready.sheet.howto'))}</p></div>
${pages}
${colorPage(i, sub)}
<script>document.getElementById('print').addEventListener('click', function () { window.print(); });</script>
</body></html>`;
}

/**
 * Opens the sheet in a new window. When the browser blocks new windows, it goes straight to the
 * print dialog through a hidden frame instead, and `onBlocked` says so.
 */
export function openSheet(i: SheetInput, onBlocked: () => void): void {
  const html = sheetHtml(i);
  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    return;
  }
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  frame.srcdoc = html;
  frame.addEventListener('load', () => {
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  });
  document.body.append(frame);
  onBlocked();
}
