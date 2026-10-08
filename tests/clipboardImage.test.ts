import { describe, expect, it } from 'vitest';
import { addressName, clippedImage, imageAddress, svgMarkup, type ClipData } from '../src/ui/clipboardImage';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>';
const PNG_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const clip = (d: Partial<ClipData>): ClipData => ({ blobs: [], html: '', text: '', ...d });
const fileOf = async (d: ClipData) => {
  const got = await clippedImage(d, 'Eingefügtes Bild');
  if (!('file' in got)) throw new Error(`hint ${got.hint}`);
  return got.file;
};

describe('Bild aus der Zwischenablage', () => {
  it('finds SVG markup in text and HTML', () => {
    expect(svgMarkup(`<?xml version="1.0"?>\n${SVG}\n`)).toBe(SVG);
    expect(svgMarkup(`<div>${SVG}</div>`)).toBe(SVG);
    expect(svgMarkup('<svgfoo></svgfoo>')).toBeNull();
    expect(svgMarkup('Hallo')).toBeNull();
  });

  it('takes image addresses standing alone', () => {
    expect(imageAddress('  https://example.org/rose.png \n')).toBe('https://example.org/rose.png');
    expect(imageAddress('see https://example.org/rose.png')).toBeNull();
    expect(imageAddress(PNG_DATA)).toBe(PNG_DATA);
    expect(imageAddress('data:text/plain,hi')).toBeNull();
    expect(addressName('https://example.org/a/Rose%20rot.png?x=1')).toBe('Rose rot.png');
    expect(addressName(PNG_DATA)).toBe('');
  });

  it('prefers an SVG over the picture copied with it, and names a screenshot', async () => {
    const png = new File([new Uint8Array([1])], 'image.png', { type: 'image/png' });
    const svg = new Blob([SVG], { type: 'image/svg+xml' });
    const both = await fileOf(clip({ blobs: [png, svg] }));
    expect(both.type).toBe('image/svg+xml');
    expect(both.name).toBe('Eingefügtes Bild.svg');
    const shot = await fileOf(clip({ blobs: [png], html: '<img src="https://example.org/x.png">' }));
    expect(shot.name).toBe('Eingefügtes Bild.png');
    const copied = await fileOf(clip({ blobs: [new File([SVG], 'Blume.svg')] }));
    expect(copied.name).toBe('Blume.svg');
  });

  it('opens SVG markup, a data URL in HTML and as text', async () => {
    expect((await fileOf(clip({ text: SVG }))).type).toBe('image/svg+xml');
    expect((await fileOf(clip({ html: `<meta charset="utf-8">${SVG}` }))).name).toBe('Eingefügtes Bild.svg');
    const html = await fileOf(clip({ html: `<img alt="" src='${PNG_DATA}'>` }));
    expect(html.type).toBe('image/png');
    expect(html.size).toBeGreaterThan(20);
    expect((await fileOf(clip({ text: PNG_DATA }))).name).toBe('Eingefügtes Bild.png');
  });

  it('gives a hint instead of an error', async () => {
    expect(await clippedImage(clip({ text: 'Hallo' }), 'x')).toEqual({ hint: 'image.paste.none' });
    expect(await clippedImage(clip({ blobs: [new File(['%PDF'], 'brief.pdf', { type: 'application/pdf' })] }), 'x')).toEqual({ hint: 'image.paste.noImageFile' });
    expect(await clippedImage(clip({ text: 'https://invalid.invalid/rose.png' }), 'x')).toEqual({ hint: 'image.paste.web' });
  });
});
