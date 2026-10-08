// Records a screencast frame by frame: the page clock stands still and moves on 1/30 s per
// frame, so every frame is sharp and the stitch player runs smoothly however slow the
// machine renders. Writes frames/*.jpg and timeline.json (cursor, clicks, labels, keys,
// zoom per frame) for compose.py, which draws the overlays and builds the video.
//
//   node tools/screencast/record.mjs docs/screencasts/01-neues-stickmuster/ablauf.mjs OUT \
//     [--audio DIR] [--scenes 1-3] [--scale 2] [--jobs N]
//
// --jobs N (default: half the cores, at most 8) splits the scenes into N parts by length and records them side by side, each part
// in its own Chromium; a part first runs the scenes before it without frames to reach its state.
//
// With --scenes and an earlier full recording in OUT, only those scenes are recorded anew and
// put in place of the old ones; frames and timeline of all other scenes stay as they were.
//
// Needs the built app served (npm run build && npm run preview), APP_URL to point elsewhere.
// Playwright comes from PLAYWRIGHT_MODULE, the repo's own node_modules or the container's
// global install (/opt/node-tools), in that order.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const [ablaufPath, outDir] = args;
const audioDir = opt('--audio', path.join(outDir, 'ton'));
const scale = Number(opt('--scale', '2'));
const sceneRange = opt('--scenes', '');
// Parts recorded side by side: half the cores (7 on a 14 core Mac), at most 8.
const jobs = Number(opt('--jobs', String(Math.max(1, Math.min(8, Math.floor(os.availableParallelism() / 2))))));
// Scenes run without frames still give the page's workers (stitching, density) a moment per frame.
const dryMs = Number(opt('--dry-ms', '50'));
const APP_URL = process.env.APP_URL || 'http://localhost:4173/heatstitch/';
const FPS = 30;
const W = 1920;
const H = 1080;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pwModule = [
  process.env.PLAYWRIGHT_MODULE,
  path.join(repoRoot, 'node_modules/playwright/index.mjs'),
  '/opt/node-tools/node_modules/playwright/index.mjs',
].find((p) => p && fs.existsSync(p));
if (!pwModule) throw new Error('Playwright not found: run npm install, or set PLAYWRIGHT_MODULE');
const { chromium } = await import(pathToFileURL(pwModule).href);
const ablauf = (await import(pathToFileURL(path.resolve(ablaufPath)).href)).default;

const seconds = (file) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());

if (jobs > 1 && !sceneRange) {
  await recordInParts();
  process.exit(0);
}

// A scene range over an earlier recording replaces just those scenes: they go to frames-neu/
// first and are spliced in at the end.
const oldTimeline = (() => {
  const file = path.join(outDir, 'timeline.json');
  return sceneRange && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
})();
const framesDir = path.join(outDir, oldTimeline ? 'frames-neu' : 'frames');
fs.mkdirSync(framesDir, { recursive: true });
for (const f of fs.readdirSync(framesDir)) fs.unlinkSync(path.join(framesDir, f));

// Page and 2D canvas drawn by Chromium's own software renderer instead of the emulated GPU:
// two to fourteen times faster in a container, same picture. WebGL stays on SwiftShader.
const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--disable-gpu-compositing',
    '--disable-accelerated-2d-canvas',
    '--hide-scrollbars',
  ],
});
const context = await browser.newContext({
  viewport: { width: W, height: H },
  // The page itself stays at 1x: at 2x the software renderer misplaces parts of the canvas.
  // The capture below asks for `scale` instead, which renders text and lines sharp.
  deviceScaleFactor: 1,
  locale: 'de-DE',
  acceptDownloads: true,
});
// Key names as on Windows and Linux (Strg+K, Umschalt), also when recording on a Mac, so every
// video shows the same keys.
await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' }));
const page = await context.newPage();
await page.clock.install();
await page.goto(APP_URL);
// Hover hints would pop up wherever the pointer passes; a scene that wants one calls s.tips(true).
const hideTips = await page.addStyleTag({ content: '.tip { display: none !important; }' });
// The start page fades in; frame by frame that fade can stay at its first, invisible frame.
await page.addStyleTag({ content: '.start { animation: none !important; }' });
// install() alone lets the fake time flow with the real one, so a slow capture would make the
// stitch player race; paused, the page only moves on by the runFor() of each frame.
await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
await page.clock.runFor(2000);
// The DevTools capture is faster than page.screenshot at this size.
const cdp = await context.newCDPSession(page);

// What compose.py draws on top of each frame, in CSS pixels of the 1920 x 1080 page.
const state = { cursor: { x: W / 2, y: H / 2 }, label: null, key: null, zoom: null, click: null, scene: 0 };
const timeline = { fps: FPS, scale, width: W, height: H, frames: [], scenes: [] };
let frameNo = 0;
// Scenes outside --scenes still run to bring the app into the right state, without frames.
let dry = false;

const frame = async () => {
  await page.clock.runFor(1000 / FPS);
  // Workers (stitching, density) run in real time; give them a moment as the capture would.
  if (dry) return new Promise((r) => setTimeout(r, dryMs));
  const file = path.join(framesDir, `${String(frameNo).padStart(6, '0')}.jpg`);
  // `scale` 2 renders the page anew at twice the size for this capture.
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 92,
    clip: { x: 0, y: 0, width: W, height: H, scale },
  });
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  timeline.frames.push(JSON.parse(JSON.stringify(state)));
  state.click = null;
  frameNo++;
};
const framesFor = (sec) => Math.max(1, Math.round(sec * FPS));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** The centre of a locator or a point given as [x, y]. */
const pointOf = async (target) => {
  if (Array.isArray(target)) return { x: target[0], y: target[1] };
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  const b = await loc.boundingBox();
  if (!b) throw new Error(`not visible: ${target}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const boxOf = async (target) => {
  if (Array.isArray(target)) return { x: target[0], y: target[1], width: target[2] ?? 0, height: target[3] ?? 0 };
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  const b = await loc.boundingBox();
  if (!b) throw new Error(`not visible: ${target}`);
  return b;
};

const api = {
  page,
  wait: async (sec) => {
    for (let i = framesFor(sec); i > 0; i--) await frame();
  },
  /** Glides the pointer to a target; the real mouse follows, so hover effects show. */
  move: async (target, sec = 0.8) => {
    const to = await pointOf(target);
    const from = { ...state.cursor };
    const n = framesFor(sec);
    for (let i = 1; i <= n; i++) {
      const t = ease(i / n);
      state.cursor = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      await page.mouse.move(state.cursor.x, state.cursor.y);
      await frame();
    }
  },
  click: async (target, { move = 0.8, before = 0.25, after = 0.35 } = {}) => {
    if (target) await api.move(target, move);
    await api.wait(before);
    await page.mouse.down();
    await page.mouse.up();
    state.click = { ...state.cursor };
    await api.wait(after);
  },
  /** Drags along points, each leg taking `sec`; `hold` keys stay pressed meanwhile. */
  drag: async (points, { sec = 0.8, hold = [] } = {}) => {
    await api.move(points[0], 0.6);
    for (const k of hold) await page.keyboard.down(k);
    await api.wait(0.15);
    await page.mouse.down();
    state.click = { ...state.cursor };
    for (const p of points.slice(1)) await api.move(p, sec);
    await api.wait(0.15);
    await page.mouse.up();
    for (const k of hold) await page.keyboard.up(k);
  },
  type: async (text, { perChar = 0.12 } = {}) => {
    for (const ch of text) {
      await page.keyboard.type(ch);
      await api.wait(perChar);
    }
  },
  press: async (key, { label, show = 1.2 } = {}) => {
    state.key = label ?? key;
    await api.wait(0.3);
    await page.keyboard.press(key);
    await api.wait(show);
    state.key = null;
  },
  /** Shows a key cap without pressing (for keys held during a drag). */
  keyCap: (label) => {
    state.key = label;
  },
  label: async (text, target, side = 'below') => {
    state.label = { text, side, box: await boxOf(target) };
  },
  unlabel: () => {
    state.label = null;
  },
  /** Zooms the camera onto a box (CSS px) by `factor`; compose.py eases between states. */
  zoom: async (target, factor = 1.5) => {
    const b = await boxOf(target);
    state.zoom = { cx: b.x + b.width / 2, cy: b.y + b.height / 2, factor };
  },
  zoomOut: () => {
    state.zoom = null;
  },
  /** Shows or hides the hover hints (.tip), hidden from the start. */
  tips: (on) => hideTips.evaluate((el, show) => (el.disabled = show), on),
  box: boxOf,
  point: pointOf,
};

const wanted = (i) => {
  if (!sceneRange) return true;
  const [a, b] = sceneRange.split('-').map(Number);
  return i >= a && i <= (b || a);
};

for (const [i, scene] of ablauf.scenes.entries()) {
  const n = i + 1;
  const audio = path.join(audioDir, `s${String(n).padStart(2, '0')}.wav`);
  const speech = fs.existsSync(audio) ? seconds(audio) : 0;
  const last = sceneRange ? Number(sceneRange.split('-').pop()) : Infinity;
  if (n > last) break;
  dry = !wanted(n);
  if (dry) {
    await scene.run(api).catch(async (e) => {
      await page.screenshot({ path: path.join(outDir, 'error.png') });
      throw new Error(`scene ${n}: ${e.message}`);
    });
    continue;
  }
  state.scene = n;
  const start = frameNo;
  await scene.run(api);
  // Hold until the speech is over plus a breath; speech starts `lead` s into the scene.
  const lead = ablauf.lead ?? 0.4;
  const tail = ablauf.tail ?? 0.6;
  const until = start + framesFor(lead + speech + tail);
  while (frameNo < until) await frame();
  timeline.scenes.push({ n, start, end: frameNo, audio: speech ? audio : null, lead, text: scene.text });
  if (!oldTimeline) fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(timeline));
  console.log(`scene ${n}: ${((frameNo - start) / FPS).toFixed(1)} s (speech ${speech.toFixed(1)} s)`);
}

await browser.close();
if (oldTimeline) splice();
else fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(timeline));

/** Puts the newly recorded scenes in place of the same scenes of the earlier recording. */
function splice() {
  const fresh = new Map(timeline.scenes.map((sc) => [sc.n, { sc, dir: framesDir, tl: timeline }]));
  const ns = [...new Set([...oldTimeline.scenes.map((sc) => sc.n), ...fresh.keys()])].sort((a, b) => a - b);
  const oldDir = path.join(outDir, 'frames');
  const out = path.join(outDir, 'frames-zusammen');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out);
  const merged = { ...oldTimeline, frames: [], scenes: [] };
  for (const n of ns) {
    const { sc, dir, tl } = fresh.get(n) ?? { sc: oldTimeline.scenes.find((s) => s.n === n), dir: oldDir, tl: oldTimeline };
    const start = merged.frames.length;
    for (let i = sc.start; i < sc.end; i++) {
      const name = (k) => `${String(k).padStart(6, '0')}.jpg`;
      fs.renameSync(path.join(dir, name(i)), path.join(out, name(merged.frames.length)));
      merged.frames.push(tl.frames[i]);
    }
    merged.scenes.push({ ...sc, start, end: merged.frames.length });
  }
  fs.rmSync(oldDir, { recursive: true, force: true });
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.renameSync(out, oldDir);
  fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(merged));
  console.log(`replaced scene(s) ${[...fresh.keys()].join(', ')}: ${merged.frames.length} frames in all`);
}

/** Records the scenes in `jobs` parts at once and joins their frames and timelines. */
async function recordInParts() {
  const ablauf = (await import(pathToFileURL(path.resolve(ablaufPath)).href)).default;
  const n = ablauf.scenes.length;
  // Weight of a scene: its speech, which sets its length; 4 s for a scene without speech yet.
  const weight = ablauf.scenes.map((_, i) => {
    const audio = path.join(audioDir, `s${String(i + 1).padStart(2, '0')}.wav`);
    return fs.existsSync(audio) ? seconds(audio) + 1 : 4;
  });
  const total = weight.reduce((a, b) => a + b, 0);
  const parts = [];
  let from = 1;
  let sum = 0;
  for (let i = 1; i <= n; i++) {
    sum += weight[i - 1];
    const left = n - i;
    const open = jobs - parts.length - 1;
    if (i === n || (sum >= (total * (parts.length + 1)) / jobs && open > 0 && left >= open)) {
      parts.push([from, i]);
      from = i + 1;
    }
  }
  const self = fileURLToPath(import.meta.url);
  const dirs = parts.map((_, k) => path.join(outDir, `teil-${k + 1}`));
  await Promise.all(
    parts.map(([a, b], k) => {
      fs.rmSync(dirs[k], { recursive: true, force: true });
      fs.mkdirSync(dirs[k], { recursive: true });
      const child = spawn(
        process.execPath,
        [self, ablaufPath, dirs[k], '--audio', audioDir, '--scale', String(scale), '--scenes', `${a}-${b}`, '--dry-ms', String(dryMs)],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      child.stdout.on('data', (d) => process.stdout.write(d));
      return new Promise((ok, fail) => child.on('exit', (code) => (code ? fail(new Error(`part ${a}-${b} failed`)) : ok())));
    }),
  );
  const framesOut = path.join(outDir, 'frames');
  fs.rmSync(framesOut, { recursive: true, force: true });
  fs.mkdirSync(framesOut);
  let merged = null;
  const name = (k) => `${String(k).padStart(6, '0')}.jpg`;
  for (const dir of dirs) {
    const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'));
    merged ??= { ...tl, frames: [], scenes: [] };
    for (const sc of tl.scenes) {
      const start = merged.frames.length;
      for (let i = sc.start; i < sc.end; i++) {
        fs.renameSync(path.join(dir, 'frames', name(i)), path.join(framesOut, name(merged.frames.length)));
        merged.frames.push(tl.frames[i]);
      }
      merged.scenes.push({ ...sc, start, end: merged.frames.length });
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(merged));
  console.log(`${parts.length} parts (${parts.map(([a, b]) => `${a}-${b}`).join(', ')}): ${merged.frames.length} frames`);
}
