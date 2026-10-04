import { describe, expect, it } from 'vitest';
import { recolor } from '../src/model/recolor';
import { parsePes } from '../src/parsers/pes';
import { pecThreads } from '../src/parsers/pecPalette';
import { writePes } from '../src/writers/pes';
import { Shape } from './helpers/shapes';

describe('thread colors per color block', () => {
  it('changes one block and leaves the records alone', () => {
    const p = new Shape().to(0, 0).to(5, 0).to(10, 0).build();
    const c = pecThreads().find((t) => t.name === 'Lime Green')!;
    const q = recolor(p, 0, c);
    expect(q.colors[0]).toMatchObject({ r: c.r, g: c.g, b: c.b, name: 'Lime Green' });
    expect(q.cmd).toBe(p.cmd);
    expect(p.colors[0]).not.toEqual(q.colors[0]);
  });

  it('saves a palette thread to PES in its own slot, a free color as the nearest', () => {
    const p = new Shape().to(0, 0).to(5, 0).to(10, 0).build();
    const lime = pecThreads().find((t) => t.name === 'Lime Green')!;
    expect(parsePes(writePes(recolor(p, 0, lime))).colors[0].name).toBe('Lime Green');
    const near = parsePes(writePes(recolor(p, 0, { r: 250, g: 250, b: 5 }))).colors[0];
    expect(near.name).toBe('Yellow');
  });

  it('fills blocks the file did not list a color for', () => {
    const p = { ...new Shape().to(0, 0).to(5, 0).build(), colors: [] };
    const q = recolor(p, 2, { r: 1, g: 2, b: 3 });
    expect(q.colors).toHaveLength(3);
    expect(q.colors[2]).toMatchObject({ r: 1, g: 2, b: 3 });
  });
});
