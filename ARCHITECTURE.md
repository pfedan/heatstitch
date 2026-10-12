# Architecture

This is a map of the heatstitch codebase for contributors: what lives where, how data moves from a
file to the screen and back, and which rules hold the parts together. For setup, tests and
conventions see [CONTRIBUTING.md](CONTRIBUTING.md); for what the app does see the
[README](README.md).

## The big picture

heatstitch is a static web app. There is no backend: everything (reading files, sewing new
stitches, checking, correcting, writing files) runs as TypeScript in the browser. There is no UI
framework either; the interface is plain DOM and canvas, built by small modules.

```
  picture ----------> image ----+
  SVG --------------> shape ----+--> digitize --+
                                                |
  embroidery file --> parsers ------------------+
                                                v
                  edits (model) <-------> Pattern versions + objects
                        ^                       |
                        |                       +--> render -------------> canvas
     ui / areas / shell +                       +--> density, validation, correct
                                                +--> writers, storage ---> DST, PES, ..., .heatstitch
```

The code falls into three layers:

| Layer | Directories | Rule |
|---|---|---|
| **Core** (pure logic) | `model`, `shape`, `digitize`, `image`, `parsers`, `writers`, `validation`, `correct`, `density`, `lettering`, `material`, `threads`, `library`, `resew` | No DOM, no UI imports. Runs in Node (tests) and in Web Workers. |
| **Presentation** | `render`, `ui`, `areas`, `shell`, `i18n` | Draws the canvas, builds panels, registers commands. |
| **Wiring** | `main.ts`, `app/`, `settings.ts`, `storage/` | Holds app state, connects input, core and presentation. |

Core modules never import from `ui`, `areas`, `app`, `render` or `shell`. Keep it that way: it is
what lets the torture test and the workers use the same code as the app.

## Repository layout

```
src/            The app (see below)
tests/          Vitest tests, synthetic fixtures (tests/helpers), the torture test, benchmarks
public/         Static files: examples, fonts, motif library, thread catalogs, guide pictures, tips
tools/          Node scripts that produce files in public/ or docs/ (fonts, motifs, threads,
                guide shots, tooltip pictures, screencasts, recordings, icons, moving page)
scripts/        Test helpers outside Vitest (pystitch oracle, test timings)
docs/           Terms (terms.md), session recording, screencast scripts, screenshots
design-system/  The UI design system (MASTER.md) and interface concept
cloudflare/     The Worker that serves the site and the page of closed PR previews
index.html, docs.html, videos.html, video.html
                The app, the guide, the video page and the per-video template
```

## The data model (`src/model/`)

### Pattern: records and versions

Everything starts at `Pattern` in `src/model/pattern.ts`: the stitches of a design as flat typed
arrays, one entry per record.

- `x`, `y` (`Int32Array`): absolute coordinates in 0.1 mm, y pointing down.
- `cmd` (`Uint8Array`): `STITCH`, `JUMP`, `TRIM`, `COLOR_CHANGE`, `END`.
- `colors`: one thread per color block.

This is close to what the machine formats store, so every parser produces it and every writer
consumes it. Screen and shape code works in millimetres (`records / 10`).

**Patterns are immutable.** An edit never changes a pattern in place; it makes a new *version*
with `nextVersion(p, changes)` (or `withRecords`). Each version remembers its parent (`parentOf`).
Undo and redo are simply lists of earlier and undone versions per file (`src/ui/fileList.ts`),
trimmed by count and memory (`trimUndo`). Because everything a version knows is attached to the
version itself, undo restores all of it at once or nothing.

### Objects

A design is a sequence of **objects** (a fill, a satin column, a running stitch line, ...). The
object list of each version lives in a `WeakMap` keyed by the pattern (`src/model/objects.ts`,
`Table` and `Entry`). Every object has a fixed `id` that survives every edit, the record range
it is sewn in, and optionally a memory (`Remembered`).

`sewObjects(p)` returns the objects of a version in sewing order. A new version takes the objects
over from its parent; only stitches that are new and that nobody described are recognized from the
stitches themselves, as for a file from other software (digitizers trim between objects, so the
stitches between two trims are a section of one object).

### What an object knows: known and guessed

`Remembered` (`src/model/restitch.ts`) is what an object knows about itself: its form (`geo`, a
vector `Form` from `src/shape/path.ts`), its stitch type and settings (`fill`, `satin`, `line`,
...), its links to other objects (border, blend, knockout, lettering, appliqué) and what it was set
to before.

The model keeps **known** and **guessed** structure apart:

- *Known*: the object was drawn, imported from SVG, made by the image assistant or lettering, or
  its form was edited. `geo` is the single source of its geometry; the pixel `region` used for
  filling is rastered from it, never the other way round.
- *Guessed*: the object came from an embroidery file (or was read from stitches when first
  edited by hand). Its shape is inferred from the stitches. `isGuessed(p, o)` tells which.

`src/model/original.ts` keeps the way back to the stitches an object had in the loaded file.

### Sewing anew

When settings or a form change, the object is sewn anew from what it remembers:

```
Remembered --> model/sew.ts (Spec: line, fill, satin, ...) --> digitize/* --> stitches
                                                                                 |
                      new Pattern version with the stitches put in its place <---+
```

`src/model/restitch.ts` (settings changes), `src/model/sew.ts` (sewing one object or a whole design
from its object list) and `src/model/shapeOps.ts` (duplicate, mirror, delete, cut out, recolor,
...) are the main entry points. Related objects follow their leaders in the same step: borders
(`border.ts`), knockouts under later fills (`knockout.ts`), derived areas (`derived.ts`), appliqué
(`applique.ts`), echoes and shadows (`shadow.ts`).

Other model modules: `transform.ts` and `reshape.ts` (move, rotate, scale), `order.ts` and
`bestOrder.ts` (sewing order), `jumps.ts` (trims and ties), `sequence.ts` (stitch kinds and color
blocks derived from the records alone), `hoop.ts`, `recolor.ts`, `handEdit.ts` (single needle
points), `addShape.ts`, `appendDesign.ts`.

## Shapes and digitizing

- **`src/shape/`**: vector forms. Paths of nodes with cubic curves (`path.ts`), SVG path data
  (`svgPath.ts`), boolean operations and offsets (`ops.ts`, using paper.js and Clipper2, both
  loaded on first use with `loadOps()`), rasterizing, vectorizing and simplifying.
- **`src/digitize/`**: stitch generation. Fill variants (`fill.ts`, `flow.ts`, `spiral.ts`,
  `rings.ts`, `deco.ts`, `echo.ts`), satin (`satin*.ts`, `rungs.ts`, `skeleton.ts`), running
  stitch and hand stitches (`run.ts`, `motif.ts`, `redwork.ts`), borders, and the image pipeline
  entry `digitize.ts` with the *Smart* style in `smart.ts`.
- **`src/image/`**: preparing a picture for embroidery: color spaces and CIEDE2000, filters,
  quantization, label maps, distance transforms, orientation, SVG reading (`prepare.ts` is the
  staged, cached pipeline).
- **`src/lettering/`**: fonts (converted from Ink/Stitch, see `tools/fonts/`), layout on lines,
  arcs and circles, sewing letters and placing them into a design.
- **`src/library/`**: the motif library (Twemoji sewn as designs).

Picture to design: `image/prepare.ts` reduces the picture to thread colors and regions, the
digitize worker turns regions into objects, and `model/digitized.ts` turns the result into a design
whose objects remember what they were made as.

## Reading and writing files

- **`src/parsers/`**: one module per format (DST, PES/PEC, JEF, VP3, EXP, XXX, SEW) plus thread
  palettes; `index.ts` (`parsePattern`) picks the parser by content (PES, PEC, VP3) or file name. Parsed designs are marked with
  `readFromFile`, so their objects are recognized from stitches.
- **`src/writers/`**: own writers for DST, PES/PEC, JEF, VP3, EXP and XXX (no pyembroidery).
  Round trips read, write, read must stay record-equal (`tests/writers.test.ts`), and CI checks
  the output against pystitch as an independent reader (`tests/oracle.test.ts`).
- **`src/storage/`**: `fileStore.ts` and `imageStore.ts` keep loaded files, edits and the picture
  in IndexedDB across reloads; `project.ts` encodes the `.heatstitch` project file, which holds
  everything embroidery formats drop (object memory, settings, letterings, acknowledgements,
  material). Raise its version when older versions would misread new content.
- **`src/send/`**: handing a file to the machine (download, share, USB stick, Ember Bridge).

## Checking and correcting

```
Pattern --+--> density worker --> grid --> render/heatmap.ts
          |
          +--> measure (worker, independent of the material)
                 |
                 +--> classify (main thread, per profile) --> zones, findings --> correct
```

- **`src/density/`**: the density grid (thread length or needle points per mm²) and its blur.
- **`src/validation/`**: `measure.ts` measures once per design; `validate.ts` classifies the
  measurement with a material profile (`profiles.ts`, `thresholds.ts`) cheaply on the main thread,
  so changing fabric or thread reruns instantly. Rules for short stitches, satin, coverage, zones,
  practice rules and acknowledgements live next to it.
- **`src/material/`**: fabrics, threads and the rules derived from them.
- **`src/correct/`**: the correction. `plan.ts` proposes new object settings (spacing, underlay,
  pull compensation, knockouts) and sews them anew; the fine corrections on raw stitches are in
  `pullback.ts`, `respace.ts`, `thin.ts`, `shorts.ts` and friends. `correct/engine/` is the solver
  behind *Will it stitch?* (cells, variants, a MIP solver, validation), run in workers.

## Web Workers

Heavy work runs off the main thread. Each worker has a `client.ts` next to it that wraps it in
promises; requests carry plain data (typed arrays, stored objects) that `postMessage` can clone.

| Worker | Does |
|---|---|
| `src/density/worker.ts` | density grid, validation measurement, automatic correction (two instances: density and validator) |
| `src/digitize/worker.ts` | picture to stitches for the image assistant |
| `src/resew/worker.ts` | live preview of a scaled design sewn anew while the frame is dragged |
| `src/correct/engine/worker.ts` | the traffic light report and fixes, several workers at once |

A new design (an edit) drops work still running for an older version, so the newest design never
waits behind an old one.

## Rendering (`src/render/`)

`viewport.ts` maps world millimetres to CSS pixels. `scene.ts` draws a frame from a `Scene`:
stitches (`stitches.ts`, colored by thread, order, kind or length), realistic threads and fabric
in WebGL2 (`threadsGl.ts`, `fabricGl.ts`, `light.ts`), the heatmap and legend, and overlays for
shapes, rungs, editing, validation zones, the hoop, measuring and the compare view.

## The interface

- **`src/main.ts`** starts the app: it creates the file list, workers, viewport and panels, and
  calls the `bind*` functions in `src/app/`. Each `app/` module declares what it needs from the
  rest of the app as a small interface (`SceneApp`, `DesignApp`, ...) instead of importing it.
- **`src/app/state.ts`** holds the state several parts share: selection, hover, views, what is
  being edited.
- **`src/shell/`** is the frame of the interface. Every action is a **command**
  (`shell/commands.ts`): a button, a menu entry, a key and the command search (`Ctrl+K`) all run
  the same command and are enabled by the same rule. Also popovers, tooltips and `signal.ts` for
  small reactive values.
- **`src/areas/`**: the areas of the interface (files and start page, design card, objects,
  shapes, stitches, library, check, traffic light, ready to stitch, measure, responsive layouts).
  Each registers its own commands.
- **`src/ui/`**: panels and tools the areas use: object and stitch panels, layers, player, editor,
  draw, shape, rung, frame and measure tools, thread picker, validation and correction panels,
  the image assistant (`imageMode.ts`) and `fileList.ts` (open designs, versions, undo).
- **`src/i18n/`**: all user-facing text in German (`de.ts`, defines the keys) and English
  (`en.ts`), with per-area files in `i18n/areas/`. The language switches without a reload. See
  CONTRIBUTING for the rules and `docs/terms.md` for the terms.
- **Design system**: `design-system/heatstitch/MASTER.md` (colors, type, components) and
  `konzept.md` (interface concept). `src/shell/ui.ts` and the CSS follow it.
- **`src/dev/`**: the developer console (`heatstitch` in the browser console) and the session
  recorder used to reproduce bugs and script screencasts (`docs/aufzeichnung.md`).

## Guide, videos and build

`docs.html` (guide), `videos.html` and `video.html` are separate pages with their own entry
scripts (`src/docs.ts`, `src/videosPage.ts`, `src/videoWatch.ts`). The Vite build
(`vite.config.ts`) writes every page once per language: English at the root, German under `de/`
(`src/build/langPages.ts`), plus one page per video and `sitemap.xml`. `vite-plugin-pwa` makes the
app installable and offline capable.

`.github/workflows/deploy.yml` runs the tests (sharded, plus browser tests, the pystitch oracle and
the correction benchmark), builds the site and deploys it to Cloudflare (`wrangler.jsonc`). Every
pull request gets a preview at its own address; see CONTRIBUTING.

## Tests (`tests/`)

- **Unit tests** run in Node with Vitest, on synthetic fixtures from `tests/helpers/` (encoded
  files, shapes, designs, images). Only a few tests open a real browser (`BROWSER_TESTS=1`).
- **The torture test** (`tests/helpers/torture.ts`, run by `torture*.test.ts`) plays random chains
  of the operations the app offers (add, duplicate, mirror, scale, cut out, knock out, recolor,
  border, lettering, motifs, undo, redo, save and open, export, ...) the way the app does them, and
  checks the design's invariants after every step (`checkWellFormed`, `checkObjectList`,
  `checkBorders`, `checkKnockouts`, `checkFollowers`, `checkExport`, ...). A failing chain prints
  its seed and steps, so it can be replayed and turned into a regression test in the
  "found by the torture test" block. `TORTURE_CHAINS=10000` runs a long session.
- **Demos** (`tests/demos.test.ts`): the guide's demo files are generated and must stay current.
- **Benchmarks**: `tests/korrekturBench.test.ts` and `tests/bench/` measure the correction.

## Quick reference

Entry points worth knowing by name:

| What | Where |
|---|---|
| Read a file into a design | `parsePattern(data, fileName)` in `src/parsers/index.ts` |
| Write a design to a format | `writePattern(p, format)` in `src/writers/index.ts` |
| New version from new records | `withRecords(p, x, y, cmd)` in `src/model/edit.ts`, `nextVersion(p, changes)` in `src/model/pattern.ts` |
| Objects of a version | `sewObjects(p)` in `src/model/objects.ts` |
| What an object knows, guessed or not | `remembered(p, o)`, `isGuessed(p, o)` in `src/model/restitch.ts` |
| Sew objects anew with new settings | `restitch(...)` in `src/model/restitch.ts` |
| Sew one object, or a design from its object list | `sewOne(spec, way)`, `sewDesign(p, trimMm)` in `src/model/sew.ts` |
| Add a drawn or imported shape | `addShape(p, shape, color, after, options)` in `src/model/addShape.ts` |
| Move, rotate, scale | `transformObjects(p, sel, m, trimMm)` in `src/model/reshape.ts` |
| Duplicate, mirror, delete, cut out, recolor | `src/model/shapeOps.ts` |
| Borders and knockouts follow their objects | `syncBorders(p, trimMm)` in `src/model/border.ts`, `setKnockout(...)` in `src/model/knockout.ts` |
| Project file | `encodeProject(project)`, `decodeProject(bytes)` in `src/storage/project.ts` |
| Measure and classify | `measurePattern(p)` in `src/validation/measure.ts`, `classify(m, profile, checks)` in `src/validation/validate.ts` |
| A user-facing text | `t('key', vars)` in `src/i18n/index.ts`, keys defined in `src/i18n/de.ts` |
| A command (button, key, search) | `command({...})` in `src/shell/commands.ts` |

Running only what a change touches (the full suite takes a while):

```sh
npx vitest run tests/writers.test.ts          # one file
npx vitest run -t "keeps the design"          # tests whose name matches
npx vitest run tests/torture.test.ts          # the torture chains
TORTURE_CHAINS=200 npx vitest run tests/torture.test.ts tests/tortureChains.test.ts
npm run typecheck                             # tsc only
```

Tests are named after the module or feature they cover (`border.test.ts`, `knockout`, `applique`,
`lettering`, ...): `ls tests | grep <name>` finds them. Many modules explain themselves in a doc
comment at the top or above their main export; read it before changing the module.

## Rules that keep the parts together

- **New versions, never in-place edits.** Go through `nextVersion`, so undo, the object table and
  remembered knowledge stay consistent. Undo restores everything or nothing.
- **Keep known and guessed apart.** Don't store guesses as if they were forms; `geo` is only set
  for shapes that were given.
- **Every new relationship between objects gets an invariant** in the torture test, and a feature
  is done only when it survives duplicate, mirror, knockout, undo and save/load.
- **Core stays pure.** No DOM in the core layer, so it runs in tests and workers.
- **Files stay local.** No network calls, analytics or uploads.

## Where to start

| You want to ... | Look at |
|---|---|
| support a new file format | `src/parsers/`, `src/writers/`, `tests/writers.test.ts` |
| add a fill pattern or stitch type | `src/digitize/`, settings in `src/model/restitch.ts`, UI in `src/areas/stitches/` and `src/ui/stitchPanel.ts` |
| add an object operation | `src/model/shapeOps.ts`, a command in the matching `src/areas/`, a step in `tests/helpers/torture.ts` |
| change a check or a threshold | `src/validation/`, `src/material/`, the README section *Validation* |
| change the correction | `src/correct/plan.ts`, `src/correct/engine/` |
| change how stitches look | `src/render/` |
| add a panel or a command | `src/areas/`, `src/shell/commands.ts`, texts in `src/i18n/` |
| store something new in projects | `src/storage/project.ts` and the save/open step of the torture test |
