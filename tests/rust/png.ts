import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { Raster } from '../../src/image/raster';

/** Reads an 8-bit, non-interlaced RGB or RGBA PNG into a raster (enough for the files in public/). */
export function readPng(path: URL): Raster {
  const buf = readFileSync(path);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  const idat: Uint8Array[] = [];
  while (p < buf.length) {
    const len = view.getUint32(p);
    const kind = String.fromCharCode(...buf.subarray(p + 4, p + 8));
    const body = buf.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') {
      width = view.getUint32(p + 8);
      height = view.getUint32(p + 12);
      type = body[9];
      if (body[8] !== 8 || body[12] !== 0 || (type !== 2 && type !== 6)) throw new Error(`unsupported PNG ${path}`);
    } else if (kind === 'IDAT') idat.push(body);
    p += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const all = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  idat.reduce((at, d) => (all.set(d, at), at + d.length), 0);
  const raw = inflateSync(all);
  const stride = width * bpp;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      const pa = Math.abs(b - c);
      const pb = Math.abs(a - c);
      const pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      px[y * stride + x] = (row[x] + pred) & 255;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let k = 0; k < bpp; k++) data[i * 4 + k] = px[i * bpp + k];
    if (bpp === 3) data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}
