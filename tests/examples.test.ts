import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lengthMm } from '../src/image/svg';

/** The examples offered under "Load example" in index.html. */
const html = new TextDecoder().decode(readFileSync(new URL('../index.html', import.meta.url)));
const select = html.slice(html.indexOf('id="load-example"'), html.indexOf('</select>', html.indexOf('id="load-example"')));
const examples = [...select.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);

describe('example list', () => {
  it('offers stitch files and SVGs', () => {
    expect(examples.some((p) => p.endsWith('.pes'))).toBe(true);
    expect(examples.filter((p) => p.endsWith('.svg')).length).toBeGreaterThanOrEqual(2);
  });

  it.each(examples)('%s is there', (path) => {
    expect(existsSync(new URL(`../public/${path}`, import.meta.url))).toBe(true);
  });

  it.each(examples.filter((p) => p.endsWith('.svg')))('%s has its size in mm, so it is sewn at that size', (path) => {
    const svg = new TextDecoder().decode(readFileSync(new URL(`../public/${path}`, import.meta.url)));
    const root = svg.match(/<svg\b[^>]*>/)![0];
    const width = root.match(/\bwidth="([^"]+)"/)?.[1];
    const mm = lengthMm(width);
    expect(mm).not.toBeNull();
    expect(mm!).toBeLessThanOrEqual(400);
  });
});
