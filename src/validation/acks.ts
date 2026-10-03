import type { Zone } from './zones';

/**
 * An acknowledged finding: the user (or the automatic correction, for small caution spots) decided
 * the zone is fine as it is. Stored by its box in mm, since zones are recomputed after every edit.
 */
export interface Acknowledgement {
  bbox: Zone['bbox'];
  reason: 'small' | 'manual';
}

/**
 * A zone matches an acknowledgement when each box's centre lies inside the other (with 0.5 mm slack):
 * the same spot, moved a little by an edit. A zone that grew into a larger one is open again, since
 * it may now hold more than what was accepted.
 */
export function acknowledgementOf(z: Zone, acks: readonly Acknowledgement[] | undefined): Acknowledgement | undefined {
  if (!acks?.length) return undefined;
  const inside = (b: Zone['bbox'], x: number, y: number) => x >= b.minX - 0.5 && x <= b.maxX + 0.5 && y >= b.minY - 0.5 && y <= b.maxY + 0.5;
  const cx = (z.bbox.minX + z.bbox.maxX) / 2;
  const cy = (z.bbox.minY + z.bbox.maxY) / 2;
  return acks.find(
    (a) => inside(a.bbox, cx, cy) && inside(z.bbox, (a.bbox.minX + a.bbox.maxX) / 2, (a.bbox.minY + a.bbox.maxY) / 2),
  );
}

/** Highest level among zones that are not acknowledged. */
export function openWorst(zones: readonly Zone[], acks: readonly Acknowledgement[] | undefined): number {
  let w = 0;
  for (const z of zones) if (z.level > w && !acknowledgementOf(z, acks)) w = z.level;
  return w;
}

/** Acknowledgements that still match a zone, so stale ones do not pile up. */
export function liveAcknowledgements(zones: readonly Zone[], acks: readonly Acknowledgement[]): Acknowledgement[] {
  return acks.filter((a) => zones.some((z) => acknowledgementOf(z, [a])));
}

export function isAcknowledgement(a: unknown): a is Acknowledgement {
  const b = (a as Acknowledgement | null)?.bbox;
  return (
    !!b &&
    [b.minX, b.minY, b.maxX, b.maxY].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    ((a as Acknowledgement).reason === 'small' || (a as Acknowledgement).reason === 'manual')
  );
}
