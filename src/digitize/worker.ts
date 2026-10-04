/// <reference lib="webworker" />
import { looksLikePhoto } from '../image/filters';
import { Preparer, type ColorEdit, type PrepareOptions, type Prepared, type Stroke } from '../image/prepare';
import type { Raster } from '../image/raster';
import { digitize, type DigitizeOptions, type Digitized } from './digitize';

/**
 * Image conversion off the main thread. The worker keeps the loaded image and the cached stages of
 * its preparation, so a change of a later setting (colors, brush strokes, stitch options) does not
 * redo the smoothing.
 */

export type ImageRequest =
  | { id: number; type: 'load'; raster: Raster }
  | { id: number; type: 'prepare'; options: PrepareOptions; edits: ColorEdit[]; strokes: Stroke[] }
  | { id: number; type: 'digitize'; options: DigitizeOptions; name: string };

export interface ImageResponse {
  id: number;
  photo?: boolean;
  prepared?: Prepared;
  digitized?: Digitized;
  error?: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let preparer: Preparer | null = null;
let prepared: Prepared | null = null;

ctx.onmessage = (e: MessageEvent<ImageRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'load') {
      preparer = new Preparer(req.raster);
      prepared = null;
      ctx.postMessage({ id: req.id, photo: looksLikePhoto(req.raster) } satisfies ImageResponse);
    } else if (req.type === 'prepare') {
      if (!preparer) throw new Error('No image loaded');
      prepared = preparer.run(req.options, req.edits, req.strokes);
      // A copy goes to the page (without the direction field, which only the stitches need); the
      // worker keeps its own for the stitches.
      const { orient: _, ...rest } = prepared;
      const copy = { ...rest, labels: prepared.labels.slice() };
      ctx.postMessage({ id: req.id, prepared: copy } satisfies ImageResponse, [copy.labels.buffer]);
    } else {
      if (!prepared) throw new Error('No prepared image');
      ctx.postMessage({ id: req.id, digitized: digitize(prepared, req.options, req.name) } satisfies ImageResponse);
    }
  } catch (err) {
    ctx.postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) } satisfies ImageResponse);
  }
};
