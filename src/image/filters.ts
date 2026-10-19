import { core } from '../wasm/core';
import type { Raster } from './raster';

/**
 * Photo or graphic: in logos and clip art a few exact colors cover almost every pixel; in photos
 * no small set does. Used to suggest how much to smooth.
 */
export const looksLikePhoto = (src: Raster): boolean => core().looksLikePhoto(src.data, src.width, src.height);
