// Converts Hershey Sans 1-stroke (the Hershey fonts as SVG font by Evil Mad Scientist, with their
// Latin-1 additions) into a heatstitch font: every letter a single line, sewn as triple (bean)
// stitch so that small text reads where a satin is too narrow to sew. convert.mjs calls it, so the
// font stays when the Ink/Stitch fonts are converted again; on its own:
//
//   node tools/fonts/hershey.mjs
//
// A letter's strokes become one route, as auto-routed running stitch does it (Ink/Stitch's
// "Auto-Route Running Stitch", the Chinese postman problem): the strokes are cut where they meet
// or cross, and wherever a pen would have to lift, the shortest way back along strokes already
// sewn is doubled as a plain running stitch, hidden under the triple stitch. Only strokes that do
// not touch at all (the dot on the i) are joined by a jump.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePath, parseXml, walk } from './svg.mjs';

const SRC = new URL('./hershey/HersheySans1.svg', import.meta.url).pathname;
const R = (v) => Math.round(v * 100) / 100;

export const HERSHEY_ID = 'hershey_sans';
/** Capitals in font units, and the height (mm) the font is stored at. */
const CAP_UNITS = 662;
const CAP_MM = 5;
/** The EMS file moves every letter 3 Hershey units (94.5) to the right of its advance. */
const SHIFT = 94.5;
/** Stitch length of the triple stitch and of the way back under it (mm): short, the letters are small. */
const LEN = 1;
/** Satin dots (mm, at the stored height): their size, the loops taken for dots, the spacing of their stitches. */
const DOT = 0.9;
const DOT_LOOP = (100 * CAP_MM) / CAP_UNITS;
const DOT_SPACING = 0.2;
/** Points closer than this (mm) are one. */
const EPS = 0.03;
/** A stroke ending this close to another (half a Hershey unit) meets it: the data is on a coarse grid. */
const TOUCH = (15.75 * CAP_MM) / CAP_UNITS;

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Where segment a0-a1 meets segment b0-b1, as parameters on both (touching ends included), or null. */
function meet(a0, a1, b0, b1) {
  const r = [a1[0] - a0[0], a1[1] - a0[1]];
  const s = [b1[0] - b0[0], b1[1] - b0[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  const la = Math.hypot(...r);
  const lb = Math.hypot(...s);
  if (Math.abs(den) < 1e-12) return null;
  const q = [b0[0] - a0[0], b0[1] - a0[1]];
  const t = (q[0] * s[1] - q[1] * s[0]) / den;
  const u = (q[0] * r[1] - q[1] * r[0]) / den;
  const ta = EPS / (la || 1);
  const tb = EPS / (lb || 1);
  if (t < -ta || t > 1 + ta || u < -tb || u > 1 + tb) return null;
  return [Math.min(1, Math.max(0, t)), Math.min(1, Math.max(0, u))];
}

/** Parameter of the point on segment a0-a1 nearest p, when it lies on it. */
function onSegment(p, a0, a1) {
  const d = [a1[0] - a0[0], a1[1] - a0[1]];
  const l2 = d[0] * d[0] + d[1] * d[1];
  if (!l2) return null;
  const t = ((p[0] - a0[0]) * d[0] + (p[1] - a0[1]) * d[1]) / l2;
  if (t < 0 || t > 1) return null;
  return dist(p, lerp(a0, a1, t)) <= EPS ? t : null;
}

/** Stroke ends moved onto the stroke they nearly touch (a corner of it first). */
function snapEnds(strokes) {
  const out = strokes.map((s) => s.map((p) => [...p]));
  out.forEach((s, i) => {
    for (const end of [0, s.length - 1]) {
      const p = s[end];
      let best = null;
      out.forEach((t, j) => {
        for (let m = 0; m + 1 < t.length; m++) {
          // Not the segments the end belongs to.
          if (j === i && (m === end || m === end - 1)) continue;
          for (const q of [t[m], t[m + 1]]) {
            const d = dist(p, q);
            if (d <= TOUCH && (!best || d < best.d - 1e-9 || best.on)) best = { d, q, on: false };
          }
          const d = [t[m + 1][0] - t[m][0], t[m + 1][1] - t[m][1]];
          const l2 = d[0] * d[0] + d[1] * d[1];
          if (!l2) continue;
          const u = Math.min(1, Math.max(0, ((p[0] - t[m][0]) * d[0] + (p[1] - t[m][1]) * d[1]) / l2));
          const q = lerp(t[m], t[m + 1], u);
          const dq = dist(p, q);
          if (dq <= TOUCH && (!best || (best.on && dq < best.d))) best = { d: dq, q, on: true };
        }
      });
      if (best && best.d > 0) s[end] = [...best.q];
    }
  });
  return out;
}

/**
 * The strokes of a letter cut into edges between nodes: at their ends, where one touches or
 * crosses another (or itself).
 */
function graphOf(strokes) {
  strokes = snapEnds(strokes);
  // Cut positions per stroke as segment index + parameter.
  const cuts = strokes.map((s) => [0, s.length - 1]);
  const at = (i, k, t) => cuts[i].push(k + t);
  for (let i = 0; i < strokes.length; i++) {
    for (let j = i; j < strokes.length; j++) {
      const A = strokes[i];
      const B = strokes[j];
      for (let k = 0; k + 1 < A.length; k++) {
        for (let m = i === j ? k + 2 : 0; m + 1 < B.length; m++) {
          const x = meet(A[k], A[k + 1], B[m], B[m + 1]);
          if (x) {
            at(i, k, x[0]);
            at(j, m, x[1]);
          }
        }
      }
    }
  }
  // Ends lying on another stroke (parallel touches are missed by meet).
  for (let i = 0; i < strokes.length; i++) {
    for (const p of [strokes[i][0], strokes[i][strokes[i].length - 1]]) {
      for (let j = 0; j < strokes.length; j++) {
        const B = strokes[j];
        for (let m = 0; m + 1 < B.length; m++) {
          const t = onSegment(p, B[m], B[m + 1]);
          if (t !== null) at(j, m, t);
        }
      }
    }
  }
  const nodes = [];
  const nodeOf = (p) => {
    let n = nodes.findIndex((q) => dist(p, q) <= EPS * 2);
    if (n < 0) n = nodes.push(p) - 1;
    return n;
  };
  const edges = [];
  strokes.forEach((s, i) => {
    const pos = [...new Set(cuts[i].map((v) => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
    const point = (v) => {
      const k = Math.min(s.length - 2, Math.floor(v));
      return lerp(s[k], s[k + 1], v - k);
    };
    for (let c = 0; c + 1 < pos.length; c++) {
      const v0 = pos[c];
      const v1 = pos[c + 1];
      const pts = [point(v0)];
      for (let k = Math.floor(v0) + 1; k < v1; k++) pts.push(s[k]);
      pts.push(point(v1));
      const len = pts.slice(1).reduce((sum, p, k) => sum + dist(pts[k], p), 0);
      if (len <= EPS) continue;
      edges.push({
        a: nodeOf(pts[0]),
        b: nodeOf(pts[pts.length - 1]),
        pts,
        len,
      });
    }
  });
  return { nodes, edges };
}

/** Shortest way between two nodes along `edges` (Dijkstra), as edge indices. */
function shortest(nodes, edges, from, to) {
  const d = nodes.map(() => Infinity);
  const via = nodes.map(() => -1);
  const done = nodes.map(() => false);
  d[from] = 0;
  for (;;) {
    let u = -1;
    for (let n = 0; n < nodes.length; n++) if (!done[n] && d[n] < Infinity && (u < 0 || d[n] < d[u])) u = n;
    if (u < 0 || u === to) break;
    done[u] = true;
    edges.forEach((e, k) => {
      const v = e.a === u ? e.b : e.b === u ? e.a : -1;
      if (v >= 0 && d[u] + e.len < d[v]) {
        d[v] = d[u] + e.len;
        via[v] = k;
      }
    });
  }
  const path = [];
  for (let n = to; n !== from; ) {
    const k = via[n];
    if (k < 0) return { len: Infinity, path: [] };
    path.push(k);
    n = edges[k].a === n ? edges[k].b : edges[k].a;
  }
  return { len: d[to], path };
}

/**
 * The cheapest ways to double so that one route sews every edge: all odd nodes but two paired
 * (minimum weight matching, by trying them all; letters have few), those two the route's ends.
 */
function doubling(nodes, edges, odd) {
  const sp = new Map();
  const way = (a, b) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (!sp.has(key)) sp.set(key, shortest(nodes, edges, a, b));
    return sp.get(key);
  };
  const match = (left) => {
    if (!left.length) return { len: 0, pairs: [] };
    const [a, ...rest] = left;
    let best = { len: Infinity, pairs: [] };
    rest.forEach((b, k) => {
      const sub = match(rest.filter((_, j) => j !== k));
      const len = way(a, b).len + sub.len;
      if (len < best.len) best = { len, pairs: [[a, b], ...sub.pairs] };
    });
    return best;
  };
  let best = { len: Infinity, pairs: [], ends: [] };
  if (odd.length <= 2) return { len: 0, pairs: [], ends: odd };
  for (let i = 0; i < odd.length; i++) {
    for (let j = i + 1; j < odd.length; j++) {
      const m = match(odd.filter((_, k) => k !== i && k !== j));
      // Equal cost: the ends further apart (the route then crosses the letter once).
      const better =
        m.len < best.len - 1e-6 || (Math.abs(m.len - best.len) <= 1e-6 && dist(nodes[odd[i]], nodes[odd[j]]) > dist(nodes[best.ends[0]], nodes[best.ends[1]]));
      if (better) best = { ...m, ends: [odd[i], odd[j]] };
    }
  }
  return { ...best, ways: best.pairs.flatMap(([a, b]) => way(a, b).path) };
}

/** An Euler route from `start` over `edges` (Hierholzer), as [edge, forward] steps. */
function euler(edges, start) {
  const used = edges.map(() => false);
  const out = [];
  const stack = [{ node: start, step: null }];
  while (stack.length) {
    const top = stack[stack.length - 1];
    const k = edges.findIndex((e, j) => !used[j] && (e.a === top.node || e.b === top.node));
    if (k < 0) {
      stack.pop();
      if (top.step) out.push(top.step);
      continue;
    }
    used[k] = true;
    const fwd = edges[k].a === top.node;
    stack.push({ node: fwd ? edges[k].b : edges[k].a, step: [k, fwd] });
  }
  return out.reverse();
}

/**
 * Hershey's dots (on i, j, the period, the comma) are loops of two units, made for a pen whose width
 * gave them their size: in thread they are a knot. Taken out of the strokes, they are sewn as small
 * satin dots of DOT mm instead.
 */
function takeDots(strokes) {
  const dots = [];
  const lines = [];
  for (const s of strokes) {
    let rest = s;
    for (let found = true; found; ) {
      found = false;
      for (let i = 0; i < rest.length && !found; i++) {
        for (let j = i + 3; j < rest.length; j++) {
          if (dist(rest[i], rest[j]) > EPS) continue;
          const loop = rest.slice(i, j + 1);
          const xs = loop.map((p) => p[0]);
          const ys = loop.map((p) => p[1]);
          if (Math.max(...xs) - Math.min(...xs) > DOT_LOOP || Math.max(...ys) - Math.min(...ys) > DOT_LOOP) continue;
          dots.push([(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2]);
          if (i > 0) lines.push(rest.slice(0, i + 1));
          rest = rest.slice(j);
          found = true;
          break;
        }
      }
    }
    if (rest.length > 1) lines.push(rest);
  }
  return { dots, lines };
}

/** A satin dot: stitches back and forth across it, from the side nearest `from`. */
function dotStitches(c, from) {
  const r = DOT / 2;
  const rows = Math.max(3, Math.round(DOT / DOT_SPACING));
  const pts = [];
  for (let k = 0; k <= rows; k++) {
    const y = -r + (2 * r * k) / rows;
    const w = Math.sqrt(Math.max(0, r * r - y * y));
    pts.push([c[0] + (k % 2 ? w : -w), c[1] + y]);
  }
  return from && dist(from, pts[0]) > dist(from, pts[pts.length - 1]) ? pts.reverse() : pts;
}

/** A part of a letter whose edges all have even degree is a loop: it may start at any of its points. */
function splitAt(nodes, all, at) {
  for (let k = 0; k < all.length; k++) {
    const e = all[k];
    const i = e.pts.findIndex((p, j) => j > 0 && j < e.pts.length - 1 && dist(p, at) <= EPS);
    if (i < 0) continue;
    const n = nodes.push(at) - 1;
    const one = e.pts.slice(0, i + 1);
    const two = e.pts.slice(i);
    const len = (q) => q.slice(1).reduce((sum, p, j) => sum + dist(q[j], p), 0);
    all.splice(k, 1, { ...e, b: n, pts: one, len: len(one) }, { ...e, a: n, pts: two, len: len(two) });
    return n;
  }
  return nodes.findIndex((p) => dist(p, at) <= EPS * 2);
}

/**
 * One letter's strokes as elements: triple stitch, ways back as running stitch under it, dots as
 * satin. It starts as near its lower left and ends as near its lower right as its strokes allow, so
 * that in a word the next letter is a short jump away, not a trim.
 */
export function routeLetter(strokes) {
  const { dots, lines } = takeDots(strokes);
  const { nodes, edges } = graphOf(lines);
  // Connected parts.
  const part = nodes.map((_, n) => n);
  const find = (n) => (part[n] === n ? n : (part[n] = find(part[n])));
  for (const e of edges) part[find(e.a)] = find(e.b);
  const parts = [...new Set(edges.map((e) => find(e.a)))].map((r) => edges.filter((e) => find(e.a) === r));
  const routes = parts.map((own) => {
    const deg = new Map();
    for (const e of own) for (const n of [e.a, e.b]) deg.set(n, (deg.get(n) ?? 0) + 1);
    const odd = [...deg].filter(([, d]) => d % 2).map(([n]) => n);
    const dbl = doubling(nodes, own, odd);
    const all = [...own.map((e) => ({ ...e, back: false })), ...(dbl.ways ?? []).map((k) => ({ ...own[k], back: true }))];
    // Where it may start, and where it then ends.
    const starts = dbl.ends.length
      ? [
          { at: nodes[dbl.ends[0]], end: nodes[dbl.ends[1]], node: dbl.ends[0] },
          { at: nodes[dbl.ends[1]], end: nodes[dbl.ends[0]], node: dbl.ends[1] },
        ]
      : own.flatMap((e) => e.pts).map((p) => ({ at: p, end: p, node: null }));
    return { all, starts };
  });
  for (const c of dots) routes.push({ dot: c, starts: [{ at: c, end: c }] });
  const xs = [...lines.flat(), ...dots].map((p) => p[0]);
  const from = [Math.min(...xs), 0];
  const to = [Math.max(...xs), 0];
  // Every first part and start, the rest each from the start nearest where the one before ended.
  let best = null;
  for (const first of routes) {
    for (const s0 of first.starts) {
      const plan = [[first, s0]];
      let pen = s0.end;
      let cost = dist(s0.at, from);
      const left = routes.filter((r) => r !== first);
      while (left.length) {
        let pick = null;
        for (const r of left) for (const s of r.starts) if (!pick || dist(pen, s.at) < pick.d) pick = { r, s, d: dist(pen, s.at) };
        left.splice(left.indexOf(pick.r), 1);
        plan.push([pick.r, pick.s]);
        cost += pick.d;
        pen = pick.s.end;
      }
      cost += dist(pen, to);
      if (!best || cost < best.cost - 1e-6) best = { plan, cost };
    }
  }
  const els = [];
  let pen = null;
  for (const [r, s] of best.plan) {
    if (r.dot) {
      const pts = dotStitches(r.dot, pen);
      els.push({ dot: true, pts });
      pen = pts[pts.length - 1];
      continue;
    }
    const all = r.all.map((e) => ({ ...e }));
    const start = s.node ?? splitAt(nodes, all, s.at);
    // Of an edge sewn twice, the first time is the triple stitch, the second the way back.
    const sewn = new Set();
    for (const [k, fwd] of euler(all, start)) {
      const e = all[k];
      const key = e.pts.map((p) => p.join()).join(';');
      const back = sewn.has(key);
      sewn.add(key);
      const pts = fwd ? e.pts : e.pts.slice().reverse();
      const prev = els[els.length - 1];
      if (prev && !prev.dot && prev.back === back && dist(prev.pts[prev.pts.length - 1], pts[0]) <= EPS * 2) prev.pts.push(...pts.slice(1));
      else els.push({ back, pts: pts.slice() });
    }
    pen = els[els.length - 1].pts[els[els.length - 1].pts.length - 1];
  }
  return els.map((e) => ({
    k: 'r',
    d: e.pts.flatMap((p) => [R(p[0]), R(p[1])]),
    p: e.dot ? { len: LEN, m: 1 } : e.back ? { len: LEN } : { len: LEN, tr: 1 },
  }));
}

/** Converts the font into `out` (public/fonts) and returns its catalog entry. */
export function convertHershey(out) {
  const svg = readFileSync(SRC, 'utf8');
  const root = parseXml(svg);
  const mm = CAP_MM / CAP_UNITS;
  const glyphs = {};
  let space = 0;
  for (const el of walk(root)) {
    if (el.name !== 'glyph') continue;
    const ch = el.attrs.unicode;
    const adv = Number(el.attrs['horiz-adv-x'] ?? 378) * mm;
    if (ch === ' ') space = adv;
    if (!ch || [...ch].length !== 1 || !el.attrs.d || /\s/.test(ch)) continue;
    const strokes = parsePath(el.attrs.d, 2)
      .map((s) => s.pts.map(([x, y]) => [(x - SHIFT) * mm, -y * mm]))
      .filter((s) => s.length > 1);
    if (!strokes.length) continue;
    const e = routeLetter(strokes);
    const xs = e.flatMap((x) => x.d.filter((_, k) => k % 2 === 0));
    const ys = e.flatMap((x) => x.d.filter((_, k) => k % 2 === 1));
    glyphs[ch] = {
      a: R(adv),
      x0: R(Math.min(...xs)),
      x1: R(Math.max(...xs)),
      y0: R(Math.min(...ys)),
      y1: R(Math.max(...ys)),
      e,
    };
  }
  const font = {
    v: 1,
    id: HERSHEY_ID,
    name: 'Hershey Sans 1-stroke',
    cap: CAP_MM,
    caps: true,
    // Hershey's own line spacing: 32 units to a capital of 21.
    lead: R((CAP_MM * 32) / 21),
    space: R(space),
    // 3 to 15 mm: below, the letters close up; above, a line of triple stitch looks thin.
    min: 0.6,
    max: 3,
    glyphs,
    kern: {},
    rev: true,
  };
  const json = JSON.stringify(font);
  writeFileSync(join(out, `${HERSHEY_ID}.json`), json);
  const lic = svg.match(/<metadata>([\s\S]*?)<\/metadata>/)[1].trim();
  writeFileSync(join(out, 'licenses', `${HERSHEY_ID}.txt`), `${lic}\n`);
  const names = Object.keys(glyphs).sort();
  return {
    id: HERSHEY_ID,
    name: font.name,
    style: 'sans',
    small: true,
    cap: CAP_MM,
    good: [R(CAP_MM * font.min), R(CAP_MM * font.max)],
    license: 'Hershey',
    source: 'Hershey Sans 1-stroke (Evil Mad Scientist)',
    chars: names.join(''),
    cases: 'Aa',
    kb: Math.round(json.length / 1024),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = new URL('../../public/fonts/', import.meta.url).pathname;
  const entry = convertHershey(out);
  const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'));
  index.fonts = [...index.fonts.filter((f) => f.id !== HERSHEY_ID), entry].sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 1));
  console.log(`${HERSHEY_ID}: ${entry.chars.length} glyphs, ${entry.kb} KB`);
}
