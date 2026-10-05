#!/usr/bin/env node
// Converts Ink/Stitch embroidery fonts (github.com/inkstitch/embroidery-fonts) into the compact
// font files of heatstitch (public/fonts). Only the font data is read; no Ink/Stitch code is used.
//
//   node tools/fonts/convert.mjs <embroidery-fonts>/src [commit]
//
// A font is taken when its license allows shipping it with an MIT app and its embroidered results
// stay free (SIL OFL 1.1, public domain, CC BY), and when every element is something heatstitch can
// sew: satin columns, running stitch and plain fills. The guide lists the fonts with their licenses.

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { apply, compose, IDENTITY, lengthMm, parsePath, parseTransform, parseXml, shapeToPath, styleOf, walk } from './svg.mjs';

const [src, commit = ''] = process.argv.slice(2);
if (!src) {
  console.error('usage: node tools/fonts/convert.mjs <embroidery-fonts>/src [commit]');
  process.exit(1);
}
const OUT = new URL('../../public/fonts/', import.meta.url).pathname;
const R = (v) => Math.round(v * 100) / 100;

/** The license of a font, from its LICENSE file (font.json is not always right). */
function licenseOf(text) {
  const head = text.slice(0, 600);
  if (/NonCommercial|BY-NC|non-commercial/i.test(text)) return null;
  if (/BY-ND|NoDeriv/i.test(head)) return null;
  if (/BY-SA|by-sa|ShareAlike/i.test(head)) return null;
  if (/Open Font License|\bOFL\b/i.test(head)) return 'OFL-1.1';
  if (/GNU General Public License/i.test(head)) return null;
  if (/Attribution 4\.0|CC BY 4\.0/i.test(head)) return 'CC-BY-4.0';
  if (/public domain|CC0/i.test(head)) return 'Public Domain';
  if (/Open Font License/i.test(text)) return 'OFL-1.1';
  return null;
}

const SKIP_KEYWORDS = ['multicolor', 'crossstitch', 'tartan', 'applique', 'ripple'];
const STYLE = (kw) =>
  kw.includes('handwriting') ? 'script' : kw.includes('serif') ? 'serif' : kw.includes('sans_serif') ? 'sans' : 'display';

const isTrue = (v) => v === true || /^(true|1)$/i.test(String(v ?? ''));
const numOr = (v, d) => {
  const n = Number(v);
  return v === undefined || v === '' || !Number.isFinite(n) ? d : n;
};

/** Ramer-Douglas-Peucker on a polyline. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const l = Math.hypot(dx, dy);
    let best = -1;
    let bd = tol;
    for (let k = a + 1; k < b; k++) {
      const d = l ? Math.abs(dx * (ay - pts[k][1]) - dy * (ax - pts[k][0])) / l : Math.hypot(pts[k][0] - ax, pts[k][1] - ay);
      if (d > bd) {
        bd = d;
        best = k;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

const cum = (pts) => {
  const out = [0];
  for (let k = 1; k < pts.length; k++) out.push(out[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  return out;
};
const len = (pts) => cum(pts).pop();

/** Where segment a-b crosses the polyline: its arc length there, or null. */
function crossing(rail, c, a, b) {
  let best = null;
  for (let k = 1; k < rail.length; k++) {
    const p = rail[k - 1];
    const q = rail[k];
    const r = [b[0] - a[0], b[1] - a[1]];
    const s = [q[0] - p[0], q[1] - p[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p[0] - a[0]) * s[1] - (p[1] - a[1]) * s[0]) / den;
    const u = ((p[0] - a[0]) * r[1] - (p[1] - a[1]) * r[0]) / den;
    if (u < -1e-9 || u > 1 + 1e-9 || t < -0.25 || t > 1.25) continue;
    const d = Math.abs(t - 0.5);
    if (!best || d < best.d) best = { d, s: c[k - 1] + u * (c[k] - c[k - 1]) };
  }
  return best?.s ?? null;
}

/** Rails and rungs of a satin column from its subpaths (mm), or null. */
function satinFrom(subs, attrs) {
  if (subs.length < 2) return null;
  let rails;
  let rungLines = [];
  if (subs.length === 2) rails = subs;
  else {
    // Rungs are short pieces crossing two other subpaths; the rails are the two longest.
    const order = subs.map((s, k) => ({ s, k, l: len(s.pts) })).sort((a, b) => b.l - a.l);
    rails = [order[0].s, order[1].s];
    rungLines = order.slice(2).map((o) => o.s);
  }
  let [L, Rr] = rails.map((s) => ({ pts: s.pts.map((p) => p.slice()), nodes: s.nodes.slice() }));
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const flip = (r) => ({ pts: r.pts.slice().reverse(), nodes: r.nodes.map((n) => r.pts.length - 1 - n).reverse() });
  const rev = attrs['inkstitch:reverse_rails'];
  if (rev === 'first' || rev === 'both') L = flip(L);
  if (rev === 'second' || rev === 'both') Rr = flip(Rr);
  if (!rev || rev === 'automatic' || rev === 'auto') {
    const same = d(L.pts[0], Rr.pts[0]) + d(L.pts.at(-1), Rr.pts.at(-1));
    const cross = d(L.pts[0], Rr.pts.at(-1)) + d(L.pts.at(-1), Rr.pts[0]);
    if (cross < same) Rr = flip(Rr);
  }
  if (isTrue(attrs['inkstitch:swap_satin_rails'])) [L, Rr] = [Rr, L];
  const cl = cum(L.pts);
  const cr = cum(Rr.pts);
  const rungs = [];
  for (const line of rungLines) {
    const a = line.pts[0];
    const b = line.pts.at(-1);
    const sl = crossing(L.pts, cl, a, b);
    const sr = crossing(Rr.pts, cr, a, b);
    if (sl !== null && sr !== null) rungs.push([sl, sr]);
  }
  // Two rails with as many nodes: Ink/Stitch pairs their nodes.
  if (!rungLines.length && L.nodes.length === Rr.nodes.length && L.nodes.length > 2) {
    for (let k = 1; k < L.nodes.length - 1; k++) rungs.push([cl[L.nodes[k]], cr[Rr.nodes[k]]]);
  }
  rungs.sort((a, b) => a[0] - b[0]);
  // Simplified rails: the rungs move to the same place on them.
  const at = (pts, c, s) => {
    let k = 1;
    while (k < c.length - 1 && c[k] < s) k++;
    const t = c[k] > c[k - 1] ? (s - c[k - 1]) / (c[k] - c[k - 1]) : 0;
    return [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * t, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * t];
  };
  const ls = simplify(L.pts, 0.01);
  const rs = simplify(Rr.pts, 0.01);
  const cls = cum(ls);
  const crs = cum(rs);
  const near = (pts, c, q) => {
    let best = { d: Infinity, s: 0 };
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k - 1];
      const v = [pts[k][0] - p[0], pts[k][1] - p[1]];
      const l2 = v[0] * v[0] + v[1] * v[1];
      const t = l2 ? Math.max(0, Math.min(1, ((q[0] - p[0]) * v[0] + (q[1] - p[1]) * v[1]) / l2)) : 0;
      const dd = Math.hypot(p[0] + v[0] * t - q[0], p[1] + v[1] * t - q[1]);
      if (dd < best.d) best = { d: dd, s: c[k - 1] + t * (c[k] - c[k - 1]) };
    }
    return best.s;
  };
  const moved = rungs.map(([a, b]) => [R(near(ls, cls, at(L.pts, cl, a))), R(near(rs, crs, at(Rr.pts, cr, b)))]);
  if (ls.length < 2 || rs.length < 2) return null;
  return { left: ls, right: rs, rungs: moved };
}

function underOf(attrs) {
  const c = isTrue(attrs['inkstitch:center_walk_underlay']);
  const o = isTrue(attrs['inkstitch:contour_underlay']);
  const z = isTrue(attrs['inkstitch:zigzag_underlay']);
  if (o && z) return 'both';
  if (z) return 'zigzag';
  if (o) return 'contour';
  if (c) return 'center';
  return 'none';
}

const flat = (pts) => pts.flatMap(([x, y]) => [R(x), R(y)]);

/**
 * The elements of one glyph layer in sewing order, in mm: satin { k: 's', l, r, g, p },
 * running stitch { k: 'r', d, p }, fill { k: 'f', d: [loops], p }. Null with the reason when the
 * glyph has something heatstitch cannot sew.
 */
function glyphElements(layer, parent, base, mm, problems) {
  const out = [];
  const visit = (el, m) => {
    const st = styleOf(el);
    if (st.display === 'none' && el !== layer) return;
    const mt = compose(m, parseTransform(el.attrs.transform));
    if (el.name === 'g') {
      for (const c of el.children) visit(c, mt);
      return;
    }
    if (!['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'].includes(el.name)) return;
    const a = el.attrs;
    if (a['inkscape:connection-start'] || a['inkscape:connector-type']) return;
    const d = shapeToPath(el);
    if (!d) return;
    const toMm = (p) => {
      const [x, y] = apply(mt, p);
      return [x * mm, y * mm - base];
    };
    const subs = parsePath(d, 0.05 / mm).map((s) => ({ pts: s.pts.map(toMm), nodes: s.nodes, closed: s.closed }));
    if (!subs.length) return;
    const fillPaint = st.fill && st.fill !== 'none' && st.fill !== 'transparent' && !/opacity:0/.test(a.style ?? '');
    // A satin column with one rail is sewn as a stroke (Ink/Stitch does the same).
    if (isTrue(a['inkstitch:satin_column']) && subs.length >= 2) {
      const method = a['inkstitch:satin_method'] ?? 'satin_column';
      if (!['satin_column', 'e_stitch', 'zigzag'].includes(method)) problems.add(`satin ${method}`);
      const sat = satinFrom(subs, a);
      if (!sat) return problems.add('satin without rails');
      const p = {
        sp: R(numOr(a['inkstitch:zigzag_spacing_mm'], 0.4)),
        pc: R(numOr(String(a['inkstitch:pull_compensation_mm'] ?? '').split(/\s+/)[0], 0) / 2),
        u: underOf(a),
      };
      const pct = numOr(String(a['inkstitch:pull_compensation_percent'] ?? '').split(/\s+/)[0], 0);
      if (pct) p.ps = R(pct / 200);
      const split = numOr(a['inkstitch:max_stitch_length_mm'], 0);
      if (split > 0) p.sl = R(split);
      if (isTrue(a['inkstitch:e_stitch']) || method === 'e_stitch') p.e = 1;
      out.push({ k: 's', l: flat(sat.left), r: flat(sat.right), g: sat.rungs.flat(), p });
      return;
    }
    if (fillPaint) {
      const method = a['inkstitch:fill_method'] ?? 'auto_fill';
      if (!['auto_fill', 'legacy_fill', 'guided_fill'].includes(method)) problems.add(`fill ${method}`);
      const loops = subs.filter((s) => s.pts.length >= 3).map((s) => flat(simplify(s.pts, 0.01)));
      if (!loops.length) return;
      const staggers = numOr(a['inkstitch:staggers'], 4);
      const p = {
        sp: R(numOr(a['inkstitch:row_spacing_mm'], 0.25)),
        len: R(numOr(a['inkstitch:max_stitch_length_mm'], 3)),
        a: R((((-numOr(a['inkstitch:angle'], 0)) % 180) + 180) % 180),
        u: a['inkstitch:fill_underlay'] === undefined ? 1 : isTrue(a['inkstitch:fill_underlay']) ? 1 : 0,
      };
      if (staggers > 0) p.o = R(1 / staggers);
      const ex = numOr(a['inkstitch:expand_mm'], 0);
      if (ex) p.ex = R(ex);
      out.push({ k: 'f', d: loops, p });
      return;
    }
    if ((!st.stroke || st.stroke === 'none') && !isTrue(a['inkstitch:satin_column'])) return;
    const method = a['inkstitch:stroke_method'] ?? 'running_stitch';
    const manual = method === 'manual_stitch' || isTrue(a['inkstitch:manual_stitch']);
    if (!manual && method !== 'running_stitch') problems.add(`stroke ${method}`);
    const p = { len: R(numOr(a['inkstitch:running_stitch_length_mm'], 2.5)) };
    if (numOr(a['inkstitch:bean_stitch_repeats'], 0) >= 1) p.tr = 1;
    if (manual) p.m = 1;
    for (const s of subs) {
      if (s.pts.length < 2) continue;
      // Manual stitches are the nodes of the path, as drawn.
      const pts = manual ? s.nodes.map((n) => s.pts[n]) : simplify(s.pts, 0.01);
      out.push({ k: 'r', d: flat(pts), p });
    }
  };
  visit(layer, parent);
  return out;
}

/** The colors an element is drawn in, to tell multicolor fonts. */
function colorOf(el) {
  const st = styleOf(el);
  const c = isTrue(el.attrs['inkstitch:satin_column']) || !st.fill || st.fill === 'none' ? st.stroke : st.fill;
  return (c ?? '').toLowerCase();
}

/** Glyph layers of one variant: every SVG of it (a file, or a folder of files). */
function variantFiles(dir, names) {
  for (const n of names) {
    const f = join(dir, `${n}.svg`);
    if (existsSync(f)) return [f];
    const folder = join(dir, n);
    if (existsSync(folder) && statSync(folder).isDirectory())
      return readdirSync(folder)
        .filter((x) => x.endsWith('.svg'))
        .sort()
        .map((x) => join(folder, x));
  }
  return [];
}

const REF_CAPS = ['H', 'I', 'E', 'L', 'T', 'N', 'F'];
const REF_LOWER = ['l', 'h', 'k', 'd', 'b'];

function readVariant(files, problems) {
  const layers = new Map();
  let mm = 25.4 / 96;
  const guides = [];
  for (const f of files) {
    const root = parseXml(readFileSync(f, 'utf8'));
    const svg = [...walk(root)].find((e) => e.name === 'svg');
    const vb = (svg.attrs.viewBox ?? '').split(/[\s,]+/).map(Number);
    const wMm = lengthMm(svg.attrs.width);
    const hMm = lengthMm(svg.attrs.height);
    mm = vb.length === 4 && vb[2] > 0 && wMm ? wMm / vb[2] : 25.4 / 96;
    const pageH = vb.length === 4 && vb[3] > 0 ? vb[3] : hMm !== null ? hMm / mm : 0;
    for (const e of walk(root)) {
      if (e.name === 'sodipodi:guide' && e.attrs['inkscape:label'] === 'baseline') {
        const y = Number((e.attrs.position ?? '').split(',')[1]);
        if (Number.isFinite(y)) guides.push([pageH - y, y]);
      }
    }
    // Every glyph layer with the transform of the groups around it.
    const find = (el, m) => {
      for (const c of el.children) {
        if (c.name !== 'g') continue;
        const mt = compose(m, parseTransform(c.attrs.transform));
        const label = c.attrs['inkscape:label'] ?? '';
        if (label.startsWith('GlyphLayer-')) {
          const name = label.slice('GlyphLayer-'.length).normalize('NFC');
          if (!layers.has(name)) layers.set(name, { el: c, m, mm });
        } else find(c, mt);
      }
    };
    find(svg, IDENTITY);
  }
  // The baseline: the guide, if the bottom of a capital (or of a lowercase letter) agrees with it.
  const bottomOf = (name) => {
    const g = layers.get(name);
    if (!g) return null;
    const els = glyphElements(g.el, g.m, 0, g.mm, new Set());
    let maxY = -Infinity;
    let minY = Infinity;
    for (const e of els) for (const v of pointsOf(e)) {
      maxY = Math.max(maxY, v[1]);
      minY = Math.min(minY, v[1]);
    }
    return maxY > -Infinity ? { bottom: maxY, top: minY } : null;
  };
  const ref = [...REF_CAPS, ...REF_LOWER].map((n) => ({ n, b: bottomOf(n) })).find((r) => r.b);
  let base = ref ? ref.b.bottom : 0;
  if (ref && guides.length) {
    const h = ref.b.bottom - ref.b.top;
    const cand = guides.flat().map((g) => g * mm).sort((a, b) => Math.abs(a - ref.b.bottom) - Math.abs(b - ref.b.bottom))[0];
    if (Math.abs(cand - ref.b.bottom) < 0.08 * h) base = cand;
  }
  const glyphs = new Map();
  for (const [name, g] of layers) {
    const local = new Set();
    const shifted = glyphElements(g.el, g.m, base, g.mm, local);
    const colors = new Map();
    for (const e of walk(g.el)) if (['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line'].includes(e.name) && !e.attrs['inkscape:connection-start']) {
      const c = colorOf(e);
      if (c && c !== 'none') colors.set(c, (colors.get(c) ?? 0) + 1);
    }
    for (const p of local) problems.add(p);
    glyphs.set(name, { els: shifted, colors });
  }
  return { glyphs, mm };
}

function* pointsOf(e) {
  const pairs = function* (a) {
    for (let k = 0; k + 1 < a.length; k += 2) yield [a[k], a[k + 1]];
  };
  if (e.k === 's') {
    yield* pairs(e.l);
    yield* pairs(e.r);
  } else if (e.k === 'r') yield* pairs(e.d);
  else for (const l of e.d) yield* pairs(l);
}

function extent(els) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const e of els) for (const [x, y] of pointsOf(e)) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

// ------------------------------------------------------------------------------------------------

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'licenses'), { recursive: true });
const catalog = [];
const report = [];
const converted = new Set();
for (const id of readdirSync(src).sort()) {
  const dir = join(src, id);
  if (!statSync(dir).isDirectory()) continue;
  let meta;
  try {
    meta = JSON.parse(readFileSync(join(dir, 'font.json'), 'utf8'));
  } catch {
    report.push([id, 'no font.json']);
    continue;
  }
  const licFile = readdirSync(dir).find((f) => /^license/i.test(f));
  const licText = licFile ? readFileSync(join(dir, licFile), 'utf8') : '';
  const license = licenseOf(licText);
  if (!license) {
    report.push([id, 'license']);
    continue;
  }
  const kw = (meta.keywords ?? []).map(String);
  const skip = SKIP_KEYWORDS.find((k) => kw.includes(k));
  if (skip) {
    report.push([id, skip]);
    continue;
  }
  if ((meta.text_direction ?? 'ltr') !== 'ltr') {
    report.push([id, 'right to left']);
    continue;
  }
  if (meta.auto_satin === true) {
    report.push([id, 'auto satin']);
    continue;
  }
  const problems = new Set();
  const fwd = readVariant(variantFiles(dir, ['→', 'ltr']), problems);
  if (!fwd.glyphs.size) {
    report.push([id, 'no glyphs']);
    continue;
  }
  // Small and tiny copies of a font only differ in the size range Ink/Stitch allows; heatstitch
  // sews every font for the height asked for, so the font itself is enough.
  if (id === 'mimosa_large') {
    report.push([id, 'same as mimosa_medium']);
    continue;
  }
  const SAME = { apex_simple_small_AGS: 'apex_simple_AGS', auberge_small: 'auberge_marif', excalibur_small: 'excalibur_KOR', magnolia_small: 'magnolia_KOR' };
  const base = SAME[id] ?? id.replace(/_(small|Small|tiny)$/, '');
  if (base !== id && existsSync(join(src, base)) && converted.has(base)) {
    report.push([id, `same as ${base}`]);
    continue;
  }
  if (problems.size) {
    report.push([id, [...problems].join(', ')]);
    continue;
  }
  // One thread: a stray element in another color (a guide, a marker) does not make a multicolor font.
  const colors = new Map();
  for (const g of fwd.glyphs.values()) for (const [c, n] of g.colors) colors.set(c, (colors.get(c) ?? 0) + n);
  const counts = [...colors.values()].sort((a, b) => b - a);
  const all = counts.reduce((a, b) => a + b, 0);
  if (counts.length > 1 && counts[1] > all * 0.03) {
    report.push([id, `${colors.size} colors`]);
    continue;
  }
  const mm = fwd.mm;
  const adv = meta.horiz_adv_x ?? {};
  const glyphs = {};
  for (const [name, g] of fwd.glyphs) {
    if ([...name].length !== 1 || !g.els.length) continue;
    const ex = extent(g.els);
    const a = adv[name] ?? meta.horiz_adv_x_default ?? ex.maxX / mm;
    glyphs[name] = { a: R(Number(a) * mm), x0: R(ex.minX), x1: R(ex.maxX), y0: R(ex.minY), y1: R(ex.maxY), e: g.els };
  }
  const names = Object.keys(glyphs);
  const latin = names.filter((n) => /^[A-Za-z]$/.test(n)).length;
  if (latin < 20) {
    report.push([id, `${latin} latin letters`]);
    continue;
  }
  const kerning = {};
  for (const [k, v] of Object.entries(meta.kerning_pairs ?? {})) {
    const parts = k.includes(' ') ? k.split(' ') : [...k];
    if (parts.length !== 2 || !glyphs[parts[0]] || !glyphs[parts[1]]) continue;
    const mmv = R(Number(v) * mm);
    if (Math.abs(mmv) >= 0.02) kerning[parts[0] + parts[1]] = mmv;
  }
  const capRef = REF_CAPS.find((n) => glyphs[n]) ?? REF_LOWER.find((n) => glyphs[n]);
  const capHeight = capRef ? R(-glyphs[capRef].y0) : R(Math.max(...names.map((n) => -glyphs[n].y0)));
  const font = {
    v: 1,
    id,
    name: meta.name ?? id,
    cap: capHeight,
    caps: !!REF_CAPS.find((n) => glyphs[n]),
    lead: R(numOr(meta.leading, 100) * mm),
    space: R(numOr(meta.horiz_adv_x_space, 20) * mm),
    case: meta.letter_case || undefined,
    min: numOr(meta.min_scale, 1),
    max: numOr(meta.max_scale, 1),
    glyphs,
    kern: kerning,
    // Lines sewn back and forth: the glyphs walked the other way (made when sewing).
    rev: meta.reversible !== false,
  };
  const json = JSON.stringify(font);
  // Large ornamental fonts would take too long to load for what they are.
  if (json.length > 2.5 * 1024 * 1024) {
    report.push([id, `too large (${Math.round(json.length / 1024)} KB)`]);
    continue;
  }
  writeFileSync(join(OUT, `${id}.json`), json);
  converted.add(id);
  writeFileSync(join(OUT, 'licenses', `${id}.txt`), licText);
  const upper = names.some((n) => n !== n.toLowerCase());
  const lower = names.some((n) => n !== n.toUpperCase());
  catalog.push({
    id,
    name: font.name,
    style: STYLE(kw),
    small: kw.includes('tiny') || undefined,
    script: kw.includes('handwriting') || undefined,
    // The height the font was digitized for, and the range it looks good in (mm).
    cap: capHeight,
    good: [R(capHeight * font.min), R(capHeight * font.max)],
    license,
    source: meta.original_font || undefined,
    chars: names.sort().join(''),
    cases: upper && lower ? 'Aa' : upper ? 'A' : 'a',
    kb: Math.round(json.length / 1024),
  });
  report.push([id, `ok ${names.length} glyphs, cap ${capHeight} mm (font.json size ${meta.size}), ${Math.round(json.length / 1024)} KB`]);
}
catalog.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ source: 'https://github.com/inkstitch/embroidery-fonts', commit, fonts: catalog }, null, 1));
for (const [id, r] of report) console.log(`${id.padEnd(32)} ${r}`);
console.log(`\n${catalog.length} fonts written to public/fonts`);
