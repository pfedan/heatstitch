import { describe, expect, it } from 'vitest';
import { COLOR_CHANGE, JUMP, PatternBuilder, STITCH, TRIM } from '../src/model/pattern';
import { threadMeters, threadOfRange, threadUse } from '../src/model/threadUse';

const colors = [
  { r: 200, g: 0, b: 0 },
  { r: 0, g: 0, b: 200 },
];

describe('threadUse', () => {
  it('gives the thread makers rule of thumb for 4 mm stitches on thin fabric', () => {
    const b = new PatternBuilder();
    b.add(0, 0, STITCH);
    for (let i = 0; i < 1000; i++) b.add(40, 0, STITCH);
    const u = threadUse(b.build('run', 'dst', colors.slice(0, 1)), 'light');
    // 5 m top and 3.5 m bobbin per 1000 stitches, plus the tails.
    expect(u.topTotal / 1000).toBeCloseTo(5.1, 1);
    expect(u.bobbin / 1000).toBeCloseTo(3.5, 1);
    expect(u.top).toEqual([u.topTotal]);
  });

  it('counts each color apart and a fresh tail after every cut', () => {
    const b = new PatternBuilder();
    b.add(0, 0, STITCH);
    b.add(30, 0, STITCH);
    b.mark(TRIM);
    b.add(100, 0, JUMP);
    b.add(0, 0, STITCH);
    b.add(30, 0, STITCH);
    b.mark(COLOR_CHANGE);
    b.add(0, 0, STITCH);
    b.add(30, 0, STITCH);
    const p = b.build('cuts', 'dst', colors);
    const u = threadUse(p, 'woven');
    const one = 3 + 2 * 0.4 + 2 * 0.25;
    expect(u.top[0]).toBeCloseTo(2 * (35 + one), 6);
    expect(u.top[1]).toBeCloseTo(35 + one, 6);
    expect(u.topTotal).toBeCloseTo(u.top[0] + u.top[1], 6);
    expect(u.bobbin).toBeCloseTo(3 * (5 + 3 - 0.5), 6);
    // What one piece takes, without its tail.
    expect(threadOfRange(p, 'woven', 0, 1)).toBeCloseTo(one, 6);
  });

  it('takes more thread on thicker fabric', () => {
    const b = new PatternBuilder();
    b.add(0, 0, STITCH);
    for (let i = 0; i < 100; i++) b.add(25, 0, STITCH);
    const p = b.build('run', 'dst', colors.slice(0, 1));
    expect(threadUse(p, 'terry').topTotal).toBeGreaterThan(threadUse(p, 'woven').topTotal);
    expect(threadUse(p, 'terry').bobbin).toBeCloseTo(threadUse(p, 'woven').bobbin, 6);
  });

  it('shows meters with one decimal below 10 m', () => {
    expect(threadMeters(5135)).toMatch(/^5[.,]1$/);
    expect(threadMeters(23456)).toBe('23');
  });
});
