/**
 * Icons of the area "objects" in the style of the frame's sprite (20 px, stroked, Lucide-like).
 * They are added to the sprite of index.html at start, so icon('obj-…') from src/shell/h.ts finds them.
 */
const PATHS: Record<string, string> = {
  'obj-duplicate': '<rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/><rect x="7.5" y="7.5" width="9" height="9" rx="1.5"/>',
  'obj-mirror-h': '<path d="M10 2.5v15" stroke-dasharray="1.6 1.8"/><path d="M7.5 5.5 3 14.5h4.5zM12.5 5.5l4.5 9h-4.5z"/>',
  'obj-mirror-v': '<path d="M2.5 10h15" stroke-dasharray="1.6 1.8"/><path d="M5.5 7.5 14.5 3v4.5zM5.5 12.5l9 4.5v-4.5z"/>',
  'obj-reverse': '<path d="M3.5 7h12M13 4.5 15.5 7 13 9.5M16.5 13h-12M7 10.5 4.5 13 7 15.5"/>',
  'obj-earlier': '<path d="M10 16V4.5M5.5 9 10 4.5 14.5 9"/>',
  'obj-later': '<path d="M10 4v11.5M5.5 11l4.5 4.5 4.5-4.5"/>',
  'obj-first': '<path d="M4.5 3.5h11M10 16.5V7M6 11l4-4 4 4"/>',
  'obj-last': '<path d="M4.5 16.5h11M10 3.5V13M6 9l4 4 4-4"/>',
  'obj-order': '<path d="M6.5 15.5v-11M3.5 7.5l3-3 3 3M13.5 4.5v11M10.5 12.5l3 3 3-3"/>',
  'obj-aside': '<path d="M3 3l14 14"/><path d="M8.2 5.2A7.7 7.7 0 0 1 10 5c4 0 6.5 3.4 7.2 5a9.6 9.6 0 0 1-2.1 2.9M5.3 6.9A9.3 9.3 0 0 0 2.8 10c.7 1.6 3.2 5 7.2 5a7 7 0 0 0 2.9-.6"/>',
  'obj-guide': '<path d="M3 16.5 17 3.5" stroke-dasharray="2.6 2.2"/>',
  'obj-delete': '<path d="M3.5 5.5h13M8 5.5V3.5h4v2M5.5 5.5l.8 11h7.4l.8-11M8.5 8.5v5M11.5 8.5v5"/>',
  'obj-split': '<circle cx="5.5" cy="5.5" r="2.2"/><circle cx="5.5" cy="14.5" r="2.2"/><path d="M7.4 6.7 16.5 14M7.4 13.3 16.5 6"/>',
  'obj-combine': '<path d="M4 4.5h4.5a3 3 0 0 1 3 3v8.5M16 4.5h-1.5a3 3 0 0 0-3 3M8.5 13.5l3 3 3-3"/>',
  'obj-subtract': '<path d="M3.5 3.5h9v4.2a5 5 0 0 0-4.8 4.8H3.5z"/><circle cx="12.5" cy="12.5" r="4" stroke-dasharray="1.6 1.6"/>',
  'obj-knockout': '<rect x="3" y="3" width="9.5" height="9.5" rx="1"/><circle cx="12.5" cy="12.5" r="4.5"/><path d="M5 6l3-3M5 9.5 9.5 5M8 12.5l2-2" opacity=".7"/>',
  'obj-blend': '<path d="M3.5 5h13M3.5 8h13M3.5 11h13"/><path d="M3.5 14h13M3.5 17h13" opacity=".45"/>',
  'obj-color': '<path d="M10 2.8s-5 5.3-5 9a5 5 0 0 0 10 0c0-3.7-5-9-5-9z"/>',
  'obj-shape': '<path d="M3.5 15.5C6 6.5 12 4.5 16.5 4.5"/><rect x="2" y="14" width="3" height="3" rx=".5"/><rect x="15" y="3" width="3" height="3" rx=".5"/><path d="M9.6 6.8 12 10.4"/>',
  'obj-stitches': '<path d="M3 15 7.5 5l4 10 4.5-10"/><circle cx="3" cy="15" r="1.2" class="fill"/><circle cx="7.5" cy="5" r="1.2" class="fill"/><circle cx="11.5" cy="15" r="1.2" class="fill"/><circle cx="16" cy="5" r="1.2" class="fill"/>',
  'obj-eye': '<path d="M2.5 10c.8-1.7 3.4-5 7.5-5s6.7 3.3 7.5 5c-.8 1.7-3.4 5-7.5 5s-6.7-3.3-7.5-5z"/><circle cx="10" cy="10" r="2.3"/>',
  'obj-focus': '<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="2.2" class="fill"/>',
  'obj-close': '<path d="M5 5l10 10M15 5 5 15"/>',
  'obj-chevron': '<path d="M8 5.5 12.5 10 8 14.5"/>',
  'obj-link': '<path d="M8.5 11.5l3-3"/><path d="M9 6.5 11 4.5a2.5 2.5 0 0 1 4.5 4.5l-2 2"/><path d="M11 13.5 9 15.5A2.5 2.5 0 0 1 4.5 11l2-2"/>',
  'obj-sew': '<path d="M15.5 4.5 6 14"/><ellipse cx="15.2" cy="4.8" rx=".9" ry="1.6" transform="rotate(45 15.2 4.8)"/><path d="M6 14c-1.8 1.8-3.2 1-3 0s1.4-1.2 2.5-.4"/>',
};

let added = false;

/** Adds the icons to the sprite once (or makes one, when the page has none). */
export function addObjectIcons(): void {
  if (added) return;
  added = true;
  const ns = 'http://www.w3.org/2000/svg';
  let sprite = document.querySelector<SVGSVGElement>('svg.sprite');
  if (!sprite) {
    sprite = document.createElementNS(ns, 'svg');
    sprite.setAttribute('class', 'sprite');
    sprite.setAttribute('aria-hidden', 'true');
    document.body.prepend(sprite);
  }
  const markup = Object.entries(PATHS)
    .map(([id, d]) => `<symbol id="i-${id}" viewBox="0 0 20 20">${d}</symbol>`)
    .join('');
  // Parsed as SVG so the symbols get the SVG namespace.
  const doc = new DOMParser().parseFromString(`<svg xmlns="${ns}">${markup}</svg>`, 'image/svg+xml');
  for (const s of [...doc.documentElement.children]) sprite.appendChild(document.importNode(s, true));
}
