import init, { initSync } from './pkg/heatstitch_core';
import * as exports from './pkg/heatstitch_core';

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

const WASM = new URL('./pkg/heatstitch_core_bg.wasm', import.meta.url);

export function loadCore(): Promise<void> {
  loading ??= init({ module_or_path: WASM }).then(() => {
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
  return exports;
}
