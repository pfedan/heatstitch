import { describe, expect, it } from 'vitest';
import { kindWay, type KindState } from '../src/areas/stitches/kindWay';

const fill = (more: Partial<KindState> = {}): KindState => ({ now: 'fill', draw: { single: true, tool: false }, ...more });

describe('kind switch', () => {
  it('sews a narrow fill as satin at once', () => {
    expect(kindWay(fill({ toSatin: true }), 'satin')).toBe('convert');
  });

  it('starts the rungs for one wide fill instead of being disabled', () => {
    expect(kindWay(fill(), 'satin')).toBe('draw');
  });

  it('has no satin while the rungs are drawn or for several wide fills', () => {
    expect(kindWay(fill({ draw: { single: true, tool: true } }), 'satin')).toBeNull();
    expect(kindWay(fill({ draw: { single: false, tool: false } }), 'satin')).toBeNull();
  });

  it('makes a closed fill a line of its edge, and fills it again', () => {
    expect(kindWay(fill(), 'line')).toBe('empty');
    const empty = fill({ now: 'line', empty: true });
    expect(kindWay(empty, 'fill')).toBe('fill');
    expect(kindWay(empty, 'satin')).toBeNull();
    expect(kindWay(empty, 'line')).toBeNull();
  });

  it('keeps a fill made from a line going back to its line', () => {
    expect(kindWay(fill({ asLine: true }), 'line')).toBe('convert');
    expect(kindWay(fill({ asLine: true }), 'satin')).toBeNull();
  });

  it('turns satins and drawn satin lines into fills', () => {
    expect(kindWay({ now: 'satin' }, 'fill')).toBe('convert');
    expect(kindWay({ now: 'satin' }, 'line')).toBeNull();
    expect(kindWay({ now: 'line', lineFills: true }, 'fill')).toBe('convert');
    expect(kindWay({ now: 'line' }, 'fill')).toBeNull();
  });

  it('does nothing for borders, shadows and loosed stitches, or the kind already there', () => {
    expect(kindWay(fill({ blocked: true }), 'line')).toBeNull();
    expect(kindWay(fill(), 'fill')).toBeNull();
    expect(kindWay({ now: null }, 'fill')).toBeNull();
  });
});
