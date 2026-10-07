import { describe, expect, it } from 'vitest';
import { contentCrop, cropHandleAt, cropPixels, cutLabels, dragCrop, isFull, moveStroke, MIN_CROP, readCrop, type Crop } from '../src/image/crop';
import { DEFAULTS } from '../src/settings';
import { decodeProject, encodeProject, projectSettings } from '../src/storage/project';

/**
 * Zuschneiden in Bild umwandeln (src/image/crop.ts): the frame stays inside the picture and never
 * gets too small, brush strokes stay on their spot of the picture when the cut changes, the cut to
 * the motif finds the plain border, and the cut survives saving a project.
 */

const close = (a: Crop, b: Crop) => {
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(a[k]).toBeCloseTo(b[k], 9);
};

describe('crop', () => {
  it('drags edges and corners, stops at the picture and at the smallest size', () => {
    const c = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    close(dragCrop(c, 'e', 0.1, 0.3), { x: 0.2, y: 0.2, w: 0.6, h: 0.5 });
    close(dragCrop(c, 'nw', -0.1, 0.1), { x: 0.1, y: 0.3, w: 0.6, h: 0.4 });
    close(dragCrop(c, 'w', -1, 0), { x: 0, y: 0.2, w: 0.7, h: 0.5 });
    close(dragCrop(c, 'se', 2, 2), { x: 0.2, y: 0.2, w: 0.8, h: 0.8 });
    const tiny = dragCrop(c, 'e', -5, 0);
    expect(tiny.w).toBeCloseTo(MIN_CROP, 9);
    expect(tiny.x).toBeCloseTo(0.2, 9);
    // The inside moves the whole cut, which stays inside the picture.
    close(dragCrop(c, 'move', 1, -1), { x: 0.5, y: 0, w: 0.5, h: 0.5 });
  });

  it('finds the handle under the pointer; the inside moves only a real cut', () => {
    const c = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    expect(cropHandleAt(c, 0.2, 0.2, 0.02, 0.02)).toBe('nw');
    expect(cropHandleAt(c, 0.7, 0.45, 0.02, 0.02)).toBe('e');
    expect(cropHandleAt(c, 0.45, 0.71, 0.02, 0.02)).toBe('s');
    expect(cropHandleAt(c, 0.45, 0.45, 0.02, 0.02)).toBe('move');
    expect(cropHandleAt(c, 0.9, 0.9, 0.02, 0.02)).toBeNull();
    expect(cropHandleAt({ x: 0, y: 0, w: 1, h: 1 }, 0.5, 0.5, 0.02, 0.02)).toBeNull();
    expect(cropHandleAt({ x: 0, y: 0, w: 1, h: 1 }, 1, 1, 0.02, 0.02)).toBe('se');
  });

  it('keeps a brush stroke on its spot of the picture when the cut changes', () => {
    const stroke = { points: [[0.5, 0.5]] as [number, number][], radius: 0.1, color: null };
    const cut = { x: 0.25, y: 0.5, w: 0.5, h: 0.25 };
    const on = moveStroke(stroke, undefined, cut);
    expect(on.points[0][0]).toBeCloseTo(0.5, 9);
    expect(on.points[0][1]).toBeCloseTo(0, 9);
    expect(on.radius).toBeCloseTo(0.2, 9);
    // And back: undo of a cut gives the stroke as it was.
    const back = moveStroke(on, cut, undefined);
    expect(back.points[0][0]).toBeCloseTo(0.5, 9);
    expect(back.points[0][1]).toBeCloseTo(0.5, 9);
    expect(back.radius).toBeCloseTo(0.1, 9);
  });

  it('reads only sensible cuts; the whole picture is no cut', () => {
    expect(readCrop(null)).toBeUndefined();
    expect(readCrop({ x: 0, y: 0, w: 1, h: 1 })).toBeUndefined();
    expect(readCrop({ x: 'a', y: 0, w: 1, h: 1 })).toBeUndefined();
    const c = readCrop({ x: 0.9, y: -1, w: 0.5, h: 0.0001 })!;
    expect(c.x + c.w).toBeLessThanOrEqual(1);
    expect(c.y).toBe(0);
    expect(c.h).toBe(MIN_CROP);
    expect(isFull(undefined)).toBe(true);
    expect(cropPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 100, 40)).toEqual({ x: 25, y: 20, w: 50, h: 20 });
  });

  it('cuts to the motif on a plain background, not on a picture without one', () => {
    const W = 100;
    const H = 80;
    const data = new Uint8ClampedArray(W * H * 4).fill(255);
    for (let y = 30; y < 50; y++)
      for (let x = 20; x < 60; x++) {
        const i = (y * W + x) * 4;
        data[i] = 200;
        data[i + 1] = data[i + 2] = 0;
      }
    const c = contentCrop(data, W, H)!;
    expect(c.x * W).toBeLessThanOrEqual(20);
    expect(c.x * W).toBeGreaterThan(17);
    expect((c.x + c.w) * W).toBeGreaterThanOrEqual(60);
    expect((c.x + c.w) * W).toBeLessThan(63);
    expect(c.y * H).toBeLessThanOrEqual(30);
    expect((c.y + c.h) * H).toBeGreaterThanOrEqual(50);
    // A motif that fills the picture: nothing to cut.
    expect(contentCrop(new Uint8ClampedArray(W * H * 4).map((_, i) => (i * 37) % 251), W, H)).toBeUndefined();
  });

  it('cuts the regions of a vector picture to the frame', () => {
    const full = { width: 4, height: 2, labels: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]), colors: [] };
    const cut = cutLabels(full, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 2, 1);
    expect([...cut.labels]).toEqual([6, 7]);
    expect(cut.width).toBe(2);
  });

  it('a project keeps the cut of its picture', async () => {
    const crop = { x: 0.1, y: 0.2, w: 0.5, h: 0.6 };
    const image = { name: 'a.png', type: 'image/png', data: new Uint8Array([1, 2, 3]), work: { edits: [], strokes: [], crop } };
    const back = await decodeProject(await encodeProject({ files: [], active: null, image, settings: projectSettings(DEFAULTS) }));
    expect(back.image?.work.crop).toEqual(crop);
    const none = await decodeProject(await encodeProject({ files: [], active: null, image: { ...image, work: { edits: [], strokes: [] } }, settings: projectSettings(DEFAULTS) }));
    expect(none.image?.work.crop).toBeUndefined();
  });
});
