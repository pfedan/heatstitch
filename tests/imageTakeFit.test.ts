import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import type { ViteDevServer } from 'vite';

/**
 * After "Übernehmen" in Bild umwandeln the new design opens fitted, as Einpassen would show it:
 * not measured against the stage of the image assistant (wider, without the player), which cut the
 * motif off at the top or bottom.
 *
 * Runs only with BROWSER_TESTS set: `BROWSER_TESTS=1 npx vitest run tests/imageTakeFit.test.ts`.
 */

const on = !!process.env.BROWSER_TESTS;

describe.skipIf(!on)('taking over a converted image', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const { createServer } = await import('vite');
    const { chromium } = await import('playwright');
    server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
    await server.listen();
    browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
    page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(server.resolvedUrls!.local[0]);
    await page.waitForTimeout(500);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it('opens the design fitted', { timeout: 150_000 }, async () => {
    // Bild has no tab of its own: it starts from the start page.
    await page.evaluate(() => document.getElementById('image-start')!.click());
    await page.waitForTimeout(500);
    await page.click('#image-example');
    await page.click('.image-stepper [data-goto="3"]');
    // Converting the picture runs in a worker and can take long on a busy machine.
    await page.locator('#image-take:not([hidden]):not([disabled])').waitFor({ timeout: 120_000 });
    await page.click('#image-take');
    await page.locator('#player:not([hidden])').waitFor();
    await page.waitForTimeout(500);
    const taken = await page.locator('#zoom-out').innerText();
    await page.click('#fit');
    await page.waitForTimeout(300);
    expect(taken).toBe(await page.locator('#zoom-out').innerText());
  });
});
