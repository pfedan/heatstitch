/// <reference lib="webworker" />
import { autoCorrect, type CorrectionOptions, type CorrectionReport } from '../correct/auto';
import type { Pattern } from '../model/pattern';
import type { Profile } from '../validation/profiles';
import type { Checks } from '../validation/validate';
import { measurePattern, measurementBuffers, type Measurement } from '../validation/measure';
import { computeDensity, type DensityGrid, type DensityOptions } from './grid';

export type WorkerRequest =
  | { id: number; type: 'density'; pattern: Pattern; options: DensityOptions }
  | { id: number; type: 'measure'; pattern: Pattern }
  | { id: number; type: 'correct'; pattern: Pattern; profile: Profile; checks: Checks; options: CorrectionOptions };

export interface WorkerResponse {
  id: number;
  grid?: DensityGrid;
  measurement?: Measurement;
  pattern?: Pattern;
  report?: CorrectionReport;
  error?: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'density') {
      const grid = computeDensity(req.pattern, req.options);
      ctx.postMessage({ id: req.id, grid } satisfies WorkerResponse, [grid.data.buffer]);
    } else if (req.type === 'correct') {
      const r = autoCorrect(req.pattern, req.profile, req.options, req.checks);
      ctx.postMessage({ id: req.id, pattern: r.pattern, measurement: r.measurement, report: r.report } satisfies WorkerResponse);
    } else {
      const m = measurePattern(req.pattern);
      ctx.postMessage({ id: req.id, measurement: m } satisfies WorkerResponse, measurementBuffers(m));
    }
  } catch (err) {
    ctx.postMessage({ id: req.id, error: String(err) } satisfies WorkerResponse);
  }
};
