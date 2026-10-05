import { formatNumber, t } from '../i18n';
import { biggerHoop, HOOP_MAX_MM, hoopFit, hoopKey, HOOPS, isListed, type Hoop } from '../model/hoop';
import type { Bounds } from '../model/pattern';
import type { Settings } from '../settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mm = (v: number) => formatNumber(v, v < 10 ? 1 : 0);
export const hoopLabel = (h: Hoop) => `${h.w} × ${h.h} mm`;

/** What to say about a design of these bounds in the hoop; null when it fits or no hoop is chosen. */
export function hoopMessage(b: Bounds | undefined, hoop: Hoop | null): { text: string; bigger: Hoop | null; turned: boolean } | null {
  if (!b || !hoop) return null;
  const fit = hoopFit(b, hoop);
  if (fit.fits) return null;
  if (fit.turned) return { text: t('hoop.turned', { hoop: hoopLabel(hoop) }), bigger: null, turned: true };
  const parts = [fit.overW > 0 && t('hoop.wider', { mm: mm(fit.overW) }), fit.overH > 0 && t('hoop.taller', { mm: mm(fit.overH) })].filter(Boolean);
  return { text: t('hoop.over', { hoop: hoopLabel(hoop), over: parts.join(t('hoop.and')) }), bigger: biggerHoop(b, hoop), turned: false };
}

/** A short note behind a size (mm): too big for the hoop, or only turned; empty when it fits. */
export function hoopShort(w: number, h: number, hoop: Hoop | null): string {
  if (!hoop) return '';
  const f = hoopFit({ minX: 0, minY: 0, maxX: w * 10, maxY: h * 10 }, hoop);
  return f.fits ? '' : t(f.turned ? 'hoop.short.turned' : 'hoop.short.over', { hoop: hoopLabel(hoop) });
}

/**
 * The hoop the file names in its header, when it differs from the chosen one and the design fits it
 * (some software writes a fixed size whatever the design).
 */
export function fileHoopOffer(b: Bounds | undefined, hoop: Hoop | null, fileHoop: Hoop | undefined): Hoop | null {
  if (!b || !fileHoop || (hoop && hoopKey(hoop) === hoopKey(fileHoop))) return null;
  const f = hoopFit(b, fileHoop);
  return f.fits || f.turned ? fileHoop : null;
}

/**
 * The hoop picker under the file list: no hoop, the common sewing fields with their brands, or an own
 * size; and the line saying whether the active design fits.
 */
export function bindHoop(s: Settings, onChange: () => void): { refresh: (b: Bounds | undefined, fileHoop?: Hoop) => void } {
  const select = $<HTMLSelectElement>('hoop');
  const custom = $<HTMLElement>('hoop-custom');
  const w = $<HTMLInputElement>('hoop-w');
  const h = $<HTMLInputElement>('hoop-h');
  const note = $<HTMLElement>('hoop-note');
  let bounds: Bounds | undefined;
  /** The size last typed or started as an own size; it stays "own" even when it is in the list. */
  let ownHoop: Hoop | null = null;

  const set = (hoop: Hoop | null) => {
    s.hoop = hoop;
    onChange();
  };
  select.addEventListener('change', () => {
    ownHoop = null;
    if (select.value === 'own') {
      const start = s.hoop ?? { w: 150, h: 150 };
      w.value = String(start.w);
      h.value = String(start.h);
      ownHoop = { ...start };
      set({ ...start });
    } else if (!select.value) set(null);
    else {
      const [hw, hh] = select.value.split('x').map(Number);
      set({ w: hw, h: hh });
    }
  });
  const typed = () => {
    const hw = Math.round(Number(w.value));
    const hh = Math.round(Number(h.value));
    if (hw >= 10 && hh >= 10 && hw <= HOOP_MAX_MM && hh <= HOOP_MAX_MM) {
      ownHoop = { w: hw, h: hh };
      set({ w: hw, h: hh });
    }
  };
  w.addEventListener('change', typed);
  h.addEventListener('change', typed);

  const refresh = (b: Bounds | undefined, fileHoop?: Hoop) => {
    bounds = b;
    // Rebuilt only for another language, so an open list is not disturbed by redraws.
    if (select.options[0]?.text !== t('hoop.none')) {
      select.replaceChildren(
        new Option(t('hoop.none'), ''),
        ...HOOPS.map((x) => new Option(`${hoopLabel(x)} · ${x.brands}`, hoopKey(x))),
        new Option(t('hoop.own'), 'own'),
      );
    }
    const hoop = s.hoop;
    const own = !!hoop && (!isListed(hoop) || (!!ownHoop && hoopKey(ownHoop) === hoopKey(hoop)));
    if (hoop && own) {
      select.value = 'own';
      if (document.activeElement !== w) w.value = String(hoop.w);
      if (document.activeElement !== h) h.value = String(hoop.h);
    } else {
      select.value = hoop ? hoopKey(hoop) : '';
    }
    custom.hidden = !own;
    select.title = hoop ? '' : t('hoop.hint');

    const msg = hoopMessage(bounds, hoop);
    const named = fileHoopOffer(bounds, hoop, fileHoop);
    // The hoop the file was made for beats a guess at a bigger one.
    const offer = named ?? msg?.bigger ?? null;
    const text = msg?.text ?? (named ? t('hoop.file', { hoop: hoopLabel(named) }) : '');
    note.hidden = !text;
    if (text) {
      note.classList.toggle('turned', !!msg?.turned);
      note.classList.toggle('info', !msg);
      const parts: Node[] = [document.createTextNode(text)];
      if (offer) {
        const btn = Object.assign(document.createElement('button'), {
          type: 'button',
          className: 'link',
          textContent: t('hoop.pick', { hoop: hoopLabel(offer) }),
        });
        btn.addEventListener('click', () => {
          ownHoop = null;
          set({ ...offer });
        });
        parts.push(document.createTextNode(' '), btn);
      }
      note.replaceChildren(...parts);
    }
  };
  return { refresh };
}
