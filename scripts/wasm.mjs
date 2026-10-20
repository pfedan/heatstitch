// Runs before dev, build, test and typecheck: builds the compute core. `npm run build` gets the
// release core (npm run wasm); dev, test and typecheck the fast one (npm run wasm:fast), which runs
// just as fast but is rebuilt in seconds. CI builds the release core once per run and hands it to
// every job with CORE_PREBUILT set; there it is only checked to be in place.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!process.env.CORE_PREBUILT) {
  execSync(process.env.npm_lifecycle_event === 'prebuild' ? 'npm run wasm' : 'npm run wasm:fast', { stdio: 'inherit' });
} else if (!existsSync('src/wasm/pkg/heatstitch_core_bg.wasm')) {
  console.error('CORE_PREBUILT is set, but src/wasm/pkg holds no built core.');
  process.exit(1);
}
