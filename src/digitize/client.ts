import type { ColorEdit, PrepareOptions, Prepared, Stroke } from '../image/prepare';
import type { Raster } from '../image/raster';
import type { DigitizeOptions, Digitized } from './digitize';
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

  async prepare(options: PrepareOptions, edits: ColorEdit[], strokes: Stroke[]): Promise<Prepared> {
    return (await this.call({ type: 'prepare', options, edits, strokes })).prepared!;
  }

  /** Stitches for the last prepared image. */
  async digitize(options: DigitizeOptions, name: string): Promise<Digitized> {
    return (await this.call({ type: 'digitize', options, name })).digitized!;
  }
}
