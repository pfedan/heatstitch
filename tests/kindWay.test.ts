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

  it('makes a fill a line along its paths, and fills that line again', () => {
    expect(kindWay(fill(), 'line')).toBe('convert');
    const was = { now: 'line' as const, lineFills: true };
    expect(kindWay(was, 'fill')).toBe('convert');
    expect(kindWay(was, 'satin')).toBeNull();
    expect(kindWay(was, 'line')).toBeNull();
  });

  it('keeps a fill made from a line going back to its line', () => {
    expect(kindWay(fill({ asLine: true }), 'line')).toBe('convert');
    expect(kindWay(fill({ asLine: true }), 'satin')).toBeNull();
  });

  it('turns satins and drawn satin lines into fills', () => {
    expect(kindWay({ now: 'satin' }, 'fill')).toBe('convert');
    expect(kindWay({ now: 'line', lineFills: true }, 'fill')).toBe('convert');
    expect(kindWay({ now: 'line' }, 'fill')).toBeNull();
  });

  it('makes a satin a line along its edge, and a satin again once it is closed', () => {
    expect(kindWay({ now: 'satin' }, 'line')).toBe('convert');
    expect(kindWay({ now: 'satin', blocked: true }, 'line')).toBeNull();
    expect(kindWay({ now: 'line', lineSatin: { closed: true } }, 'satin')).toBe('convert');
    expect(kindWay({ now: 'line', lineSatin: { closed: false } }, 'satin')).toBeNull();
    expect(kindWay({ now: 'line', lineFills: true }, 'satin')).toBeNull();
  });

  it('does nothing for borders, shadows and loosed stitches, or the kind already there', () => {
    expect(kindWay(fill({ blocked: true }), 'line')).toBeNull();
    expect(kindWay(fill(), 'fill')).toBeNull();
    expect(kindWay({ now: null }, 'fill')).toBeNull();
  });
});
