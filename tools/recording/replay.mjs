// Plays a recorded session back in a fresh browser, as fast as the app allows, and says where the
// design parts from what was recorded. Takes the saved project (it writes the script first, see
// ablauf.mjs) or a script made from one.
//
//   node tools/recording/replay.mjs projekt.heatstitch [OUT_DIR] [--headed] [--slow]
//   node tools/recording/replay.mjs OUT_DIR/ablauf.mjs [--headed] [--slow]
//
// Needs the app served (npm run build && npm run preview), APP_URL to point elsewhere. Writes
// end.png (and differs.png at the first difference) next to the script. Exit code 1 when the
// design differed somewhere: a fixed bug's recording then serves as its test.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRecording, writeAblauf } from './ablauf.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [input, outArg] = args.filter((a) => !a.startsWith('--'));
if (!input) {
  console.error('node tools/recording/replay.mjs projekt.heatstitch|ablauf.mjs [OUT_DIR] [--headed] [--slow]');
  process.exit(2);
}
const APP_URL = process.env.APP_URL || 'http://localhost:4173/heatstitch/';
const STORAGE_NS = process.env.STORAGE_NS || 'heatstitch';
// --slow keeps the recorded pauses and pointer paths, to watch along with --headed.
const slow = flags.has('--slow');

let script = path.resolve(input);
if (input.endsWith('.heatstitch')) {
  const outDir = path.resolve(outArg ?? fs.mkdtempSync(path.join(os.tmpdir(), 'heatstitch-replay-')));
  const r = writeAblauf(readRecording(input), outDir, path.basename(input));
  script = path.join(outDir, 'ablauf.mjs');
  console.log(`${script}: ${r.steps} Schritte in ${r.scenes} Szenen`);
}
const outDir = path.dirname(script);
const ablauf = (await import(pathToFileURL(script).href)).default;

const pw = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await pw.chromium.launch({ headless: !flags.has('--headed') });
const context = await browser.newContext({ viewport: ablauf.viewport ?? { width: 1440, height: 900 }, locale: ablauf.locale ?? 'de-DE', acceptDownloads: true });
await context.addInitScript(
  ({ storage, ns }) => {
    // Only on the first load: a reload in the session keeps what the app wrote since.
    if (sessionStorage.getItem('replay.storage')) return;
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(`${ns}.${k}`, v);
    sessionStorage.setItem('replay.storage', '1');
  },
  { storage: ablauf.storage ?? {}, ns: STORAGE_NS },
);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(APP_URL);
await page.waitForFunction(() => !!window.heatstitch?.state);

const differs = [];
let where = 'Start';
const pointer = { x: 0, y: 0 };
const s = {
  page,
  wait: (sec) => page.waitForTimeout(slow ? sec * 1000 : Math.min(sec * 1000, 50)),
  move: async (target, sec = 0.5) => {
    const [x, y] = Array.isArray(target) ? target : await boxCenter(target);
    await page.mouse.move(x, y, { steps: slow ? Math.max(1, Math.round(sec * 30)) : 2 });
    Object.assign(pointer, { x, y });
  },
  click: async (target) => {
    if (target) await s.move(target);
    await page.mouse.down();
    await page.mouse.up();
    await s.wait(0.3);
  },
  drag: async (points, { hold = [] } = {}) => {
    await s.move(points[0]);
    for (const k of hold) await page.keyboard.down(k);
    await page.mouse.down();
    // HTML drag and drop needs moves in between to start.
    for (const p of points.slice(1)) await page.mouse.move(p[0], p[1], { steps: 8 });
    await page.mouse.up();
    for (const k of hold) await page.keyboard.up(k);
    await s.wait(0.3);
  },
  type: (text) => page.keyboard.type(text, { delay: slow ? 80 : 0 }),
  press: async (key) => {
    await page.keyboard.press(key);
    await s.wait(0.3);
  },
  keyCap: () => {},
  label: async () => {},
  unlabel: () => {},
  zoom: async () => {},
  zoomOut: () => {},
  report: async (msg) => {
    differs.push(msg);
    console.log(`  ✗ ${msg}`);
    if (differs.length === 1) await page.screenshot({ path: path.join(outDir, 'differs.png') });
  },
};
const boxCenter = async (target) => {
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  const b = await loc.boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
};

let failed = null;
try {
  if (ablauf.prepare) await ablauf.prepare(s);
  for (const [i, scene] of ablauf.scenes.entries()) {
    where = `Szene ${i + 1}`;
    console.log(where);
    await scene.run(s);
  }
} catch (e) {
  failed = `${where}: ${e.message.split('\n')[0]}`;
}
await page.screenshot({ path: path.join(outDir, 'end.png') });
await browser.close();

for (const e of errors) console.log(`  Fehler in der Seite: ${e}`);
if (failed) console.log(`Abgebrochen in ${failed}`);
console.log(differs.length ? `${differs.length} Abweichung(en), erste: differs.png` : failed ? '' : 'Wie aufgezeichnet.');
console.log(`Bild am Ende: ${path.join(outDir, 'end.png')}`);
process.exit(failed || differs.length ? 1 : 0);
