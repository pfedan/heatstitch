/**
 * Color spaces for the image converter: sRGB (D65) to CIELAB and back, and the CIEDE2000 color
 * difference (Sharma, Wu & Dalal, "The CIEDE2000 color-difference formula: implementation notes,
 * supplementary test data, and mathematical observations", Color Res. Appl. 30(1), 2005).
 *
 * Clustering averages colors, so it uses plain Euclidean distance in Lab; CIEDE2000 is used where
 * single colors are compared (matching threads, merging clusters).
 */

export type Lab = [number, number, number];
export type Rgb = [number, number, number];

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};

// D65 reference white.
const XN = 0.95047;
const YN = 1;
const ZN = 1.08883;
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

const f = (t: number) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
const finv = (t: number) => (t ** 3 > EPS ? t ** 3 : (116 * t - 16) / KAPPA);

/** Lookup table: 8-bit sRGB to linear light. */
const LINEAR = Float64Array.from({ length: 256 }, (_, i) => toLinear(i));

export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = LINEAR[r];
  const G = LINEAR[g];
  const B = LINEAR[b];
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / XN;
  const y = (0.2126729 * R + 0.7151522 * G + 0.072175 * B) / YN;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / ZN;
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb(L: number, a: number, b: number): Rgb {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const x = finv(fx) * XN;
  const y = (L > KAPPA * EPS ? fy ** 3 : L / KAPPA) * YN;
  const z = finv(fz) * ZN;
  const R = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const G = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const B = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [fromLinear(R), fromLinear(G), fromLinear(B)];
}

const RAD = Math.PI / 180;

/** CIEDE2000 color difference with kL = kC = kH = 1. */
export function deltaE2000(l1: Lab, l2: Lab): number {
  const [L1, a1, b1] = l1;
  const [L2, a2, b2] = l2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const Cm7 = Cm ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cm7 / (Cm7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) / RAD;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);
  const Lpm = (L1 + L2) / 2;
  const Cpm = (C1p + C2p) / 2;
  let hpm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hpm = (h1p + h2p) / 2;
    else hpm = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hpm - 30) * RAD) +
    0.24 * Math.cos(2 * hpm * RAD) +
    0.32 * Math.cos((3 * hpm + 6) * RAD) -
    0.2 * Math.cos((4 * hpm - 63) * RAD);
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2));
  const Cpm7 = Cpm ** 7;
  const RC = 2 * Math.sqrt(Cpm7 / (Cpm7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2);
  const SC = 1 + 0.045 * Cpm;
  const SH = 1 + 0.015 * Cpm * T;
  const RT = -Math.sin(2 * dTheta * RAD) * RC;
  const tl = dLp / SL;
  const tc = dCp / SC;
  const th = dHp / SH;
  return Math.sqrt(tl * tl + tc * tc + th * th + RT * tc * th);
}
