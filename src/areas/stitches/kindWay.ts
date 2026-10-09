/**
 * The kind switch of the stitch inspector (Füllung | Satin | Linie): what picking a kind does for
 * what is selected. Kept apart from the panel so the rules can be tested on their own.
 */

/**
 * What picking `to` on the kind switch does: sew the selection in that kind along the same form
 * (`convert`), start the rungs across it to sew it as satin along them (`draw`, too wide for satin
 * at once), or nothing (null).
 */
export type KindWay = 'convert' | 'draw';

export interface KindState {
  /** The switch's position now. */
  now: 'fill' | 'satin' | 'line' | null;
  /** A band: a wide line sewn as a fill of its area. */
  asLine?: boolean;
  /** The fill is sewn as a satin at once (narrow, about even). */
  toSatin?: boolean;
  /** Rungs can be drawn across the one selected fill; `tool`: they are being drawn now. */
  draw?: { single: boolean; tool: boolean };
  /**
   * A line: whether it can be a fill (drawn or edited, not read: one that was a fill, one with a
   * closed path, see fits, or a satin line).
   */
  lineFills?: boolean;
  /** A border, shadow, echo or blend thread, or stitches loosed from their shape: no switch. */
  blocked?: boolean;
}

/** How the kind switch gets from what is selected to `to` (see KindWay). */
export function kindWay(k: KindState, to: 'fill' | 'satin' | 'line'): KindWay | null {
  if (k.blocked || !k.now || k.now === to) return null;
  if (to === 'fill') return k.now === 'satin' || (k.now === 'line' && k.lineFills) ? 'convert' : null;
  if (k.now !== 'fill') return null;
  if (to === 'satin') {
    if (k.asLine) return null;
    if (k.toSatin) return 'convert';
    return k.draw?.single && !k.draw.tool ? 'draw' : null;
  }
  // A fill sewn along its paths: the fill is kept, Füllung brings it back.
  return 'convert';
}
