import type { ColorEdit, ExactLabels, PrepareOptions, Prepared, Stroke } from '../image/prepare';
import type { Raster } from '../image/raster';
import type { DigitizeOptions, Digitized, ShapeInput } from './digitize';
import type { ThreadColor } from '../model/pattern';
import type { ImageRequest, ImageResponse } from './worker';

type Unsent<T> = T extends unknown ? Omit<T, 'id'> : never;

/** Promise wrapper around the image worker; requests are answered in order. */
export class ImageClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private pending = new Map<number, { resolve: (r: ImageResponse) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<ImageResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data);
    };
  }

  private call(req: Unsent<ImageRequest>, transfer: Transferable[] = []): Promise<ImageResponse> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id } as ImageRequest, transfer);
    });
  }

  /** Hands the image to the worker; tells whether it looks like a photo. */
  async load(raster: Raster): Promise<boolean> {
    return (await this.call({ type: 'load', raster })).photo ?? false;
  }

  /** Prepares the loaded image; `exact` gives the regions and colors of a vector image. */
  async prepare(options: PrepareOptions, edits: ColorEdit[], strokes: Stroke[], exact?: ExactLabels): Promise<Prepared> {
    return (await this.call({ type: 'prepare', options, edits, strokes, exact })).prepared!;
  }

  /** Ends the worker; the client cannot be used afterwards. */
  dispose(): void {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('disposed'));
    this.pending.clear();
  }

  /** Stitches for the shapes of a vector file, each whole (see digitizeShapes). */
  async digitizeShapes(shapes: ShapeInput[], threads: ThreadColor[], options: DigitizeOptions, size: { w: number; h: number }, knockout: boolean, name: string): Promise<Digitized> {
    return (await this.call({ type: 'shapes', shapes, threads, options, size, knockout, name })).digitized!;
  }

  /** Stitches for the last prepared image. */
  async digitize(options: DigitizeOptions, name: string): Promise<Digitized> {
    return (await this.call({ type: 'digitize', options, name })).digitized!;
  }
}
