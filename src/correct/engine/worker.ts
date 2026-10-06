/// <reference lib="webworker" />
import type { Pattern } from '../../model/pattern';
import { forgetAll, restoreRemembered, type StoredObject } from '../../model/restitch';
import type { Acknowledgement } from '../../validation/acks';
import type { Profile } from '../../validation/profiles';
import type { Checks } from '../../validation/validate';
import { allFix, ampelReport, kindFixes, type AmpelReport } from './ampel';
import type { PlannedFix } from './apply';
import type { FixKind } from './cells';

/**
 * The correction engine in a worker: the Ampel and its fixes are worked out here, after loading
 * and after each change, without holding up the page. Each request carries what the objects
 * remember (memory lives per page, a worker starts empty), so a worker can take any request.
 */

export interface EngineSettings {
  trimMm: number;
  checks?: Checks;
  acks?: readonly Acknowledgement[];
}

export type EngineRequest =
  | { id: number; type: 'report'; pattern: Pattern; memory: StoredObject[]; profile: Profile; settings: EngineSettings }
  | { id: number; type: 'kind'; kind: FixKind; pattern: Pattern; memory: StoredObject[]; profile: Profile; settings: EngineSettings }
  | { id: number; type: 'all'; pattern: Pattern; memory: StoredObject[]; profile: Profile; settings: EngineSettings };

export interface EngineResponse {
  id: number;
  report?: AmpelReport;
  direct?: PlannedFix | null;
  rest?: PlannedFix | null;
  all?: PlannedFix | null;
  error?: string;
}

/** What the memory of the last request was: the same design asks again without it changing. */
let memoryKey = '';

/** Answers one request (also used directly, without a worker, in tests). */
export async function handleEngine(req: EngineRequest): Promise<EngineResponse> {
  try {
    const key = JSON.stringify(req.memory.map((m) => m.key));
    if (key !== memoryKey) {
      forgetAll();
      restoreRemembered(req.memory);
      memoryKey = key;
    }
    const opt = { trimMm: req.settings.trimMm, checks: req.settings.checks, acks: req.settings.acks };
    if (req.type === 'report') return { id: req.id, report: ampelReport(req.pattern, req.profile, opt) };
    if (req.type === 'kind') return { id: req.id, ...(await kindFixes(req.pattern, req.profile, req.kind, opt)) };
    return { id: req.id, all: await allFix(req.pattern, req.profile, opt) };
  } catch (err) {
    return { id: req.id, error: String(err) };
  }
}

if (typeof self !== 'undefined' && typeof (self as { importScripts?: unknown }).importScripts === 'function') {
  const ctx = self as unknown as DedicatedWorkerGlobalScope;
  ctx.onmessage = async (e: MessageEvent<EngineRequest>) => ctx.postMessage(await handleEngine(e.data));
}
