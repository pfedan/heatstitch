import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { sewObjects } from '../../../../src/model/objects';
import { moveStats } from '../../../../src/model/order';
import { COLOR_CHANGE, END, JUMP, STITCH, type Pattern } from '../../../../src/model/pattern';
import { parsePattern } from '../../../../src/parsers';
import { writePes } from '../../../../src/writers/pes';

// Builds konfetti.pes for Teil 9: the dots of confetti.pes, 15 of them on a 5 x 3 grid, sewn in a
// careless order (each color from one far end to the other) with long jumps left untrimmed.
// Skipped in the test run; to build the file anew:
//   KONFETTI=1 npx vitest run docs/screencasts/09-spruenge-und-schnitte/material
it.skipIf(!process.env.KONFETTI)('konfetti.pes for Teil 9', () => {
  const p = parsePattern(readFileSync(new URL('../../../../public/examples/demos/confetti.pes', import.meta.url)), 'confetti.pes');
  const objs = sewObjects(p);
  const tpl = objs.map((o) => {
    let sx = 0, sy = 0, n = 0;
    for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) { sx += p.x[i]; sy += p.y[i]; n++; }
    return { o, cx: sx / n, cy: sy / n };
  });
  const red = tpl.filter((t) => t.o.block === 0);
  const blue = tpl.filter((t) => t.o.block === 1);
  // 5 x 3 grid, 14 mm apart, jittered by a fixed pattern; colors alternate like a checkerboard.
  const jit = [[2, -1], [-2, 2], [1, 3], [-3, -2], [3, 1], [0, -3], [-1, 2], [2, 0], [-2, -1], [3, 3], [-3, 1], [1, -2], [-1, -3], [2, 2], [0, 1]];
  const dots: { x: number; y: number; red: boolean }[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
    const k = r * 5 + c;
    dots.push({ x: (c * 14 + jit[k][0]) * 10, y: (r * 14 + jit[k][1]) * 10, red: (r + c) % 2 === 0 });
  }
  // A careless order: always from one far end to the other, left, right, left ...
  const pingPong = <T extends { x: number }>(a: T[]) => {
    const s = [...a].sort((u, v) => u.x - v.x);
    const out: T[] = [];
    for (let i = 0, j = s.length - 1; i <= j; i++, j--) { out.push(s[i]); if (i !== j) out.push(s[j]); }
    return out;
  };
  const x: number[] = [], y: number[] = [], cmd: number[] = [];
  const add = (a: number, b: number, c: number) => { x.push(a); y.push(b); cmd.push(c); };
  let k = 0;
  for (const [ci, group] of [dots.filter((d) => d.red), dots.filter((d) => !d.red)].entries()) {
    const pool = ci === 0 ? red : blue;
    if (ci > 0) add(x[x.length - 1], y[y.length - 1], COLOR_CHANGE);
    pingPong(group).forEach((d, n) => {
      const t = pool[k++ % pool.length];
      const dx = Math.round(d.x - t.cx), dy = Math.round(d.y - t.cy);
      const fx = p.x[t.o.first] + dx, fy = p.y[t.o.first] + dy;
      if (x.length) add(fx, fy, JUMP);
      for (let i = t.o.first; i <= t.o.last; i++) add(p.x[i] + dx, p.y[i] + dy, p.cmd[i]);
    });
  }
  add(x[x.length - 1], y[y.length - 1], END);
  const xs = Int32Array.from(x), ys = Int32Array.from(y);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < xs.length; i++) if (cmd[i] === STITCH) { minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]); minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]); }
  const q: Pattern = { name: 'konfetti.pes', format: 'pes', x: xs, y: ys, cmd: Uint8Array.from(cmd), colors: p.colors.slice(0, 2), bounds: { minX, minY, maxX, maxY } as never };
  console.log('stats', moveStats(q), 'size mm', (maxX - minX) / 10, (maxY - minY) / 10);
  writeFileSync(new URL('./konfetti.pes', import.meta.url), writePes(q));
});
