import { formatNumber, t } from '../i18n';

/** The two parts of the bar together are at most this wide on the screen (CSS pixels). */
export const SCALE_BAR_PX = 120;

/**
 * Length of one part of the scale bar (mm): the longest of 1, 2.5 and 5 times a power of ten
 * (..., 0.5, 1, 2.5, 5, 10, 25, 50, 100, ...) whose two parts fit into `maxPx` at `pxPerMm`. Each
 * step is at most 2.5 times the one before, so the bar never shrinks below 40 % of its room.
 */
export function scaleStep(pxPerMm: number, maxPx = SCALE_BAR_PX): number {
  const most = maxPx / (2 * pxPerMm);
  let e = Math.floor(Math.log10(most));
  // Below a tenth of a mm the bar would only show the fabric's weave: 0.1 is the smallest step.
  if (e < -1) return 0.1;
  for (;;) {
    const base = 10 ** e;
    for (const m of [5, 2.5, 1]) {
      const s = Math.round(m * base * 1000) / 1000;
      if (s <= most + 1e-9) return s;
    }
    e--;
  }
}

/**
 * The scale bar at the foot of the stage: a black and a white part of a round length, numbered at
 * their ends. Its box keeps one width, so the hint beside it does not jump while zooming.
 */
export class ScaleBar {
  private step = 0;
  private px = 0;
  private readonly bar: HTMLElement;
  private readonly labels: HTMLSpanElement[];

  constructor(readonly root: HTMLElement) {
    this.bar = document.createElement('div');
    this.bar.className = 'sb-bar';
    this.bar.append(document.createElement('span'), document.createElement('span'));
    const nums = document.createElement('div');
    nums.className = 'sb-nums';
    this.labels = [0, 1, 2].map(() => nums.appendChild(document.createElement('span')));
    root.replaceChildren(this.bar, nums);
    root.setAttribute('role', 'img');
  }

  /** Brings the bar to the zoom `pxPerMm` (cheap when nothing changed). */
  update(pxPerMm: number, force = false): void {
    const step = scaleStep(pxPerMm);
    const px = Math.round(step * pxPerMm);
    if (!force && step === this.step && px === this.px) return;
    this.step = step;
    this.px = px;
    // Whole numbers without a decimal place: 0, 2,5, 5 and 0, 0,25, 0,5.
    const n = (k: number) => {
      const v = Math.round(k * step * 1000) / 1000;
      return formatNumber(v, Number.isInteger(v) ? 0 : String(v).split('.')[1].length);
    };
    this.root.style.setProperty('--sb-part', `${px}px`);
    this.labels[0].textContent = n(0);
    this.labels[1].textContent = n(1);
    this.labels[2].textContent = n(2);
    this.labels[2].dataset.unit = 'mm';
    this.root.setAttribute('aria-label', t('measure.scale.label', { v: n(1) }));
  }
}
