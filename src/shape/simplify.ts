import { core } from '../wasm/core';
import type { Form } from './path';

/**
 * Fewer nodes for a form ("Vereinfachen"): the curves between corners are fitted anew, corners stay
 * where they are and stay corners. Computed by the Rust core (core/src/shape/simplify.rs).
 */

/**
 * Deviations tried one after the other (mm): a press of "Vereinfachen" takes the smallest that saves
 * nodes, so pressing again simplifies further.
 */
export const SIMPLIFY_STEPS = [0.3, 0.6, 1.2];

export const nodeCount = (f: Form): number => f.paths.reduce((a, p) => a + p.nodes.length, 0);

/**
 * The form with fewer nodes, at most `tol` mm from the old outline: the curves between corners are
 * fitted anew, corners stay where they are and stay corners. Null when that saves no node.
 */
export function simplifyForm(f: Form, tol: number): Form | null {
  return core().simplifyForm(f, tol) as Form | null;
}

/** The form simplified with the first step of SIMPLIFY_STEPS that saves nodes, or null. */
export function simplifyMore(f: Form): Form | null {
  return core().simplifyMore(f) as Form | null;
}
