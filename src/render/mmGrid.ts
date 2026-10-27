import type { Viewport } from './viewport';

/** The three weights of millimetre paper: every 10 mm strong, every 5 mm medium, every 1 mm thin. */
const LEVELS = [
  { every: 10, alpha: 0.42, px: 1.5 },
  { every: 5, alpha: 0.26, px: 1 },
  { every: 1, alpha: 0.14, px: 0.5 },
] as const;

/** Lines closer than this on screen (CSS px) are left out, from here to FULL_PX they fade in. */
const FADE_PX = 3;
const FULL_PX = 8;

/** r, g, b (0 to 255) of a CSS color as getComputedStyle gives it (`rgb(...)`, `rgba(...)`) or `#rrggbb`. */
export function parseRgb(css: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(css);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** WCAG relative luminance of an sRGB color (0 black to 1 white). */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * The ink of the lines on `background`: a darker shade of it on a light color, a lighter one on a
 * dark color, so the paper keeps the chosen color. The switch lies where black and white text have
 * the same contrast (luminance 0.179).
 */
export function gridInk(background: string): { rgb: [number, number, number]; scale: number } {
  const bg = parseRgb(background) ?? [128, 128, 128];
  const light = luminance(bg) > 0.179;
  // Toward black on light paper; toward white on dark paper, a bit stronger as light lines read weaker.
  const to = light ? 0 : 255;
  const mix = light ? 0.75 : 0.85;
  return { rgb: bg.map((c) => Math.round(c + (to - c) * mix)) as [number, number, number], scale: light ? 1 : 0.9 };
}

/** How strongly lines `spacingPx` apart are drawn (0 to 1): too close lines would only gray the paper. */
export function gridFade(spacingPx: number): number {
  return Math.max(0, Math.min(1, (spacingPx - FADE_PX) / (FULL_PX - FADE_PX)));
}

/**
 * Millimetre paper over the whole `w` x `h` (CSS px) view: lines every 1, 5 and 10 mm, a strong
 * line through `center` (mm) in both directions. Each line is drawn once, at its strongest level,
 * on whole device pixels so it stays sharp; finer levels fade out as they close up on screen.
 */
export function drawMmGrid(ctx: CanvasRenderingContext2D, vp: Viewport, w: number, h: number, center: readonly [number, number], background: string): void {
  const t = ctx.getTransform();
  const dpr = Math.abs(t.a) || 1;
  const ink = gridInk(background);
  const [wx0, wy0] = vp.toWorld(0, 0);
  const [wx1, wy1] = vp.toWorld(w, h);
  // Whole millimetres from the center, so the strong lines meet in the middle of the design.
  const range = (a: number, b: number, c: number) => [Math.floor(a - c), Math.ceil(b - c)] as const;
  const [ix0, ix1] = range(wx0, wx1, center[0]);
  const [iy0, iy1] = range(wy0, wy1, center[1]);
  ctx.save();
  // Draw in device pixels: the lines snap to the pixel grid whatever the zoom.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const snap = (v: number, lw: number) => (Math.round(lw) % 2 ? Math.floor(v) + 0.5 : Math.round(v));
  for (const [level, { every, alpha, px }] of LEVELS.entries()) {
    const fade = gridFade(every * vp.scale);
    if (fade <= 0) continue;
    const lw = Math.max(1, Math.round(px * dpr));
    const coarser = LEVELS.slice(0, level).map((l) => l.every);
    const own = (i: number) => i % every === 0 && !coarser.some((c) => i % c === 0);
    ctx.beginPath();
    for (let i = ix0; i <= ix1; i++) {
      if (!own(i)) continue;
      const x = snap(t.a * vp.toScreen(center[0] + i, 0)[0] + t.e, lw);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let i = iy0; i <= iy1; i++) {
      if (!own(i)) continue;
      const y = snap(t.d * vp.toScreen(0, center[1] + i)[1] + t.f, lw);
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.lineWidth = lw;
    ctx.strokeStyle = `rgba(${ink.rgb.join(', ')}, ${(alpha * ink.scale * fade).toFixed(3)})`;
    ctx.stroke();
  }
  ctx.restore();
}
