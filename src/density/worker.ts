/// <reference lib="webworker" />
import type { Pattern } from '../model/pattern';
import { measurePattern, measurementBuffers, type Measurement } from '../validation/measure';
import { computeDensity, type DensityGrid, type DensityOptions } from './grid';

export type WorkerRequest =
  | { id: number; type: 'density'; pattern: Pattern; options: DensityOptions }
  | { id: number; type: 'measure'; pattern: Pattern };

export interface WorkerResponse {
  id: number;
  grid?: DensityGrid;
  measurement?: Measurement;
  error?: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'density') {
      const grid = computeDensity(req.pattern, req.options);
      ctx.postMessage({ id: req.id, grid } satisfies WorkerResponse, [grid.data.buffer]);
    } else {
      const m = measurePattern(req.pattern);
      ctx.postMessage({ id: req.id, measurement: m } satisfies WorkerResponse, measurementBuffers(m));
    }
  } catch (err) {
    ctx.postMessage({ id: req.id, error: String(err) } satisfies WorkerResponse);
  }
};
