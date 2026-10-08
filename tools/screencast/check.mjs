// Checks that this machine can make a screencast: Node, ffmpeg, Python with Pillow, the Inter
// font, Playwright with its Chromium, the Replicate token and the served app. Prints one line
// per item and exits with 1 if anything is missing.
//
//   node tools/screencast/check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP_URL = process.env.APP_URL || 'http://localhost:4173/heatstitch/';
let failed = false;

const report = (ok, name, detail, hint) => {
  console.log(`${ok ? 'ok  ' : 'FEHLT'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) {
    failed = true;
    if (hint) console.log(`      ${hint}`);
  }
};
const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  } catch {
    return null;
  }
};

const major = Number(process.versions.node.split('.')[0]);
report(major >= 20, 'Node', process.versions.node, 'Node 20 oder neuer installieren');

for (const tool of ['ffmpeg', 'ffprobe']) {
  const out = run(tool, ['-version']);
  report(out !== null, tool, out?.split('\n')[0], 'ffmpeg installieren und in den PATH legen');
}

const python = ['python3', 'python'].find((p) => run(p, ['--version']) !== null);
report(Boolean(python), 'Python', python && run(python, ['--version']), 'Python 3 installieren');
if (python) {
  const pil = run(python, ['-c', 'import PIL; print(PIL.__version__)']);
  report(pil !== null, 'Pillow', pil, `${python} -m pip install Pillow`);
  const fonts = run(python, [
    '-c',
    "import sys; sys.path.insert(0, 'tools/screencast'); import compose; " +
      "[compose.font(w, 10) for w in ('Regular', 'Medium', 'SemiBold', 'Bold')]",
  ]);
  report(
    fonts !== null,
    'Schrift Inter',
    '',
    'Inter von https://rsms.me/inter laden und FONT_DIR auf den Ordner mit Inter-Regular.otf setzen',
  );
}

const pwModule = [process.env.PLAYWRIGHT_MODULE, path.join(repoRoot, 'node_modules/playwright/index.mjs')].find(
  (p) => p && fs.existsSync(p),
);
report(Boolean(pwModule), 'Playwright', pwModule, 'npm install im Repo');
if (pwModule) {
  const { chromium } = await import(pathToFileURL(pwModule).href);
  const exe = chromium.executablePath();
  report(fs.existsSync(exe), 'Chromium', exe, 'npx playwright install chromium');
}

report(
  Boolean(process.env.REPLICATE_API_TOKEN),
  'REPLICATE_API_TOKEN',
  process.env.REPLICATE_API_TOKEN ? 'gesetzt' : '',
  'Token von replicate.com/account/api-tokens als Umgebungsvariable setzen',
);

let served = false;
try {
  served = (await fetch(APP_URL)).ok;
} catch {}
report(served, 'App', APP_URL, 'npm run build && npm run preview (in einem eigenen Terminal)');

process.exit(failed ? 1 : 0);
