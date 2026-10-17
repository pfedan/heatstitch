import { formatNumber, onLangChange, t, type Key } from '../i18n';
import { pullDigits, swatchGrid, type SwatchKind } from '../model/swatch';
import { setOwn, type Settings } from '../settings';
import { FABRIC, type Own } from '../validation/profiles';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

export interface SwatchPanel {
  /** Draws it anew for the active fabric and thread. */
  refresh(): void;
}

/**
 * The test swatch in the material panel: make one (fill or satin) as a new design, then pick the
 * cell that looked best on the fabric. A pick takes effect right away (no confirming) and can be
 * taken back with "Use the fabric's values"; the grid is the same as the stitched one's (see
 * swatchGrid), so it can be picked days later.
 */
export function bindSwatch(s: Settings, deps: { make: (kind: SwatchKind) => void; changed: () => void }): SwatchPanel {
  const grid = $<HTMLTableElement>('swatch-grid');
  const status = $<HTMLElement>('swatch-own');
  const reset = $<HTMLButtonElement>('swatch-reset');
  const kinds = document.querySelectorAll<HTMLInputElement>('input[name="swatch-kind"]');
  let kind: SwatchKind = 'fill';

  const fmt = (v: number) => formatNumber(v, 2);
  const pullFmt = (v: number) => formatNumber(v, pullDigits(v));

  const pick = (o: Own) => {
    setOwn(s, { ...s.profile.own, [kind]: o });
    deps.changed();
    refresh();
  };

  const refresh = () => {
    const g = swatchGrid(s.profile, kind);
    const own = s.profile.own?.[kind];
    const fabricPull = FABRIC[s.profile.fabric].pullMm;
    const head = document.createElement('tr');
    head.append(Object.assign(document.createElement('th'), { textContent: t('swatch.corner'), scope: 'col' }));
    for (const p of g.pulls) head.append(Object.assign(document.createElement('th'), { textContent: `+${pullFmt(p)}`, scope: 'col' }));
    const rows = g.spacings.map((sp, r) => {
      const tr = document.createElement('tr');
      tr.append(Object.assign(document.createElement('th'), { textContent: fmt(sp), scope: 'row' }));
      for (const p of g.pulls) {
        const td = document.createElement('td');
        const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'swatch-cell', checked: !!own && near(own.spacing, sp) && near(own.pull, p) });
        const fabricCell = r === 2 && near(p, Math.round(fabricPull * 20) / 20);
        const label = document.createElement('label');
        label.title = t(fabricCell ? 'swatch.cell.fabric' : 'swatch.cell', { spacing: fmt(sp), pull: formatNumber(p, 2) });
        input.setAttribute('aria-label', label.title);
        if (fabricCell) label.classList.add('fabric');
        input.addEventListener('change', () => input.checked && pick({ spacing: sp, pull: p }));
        label.append(input, document.createElement('span'));
        td.append(label);
        tr.append(td);
      }
      return tr;
    });
    grid.replaceChildren(head, ...rows);
    const lines = (['fill', 'satin'] as const).flatMap((k) => {
      const o = s.profile.own?.[k];
      return o ? [t(`swatch.own.${k}`, { spacing: fmt(o.spacing), pull: formatNumber(o.pull, 2) })] : [];
    });
    // What a pick does stays beside the grid, not in a message that goes away.
    status.textContent = lines.length ? [...lines, t('swatch.applied', { fabric: t(`fabric.${s.profile.fabric}` as Key).split(',')[0] })].join(' ') : t('swatch.own.none');
    reset.hidden = !lines.length;
  };

  kinds.forEach((k) =>
    k.addEventListener('change', () => {
      if (!k.checked) return;
      kind = k.value as SwatchKind;
      refresh();
    }),
  );
  $('swatch-make').addEventListener('click', () => deps.make(kind));
  reset.addEventListener('click', () => {
    setOwn(s, undefined);
    deps.changed();
    refresh();
  });
  refresh();
  onLangChange(refresh);
  return { refresh };
}
