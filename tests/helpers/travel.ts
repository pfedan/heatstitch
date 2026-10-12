import type { Pt } from '../../src/digitize/skeleton';

/**
 * Travel that shows (mm): the stretches of travel between rows (FillResult.travel) that no stitch
 * sewn after them covers, within 3/4 of a row spacing. Travel under rows still to come is hidden;
 * travel on top of rows sewn already, or beside their ends along the outline, shows.
 */
export function shownTravel(runs: Pt[][], travel: [number, number][], spacing: number): number {
  const pts = runs.flat();
  // Point i starts a run: no stitch leads to it.
  const starts = new Set<number>();
  let n = 0;
  for (const r of runs) {
    starts.add(n);
    n += r.length;
  }
  const off = (q: Pt, a: Pt, b: Pt) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1]);
  };
  const reach = spacing * 0.75;
  let shown = 0;
  for (const [a, b] of travel) {
    for (let i = a + 1; i <= b; i++) {
      const [p, q] = [pts[i - 1], pts[i]];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const k = Math.max(1, Math.ceil(l / 0.1));
      for (let j = 0; j < k; j++) {
        const x: Pt = [p[0] + ((j + 0.5) / k) * (q[0] - p[0]), p[1] + ((j + 0.5) / k) * (q[1] - p[1])];
        let hid = false;
        for (let m = b + 1; m < pts.length && !hid; m++) {
          if (starts.has(m)) continue;
          const [u, v] = [pts[m - 1], pts[m]];
          // Quick reject by box before the distance.
          if (Math.min(u[0], v[0]) - reach > x[0] || Math.max(u[0], v[0]) + reach < x[0] || Math.min(u[1], v[1]) - reach > x[1] || Math.max(u[1], v[1]) + reach < x[1]) continue;
          if (off(x, u, v) < reach) hid = true;
        }
        if (!hid) shown += l / k;
      }
    }
  }
  return shown;
}
