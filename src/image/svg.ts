import type { Rgb } from './color';
import { NONE } from './quantize';
import type { ExactLabels } from './prepare';
import type { Form, Mat } from '../shape/path';
import { ellipsePath, parsePath, pointsPath, rectPath } from '../shape/svgPath';

/**
 * SVG files read as what they are: shapes with exact colors. The browser draws the file, so every
 * feature it knows (paths, text, transforms, CSS, clip paths) comes out as it would on screen; but
 * instead of guessing colors from pixels like for a photo, each color of the file becomes one thread
 * color and each pixel gets the color of the shape painted on top there. Hidden parts of shapes
 * further down are left out, as the image mode does with any image.
 *
 * The regions are drawn at the working resolution of 0.1 mm per pixel, the step of the stitch
 * formats themselves, so edges are as exact as a stitch file can hold them. Lines thinner than a
 * thread would come out thinner than a pixel; they are drawn at the width of a running stitch so
 * they stay as one.
 *
 * Files that cannot be read like this (embedded photos, fill patterns, very many colors as from
 * auto-tracing) go the photo way, through quantizing.
 */

/** Lines are drawn at least this wide (mm), so they become running stitch instead of vanishing. */
export const MIN_LINE_MM = 0.4;
/** More colors than this: the file is an auto-traced photo and is better quantized. */
export const MAX_COLORS = 48;

const MM_PER: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, q: 0.25 };

/** A length attribute in mm, if it has an absolute unit (px and plain numbers have no physical size). */
export function lengthMm(v: string | null | undefined): number | null {
  const m = v?.trim().match(/^([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|q)$/i);
  if (!m) return null;
  const n = parseFloat(m[1]) * MM_PER[m[2].toLowerCase()];
  return n > 0 ? n : null;
}

/** A length attribute in CSS pixels (96 per inch), for sizes without a viewBox. */
export function lengthPx(v: string | null | undefined): number | null {
  const mm = lengthMm(v);
  if (mm !== null) return (mm * 96) / 25.4;
  const m = v?.trim().match(/^([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*(px)?$/i);
  const n = m ? parseFloat(m[1]) : NaN;
  return n > 0 ? n : null;
}

/** A computed CSS color (`rgb(…)`, `rgba(…)`), or null for none and fully transparent. */
export function cssRgb(v: string): { rgb: Rgb; alpha: number } | null {
  const m = v.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/i);
  if (!m) return null;
  let alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (m[4]?.endsWith('%')) alpha /= 100;
  if (alpha <= 0.02) return null;
  return { rgb: [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(parseFloat(m[i + 1]))))) as Rgb, alpha };
}

/** One color for a gradient: the mean of its stops, weighted by the share of the length each covers. */
export function gradientColor(stops: { offset: number; rgb: Rgb }[]): Rgb | null {
  if (!stops.length) return null;
  if (stops.length === 1) return stops[0].rgb;
  const s = stops.slice().sort((a, b) => a.offset - b.offset);
  const acc = [0, 0, 0];
  let total = 0;
  const add = (c: Rgb, w: number) => {
    for (let i = 0; i < 3; i++) acc[i] += c[i] * w;
    total += w;
  };
  add(s[0].rgb, Math.max(0, s[0].offset));
  for (let i = 1; i < s.length; i++) {
    const w = Math.max(0, s[i].offset - s[i - 1].offset) / 2;
    add(s[i - 1].rgb, w);
    add(s[i].rgb, w);
  }
  add(s[s.length - 1].rgb, Math.max(0, 1 - s[s.length - 1].offset));
  if (total <= 0) return s[0].rgb;
  return acc.map((v) => Math.round(v / total)) as Rgb;
}

/**
 * Labels from drawings in which the shapes of colors 3p, 3p + 1 and 3p + 2 are pure red, green and
 * blue and all other shapes black (one drawing p per three colors): each pixel gets the color that
 * covers most of it, if shapes cover at least half of it.
 */
export function labelsFromPasses(passes: Uint8ClampedArray[], count: number, size: number): Uint8Array {
  const labels = new Uint8Array(size).fill(NONE);
  const best = new Float32Array(size);
  passes.forEach((d, p) => {
    for (let c = 0; c < 3; c++) {
      const label = p * 3 + c;
      if (label >= count) break;
      for (let i = 0; i < size; i++) {
        const a = d[i * 4 + 3];
        if (a < 128) continue;
        const v = d[i * 4 + c] * a;
        if (v > best[i]) {
          best[i] = v;
          labels[i] = label;
        }
      }
    }
  });
  return labels;
}

// Reading the file in the page ---------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const SHAPES = 'path, rect, circle, ellipse, line, polyline, polygon, text, tspan, textPath';
/** Content that is not drawn where it stands. */
const NOT_DRAWN = 'defs, clipPath, mask, pattern, marker, symbol, linearGradient, radialGradient, filter';
/** Layout size of the longer side while reading (CSS px). */
const LAYOUT = 1000;

interface Paint {
  el: SVGGraphicsElement;
  fill: number;
  stroke: number;
  /** Stroke width as laid out (CSS px at LAYOUT), and as written (user units). */
  strokePx: number;
  strokeUser: number;
  /** The element's own inline stroke width, put back where a line needs no widening. */
  inlineWidth: [string, string];
}

export interface SvgDesign {
  /** Width in mm when the file states it in mm, cm, in or pt. */
  widthMm: number | null;
  /** Height divided by width. */
  aspect: number;
  /** The file's colors, in the order they are first painted. */
  colors: Rgb[];
  /** The file drawn as it looks, `w` × `h` pixels. */
  picture(w: number, h: number): Promise<HTMLCanvasElement>;
  /** Regions by color at `w` × `h` pixels, `pxMm` mm each. */
  labels(w: number, h: number, pxMm: number): Promise<ExactLabels>;
  /**
   * Every fill and line of the file as it is drawn, whole (also where later shapes cover it), in mm
   * from the top left at a width of `widthMm`, in the order they are painted. Null when the file
   * has things only the browser can draw (text, clip paths, masks, markers).
   */
  shapes(widthMm: number): SvgShape[] | null;
  /** Releases the copy of the file kept in the page. */
  dispose(): void;
}

/** One painted part of an SVG shape: its fill (an area) or its stroke (a line of a width). */
export interface SvgShape {
  /** Index into the file's colors. */
  color: number;
  kind: 'fill' | 'stroke';
  form: Form;
  /** Stroke width in mm (strokes only), at least MIN_LINE_MM. */
  width?: number;
}

/** The outline of a basic shape or path as path data, in its user units; null for text and the like. */
function geometry(el: SVGGraphicsElement): string | null {
  const len = (a: SVGAnimatedLength) => a.baseVal.value;
  switch (el.localName) {
    case 'path':
      return el.getAttribute('d') ?? '';
    case 'rect': {
      const r = el as SVGRectElement;
      const rx = r.getAttribute('rx') === null ? 0 : len(r.rx);
      const ry = r.getAttribute('ry') === null ? 0 : len(r.ry);
      return rectPath(len(r.x), len(r.y), len(r.width), len(r.height), rx, ry);
    }
    case 'circle': {
      const c = el as SVGCircleElement;
      return ellipsePath(len(c.cx), len(c.cy), len(c.r), len(c.r));
    }
    case 'ellipse': {
      const e = el as SVGEllipseElement;
      return ellipsePath(len(e.cx), len(e.cy), len(e.rx), len(e.ry));
    }
    case 'line': {
      const l = el as SVGLineElement;
      return `M${len(l.x1)} ${len(l.y1)}L${len(l.x2)} ${len(l.y2)}`;
    }
    case 'polyline':
    case 'polygon':
      return pointsPath(el.getAttribute('points') ?? '', el.localName === 'polygon');
    default:
      return null;
  }
}

/** Whether something hides or adds to the shape in a way only the browser can draw. */
function drawnByBrowser(el: Element, root: Element): boolean {
  const cs = getComputedStyle(el);
  if (cs.markerStart !== 'none' || cs.markerMid !== 'none' || cs.markerEnd !== 'none') return true;
  for (let a: Element | null = el; a && a !== root; a = a.parentElement) {
    const s = getComputedStyle(a);
    if ((s.clipPath && s.clipPath !== 'none') || (s.mask && s.mask !== 'none')) return true;
  }
  return false;
}

const hrefOf = (el: Element) => el.getAttribute('href') ?? el.getAttributeNS(XLINK_NS, 'href');

/** Replaces `<use>` by copies of what it shows, so every shape can be recolored on its own. */
function expandUses(root: SVGSVGElement): void {
  for (let round = 0; round < 8; round++) {
    const uses = [...root.querySelectorAll('use')].filter((u) => !u.closest(NOT_DRAWN));
    if (!uses.length) return;
    for (const use of uses) {
      const id = hrefOf(use)?.match(/^#(.+)$/)?.[1];
      const ref = id ? root.querySelector(`[id="${CSS.escape(id)}"]`) : null;
      const g = document.createElementNS(SVG_NS, 'g');
      for (const a of [...use.attributes]) {
        if (!['href', 'xlink:href', 'x', 'y', 'width', 'height', 'id'].includes(a.name)) g.setAttribute(a.name, a.value);
      }
      const x = parseFloat(use.getAttribute('x') ?? '0') || 0;
      const y = parseFloat(use.getAttribute('y') ?? '0') || 0;
      let transform = `${use.getAttribute('transform') ?? ''} translate(${x} ${y})`;
      if (ref && ref !== use && !ref.contains(use)) {
        let content: Element;
        if (ref.localName === 'symbol') {
          content = document.createElementNS(SVG_NS, 'g');
          for (const c of ref.childNodes) content.appendChild(c.cloneNode(true));
          const vb = ref.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
          const w = parseFloat(use.getAttribute('width') ?? '');
          const h = parseFloat(use.getAttribute('height') ?? '');
          if (vb?.length === 4 && vb[2] > 0 && vb[3] > 0 && w > 0 && h > 0) {
            const s = Math.min(w / vb[2], h / vb[3]);
            transform += ` scale(${s}) translate(${-vb[0]} ${-vb[1]})`;
          }
        } else {
          content = ref.cloneNode(true) as Element;
        }
        content.removeAttribute('id');
        content.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
        g.appendChild(content);
      }
      g.setAttribute('transform', transform.trim());
      use.replaceWith(g);
    }
  }
}

/** The color a computed fill or stroke paints with: a plain color, or a gradient's mean color. */
function paintColor(root: SVGSVGElement, value: string, opacity: number): Rgb | null | 'unsupported' {
  if (!value || value === 'none') return null;
  const url = value.match(/url\(\s*["']?#([^"')]+)["']?\s*\)/);
  if (url) {
    let el: Element | null = root.querySelector(`[id="${CSS.escape(url[1])}"]`);
    if (!el) {
      // A missing reference falls back to the color after it, else nothing is painted.
      const rest = value.replace(url[0], '').trim();
      return rest ? paintColor(root, rest, opacity) : null;
    }
    if (el.localName !== 'linearGradient' && el.localName !== 'radialGradient') return 'unsupported';
    // Stops may come from the gradient the href points to.
    let grad: Element = el;
    for (let guard = 0; guard < 8 && !grad.querySelector('stop'); guard++) {
      const id: string | undefined = hrefOf(grad)?.match(/^#(.+)$/)?.[1];
      const next: Element | null = id ? root.querySelector(`[id="${CSS.escape(id)}"]`) : null;
      if (!next) break;
      grad = next;
    }
    const stops = [...grad.querySelectorAll('stop')].flatMap((s) => {
      const cs = getComputedStyle(s);
      const c = cssRgb(cs.stopColor);
      if (!c || parseFloat(cs.stopOpacity || '1') <= 0.02) return [];
      const o = s.getAttribute('offset') ?? '0';
      const offset = o.endsWith('%') ? parseFloat(o) / 100 : parseFloat(o);
      return [{ offset: Math.max(0, Math.min(1, offset || 0)), rgb: c.rgb }];
    });
    return gradientColor(stops);
  }
  const c = cssRgb(value);
  if (!c || c.alpha * opacity <= 0.05) return null;
  return c.rgb;
}

const key = (c: Rgb) => c.join(',');

/** References to anything outside the file, which would be fetched while it is laid out. */
const EXTERNAL_URL = /url\(\s*(?!['"]?#)[^)]*\)/gi;

/**
 * Makes the file inert before it enters the page: no scripts, event handlers, links or animation,
 * and nothing loaded from elsewhere (files never leave the device, and nothing comes in either).
 */
function sanitize(root: Element): void {
  root.querySelectorAll('script, a, animate, animateMotion, animateTransform, set, iframe, audio, video').forEach((e) => {
    // A link keeps its content.
    if (e.localName === 'a') e.replaceWith(...e.childNodes);
    else e.remove();
  });
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) {
      const name = a.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(a.name);
      else if ((name === 'href' || name === 'xlink:href') && !a.value.trim().startsWith('#')) el.removeAttribute(a.name);
      else if (EXTERNAL_URL.test(a.value)) el.setAttribute(a.name, a.value.replace(EXTERNAL_URL, 'none'));
      EXTERNAL_URL.lastIndex = 0;
    }
  }
  root.querySelectorAll('style').forEach((st) => {
    st.textContent = (st.textContent ?? '').replace(/@import[^;]*;?/gi, '').replace(EXTERNAL_URL, 'none');
  });
}

/**
 * Reads an SVG file; null when it is better treated as a picture (embedded images, patterns, more
 * than MAX_COLORS colors) or cannot be read at all.
 */
export async function readSvg(text: string): Promise<SvgDesign | null> {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const parsed = doc.documentElement;
  if (parsed.localName !== 'svg' || doc.querySelector('parsererror')) return null;
  const root = document.importNode(parsed, true) as unknown as SVGSVGElement;
  if (root.querySelector('image, foreignObject')) return null;
  sanitize(root);

  const widthMm = lengthMm(root.getAttribute('width'));
  const heightMm = lengthMm(root.getAttribute('height'));
  let vb = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (vb?.length !== 4 || !vb.every(Number.isFinite) || vb[2] <= 0 || vb[3] <= 0) vb = undefined;
  const wPx = lengthPx(root.getAttribute('width'));
  const hPx = lengthPx(root.getAttribute('height'));

  // Laid out off screen in a shadow root: the file's styles stay inside, the page's stay out.
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'all:initial;position:fixed;left:-100000px;top:0;pointer-events:none;';
  host.attachShadow({ mode: 'open' }).appendChild(root);
  document.body.appendChild(host);
  const dispose = () => host.remove();
  try {
    expandUses(root);
    if (!vb) {
      if (wPx && hPx) vb = [0, 0, wPx, hPx];
      else {
        // Neither size nor viewBox: the drawing's own extent.
        root.setAttribute('width', String(LAYOUT));
        root.setAttribute('height', String(LAYOUT));
        const b = root.getBBox();
        if (!(b.width > 0 && b.height > 0)) throw new Error('empty');
        vb = [b.x, b.y, b.width, b.height];
      }
      root.setAttribute('viewBox', vb.join(' '));
    }
    // The shape of the page: the stated size, else the viewBox.
    const aspect = widthMm && heightMm ? heightMm / widthMm : wPx && hPx ? hPx / wPx : vb[3] / vb[2];
    const lw = aspect <= 1 ? LAYOUT : LAYOUT / aspect;
    const lh = lw * aspect;
    root.removeAttribute('style');
    root.setAttribute('width', String(lw));
    root.setAttribute('height', String(lh));

    const colors: Rgb[] = [];
    const index = new Map<string, number>();
    const colorIndex = (c: Rgb | null) => {
      if (!c) return -1;
      let i = index.get(key(c));
      if (i === undefined) {
        i = colors.length;
        index.set(key(c), i);
        colors.push(c);
      }
      return i;
    };
    const paints: Paint[] = [];
    for (const el of root.querySelectorAll<SVGGraphicsElement>(SHAPES)) {
      if (el.closest(NOT_DRAWN)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') continue;
      let hidden = false;
      for (let a: Element | null = el; a && a !== root; a = a.parentElement) if (getComputedStyle(a).display === 'none') hidden = true;
      if (hidden) continue;
      const opacity = parseFloat(cs.opacity || '1');
      const fill = paintColor(root, cs.fill, opacity * parseFloat(cs.fillOpacity || '1'));
      const stroke = paintColor(root, cs.stroke, opacity * parseFloat(cs.strokeOpacity || '1'));
      if (fill === 'unsupported' || stroke === 'unsupported') return dispose(), null;
      const strokeUser = parseFloat(cs.strokeWidth) || 0;
      const m = el.getScreenCTM();
      // CSS px of the layout per user unit.
      const scale = m ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) : 1;
      paints.push({ el, fill: colorIndex(fill), stroke: strokeUser > 0 ? colorIndex(stroke) : -1, strokePx: strokeUser * scale, strokeUser, inlineWidth: [el.style.getPropertyValue('stroke-width'), el.style.getPropertyPriority('stroke-width')] });
      if (colors.length > MAX_COLORS) return dispose(), null;
    }
    if (!colors.length) return dispose(), null;
    const pristine = root.cloneNode(true) as SVGSVGElement;
    const serialize = (node: SVGSVGElement, w: number, h: number) => {
      node.setAttribute('width', String(w));
      node.setAttribute('height', String(h));
      return new XMLSerializer().serializeToString(node);
    };

    const draw = async (xml: string, w: number, h: number) => {
      const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const c = canvas.getContext('2d', { willReadFrequently: true })!;
        c.drawImage(img, 0, 0, w, h);
        return canvas;
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    return {
      widthMm,
      aspect,
      colors,
      shapes(designMm) {
        const box = root.getBoundingClientRect();
        // Layout px to mm.
        const s = designMm / lw;
        const out: SvgShape[] = [];
        for (const q of paints) {
          if (q.el.closest('marker, pattern') || drawnByBrowser(q.el, root)) return null;
          const d = geometry(q.el);
          if (d === null) return null;
          const c = q.el.getScreenCTM();
          if (!c) continue;
          const m: Mat = [c.a * s, c.b * s, c.c * s, c.d * s, (c.e - box.left) * s, (c.f - box.top) * s];
          const form = parsePath(d, m);
          if (!form.paths.length) continue;
          if (q.fill >= 0) {
            const closed = { paths: form.paths.filter((p) => p.nodes.length > 2 || p.closed).map((p) => ({ ...p, closed: true })) };
            const nonzero = getComputedStyle(q.el).fillRule !== 'evenodd';
            if (closed.paths.length) out.push({ color: q.fill, kind: 'fill', form: nonzero ? { ...closed, nonzero } : closed });
          }
          if (q.stroke >= 0) out.push({ color: q.stroke, kind: 'stroke', form, width: Math.max(MIN_LINE_MM, q.strokePx * s) });
        }
        return out;
      },
      picture: (w, h) => draw(serialize(pristine, w, h), w, h),
      async labels(w, h, pxMm) {
        // Lines thinner than MIN_LINE_MM at this size are widened to it.
        const minPx = (MIN_LINE_MM / pxMm) * (lw / w);
        const style = document.createElementNS(SVG_NS, 'style');
        style.textContent = '* { opacity: 1 !important; filter: none !important; }';
        root.insertBefore(style, root.firstChild);
        const passes: Uint8ClampedArray[] = [];
        try {
          // Content shown from elsewhere (markers) paints black: it covers, but adds no color.
          for (const el of root.querySelectorAll<SVGElement>(SHAPES)) {
            if (!el.closest('marker, pattern')) continue;
            el.style.setProperty('fill', '#000', 'important');
            el.style.setProperty('stroke', '#000', 'important');
          }
          for (let p = 0; p * 3 < colors.length; p++) {
            const tint = (i: number) => (i < 0 ? 'none' : Math.floor(i / 3) === p ? ['#f00', '#0f0', '#00f'][i % 3] : '#000');
            for (const q of paints) {
              const s = q.el.style;
              s.setProperty('fill', tint(q.fill), 'important');
              s.setProperty('stroke', tint(q.stroke), 'important');
              s.setProperty('fill-opacity', '1', 'important');
              s.setProperty('stroke-opacity', '1', 'important');
              if (q.stroke >= 0 && q.strokePx > 0 && q.strokePx < minPx) s.setProperty('stroke-width', `${(q.strokeUser * minPx) / q.strokePx}px`, 'important');
              else if (q.inlineWidth[0]) s.setProperty('stroke-width', ...q.inlineWidth);
              else s.removeProperty('stroke-width');
            }
            const canvas = await draw(serialize(root, w, h), w, h);
            passes.push(canvas.getContext('2d')!.getImageData(0, 0, w, h).data);
          }
        } finally {
          style.remove();
        }
        return { width: w, height: h, labels: labelsFromPasses(passes, colors.length, w * h), colors };
      },
      dispose,
    };
  } catch {
    dispose();
    return null;
  }
}
