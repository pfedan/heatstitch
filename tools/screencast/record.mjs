// Records a screencast frame by frame: the page clock stands still and moves on 1/30 s per
// frame, so every frame is sharp and the stitch player runs smoothly however slow the
// machine renders. Writes frames/*.jpg and timeline.json (cursor, clicks, labels, keys,
// zoom per frame) for compose.py, which draws the overlays and builds the video.
//
//   node tools/screencast/record.mjs docs/screencasts/01-neues-stickmuster/ablauf.mjs OUT \
//     [--audio DIR] [--scenes 1-3] [--scale 2]
//
// Needs the built app served (npm run build && npm run preview), APP_URL to point elsewhere.
// Playwright comes from PLAYWRIGHT_MODULE, the repo's own node_modules or the container's
// global install (/opt/node-tools), in that order.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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

fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });
for (const f of fs.readdirSync(path.join(outDir, 'frames'))) fs.unlinkSync(path.join(outDir, 'frames', f));

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
const page = await context.newPage();
await page.clock.install();
await page.goto(APP_URL);
// Hover hints would pop up wherever the pointer passes; a scene that wants one calls s.tips(true).
const hideTips = await page.addStyleTag({ content: '.tip { display: none !important; }' });
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
  if (dry) return new Promise((r) => setTimeout(r, 150));
  const file = path.join(outDir, 'frames', `${String(frameNo).padStart(6, '0')}.jpg`);
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
  fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(timeline));
  console.log(`scene ${n}: ${((frameNo - start) / FPS).toFixed(1)} s (speech ${speech.toFixed(1)} s)`);
}

fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(timeline));
await browser.close();
