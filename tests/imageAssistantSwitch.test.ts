import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import type { ViteDevServer } from 'vite';

/**
 * Bild umwandeln and the other ways in: an SVG dropped into the open assistant stays there (like a
 * photo), and a design picked in the switcher while the assistant is open is shown.
 *
 * Runs only with BROWSER_TESTS set: `BROWSER_TESTS=1 npx vitest run tests/imageAssistantSwitch.test.ts`.
 */

const on = !!process.env.BROWSER_TESTS;

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80" fill="#e53"/><circle cx="50" cy="50" r="25" fill="#235"/></svg>';

describe.skipIf(!on)('Bild umwandeln and switching', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;
  const mode = () => page.evaluate(() => document.body.dataset.mode);
  const openAssistant = async () => {
    await page.evaluate(() => document.getElementById('image-start')!.click());
    await page.waitForFunction(() => document.body.dataset.mode === 'image');
  };

  beforeAll(async () => {
    const { createServer } = await import('vite');
    const { chromium } = await import('playwright');
    server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
    await server.listen();
    browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(server.resolvedUrls!.local[0]);
    await page.waitForTimeout(500);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it('keeps an SVG dropped into the assistant there', { timeout: 60_000 }, async () => {
    await openAssistant();
    const dt = await page.evaluateHandle((svg) => {
      const d = new DataTransfer();
      d.items.add(new File([svg], 'quadrat.svg', { type: 'image/svg+xml' }));
      return d;
    }, SVG);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#image-drop', type, { dataTransfer: dt });
    await page.locator('#image-file:not([hidden])').waitFor({ timeout: 30_000 });
    expect(await page.locator('#image-info').innerText()).toContain('quadrat');
    await page.waitForTimeout(1500);
    expect(await mode()).toBe('image');
  });

  it('shows a design picked in the switcher while the assistant is open', { timeout: 60_000 }, async () => {
    await page.evaluate(() => document.getElementById('image-cancel')!.click());
    await page.click('#design-button');
    await page.click('#load-example [data-cmd="cat"]');
    // In the list (the switcher may already have closed again once the design is open).
    await page.locator('#file-list li').first().waitFor({ state: 'attached' });
    await page.locator('#player:not([hidden])').waitFor();
    await page.waitForTimeout(500);
    await openAssistant();
    await page.click('#design-button');
    await page.click('#file-list li');
    await page.waitForFunction(() => document.body.dataset.mode !== 'image', null, { timeout: 5_000 });
    expect(await mode()).toBe('flow');
  });
});
