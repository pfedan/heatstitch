import type { Metric } from './density/grid';
import type { Lang } from './i18n';
import { DEFAULT_PROFILE, normalizeProfile, type Profile } from './validation/profiles';
import { ALL_CHECKS, normalizeChecks, type Checks } from './validation/validate';

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
  /** Stitch plan drawn as shaded threads with shadows instead of flat lines. */
  realistic: boolean;
  showJumps: boolean;
  /** Orange/red overlay of the 3-tier validation. */
  showValidation: boolean;
  /** Findings column next to the canvas is shown (else only a chip on the canvas). */
  findingsOpen: boolean;
  /** Material the validation thresholds are scaled for. */
  profile: Profile;
  /** Validation rules that are switched on. */
  checks: Checks;
  scales: Record<Metric, Scale>;
  lang: Lang | null;
}

/**
 * A 1 mm blur suppresses aliasing between typical 0.4 mm row spacing and the grid. The thread
 * scale tops out at 12 mm/mm² so both reference thresholds (7 and 9.5) are visible.
 */
export const DEFAULTS: Settings = {
  metric: 'thread',
  cellMm: 1,
  blurMm: 1,
  includeJumps: false,
  overlay: false,
  opacity: 0.6,
  realistic: false,
  showJumps: false,
  showValidation: true,
  findingsOpen: true,
  profile: DEFAULT_PROFILE,
  checks: { ...ALL_CHECKS },
  scales: {
    thread: { max: 12 },
    penetrations: { max: 4 },
  },
  lang: null,
};

// v3: material profiles.
const KEY = 'heatstitch.settings.v3';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      ...structuredClone(DEFAULTS),
      ...s,
      scales: { ...structuredClone(DEFAULTS.scales), ...s.scales },
      profile: normalizeProfile(s.profile),
      checks: normalizeChecks(s.checks),
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
