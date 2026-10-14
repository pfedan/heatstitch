/// <reference lib="webworker" />
import { looksLikePhoto } from '../image/filters';
import { Preparer, type ColorEdit, type ExactLabels, type PrepareOptions, type Prepared, type Stroke } from '../image/prepare';
import type { Raster } from '../image/raster';
import { digitize, digitizeShapes, type DigitizeOptions, type Digitized, type ShapeInput } from './digitize';
import type { ThreadColor } from '../model/pattern';

/**
 * Image conversion off the main thread. The worker keeps the loaded image and the cached stages of
 * its preparation, so a change of a later setting (colors, brush strokes, stitch options) does not
 * redo the smoothing.
 */

export type ImageRequest =
  | { id: number; type: 'load'; raster: Raster; count?: boolean }
  | { id: number; type: 'prepare'; options: PrepareOptions; edits: ColorEdit[]; strokes: Stroke[]; exact?: ExactLabels }
  | { id: number; type: 'digitize'; options: DigitizeOptions; name: string }
  | { id: number; type: 'shapes'; shapes: ShapeInput[]; threads: ThreadColor[]; options: DigitizeOptions; size: { w: number; h: number }; knockout: boolean; name: string };

export interface ImageResponse {
  id: number;
  photo?: boolean;
  /** Of a graphic (not a photo): how many colors it is drawn in (see graphicPalette). */
  colors?: number;
  prepared?: Prepared;
  digitized?: Digitized;
  /** Not the answer yet: how far the request is (shapes sewn of all). */
  progress?: { done: number; total: number };
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
      const photo = looksLikePhoto(req.raster);
      const own = req.count && !photo ? preparer.palette()?.length : undefined;
      ctx.postMessage({ id: req.id, photo, ...(own ? { colors: own } : {}) } satisfies ImageResponse);
    } else if (req.type === 'prepare') {
      if (!preparer) throw new Error('No image loaded');
      prepared = preparer.run(req.options, req.edits, req.strokes, req.exact);
      // A copy goes to the page (without the direction field, which only the stitches need); the
      // worker keeps its own for the stitches.
      const { orient: _, ...rest } = prepared;
      const copy = { ...rest, labels: prepared.labels.slice() };
      ctx.postMessage({ id: req.id, prepared: copy } satisfies ImageResponse, [copy.labels.buffer]);
    } else if (req.type === 'shapes') {
      const progress = (done: number, total: number) => ctx.postMessage({ id: req.id, progress: { done, total } } satisfies ImageResponse);
      ctx.postMessage({ id: req.id, digitized: digitizeShapes(req.shapes, req.threads, req.options, req.size, req.knockout, req.name, undefined, progress) } satisfies ImageResponse);
    } else {
      if (!prepared) throw new Error('No prepared image');
      ctx.postMessage({ id: req.id, digitized: digitize(prepared, req.options, req.name) } satisfies ImageResponse);
    }
  } catch (err) {
    ctx.postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) } satisfies ImageResponse);
  }
};

