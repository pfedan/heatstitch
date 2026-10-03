import type { Metric } from './density/grid';
import type { Lang } from './i18n';

export interface Scale {
  max: number;
}

export interface Settings {
  metric: Metric;
  cellMm: number;
  blurMm: number;
  includeJumps: boolean;
  overlay: boolean;
  opacity: number;
  showJumps: boolean;
  /** Orange/red overlay of the fixed 3-tier validation. */
  showValidation: boolean;
  scales: Record<Metric, Scale>;
  lang: Lang | null;
}

/**
 * A 1 mm blur suppresses aliasing between typical 0.4 mm row spacing and the grid. The thread
 * scale tops out at 12 mm/mm² so both validation thresholds (6 and 10) are visible.
 */
export const DEFAULTS: Settings = {
  metric: 'thread',
  cellMm: 1,
  blurMm: 1,
  includeJumps: false,
  overlay: false,
  opacity: 0.6,
  showJumps: false,
  showValidation: true,
  scales: {
    thread: { max: 12 },
    penetrations: { max: 4 },
  },
  lang: null,
};

// v2: warning threshold replaced by the fixed validation tiers.
const KEY = 'heatstitch.settings.v2';

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
