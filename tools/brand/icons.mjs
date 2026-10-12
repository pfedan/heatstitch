// The app icons from the logo mark (public/favicon.svg): PWA icons, the maskable icon, the
// Apple touch icon and favicon.ico, drawn by Chromium so they look exactly like the SVG.
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

// favicon.ico: what search engines and old browsers ask for without reading the page. Google wants
// a square of a multiple of 48 px, so 48 is in it, next to the 16 and 32 a browser tab picks.
const ICO_SIZES = [16, 32, 48];

const browser = await chromium.launch();
async function draw(svg, size) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  await page.setContent(`<body style="margin:0"><img src="${src}" width="${size}" height="${size}" style="display:block"></body>`);
  await page.locator('img').evaluate((img) => img.decode());
  const png = await page.screenshot({ omitBackground: true });
  await page.close();
  return png;
}
for (const { file, size, svg } of icons) {
  fs.writeFileSync(pub(file), await draw(svg, size));
  console.log(file);
}
const pngs = [];
for (const size of ICO_SIZES) pngs.push(await draw(mark, size));
fs.writeFileSync(pub('favicon.ico'), ico(ICO_SIZES, pngs));
console.log('favicon.ico');
await browser.close();

/** An ICO file holding the PNGs as they are (every browser since IE Vista reads PNG entries). */
function ico(sizes, pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach((png, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(sizes[i] % 256, e);
    head.writeUInt8(sizes[i] % 256, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...pngs]);
}
