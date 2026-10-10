# heatstitch

View, edit and check embroidery files right in the browser, draw shapes and lettering, and turn
pictures into new designs. No backend, no uploads: your files never leave your machine.

**Try it: <https://heatstitch.app/>** · **Guide: [docs.html](https://heatstitch.app/docs.html)** (English and German)

![heatstitch: an embroidered cat as realistic threads, in sewing order and as a density heatmap](public/og-image.jpg)

## Design, Check, and pictures

The start page opens a file, converts a picture, starts empty or shows the examples. At the top the
app has two pages, **Design** and **Check** (keys `1` and `2`); every action is a command with a
button, a key and an entry in the command search (`Ctrl+K`).

**Design** shows how the machine works through the design and is where you edit it. Colors act as
layers (hide, highlight, recolor), stitches can be colored by thread, order, stitch type or length,
and a player steps through the design with an estimated sewing time. Each color opens to its
objects (fill with underlay, satin column, running stitch), recognized from the stitches of any
file. Objects can be reordered, moved, rotated, scaled, duplicated, mirrored, combined, cut out,
knocked out under later shapes, and sewn anew with other settings: fill pattern, spacing, angle,
underlay, border, satin width and direction, running stitch length. Their outline is editable as
curves with nodes, and single needle points can be moved. The drawing tools make new shapes, the
Text tool sets lettering in 41 embroidery fonts, and the jump list trims or untrims jumps.

![Design with the cat example, colors and objects, player and the Design card](public/guide/cat-en.jpg)

**Check** shows the heatmap, checks the design for the chosen fabric and thread, answers *Will it
stitch?* with a traffic light per fabric and fixes what it can without visible changes; the
correction behind it is described below. The **Design** card next to both pages holds hoop, material,
*Ready to stitch* (stabilizer, needle, speed), threads and figures.

![Check with a critical zone where three fills overlap](public/guide/heatmap-en.jpg)

**Convert a picture** (key `3`) turns any picture, photo or SVG into a design in three steps: it
reduces the colors to thread colors, lets you fix them with a color list and a brush, and generates
fill, satin and running stitches in the style *Flat*, *Dynamic* or *Smart* (see
[Image to embroidery](#image-to-embroidery)).

![Convert a picture with the example flower: fill, satin and running stitches over the prepared image](public/guide/image-en.jpg)

## Privacy

Embroidery files never leave your computer. heatstitch parses, checks, corrects and writes them with
JavaScript in your browser; there is no backend, no account, no analytics and no third-party script.
The site is a set of static files served by GitHub Pages, and the only requests it makes go back to
that same site (the app itself, the example files, the fonts and the check for a new version).
Loaded files and edits are kept in the browser's IndexedDB so they survive a reload, and removing a
file from the list deletes it there. After the first visit the app also works offline.

The same holds for converted pictures: they are decoded, prepared and converted in the browser
and kept in IndexedDB together with your color edits and brush strokes. The optional *Prepare the
image with AI* workflow only suggests a prompt for an AI chat of your choice; heatstitch itself never
sends the picture anywhere.

## Features

**Files and formats**

- Read and write **PES** and **PEC** (Brother), **DST** (Tajima), **JEF** (Janome), **VP3** (Pfaff,
  Husqvarna Viking) and **EXP** (Melco), with own writers (no pyembroidery); PES reads the thread
  list of versions 5 to 10 with real colors, names and catalog numbers
- **SVG** import as whole shapes with their curves, colors and size; fine lines as running stitch; a line
  drawing of touching strokes as redwork, in one go without trims
- **Project files** (`.heatstitch`) that keep everything embroidery files drop: originals and edits,
  shapes, settings, rungs, guide lines, letterings, acknowledged findings, the image, material
- **Hoop**: common sewing fields or an own size, drawn around the design, with a note when it does
  not fit (by how much, a larger hoop to pick, or turn it at the machine); PES and JEF name the hoop
- **Material per design**: fabric, thread, fabric color, checks and hoop belong to each file
- **Thread catalogs**: threads from 71 thread lines (Madeira, Isacord, Gunold, Gütermann, Mettler,
  Sulky, Robison-Anton, Marathon and more, besides the Brother palette), search by number or name,
  the nearest threads of your brand, switch a whole design to it; a printable **color list** in
  sewing order with stitches and thread length (catalog data from the Ink/Stitch palettes, GPL 3.0,
  see `public/threads/LICENSE.md`)
- **Demo project** with eight designs under *See an example*, every object editable
- **Ready to stitch**: stabilizer, topping, needle, thread, speed and hooping for the chosen fabric
  and stitch count, a printable **stitch sheet** with the design at 1:1 and the color sequence
- Several designs at once, examples, PNG export, command search (`Ctrl+K`), tooltips, phone and
  tablet layouts, installable PWA that works offline and opens
  embroidery files with "Open with"

**Viewing**

- **Realistic threads**: round, twisted threads with shading and shadows (WebGL2), the light follows
  the pointer or the tilt of a phone, a procedural **fabric texture** per material behind them
- Heatmap of thread length (mm/mm²) or needle points (1/mm²), stitch plan overlay, markers for
  jumps, trims, color changes, start and end and needle points
- Player with estimated sewing time, statistics, tooltip with density and stitch data

**Editing (Design)**

- **Objects** recognized from the stitches of any file: order by drag or *Optimize order*, move,
  rotate, scale, duplicate, mirror, delete, context menu, combine and split, cut out, don't sew or
  keep as guide, knock out under later shapes, own thread per object, **cut apart** a fill into
  parts with their own direction (one border around all parts), **contour around** the selection
  at a set distance (a patch edge as satin, a patch ground as fill)
- **Stitch settings** with live preview: fill patterns in three tabs (classic: tatami with offset,
  gradient, contour fill, spiral, as sewn, guided by drawn lines; decor: embossed motifs, waves,
  grain, rays, swirl, color fade with a second color; open: meander, maze, grid, echo, cross
  stitch), spacing, angle, stitch length, edges, expand, underlay
  (off, across, cross, inset, left out under later objects), **border** (running, triple or satin,
  offset, own thread); satin pattern or E stitch, spacing (also by width and per rung), width per
  side, fringe, short stitches in curves, split, underlay kind, **rungs** for the direction and **sections**
  with cut lines (also on a fill: each part a column of its own, order, direction and trims per part);
  running stitch length, max. deviation, triple stitch; lines as running stitch, satin or fill;
  **redwork**: a line of many paths in one go, each line out and back, no trims where they touch;
  line motifs (waves, scallops, hearts, chain) and **hand stitches** imitated by machine: stem,
  feather, Cretan and chevron stitch, each stitch sewn 1, 3 or 5 times over the same holes like
  stranded floss, whole figures per piece between corners
- **Appliqué** as one object: placement line, stop, tack-down just inside, stop, satin or E stitch
  edge, all in one thread; the fabric (felt, cotton, denim and more, in any color) shows under the
  edge in the realistic view and in the player; cutting template as SVG at 1:1
- **Shape editing**: the outline of a fill as curves with nodes, kept exactly from then on; close,
  open, join and split paths, nodes at crossings, fill inside; an opened fill or satin is sewn as a
  line and filled again once a path is closed; the border is the fill's own line, along open paths
  too, with echo, shadow and fringe
- **Single stitches**: move, insert, split and delete needle points; release an object from its shape
- **Drawing**: rectangle, ellipse, pen, freehand, sewn at once with the material's settings
- **Lettering** in 41 fonts from Ink/Stitch: height, alignment, arcs and circle, spacing, single
  letters, stays text
- **Jumps**: trim and tie, or remove trims, one jump at a time or by length

**Checking and correcting (Check)**

- Checks for the chosen fabric and thread: thread density, short-stitch clusters, perforation on
  leather, coverage and gaps, long stitches; findings as zones with a verdict, practice rules and
  acknowledgements
- **Will it stitch?**: a traffic light per fabric, *Fix* for invisible changes, visible proposals
  with before and after, *Take back correction*
- **Correction** that proposes better settings per object, previews each one before and after, and
  applies the ticked ones in one undo step; *Tune to fabric*; edits by hand; compare with original
- English / German, guide in both languages

![Realistic thread rendering of overlapping fills](public/guide/stitchplan.jpg)

## Validation

Runs automatically once a file is loaded, independent of the display settings. The measurement
(Web Worker) does not depend on the material; the classification does. It is cheap and reruns
instantly for all loaded files when you change fabric or thread.

### Material profiles

The limits apply to 40 wt on stable woven fabric and are scaled by a factor from fabric and thread
(ratio of the recommended stitch spacing to the 0.40 mm reference).

| Fabric | Factor | Recommended spacing (40 wt) | Long stitch from |
|---|---|---|---|
| Stable woven (twill, canvas, denim) | 1.0 | 0.40 to 0.45 mm | 10 mm |
| Cap, structured | 0.9 | 0.40 to 0.50 mm | 7 mm |
| Knit, fleece (piqué, jersey) | 0.85 | 0.42 to 0.50 mm | 7 mm |
| Terry, pile | 0.65 | 0.55 to 0.70 mm | 7 mm |
| Light, delicate (silk, batiste) | 0.6 | 0.60 to 0.70 mm | 8 mm |
| Leather, faux leather (+ perforation check) | 0.7 | 0.50 to 0.80 mm | 8 mm |

| Thread | 60 wt | 40 wt | 30 wt | 12 wt |
|---|---|---|---|---|
| Factor (after the Madeira spacing table) | 1.15 | 1.0 | 0.8 | 0.5 |

### Rules

| Rule | Caution | Critical |
|---|---|---|
| Thread length per area, fill | from 7.0 mm/mm² (about 3 layers) | from 9.5 mm/mm² (4 layers) |
| Thread length per area, pure satin | from 11 mm/mm² | from 12 mm/mm² |
| Short-stitch cluster | ≥ 8 stitches under 1 mm in one cell (woven, caps) | ≥ 8 (all other fabrics) |
| Perforation (leather only) | ≥ 6 penetrations within 1 mm | ≥ 9 |
| Coverage: fabric shows through | one layer looser than 1/1.15 of the widest recommended spacing | never |
| Gap between objects | fabric shows when the thread pulls the fabric together | never |
| Long stitches | from the fabric's limit (7 to 10 mm) | never |

Density values are multiplied by the profile factor. One fill layer at 0.4 mm spacing has 2.5 mm/mm²,
a satin at 0.4 mm spacing (between penetrations on the same side) 5.0 mm/mm².

- **Grid:** fixed 1 mm cells. Density is computed on 0.2 mm subcells and smoothed with σ = 0.6 mm;
  each cell gets the **peak** of its subcells. That way narrow columns (lettering, borders) are not
  averaged away with their empty surroundings; even fills read at most about 7 % above their nominal
  value.
- **Thresholds sit between typical builds**, so the grid position does not decide: two fills with
  underlay reach up to 6.4, three layers from 7.4, four layers from 9.95, a satin border over a fill
  (both with underlay) up to 9.0.
- **Satin** lies on top and only penetrates at the edges. A cell's limits are interpolated linearly
  between fill and satin values by its satin share (satin = zigzag stitches 1 to 12.1 mm, nearly
  opposite in direction).
- **Short-stitch cluster:** up to 6 short stitches right after a block starts (tie-in after a jump,
  trim, color change or design start) or right before it ends do not count. Longer chains of short
  stitches count from the seventh stitch.
- **Perforation:** for each penetration, the number of other penetrations within 1 mm (tie stitches
  excluded). A row of holes with spacing p gives 2 × ⌊1/p⌋: 4 at 0.35 to 0.5 mm, 6 at 0.33 mm, 10 at
  0.2 mm. Stacked edges and tight inner curves add up.
- **Coverage and gaps** (`src/validation/coverage.ts`, Caution only): a cell well inside stitched area
  whose single layer is clearly more open than the recommended spacing lets the fabric show through
  (gradients do not count). Rows and satin stitches pull the fabric together at their ends, on
  stretchy fabric more than on stable; where that opens fabric between two objects, it is a gap.
- **Long stitches** (Caution only): stitches over the fabric's limit can snag.
- **Zones:** connected (8-neighborhood) flagged cells form a zone; its level is that of its worst
  cell. Click (or `n` / Shift+`n`) zooms to it, hovering outlines it, `v` toggles the markings. For
  critical density zones the list shows how many percent the peak is over the limit, so close calls
  are visible.
- **Normal in practice** (`src/validation/practice.ts`): these findings stay in the list but do not
  count towards the verdict, and the correction leaves them alone. Perforation always counts.
  - *Small spot:* Caution up to 3 mm² or a single critical cell (satin ends, object joins, turning
    points, tie-off knots).
  - *Satin join:* mostly satin, compact (at most 16 mm², aspect ratio up to 2.5) and at most 30 %
    over the limit, i.e. two satin layers where columns meet or cross. Two columns stacked
    lengthwise give a long zone and remain a finding.
  - *Short stitches on stable fabric:* pure short-stitch zones on woven fabric and caps.

  *Check anyway* counts such a zone again; *Acknowledge* takes any other zone out of the verdict.
  Both are saved with the file and expire when the zone disappears or grows noticeably after an edit.
- **Tooltip:** shows the cell's check value and the limits that apply to it next to the displayed value.
- API: `measurePattern(pattern)` (profile independent) and `classify(measurement, profile)` in
  `src/validation/validate.ts`. Thresholds in `src/validation/thresholds.ts`, profiles in
  `src/validation/profiles.ts`.

![Findings list with verdict and zones](public/guide/findings-en.jpg)

## Correction (beta)

The *Correction* panel sits in the right column below the findings and works with the chosen
material and the enabled checks. It is marked beta: check the result in the compare view and do a
test stitch-out before production. Every change is an undo step (Ctrl+Z / Ctrl+Shift+Z), *Back to
the original* restores the loaded file.

The edited version is stored in the browser next to the unchanged original (IndexedDB) on every
change and restored after a page reload. The original itself is never overwritten, and *×* removes
both.

### Proposals

The correction works like a digitizer (`src/correct/plan.ts`): instead of moving stitches it looks
for better **settings** of the affected objects and sews them anew from their shape, the same way
the stitch panel does by hand. The result is a list of proposals, one row per object, that the user
ticks and applies; nothing changes before that. The *goal* is "critical only" (default) or "no
warnings", *Selected zone only* limits it to one zone, and the *focus* chooses the rules that drive
it: both, thread density only, or hole density only (short stitches, perforation).

Guardrails: the stitch type, the fill pattern and the shape always stay; invisible changes come
before visible ones; the lower object is tried before the upper one; locked objects (*Exclude from
the correction*) stay as they are. Every proposal is tried on the spot and kept only if the result
in that area does not get worse. Each row says how visible the change is (invisible, barely,
visible), what it changes and which findings it helps against, and hovering it shows the object
before and after on the stage, split inside its frame.

What it proposes, in this order:

1. **Underlay**: none under small fills (under 40 mm²) and narrow satins, center walk instead of
   zigzag under narrow columns, single instead of crossed, left out where later objects cover the
   fill.
2. **Knock out** under later shapes; under a satin edge the fill still reaches in by a share of the
   edge width (a quarter to a third).
3. **Satin**: short stitches in curves, spacing by width, long stitches split (staggered).
4. **Spacing** up to the material's recommended value, never beyond; where the coverage check finds
   open fabric or gaps, a tighter spacing or an underlay.
5. **Edges** (pull compensation) a little wider where rows leave gaps at the outline; **running
   stitch** length.

Objects whose shape could not be read reliably from a foreign file are not sewn anew. For them, and
where no setting helps, the row *Fine correction on the stitches* applies the stitch-level steps:

- **Clean up** (`src/correct/shorts.ts`): stitches without movement are dropped, chains of tiny
  stitches merged as long as no point moves more than 0.3 mm.
- **Pull fills back under borders** (`src/correct/pullback.ts`): a fill reaching far under a satin
  border sewn later is cut back to the usual overlap of about 30 % of the border width.
- **Short stitches in satin curves** (`src/correct/satinShort.ts`): every other stitch on the inside
  of a tight curve ends a quarter of the column width before the edge.
- **Thin out covered rows** (thread density only, `src/correct/thin.ts`): fill rows lying entirely
  under a full later layer are removed in pairs.
- **Respace evenly** (`src/correct/respace.ts`): a fill or satin still too dense is rebuilt with
  evenly wider row or stitch spacing, never beyond the material's recommendation.
- **Separate penetrations** (`src/correct/nudge.ts`): penetrations from different layers in the same
  hole are moved apart by at most 0.3 mm (hole density focus, perforation on leather).

Tie stitches, jumps, trims and color changes stay unchanged. Zones that are normal in practice or
acknowledged are not touched; the correction only makes sure they don't get worse.

*Tune to fabric* under *Material* lists the settings that fit the chosen fabric and thread better
(spacing in the recommended range, underlay by size, long satin stitches split, pull compensation by
fabric, gap rows in fills on knit) and applies them on click; designs made in heatstitch get these rules from the start.

![Correction panel with proposals and the before/after preview](public/guide/correct-en.jpg)

### By hand

*Stitches* in the level switch (`e`) shows the stitch plan and, from about 6 px/mm zoom, the
penetrations.

- Click selects a penetration, Shift+click extends, Shift+drag selects a rectangle, Ctrl+A selects
  all. Clicking empty space clears the selection, dragging in empty space pans the view.
- Drag selected penetrations or move them with the arrow keys (0.1 mm, with Shift 0.5 mm).
- Delete / Backspace removes them; the neighbors are joined by one stitch.
- *Thin out* removes 25, 33 or 50 % of the cycles in fills and zigzags that lie mostly inside the
  selection.

In Design the same level edits the needle points of one object, which keeps its shape and
settings and counts the changes by hand (`src/model/handEdit.ts`).

### Compare

*Compare with original* (`c`, once the file has been changed) splits the view: the original on the
left, the current version on the right, each with its own heatmap, markings and stitch plan. The
divider can be dragged, zoom and pan apply to both sides, and the tooltip shows the values of the
side under the pointer. Below, stitches, thread length, critical and caution area and max density of
both versions are shown side by side.

![Compare view: original left, corrected right, with the numbers of both](public/guide/compare-en.jpg)

## Objects and shapes

Embroidery files hold stitches only. `src/model/objects.ts` recognizes the objects (fill with its
underlay, satin column, running stitch) from the stitch path, joining pieces the machine trims
between when the underlay lies under what follows or fill pieces touch with rows running on. Objects
made in heatstitch, and every object sewn anew here, remember their kind and shape, keyed by their
stitches, so a loaded file is never changed on loading and a guessed structure is never treated like
a known one.

`src/model/restitch.ts` sews an object anew from its settings. The shape comes from the stitches
once (the rows of a fill drawn thick enough to touch and closed; a satin's rails from its
penetrations; a running stitch's path) and is then kept as curves (`src/shape/path.ts`), so it does
not drift over repeated edits. The same shape engine serves the SVG import, the drawing tools, the
shape editor, combining, cutting out and knocking out (`src/model/shapeOps.ts`, `knockout.ts`), the
fill border (`border.ts`), lines sewn along their curve (`line.ts`) and the frame (`transform.ts`).
Satin direction and sections come from rungs (`src/digitize/rungs.ts`), fill rows from guide lines
(`src/digitize/flow.ts`).

## Lettering

*Text* in the tool bar (key `T`) sets a lettering in one of 41 embroidery fonts
from [Ink/Stitch](https://github.com/inkstitch/embroidery-fonts). The fonts were digitized as
embroidery (satin columns with their rails and rungs, running stitch, fills), not outlines, so they
sew well. A lettering stays text: its text, font, height in mm, alignment, shape (straight, arcs,
circle), spacing and thread can change at any time, and its stitches are made anew in place. Satin
is sewn anew along its rails at every height, so its density stays right. The frame moves, turns and
scales it; single letters can be moved and turned. Letterings are kept in IndexedDB and in project
files; embroidery files hold only the stitches.

The fonts are converted once by `tools/fonts/convert.mjs` (into `public/fonts/`, with each license
text) and loaded when first used. Only fonts under the SIL Open Font License, CC BY or in the public
domain are included; those under CC BY-SA, non-commercial, no-derivatives or GPL terms are left out.
No Ink/Stitch code is used, only the fonts' data.

## Image to embroidery

*Convert a picture* (key `3`) turns a picture into a design in three steps, the computing in two, both in a Web Worker
(`src/digitize/worker.ts`). Every change starts a new run; whatever changes during a run is computed
afterwards with the latest settings. The picture, color edits and brush strokes stay in the browser
(IndexedDB, `src/storage/imageStore.ts`). The stage shows the *Original*, the *Prepared* image or the
*Stitches*.

The methods were chosen after research into papers, vendor manuals and the source of open-source
digitizers. Ink/Stitch and PEmbroider are GPL; only their methods were re-implemented, no code was
copied.

### Preparation (`src/image/`)

1. **Working resolution:** 0.1 mm per pixel (coarser for designs over 120 mm, at most about 1200
   pixels), area averaging when shrinking, transparency kept.
2. **Simplify** (photos only, detected on load: if the 16 most frequent colors cover less than 85 %
   of the pixels, it is a photo): bilateral filter in CIELAB (Tomasi & Manduchi 1998), separated into
   rows and columns and iterated as in Winnemöller et al. 2006. Areas become flat, edges stay.
3. **Color reduction:** weighted k-means on a Lab histogram, which does best at small color counts
   (Celebi, *Improving the performance of k-means for color quantization*, 2011) and keeps small,
   distinct areas such as eyes, where median cut and Wu lose them. A pixel weighs more the more it
   stands out from its surroundings and the more saturated it is. Nearly equal colors (CIEDE2000 under
   6) are merged, tiny inconspicuous ones (under 0.4 % of the area and no further than 22 from any
   other color) are dropped.
4. **Thread colors:** the nearest thread of the Brother palette by CIEDE2000 (Sharma, Wu & Dalal 2005,
   tested against their reference data); colors that land on the same thread become one. The color
   list shows ≠ when no thread is close (ΔE over 10).
5. **Edits by hand:** per color another thread, merge into another color, or leave out; brush strokes
   (paint, erase) are applied before and after the clean-up, so they hold.
6. **Clean-up:** 3×3 majority filter; anti-aliasing seams (at most 0.5 mm wide, color between the two
   neighbors) go to the neighbors; the background (the color of at least 60 % of the border and three
   corners) is dropped where it is connected to the border; areas under *Smallest area* merge into the
   neighbor with the longest shared border (as in Goldman's patent US 6,836,695 and in Wilcom).

**SVG** files (`src/image/svg.ts`, `src/shape/svgPath.ts`) skip the raster steps: every shape is
read with its curves and its color, hidden parts are left out when converting a picture and offered for
knocking out when the SVG is opened as a design, a size in mm, cm or inches becomes the width, and lines become running stitch
or satin by their width.

### Stitches (`src/digitize/`)

Every connected area becomes one object. Instead of tracing outlines, everything works on a signed
distance field per area (exact distance transform after Felzenszwalb & Huttenlocher 2012, slightly
smoothed). Its zero line lies halfway between pixels, so neighboring areas share the same border:
fill rows end there, satin edges are found there, underlay lies on a contour inside.

- **Kind:** the skeleton (thinning in order of distance, side branches shorter than 1.5 radii pruned)
  gives the widths. Under 1 mm (terry 1.5 mm): running stitch. Up to *Satin up to width* (7 mm), even
  in width (widest point within three standard deviations, as in Goldman's patent), long compared to
  its width and with few branches: satin. Otherwise fill. Generated satin is measured: if it reaches
  more than 2.4 times its nominal density anywhere (tight curves fan out) or leaves more than 5 % of
  the area bare (columns radiating from a center), the area is filled instead.
- **Fill (tatami):** rows on a lattice aligned to the design's origin, penetrations offset by a quarter
  of the stitch length (4 mm) as in Ink/Stitch, so neighboring areas join seamlessly. The rows are
  split into sections that can be sewn back and forth in one go (boustrophedon decomposition, Choset
  2000). Without a fixed angle, each area takes the one of 16 angles with the fewest sections
  (Goldman's patent), preferably 30° apart from touching areas. Underlay: rows turned by 90°, three
  times the spacing, 0.4 mm inside the edge. Between sections the thread travels the shortest way
  inside, under rows not sewn yet (like Ink/Stitch's underpath); where it would lie on sewn rows for
  more than 2 mm, it jumps instead. **Gap rows** on knit (jersey): where two sections meet, the one
  sewn first sews one row on into the other, under its rows, on the same lines and needle points, so
  the join does not open where the fabric stretches between them (Wilcom's segment overlap rows,
  Ink/Stitch's gap fill rows). Where a section's end meets two (the shape splits), the second join
  gets its row from the later section, on top of the first one's last row. One row keeps the density
  check quiet on knit; two would reach Caution, so stable fabric gets none, and fleece, terry, light
  and sheer fabric neither (lower limits). Not for contour fill and curved rows, which have no
  sections side by side on one lattice. The other patterns (gradient, contour fill, spiral, guided)
  are in `flow.ts` and `spiral.ts`.
- **Fill rows follow the image** (default; `src/digitize/flow.ts`, `src/image/orientation.ts`): a
  direction field from the structure tensor of the original picture (Förstner & Gülch 1987, Bigün &
  Granlund 1987; as in coherence-enhancing abstraction, Weickert 1999, and Coherent Line Drawing, Kang
  et al. 2007), weighted by coherence, i.e. how clear the direction is: fur, hair and strokes set the
  direction. An area's own outline does not count (only from 1.2 mm inside). In flat areas the
  centerline sets the direction if the shape is elongated (fully from three widths of length). If the
  direction is nearly uniform in an area, the rows are laid straight in exactly that direction;
  otherwise they curve as evenly spaced streamlines of the field (Jobard & Lefer 1997): each row
  follows the field, new rows start one spacing beside existing ones, a row ends where it comes closer
  than half a spacing to another. Rows are joined back and forth, gaps between groups are bridged as
  in the straight fill. Before sewing, the rows are measured; where they crowd (over 2.2 times the
  nominal density) or leave gaps, the straight fill is used. Research found no embroidery program that
  derives the stitch direction from the picture's own structure (some align fills to a shape's long
  axis); the research prototype of Liu et al. (Eurographics 2023) needs directions given by hand.
  *Fill direction* swaps it for straight rows or a fixed angle.
- **Satin:** the edges are measured from the centerline at right angles to the border (the "stroke
  normals" of Goldman's patent). 0.4 mm between penetrations on the same side, measured on the side
  that advances more; on the inside of curves every penetration that comes too close (under 0.25 mm)
  moves 15 % of the width inwards. Pull compensation by fabric (woven 0.2 mm, knit 0.35, terry 0.4 per
  side), stitches over 7 mm are split. A network of columns is sewn in one go: each branch out as
  underlay (center walk, zigzag from 4 mm width) and back as satin, like Ink/Stitch's auto-satin. At
  junctions the first column covers, the others reach 0.3 mm into it. In Design the same
  column model is driven by rungs (`rungs.ts`): the direction turns evenly between rungs, sections
  start the column afresh at sharp corners, and a fill can become a satin along drawn rungs.
- **Running stitch** (`run.ts`): stitches of the chosen length along a path, shortened in curves until
  none lies further off the curve than the max. deviation (0.15 mm by default), never under 1 mm.
- **Redwork** (`redwork.ts`): a line of many paths in one go. The paths become a planar graph (split
  where they cross or touch, lines up to 0.5 mm apart bridged where they are closest, the snap of
  joining paths; nodes closer than 0.5 mm along a line merged, so crossings at a shallow angle give no heap of
  short stitches). Every edge is doubled, one copy each way, so each connected part has an Euler
  circuit; the one taken is Tarry's depth-first traversal (1895), which leaves an edge back the way
  it came only after everything beyond it is sewn: the first pass lies below, the way back on top,
  over the same needle points. Parts that do not touch follow each other, the nearest next. SVG lines
  in running stitch whose paths touch are sewn this way from the start.
- **Order:** colors by area, the largest first; within a color fills before satin and lines, each time
  the nearest object. Objects sewn earlier reach 0.2 mm under later neighbors. Up to 1 mm apart a
  stitch, up to 3 mm a jump, beyond that a tie-off (0, 0.5, 1, 0.5, 0 mm along the thread), trim, jump
  and tie-in; the same at color changes.
- **Defaults** by material (`digitizeDefaults`): spacing from the profile's recommendation (woven
  40 wt: 0.40 mm between neighboring rows, as measured in the example cat), pull compensation by
  fabric (Wilcom table), gap rows on knit. Everything can be overridden in the *Stitches* panel.

The generated stitches go through the same check as loaded files. *Take over* adds them
to the open designs as a new design, where their objects keep shape and settings and can be edited,
corrected and saved. For comparison on woven fabric with 40 wt:

| Design | Stitches | Caution zones | Critical zones | Trims |
|---|---|---|---|---|
| Cat photo (80 × 107 mm, 5 colors), rows follow the image (18 of 32 fills curved) | 17,800 | 10 | 3 | 157 |
| Same photo, straight rows | 16,400 | 16 | 3 | 131 |
| Example cat (professionally digitized) | 9,200 | 15 | 2 | 89 |

The findings mostly sit where satin overlaps the edge of a fill; the correction in Check can
take them on afterwards.

### Prepare the image with AI

heatstitch has no AI built in. Below the image box, *Prepare the image with AI* suggests a workflow
instead: upload the picture to your own AI chat that can edit images, paste a ready-made prompt, load
the result here. The prompt follows the width and color count under *Preparation*: a flat graphic with
at most that many colors, no gradients or textures, nothing narrower than 1 mm in the embroidery (as a
share of the picture's width), white background. A note says that the picture goes to the AI's
provider when you do this.

### Living thread and fabric

In the realistic thread view the light follows the pointer or the tilt of a phone
(`src/render/light.ts`; on iPhones after a one-time permission). Thread shines across its fibers, so
satin columns and fill rows light up or darken by their stitch direction, like turning an embroidered
patch in your hand, and the shadows move along. On the first converted picture, the wizard switches to
the realistic view and sweeps the light once around the design; every new picture does it again
(not with the system setting to reduce motion). *✦ As sewn* on the stage shows it at any time.
*Light follows pointer and tilt* in the View menu switches it off. Behind the threads,
*Fabric* draws a procedural texture of the material (`src/render/fabricGl.ts`): woven, cap, knit,
terry, light fabric or leather, lit like the threads and in the chosen background color.

**Limits:** photos are sewn as flat areas (posterized), not shaded with variable density as in
photo-stitch methods. Wide shapes with narrow arms are filled as a whole instead of being split into
fill and satin. The color list only offers the Brother palette.

## Saving

*Save* writes the current design in the chosen format (`src/writers/`); the choice is remembered,
until then the open file's format is offered. The name field suggests the file's name, after a change
`name-corrected`; the typed name also becomes the design name in the file header. A project file is
named by the day, e.g. `2026-10-05-heatstitch-project.heatstitch`. Only stitches and colors are
saved in embroidery files: objects of the original software are lost. With a hoop chosen
(`src/model/hoop.ts`), PES writes the 100 × 100 mm hoop flag for fields up to that size, else
130 × 180 (all PES version 1 knows), and JEF the chosen Janome hoop code and edge distances.

- **DST:** a trim is written as a sequence of 3 jumps, but only if the following jump sequence is not
  already long enough. That way trims don't grow on repeated saves (unlike pyembroidery). Untrimmed
  jump sequences that would otherwise read as a trim are merged. Long stitches are split into jumps
  plus one stitch (no extra penetrations). Jumps over 36 mm need 3 or more records and read back as a
  trim; that is a property of the format. DST has no colors.
- **PES:** version 1 with a CEmbOne/CSewSeg object for design software and a PEC block with preview
  images for machines. Only jumps after a trim carry the trim flag (pyembroidery flags every jump).
  Colors keep their PEC palette slot; colors from DST get the nearest one.
- **PEC:** the same PEC block behind a `#PEC0001` signature, for older Brother machines.
- **JEF:** no trim command; Janome machines (and pyembroidery) cut before moves over 3 mm, so a TRIM is
  not written and a trim before a shorter move is lost. Stitches over 12.7 mm are split into equal
  stitches, since long jumps would read as cuts; after a cut the way is jumps. Colors go to the
  Janome palette; neighboring blocks that would get the same thread get the next nearest.
- **VP3:** no jumps; each color block starts at its first stitch, a move is a (long) stitch, a trim
  is written explicitly and at the end of every block. Colors are exact, with name, brand and
  catalog number. A block never starts at x or y exactly 0, because pyembroidery (and Ink/Stitch)
  skips such a start.
- **EXP:** two bytes per stitch, explicit trims and color changes, no colors.
- The tests (`tests/writers.test.ts`, `tests/formats.test.ts`) check read → write → read for every
  format. `tests/fixtures/pyembroidery/` holds files written by pyembroidery 1.5.1 and what it reads
  back; heatstitch's readers must agree. CI also reads every written file back with pystitch (see
  Development).

### Project files

*As project (.heatstitch)* saves the whole workspace in one file (`src/storage/project.ts`), and
dropping it on the app opens it again. It holds what embroidery files cannot:

- every loaded file as its original bytes plus the working copy (records and exact RGB thread colors),
- acknowledged and reopened findings,
- the objects' shapes, stitch settings, rungs, guide lines, borders and knock-outs, letterings as
  text, objects not sewn or kept as guides,
- the image of *Convert a picture* with its color changes and brush strokes,
- material profile, fabric color, hoop, checks, correction and order options, trim length, machine
  speed and the image preparation and stitch options.

The file is gzip-compressed JSON (`{"format": "heatstitch-project", "version": 1, ...}`); binary data
is base64 of little-endian bytes tagged with its array type. A project from a newer version is
refused with a message instead of being misread. Undo history and view settings are not saved. The
same object state is kept in IndexedDB with the file, so it survives a reload.

## Development

```sh
npm install
npm run dev       # dev server
npm test          # unit tests (Vitest)
npm run build     # typecheck + production build into dist/
npm run preview   # view the build locally: http://localhost:4173/
```

The tests generate their DST/PES fixtures synthetically (`tests/helpers/encode.ts`) and check, among
other things, that the grid sums exactly to the total thread length or stitch count.

**pystitch as oracle:** CI also writes every example in every save format and reads the files back
with pystitch (Ink/Stitch's fork of pyembroidery), an independent reader, so a writer bug that
heatstitch's own reader would mirror still shows. Locally (needs `pip install pystitch==1.0.1`;
pyembroidery works too):

```sh
ORACLE=1 npx vitest run tests/oracle.test.ts && python3 scripts/oracle.py
```

**Guide screenshots:** `public/guide/` is produced by `tools/guide-shots.mjs`, a Playwright script
that drives the built app in `vite preview`. See [CONTRIBUTING.md](CONTRIBUTING.md#guide-docshtml)
for how to run it after a UI change.

## Example files

`public/examples/` holds real embroidery files to try out, e.g. `cat-60mm.pes` (cat, 60 mm, PES v6),
and two SVGs (`svg/overlapping-circles.svg`, `svg/shapes-benchmark.svg`) that the examples
sew on opening. `image-example.svg` is the example picture of *Convert a picture* (fills, satin
widths, fine lines), loaded by *Load example image* there.

`public/examples/demos/` holds small synthetic demos for the guide, each with one finding:
`overlap.pes` (stacked fills), `letters.pes` (fill under satin, tests only), `sun.dst` (short stitches on knit),
`leather-patch.dst` (perforation on leather) and `confetti.pes` (long jumps without trims, short ones
with trims). They are built with the app's own writers from `tests/helpers/demos.ts`;
`patch.pes` is the Aufnäher of the demo project saved as PES, the guide's example for satin, sections,
single stitches and the density check;
`tests/demos.test.ts` checks that they are up to date and show the described finding. After changing
designs or writers: `UPDATE_DEMOS=1 npm test`. The guide images live in `public/guide/` and are not
precached.

## Deployment

`.github/workflows/deploy.yml` tests and builds every push. The site is served by Cloudflare at
<https://heatstitch.app/>, as the static assets of a Worker (`wrangler.jsonc`, `cloudflare/worker.js`):
every file at exactly its path, `/` and `/de/` get their `index.html`. Pushes to `main` deploy there;
every pull request gets a preview version at `https://pr-N-heatstitch.<account>.workers.dev` (linked
in a PR comment), an address of its own that never reaches heatstitch.app. Fork pull requests get theirs
from `.github/workflows/fork-preview.yml`.

The old address <https://pfedan.github.io/heatstitch/> (the `gh-pages` branch, *Settings → Pages →
Deploy from a branch*) carries the moving page from `tools/moved/`. Browsers keep stored files per
address, so it takes along what someone kept there: one click opens `public/umzug.html` on
heatstitch.app in a small window, which writes it there. Its `sw.js` replaces the old service worker,
so installed copies update too, and every old link goes to the same page at the new address.

One-time setup: the repository secrets `CLOUDFLARE_API_TOKEN` (template *Edit Cloudflare Workers*)
and `CLOUDFLARE_ACCOUNT_ID`. The first deploy creates the Worker and connects heatstitch.app.

## Format notes

- **DST** has no explicit trim. As in pyembroidery, a sequence of at least 3 jumps counts as a trim
  (`DST_TRIM_JUMP_COUNT` in `src/parsers/dst.ts`). DST also has no thread colors; color blocks get
  substitute colors.
- **PES:** colors come from the PEC palette, replaced by the thread list of the PES header for
  versions 5 to 10 (real RGB, name, brand, catalog number) like pyembroidery reads it. The hoop named
  in the header (version 5 and up) is offered, never applied on its own.
- **JEF** cuts are read where a move is longer than 3 mm, as pyembroidery does; its hoop code is
  offered like the PES hoop.
- The validation thresholds are derived from digitizing guidelines and calibrated on synthetic
  builds; a comparison with real test stitch-outs is still pending.

## Structure

```
src/main.ts      App start; wires the modules in src/app/ together
src/app/         State, pointer input, keyboard, drawing, shapes, rungs, lettering, order,
                 correction, file I/O, light
src/parsers/     DST, PES, PEC, JEF, VP3 and EXP parsers, PEC and Janome palettes
src/model/       Pattern data model, objects recognized from stitches, sewing anew (restitch),
                 shape operations, knock-out, border, lines, transform, order, jumps, hoop, project
                 edits with undo
src/shape/       Vector shapes: curves with nodes, SVG paths, rasterizing, vectorizing
src/digitize/    Stitches from shapes: distance fields, skeleton, fill, flow fill, spiral, satin and
                 rungs, running stitch, border, sequencing, Web Worker
src/image/       Image preparation: color spaces, CIEDE2000, filters, color reduction, distance
                 transform, orientation, clean-up, SVG reading
src/density/     Density grid, Gaussian blur, Web Worker
src/validation/  Measurement, profiles, thresholds, satin detection, short-stitch, perforation,
                 coverage and long-stitch rules, zones, practice rules, acknowledgements
src/correct/     Correction: proposals (plan), fine correction on stitches (pullback, satin short
                 stitches, respacing, thinning, separating penetrations)
src/writers/     DST, PES, PEC, JEF, VP3 and EXP writers (PEC block, preview images)
src/lettering/   Lettering: fonts, layout (lines, arcs, circle), sewing, placing into a design
src/render/      Viewport, color scale, heatmap, stitch plan, realistic threads and fabric (WebGL),
                 light, legend, overlays (shapes, rungs, editing, validation, hoop), compare view
src/storage/     IndexedDB stores for files and the image, project files (.heatstitch)
src/shell/       App shell: commands, command search, popovers, tooltips, signals
src/areas/       The areas of the interface: files and start page, design card, objects, shapes and
                 tools, stitches, lettering, check, traffic light, ready to stitch, image wizard,
                 responsive layouts
src/ui/          Panels used by the areas: layers, object and stitch panel, hoop, export, player,
                 validation, correction, editor, image steps, thread picker, tools
src/i18n/        Translations EN/DE
public/examples/ Example embroidery files and SVGs (loadable from the dropdown), guide demos
public/guide/    Screenshots for the guide (tools/guide-shots.mjs)
public/fonts/    Embroidery fonts from Ink/Stitch with their licenses (tools/fonts/convert.mjs)
docs.html        Guide EN/DE (src/docs.ts, src/docs.css)
public/og-image.jpg, robots.txt, sitemap.xml  Social media preview image, crawlers
```

## Contributing

Bug reports, example files and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for
setup, tests, pull request previews and the English/German conventions.

## License

[MIT](LICENSE) © Daniel Pfeffer
