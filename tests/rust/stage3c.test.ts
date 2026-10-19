import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import * as rs from '../../src/digitize/digitize';
import * as rsSmart from '../../src/digitize/smart';
import * as rsSvg from '../../src/image/svg';
import * as ts from './ts/digitize';
import * as tsSmart from './ts/smart';
import * as tsSvg from './ts/image/svg';
import { buildRegion, type Region } from '../../src/digitize/region';
import { components } from '../../src/image/labels';
import { DEFAULT_PREPARE, NONE, Preparer, workingSize, type Prepared } from '../../src/image/prepare';
import type { Rgb } from '../../src/image/color';
import type { ThreadColor } from '../../src/model/pattern';
import { DEFAULT_PROFILE } from '../../src/validation/profiles';
import { raster } from '../helpers/images';
import { readPng } from './png';
import { v8Math } from './v8math';

/**
 * Stage 3c of the Rust core (docs/rust-core.md): the image assistant. Its analysis and planning
 * moved to the core (sewing order, bridged pieces, areas with their skeletons and kinds, satin and
 * line networks, the records of the design, Smart's structure and satin across, the regions of an
 * SVG by color); choosing techniques, satin in sections and the memo stay TypeScript.
 *
 * The TypeScript as it was (tests/rust/ts) and the new modules run on the example SVGs and the
 * screencast material as the browser reads them (tests/rust/fixtures/stage3c-svg.json.gz: their
 * shapes, and their regions at the working size, from src/image/svg.ts in Chromium), on the app's
 * icon as a photo and on a synthetic picture with structure, and must agree exactly: the
 * algorithms are the same and the core does its arithmetic as JavaScript does.
 */

type Pt = [number, number];
interface SvgItem {
  file: string;
  widthMm: number;
  aspect: number;
  colors: Rgb[];
  shapes: rs.ShapeInput[] | null;
  w: number;
  h: number;
  pxMm: number;
  labels: string;
}

const svgs = (JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync('tests/rust/fixtures/stage3c-svg.json.gz')))) as SvgItem[]).map((s) => ({
  ...s,
  labels: new Uint8Array(gunzipSync(Uint8Array.from(atob(s.labels), (ch) => ch.charCodeAt(0)))),
}));

/** The prepared image of an SVG's regions, as the image assistant makes it (smooth 0, its exact colors). */
function preparedSvg(s: (typeof svgs)[number]): Prepared {
  // A picture of the file's shape whose working size is the one the regions were drawn at.
  for (const long of [200, 400, 1000, 2000]) {
    const [pw, ph] = s.aspect <= 1 ? [long, Math.round(long * s.aspect)] : [Math.round(long / s.aspect), long];
    const ws = workingSize(s.widthMm, pw, ph);
    if (ws.w !== s.w || ws.h !== s.h) continue;
    const exact = { width: s.w, height: s.h, labels: s.labels, colors: s.colors };
    return new Preparer(raster(pw, ph, () => [255, 255, 255, 255])).run({ ...DEFAULT_PREPARE, widthMm: s.widthMm, smooth: 0 }, [], [], exact);
  }
  throw new Error(`no picture size for ${s.file}`);
}

const BROWN = [150, 100, 60, 255] as const;
const DARK = [128, 84, 48, 255] as const;
/** Smart's test picture: a calm square, two small dots, fur of two shades in one thread. */
function furPicture(): Prepared {
  const img = raster(600, 300, (x, y) => {
    if (x >= 20 && x < 170 && y >= 20 && y < 170) return [20, 60, 170, 255];
    if (Math.hypot(x - 250, y - 80) < 16 || Math.hypot(x - 250, y - 220) < 16) return [250, 210, 20, 255];
    if (x >= 300 && x < 560 && y >= 40 && y < 260) return Math.floor((x + y) / 4) % 2 ? [...BROWN] : [...DARK];
    return [255, 255, 255, 255];
  });
  return new Preparer(img).run({ ...DEFAULT_PREPARE, widthMm: 60, maxColors: 4 });
}

const icon = () => new Preparer(readPng(new URL('../../public/pwa-512.png', import.meta.url))).run({ ...DEFAULT_PREPARE, widthMm: 60 });

const options = (o: Partial<rs.DigitizeOptions> = {}): rs.DigitizeOptions => ({ ...rs.digitizeDefaults(DEFAULT_PROFILE), ...o });

const time = (f: () => unknown): number => {
  const t = performance.now();
  f();
  return performance.now() - t;
};
const timings: string[] = [];

/** Latin-1 gives each byte a character of its own. */
const bytes = new TextDecoder('latin1');

/**
 * Deep equality, with typed arrays compared as bytes: toEqual walks a picture's masks element by
 * element, which takes most of a minute here. On a difference toEqual shows where.
 */
function same(actual: unknown, expected: unknown, what: string): void {
  const flat = (v: unknown) =>
    JSON.stringify(v, (_, x: unknown) => (ArrayBuffer.isView(x) ? `${x.constructor.name}:${bytes.decode(new Uint8Array(x.buffer, x.byteOffset, x.byteLength))}` : x));
  if (flat(actual) !== flat(expected)) expect(actual, what).toEqual(expected);
}

/** Every area of a prepared image as a region (both versions take the same). */
function regionsOf(p: Prepared): Region[] {
  const c = components(p.labels, p.width, p.height);
  const out: Region[] = [];
  c.label.forEach((l, k) => {
    if (l === NONE || c.area[k] < 20) return;
    out.push(buildRegion(c.comp, p.labels, p.width, k, l, { minX: c.minX[k], minY: c.minY[k], maxX: c.maxX[k], maxY: c.maxY[k] }, p.height, p.pxMm, 0, () => false));
  });
  return out;
}

// Exact only where Math.sin, cos, pow and atan2 are V8's own (tests/rust/v8math.ts).
describe.runIf(v8Math)('stage 3c: the image assistant against its TypeScript twin', () => {
  // Pictures as the assistant sews them, Smart and plain where they are quick; the larger SVGs
  // (their fills are most of the time, and moved in stage 3a) only as shapes, below.
  const SMART_ONLY = ['image-example.svg', 'shapes-benchmark.svg', 'kirschen.svg', 'blumenzweig.svg', 'fur'];
  const BOTH = ['brush-yong.svg', 'overlapping-circles.svg', 'icon.png'];
  const pictures: [string, Prepared][] = [
    ...svgs.filter((s) => SMART_ONLY.includes(s.file) || BOTH.includes(s.file)).map((s) => [s.file, preparedSvg(s)] as [string, Prepared]),
    ['fur', furPicture()],
    ['icon.png', icon()],
  ];
  const sewn = new Map<string, rs.Digitized>();

  it('orders the colors and sews each picture the same, Smart and plain', () => {
    for (const [name, p] of pictures) {
      expect(rs.sewingOrder(p.labels, p.width, p.height, p.pxMm, p.palette.length), name).toEqual(ts.sewingOrder(p.labels, p.width, p.height, p.pxMm, p.palette.length));
      for (const o of BOTH.includes(name) ? [options({ smart: true }), options({ flow: false })] : [options({ smart: true })]) {
        let a!: ts.Digitized;
        let b!: rs.Digitized;
        const tOld = time(() => (a = ts.digitize(p, o, name)));
        const tNew = time(() => (b = rs.digitize(p, o, name)));
        timings.push(`digitize ${name} ${o.smart ? 'smart' : 'flat'}: ${tOld.toFixed(0)} ms -> ${tNew.toFixed(0)} ms, ${b.pattern.cmd.length} records`);
        same(b.pattern, a.pattern, name);
        same(b.starts, a.starts, name);
        same(b.objects, a.objects, name);
        same(b.areas, a.areas, name);
        if (o.smart) sewn.set(name, b);
      }
    }
  }, 120_000);

  it('sews the shapes of each SVG the same, with and without knockout', () => {
    const SLOW = ['favicon.svg', 'fliegenpilz-quelle.svg', 'katze-im-karton.svg'];
    const KNOCKOUT = ['image-example.svg', 'shapes-benchmark.svg', 'overlapping-circles.svg', 'apfel.svg'];
    for (const s of svgs) {
      if (!s.shapes || SLOW.includes(s.file)) continue;
      const shapes = rs.wideLinesAsAreas(s.shapes);
      const threads: ThreadColor[] = s.colors.map(([r, g, b]) => ({ r, g, b }));
      const size = { w: s.widthMm, h: s.widthMm * s.aspect };
      for (const knockout of KNOCKOUT.includes(s.file) ? [false, true] : [false]) {
        let a!: ts.Digitized;
        let b!: rs.Digitized;
        const o = options();
        const tOld = time(() => (a = ts.digitizeShapes(shapes, threads, o, size, knockout, s.file)));
        const tNew = time(() => (b = rs.digitizeShapes(shapes, threads, o, size, knockout, s.file)));
        if (!knockout) timings.push(`digitizeShapes ${s.file}: ${tOld.toFixed(0)} ms -> ${tNew.toFixed(0)} ms`);
        same(b.pattern, a.pattern, s.file);
        same(b.starts, a.starts, s.file);
        same(b.objects, a.objects, s.file);
      }
    }
  }, 120_000);

  it('measures each area as Smart does, and sews strokes as satin the same', () => {
    let n = 0;
    for (const [name, p] of pictures) {
      for (const r of regionsOf(p)) {
        n++;
        expect(rsSmart.structure(r, p.orient), name).toBe(tsSmart.structure(r, p.orient));
        expect(rsSmart.acrossGraph(r, 7), name).toEqual(tsSmart.acrossGraph(r, 7));
        expect(rsSmart.acrossGraph(r, 7, 7, Infinity), name).toEqual(tsSmart.acrossGraph(r, 7, 7, Infinity));
        expect(rs.isStroke(r), name).toEqual(ts.isStroke(r));
        const start: Pt = [r.x0 * r.pxMm, r.y0 * r.pxMm];
        const p0 = { spacing: 0.4, pull: 0.2, splitMm: rs.SATIN_MAX };
        expect(rs.satinForArea(r, start, p0, true, 0.15), name).toEqual(ts.satinForArea(r, start, p0, true, 0.15));
      }
    }
    expect(n).toBeGreaterThan(50);
  });

  it('shows the pixels of areas the same', () => {
    for (const [name, p] of pictures) {
      const areas = sewn.get(name)?.areas ?? [];
      const c = components(p.labels, p.width, p.height);
      for (const k of [...new Set([0, 1, Math.floor(areas.length / 2), areas.length - 1])].filter((k) => k >= 0 && k < areas.length)) {
        const keys = [areas[k].key, 'bad key'];
        same(rsSmart.areaPixels(c, p.width, p.height, areas, keys), tsSmart.areaPixels(c, p.width, p.height, areas, keys), name);
      }
    }
  });

  it('prints the timings', () => {
    console.log(timings.join('\n'));
  });
});

// No trigonometry here: exact everywhere.
describe('stage 3c: SVG regions against their TypeScript twin', () => {
  it('reads the regions of an SVG from its drawings the same', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 256;
    for (const count of [1, 3, 5, 9]) {
      const size = 3000;
      const passes = Array.from({ length: Math.ceil(count / 3) }, () => Uint8ClampedArray.from({ length: 4 * size }, rnd));
      same(rsSvg.labelsFromPasses(passes, count, size), tsSvg.labelsFromPasses(passes, count, size), `${count} colors`);
    }
    // The byte comparison sees a difference in a typed array.
    expect(() => same({ m: new Uint8Array([1, 2]) }, { m: new Uint8Array([1, 3]) }, 'self test')).toThrow();
  });
});
