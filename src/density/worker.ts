/// <reference lib="webworker" />
import type { Pattern } from '../model/pattern';
import { validatePattern, type ValidationResult } from '../validation/validate';
import { computeDensity, type DensityGrid, type DensityOptions } from './grid';

export type WorkerRequest =
  | { id: number; type: 'density'; pattern: Pattern; options: DensityOptions }
  | { id: number; type: 'validate'; pattern: Pattern };

export interface WorkerResponse {
  id: number;
  grid?: DensityGrid;
  validation?: ValidationResult;
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
      const v = validatePattern(req.pattern);
      ctx.postMessage({ id: req.id, validation: v } satisfies WorkerResponse, [
        v.density.buffer,
        v.level.buffer,
        v.caution.buffer,
        v.critical.buffer,
      ]);
    }
  } catch (err) {
    ctx.postMessage({ id: req.id, error: String(err) } satisfies WorkerResponse);
  }
};
