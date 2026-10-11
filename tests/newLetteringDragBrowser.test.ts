import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import type { ViteDevServer } from 'vite';
import { launchChromium } from './helpers/browser';

/**
 * A new design: the bar over the stage says how to begin, and dragging a new lettering moves the
 * lettering while the hoop stays still; once it is let go, the hoop goes round the design again.
 *
 * Runs only with BROWSER_TESTS set: `BROWSER_TESTS=1 npx vitest run tests/newLetteringDragBrowser.test.ts`.
 */

const on = !!process.env.BROWSER_TESTS;

describe.skipIf(!on)('a new lettering on a new design', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;

  /** The red lettering's box on the canvas and the hoop's left edge in the row `row`, in CSS pixels. */
  const look = (row: number) =>
    page.evaluate((row) => {
      const c = document.querySelector('#canvas') as HTMLCanvasElement;
      const k = c.width / c.clientWidth;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
      for (let y = 0; y < c.height; y += 2)
        for (let x = 0; x < c.width; x += 2) {
          const i = (y * c.width + x) * 4;
          if (!(d[i] > 180 && d[i + 1] < 80 && d[i + 2] < 80)) continue;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      // The hoop's line is the first light pixel from the left in that row.
      let hoop = -1;
      const y = Math.round(row * k);
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i] + d[i + 1] + d[i + 2] > 300) {
          hoop = x / k;
          break;
        }
      }
      return { x: (x0 + x1) / 2 / k, y: (y0 + y1) / 2 / k, top: y0 / k, hoop };
    }, row);

  beforeAll(async () => {
    const { createServer } = await import('vite');
    server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
    await server.listen();
    browser = await launchChromium();
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'de-DE', reducedMotion: 'no-preference' });
    await page.goto(server.resolvedUrls!.local[0]);
    await page.getByText('Leer anfangen').click();
    await page.waitForTimeout(500);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it('says how to begin while there is nothing to click', { timeout: 30_000 }, async () => {
    await expect.poll(() => page.getByText('Zeichne mit den Werkzeugen links eine Form · T: Schriftzug').count()).toBeGreaterThan(0);
    expect(await page.getByText('Klick auf ein Objekt zeigt seinen Umriss').count()).toBe(0);
  });

  it('moves the lettering and not the hoop', { timeout: 60_000 }, async () => {
    await page.keyboard.press('t');
    const field = page.getByRole('textbox', { name: 'Text' });
    await field.waitFor();
    await field.selectText();
    await page.keyboard.type('HEAT');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.waitForTimeout(800);
    const c = (await page.locator('#canvas').boundingBox())!;
    const a = await look(c.height * 0.25);
    expect(a.hoop).toBeGreaterThan(0);
    expect(a.hoop).toBeLessThan(a.x);
    // Press on the lettering's middle and drag it 100 px to the right and 50 down.
    await page.mouse.move(c.x + a.x, c.y + a.y);
    await page.mouse.down();
    await page.mouse.move(c.x + a.x + 100, c.y + a.y + 50, { steps: 10 });
    await page.waitForTimeout(400);
    const b = await look(c.height * 0.25);
    expect(b.top - a.top).toBeCloseTo(50, -1);
    expect(b.hoop).toBeCloseTo(a.hoop, 0);
    await page.mouse.up();
    await page.waitForTimeout(800);
    // Let go: the lettering stays where it was put, and the hoop goes round it again.
    const e = await look(c.height * 0.25);
    expect(e.x - a.x).toBeCloseTo(100, -1);
    expect(e.y - a.y).toBeCloseTo(50, -1);
    expect(e.hoop - a.hoop).toBeCloseTo(100, -1);
  });
});
