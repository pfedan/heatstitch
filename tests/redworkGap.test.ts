import { describe, expect, it } from 'vitest';
import { lineGoes, lineStitches } from '../src/model/line';
import { remembered } from '../src/model/restitch';
import { sewObjects } from '../src/model/objects';
import type { Mat } from '../src/shape/path';
import { parsePath } from '../src/shape/svgPath';
import { Design, THREADS } from './helpers/demoProject';

const ID: Mat = [1, 0, 0, 1, 0, 0];
// Three strokes, 0.3 mm and 1.5 mm apart at their ends, and one 5 mm off.
const form = parsePath('M0 0 L10 0 M10.3 0 L20 0 M21.5 0 L30 0 M35 0 L45 0', ID);

describe('Redwork: Lücken überbrücken bis', () => {
  it('sews paths up to the gap apart in one go', () => {
    expect(lineGoes(form)).toEqual({ apart: 4, redwork: 3 });
    expect(lineGoes(form, 0)).toEqual({ apart: 4, redwork: 4 });
    expect(lineGoes(form, 2)).toEqual({ apart: 4, redwork: 2 });
    expect(lineGoes(form, 3)).toEqual({ apart: 4, redwork: 2 });
    const st = { type: 'run' as const, width: 0, redwork: true };
    expect(lineStitches(form, st)).toHaveLength(3);
    expect(lineStitches(form, { ...st, redworkGap: 2 })).toHaveLength(2);
  });

  it('is kept with the line', () => {
    const d = new Design('Lücke');
    d.line('M0 0 L10 0 M11.5 0 L20 0', THREADS.navy, { redwork: true, redworkGap: 2 });
    const m = remembered(d.p, sewObjects(d.p)[0])!;
    expect(m.line).toMatchObject({ redwork: true, redworkGap: 2 });
  });
});
