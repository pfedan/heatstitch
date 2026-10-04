import { STORAGE_NS } from './storage/namespace';
import { DEFAULT_CORRECTION, normalizeCorrection, type CorrectionOptions } from './correct/auto';
import type { Metric } from './density/grid';
import type { DigitizeOptions } from './digitize/digitize';
import { DEFAULT_PREPARE, type PrepareOptions } from './image/prepare';
import type { Lang } from './i18n';
import { DEFAULT_PROFILE, normalizeProfile, threadWidthMm, type Profile } from './validation/profiles';
import { ALL_CHECKS, normalizeChecks, type Checks } from './validation/validate';

export interface Scale {
  max: number;
}

/**
 * Ablauf (how the machine sews it, jumps and trims), Dichte (heatmap, findings, correction) or Bild
 * (an image turned into a stitch file).
 */
export type Mode = 'flow' | 'density' | 'image';
/** What the stitch colors mean in the Ablauf mode. */
export type ColorBy = 'thread' | 'order' | 'kind' | 'length';

/** Symbols drawn on top of the stitches, in both modes. */
export interface Marks {
  jumps: boolean;
  trims: boolean;
  colors: boolean;
  ends: boolean;
  points: boolean;
  /** Jumps without a trim drawn as the thread lying on the fabric (Ablauf mode). */
  threads: boolean;
}

/** What the stage shows in the Bild mode. */
export type ImageView = 'original' | 'prepared' | 'stitches';

export interface ImageSettings {
  prepare: PrepareOptions;
  /** Stitch options the user changed; the others follow the material. */
  stitch: Partial<DigitizeOptions>;
  view: ImageView;
  /** Brush diameter in mm. */
  brushMm: number;
  /** The first converted image was shown as sewn thread with the light going round once. */
  introDone: boolean;
}

export interface Settings {
  mode: Mode;
  colorBy: ColorBy;
  marks: Marks;
  /** Open state of the collapsible sidebar sections, by id. */
  sections: Record<string, boolean>;
  /** Machine speed in stitches per minute, for the sewing time and the player. */
  machineSpm: number;
  /** Player speed as a multiple of the machine speed. */
  playSpeed: number;
  /** Jumps from this length (mm) on are cut by "cut from this length". */
  trimMm: number;
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
  /** In the realistic view the light follows the pointer and the tilt of a phone. */
  liveLight: boolean;
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
  image: ImageSettings;
  lang: Lang | null;
}

/**
 * A 1 mm blur suppresses aliasing between typical 0.4 mm row spacing and the grid. The thread
 * scale tops out at 12 mm/mm² so both reference thresholds (7 and 9.5) are visible.
 */
export const DEFAULTS: Settings = {
  mode: 'flow',
  colorBy: 'thread',
  marks: { jumps: true, trims: true, colors: false, ends: false, points: false, threads: false },
  sections: { display: true, stats: false, advanced: false },
  machineSpm: 800,
  playSpeed: 50,
  trimMm: 3,
  metric: 'thread',
  cellMm: 1,
  blurMm: 1,
  includeJumps: false,
  overlay: false,
  opacity: 0.6,
  realistic: false,
  threadMm: threadWidthMm(DEFAULT_PROFILE),
  liveLight: true,
  showValidation: true,
  findingsOpen: true,
  profile: DEFAULT_PROFILE,
  checks: { ...ALL_CHECKS },
  correction: { ...DEFAULT_CORRECTION },
  scales: {
    thread: { max: 12 },
    penetrations: { max: 4 },
  },
  image: { prepare: { ...DEFAULT_PREPARE }, stitch: {}, view: 'stitches', brushMm: 3, introDone: false },
  lang: null,
};

// v3: material profiles. The modes (v4 fields) are added to v3 settings on load.
const KEY = `${STORAGE_NS}.settings.v3`;

const MODES: Mode[] = ['flow', 'density', 'image'];
const IMAGE_VIEWS: ImageView[] = ['original', 'prepared', 'stitches'];
const COLOR_BY: ColorBy[] = ['thread', 'order', 'kind', 'length'];

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const s = JSON.parse(raw) as Partial<Settings> & { showJumps?: boolean };
    const profile = normalizeProfile(s.profile);
    const { showJumps, ...rest } = s;
    return {
      ...structuredClone(DEFAULTS),
      ...rest,
      // People who used the app before the modes came know it as the density check.
      mode: MODES.includes(s.mode as Mode) ? s.mode! : 'density',
      colorBy: COLOR_BY.includes(s.colorBy as ColorBy) ? s.colorBy! : 'thread',
      marks: { ...DEFAULTS.marks, ...(showJumps !== undefined ? { jumps: showJumps } : {}), ...s.marks },
      sections: { ...DEFAULTS.sections, ...s.sections },
      machineSpm: typeof s.machineSpm === 'number' && s.machineSpm > 0 ? s.machineSpm : DEFAULTS.machineSpm,
      playSpeed: typeof s.playSpeed === 'number' && s.playSpeed > 0 ? s.playSpeed : DEFAULTS.playSpeed,
      trimMm: typeof s.trimMm === 'number' && s.trimMm > 0 ? s.trimMm : DEFAULTS.trimMm,
      scales: { ...structuredClone(DEFAULTS.scales), ...s.scales },
      profile,
      threadMm: typeof s.threadMm === 'number' && s.threadMm > 0 ? s.threadMm : threadWidthMm(profile),
      liveLight: typeof s.liveLight === 'boolean' ? s.liveLight : DEFAULTS.liveLight,
      checks: normalizeChecks(s.checks),
      correction: normalizeCorrection(s.correction),
      image: normalizeImage(s.image),
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

function normalizeImage(i: Partial<ImageSettings> | undefined): ImageSettings {
  const d = DEFAULTS.image;
  const p: Partial<PrepareOptions> = i?.prepare ?? {};
  const st: Record<string, unknown> = { ...i?.stitch };
  // Only known numeric or boolean stitch options survive; anything else follows the material again.
  const stitch: Partial<DigitizeOptions> = {};
  for (const k of ['spacing', 'satinSpacing', 'stitch', 'satinMax', 'satinMin', 'pull', 'overlap', 'trimMm'] as const) {
    if (typeof st[k] === 'number' && Number.isFinite(st[k]) && (st[k] as number) >= 0) stitch[k] = st[k] as number;
  }
  if (typeof st.underlay === 'boolean') stitch.underlay = st.underlay;
  if (typeof st.flow === 'boolean') stitch.flow = st.flow;
  if (typeof st.angle === 'number' && Number.isFinite(st.angle)) stitch.angle = st.angle;
  return {
    prepare: {
      widthMm: num(p.widthMm, 10, 400, d.prepare.widthMm),
      maxColors: Math.round(num(p.maxColors, 2, 16, d.prepare.maxColors)),
      smooth: Math.round(num(p.smooth, 0, 5, d.prepare.smooth)),
      minAreaMm2: num(p.minAreaMm2, 0.5, 50, d.prepare.minAreaMm2),
      background: typeof p.background === 'boolean' ? p.background : d.prepare.background,
      threads: typeof p.threads === 'boolean' ? p.threads : d.prepare.threads,
    },
    stitch,
    view: IMAGE_VIEWS.includes(i?.view as ImageView) ? i!.view! : d.view,
    brushMm: num(i?.brushMm, 0.5, 30, d.brushMm),
    introDone: i?.introDone === true,
  };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private mode); settings stay per session.
  }
}
