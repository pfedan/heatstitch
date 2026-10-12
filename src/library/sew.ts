import type { DigitizeOptions } from '../digitize/digitize';
import type { PrepareOptions } from '../image/prepare';
import { digitizedFile } from '../model/digitized';
import { overlapsIn, setKnockout } from '../model/knockout';
import type { Pattern } from '../model/pattern';
import { digitizeSvg } from '../ui/imageMode';

/** How wide a motif is put in when nothing else says (mm): big enough for the details of an emoji. */
export const MOTIF_MM = 60;

/** The file with its size set: `widthMm` wide, as high as its viewBox says. */
export function sized(svg: string, widthMm: number): string {
  const root = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!root) return svg;
  const vb = root.match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1].trim().split(/[\s,]+/).map(Number);
  const aspect = vb?.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb[3] / vb[2] : 1;
  const r = (v: number) => Math.round(v * 100) / 100;
  const next = root.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, '').replace(/^<svg\b/i, `<svg width="${r(widthMm)}mm" height="${r(widthMm * aspect)}mm"`);
  return svg.replace(root, next);
}

/**
 * A motif of the library sewn as a design of its own, its middle at the origin: each shape of
 * the file one object, like an opened SVG, with what lies under later shapes left out (the
 * library's motifs are flat pictures, layered: sewn whole they would be twice as thick there).
 */
export async function sewMotif(svg: string, name: string, widthMm: number, prepare: PrepareOptions, options: DigitizeOptions & { trimMm: number }): Promise<Pattern> {
  const file = new File([sized(svg, widthMm)], `${name}.svg`, { type: 'image/svg+xml' });
  const d = await digitizeSvg(file, prepare, options, false);
  const { pattern } = digitizedFile(d, name, options.trimMm);
  const over = overlapsIn(pattern);
  return (over.length && setKnockout(pattern, over, true, options.trimMm)?.pattern) || pattern;
}
