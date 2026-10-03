/** Inferno colormap, polynomial fit (Matt Zucker, CC0). */
const C = [
  [0.0002189403691192265, 0.001651004631001012, -0.01948089843709184],
  [0.1065134194856116, 0.5639564367884091, 3.932712388889277],
  [11.60249308247187, -3.972853965665698, -15.9423941062914],
  [-41.70399613139459, 17.43639888205313, 44.35414519872813],
  [77.162935699427, -33.40235894210092, -81.80730925738993],
  [-71.31942824499214, 32.62606426397723, 73.20951985803202],
  [25.13112622477341, -12.24266895238567, -23.07032500287172],
];

function inferno(t: number): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    let v = C[6][ch];
    for (let k = 5; k >= 0; k--) v = C[k][ch] + t * v;
    out[ch] = Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  return out;
}

export const LUT_SIZE = 256;

/** RGBA lookup table. Low values fade in so blurred tails do not paint a dark halo. */
export const LUT: Uint8ClampedArray = (() => {
  const lut = new Uint8ClampedArray(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);
    // Start at 0.08 so the lowest density is dark purple rather than pure black.
    const [r, g, b] = inferno(0.08 + 0.92 * t);
    lut[i * 4] = r;
    lut[i * 4 + 1] = g;
    lut[i * 4 + 2] = b;
    lut[i * 4 + 3] = Math.round(255 * Math.min(1, 0.35 + t * 6));
  }
  return lut;
})();

export function lutCss(t: number): string {
  const i = Math.round(Math.min(1, Math.max(0, t)) * (LUT_SIZE - 1)) * 4;
  return `rgb(${LUT[i]}, ${LUT[i + 1]}, ${LUT[i + 2]})`;
}

export const WARN_COLOR = '#00e5ff';
