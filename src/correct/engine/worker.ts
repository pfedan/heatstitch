/// <reference lib="webworker" />
import type { Pattern } from '../../model/pattern';
import { restoreRemembered, type ObjectsAsStored } from '../../model/restitch';
import type { Acknowledgement } from '../../validation/acks';
import type { Profile } from '../../validation/profiles';
import type { Checks } from '../../validation/validate';
import { ampelReport, directFix, restFix, type AmpelReport } from './ampel';
import type { PlannedFix } from './apply';
import type { FixTarget } from './cells';

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

interface Common {
  id: number;
  pattern: Pattern;
  memory: ObjectsAsStored;
  profile: Profile;
  settings: EngineSettings;
}

export type EngineRequest =
  | (Common & { type: 'report' })
  /** One fix: direct (invisible and barely visible changes) or the rest (visible ones too). */
  | (Common & { type: 'fix'; target: FixTarget; mode: 'direct' | 'rest' });

export interface EngineResponse {
  id: number;
  report?: AmpelReport;
  /** The fix asked for; null when it clears nothing. */
  fix?: PlannedFix | null;
  error?: string;
}

/** Answers one request (also used directly, without a worker, in tests). */
export async function handleEngine(req: EngineRequest): Promise<EngineResponse> {
  try {
    // The design crossed over without its object list: it gets it back.
    restoreRemembered(req.pattern, req.memory);
    const opt = { trimMm: req.settings.trimMm, checks: req.settings.checks, acks: req.settings.acks };
    if (req.type === 'report') return { id: req.id, report: ampelReport(req.pattern, req.profile, opt) };
    return { id: req.id, fix: await (req.mode === 'direct' ? directFix : restFix)(req.pattern, req.profile, req.target, opt) };
  } catch (err) {
    return { id: req.id, error: String(err) };
  }
}

if (typeof self !== 'undefined' && typeof (self as { importScripts?: unknown }).importScripts === 'function') {
  const ctx = self as unknown as DedicatedWorkerGlobalScope;
  ctx.onmessage = async (e: MessageEvent<EngineRequest>) => ctx.postMessage(await handleEngine(e.data));
}
