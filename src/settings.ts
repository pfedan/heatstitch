import { STORAGE_NS } from './storage/namespace';
import { DEFAULT_CORRECTION, normalizeCorrection, type CorrectionOptions } from './correct/auto';
import type { Metric } from './density/grid';
import type { Lang } from './i18n';
import { DEFAULT_PROFILE, normalizeProfile, threadWidthMm, type Profile } from './validation/profiles';
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
  /** Visual thread width of the realistic view in mm; reset to the thread weight's width when the profile thread changes. */
  threadMm: number;
  showJumps: boolean;
  /** Orange/red overlay of the 3-tier validation. */
  showValidation: boolean;
  /** Findings column next to the canvas is shown (else only a chip on the canvas). */
  findingsOpen: boolean;
  /** Material the validation thresholds are scaled for. */
  profile: Profile;
  /** Validation rules that are switched on. */
  checks: Checks;
  /** Automatic correction options (the region is chosen per run). */
  correction: Omit<CorrectionOptions, 'region'>;
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
  threadMm: threadWidthMm(DEFAULT_PROFILE),
  showJumps: false,
  showValidation: true,
  findingsOpen: true,
  profile: DEFAULT_PROFILE,
  checks: { ...ALL_CHECKS },
  correction: { ...DEFAULT_CORRECTION },
  scales: {
    thread: { max: 12 },
    penetrations: { max: 4 },
  },
  lang: null,
};

// v3: material profiles.
const KEY = `${STORAGE_NS}.settings.v3`;

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const s = JSON.parse(raw) as Partial<Settings>;
    const profile = normalizeProfile(s.profile);
    return {
      ...structuredClone(DEFAULTS),
      ...s,
      scales: { ...structuredClone(DEFAULTS.scales), ...s.scales },
      profile,
      threadMm: typeof s.threadMm === 'number' && s.threadMm > 0 ? s.threadMm : threadWidthMm(profile),
      checks: normalizeChecks(s.checks),
      correction: normalizeCorrection(s.correction),
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
