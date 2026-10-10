/// <reference lib="webworker" />
import type { Pattern } from '../model/pattern';
import type { Mat } from '../shape/path';
import type { Settings } from '../model/restitch';
import { resew, restitchShipped, unship, type Shipped, type ShippedRestitch } from './live';

/**
 * Sews objects anew off the main thread: scaled while the frame is dragged, or with other stitch
 * settings while one is pointed at or dragged in the stitch panel. It keeps the design it was given,
 * so each step only sends what changed.
 */

export type ResewRequest =
  | { type: 'load'; design: Shipped }
  | { type: 'scale'; id: number; sel: number[]; m: Mat; trimMm: number }
  | { type: 'restitch'; id: number; which: number[]; settings: Settings; trimMm: number };

export interface ResewResponse {
  id: number;
  done: Shipped | null;
}

export interface RestitchResponse {
  id: number;
  done: ShippedRestitch | null;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let design: Pattern | null = null;

ctx.onmessage = (e: MessageEvent<ResewRequest>) => {
  const req = e.data;
  if (req.type === 'load') {
    design = unship(req.design);
    return;
  }
  if (req.type === 'restitch') {
    let done: ShippedRestitch | null = null;
    try {
      done = design && restitchShipped(design, req.which, req.settings, req.trimMm);
    } catch {
      done = null;
    }
    // Stitches that are new go over without a copy; ones the design still has stay here.
    const kept = design ? [design.x.buffer, design.y.buffer, design.cmd.buffer] : [];
    const own = done ? [done.pattern.x.buffer, done.pattern.y.buffer, done.pattern.cmd.buffer].filter((b) => !kept.includes(b)) : [];
    ctx.postMessage({ id: req.id, done } satisfies RestitchResponse, own);
    return;
  }
  let done: Shipped | null = null;
  try {
    done = design && resew(design, req.sel, req.m, req.trimMm);
  } catch {
    done = null;
  }
  ctx.postMessage({ id: req.id, done } satisfies ResewResponse, done ? [done.x.buffer, done.y.buffer, done.cmd.buffer] : []);
};
