import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { digitizeDefaults, digitizeShapes, type ShapeInput } from '../../src/digitize/digitize';
import { digitizedFile } from '../../src/model/digitized';
import { sewObjects } from '../../src/model/objects';
import type { Pattern, ThreadColor } from '../../src/model/pattern';
import { restoreRemembered } from '../../src/model/restitch';
import { parsePattern } from '../../src/parsers';
import { bounds, type Mat } from '../../src/shape/path';
import { parsePath } from '../../src/shape/svgPath';
import { decodeProject } from '../../src/storage/project';
import { DEFAULT_PROFILE } from '../../src/validation/profiles';

/**
 * The designs of public/examples as the app opens them, for comparing whole designs sewn anew
 * before and after a stage: the demo project's designs (every object knows its shape and how it is
 * sewn), the files from elsewhere (shapes guessed from their stitches), and the SVG examples
 * digitized from their path data (tests/rust/fixtures/stage2-svg-shapes.json.gz), areas filled and
 * lines sewn as satin or running stitch in turn.
 */

export interface Design {
  name: string;
  pattern: Pattern;
}

const unzip = (gz: Uint8Array): string => new TextDecoder().decode(gunzipSync(gz));

const THREADS: ThreadColor[] = [
  { r: 200, g: 40, b: 50 },
  { r: 30, g: 120, b: 60 },
  { r: 240, g: 200, b: 40 },
  { r: 20, g: 20, b: 20 },
];

/** The designs, or only those `only` keeps (by name). */
export async function designs(only: (name: string) => boolean = () => true): Promise<Design[]> {
  const out: Design[] = [];
  const project = await decodeProject(new Uint8Array(readFileSync('public/examples/demo/heatstitch-demo.heatstitch')));
  for (const f of project.files) {
    if (!only(f.title ?? f.name)) continue;
    const p = parsePattern(f.data, f.name);
    restoreRemembered(p, f.objects);
    out.push({ name: f.title ?? f.name, pattern: p });
  }
  for (const name of ['cat-60mm.pes', 'demos/confetti.pes', 'demos/leather-patch.dst', 'demos/letters.pes', 'demos/overlap.pes', 'demos/patch.pes', 'demos/sun.dst']) {
    if (!only(name)) continue;
    out.push({ name, pattern: parsePattern(new Uint8Array(readFileSync(`public/examples/${name}`)), name.split('/').pop()!) });
  }
  const svg = JSON.parse(unzip(readFileSync('tests/rust/fixtures/stage2-svg-shapes.json.gz'))) as { design: string; fill: boolean; d: string; m: Mat }[];
  const options = digitizeDefaults(DEFAULT_PROFILE);
  for (const name of [...new Set(svg.map((s) => s.design))]) {
    if (!only(`svg ${name}`)) continue;
    const shapes: ShapeInput[] = svg
      .filter((s) => s.design === name)
      .map((s, k) => {
        const form = parsePath(s.d, s.m);
        return s.fill ? { color: k % 3, kind: 'fill' as const, form } : { color: 3, kind: 'stroke' as const, width: k % 2 ? 1.5 : 0.3, form };
      });
    const b = shapes.map((s) => bounds(s.form)).reduce((u, x) => (x && u ? { minX: Math.min(u.minX, x.minX), minY: Math.min(u.minY, x.minY), maxX: Math.max(u.maxX, x.maxX), maxY: Math.max(u.maxY, x.maxY) } : (u ?? x)));
    if (!b) continue;
    const d = digitizeShapes(shapes, THREADS, options, { w: b.maxX, h: b.maxY }, name.length % 2 === 0, name);
    out.push({ name: `svg ${name}`, pattern: digitizedFile(d, name, 2).pattern });
  }
  return out;
}

/** FNV-1a over the records, colors and objects of a design. */
export function hashOf(p: Pattern): string {
  let h = 0x811c9dc5;
  const add = (v: number) => {
    for (let k = 0; k < 4; k++) {
      h ^= (v >> (8 * k)) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  };
  add(p.cmd.length);
  for (let i = 0; i < p.cmd.length; i++) {
    add(p.x[i]);
    add(p.y[i]);
    add(p.cmd[i]);
  }
  for (const c of p.colors) add((c.r << 16) | (c.g << 8) | c.b);
  for (const o of sewObjects(p)) {
    add(o.first);
    add(o.last);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
