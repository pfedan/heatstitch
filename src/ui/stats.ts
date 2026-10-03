import { areaAbove, type DensityGrid } from '../density/grid';
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
  const rows: [Key, string, boolean?][] = [];
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
    if (computing || !grid) {
      rows.push(['stats.maxDensity', t('stats.computing')]);
    } else {
      const warn = s.scales[s.metric].warn;
      const above = areaAbove(grid, warn);
      rows.push(
        ['stats.maxDensity', `${formatNumber(grid.max, 2)} ${unit}`, grid.max > warn],
        [
          'stats.aboveWarn',
          `${formatNumber(above.areaMm2, 0)} mm² (${formatNumber(above.fraction * 100, 1)} %)`,
          above.areaMm2 > 0,
        ],
      );
    }
  }
  dl.replaceChildren(
    ...rows.flatMap(([k, v, warn]) => {
      const dt = document.createElement('dt');
      dt.textContent = t(k);
      const dd = document.createElement('dd');
      dd.textContent = v;
      if (warn) dd.className = 'warn';
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
