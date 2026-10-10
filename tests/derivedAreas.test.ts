import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sameRegion } from '../src/model/border';
import { sewObjects } from '../src/model/objects';
import { isStoredObjects, remembered, rememberedIn, restoreRemembered } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';
import { fromStored } from '../src/storage/fileStore';
import { decodeProject, encodeProject, type Project } from '../src/storage/project';

/**
 * A border or a blend's second thread in a thread of its own has no area of its own: the file does
 * not store it where it is the area of its fill, and opening gives it that again, pixel for pixel.
 */
const read = (path: string) => decodeProject(new Uint8Array(readFileSync(new URL(path, import.meta.url))));

const opened = (project: Project) =>
  project.files.map((f) => {
    const original = parsePattern(f.data, f.name);
    const p = fromStored(original, f.working) ?? original;
    restoreRemembered(p, f.objects);
    return p;
  });

/** The project saved as the app saves it (what its objects remember now) and opened again. */
async function again(project: Project): Promise<Project> {
  const ps = opened(project);
  return decodeProject(await encodeProject({ ...project, files: project.files.map((f, k) => ({ ...f, objects: rememberedIn(ps[k]) })) }));
}

/** The followers of each design as stored: with their area left out, or with pixels. */
const followers = (project: Project) =>
  project.files.flatMap((f) => (isStoredObjects(f.objects) ? f.objects.objects : []).filter((e) => e.memory?.of?.role === 'border' || e.memory?.of?.role === 'blend').map((e) => ({ name: f.name, derived: e.memory!.derived, pixels: !!e.memory!.region })));

describe('areas of followers', () => {
  it('are left out of the file and come back the same', async () => {
    const before = await read('../public/examples/demo/heatstitch-demo.heatstitch');
    const saved = await again(before);
    const stored = followers(saved);
    expect(stored.length).toBe(3);
    expect(stored.every((s) => s.derived === 'leader' && !s.pixels)).toBe(true);
    const a = opened(before);
    const b = opened(saved);
    a.forEach((p, k) => {
      const os = sewObjects(p);
      const qs = sewObjects(b[k]);
      os.forEach((o, i) => expect(sameRegion(remembered(b[k], qs[i])?.region, remembered(p, o)?.region), `${saved.files[k].name} ${i}`).toBe(true));
    });
    // Saved once more: the same objects.
    const twice = await again(saved);
    expect(JSON.stringify(twice.files.map((f) => f.objects))).toBe(JSON.stringify(saved.files.map((f) => f.objects)));
  }, 120_000);

  it('keep their pixels where they are not the area of their fill', async () => {
    // In this older demo the patch's border was sewn before its fill left out the letters.
    const saved = await again(await read('./fixtures/demo-v2.heatstitch'));
    const kept = followers(saved).filter((s) => s.pixels);
    expect(kept.map((s) => s.name)).toEqual(['Aufnäher.pes']);
    expect(kept[0].derived).toBeUndefined();
  }, 120_000);
});
