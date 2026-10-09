import { formatNumber, t } from '../i18n';

/** The two parts of the bar together are at most this wide on the screen (CSS pixels). */
export const SCALE_BAR_PX = 120;

/**
 * Length of one part of the scale bar (mm): the longest of 0.1, 0.2, 0.5, 1, 5, 10, 15, 20, 25, ...
 * whose two parts fit into `maxPx` at `pxPerMm`. Below 1 mm a 0.2 keeps the numbers of a short
 * bar from running into each other at the highest zoom.
 */
export function scaleStep(pxPerMm: number, maxPx = SCALE_BAR_PX): number {
  const most = maxPx / (2 * pxPerMm);
  if (most >= 10) return Math.floor(most / 5) * 5;
  for (const s of [5, 1, 0.5, 0.2]) if (most >= s) return s;
  return 0.1;
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
    const digits = step < 1 ? 1 : 0;
    const n = (k: number) => formatNumber(k * step, k ? digits : 0);
    this.root.style.setProperty('--sb-part', `${px}px`);
    this.labels[0].textContent = n(0);
    this.labels[1].textContent = n(1);
    this.labels[2].textContent = n(2);
    this.labels[2].dataset.unit = 'mm';
    this.root.setAttribute('aria-label', t('measure.scale.label', { v: n(1) }));
  }
}
