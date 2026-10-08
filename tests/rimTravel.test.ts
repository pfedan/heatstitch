import { describe, expect, it } from 'vitest';
import { TravelGrid } from '../src/digitize/fill';
import { sample } from '../src/digitize/region';
import { wholeArea } from '../src/model/knockout';
import { parsePath, ellipsePath } from '../src/shape/svgPath';

describe('travel grid', () => {
  // A fill with a part left out sews in more sections; the travel between them took the strip
  // between the ends of rows sewn already and the outline, and ran round the edge where it shows.
  it('keeps travel off the strip between sewn row ends and the outline', () => {
    const r = wholeArea(parsePath(ellipsePath(0, 0, 9, 9), [1, 0, 0, 1, 0, 0]))!;
    const grid = new TravelGrid(r, true);
    // Rows across the upper half, ending 0.3 mm inside the outline.
    const spacing = 0.4;
    for (let y = -8; y <= -1; y += spacing) {
      const x = Math.sqrt(81 - y * y) - 0.3;
      grid.cover([-x, y], [x, y], spacing / 2);
    }
    let free = 0;
    for (let j = 0; j < grid.gh; j++) {
      for (let i = 0; i < grid.gw; i++) {
        const c = j * grid.gw + i;
        const [x, y] = grid.center(i, j);
        // Passable cells beside the rows (not at their first and last one, where the band thins out).
        if (grid.depth[c] <= 0.05 || y < -7.5 || y > -1.5 || -sample(r, r.sdf, x, y) > 1) continue;
        if (!grid.covered[c] && !grid.rowEnds[c]) free++;
      }
    }
    expect(free).toBe(0);
  });
});
