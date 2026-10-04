import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sewObjects } from '../src/model/objects';
import { analyze, measureFill, remember, remembered, rememberedIn, restitch, restoreRemembered, shapeTrust } from '../src/model/restitch';
import { recolor } from '../src/model/recolor';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { DEFAULTS } from '../src/settings';
import { fromStored, toStored } from '../src/storage/fileStore';
import { decodeProject, encodeProject, projectSettings, ProjectError, type Project } from '../src/storage/project';

const bytesOf = (f: string) => new Uint8Array(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)));

function sample(): Project {
  const data = bytesOf('cat-60mm.pes');
  const original = parsePattern(data, 'cat-60mm.pes');
  // A custom color no PES palette slot holds exactly.
  const edited = recolor(original, 0, { r: 12, g: 34, b: 56, name: 'Mein Blau' });
  const settings = projectSettings({ ...structuredClone(DEFAULTS), profile: { fabric: 'leather', thread: '60' }, trimMm: 5 });
  return {
    files: [
      { name: 'cat-60mm.pes', data, working: toStored(edited), acks: [{ bbox: { minX: 1, minY: 2, maxX: 3, maxY: 4 }, reason: 'manual' }], objects: [] },
      { name: 'overlap.pes', data: bytesOf('demos/overlap.pes'), acks: [], objects: [] },
    ],
    active: 1,
    image: {
      name: 'logo.png',
      type: 'image/png',
      data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
      work: { edits: [{ from: [1, 2, 3], skip: true }], strokes: [{ points: [[0.1, 0.2]], radius: 0.01, color: null }] },
    },
    settings,
  };
}

describe('project files', () => {
  it('reads back everything it wrote, compressed', async () => {
    const p = sample();
    const bytes = await encodeProject(p);
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    const back = await decodeProject(bytes);

    expect(back.active).toBe(1);
    expect(back.files.map((f) => f.name)).toEqual(['cat-60mm.pes', 'overlap.pes']);
    expect([...back.files[0].data]).toEqual([...p.files[0].data]);
    expect(back.files[1].working).toBeUndefined();
    expect(back.files[0].acks).toEqual(p.files[0].acks);

    const original = parsePattern(back.files[0].data, back.files[0].name);
    const w = fromStored(original, back.files[0].working)!;
    const want = fromStored(original, p.files[0].working)!;
    expect([...w.x]).toEqual([...want.x]);
    expect([...w.y]).toEqual([...want.y]);
    expect([...w.cmd]).toEqual([...want.cmd]);
    // The exact thread color survives (PES would round it to a palette slot).
    expect(w.colors[0]).toMatchObject({ r: 12, g: 34, b: 56, name: 'Mein Blau' });

    expect(back.image?.name).toBe('logo.png');
    expect([...back.image!.data]).toEqual([...p.image!.data]);
    expect(back.image?.work).toEqual(p.image!.work);
    expect(back.settings).toEqual(p.settings);
    expect(back.settings.profile.fabric).toBe('leather');
    expect(back.settings.trimMm).toBe(5);
  });

  it('also opens an uncompressed project', async () => {
    const p = sample();
    const gz = await encodeProject(p);
    const plain = new Uint8Array(await new Response(new Blob([gz as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    expect(plain[0]).toBe('{'.charCodeAt(0));
    const back = await decodeProject(plain);
    expect(back.files.length).toBe(2);
  });

  it('refuses other files and projects of a newer version', async () => {
    await expect(decodeProject(bytesOf('cat-60mm.pes'))).rejects.toMatchObject({ reason: 'invalid' });
    await expect(decodeProject(new TextEncoder().encode('{"format":"something"}'))).rejects.toBeInstanceOf(ProjectError);
    const newer = new TextEncoder().encode(JSON.stringify({ format: 'heatstitch-project', version: 999, files: [] }));
    await expect(decodeProject(newer)).rejects.toMatchObject({ reason: 'newer' });
  });

  it('drops malformed parts and keeps the rest', async () => {
    const doc = {
      format: 'heatstitch-project',
      version: 1,
      active: 7,
      files: [{ name: 'x.pes' }, { name: 'y.dst', data: { $bin: 'u8', b64: 'AAAA' }, acks: [{ bbox: 1 }], working: { x: [1] } }],
      image: { name: 'a.png' },
      settings: { trimMm: -1, profile: { fabric: 'nonsense' } },
    };
    const back = await decodeProject(new TextEncoder().encode(JSON.stringify(doc)));
    expect(back.files.map((f) => f.name)).toEqual(['y.dst']);
    expect(back.files[0].acks).toEqual([]);
    expect(back.files[0].working).toBeUndefined();
    expect(back.active).toBeNull();
    expect(back.image).toBeNull();
    expect(back.settings.trimMm).toBe(DEFAULTS.trimMm);
    expect(back.settings.profile).toEqual(DEFAULTS.profile);
  });

  it('keeps the shape and fill pattern of a restitched object', async () => {
    const data = bytesOf('demos/overlap.pes');
    const p = parsePattern(data, 'overlap.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs.find((x) => x.kind === 'fill')!;
    const m = measureFill(p, analyze(p, o, kinds));
    const r = restitch(p, objs, [o.index], { kind: 'fill', s: { ...m, pattern: 'spiral', stitch: 2.5 } }, kinds, 7);
    const q = r.pattern;
    const now = sewObjects(q).find((x) => x.first === firstRecord(q, r.starts[0] + 1))!;
    remember(q, now, { region: r.regions[0], fill: { ...m, pattern: 'spiral' } });

    const stored = rememberedIn(q, sewObjects(q));
    expect(stored.length).toBe(1);
    const back = await decodeProject(
      await encodeProject({ files: [{ name: 'overlap.pes', data, working: toStored(q), acks: [], objects: stored }], active: 0, image: null, settings: projectSettings(DEFAULTS) }),
    );
    // As after a reload: the shape is rebuilt from its pixels.
    expect(restoreRemembered(back.files[0].objects)).toBe(1);
    const again = remembered(q, now)!;
    expect(again.region).not.toBe(r.regions[0]);
    expect(again.fill?.pattern).toBe('spiral');
    expect([...again.region!.mask]).toEqual([...r.regions[0]!.mask]);
    expect([...again.region!.sdf]).toEqual([...r.regions[0]!.sdf]);
    const an = analyze(q, now, stitchKinds(q));
    expect(an.fill).toBe(again.region);
    expect(shapeTrust(q, now, an, 0.4)).toBe('kept');
  }, 30_000);

  it('skips stored objects that do not hold together', () => {
    expect(restoreRemembered([{ key: 'a', region: { x0: 0, y0: 0, w: 2, h: 2, pxMm: 0.1, mask: new Uint8Array(3), areaMm2: 1 } }])).toBe(0);
    expect(restoreRemembered([{ key: 'b', region: null, fill: { pattern: 'zigzag' } }])).toBe(0);
    expect(restoreRemembered('nope')).toBe(0);
  });
});

/** Record of the n-th stitch (1-based). */
function firstRecord(p: { cmd: Uint8Array }, n: number): number {
  let k = 0;
  for (let i = 0; i < p.cmd.length; i++) if (p.cmd[i] === 0 && ++k === n) return i;
  return p.cmd.length;
}
