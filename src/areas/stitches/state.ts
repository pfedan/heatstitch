import { STORAGE_NS } from '../../storage/namespace';
import { signal } from '../../shell/signal';

/** Shares offered for thinning out: every fourth, third or second row pair. */
export const THIN_SHARES: [number, string][] = [
  [0.25, '25 %'],
  [0.34, '33 %'],
  [0.5, '50 %'],
];

const KEY = `${STORAGE_NS}.ui.thinShare`;
const read = (): number => {
  try {
    const v = Number(localStorage.getItem(KEY));
    return THIN_SHARES.some(([s]) => s === v) ? v : 0.34;
  } catch {
    return 0.34;
  }
};

/** How much "Ausdünnen" takes out, the same in the object page and in the options bar; remembered. */
export const thinShare = signal(read());

export function setThinShare(v: number): void {
  thinShare.set(v);
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* private mode: not kept */
  }
}
