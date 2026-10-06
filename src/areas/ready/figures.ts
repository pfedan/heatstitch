import { STITCH, type Pattern } from '../../model/pattern';
import type { Measurement } from '../../validation/measure';
import type { DesignFigures } from './recipes';

/** Grid for the mean density: 2 mm cells, so fills count as area and single lines as narrow strips. */
const CELL = 20; // 0.1 mm

const cache = new WeakMap<Pattern, { m?: Measurement; minLetter: number | null; out: DesignFigures }>();

/**
 * Stitch count, mean stitches per cm² over the covered area, the largest closed covered area and
 * the size of a design: what the card's rules (recipes.ts) look at.
 */
export function designFigures(p: Pattern, m: Measurement | undefined, minLetterMm: number | null): DesignFigures {
  const known = cache.get(p);
  if (known && known.m === m && known.minLetter === minLetterMm) return known.out;
  const b = p.bounds;
  const cols = Math.max(1, Math.ceil((b.maxX - b.minX) / CELL) + 1);
  const rows = Math.max(1, Math.ceil((b.maxY - b.minY) / CELL) + 1);
  const cells = new Uint8Array(cols * rows);
  let stitches = 0;
  let covered = 0;
  for (let i = 0; i < p.cmd.length; i++) {
    if (p.cmd[i] !== STITCH) continue;
    stitches++;
    const k = Math.floor((p.y[i] - b.minY) / CELL) * cols + Math.floor((p.x[i] - b.minX) / CELL);
    if (!cells[k]) {
      cells[k] = 1;
      covered++;
    }
  }
  const areaCm2 = (covered * (CELL / 100) ** 2);
  const out: DesignFigures = {
    stitches,
    perCm2: areaCm2 > 0 ? stitches / areaCm2 : 0,
    largestFillCm2: m ? largestCovered(m) : 0,
    widthMm: Math.max(0, (b.maxX - b.minX) / 10),
    heightMm: Math.max(0, (b.maxY - b.minY) / 10),
    minLetterMm,
  };
  cache.set(p, { m, minLetter: minLetterMm, out });
  return out;
}

/** The largest 4-connected area of cells well inside stitching, in cm². */
function largestCovered(m: Measurement): number {
  const { cols, rows, cover } = m;
  const seen = new Uint8Array(cols * rows);
  const stack: number[] = [];
  let best = 0;
  for (let s = 0; s < cover.length; s++) {
    if (seen[s] || !(cover[s] > 0)) continue;
    let n = 0;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      n++;
      const x = i % cols;
      const near = [x > 0 ? i - 1 : -1, x < cols - 1 ? i + 1 : -1, i - cols, i + cols];
      for (const j of near) {
        if (j < 0 || j >= cover.length || seen[j] || !(cover[j] > 0)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (n > best) best = n;
  }
  return (best * m.cellMm * m.cellMm) / 100;
}
