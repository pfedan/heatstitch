// Runs before dev, build, test and typecheck: builds the compute core (npm run wasm). CI builds it once
// per run and hands it to every job with CORE_PREBUILT set; there it is only checked to be in place.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!process.env.CORE_PREBUILT) {
  execSync('npm run wasm', { stdio: 'inherit' });
} else if (!existsSync('src/wasm/pkg/heatstitch_core_bg.wasm')) {
  console.error('CORE_PREBUILT is set, but src/wasm/pkg holds no built core.');
  process.exit(1);
}
