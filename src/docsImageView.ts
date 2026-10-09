/**
 * The guide's pictures open on a tap in a plain full screen view: the picture fitted to the screen,
 * pinch or wheel to zoom, drag to pan, double tap to zoom in and out. Esc, the close button, a tap
 * beside the picture or the browser's back button close it.
 */

/** Where the picture sits: its fitted box scaled by s and moved to x, y (screen px). */
export interface View {
  s: number;
  x: number;
  y: number;
}

/** The screen (W, H) and the picture fitted into it (w, h) at scale 1. */
export interface Frame {
  W: number;
  H: number;
  w: number;
  h: number;
  max: number;
}

/** The picture as large as fits, never larger than it is, centered. */
export function fit(W: number, H: number, natW: number, natH: number): { w: number; h: number } {
  const k = Math.min(W / natW, H / natH, 1);
  return { w: natW * k, h: natH * k };
}

/** Keeps the scale between 1 and max; a picture smaller than the screen stays centered, a larger one covers it. */
export function clamp(v: View, f: Frame): View {
  const s = Math.min(Math.max(v.s, 1), f.max);
  const axis = (pos: number, screen: number, size: number): number =>
    size <= screen ? (screen - size) / 2 : Math.min(0, Math.max(screen - size, pos));
  return { s, x: axis(v.x, f.W, f.w * s), y: axis(v.y, f.H, f.h * s) };
}

/** Zooms by factor k around the screen point (cx, cy), which stays where it is. */
export function zoomAt(v: View, f: Frame, k: number, cx: number, cy: number): View {
  const s = Math.min(Math.max(v.s * k, 1), f.max);
  const r = s / v.s;
  return clamp({ s, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r }, f);
}

export function initImageView(): void {
  const figures = document.querySelectorAll<HTMLImageElement>('figure img');
  const dialog = document.getElementById('image-view') as HTMLDialogElement | null;
  const img = document.getElementById('image-view-img') as HTMLImageElement | null;
  if (!dialog || !img || !figures.length) return;
  const de = document.documentElement.lang === 'de';
  dialog.setAttribute('aria-label', de ? 'Bild im Vollbild' : 'Picture in full screen');
  document.getElementById('image-view-close')?.setAttribute('aria-label', de ? 'Schließen' : 'Close');

  let frame: Frame = { W: 1, H: 1, w: 1, h: 1, max: 1 };
  let view: View = { s: 1, x: 0, y: 0 };

  const draw = (): void => {
    img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
  };
  const layout = (): void => {
    const W = dialog.clientWidth;
    const H = dialog.clientHeight;
    const natW = img.naturalWidth || Number(img.getAttribute('width')) || W;
    const natH = img.naturalHeight || Number(img.getAttribute('height')) || H;
    const { w, h } = fit(W, H, natW, natH);
    // Up to twice the picture's own pixels, and at least four times the fitted size.
    frame = { W, H, w, h, max: Math.max(4, (2 * natW) / w) };
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    view = clamp({ s: 1, x: 0, y: 0 }, frame);
    draw();
  };
  const set = (v: View): void => {
    view = v;
    draw();
  };

  const open = (from: HTMLImageElement): void => {
    img.src = from.currentSrc || from.src;
    img.alt = from.alt;
    img.setAttribute('width', from.getAttribute('width') ?? '');
    img.setAttribute('height', from.getAttribute('height') ?? '');
    dialog.showModal();
    document.documentElement.classList.add('image-view-open');
    layout();
    if (!img.complete) img.addEventListener('load', layout, { once: true });
    // The back button (on phones the usual way back) closes the view instead of leaving the page.
    history.pushState({ imageView: true }, '');
  };

  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('image-view-open');
    if ((history.state as { imageView?: boolean } | null)?.imageView) history.back();
  });
  window.addEventListener('popstate', () => {
    if (dialog.open) dialog.close();
  });
  window.addEventListener('resize', () => {
    if (dialog.open) layout();
  });
  document.getElementById('image-view-close')?.addEventListener('click', () => dialog.close());

  for (const f of figures) {
    f.tabIndex = 0;
    f.addEventListener('click', () => open(f));
    f.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      open(f);
    });
  }

  // Zoom in to the picture's own size (or 2.5 times, whichever is more), or back out.
  const toggleZoom = (cx: number, cy: number): void => {
    const target = Math.min(frame.max, Math.max(2.5, img.naturalWidth / frame.w || 0));
    set(view.s > 1.01 ? clamp({ s: 1, x: 0, y: 0 }, frame) : zoomAt(view, frame, target / view.s, cx, cy));
  };

  dialog.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? dialog.clientHeight : 1);
      set(zoomAt(view, frame, Math.exp(-dy * 0.002), e.clientX, e.clientY));
    },
    { passive: false },
  );

  dialog.addEventListener('keydown', (e) => {
    const k = e.key === '+' || e.key === '=' ? 1.5 : e.key === '-' ? 1 / 1.5 : e.key === '0' ? 0 : -1;
    if (k < 0) return;
    e.preventDefault();
    set(k === 0 ? clamp({ s: 1, x: 0, y: 0 }, frame) : zoomAt(view, frame, k, frame.W / 2, frame.H / 2));
  });

  // Pointers: one drags, two pinch. A short tap without movement beside the picture closes the
  // view; two taps on the picture zoom.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; mx: number; my: number } | null = null;
  let tap: { x: number; y: number; t: number; onImage: boolean; moved: boolean } | null = null;
  let lastTap: { x: number; y: number; t: number } | null = null;

  const pinchOf = (): { d: number; mx: number; my: number } => {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };

  dialog.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('button')) return;
    dialog.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) tap = { x: e.clientX, y: e.clientY, t: e.timeStamp, onImage: e.target === img, moved: false };
    else {
      tap = null;
      pinch = pinchOf();
    }
  });

  dialog.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap.moved = true;
    if (pointers.size >= 2 && pinch) {
      const now = pinchOf();
      const moved = clamp({ s: view.s, x: view.x + now.mx - pinch.mx, y: view.y + now.my - pinch.my }, frame);
      set(zoomAt(moved, frame, now.d / pinch.d, now.mx, now.my));
      pinch = now;
    } else if (pointers.size === 1) {
      set(clamp({ s: view.s, x: view.x + dx, y: view.y + dy }, frame));
    }
  });

  const up = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    pinch = pointers.size >= 2 ? pinchOf() : null;
    if (pointers.size || !tap || e.type === 'pointercancel') return;
    const t = tap;
    tap = null;
    if (t.moved || e.timeStamp - t.t > 400) return;
    if (!t.onImage) {
      dialog.close();
      return;
    }
    if (lastTap && e.timeStamp - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      lastTap = null;
      toggleZoom(e.clientX, e.clientY);
    } else lastTap = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  };
  dialog.addEventListener('pointerup', up);
  dialog.addEventListener('pointercancel', up);
}
