/// <reference lib="webworker" />
import type { Pattern } from '../model/pattern';
import type { Mat } from '../shape/path';
import { resew, unship, type Shipped } from './live';

/**
 * Sews scaled objects anew off the main thread while the frame is dragged. It keeps the design it
 * was given, so each step of the drag only sends the map.
 */

export type ResewRequest = { type: 'load'; design: Shipped } | { type: 'scale'; id: number; sel: number[]; m: Mat; trimMm: number };

export interface ResewResponse {
  id: number;
  done: Shipped | null;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let design: Pattern | null = null;

ctx.onmessage = (e: MessageEvent<ResewRequest>) => {
  const req = e.data;
  if (req.type === 'load') {
    design = unship(req.design);
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
