import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sewObjects } from '../src/model/objects';
import { forgetAll, remembered, restoreRemembered } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';
import { decodeProject, encodeProject, projectSettings } from '../src/storage/project';
import { DEFAULTS } from '../src/settings';
import { buildDemos } from './helpers/demoProject';

/** The demo project (tests/helpers/demoProject.ts). `DEMO_PROJECT_OUT=/abs/path/demo.heatstitch npx vitest run tests/demoProject.test.ts` writes it. */
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
    if (process.env.DEMO_PROJECT_OUT) writeFileSync(new URL(process.env.DEMO_PROJECT_OUT, `file://${process.env.PWD ?? ''}/`), bytes);

    forgetAll();
    const back = await decodeProject(bytes);
    expect(back.files.map((f) => f.title)).toEqual(designs.map((d) => d.title));
    for (const f of back.files) {
      expect(f.own).toBe(true);
      const p = parsePattern(f.data, f.name);
      restoreRemembered(f.objects);
      const lost = sewObjects(p).filter((o) => !remembered(p, o));
      expect(lost.map((o) => `${f.title} ${o.index}`), 'objects that forgot what they are after opening').toEqual([]);
    }
  }, 120_000);
});
