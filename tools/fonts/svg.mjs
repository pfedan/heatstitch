// Just enough SVG for the Ink/Stitch font files: an XML tree, transforms, path data as polylines.

/** A small XML parser: elements with attributes and children (text is dropped). */
export function parseXml(src) {
  const root = { name: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/?[^>]+>/g;
  let m;
  while ((m = re.exec(src))) {
    const tag = m[0];
    if (tag.startsWith('<!--') || tag.startsWith('<![CDATA[') || tag.startsWith('<?') || tag.startsWith('<!')) continue;
    if (tag.startsWith('</')) {
      if (cur.parent) cur = cur.parent;
      continue;
    }
    const selfClosing = tag.endsWith('/>');
    const body = tag.slice(1, selfClosing ? -2 : -1);
    const name = body.match(/^[^\s/>]+/)[0];
    const attrs = {};
    const ar = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = ar.exec(body.slice(name.length)))) attrs[a[1]] = decode(a[3] ?? a[4]);
    const el = { name, attrs, children: [], parent: cur };
    cur.children.push(el);
    if (!selfClosing) cur = el;
  }
  return root;
}

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function* walk(el) {
  for (const c of el.children) {
    yield c;
    yield* walk(c);
  }
}

// Affine maps as [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f.
export const IDENTITY = [1, 0, 0, 1, 0, 0];
export const compose = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
export const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function parseTransform(s) {
  let m = IDENTITY;
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(s))) {
    const v = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n = IDENTITY;
    if (t[1] === 'matrix') n = v;
    else if (t[1] === 'translate') n = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
    else if (t[1] === 'scale') n = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
    else if (t[1] === 'rotate') {
      const r = ((v[0] ?? 0) * Math.PI) / 180;
      const cx = v[1] ?? 0;
      const cy = v[2] ?? 0;
      const c = Math.cos(r);
      const sn = Math.sin(r);
      n = [c, sn, -sn, c, cx - c * cx + sn * cy, cy - sn * cx - c * cy];
    } else if (t[1] === 'skewX') n = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else n = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = compose(m, n);
  }
  return m;
}

/** The style of an element: its style attribute over its presentation attributes. */
export function styleOf(el) {
  const out = {};
  for (const k of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'display', 'fill-rule']) if (el.attrs[k] !== undefined) out[k] = el.attrs[k];
  for (const part of (el.attrs.style ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * Path data as subpaths of points, curves flattened (within `tol`, in the units of the data).
 * Each subpath also tells which of its points are the path's own nodes (for paired rails).
 */
export function parsePath(d, tol = 0.05) {
  const toks = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const subs = [];
  let sub = null;
  let i = 0;
  let cmd = '';
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrl = null;
  let lastQ = null;
  const num = () => Number(toks[i++]);
  const isNum = () => i < toks.length && !/^[a-zA-Z]$/.test(toks[i]);
  const start = (x, y) => {
    sub = { pts: [[x, y]], nodes: [0], closed: false };
    subs.push(sub);
  };
  const lineTo = (x, y) => {
    if (!sub) start(cx, cy);
    sub.pts.push([x, y]);
    sub.nodes.push(sub.pts.length - 1);
  };
  const cubicTo = (x1, y1, x2, y2, x, y) => {
    if (!sub) start(cx, cy);
    const p0 = [cx, cy];
    const n = Math.max(1, Math.min(64, Math.ceil(Math.sqrt((Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x - x2, y - y2)) / tol) / 2)));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      sub.pts.push([
        u * u * u * p0[0] + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
        u * u * u * p0[1] + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
      ]);
    }
    sub.nodes.push(sub.pts.length - 1);
  };
  while (i < toks.length) {
    if (/^[a-zA-Z]$/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    if (C === 'Z') {
      if (sub) {
        sub.closed = true;
        if (Math.hypot(sub.pts[sub.pts.length - 1][0] - sx, sub.pts[sub.pts.length - 1][1] - sy) > 1e-9) lineTo(sx, sy);
      }
      cx = sx;
      cy = sy;
      sub = null;
      lastCtrl = lastQ = null;
      if (!isNum()) continue;
      continue;
    }
    if (!isNum()) {
      i++;
      continue;
    }
    if (C === 'M') {
      cx = ox + num();
      cy = oy + num();
      sx = cx;
      sy = cy;
      start(cx, cy);
      cmd = rel ? 'l' : 'L';
      lastCtrl = lastQ = null;
    } else if (C === 'L') {
      const x = ox + num();
      const y = oy + num();
      lineTo(x, y);
      cx = x;
      cy = y;
      lastCtrl = lastQ = null;
    } else if (C === 'H') {
      const x = ox + num();
      lineTo(x, cy);
      cx = x;
      lastCtrl = lastQ = null;
    } else if (C === 'V') {
      const y = oy + num();
      lineTo(cx, y);
      cy = y;
      lastCtrl = lastQ = null;
    } else if (C === 'C' || C === 'S') {
      let x1;
      let y1;
      if (C === 'C') {
        x1 = ox + num();
        y1 = oy + num();
      } else {
        x1 = lastCtrl ? 2 * cx - lastCtrl[0] : cx;
        y1 = lastCtrl ? 2 * cy - lastCtrl[1] : cy;
      }
      const x2 = ox + num();
      const y2 = oy + num();
      const x = ox + num();
      const y = oy + num();
      cubicTo(x1, y1, x2, y2, x, y);
      lastCtrl = [x2, y2];
      lastQ = null;
      cx = x;
      cy = y;
    } else if (C === 'Q' || C === 'T') {
      let qx;
      let qy;
      if (C === 'Q') {
        qx = ox + num();
        qy = oy + num();
      } else {
        qx = lastQ ? 2 * cx - lastQ[0] : cx;
        qy = lastQ ? 2 * cy - lastQ[1] : cy;
      }
      const x = ox + num();
      const y = oy + num();
      cubicTo(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
      lastQ = [qx, qy];
      lastCtrl = null;
      cx = x;
      cy = y;
    } else if (C === 'A') {
      const rx = Math.abs(num());
      const ry = Math.abs(num());
      const rot = num();
      const large = num() !== 0;
      const sweep = num() !== 0;
      const x = ox + num();
      const y = oy + num();
      for (const c of arcToCubics(cx, cy, rx, ry, rot, large, sweep, x, y)) cubicTo(...c);
      cx = x;
      cy = y;
      lastCtrl = lastQ = null;
    } else i++;
  }
  return subs.filter((s) => s.pts.length >= 1);
}

/** An elliptical arc (SVG endpoint form) as cubic curves: [x1, y1, x2, y2, x, y] each. */
function arcToCubics(x0, y0, rx, ry, rotDeg, large, sweep, x, y) {
  if (!rx || !ry || (x0 === x && y0 === y)) return [[x0, y0, x, y, x, y]];
  const phi = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const ccx = cos * cxp - sin * cyp + (x0 + x) / 2;
  const ccy = sin * cxp + cos * cyp + (y0 + y) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dt) / (Math.PI / 2));
  const out = [];
  const step = dt / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const pt = (t) => [ccx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, ccy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const der = (t) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  for (let j = 0; j < n; j++) {
    const a = t1 + j * step;
    const b = a + step;
    const pa = pt(a);
    const pb = pt(b);
    const da = der(a);
    const db = der(b);
    out.push([pa[0] + k * da[0], pa[1] + k * da[1], pb[0] - k * db[0], pb[1] - k * db[1], pb[0], pb[1]]);
  }
  return out;
}

/** Basic shapes as path data. */
export function shapeToPath(el) {
  const n = (k, d = 0) => Number(el.attrs[k] ?? d);
  if (el.name === 'rect') {
    const x = n('x');
    const y = n('y');
    return `M${x},${y}H${x + n('width')}V${y + n('height')}H${x}Z`;
  }
  if (el.name === 'circle' || el.name === 'ellipse') {
    const cx = n('cx');
    const cy = n('cy');
    const rx = el.name === 'circle' ? n('r') : n('rx');
    const ry = el.name === 'circle' ? n('r') : n('ry');
    return `M${cx - rx},${cy}A${rx},${ry} 0 1 0 ${cx + rx},${cy}A${rx},${ry} 0 1 0 ${cx - rx},${cy}Z`;
  }
  if (el.name === 'line') return `M${n('x1')},${n('y1')}L${n('x2')},${n('y2')}`;
  if (el.name === 'polyline' || el.name === 'polygon') {
    const v = (el.attrs.points ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
    let d = '';
    for (let k = 0; k + 1 < v.length; k += 2) d += `${k ? 'L' : 'M'}${v[k]},${v[k + 1]}`;
    return el.name === 'polygon' ? d + 'Z' : d;
  }
  return el.attrs.d ?? '';
}

/** A length with a unit in millimetres (px at 96 per inch when unitless). */
export function lengthMm(s) {
  const m = String(s ?? '').match(/^\s*([-+]?[\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)/i);
  if (!m) return null;
  const v = Number(m[1]);
  const unit = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 }[m[2].toLowerCase()];
  return unit === undefined ? null : v * unit;
}
