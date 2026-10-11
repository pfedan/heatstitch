import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import type { ViteDevServer } from 'vite';
import { launchChromium } from './helpers/browser';

/**
 * On the stage, scrolling pans and a pinch (a wheel with ctrlKey, as browsers report it) or Ctrl
 * with the wheel zooms around the pointer; the page itself never scrolls.
 *
 * Runs only with BROWSER_TESTS set: `BROWSER_TESTS=1 npx vitest run tests/wheelPanZoomBrowser.test.ts`.
 */

const on = !!process.env.BROWSER_TESTS;

describe.skipIf(!on)('wheel and trackpad on the stage', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;
  let cx = 0;
  let cy = 0;

  /** The circle's box on the canvas in CSS pixels: its orange stitches. */
  const circleBox = () =>
    page.evaluate(() => {
      const c = document.querySelector('#canvas') as HTMLCanvasElement;
      const k = c.width / c.clientWidth;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
      for (let y = 0; y < c.height; y += 2)
        for (let x = 0; x < c.width; x += 2) {
          const i = (y * c.width + x) * 4;
          if (!(d[i] > 180 && d[i + 2] < 120 && d[i] - d[i + 2] > 120)) continue;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      return { x: (x0 + x1) / 2 / k, y: (y0 + y1) / 2 / k, w: (x1 - x0) / k };
    });
  const zoom = () => page.locator('#zoom-out').innerText();

  beforeAll(async () => {
    const { createServer } = await import('vite');
    server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
    await server.listen();
    browser = await launchChromium();
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'de-DE' });
    await page.goto(server.resolvedUrls!.local[0]);
    await page.getByText('Leer anfangen').click();
    await page.waitForTimeout(500);
    const c = (await page.locator('#canvas').boundingBox())!;
    cx = c.x + c.width / 2;
    cy = c.y + c.height / 2;
    await page.keyboard.press('o');
    await page.mouse.move(cx - 60, cy - 60);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 60, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it('pans with a two finger swipe and keeps the zoom', { timeout: 60_000 }, async () => {
    const z = await zoom();
    const a = await circleBox();
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 10; i++) await page.mouse.wheel(8, 5);
    await page.waitForTimeout(300);
    const b = await circleBox();
    expect(b.x - a.x).toBeCloseTo(-80, -1);
    expect(b.y - a.y).toBeCloseTo(-50, -1);
    expect(b.w).toBeCloseTo(a.w, -1);
    expect(await zoom()).toBe(z);
    expect(await page.evaluate(() => [window.scrollX, window.scrollY, document.scrollingElement!.scrollTop])).toEqual([0, 0, 0]);
  });

  it('zooms around the pointer with a pinch and with Ctrl and the wheel', { timeout: 60_000 }, async () => {
    const a = await circleBox();
    await page.mouse.move(a.x + (await page.locator('#canvas').boundingBox())!.x, a.y + (await page.locator('#canvas').boundingBox())!.y);
    await page.keyboard.down('Control');
    // A pinch outwards: many small negative deltas.
    for (let i = 0; i < 14; i++) await page.mouse.wheel(0, -5);
    await page.waitForTimeout(300);
    const b = await circleBox();
    expect(b.w / a.w).toBeCloseTo(Math.exp(0.7), 0);
    expect(Math.abs(b.x - a.x)).toBeLessThan(4);
    expect(Math.abs(b.y - a.y)).toBeLessThan(4);
    // One mouse wheel notch is one gentle step, not a jump.
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(300);
    await page.keyboard.up('Control');
    const c = await circleBox();
    expect(c.w / b.w).toBeCloseTo(Math.exp(-0.18), 1);
  });
});
