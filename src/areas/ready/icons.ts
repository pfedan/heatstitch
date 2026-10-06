/**
 * Symbols of the area "ready" (Lucide style, 20 x 20, drawn with the stroke of `.i`). The stitch
 * sheet carries the same symbols in its own page.
 */
export const SYMBOLS: Record<string, string> = {
  // Two layers of stabilizer.
  'ready-stab': '<path d="M3 8.2 10 5l7 3.2-7 3.2z"/><path d="m3 11.8 7 3.2 7-3.2"/>',
  // A film laid on top of the fabric.
  'ready-topping': '<path d="M3 6.5c1.7-1.3 3.3-1.3 5 0s3.3 1.3 5 0 2.7-1.2 4 0"/><rect x="3" y="10.5" width="14" height="5" rx="1"/>',
  // Needle with its eye.
  'ready-needle': '<path d="M4 16 12.6 7.4"/><path d="M12.6 7.4 15.8 4.2"/><ellipse cx="14.4" cy="5.6" rx="1.9" ry=".8" transform="rotate(-45 14.4 5.6)"/>',
  // Spool of thread.
  'ready-thread': '<path d="M5.5 4h9M5.5 16h9"/><path d="M7 4v12M13 4v12"/><path d="m7 7.5 6 2M7 11l6 2"/>',
  // Gauge.
  'ready-speed': '<path d="M3.5 14.5a6.5 6.5 0 1 1 13 0"/><path d="m10 14.5 3.2-4"/><circle cx="10" cy="14.5" r=".9" class="fill"/>',
  // Hoop with its center.
  'ready-hoop': '<rect x="3" y="3" width="14" height="14" rx="4"/><path d="M10 7v6M7 10h6"/>',
  // Fabric floating on a sticky base.
  'ready-float': '<rect x="3" y="12" width="14" height="4" rx="1" stroke-dasharray="2 1.6"/><path d="M4.5 8.5h11"/><path d="M8 5.5 10 3.5l2 2"/>',
  // A tip.
  'ready-tip': '<path d="M7.3 13.2a4.6 4.6 0 1 1 5.4 0V15H7.3z"/><path d="M8 17.5h4"/>',
  'ready-alert': '<path d="M10 3.5 17.5 16h-15z"/><path d="M10 8.5v3.5"/><circle cx="10" cy="14.2" r=".5" class="fill"/>',
  'ready-sheet': '<path d="M5 2.5h7l3.5 3.5v11.5H5z"/><path d="M12 2.5V6h3.5"/><path d="M10.2 9v6M7.2 12h6"/>',
};

/** The symbols as a hidden sprite (for the page and for the stitch sheet). */
export const spriteMarkup = (): string =>
  `<svg class="sprite" aria-hidden="true" width="0" height="0" style="position:absolute">${Object.entries(SYMBOLS)
    .map(([id, body]) => `<symbol id="i-${id}" viewBox="0 0 20 20">${body}</symbol>`)
    .join('')}</svg>`;

export function addIcons(): void {
  if (document.getElementById('i-ready-stab')) return;
  const box = document.createElement('div');
  box.innerHTML = spriteMarkup();
  document.body.prepend(box.firstElementChild!);
}
