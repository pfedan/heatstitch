// The app icons from the logo mark (public/favicon.svg): PWA icons, the maskable icon and the
// Apple touch icon, drawn by Chromium so they look exactly like the SVG.
//
//   node tools/brand/icons.mjs
//
// The SVG's own frame is a rounded square. The maskable and the Apple icon need a full square
// instead (the system cuts its own shape), with the mark small enough to stay inside that cut.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pub = (f) => path.join(repo, 'public', f);
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  for (const spec of ['playwright', '/opt/node-tools/node_modules/playwright']) {
    try { return require(spec); } catch { /* next */ }
  }
  throw new Error('Playwright not found: npm install');
})();

const mark = fs.readFileSync(pub('favicon.svg'), 'utf8');
// The drawing (bars, thread, needle) inside the SVG's coordinates, and its night blue ground.
const ART = { x: 38, y: 45, w: 630, h: 691 };
const GROUND = mark.match(/<rect[^>]*fill="(#[0-9a-f]{6})"/i)[1];

/** The mark on a full square, the drawing taking `share` of the side. */
function fullSquare(share) {
  const side = Math.max(ART.w, ART.h) / share;
  const x = ART.x + ART.w / 2 - side / 2;
  const y = ART.y + ART.h / 2 - side / 2;
  return mark
    .replace(/viewBox="[^"]*"/, `viewBox="${x} ${y} ${side} ${side}"`)
    .replace(/<rect[^>]*rx="[^"]*"[^>]*\/>/, `<rect x="${x}" y="${y}" width="${side}" height="${side}" fill="${GROUND}"/>`);
}

const icons = [
  { file: 'pwa-192.png', size: 192, svg: mark },
  { file: 'pwa-512.png', size: 512, svg: mark },
  // Maskable: everything that matters inside the middle 80 % circle.
  { file: 'pwa-maskable-512.png', size: 512, svg: fullSquare(0.62) },
  { file: 'apple-touch-icon.png', size: 180, svg: fullSquare(0.78) },
];

const browser = await chromium.launch();
for (const { file, size, svg } of icons) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  await page.setContent(`<body style="margin:0"><img src="${src}" width="${size}" height="${size}" style="display:block"></body>`);
  await page.locator('img').evaluate((img) => img.decode());
  await page.screenshot({ path: pub(file), omitBackground: true });
  await page.close();
  console.log(file);
}
await browser.close();
