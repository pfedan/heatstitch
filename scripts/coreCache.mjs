// The built core (src/wasm/pkg) kept in R2 per state of the core, so a cloud session takes it in a
// second instead of compiling it for minutes. The key is a hash of everything the module is built
// from as committed (core/, rust-toolchain.toml, the pinned wasm-pack, the wasm script), so a commit
// that leaves core/ alone finds the module of the one before. Only CI uploads (`node
// scripts/coreCache.mjs upload`, after the wasm job), always the release core; scripts/wasm.mjs reads.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PKG = 'src/wasm/pkg';
const STAMP = `${PKG}/.cache-key`;
const SOURCES = ['core', 'rust-toolchain.toml', '.github/actions/core/action.yml'];

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** The key of the committed core, or null when the work tree differs from it (or is no git checkout). */
export function cacheKey() {
  try {
    if (git('status', '--porcelain', '--', ...SOURCES).trim()) return null;
    const files = git('ls-files', '-s', '--', ...SOURCES);
    const script = JSON.parse(readFileSync('package.json', 'utf8')).scripts.wasm;
    return createHash('sha256').update(files).update(script).digest('hex').slice(0, 32);
  } catch {
    return null;
  }
}

/** True when src/wasm/pkg holds the module of this key, taken from the cache before. */
export const inPlace = (key) => existsSync(STAMP) && readFileSync(STAMP, 'utf8') === key;

/** Forgets that src/wasm/pkg came from the cache, before it is built here. */
export const forget = () => rmSync(STAMP, { force: true });

/** Fetches the module of this key from the public bucket into src/wasm/pkg; false when it is not there. */
export function fetchCore(key, base = process.env.R2_PUBLIC_URL) {
  if (!base) return false;
  const tmp = join(tmpdir(), `heatstitch-core-${key}.tar.gz`);
  try {
    // curl, since it goes through the proxy the environment sets (Node's fetch does not by itself).
    execFileSync('curl', ['-fsS', '--max-time', '60', '-o', tmp, `${base.replace(/\/$/, '')}/${objectName(key)}`], { stdio: 'ignore' });
  } catch {
    rmSync(tmp, { force: true });
    return false;
  }
  try {
    rmSync(PKG, { recursive: true, force: true });
    mkdirSync(PKG, { recursive: true });
    execFileSync('tar', ['xzf', tmp, '-C', PKG]);
    if (!existsSync(`${PKG}/heatstitch_core_bg.wasm`)) throw new Error('no module in the archive');
    writeFileSync(STAMP, key);
    return true;
  } catch {
    rmSync(PKG, { recursive: true, force: true });
    return false;
  } finally {
    rmSync(tmp, { force: true });
  }
}

const objectName = (key) => `core-cache/${key}.tar.gz`;

/** CI: uploads src/wasm/pkg (the release core) under its key, unless it is there already. */
function upload() {
  const { R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    console.log('No R2 access configured, the core is not uploaded.');
    return;
  }
  const key = cacheKey();
  if (!key) throw new Error('core/ differs from the commit, its module has no key.');
  if (!existsSync(`${PKG}/heatstitch_core_bg.wasm`)) throw new Error(`${PKG} holds no built core.`);
  const url = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${objectName(key)}`;
  const auth = ['--aws-sigv4', 'aws:amz:auto:s3', '--user', `${R2_ACCESS_KEY_ID}:${R2_SECRET_ACCESS_KEY}`];
  const sha = ['-H', 'x-amz-content-sha256: UNSIGNED-PAYLOAD'];
  const status = execFileSync('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '-I', ...sha, ...auth, url], { encoding: 'utf8' });
  if (status === '200') {
    console.log(`The core ${key} is in the cache already.`);
    return;
  }
  const tmp = join(tmpdir(), `heatstitch-core-${key}.tar.gz`);
  const files = ['heatstitch_core.js', 'heatstitch_core.d.ts', 'heatstitch_core_bg.wasm', 'heatstitch_core_bg.wasm.d.ts'];
  execFileSync('tar', ['czf', tmp, '-C', PKG, ...files.filter((f) => existsSync(`${PKG}/${f}`))]);
  execFileSync('curl', ['-fsS', '-o', '/dev/null', ...sha, ...auth, '-H', 'Content-Type: application/gzip', '-T', tmp, url]);
  rmSync(tmp, { force: true });
  console.log(`Uploaded the core ${key} to the cache.`);
}

if (process.argv[1]?.endsWith('coreCache.mjs') && process.argv[2] === 'upload') upload();
