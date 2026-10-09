/**
 * The picture of a tracing image as it is kept: at most TRACE_PX on its longer side (enough to
 * trace at any zoom that makes sense, small enough for projects), as WebP where the browser
 * writes it, else JPEG (opaque) or PNG (with transparency).
 */

/** Longest side of a kept tracing image in pixels. */
export const TRACE_PX = 1600;

const toBlob = (c: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, quality));

function opaque(c: HTMLCanvasElement): boolean {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return false;
  return true;
}

/** The picture of `src` scaled down to TRACE_PX, encoded; with its aspect ratio (height / width). */
export async function encodeTrace(src: HTMLCanvasElement): Promise<{ data: Uint8Array; type: string; aspect: number }> {
  const k = Math.min(1, TRACE_PX / Math.max(src.width, src.height));
  let c = src;
  if (k < 1) {
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * k));
    c.height = Math.max(1, Math.round(src.height * k));
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
  }
  let blob = await toBlob(c, 'image/webp', 0.88);
  // Browsers that cannot write WebP hand back a PNG instead.
  if (!blob || blob.type !== 'image/webp') blob = opaque(c) ? await toBlob(c, 'image/jpeg', 0.9) : await toBlob(c, 'image/png');
  if (!blob) throw new Error('The picture could not be encoded');
  return { data: new Uint8Array(await blob.arrayBuffer()), type: blob.type, aspect: src.height / src.width };
}
