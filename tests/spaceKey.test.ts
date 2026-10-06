import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import type { ViteDevServer } from 'vite';

/**
 * Space plays the Ablauf even right after a click on a button or a switch: the browser would press
 * the focused control again (Einpassen once more), the page wins. In a text field, a slider or a
 * select, Space stays theirs.
 *
 * Runs only with BROWSER_TESTS set: `BROWSER_TESTS=1 npx vitest run tests/spaceKey.test.ts`.
 * It needs Playwright's Chromium (`npx playwright install chromium`); PW_CHROMIUM points to another.
 */

const on = !!process.env.BROWSER_TESTS;
const playing = (page: Page) => page.locator('#player [data-play="toggle"]').evaluate((b) => b.classList.contains('primary'));

describe.skipIf(!on)('the space key', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const { createServer } = await import('vite');
    const { chromium } = await import('playwright');
    server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
    await server.listen();
    browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(server.resolvedUrls!.local[0]);
    await page.selectOption('#load-example', 'examples/cat-60mm.pes', { force: true });
    await page.locator('#layer-list .layer').first().waitFor();
    await page.waitForTimeout(500);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it('plays after a click on Einpassen instead of fitting again', { timeout: 30_000 }, async () => {
    let fits = 0;
    await page.exposeFunction('countFit', () => fits++);
    await page.evaluate(() => document.getElementById('fit')!.addEventListener('click', () => (window as unknown as { countFit: () => void }).countFit()));
    await page.click('#fit');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('fit');
    expect(await playing(page)).toBe(false);
    await page.keyboard.press(' ');
    await page.waitForTimeout(200);
    expect(fits).toBe(1);
    expect(await playing(page)).toBe(true);
    await page.keyboard.press(' ');
    await page.waitForTimeout(200);
    expect(fits).toBe(1);
    expect(await playing(page)).toBe(false);
  });

  it('plays after a click on the player button without toggling twice', { timeout: 30_000 }, async () => {
    await page.click('#player [data-play="toggle"]');
    expect(await playing(page)).toBe(true);
    await page.keyboard.press(' ');
    await page.waitForTimeout(200);
    expect(await playing(page)).toBe(false);
  });

  it('plays after a click on a switch instead of flipping it back', { timeout: 30_000 }, async () => {
    const box = page.locator('#realistic');
    const label = page.locator('label:has(#realistic)');
    await label.click();
    const checked = await box.isChecked();
    await page.keyboard.press(' ');
    await page.waitForTimeout(200);
    expect(await box.isChecked()).toBe(checked);
    expect(await playing(page)).toBe(true);
    await page.keyboard.press(' ');
    await page.waitForTimeout(200);
    expect(await playing(page)).toBe(false);
    await label.click();
  });

  it('leaves Space to a slider and a select', { timeout: 30_000 }, async () => {
    for (const sel of ['#player-pos', '#player-speed']) {
      await page.focus(sel);
      await page.keyboard.press(' ');
      await page.waitForTimeout(200);
      expect(await playing(page), sel).toBe(false);
      await page.keyboard.press('Escape');
    }
  });
});
