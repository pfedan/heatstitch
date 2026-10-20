/**
 * The splash (#boot in index.html, with its style and texts there) covers the page from its first
 * paint until the app is set up, so nobody sees the bare markup without texts and state. While the
 * compute core comes in, its ring and number show how far; with a warm cache the app is there before
 * anything of the splash shows (its content comes after 250 ms) and the plain background fades out.
 * When the core does not load, it says so and offers to reload.
 */

const boot = () => document.getElementById('boot');

let shown = -1;
let percent: Intl.NumberFormat | undefined;

/** The share of the core that is there (0 to 1), or null while that is unknown. */
export function bootProgress(done: number | null): void {
  const el = boot();
  if (!el) return;
  const ring = document.getElementById('boot-ring')!;
  const pct = document.getElementById('boot-pct')!;
  if (done === null) {
    if (shown === -1) return;
    shown = -1;
    delete el.dataset.progress;
    ring.style.removeProperty('--boot-arc');
    ring.removeAttribute('aria-valuenow');
    pct.textContent = '';
    return;
  }
  const p = Math.round(Math.min(1, Math.max(0, done)) * 100);
  if (p === shown) return;
  shown = p;
  el.dataset.progress = '';
  // The ring keeps a gap while it turns, so it never stands still as a closed circle.
  ring.style.setProperty('--boot-arc', String(arcOf(p)));
  ring.setAttribute('aria-valuenow', String(p));
  percent ??= new Intl.NumberFormat(el.lang || undefined, { style: 'percent' });
  pct.textContent = percent.format(p / 100);
}

/** How much of the ring (of 100) is drawn at p percent. */
export const arcOf = (p: number): number => Math.round(6 + 0.88 * Math.min(100, Math.max(0, p)));

/** The core did not load: a clear message and a reload button instead of a ring turning forever. */
export function bootFailed(): void {
  const el = boot();
  if (!el || el.dataset.state === 'error') return;
  el.dataset.state = 'error';
  el.dataset.error = 'failed';
  el.setAttribute('aria-busy', 'false');
  document.getElementById('boot-reload')?.focus();
}

/** The app is set up: the splash fades out (at once with reduced motion) and leaves the page. */
export function bootDone(): void {
  const el = boot();
  if (!el) return;
  el.setAttribute('aria-busy', 'false');
  el.dataset.state = 'done';
  const remove = () => el.remove();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) return remove();
  el.addEventListener('transitionend', (e) => e.target === el && remove());
  // In case no transition runs (a background tab, a paused clock in the screencasts).
  setTimeout(remove, 400);
}
