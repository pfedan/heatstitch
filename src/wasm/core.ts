import init, { initSync } from './pkg/heatstitch_core';
import * as exports from './pkg/heatstitch_core';
import { withProgress, type Progress } from './progress';

/**
 * The compute core in Rust (core/), built to WebAssembly by `npm run wasm` into src/wasm/pkg.
 *
 * Its functions are synchronous like the TypeScript they replace, so the module has to be there
 * before the first call: the app and each worker await `loadCore()` once at their start (a small
 * download, cached offline with the app). In Node (tests, tools) `core()` instantiates it on first
 * use from the file, so no test has to think of it.
 */
export type Core = typeof exports;

let ready = false;
let loading: Promise<void> | undefined;
let generation = 0;

const WASM = new URL('./pkg/heatstitch_core_bg.wasm', import.meta.url);

/**
 * A call that traps (memory exhausted, a panic: the core cannot unwind) leaves the instance broken
 * mid-call, and every later call would fail too. The call still fails, with its error, but the next
 * one runs on a fresh instance (resetCore), so only that one operation is lost. What the core was
 * handed before (fonts, see coreGeneration) is gone with the old instance.
 */
const guard =
  <A extends unknown[], R>(f: (...a: A) => R) =>
  (...a: A): R => {
    try {
      return f(...a);
    } catch (e) {
      if (e instanceof WebAssembly.RuntimeError) {
        generation++;
        exports.resetCore();
        // The fresh instance comes with the next call, but a call with arguments copies them into
        // the old one first: a call without any brings it now.
        exports.memoryBytes();
      }
      throw e;
    }
  };

const guarded = Object.fromEntries(
  Object.entries(exports).map(([k, v]) => [k, typeof v === 'function' && /^[a-z]/.test(k) && k !== 'initSync' && k !== 'default' ? guard(v as (...a: unknown[]) => unknown) : v]),
) as Core;

/** Counts the fresh starts after a trap: what the core was handed before (fonts) is gone with them. */
export const coreGeneration = (): number => generation;

/** Bytes of WebAssembly memory the core holds (it only grows), 0 before it is loaded. */
export const coreMemoryBytes = (): number => (ready ? exports.memoryBytes() : 0);

/**
 * Loads the core once. The app passes onProgress for its splash (src/ui/boot.ts); the download still
 * compiles while it streams in. The built page asks for the file early (vite.config.ts, corePreload),
 * so by now some of it may be there already.
 */
export function loadCore(onProgress?: Progress): Promise<void> {
  loading ??= init({
    module_or_path: onProgress ? fetch(WASM).then((res) => withProgress(res, import.meta.env.CORE_BYTES ?? 0, onProgress)) : WASM,
  }).then(() => {
    ready = true;
  });
  return loading;
}

export function core(): Core {
  if (!ready) {
    const fs = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule?.('node:fs') as
      | { readFileSync(url: URL): Uint8Array }
      | undefined;
    if (!fs) throw new Error('The compute core is not loaded yet: await loadCore() first');
    initSync({ module: fs.readFileSync(WASM) });
    ready = true;
  }
  return guarded;
}
