import { describe, expect, it } from 'vitest';
import { fits, fitsOf } from '../src/model/geo';
import { parsePath } from '../src/shape/svgPath';
import type { Mat } from '../src/shape/path';

const ID: Mat = [1, 0, 0, 1, 0, 0];

describe('what a form allows (the one table)', () => {
  it('fills a closed path and sews any path as a line', () => {
    expect(fitsOf(parsePath('M0 0 L10 0 L10 10 Z', ID))).toEqual({ fill: true, line: true, openBeside: 0 });
    expect(fitsOf(parsePath('M0 0 L10 0 L10 10', ID))).toEqual({ fill: false, line: true, openBeside: 0 });
  });

  it('counts open paths beside closed ones: they are not filled', () => {
    expect(fitsOf(parsePath('M0 0 L10 0 L10 10 Z M20 0 L30 0', ID))).toEqual({ fill: true, line: true, openBeside: 1 });
  });

  it('fills nothing that encloses no area, and allows nothing without a path', () => {
    expect(fits(parsePath('M0 0 L10 0 L20 0 Z', ID), 'fill')).toBe(false);
    expect(fitsOf(null)).toEqual({ fill: false, line: false, openBeside: 0 });
    expect(fits({ paths: [] }, 'line')).toBe(false);
  });

  it('fills a closed path of two curved nodes (a round shape)', () => {
    expect(fits(parsePath('M0 0 C0 10 10 10 10 0 C10 -10 0 -10 0 0 Z', ID), 'fill')).toBe(true);
  });
});
