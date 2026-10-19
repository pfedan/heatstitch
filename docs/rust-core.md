# The compute core in Rust

heatstitch moves its compute core (stitches, shapes, checks, file formats) from TypeScript to Rust,
built to WebAssembly for the browser. The interface (`ui`, `areas`, `render`, `shell`, `i18n`,
`app`) stays TypeScript, and so does the state of a design: pattern versions, what each object
remembers (the `WeakMap`s in `model/objects.ts`) and undo. Rust gets plain data in and gives plain
data out.

Why: geometry and search are most of the code, and Rust gives them a type system that holds the
invariants at compile time, real libraries for curves and polygons instead of paper.js and Clipper
loaded per worker, and one core that a native build could use later. The stitches do not have to
stay identical to the TypeScript ones; they have to be at least as good, judged by the tests and by
realistic pictures.

## How it fits together

```
core/                 The Rust crate heatstitch-core
  src/<area>/*.rs     Pure Rust, one module per TypeScript module it replaces, with its unit tests
  src/bind/*.rs       The WebAssembly exports (wasm-bindgen), thin: typed arrays in, typed arrays out
src/wasm/core.ts      Loads the module: loadCore() in the app and each worker, on its own in Node
src/wasm/pkg/         Built by `npm run wasm` (wasm-pack), not in git
```

- The exported functions are synchronous, like the TypeScript they replace. The app awaits
  `loadCore()` before its first computation (`main.ts`), each worker before its first message.
  Tests and tools in Node need nothing: `core()` instantiates the module from the file on first use.
- A TypeScript module that moved keeps its name and exports and calls `core()` (see
  `src/image/edt.ts`), so its callers do not change. When a whole layer has moved, its callers
  call the coarse entry point instead and the wrapper goes.
- Data crosses the boundary as typed arrays (`Uint8Array`, `Float32Array`, `Float64Array` for
  points as x, y pairs). Structured settings cross as plain objects (serde). The boundary is crossed
  per object or per design, never per point: a fine-grained export is only a step on the way.
- `npm test`, `npm run build`, `npm run dev` and `npm run typecheck` build the module first. CI does
  the same in `.github/actions/setup`, and runs `cargo fmt`, `cargo clippy` and `cargo test` on the
  crate in the `core` job.

## Testing

1. Each Rust module has unit tests of its own (`cargo test`), natively.
2. While both implementations exist, a Vitest test runs the TypeScript and the Rust version on the
   same inputs (synthetic shapes, the example designs, the torture corpus) and compares: equal where
   the algorithm is the same, within a stated tolerance where Rust uses a different library.
3. Once a module is switched over, the existing Vitest suite (the torture test, the correction
   benchmark, the pystitch oracle, the load test) runs against Rust. Where a test pinned an exact
   number that only the old implementation gives, it is changed to the property it was meant to
   check, with the reason in the pull request.
4. Stitch results that change visibly are shown as realistic renderings, before and after.

## Stages

The order follows the imports: a module moves after everything it uses. Stages in one row of the
table can run in parallel.

| Stage | What moves | TypeScript (lines) |
|---|---|---|
| 0 | Crate, build, loading in app and workers, CI; the distance transform (`image/edt`) as the first module | 75 |
| 1a | Pixel work: `image/color`, `raster`, `filters`, `quantize`, `labels`, `orientation`, `threadMatch`, `crop`, `prepare` | 1 800 |
| 1b | Triangulation and medial axis: `shape/cdt` (or the `spade` crate), `digitize/medial`, `satinInner` | 1 100 |
| 1c | Regions and centerlines: `digitize/region`, `skeleton`, `run`, `measure` | 1 000 |
| 1d | File formats: `parsers`, `writers` | 2 300 |
| 1e | Checks: `validation`, `density` | 1 600 |
| 2 | Shapes: `shape/path`, `svgPath`, `join`, `simplify`, `vectorize`, `rasterize`, `parts`, `nodeOps`, `band`, and `ops` on Rust polygon booleans and offsets instead of paper.js and Clipper | 3 300 |
| 3a | Fills: `fill`, `tour`, `border`, `deco`, `flow`, `rings`, `spiral`, `echo`, `motif`, `redwork` | 6 400 |
| 3b | Satin: `satin`, `rungs`, `satinForms`, `satinShapes`, `satinJoins`, `satinEase`, `satinSuggest` | 4 100 |
| 3c | The image assistant: `digitize/digitize`, `smart`, `image/svg` (with `usvg` for SVG) | 2 300 |
| 4 | Sewing in the model: `sewOne` and what it calls (`along`, `line`, `travel`, `knockout`, `covers`, `jumps`, `order`, `bestOrder`) behind one call per object | 7 000 |
| 5 | Correction engine, lettering, live preview (`correct`, `lettering`, `resew`) | 7 300 |
| 6 | The TypeScript twins and the fine-grained exports go; ARCHITECTURE.md describes the new layout | |

Every stage is its own pull request into the collecting branch, which goes to `develop` as one
pull request when all stages are in.
