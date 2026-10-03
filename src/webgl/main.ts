import type { Pattern } from '../model/pattern';
import { parsePattern } from '../parsers';
import { drawStitches } from '../render/stitches';
import { drawThreads, realisticVisible } from '../render/threads';
import { Viewport } from '../render/viewport';
import { DEFAULT_GL_OPTIONS, GlThreadRenderer, type GlOptions } from './threadsGl';

/**
 * Standalone comparison page: the app's current realistic view (canvas 2D) on the left and the
 * experimental WebGL renderer on the right, sharing one viewport. Not part of the app build.
 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const c2d = $<HTMLCanvasElement>('c2d');
const cgl = $<HTMLCanvasElement>('cgl');
const ctx = c2d.getContext('2d')!;
const vp = new Viewport();
const opt: GlOptions = { ...DEFAULT_GL_OPTIONS };
let pattern: Pattern | null = null;
let gl: GlThreadRenderer | null = null;
try {
  gl = new GlThreadRenderer(cgl);
} catch (e) {
  $('tgl').textContent = String(e);
}

let cssW = 0;
let cssH = 0;
let frame = 0;

function draw(): void {
  frame = 0;
  const dpr = window.devicePixelRatio || 1;
  const bg = `rgb(${opt.background.join(', ')})`;

  let t = performance.now();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cssW, cssH);
  // Same choice as drawScene: shaded threads when they are wide enough, flat lines otherwise.
  if (pattern) {
    if (realisticVisible(vp)) drawThreads(ctx, vp, pattern, 1);
    else drawStitches(ctx, vp, pattern, 1, false);
  }
  ctx.getImageData(0, 0, 1, 1);
  $('t2d').textContent = `${(performance.now() - t).toFixed(1)} ms${pattern && !realisticVisible(vp) ? ', flat fallback' : ''}`;

  if (gl && pattern) {
    t = performance.now();
    gl.draw(vp, dpr, opt);
    gl.gl.readPixels(0, 0, 1, 1, gl.gl.RGBA, gl.gl.UNSIGNED_BYTE, new Uint8Array(4));
    $('tgl').textContent = `${(performance.now() - t).toFixed(1)} ms`;
  }
  $('info').textContent = pattern
    ? `${pattern.name}: ${gl?.stitchCount ?? '?'} stitches, ${(vp.scale * opt.threadMm).toFixed(1)} px WebGL thread`
    : '';
}

const request = () => {
  frame ||= requestAnimationFrame(draw);
};

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const r = c2d.getBoundingClientRect();
  cssW = r.width;
  cssH = r.height;
  for (const c of [c2d, cgl]) {
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
  }
  request();
}

function fit(): void {
  if (!pattern) return;
  const b = pattern.bounds;
  vp.fit(b.minX / 10, b.minY / 10, b.maxX / 10, b.maxY / 10, cssW, cssH);
  request();
}

/** Centers world point (mm) at `scale` px per mm. */
function lookAt(xMm: number, yMm: number, scale: number): void {
  vp.scale = scale;
  vp.offsetX = cssW / 2 - xMm * scale;
  vp.offsetY = cssH / 2 - yMm * scale;
  request();
}

/** Centers a point given as a share of the design bounds. */
function lookAtShare(fx: number, fy: number, scale: number): void {
  if (!pattern) return;
  const b = pattern.bounds;
  lookAt((b.minX + (b.maxX - b.minX) * fx) / 10, (b.minY + (b.maxY - b.minY) * fy) / 10, scale);
}

/** The cat's face at about 12 px per thread. */
const zoomDetail = () => lookAtShare(0.5, 0.32, 30);

function load(data: Uint8Array, name: string): void {
  pattern = parsePattern(data, name);
  gl?.setPattern(pattern);
  fit();
}

// Pan and zoom, mirrored on both panels.
let drag: { x: number; y: number } | null = null;
for (const c of [c2d, cgl]) {
  c.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    c.setPointerCapture(e.pointerId);
  });
  c.addEventListener('pointermove', (e) => {
    if (!drag) return;
    vp.pan(e.clientX - drag.x, e.clientY - drag.y);
    drag = { x: e.clientX, y: e.clientY };
    request();
  });
  c.addEventListener('pointerup', () => (drag = null));
  c.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      vp.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
      request();
    },
    { passive: false },
  );
}

$('fit').addEventListener('click', fit);
$('zoom').addEventListener('click', zoomDetail);
for (const k of ['twist', 'shadow', 'fabric'] as const) {
  $<HTMLInputElement>(k).addEventListener('change', (e) => {
    opt[k] = (e.target as HTMLInputElement).checked;
    request();
  });
}
// Only the WebGL side follows the width; the app's renderer has it fixed at 0.4 mm.
$<HTMLInputElement>('width').addEventListener('input', (e) => {
  opt.threadMm = Number((e.target as HTMLInputElement).value);
  $('widthOut').textContent = `${opt.threadMm.toFixed(2)} mm`;
  request();
});
$<HTMLSelectElement>('bg').addEventListener('change', (e) => {
  opt.background = (e.target as HTMLSelectElement).value.split(',').map(Number) as [number, number, number];
  request();
});
$<HTMLInputElement>('file').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) load(new Uint8Array(await f.arrayBuffer()), f.name);
});

new ResizeObserver(resize).observe(c2d);
resize();

declare global {
  interface Window {
    /** Set by the self-contained demo build, which has no examples folder to fetch from. */
    __PES_B64?: string;
    __threadTest?: { fit: () => void; zoomDetail: () => void; lookAtShare: typeof lookAtShare; opt: GlOptions; ready: boolean };
  }
}
window.__threadTest = { fit, zoomDetail, lookAtShare, opt, ready: false };

(async () => {
  let bytes: Uint8Array;
  if (window.__PES_B64) bytes = Uint8Array.from(atob(window.__PES_B64), (ch) => ch.charCodeAt(0));
  else bytes = new Uint8Array(await (await fetch(new URL('examples/cat-60mm.pes', document.baseURI))).arrayBuffer());
  resize();
  load(bytes, 'cat-60mm.pes');
  window.__threadTest!.ready = true;
})();
