# The compute core in Rust

heatstitch moved its compute core (stitches, shapes, checks, corrections, lettering, file formats)
from TypeScript to Rust, built to WebAssembly for the browser (`core/`). The interface (`ui`,
`areas`, `render`, `shell`, `i18n`, `app`) stayed TypeScript, and so did the state of a design:
pattern versions, what each object remembers (the `WeakMap`s in `model/objects.ts`) and undo. Rust
gets plain data in and gives plain data out. How the parts fit together now is described in
[ARCHITECTURE.md](../ARCHITECTURE.md#the-compute-core-core).

Why: geometry and search are most of the code, and Rust gives them a type system that holds the
invariants at compile time, real libraries for curves and polygons instead of paper.js and Clipper
loaded per worker, and one core that a native build could use later. The stitches did not have to
stay identical to the TypeScript ones; they had to be at least as good, judged by the tests and by
realistic pictures.

## How it was done

Each stage was its own pull request into a collecting branch, which went to `develop` as one pull
request. While a module existed twice, a Vitest test ran the old TypeScript (copied into the tests)
and the Rust on the same inputs and compared them: equal where the algorithm was the same, within a
stated tolerance where Rust used a different library. For that, `core/src/js.rs` does arithmetic as
JavaScript does (`Math.hypot`, `Math.round`) and `core/src/trig.rs` has `Math.sin`, `cos` and `pow`
bit for bit as V8 computes them. Where a test had pinned a number only the old code gave, it was
changed to the property it checks.

When all stages were in, the copies and the comparison tests went (stage 6a). What stays as a
regression test is `tests/sewHashes.test.ts`: the example designs sewn anew give the stitches
recorded with the TypeScript (`tests/fixtures/sew-hashes.json`). They are computed by the core
alone, with its own trigonometry, so they are the same on every platform. `js.rs` and `trig.rs`
stay because changing them moves stitches; a change that does so on purpose records the hashes
anew.

## Stages

The order followed the imports: a module moved after everything it used.

| Stage | What moved | Status |
|---|---|---|
| 0 | Crate, build, loading in app and workers, CI; the distance transform (`image/edt`) | done |
| 1a | Pixel work: `image/color`, `raster`, `filters`, `quantize`, `labels`, `orientation`, `threadMatch`, `crop`, `prepare` | done |
| 1b | Triangulation and medial axis: `shape/cdt`, `digitize/medial`, `satinInner` | done |
| 1c | Regions and centerlines: `digitize/region`, `skeleton`, `run`, `measure` | done |
| 1d | File formats: `parsers`, `writers` | done |
| 1e | Checks: `validation`, `density` | done |
| 2 | Shapes: `shape/path`, `svgPath`, `simplify`, `vectorize`, `rasterize`, `parts`, `band`, and `ops` on `linesweeper` and `clipper2-rust` instead of paper.js and Clipper | done |
| 3a | Fills: `fill`, `tour`, `border`, `deco`, `flow`, `rings`, `spiral`, `echo`, `motif`, `redwork` | done |
| 3b | Satin: `satin`, `rungs`, `satinForms`, `satinShapes`, `satinJoins` | done |
| 3c | The image assistant: `digitize/digitize`, `smart` (the browser still reads SVG: it draws the regions and text the assistant needs) | done |
| 4a to 4c | Sewing in the model: `sewOne` and what it calls (`along`, `line`, `travel`, `knockout`, `covers`, `jumps`, `order`, `bestOrder`, `satinEase`, `satinSuggest`), one call per object | done |
| 5a, 5b | Correction engine (`correct`), lettering | done |
| 6a | The TypeScript copies, the comparison tests, the twins nothing calls and the unused exports go; paper.js and Clipper2 leave the dependencies | done |
| 6b | Inside the crate: one CIEDE2000, one set of stitch kinds, one trigonometry | its own pull request |
