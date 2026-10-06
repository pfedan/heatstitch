import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sewObjects } from '../src/model/objects';
import { forgetAll, remembered, restoreRemembered } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';
import { decodeProject, encodeProject, projectSettings } from '../src/storage/project';
import { DEFAULTS } from '../src/settings';
import { buildDemos } from './helpers/demoProject';

/**
 * The demo project under "Load example" (public/examples/demo), built by tests/helpers/demoProject.ts.
 * `UPDATE_DEMOS=1 npm test` writes it anew after a change to the designs or the app's stitching.
 */
const unpacked = async (b: Uint8Array) =>
  new Response(new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
const FILE = new URL('../public/examples/demo/heatstitch-demo.heatstitch', import.meta.url);

describe('demo project', () => {
  it('builds every design with all objects known, and opens again', async () => {
    const designs = buildDemos();
    const files = designs.map((d) => d.file());
    for (const d of designs) {
      const unknown = sewObjects(d.p).filter((o) => !remembered(d.p, o));
      expect(unknown.map((o) => `${d.title} ${o.index}`)).toEqual([]);
    }
    const bytes = await encodeProject(
      { files, active: 0, image: null, settings: projectSettings(structuredClone(DEFAULTS)) },
      new Date('2026-10-06T12:00:00Z'),
    );
    if (process.env.UPDATE_DEMOS || !existsSync(FILE)) {
      mkdirSync(new URL('./', FILE), { recursive: true });
      writeFileSync(FILE, bytes);
    }
    // The shipped file holds what the generator makes now (compared unpacked: gzip may differ by platform).
    const same = (await unpacked(new Uint8Array(readFileSync(FILE)))) === (await unpacked(bytes));
    expect(same, 'public/examples/demo is out of date: UPDATE_DEMOS=1 npm test').toBe(true);

    forgetAll();
    const back = await decodeProject(bytes);
    expect(back.files.map((f) => f.title)).toEqual(designs.map((d) => d.title));
    // Named in both app languages.
    expect(back.files.every((f) => f.titles?.de === f.title && !!f.titles?.en)).toBe(true);
    for (const f of back.files) {
      expect(f.own).toBe(true);
      const p = parsePattern(f.data, f.name);
      restoreRemembered(f.objects);
      const lost = sewObjects(p).filter((o) => !remembered(p, o));
      expect(lost.map((o) => `${f.title} ${o.index}`), 'objects that forgot what they are after opening').toEqual([]);
    }
  }, 120_000);
});
