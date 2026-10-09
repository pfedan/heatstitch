import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { geoOf, geoUse } from '../src/model/geo';
import { sewObjects } from '../src/model/objects';
import { compactStored, remember, remembered, rememberedIn, restoreRemembered, type StoredObjects } from '../src/model/restitch';
import { fromStored } from '../src/storage/fileStore';
import { parsePattern } from '../src/parsers';
import { storeForm } from '../src/shape/path';
import { decodeProject, encodeProject, PROJECT_VERSION, type Project } from '../src/storage/project';

/**
 * Project files of version 3 (the vector model): every object keeps its form in one place, and no
 * pixel mask is stored next to curves that give the same one. Files of version 2 open with the
 * same objects, ids, stitches and curves; saved and opened again, nothing changes any more.
 */
const v2 = () => decodeProject(new Uint8Array(readFileSync(new URL('./fixtures/demo-v2.heatstitch', import.meta.url))));

/** Each design of a project opened as the app does: its stitches, with what its objects remember. */
const opened = (project: Project) =>
  project.files.map((f) => {
    const p = fromStored(parsePattern(f.data, f.name), f.working) ?? parsePattern(f.data, f.name);
    const n = restoreRemembered(p, f.objects);
    return { name: f.name, p, n };
  });

/** What the objects of a design remember, comparable: ids, stitches, forms and how they are sewn. */
const summary = (p: ReturnType<typeof opened>[number]['p']) =>
  sewObjects(p).map((o) => {
    const m = remembered(p, o);
    const geo = geoOf(m);
    return JSON.stringify([o.id, o.first, o.last, o.kind, geo && storeForm(geo), geoUse(m), m?.fill?.pattern, m?.line?.type, m?.kept && Object.keys(m.kept).sort(), m?.region?.areaMm2 && Math.round(m.region.areaMm2)]);
  });

const saved = async (project: Project) => decodeProject(await encodeProject({ ...project, files: project.files.map((f, k) => ({ ...f, objects: rememberedIn(opened(project)[k].p) })) }));

describe('project version 3', () => {
  it('is the version written now, and an app of version 2 would not open it', () => {
    expect(PROJECT_VERSION).toBe(3);
  });

  it('opens a project of version 2 with the same objects, and saving it again changes nothing more', async () => {
    const old = await v2();
    const before = opened(old);
    expect(before.every((d) => d.n > 0)).toBe(true);
    // Every object of the demo is known, with its form where it had one.
    for (const d of before) expect(sewObjects(d.p).filter((o) => !remembered(d.p, o)).map((o) => `${d.name} ${o.index}`)).toEqual([]);
    const once = await saved(old);
    const after = opened(once);
    expect(after.map((d) => d.n)).toEqual(before.map((d) => d.n));
    for (let k = 0; k < before.length; k++) expect(summary(after[k].p), before[k].name).toEqual(summary(before[k].p));
    // Saved once more: the same file.
    const twice = await saved(once);
    expect(JSON.stringify(twice.files.map((f) => f.objects))).toBe(JSON.stringify(once.files.map((f) => f.objects)));
  }, 120_000);

  it('keeps no pixel mask next to curves that give it, so the file is smaller', async () => {
    const old = await v2();
    const bytes2 = await encodeProject(old);
    const once = await saved(old);
    const bytes3 = await encodeProject(once);
    // Measured on the demo: the objects 6.5 MB as JSON before, 4.5 MB now (the masks compress well,
    // the file 4 % smaller); the masks of fills that leave out shapes on top stay.
    const json = (v: unknown) => JSON.stringify(v, (_k, x) => (ArrayBuffer.isView(x) ? 'x'.repeat(Math.ceil(((x as Uint8Array).byteLength * 4) / 3)) : x)).length;
    const objects2 = old.files.reduce((n, f) => n + json(f.objects), 0);
    const objects3 = once.files.reduce((n, f) => n + json(compactStored(f.objects)), 0);
    expect(objects3).toBeLessThan(objects2 * 0.75);
    expect(bytes3.length).toBeLessThan(bytes2.length);
    for (const f of once.files) {
      const list = compactStored(f.objects) as StoredObjects;
      expect(list.v).toBe(3);
      for (const e of list.objects) {
        const m = e.memory;
        if (!m?.geo || m.knockout) continue;
        // A fill rastered from its form keeps none.
        if (m.fill && !m.fill.lineWidth) expect(m.region, `${f.name} ${e.id}`).toBeNull();
      }
    }
  }, 120_000);

  it('opens an empty fill of version 2 as the line along its form, its fill kept', async () => {
    const old = await v2();
    const f = old.files[0];
    const list = structuredClone(f.objects) as StoredObjects;
    expect(list.v).toBe(2);
    // An empty fill as version 2 kept it: its form, its border only, in its thread.
    const e = list.objects.find((x) => x.memory?.form && x.memory.fill && !x.memory.knockout && !x.memory.fill.border?.link)!;
    expect(e).toBeDefined();
    e.memory!.fill = { ...e.memory!.fill!, pattern: 'none', border: { type: 'triple', width: 2 } };
    const p = fromStored(parsePattern(f.data, f.name), f.working) ?? parsePattern(f.data, f.name);
    restoreRemembered(p, list);
    const o = sewObjects(p).find((x) => x.id === e.id)!;
    const m = remembered(p, o)!;
    expect(geoUse(m)).toBe('line');
    expect(m.fill).toBeUndefined();
    expect(m.region).toBeNull();
    expect(m.line).toMatchObject({ type: 'triple', width: 2 });
    expect(m.kept?.fill?.pattern).toBe('tatami');
    expect(storeForm(geoOf(m)!)).toEqual(e.memory!.form);
    // Remembered again as it is: the same.
    remember(p, o, m);
    expect(remembered(p, o)).toEqual(m);
  }, 120_000);
});
