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
      let on: [number, number] = [-1, -1];
      for (let y = 0; y < c.height; y += 2)
        for (let x = 0; x < c.width; x += 2) {
          const i = (y * c.width + x) * 4;
          if (!(d[i] > 180 && d[i + 1] < 80 && d[i + 2] < 80)) continue;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
          // A point on the thread with thread all round it.
          if (on[0] < 0 && [[-4, 0], [4, 0], [0, -4], [0, 4]].every(([dx, dy]) => d[((y + dy) * c.width + x + dx) * 4] > 180)) on = [x / k, y / k];
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
      return { x: (x0 + x1) / 2 / k, y: (y0 + y1) / 2 / k, top: y0 / k, hoop, on };
    }, row);

  /** Until the hoop has come to rest (it glides round the design once that is sewn anew). */
  const settled = async () => {
    const c = (await page.locator('#canvas').boundingBox())!;
    let last = NaN;
    await expect
      .poll(
        async () => {
          const h = (await look(c.height * 0.25)).hoop;
          const still = Math.abs(h - last) < 0.5;
          last = h;
          return still;
        },
        { timeout: 5000, interval: 200 },
      )
      .toBe(true);
  };

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
    // Let go: the lettering stays where it was put, and the hoop goes round it again (it glides
    // there once the lettering is sewn anew, which takes its time on a slow machine).
    await expect.poll(async () => (await look(c.height * 0.25)).hoop - a.hoop, { timeout: 5000 }).toBeCloseTo(100, -1);
    const e = await look(c.height * 0.25);
    expect(e.x - a.x).toBeCloseTo(100, -1);
    expect(e.y - a.y).toBeCloseTo(50, -1);
  });

  it('selects and moves an object that is not selected yet; beside it a drag pans', { timeout: 60_000 }, async () => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await settled();
    await expect.poll(() => page.locator('.stage-top').getByText('Buchstaben einzeln', { exact: true }).count()).toBe(0);
    const c = (await page.locator('#canvas').boundingBox())!;
    const a = await look(c.height * 0.25);
    await page.mouse.move(c.x + a.on[0], c.y + a.on[1]);
    await page.mouse.down();
    await page.mouse.move(c.x + a.on[0] - 80, c.y + a.on[1] - 40, { steps: 10 });
    await page.waitForTimeout(400);
    // The lettering moves under the pointer, the hoop stays: no pan.
    const b = await look(c.height * 0.25);
    expect(b.top - a.top).toBeCloseTo(-40, -1);
    expect(b.hoop).toBeCloseTo(a.hoop, 0);
    await page.mouse.up();
    await page.waitForTimeout(800);
    // It is selected now.
    expect(await page.locator('.stage-top').getByText('Buchstaben einzeln', { exact: true }).count()).toBeGreaterThan(0);
    await settled();
    // A drag beside the objects still moves the view, hoop and all.
    const d = await look(c.height * 0.25);
    await page.mouse.move(c.x + 40, c.y + c.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(c.x + 100, c.y + c.height * 0.5, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await look(c.height * 0.25)).hoop - d.hoop, { timeout: 5000 }).toBeCloseTo(60, -1);
    const f = await look(c.height * 0.25);
    expect(f.x - d.x).toBeCloseTo(60, -1);
  });
});
