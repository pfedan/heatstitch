import { describe, expect, it } from 'vitest';
import { normalizeImage } from '../src/settings';

describe('image style', () => {
  it('starts flat', () => {
    expect(normalizeImage(undefined).style).toBe('flat');
  });

  it('keeps a chosen style', () => {
    expect(normalizeImage({ style: 'dynamic' }).style).toBe('dynamic');
    expect(normalizeImage({ style: 'bogus' as never }).style).toBe('flat');
  });

  it('turns the old "follows the image" option into a style', () => {
    expect(normalizeImage({ stitch: { flow: true } }).style).toBe('dynamic');
    expect(normalizeImage({ stitch: { flow: false } }).style).toBe('flat');
    expect(normalizeImage({ stitch: { flow: true } }).stitch.flow).toBeUndefined();
  });

  it('opens old projects as they were converted (rows following the image)', () => {
    expect(normalizeImage({ stitch: {} }, 'dynamic').style).toBe('dynamic');
  });
});
