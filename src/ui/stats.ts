import type { DensityGrid } from '../density/grid';
import { formatNumber, t, type Key } from '../i18n';
import type { LoadedFile } from './fileList';
import type { Settings } from '../settings';

export function renderStats(
  dl: HTMLElement,
  swatches: HTMLElement,
  file: LoadedFile | null,
  grid: DensityGrid | null,
  s: Settings,
  computing: boolean,
): void {
  const rows: [Key, string][] = [];
  const st = file?.stats;
  if (st) {
    rows.push(
      ['stats.stitches', formatNumber(st.stitches)],
      ['stats.jumps', formatNumber(st.jumps)],
      ['stats.trims', formatNumber(st.trims)],
      ['stats.colors', formatNumber(st.colorChanges)],
      ['stats.size', `${formatNumber(st.widthMm, 1)} × ${formatNumber(st.heightMm, 1)} mm`],
      ['stats.thread', `${formatNumber(st.threadLength / 1000, 2)} m`],
    );
    const unit = t(s.metric === 'thread' ? 'unit.thread' : 'unit.penetrations');
    rows.push([
      'stats.maxDensity',
      computing || !grid ? t('stats.computing') : `${formatNumber(grid.max, 2)} ${unit}`,
    ]);
  }
  dl.replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = t(k);
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
  swatches.replaceChildren(
    ...(file?.pattern?.colors ?? []).map((c) => {
      const sp = document.createElement('span');
      sp.style.background = `rgb(${c.r}, ${c.g}, ${c.b})`;
      sp.title = c.name ?? '';
      return sp;
    }),
  );
}
