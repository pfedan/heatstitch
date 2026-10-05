import type { AsideShape } from '../model/aside';
import type { CorrectMessage, PlanView } from '../ui/correctPanel';
import type { DensityGrid } from '../density/grid';
import type { Lettering } from '../lettering/layout';
import type { LoadedFile } from '../ui/fileList';
import type { Pattern } from '../model/pattern';
import type { Plan, Box } from '../correct/plan';
import type { PlanPreview } from './types';
import type { Highlight, StitchInfo } from '../ui/stitchPanel';
import type { RestitchResult } from '../model/restitch';
import type { Zone } from '../validation/validate';

/**
 * State several parts of the app read and change: selection, hover, the views on the stage and what
 * is being edited. One object, so the parts can live in their own modules (plans/stabilitaet.md).
 */
export const ui = {
  correctMessage: null as CorrectMessage,
  /** Comparison view: original left of the divider, current version right of it. */
  comparing: false,
  /** Divider position as a share of the stage width. */
  split: 0.5,
  splitDrag: false,
  origGrid: null as DensityGrid | null,
  /** Pattern and options `origGrid` was computed for. */
  origKey: null as { p: Pattern; opts: string } | null,
  origGridImg: null as HTMLCanvasElement | null,
  densitySeq: 0,
  grid: null as DensityGrid | null,
  gridImg: null as HTMLCanvasElement | null,
  computing: false,
  stageW: 0,
  stageH: 0,
  /** Zone hovered in the list (wins) or last jumped to; both are framed on the canvas. */
  hoverZone: null as Zone | null,
  selectedZone: null as Zone | null,
  /** Color blocks hidden or highlighted in the list (cleared for another file). */
  hiddenBlocks: new Set() as ReadonlySet<number>,
  focusBlock: null as number | null,
  selectedJump: null as number | null,
  hoverJump: null as number | null,
  /** Selected objects (by index in sewing order) and the one hovered in the list. */
  selectedObjects: new Set() as ReadonlySet<number>,
  /** Counts selections made by the user; the stitch settings are measured again for each. */
  selectionKey: 0,
  /** New stitches shown while a stitch setting is being dragged, not applied yet. */
  flowPreview: null as Pattern | null,
  hoverObject: null as number | null,
  /** Object whose penetrations are edited in the Ablauf mode (the level "Stitches"), or null. */
  editObject: null as number | null,
  /** Parts of each object, measured stitch settings per selection (cached per pattern and selection). */
  stitchCache: null as { p: Pattern; key: number; info: StitchInfo } | null,
  /** The object the rung tool works on, and the pattern its columns were read from. */
  rungObject: null as number | null,
  /** The object whose fill outline is edited (level Form), and the pattern its form was read from. */
  shapeObject: null as number | null,
  shapePattern: null as Pattern | null,
  /** Shape aside hovered in its list, shown on the canvas. */
  hoverAside: null as number | null,
  asideShown: null as AsideShape[] | null,
  /** The next file opened keeps the view (a design started by drawing stays where it was drawn). */
  keepView: false,
  /**
   * The lettering chosen (all its objects are selected), as last set: while its font is still
   * loading, ahead of its stitches. `recorded`: this edit already has its undo step; `sewn`: the
   * settings its stitches were made with.
   */
  lettering: null as { l: Lettering; f: LoadedFile; recorded: boolean; sewn: string } | null,
  /** Moving single letters (the letter level), and the letter chosen there (its place in the text). */
  letterMode: false,
  letterAt: null as number | null,
  /** A letter being dragged: its place, where the drag started (mm) and its offset then. */
  letterDrag: null as { at: number; from: [number, number]; dx: number; dy: number; moved: boolean } | null,
  /** The text field gets the focus once the card shows (a new lettering). */
  focusText: false,
  /** Proposals worked out for the active file, until they are taken over or the file changes. */
  planState: null as { file: LoadedFile; pattern: Pattern; plan: Plan; checked: Set<number>; fine: Box[]; fineOn: boolean; view: PlanView } | null,
  /** The object of the proposal under the pointer (mm), outlined on the canvas. */
  planHover: null as Box | null,
  /** The preview shown on the canvas now (the pointer is on its row, or it is held). */
  planPreview: null as PlanPreview | null,
  /** The proposals held for comparing (their name was clicked): shown while the pointer is elsewhere. */
  planPin: null as number[] | null,
  planDrag: false,
  /** The pointer is on the underlay or border settings: that part of the selected objects is shown. */
  highlight: null as Highlight | null,
  /** The restitch behind `flowPreview` (it knows where the new underlay ends). */
  previewResult: null as RestitchResult | null,
  /** The color under the pointer in the layer list: shown alone while the pointer stays. */
  hoverBlock: null as number | null,
};
