import type { Metric } from './density/grid';
import type { Lang } from './i18n';

export interface Scale {
  max: number;
  warn: number;
}

export interface Settings {
  metric: Metric;
  cellMm: number;
  blurMm: number;
  includeJumps: boolean;
  overlay: boolean;
  opacity: number;
  showJumps: boolean;
  scales: Record<Metric, Scale>;
  lang: Lang | null;
}

/**
 * Starting values, to be calibrated with real files. Thread: two layers of fill at
 * 0.4 mm row spacing give ~5 mm/mm². Penetrations: dense satin reaches ~2.5 /mm².
 * A 1 mm blur suppresses aliasing between typical 0.4 mm row spacing and the grid.
 */
export const DEFAULTS: Settings = {
  metric: 'thread',
  cellMm: 1,
  blurMm: 1,
  includeJumps: false,
  overlay: false,
  opacity: 0.6,
  showJumps: false,
  scales: {
    thread: { max: 8, warn: 5 },
    penetrations: { max: 4, warn: 2.5 },
  },
  lang: null,
};

const KEY = 'heatstitch.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      ...structuredClone(DEFAULTS),
      ...s,
      scales: { ...structuredClone(DEFAULTS.scales), ...s.scales },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private mode); settings stay per session.
  }
}
