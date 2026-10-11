import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import type { ViteDevServer } from 'vite';
import { launchChromium } from './helpers/browser';

/**
 * A circle drawn freehand and typed 60 mm wide in the Objekt card comes out 60,0 × 60,0 mm, and
 * one undo brings it back.
 *
 * Runs only with BROWSER_TESTS set: `BROWSER_TESTS=1 npx vitest run tests/typedSizeBrowser.test.ts`.
 * It needs Playwright's Chromium (`npx playwright install chromium`); PW_CHROMIUM points to another.
 */

const on = !!process.env.BROWSER_TESTS;

describe.skipIf(!on)('typing a size in the Objekt card', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const { createServer } = await import('vite');
    server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
    await server.listen();
    browser = await launchChromium();
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'de-DE' });
    await page.goto(server.resolvedUrls!.local[0]);
    await page.getByText('Leer anfangen').click();
    await page.waitForTimeout(500);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it('gives a freshly drawn circle the width typed', { timeout: 60_000 }, async () => {
    const c = (await page.locator('#canvas').boundingBox())!;
    const x = c.x + c.width / 2;
    const y = c.y + c.height / 2;
    await page.keyboard.press('o');
    await page.keyboard.down('Shift');
    await page.mouse.move(x - 80, y - 80);
    await page.mouse.down();
    await page.mouse.move(x + 83, y + 83, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const w = page.locator('input[aria-label="Breite in mm"]');
    const h = page.locator('input[aria-label="Höhe in mm"]');
    await w.waitFor();
    const before = await w.inputValue();
    expect(before).not.toBe('60,0');
    await w.fill('60');
    await w.press('Enter');
    await expect.poll(() => w.inputValue(), { timeout: 10_000 }).toBe('60,0');
    expect(await h.inputValue()).toBe('60,0');
    await page.keyboard.press('Control+z');
    await expect.poll(() => w.inputValue(), { timeout: 10_000 }).toBe(before);
  });
});
