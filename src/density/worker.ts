/// <reference lib="webworker" />
import type { Pattern } from '../model/pattern';
import { computeDensity, type DensityGrid, type DensityOptions } from './grid';

export interface DensityRequest {
  id: number;
  pattern: Pattern;
  options: DensityOptions;
}

export interface DensityResponse {
  id: number;
  grid?: DensityGrid;
  error?: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<DensityRequest>) => {
  const { id, pattern, options } = e.data;
  try {
    const grid = computeDensity(pattern, options);
    ctx.postMessage({ id, grid } satisfies DensityResponse, [grid.data.buffer]);
  } catch (err) {
    ctx.postMessage({ id, error: String(err) } satisfies DensityResponse);
  }
};
