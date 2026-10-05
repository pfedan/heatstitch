import { COLOR_CHANGE, JUMP, PatternBuilder, STITCH, TRIM, type Pattern, type ThreadColor } from '../model/pattern';
import { jefColor } from './jefPalette';

/** JEF has no trim command; a move longer than this (0.1 mm, either axis) is cut, as pyembroidery reads it. */
export const JEF_TRIM_DISTANCE = 30;

const signed8 = (v: number): number => (v > 0x7f ? v - 0x100 : v);

/** Reads a Janome JEF file. Colors are palette indices; index 0 is a stop (the same thread again). */
export function parseJef(data: Uint8Array, fileName = ''): Pattern {
  if (data.length < 0x74) throw new Error('JEF: file too short');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const start = view.getUint32(0, true);
  const count = view.getInt32(24, true);
  if (count < 0 || start > data.length || 0x74 + count * 4 > data.length) throw new Error('JEF: bad header');
  const palette: ThreadColor[] = [];
  for (let k = 0; k < count; k++) {
    const index = Math.abs(view.getInt32(0x74 + k * 4, true));
    palette.push(index === 0 && palette.length ? { ...palette[palette.length - 1] } : jefColor(index || 1));
  }

  const b = new PatternBuilder();
  // Janome hoop codes: 0 = 110 x 110 (listed as 100 x 100), 1 = 50 x 50, 2 = 140 x 200, 3 = 126 x 110, 4 = 200 x 200.
  const hoop = [
    { w: 100, h: 100 },
    { w: 50, h: 50 },
    { w: 140, h: 200 },
    { w: 126, h: 110 },
    { w: 200, h: 200 },
  ][view.getInt32(32, true)];
  let blocks = 1;
  // Moves since the last stitch, to decide where a cut goes.
  let runStart = -1;
  let runDx = 0;
  let runDy = 0;
  let cut = true;
  const trimAt: number[] = [];
  for (let i = start; i + 1 < data.length; ) {
    const b0 = data[i];
    const b1 = data[i + 1];
    i += 2;
    if (b0 !== 0x80) {
      b.add(signed8(b0), -signed8(b1), STITCH);
      runStart = -1;
      cut = false;
      continue;
    }
    if (i + 1 >= data.length || b1 === 0x10) break;
    const dx = signed8(data[i]);
    const dy = -signed8(data[i + 1]);
    i += 2;
    if (b1 === 0x02) {
      if (runStart < 0) {
        runStart = b.length;
        runDx = runDy = 0;
      }
      runDx += dx;
      runDy += dy;
      b.add(dx, dy, JUMP);
      if (!cut && (Math.abs(runDx) > JEF_TRIM_DISTANCE || Math.abs(runDy) > JEF_TRIM_DISTANCE)) {
        trimAt.push(runStart);
        cut = true;
      }
    } else if (b1 === 0x01) {
      b.mark(COLOR_CHANGE);
      if (dx || dy) b.add(dx, dy, JUMP);
      blocks++;
      runStart = -1;
      cut = true;
    } else {
      break;
    }
  }

  let p = b.build(fileName, 'jef', []);
  if (trimAt.length) p = insertBefore(p, trimAt, TRIM);
  p.colors = Array.from({ length: blocks }, (_, k) => palette[k] ?? palette[palette.length - 1] ?? jefColor(1));
  if (hoop) p.hoop = hoop;
  return p;
}

/** Inserts a record of `cmd` (at the previous position) before each given record index. */
export function insertBefore(p: Pattern, at: number[], cmd: number): Pattern {
  const n = p.cmd.length + at.length;
  const x = new Int32Array(n);
  const y = new Int32Array(n);
  const c = new Uint8Array(n);
  let k = 0;
  let o = 0;
  for (let i = 0; i < p.cmd.length; i++) {
    if (k < at.length && at[k] === i) {
      x[o] = i > 0 ? p.x[i - 1] : 0;
      y[o] = i > 0 ? p.y[i - 1] : 0;
      c[o++] = cmd;
      k++;
    }
    x[o] = p.x[i];
    y[o] = p.y[i];
    c[o++] = p.cmd[i];
  }
  return { ...p, x, y, cmd: c };
}
