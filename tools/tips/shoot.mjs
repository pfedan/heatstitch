// Takes the small screenshots some tooltips show (data-tip-img, see src/shell/tooltip.ts) from the
// app itself: the demo project and the screencast's fly agaric, realistic threads, no marks. Each is
// a 16:10 crop of the canvas, written as public/tips/<name>.webp at twice the tooltip's 200 x 125.
// A few are short loops instead (MOVES below): the pointer glides over the design, drawn into each
// frame, and ffmpeg (libwebp_anim) joins the frames into an animated WebP.
//
//   npm run build && npm run preview      (in a second shell)
//   node tools/tips/shoot.mjs [name ...]  (all when none is named)
//
// APP_URL points elsewhere than the preview; --full also writes each whole page next to the crop
// (as <name>.full.png in the scratch folder TIPS_DEBUG) to find a new crop.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP_URL = process.env.APP_URL || 'http://localhost:4173/';
const OUT = path.join(root, 'public/tips');
const DEBUG = process.env.TIPS_DEBUG;
const PICTURE = path.join(root, 'docs/screencasts/03-vom-bild-zum-stickmuster/material/fliegenpilz.jpg');
const W = 400;
const H = 250;

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));

/** Waits until the picture mode has stitched its result. */
const stitched = () => {
  const take = document.getElementById('image-take');
  return !!take && !take.disabled && !document.getElementById('image-status')?.textContent;
};

let demo = false;

/** A design of the demo project, by its name; the project is opened the first time. */
const design = (name) => async (page) => {
  if (!demo) {
    await page.evaluate(() => document.querySelector('[data-cmd=demo]').click());
    await page.waitForFunction(() => [...document.querySelectorAll('#file-list li')].some((li) => li.textContent.includes('Handtuch')), null, { timeout: 60_000 });
    await page.waitForTimeout(3000);
    demo = true;
  }
  await page.evaluate((name) => [...document.querySelectorAll('#file-list li')].find((li) => li.textContent.includes(name)).click(), name);
  await page.waitForTimeout(3000);
};

/** The fly agaric in the picture mode with one style, taken over as a design of its own. */
const style = (value) => async (page) => {
  await page.evaluate(() => document.getElementById('image-start').click());
  await page.waitForTimeout(800);
  if (!(await page.evaluate(() => !document.getElementById('image-file').hidden))) {
    await page.setInputFiles('#image-input', PICTURE);
  }
  await page.evaluate((v) => document.querySelector(`input[name=image-style][value="${v}"]`).click(), value);
  await page.waitForTimeout(500);
  await page.waitForFunction(stitched, null, { timeout: 120_000 });
  await page.evaluate(() => document.getElementById('image-take').click());
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    document.getElementById('fit').click();
    // Natural fabric behind it, like the demo designs.
    document.querySelectorAll('#bg-swatches .bg-sw')[2].click();
  });
};

const toggle = (id, on) => (page) =>
  page.evaluate(
    ([id, on]) => {
      const el = document.getElementById(id);
      if (el.checked !== on) el.click();
    },
    [id, on],
  );

/**
 * Picks the object at (x, y) of the canvas, presses the `index`th button of `buttons` in its panel
 * and clicks the canvas beside the design again, so no selection marks show in the shot.
 */
const pressed = (x, y, buttons, index) => async (page) => {
  await page.mouse.click(x, y);
  await page.waitForFunction(([sel, i]) => document.querySelectorAll(sel).length > i, [buttons, index], { timeout: 10_000 });
  await page.evaluate(([sel, i]) => document.querySelectorAll(sel)[i].click(), [buttons, index]);
  await page.waitForTimeout(3000);
  await page.mouse.click(420, 300);
  await page.waitForTimeout(500);
};

/** The embossing motif `index` (1 to 4, see deco.ts) on the red tatami of the Musterkarte, in the live light. */
const embossed = (index) => async (page) => {
  await design('Musterkarte')(page);
  await pressed(814, 455, '.motif-row button', index)(page);
  await toggle('live-light', true)(page);
};

/** The border of the Handtuch's fill as kind `index` of off, run, satin, zigzag, e, motif. */
const bordered = (index) => async (page) => (await design('Handtuch')(page), pressed(660, 600, '.lit-border .choice-row.kinds button', index)(page));

const shapesView = (page) => page.evaluate(() => document.querySelector('#shapes-seg [data-shapes=on]').click());

/**
 * name: [how to get there, crop in CSS pixels of the 1600 x 1000 page]. The picture styles come
 * first: their designs take the material of the design open before, the plain default here.
 */
const SHOTS = {
  'style-flat': [style('flat'), [470, 420, 680, 425]],
  'style-dynamic': [style('dynamic'), [470, 420, 680, 425]],
  'style-smart': [style('smart'), [470, 420, 680, 425]],
  'view-stitches': [design('Blume'), [640, 260, 320, 200]],
  'view-shapes': [async (page) => (await design('Blume')(page), shapesView(page)), [640, 260, 320, 200]],
  light: [async (page) => (await design('Schriftzug')(page), toggle('live-light', true)(page)), [520, 590, 320, 200]],
  'motif-diamonds': [embossed(1), [754, 418, 120, 75]],
  'motif-waves': [embossed(2), [754, 418, 120, 75]],
  'motif-stars': [embossed(3), [754, 418, 120, 75]],
  'motif-hearts': [embossed(4), [754, 418, 120, 75]],
  'echo-one': [design('Linieneffekte'), [470, 136, 368, 230]],
  'echo-both': [design('Linieneffekte'), [836, 362, 320, 200]],
  shadow: [design('Linien mit Parametern'), [720, 793, 180, 112.5]],
  'border-run': [bordered(1), [572, 518, 224, 140]],
  'border-satin': [bordered(2), [572, 518, 224, 140]],
  'border-zigzag': [bordered(3), [572, 518, 224, 140]],
  'border-e': [bordered(4), [572, 518, 224, 140]],
  'border-motif': [bordered(5), [572, 518, 224, 140]],
};

/** Picks a tool of the tool rail by its command. */
const rail = (command) => (page) => page.evaluate((c) => document.querySelector(`.toolrail [data-command="${c}"]`).click(), command);

/** Takes back what a loop made, so the next shot starts from the demo design as it was. */
const undo = async (page) => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(800);
  await rail('tool.select')(page);
};

/**
 * name: [how to get there, crop, pointer path, how to leave]. The path is [x, y, seconds to glide
 * there, seconds to rest, what to do there] in page pixels: 'click', 'down' and 'up' of the mouse
 * (a glide between them drags), or a key such as 'Escape'. The real mouse follows, so hover effects
 * show. The loop starts and ends at the same spot, so it joins up without a jump.
 */
const MOVES = {
  // Auto-Hervorheben: a click picks an object, it stands out and the rest goes pale; a click beside
  // the design brings all back.
  spot: [
    design('Blume'),
    [463, 165, 704, 440],
    [
      [1060, 480, 0, 0.5],
      [910, 285, 0.7, 1.3, 'click'],
      [815, 395, 0.6, 1.3, 'click'],
      [665, 395, 0.6, 1.3, 'click'],
      [1060, 480, 0.7, 0.9, 'click'],
    ],
  ],
  // Messen: a drag along a petal, from the center to its tip; the length shows on the line. Close in,
  // so the label can still be read at the tooltip's size.
  measure: [
    async (page) => (await design('Blume')(page), page.evaluate(() => document.getElementById('measure-toggle').click())),
    [790, 280, 304, 190],
    [
      [1050, 455, 0, 0.5],
      [878, 388, 0.7, 0.3, 'down'],
      [1022, 388, 1.0, 2.2, 'up'],
      [1050, 455, 0.5, 0.6, 'Escape'],
    ],
    (page) => page.evaluate(() => document.getElementById('measure-toggle').click()),
  ],
  // Pfad: two clicks set corners, a drag pulls a rounding, a click on the first node closes the area.
  pen: [
    async (page) => (await design('Blume')(page), rail('draw.pen')(page)),
    [960, 650, 256, 160],
    [
      [1200, 860, 0, 0.5],
      [1000, 690, 0.6, 0.5, 'click'],
      [1150, 680, 0.6, 0.5, 'click'],
      [1160, 820, 0.6, 0.2, 'down'],
      [1100, 850, 0.5, 0.6, 'up'],
      [1000, 690, 0.7, 2.0, 'click'],
      [1200, 860, 0.5, 0.3],
    ],
    undo,
  ],
  // Freihand: a shaky stroke, smoothed when the mouse is let go.
  free: [
    async (page) => (await design('Blume')(page), rail('draw.free')(page)),
    [960, 690, 256, 160],
    [
      [1200, 870, 0, 0.5],
      [995, 800, 0.6, 0.2, 'down'],
      [1012, 784, 0.12, 0],
      [1024, 790, 0.1, 0],
      [1040, 768, 0.12, 0],
      [1052, 762, 0.1, 0],
      [1066, 774, 0.12, 0],
      [1081, 769, 0.1, 0],
      [1093, 752, 0.12, 0],
      [1108, 749, 0.1, 0],
      [1119, 760, 0.12, 0],
      [1136, 757, 0.1, 0],
      [1150, 740, 0.12, 0],
      [1172, 735, 0.15, 0.3],
      [1173, 735, 0.05, 2.0, 'up'],
      [1200, 870, 0.5, 0.3],
    ],
    undo,
  ],
  // Zerteilen: a line dragged across the picked petal; it becomes two objects, each sewn on its own.
  cut: [
    async (page) => (await design('Blume')(page), await page.mouse.click(950, 388), await page.waitForTimeout(800), rail('draw.cut')(page)),
    [830, 300, 256, 160],
    [
      [1060, 440, 0, 0.5],
      [935, 325, 0.6, 0.2, 'down'],
      [962, 445, 1.0, 1.5, 'up'],
      [1050, 430, 0.6, 2.0],
    ],
    undo,
  ],
};
const FPS = 12;

/** The arrow pointer of the screencasts (tools/screencast/compose.py), drawn into a frame. */
const drawPointer = (ctx, x, y, s, ring) => {
  // A click: a ring that grows and fades, as in the screencasts.
  if (ring !== null) {
    ctx.beginPath();
    ctx.arc(x, y, (6 + 16 * ring) * s, 0, 2 * Math.PI);
    ctx.lineWidth = 2.5 * s;
    ctx.strokeStyle = `rgba(222, 77, 140, ${0.9 * (1 - ring)})`;
    ctx.stroke();
  }
  const pts = [[0, 0], [0, 22], [5.5, 17], [9, 25.5], [12.5, 24], [9, 16], [16, 16]];
  const path = (dx, dy) => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => ctx[i ? 'lineTo' : 'moveTo'](x + px * s + dx, y + py * s + dy));
    ctx.closePath();
  };
  path(2 * s, 3 * s);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.27)';
  ctx.fill();
  path(0, 0);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 1.4 * s;
  ctx.strokeStyle = '#19141e';
  ctx.stroke();
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'de-DE', colorScheme: 'light' });
await page.goto(APP_URL);
await page.waitForTimeout(1000);
// Realistic threads, no start and end marks, live light off unless a shot turns it on.
await toggle('realistic', true)(page);
await page.evaluate(() => {
  const m = document.getElementById('marks-toggle');
  if (m.getAttribute('aria-pressed') === 'true') m.click();
});
const cdp = await page.context().newCDPSession(page);

fs.mkdirSync(OUT, { recursive: true });
for (const [name, [setup, [x, y, w, h]]] of Object.entries(SHOTS)) {
  if (wanted.length && !wanted.includes(name)) continue;
  await toggle('live-light', false)(page);
  await setup(page);
  if (name !== 'view-shapes') await page.evaluate(() => document.querySelector('#shapes-seg [data-shapes=off]').click());
  // The pointer off the canvas: no hover box; the live light then falls from the top left.
  await page.mouse.move(360, 60);
  await page.waitForTimeout(1500);
  if (DEBUG) {
    fs.mkdirSync(DEBUG, { recursive: true });
    await page.screenshot({ path: path.join(DEBUG, `${name}.full.png`) });
  }
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale: 2 } });
  // Scaled and encoded by the browser itself, so the tool needs nothing beyond Playwright.
  const webp = await page.evaluate(
    async ([png, W, H]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, W, H);
      return c.toDataURL('image/webp', 0.8).split(',')[1];
    },
    [shot.data, W, H],
  );
  fs.writeFileSync(path.join(OUT, `${name}.webp`), Buffer.from(webp, 'base64'));
  console.log(`${name}.webp`);
}
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

for (const [name, [setup, [x, y, w, h], moves, leave]] of Object.entries(MOVES)) {
  if (wanted.length && !wanted.includes(name)) continue;
  await toggle('live-light', false)(page);
  await setup(page);
  await page.evaluate(() => document.querySelector('#shapes-seg [data-shapes=off]').click());
  await page.evaluate(() => {
    const spot = document.getElementById('spot-toggle');
    if (spot.getAttribute('aria-pressed') !== 'true') spot.click();
  });
  // The stitch info under the pointer would cover the design.
  const quiet = await page.addStyleTag({ content: '#tooltip { visibility: hidden !important; }' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tip-${name}-`));
  let n = 0;
  let at = moves[0].slice(0, 2);
  let ring = null;
  const frame = async () => {
    await page.waitForTimeout(40);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale: 1 } });
    const png = await page.evaluate(
      async ([png, W, H, px, py, w, draw, ring]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();
        const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, W, H);
        new Function('ctx', 'x', 'y', 's', 'ring', `(${draw})(ctx, x, y, s, ring)`)(ctx, px, py, (1.1 * W) / w, ring);
        return c.toDataURL('image/png').split(',')[1];
      },
      [shot.data, W, H, ((at[0] - x) * W) / w, ((at[1] - y) * H) / h, w, drawPointer.toString(), ring],
    );
    fs.writeFileSync(path.join(dir, `${String(n++).padStart(4, '0')}.png`), Buffer.from(png, 'base64'));
  };
  await page.mouse.move(...at);
  await page.waitForTimeout(1500);
  for (const [tx, ty, glide, rest, act] of moves) {
    const from = at;
    const steps = Math.round(glide * FPS);
    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps);
      at = [from[0] + (tx - from[0]) * t, from[1] + (ty - from[1]) * t];
      await page.mouse.move(...at);
      await frame();
    }
    at = [tx, ty];
    await page.mouse.move(tx, ty);
    if (act === 'click') await page.mouse.click(tx, ty);
    else if (act === 'down') await page.mouse.down();
    else if (act === 'up') await page.mouse.up();
    else if (act) await page.keyboard.press(act);
    const pressed = act === 'click' || act === 'down';
    const still = Math.round(rest * FPS);
    for (let i = 0; i < still; i++) {
      ring = pressed && i < 5 ? i / 5 : null;
      await frame();
    }
    ring = null;
  }
  // prettier-ignore
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.png'), '-c:v', 'libwebp_anim', '-lossless', '0', '-quality', '70', '-loop', '0', path.join(OUT, `${name}.webp`)]);
  fs.rmSync(dir, { recursive: true });
  await quiet.evaluate((el) => el.remove());
  await leave?.(page);
  console.log(`${name}.webp (${n} frames)`);
}
await browser.close();
