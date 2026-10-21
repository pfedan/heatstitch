// Runs before dev, build, test and typecheck: builds the compute core. `npm run build` gets the
// release core (npm run wasm); dev, test and typecheck the fast one (npm run wasm:fast), which runs
// just as fast but is rebuilt in seconds. CI builds the release core once per run and hands it to
// every job with CORE_PREBUILT set; there it is only checked to be in place.
// A cloud session (CLAUDE_CODE_REMOTE, or CORE_CACHE=1 anywhere else; CORE_CACHE=0 turns it off)
// first takes the release core CI built for the same core/ from R2 (scripts/coreCache.mjs), and only
// builds it itself when core/ has changes of its own or CI has not built that state yet.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cacheKey, fetchCore, forget, inPlace } from './coreCache.mjs';

const cache = process.env.CORE_CACHE === '1' || (!!process.env.CLAUDE_CODE_REMOTE && process.env.CORE_CACHE !== '0');

if (process.env.CORE_PREBUILT) {
  if (!existsSync('src/wasm/pkg/heatstitch_core_bg.wasm')) {
    console.error('CORE_PREBUILT is set, but src/wasm/pkg holds no built core.');
    process.exit(1);
  }
} else {
  const key = cache ? cacheKey() : null;
  if (key && (inPlace(key) || fetchCore(key))) {
    console.log(`The core comes from the cache (${key}).`);
  } else {
    forget();
    execSync(process.env.npm_lifecycle_event === 'prebuild' ? 'npm run wasm' : 'npm run wasm:fast', { stdio: 'inherit' });
  }
}
