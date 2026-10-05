import type { Bounds } from './pattern';

/** Sewing field of an embroidery hoop in mm, as the machine holds it (width across, height along). */
export interface Hoop {
  w: number;
  h: number;
}

/** Common sewing fields with the brands they are usual for. */
export const HOOPS: readonly { w: number; h: number; brands: string }[] = [
  { w: 50, h: 50, brands: 'Janome, Brother' },
  { w: 100, h: 100, brands: 'Brother, Babylock, Janome, Pfaff' },
  { w: 126, h: 110, brands: 'Janome' },
  { w: 130, h: 180, brands: 'Brother, Babylock' },
  { w: 140, h: 200, brands: 'Janome' },
  { w: 160, h: 260, brands: 'Brother, Babylock, Pfaff' },
  { w: 200, h: 200, brands: 'Janome, Husqvarna' },
  { w: 200, h: 300, brands: 'Brother, Babylock, Husqvarna' },
  { w: 240, h: 360, brands: 'Brother, Pfaff' },
];

/** Largest sewing field a custom hoop may have, mm. */
export const HOOP_MAX_MM = 1000;

export const hoopKey = (h: Hoop) => `${h.w}x${h.h}`;
export const isListed = (h: Hoop) => HOOPS.some((x) => x.w === h.w && x.h === h.h);

/** A valid hoop from stored data, or null. */
export function normalizeHoop(v: unknown): Hoop | null {
  if (!v || typeof v !== 'object') return null;
  const { w, h } = v as Partial<Hoop>;
  const ok = (n: unknown): n is number => typeof n === 'number' && n >= 10 && n <= HOOP_MAX_MM;
  return ok(w) && ok(h) ? { w: Math.round(w), h: Math.round(h) } : null;
}

export interface HoopFit {
  /** The design fits as the machine holds the hoop. */
  fits: boolean;
  /** It fits only turned by 90° (machines can turn a design). */
  turned: boolean;
  /** How far it sticks out across and along, mm (0 when it fits that way). */
  overW: number;
  overH: number;
}

/** Whether a design of these bounds (0.1 mm) fits the sewing field, centered as machines load it. */
export function hoopFit(b: Bounds, hoop: Hoop): HoopFit {
  const w = (b.maxX - b.minX) / 10;
  const h = (b.maxY - b.minY) / 10;
  const overW = Math.max(0, w - hoop.w);
  const overH = Math.max(0, h - hoop.h);
  const fits = overW === 0 && overH === 0;
  const turned = !fits && w <= hoop.h && h <= hoop.w;
  return { fits, turned, overW, overH };
}

/** The smallest listed hoop bigger than `hoop` that takes the design (either way round), or null. */
export function biggerHoop(b: Bounds, hoop: Hoop): Hoop | null {
  const size = hoop.w * hoop.h;
  const fit = HOOPS.filter((x) => x.w * x.h > size).find((x) => {
    const f = hoopFit(b, x);
    return f.fits || f.turned;
  });
  return fit ? { w: fit.w, h: fit.h } : null;
}
