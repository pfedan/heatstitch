import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sewObjects } from '../src/model/objects';
import { designObjects, remembered, restitch, restoreRemembered, type Settings } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';
import { restitchShipped, ship, unship } from '../src/resew/live';
import { decodeProject } from '../src/storage/project';
import type { Pattern } from '../src/model/pattern';

/**
 * What the canvas shows while stitch settings are pointed at, sewn in a worker from the design as
 * it arrives there and back again: the stitches, objects and marks that picking them sews here.
 */
function check(p: Pattern, which: number[], s: Settings): void {
  const there = unship(structuredClone(ship(p)));
  const { kinds, objects } = designObjects(p);
  const here = restitch(p, objects, which, s, kinds, 2);
  const sent = restitchShipped(there, which, structuredClone(s), 2);
  const back = unship(structuredClone(sent.pattern), p);
  expect(Array.from(back.x)).toEqual(Array.from(here.pattern.x));
  expect(Array.from(back.y)).toEqual(Array.from(here.pattern.y));
  expect(Array.from(back.cmd)).toEqual(Array.from(here.pattern.cmd));
  expect(sent.starts).toEqual(here.starts);
  expect(sent.ends).toEqual(here.ends);
  expect(sent.failed).toEqual(here.failed);
  // The underlay and border marks of the preview read these.
  const marks = (m: (typeof here.memory)[number]) => [m.under, m.underFrom, m.borderAt, m.line];
  expect(structuredClone(sent.memory).map(marks)).toEqual(here.memory.map(marks));
  expect(sewObjects(back).map((o) => [o.first, o.last])).toEqual(sewObjects(here.pattern).map((o) => [o.first, o.last]));
}

describe('stitch settings sewn in the worker while pointed at', () => {
  it('shows what picking them sews', async () => {
    const project = await decodeProject(new Uint8Array(readFileSync(new URL('../public/examples/demo/heatstitch-demo.heatstitch', import.meta.url))));
    const f = project.files.find((x) => x.title === 'Blume')!;
    const p = parsePattern(f.data, f.name);
    restoreRemembered(p, f.objects);
    const { objects } = designObjects(p);
    const fill = objects.findIndex((o) => o.kind === 'fill' && remembered(p, o)?.fill);
    expect(fill).toBeGreaterThanOrEqual(0);
    const s = remembered(p, objects[fill])!.fill!;
    // Another pattern, and a second fill with a cross underlay at once.
    check(p, [fill], { kind: 'fill', s: { ...s, pattern: 'spiral' } });
    check(p, [fill, fill + 1], { kind: 'fill', s: { ...s, underlay: true, underCross: true } });
    const satin = objects.findIndex((o) => o.kind === 'satin' && remembered(p, o)?.satin);
    if (satin >= 0) check(p, [satin], { kind: 'satin', s: { ...remembered(p, objects[satin])!.satin!, spacing: 0.3 } });
  }, 120_000);

  it('shows what picking them sews, for a file from elsewhere', () => {
    const p = parsePattern(new Uint8Array(readFileSync(new URL('../public/examples/demos/sun.dst', import.meta.url))), 'sun.dst');
    const { objects } = designObjects(p);
    const fill = objects.findIndex((o) => o.kind === 'fill');
    expect(fill).toBeGreaterThanOrEqual(0);
    check(p, [fill], { kind: 'fill', s: { pattern: 'tatami', spacing: 0.4, spacingEnd: 0.8, offset: 0.25, angle: 30, stitch: 4, underlay: true, edge: 0, tolerance: 0.3 } });
  }, 60_000);
});
