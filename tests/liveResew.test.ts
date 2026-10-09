import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sewObjects } from '../src/model/objects';
import { restoreRemembered } from '../src/model/restitch';
import { transformObjects } from '../src/model/reshape';
import { parsePattern } from '../src/parsers';
import { resew, ship, unship } from '../src/resew/live';
import { scaling } from '../src/shape/path';
import { decodeProject } from '../src/storage/project';
import type { Pattern } from '../src/model/pattern';

/**
 * What the frame shows while scaling is sewn in a worker, from the design as it arrives there and
 * back again: the stitches and objects that letting go sews here.
 */
function check(p: Pattern, sel: number[]): void {
  const objs = sewObjects(p);
  const ax = Math.min(...sel.map((o) => objs[o].minX)) / 10;
  const ay = Math.min(...sel.map((o) => objs[o].minY)) / 10;
  const m = scaling(1.23, 1.17, ax, ay);
  // Sent before anything is sewn from it here, cloned as postMessage clones it.
  const there = unship(structuredClone(ship(p)));
  const here = transformObjects(p, sel, m, 2);
  const sent = resew(there, sel, structuredClone(m), 2);
  expect(!!sent).toBe(!!here);
  if (!here || !sent) return;
  const back = unship(structuredClone(sent), p);
  expect(Array.from(back.x)).toEqual(Array.from(here.pattern.x));
  expect(Array.from(back.y)).toEqual(Array.from(here.pattern.y));
  expect(Array.from(back.cmd)).toEqual(Array.from(here.pattern.cmd));
  expect(back.colors).toEqual(here.pattern.colors);
  expect(sewObjects(back).map((o) => [o.first, o.last])).toEqual(sewObjects(here.pattern).map((o) => [o.first, o.last]));
  // Only to be looked at: what the objects know stays behind.
  expect(sent.objects.objects.some((e) => e.memory)).toBe(false);
}

describe('scaling sewn in the worker while dragging', () => {
  it('shows what letting go sews, for designs made here', async () => {
    const project = await decodeProject(new Uint8Array(readFileSync(new URL('../public/examples/demo/heatstitch-demo.heatstitch', import.meta.url))));
    // A satin stem, fills alone and together, a line with effects, a fill of the patch.
    const picks: [string, number[][]][] = [['Blume', [[0], [1], [1, 2]]], ['Linieneffekte', [[2]]], ['Aufnäher', [[2]]]];
    for (const [title, sels] of picks) {
      const f = project.files.find((x) => x.title === title)!;
      const p = parsePattern(f.data, f.name);
      restoreRemembered(p, f.objects);
      for (const sel of sels) check(p, sel);
    }
  }, 120_000);

  it('shows what letting go sews, for a file from elsewhere', () => {
    const p = parsePattern(new Uint8Array(readFileSync(new URL('../public/examples/demos/sun.dst', import.meta.url))), 'sun.dst');
    check(p, [0]);
  }, 60_000);
});
