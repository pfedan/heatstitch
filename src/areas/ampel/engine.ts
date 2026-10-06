import type { Pattern } from '../../model/pattern';
import type { Measurement } from '../../validation/measure';
import type { FabricId } from '../../validation/profiles';

/*
 * The contract between the traffic light "Klappt das?" and the correction engine
 * (plans/korrektur-engine-review.md, last section "Schnittstelle zur Ampel").
 *
 * The light only reads an `AmpelReport` and applies what it offers. Today a stand-in fills it from
 * the validation and the correction there is (standin.ts); the new engine replaces that one file
 * and fills the same shapes, in a worker, after loading and after every change.
 */

/** The four kinds of findings the light names and fixes, each with its own button. */
export type FindingType = 'density' | 'penetrations' | 'gaps' | 'long';
export const FINDING_TYPES: readonly FindingType[] = ['density', 'penetrations', 'gaps', 'long'];

/** The colour of the light for one fabric. */
export type Light = 'green' | 'yellow' | 'red';

/** A box in mm (world coordinates, y down). */
export interface MmBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** One place on the design: where it is, how large, how bad. A click on it jumps there. */
export interface Spot {
  bbox: MmBox;
  /** Area of what counts at this spot (mm²). */
  areaMm2: number;
  level: 'caution' | 'critical';
}

/**
 * The verdict for one fabric. Red when one connected critical spot that counts is larger than
 * `redMinMm2`; many small spots give yellow at most; spots normal in practice and acknowledged
 * ones never count.
 */
export interface FabricVerdict {
  fabric: FabricId;
  light: Light;
  /** The spot that decides the colour (the largest connected critical one, else the largest that counts). */
  worst: Spot | null;
  /** The size from which a critical spot makes the light red on this fabric (mm²). */
  redMinMm2: number;
}

/** Why the light is not green: one entry per kind of finding that counts, worst first. */
export interface ReasonSummary {
  type: FindingType;
  level: 'caution' | 'critical';
  /** All area of this kind that counts (mm²). */
  areaMm2: number;
  /**
   * What its fix aims at (mm²): the critical area for density and penetrations (caution stays a
   * hint), all of it for gaps and long stitches (they are never critical).
   */
  targetMm2: number;
  /** Spots of this kind that count. */
  spots: number;
  worst: Spot;
}

/** What a fix does to its target, measured on the design as it would be. */
export interface FixOutcome {
  /** Target area it clears, of all target area, and what is left (mm²): "behebt 22 von 30 mm²". */
  fixedMm2: number;
  ofMm2: number;
  leftMm2: number;
  /** Caution area that comes new (mm²); allowed when the fix is worth it. */
  newCautionMm2: number;
  /** The light afterwards on the same fabric. */
  lightAfter: Light;
  /** Objects it changes. */
  objects: number;
}

/**
 * A fix that is ready to apply: the design as it would be, measured. Applying it stores
 * `pattern` as one undo step; it holds only while the design is still `basis`.
 */
export interface ReadyFix {
  id: string;
  /** One kind of finding, or 'all' for "Alles beheben". */
  type: FindingType | 'all';
  basis: Pattern;
  pattern: Pattern;
  measurement: Measurement;
  outcome: FixOutcome;
  /** What "Korrektur zurücknehmen" needs once it is applied. */
  revert: RevertEntry[];
}

/**
 * The visible rest after the direct fix: offered as its own button with a preview, never applied
 * without a look. `visibility` is measured (0 invisible to 1 plainly visible).
 */
export interface RestProposal {
  id: string;
  type: FindingType | 'all';
  basis: Pattern;
  outcome: FixOutcome;
  visibility: number;
  /** Where the change shows, and the design before and after, for the preview. */
  preview: { box: MmBox; before: Pattern; after: Pattern };
  /** Changes by hand it would replace (objects stitched anew). */
  replacesHandEdits: number;
}

/** A computation that may still be running. */
export type Pending<T> = { state: 'pending' } | { state: 'none' } | { state: 'ready'; value: T };

/** Per kind of finding: the direct fix and the rest proposal, both checked. */
export interface TypeFixes {
  direct: Pending<ReadyFix>;
  rest: Pending<RestProposal>;
}

/** Everything the light shows for one fabric. */
export interface FabricReport {
  verdict: FabricVerdict;
  reasons: ReasonSummary[];
  /** Fixes are worked out for the fabric the design is set to; other fabrics may leave them out. */
  fixes?: Partial<Record<FindingType, TypeFixes>>;
  /** "Alles beheben": one solution for all kinds together. */
  all?: Pending<ReadyFix>;
}

/** The engine's output for one version of a design. */
export interface AmpelReport {
  /** The version it was worked out for. */
  basis: Pattern;
  /** The fabric the design is set to. */
  fabric: FabricId;
  fabrics: Record<FabricId, FabricReport>;
}

/**
 * Per applied fix: what "Korrektur zurücknehmen" puts back, object by object, also after later
 * changes. The new engine stores this in the design's version (robustness rule 3), not on the side.
 */
export interface RevertEntry {
  /** The object as it was identified before the fix. */
  objectKey: string;
  /** Settings changed, with their values before and after. */
  settings: { field: string; from: number | boolean | string; to: number | boolean | string }[];
  /** Left out what lies on top. */
  knockout?: boolean;
  /** The object's stitches before (files from elsewhere: put back bit for bit). */
  stitchesBefore?: Pick<Pattern, 'x' | 'y' | 'cmd'>;
}

/** A fix as applied, kept for "Korrektur zurücknehmen". */
export interface AppliedFix {
  id: string;
  type: FindingType | 'all';
  at: number;
  /** The version before and after it. */
  before: Pattern;
  after: Pattern;
  revert: RevertEntry[];
}

/** What a replaceable engine offers the light. */
export interface AmpelEngine {
  /** The report for the active design, or null without one; cheap, call it on every draw. */
  report(): AmpelReport | null;
  /** Called when a report changes (fixes ready, design changed). */
  onChange(cb: () => void): void;
  /** Applies a ready fix as one undo step; null when it no longer fits the design. */
  apply(fix: ReadyFix): AppliedFix | null;
  /** Fixes applied in this session, newest last. */
  applied(): readonly AppliedFix[];
  /**
   * Whether the search for fixes waits to be asked for (on a phone and for large designs).
   * Otherwise it starts by itself once the design has been still for a moment, worst kind first.
   */
  onRequest(): boolean;
  /** Starts the search for fixes of the current version, when it waits to be asked for. */
  search(): void;
}
