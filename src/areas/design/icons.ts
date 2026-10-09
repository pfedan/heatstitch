/**
 * Symbols of the area "design" (Lucide style, 20 x 20, drawn with the stroke of `.i`), added to the
 * page once so `icon(name)` and `<use href="#i-name">` in index.html find them.
 */
const SYMBOLS: Record<string, string> = {
  play: '<path d="M7 4.8v10.4a.6.6 0 0 0 .9.5l8.2-5.2a.6.6 0 0 0 0-1L7.9 4.3a.6.6 0 0 0-.9.5z" class="fill"/>',
  pause: '<rect x="5.5" y="4.5" width="3" height="11" rx=".8" class="fill"/><rect x="11.5" y="4.5" width="3" height="11" rx=".8" class="fill"/>',
  'step-back': '<path d="M12.5 5 7.5 10l5 5"/>',
  'step-forward': '<path d="m7.5 5 5 5-5 5"/>',
  'skip-back': '<path d="M5.5 5v10"/><path d="M15 5.5 9 10l6 4.5z"/>',
  'skip-forward': '<path d="M14.5 5v10"/><path d="M5 5.5 11 10l-6 4.5z"/>',
  'chevron-up': '<path d="M5.5 12.5 10 8l4.5 4.5"/>',
  eye: '<path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z"/><circle cx="10" cy="10" r="2.2"/>',
  ruler: '<path d="M3 13.5 13.5 3l3.5 3.5L6.5 17z"/><path d="m5.6 10.9 1.3 1.3M8.2 8.3l2.1 2.1M10.8 5.7l1.3 1.3"/>',
  fit: '<path d="M3.5 7.5v-4h4M16.5 7.5v-4h-4M3.5 12.5v4h4M16.5 12.5v4h-4"/>',
  marks: '<path d="M4.5 15.5 15.5 4.5" stroke-dasharray="2.4 2.2"/><circle cx="4.5" cy="15.5" r="2" class="fill"/><circle cx="15.5" cy="4.5" r="2" class="fill"/>',
  'view-stitches': '<path d="M10 2.5c4.6 3.4 4.6 11.6 0 15-4.6-3.4-4.6-11.6 0-15z"/><path d="M7.8 6.6l4.4-1.8M7.1 9.9l5.8-2.4M7.1 13.1l5.8-2.4M7.8 15.7l4.4-1.8" stroke-width="1.4"/>',
  'view-shapes': '<path d="M10 2.5c4.6 3.4 4.6 11.6 0 15-4.6-3.4-4.6-11.6 0-15z" class="fill"/>',
  check: '<path d="m4.5 10.5 3.5 3.5 7.5-8"/>',
  alert: '<path d="M10 3.5 17.5 16h-15z"/><path d="M10 8.5v3.5"/><circle cx="10" cy="14.2" r=".5" class="fill"/>',
  'eye-off': '<path d="M3 3l14 14"/><path d="M8.2 5.2A7.7 7.7 0 0 1 10 5c4 0 6.5 3.4 7.2 5a9.6 9.6 0 0 1-2.1 2.9M5.3 6.9A9.3 9.3 0 0 0 2.8 10c.7 1.6 3.2 5 7.2 5a7 7 0 0 0 2.9-.6"/>',
  lock: '<rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>',
  unlock: '<rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 5.8-1.1"/>',
  trash: '<path d="M3.5 5.5h13M8 5.5V3.5h4v2M5.5 5.5l.8 11h7.4l.8-11M8.5 8.5v5M11.5 8.5v5"/>',
  'trace-image': '<rect x="3" y="4" width="14" height="12" rx="1.5"/><circle cx="7.5" cy="8.2" r="1.4"/><path d="m3.5 14.5 4.2-4 3 2.8 2.3-2 3.5 3.2"/>',
  list: '<path d="M7.5 5.5h9M7.5 10h9M7.5 14.5h9"/><circle cx="4" cy="5.5" r=".7" class="fill"/><circle cx="4" cy="10" r=".7" class="fill"/><circle cx="4" cy="14.5" r=".7" class="fill"/>',
};

let added = false;

export function addIcons(): void {
  if (added) return;
  added = true;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'sprite');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = Object.entries(SYMBOLS)
    .map(([id, body]) => `<symbol id="i-${id}" viewBox="0 0 20 20">${body}</symbol>`)
    .join('');
  document.body.prepend(svg);
}
