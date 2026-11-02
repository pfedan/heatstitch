/**
 * Where the light comes from in the realistic thread view, in screen space (x right, y down): the
 * direction towards the light projected onto the fabric, over a height of 0.85. The length sets how
 * low the lamp stands; it never goes below about 50 degrees, as a lamp in a room seldom does.
 *
 * Real embroidery thread shines across its fibers, so satin columns and fill rows catch the light a
 * little more or less depending on where the lamp is, as when a sewn-out patch is turned in the hand.
 * Under a room light that is a gentle shift, not a change of color: most light comes from all around
 * (threadsGl.ts). The light can follow the pointer or the tilt of a phone, and sweep once around the
 * design by itself.
 */

export const DEFAULT_LIGHT: readonly [number, number] = [-0.39, -0.46];

/** Longest light vector: the lowest lamp, about 50 degrees over the fabric. */
export const MAX_LIGHT = 0.7;

let light: [number, number] = [...DEFAULT_LIGHT];
let sweepFrame = 0;

export function lightDir(): [number, number] {
  return light;
}

export function setLight(x: number, y: number): void {
  const l = Math.hypot(x, y);
  const k = l > MAX_LIGHT ? MAX_LIGHT / l : 1;
  light = [x * k, y * k];
}

export function sweeping(): boolean {
  return sweepFrame !== 0;
}

/**
 * The light from a point on the stage: from the direction of the pointer as seen from the middle,
 * lower the further out the pointer is.
 */
export function lightFromPointer(sx: number, sy: number, w: number, h: number): void {
  if (sweepFrame) return;
  const r = Math.max(1, Math.min(w, h) / 2);
  setLight(((sx - w / 2) / r) * MAX_LIGHT, ((sy - h / 2) / r) * MAX_LIGHT);
}

/**
 * The light from the tilt of a phone (DeviceOrientationEvent, degrees): tilting it to a side lets
 * the light fall in from that side, as when turning a patch in the hand. Held upright at about 40
 * degrees, the light stands in the middle.
 */
export function lightFromTilt(beta: number, gamma: number): void {
  if (sweepFrame) return;
  setLight((-gamma / 35) * MAX_LIGHT, (-(beta - 40) / 35) * MAX_LIGHT);
}

/**
 * Moves the light once around the design and back to where it was; `frame` redraws. Skipped when
 * the viewer asked for reduced motion.
 */
export function sweep(frame: () => void, ms = 2600): void {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  cancelAnimationFrame(sweepFrame);
  const [hx, hy] = light;
  const start = performance.now();
  const a0 = Math.atan2(hy, hx);
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    // Ease in and out; the light goes low on the way round and comes back up at the end.
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const a = a0 + e * Math.PI * 2;
    const reach = Math.hypot(hx, hy) + Math.sin(Math.PI * t) * (MAX_LIGHT - Math.hypot(hx, hy));
    light = [Math.cos(a) * reach, Math.sin(a) * reach];
    frame();
    if (t < 1) sweepFrame = requestAnimationFrame(step);
    else {
      sweepFrame = 0;
      light = [hx, hy];
      frame();
    }
  };
  sweepFrame = requestAnimationFrame(step);
}
