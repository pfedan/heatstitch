import { threadMeters, threadUse } from '../model/threadUse';
import type { DensityGrid } from '../density/grid';
import { formatNumber, t, type Key } from '../i18n';
import type { LoadedFile } from './fileList';
import { sewingSeconds } from '../model/sequence';
import type { Settings } from '../settings';

/**
 * The figures of the design as small tiles: value on top, what it is below. The size stands with
 * the hoop, where it matters.
 */
export function renderStats(
  dl: HTMLElement,
  file: LoadedFile | null,
  grid: DensityGrid | null,
  s: Settings,
  computing: boolean,
): void {
  const rows: [Key, string, string?][] = [];
  const st = file?.stats;
  if (st) {
    const min = sewingSeconds(st.stitches, st.trims, st.colorChanges, s) / 60;
    rows.push(
      ['stats.stitches', formatNumber(st.stitches)],
      ['design.stats.time', t('design.stats.min', { m: formatNumber(min, min < 10 ? 1 : 0) }), 'time'],
      ['design.stats.thread', file?.pattern ? `${threadMeters(threadUse(file.pattern, s.profile.fabric).topTotal)} m` : `${formatNumber(st.threadLength / 1000, 1)} m`],
      ['stats.colors', formatNumber(st.colorChanges)],
      ['design.stats.trims', formatNumber(st.trims)],
      ['stats.jumps', formatNumber(st.jumps)],
    );
    if (s.mode === 'density') {
      const unit = t(s.metric === 'thread' ? 'unit.thread' : 'unit.penetrations');
      rows.push(['stats.maxDensity', computing || !grid ? t('stats.computing') : `${formatNumber(grid.max, 2)} ${unit}`, 'wide']);
    }
  }
  dl.replaceChildren(
    ...rows.map(([k, v, cls]) => {
      const tile = document.createElement('div');
      tile.className = cls ? `tile ${cls}` : 'tile';
      const dd = document.createElement('dd');
      dd.textContent = v;
      const dt = document.createElement('dt');
      dt.textContent = t(k);
      tile.append(dt, dd);
      return tile;
    }),
  );
}
