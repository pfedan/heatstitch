import type { ColorBlock, Markers, Transition, CarriedJumps } from '../model/sequence';
import type { Lettering } from '../lettering/layout';
import type { SewObject } from '../model/objects';
import type { Pattern } from '../model/pattern';
import type { FocusStitches } from '../render/scene';

/** Everything the Ablauf mode derives from one pattern, computed once per version. */
export interface Sequence {
  blocks: ColorBlock[];
  kinds: Uint8Array;
  markers: Markers;
  transitions: Transition[];
  numbers: Uint32Array;
  total: number;
  colors: Partial<Record<string, Uint8Array>>;
  /** Trims and color changes up to each stitch number, for the time estimate. */
  trimsAt: number[];
  colorsAt: number[];
  /** Jumps without a trim, built the first time they are drawn as thread. */
  carried?: CarriedJumps;
  objects: SewObject[];
  /** Objects each object lies on (built when first needed). */
  over?: number[][];
  /** Object of each record (-1 between objects). */
  objectAt: Int32Array;
  /** The lettering each object belongs to (built when first needed). */
  letterings?: (Lettering | undefined)[];
  /** Their names in the list, per language. */
  letteringNames?: { lang: string; names: ReadonlyMap<number, string> | undefined };
  /** Objects whose shape and stitch type are only guessed from their stitches (built when first needed). */
  guessed?: ReadonlySet<number>;
}

/** A proposal taken over only for a look: its stitches and their heatmap (once worked out). */
export interface PlanPreview {
  pattern: Pattern;
  img: HTMLCanvasElement | null;
  /** The stitches of the objects it changes, each on its own: as they are and as they would be. */
  before: FocusStitches[];
  focus: FocusStitches[];
}
