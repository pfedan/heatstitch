import { describe, expect, it } from 'vitest';
import { imageTarget } from '../src/app/imageTarget';

const svg = { name: 'katze-im-karton.svg', type: 'image/svg+xml' };
const svgByName = { name: 'Katze.SVG', type: '' };
const photo = { name: 'pilz.jpg', type: 'image/jpeg' };

describe('Wohin ein geöffnetes Bild geht', () => {
  it('keeps an SVG dropped into the open assistant there, like a photo', () => {
    expect(imageTarget(svg, 'image')).toBe('assistant');
    expect(imageTarget(svgByName, 'image')).toBe('assistant');
    expect(imageTarget(photo, 'image')).toBe('assistant');
  });

  it('opens an SVG straight as a design outside the assistant, a photo in the assistant', () => {
    expect(imageTarget(svg, 'flow')).toBe('digitize');
    expect(imageTarget(svgByName, 'density')).toBe('digitize');
    expect(imageTarget(photo, 'flow')).toBe('assistant');
  });
});
