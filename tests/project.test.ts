import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sewObjects } from '../src/model/objects';
import { analyze, knownKind, measureFill, remember, remembered, rememberRange, rememberedIn, restitch, restoreRemembered, shapeTrust } from '../src/model/restitch';
import { STITCH, TRIM, type Pattern } from '../src/model/pattern';
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
  const settings = projectSettings({ ...structuredClone(DEFAULTS), profile: { fabric: 'leather', thread: '60' }, trimMm: 5, background: '#ece4d4' });
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
  it('keeps the background color, and older projects without one leave it alone', async () => {
    const back = await decodeProject(await encodeProject(sample()));
    expect(back.settings.background).toBe('#ece4d4');
    const { background, ...older } = sample().settings;
    void background;
    const old = await decodeProject(await encodeProject({ ...sample(), settings: older }));
    expect(old.settings.background).toBeUndefined();
  });

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

  it('sews a fill along guide lines and keeps them with its underlay', async () => {
    const data = bytesOf('demos/overlap.pes');
    const p = parsePattern(data, 'overlap.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs.find((x) => x.kind === 'fill')!;
    const an = analyze(p, o, kinds);
    const m = measureFill(p, an);
    const a = an.fill!;
    const [x0, y0, x1, y1] = [a.x0 * a.pxMm, a.y0 * a.pxMm, (a.x0 + a.w) * a.pxMm, (a.y0 + a.h) * a.pxMm];
    const ym = (y0 + y1) / 2;
    const guide: [number, number][] = [
      [x0, ym],
      [(x0 + x1) / 2, ym - (y1 - y0) / 6],
      [x1, ym],
    ];
    const s = { ...m, pattern: 'guided' as const, guides: [guide], underlay: true, underCross: true, underInset: 0.8 };
    const r = restitch(p, objs, [o.index], { kind: 'fill', s }, kinds, 7);
    expect(r.failed).toEqual([]);
    const q = r.pattern;
    const now = sewObjects(q).find((x) => x.first === firstRecord(q, r.starts[0] + 1))!;
    remember(q, now, { region: r.regions[0], fill: s });
    const back = await decodeProject(
      await encodeProject({ files: [{ name: 'overlap.pes', data, working: toStored(q), acks: [], objects: rememberedIn(q, sewObjects(q)) }], active: 0, image: null, settings: projectSettings(DEFAULTS) }),
    );
    expect(restoreRemembered(back.files[0].objects)).toBe(1);
    const again = remembered(q, now)!.fill!;
    expect(again.pattern).toBe('guided');
    expect(again.guides).toEqual([guide]);
    expect(again.underCross).toBe(true);
    expect(again.underInset).toBe(0.8);
  }, 30_000);

  it('skips stored objects that do not hold together', () => {
    expect(restoreRemembered([{ key: 'a', region: { x0: 0, y0: 0, w: 2, h: 2, pxMm: 0.1, mask: new Uint8Array(3), areaMm2: 1 } }])).toBe(0);
    expect(restoreRemembered([{ key: 'b', region: null, fill: { pattern: 'zigzag' } }])).toBe(0);
    expect(restoreRemembered('nope')).toBe(0);
  });
});

describe('wild stitches in a user\'s project', () => {
  // A user's project: a spiral and a fill with a satin border that showed stray stitches.
  const load = async (name: string) => {
    const file = (await decodeProject(new Uint8Array(readFileSync(new URL('./fixtures/wild-stitches.heatstitch', import.meta.url))))).files.find((f) => f.name === name)!;
    restoreRemembered(file.objects);
    const p = fromStored(parsePattern(file.data, file.name), file.working)!;
    const kinds = stitchKinds(p);
    return { p, kinds, objs: sewObjects(p, kinds) };
  };

  /** Longest stitch (mm) from record a to b, jumps and trims breaking the thread. */
  const longest = (p: Pattern, a: number, b: number) => {
    let m = 0;
    for (let i = a + 1; i <= b; i++) if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH) m = Math.max(m, Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) / 10);
    return m;
  };

  it('travels from the end of the underlay to the start of the spiral instead of one wild stitch', async () => {
    // A spiral with underlay that once sewed a 79.6 mm stitch straight across.
    const { p, kinds, objs } = await load('New design.pes');
    const o = objs.find((x) => remembered(p, x)?.fill?.pattern === 'spiral')!;
    const fill = remembered(p, o)!.fill!;
    expect(longest(p, o.first, o.last)).toBeGreaterThan(70);

    const r = restitch(p, objs, [o.index], { kind: 'fill', s: fill }, kinds, 3);
    const q = r.pattern;
    const now = sewObjects(q).find((x) => x.first === firstRecord(q, r.starts[0] + 1))!;
    // Rows of 4 mm, travel of 2.5 mm: at most a little over the stitch length anywhere.
    expect(longest(q, now.first, now.last)).toBeLessThan(fill.stitch * 1.35);
  }, 30_000);

  it('does not keep the travel of a fill along its edge as a satin sewn again after the border', async () => {
    // The fill's travel along its edge lies under its own satin border; it was taken for the
    // satin's underlay, kept as it was and sewn on top of the new border with every edit.
    const { p, kinds, objs } = await load('shapes-benchmark.pes');
    const o = objs.find((x) => remembered(p, x)?.fill?.border?.type === 'satin' && remembered(p, x)?.knockout)!;
    const parts = analyze(p, o, kinds).parts;
    expect(parts.filter((pt) => !pt.border).map((pt) => pt.kind)).not.toContain('satin');

    const r = restitch(p, objs, [o.index], { kind: 'fill', s: remembered(p, o)!.fill! }, kinds, 3);
    const q = r.pattern;
    const now = sewObjects(q).find((x) => x.first === firstRecord(q, r.starts[0] + 1))!;
    // Nothing is sewn after the border: no trim between where it starts and the end of the object.
    const from = firstRecord(q, r.starts[0] + r.memory[0].borderAt!);
    let trims = 0;
    for (let i = from; i < now.last; i++) if (q.cmd[i] === TRIM) trims++;
    expect(trims).toBe(0);
  }, 30_000);
});

describe('the kind of an object sewn here', () => {
  it('stays a fill for a small spiral whose loose turns read like a running stitch', async () => {
    // A user's project: two spirals of under 3 mm, made from wide lines, listed as running stitches.
    const file = (await decodeProject(new Uint8Array(readFileSync(new URL('./fixtures/spiral-kind.heatstitch', import.meta.url))))).files[0];
    restoreRemembered(file.objects);
    const p = fromStored(parsePattern(file.data, file.name), file.working)!;
    const kinds = stitchKinds(p);
    const spirals = sewObjects(p, kinds).filter((o) => remembered(p, o)?.fill?.pattern === 'spiral');
    expect(spirals).toHaveLength(2);
    expect(spirals.map((o) => o.kind)).toEqual(['fill', 'fill']);
    // Unknown, the same stitches are still read from what they look like.
    expect(knownKind(undefined)).toBeUndefined();

    // Sewn anew, it is still a fill.
    const r = restitch(p, sewObjects(p, kinds), [spirals[0].index], { kind: 'fill', s: { ...remembered(p, spirals[0])!.fill!, spacing: 0.5 } }, kinds, 3);
    const at = sewObjects(r.pattern).find((x) => x.first === firstRecord(r.pattern, r.starts[0] + 1))!;
    rememberRange(r.pattern, at.first, at.last, r.memory[0]);
    const now = sewObjects(r.pattern).find((x) => x.first === at.first)!;
    expect(now.kind).toBe('fill');
  }, 30_000);

  it('follows what the object remembers, and leaves doubtful cases to the stitches', () => {
    const fill = { pattern: 'spiral' } as never;
    const satin = { spacing: 0.4 } as never;
    expect(knownKind({ region: null, fill })).toBe('fill');
    expect(knownKind({ region: null, satin })).toBe('satin');
    expect(knownKind({ region: null, fill, satin })).toBeUndefined();
    expect(knownKind({ region: null, fill, read: true })).toBeUndefined();
    expect(knownKind({ region: null, fill, outline: 'a', border: { type: 'run', width: 0 } })).toBe('run');
    expect(knownKind({ region: null, fill, outline: 'a', border: { type: 'satin', width: 2 } })).toBe('satin');
  });
});

/** Record of the n-th stitch (1-based). */
function firstRecord(p: { cmd: Uint8Array }, n: number): number {
  let k = 0;
  for (let i = 0; i < p.cmd.length; i++) if (p.cmd[i] === 0 && ++k === n) return i;
  return p.cmd.length;
}
