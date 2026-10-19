/**
 * Whether this Node computes Math.sin, cos, pow and atan2 as the V8 routines that core/src/trig.rs
 * ports (the build on Linux x64, as in CI). Elsewhere, macOS on ARM for one, V8 takes these from the
 * system and the old TypeScript gives last-bit differences that a few fills amplify, so the tests
 * that demand exact equality with it only mean something where this holds.
 */
const FINGERPRINT = '2f1ce8836a3cc5b0'; // Node 22 on Linux x64

export const v8Math = (() => {
  const n = 4096;
  const out = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = (i - n / 2) * 0.0137 + i * 1e-7;
    out[i * 4] = Math.sin(x);
    out[i * 4 + 1] = Math.cos(x * 3.1);
    out[i * 4 + 2] = Math.pow(Math.abs(x) + 0.5, 1 / 3 + i * 1e-4);
    out[i * 4 + 3] = Math.atan2(x, 1.7 - x * 0.3);
  }
  let h = 0n;
  for (const v of new BigUint64Array(out.buffer)) h = (h * 1099511628211n + v) & 0xffffffffffffffffn;
  return h.toString(16);
})() === FINGERPRINT;
