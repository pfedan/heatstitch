// Takes the small screenshots some tooltips show (data-tip-img, see src/shell/tooltip.ts) from the
// app itself: the demo project and the screencast's fly agaric, realistic threads, no marks. Each is
// a 16:10 crop of the canvas, written as public/tips/<name>.webp at twice the tooltip's 200 x 125.
//
//   npm run build && npm run preview      (in a second shell)
//   node tools/tips/shoot.mjs [name ...]  (all when none is named)
//
// APP_URL points elsewhere than the preview; --full also writes each whole page next to the crop
// (as <name>.full.png in the scratch folder TIPS_DEBUG) to find a new crop.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP_URL = process.env.APP_URL || 'http://localhost:4173/heatstitch/';
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
await browser.close();
