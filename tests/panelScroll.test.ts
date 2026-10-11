import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import type { ViteDevServer } from 'vite';
import { launchChromium } from './helpers/browser';

/**
 * Clicking a setting of the object page, scrolled down, leaves the column where it was: the setting
 * stays under the pointer. The panel is drawn anew on every change; the button just clicked had the
 * focus, and removing it sent focusout while the panel was half empty, so the column snapped up.
 * A click from script does not focus the button: only a real mouse click shows it.
 *
 * Runs only with BROWSER_TESTS set: `BROWSER_TESTS=1 npx vitest run tests/panelScroll.test.ts`.
 * It needs Playwright's Chromium (`npx playwright install chromium`); PW_CHROMIUM points to another.
 */

const on = !!process.env.BROWSER_TESTS;

/** The section of the stitch settings whose heading is `sec`, its button `label`: centred in the column, clicked with the mouse. */
async function clickSetting(page: Page, sec: string, label: string) {
  const box = await page.evaluate(
    ([sec, label]) => {
      const col = document.getElementById('inspector')!;
      const section = [...document.querySelectorAll<HTMLElement>('#object-stitches .sec')].find((s) => s.textContent!.includes(sec));
      const b = [...(section?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((x) => x.textContent!.trim() === label || x.getAttribute('aria-label') === label);
      if (!b) return null;
      col.scrollTop += b.getBoundingClientRect().top - col.getBoundingClientRect().top - col.clientHeight / 2;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, scroll: col.scrollTop };
    },
    [sec, label],
  );
  expect(box, `${sec}: ${label}`).not.toBeNull();
  await page.mouse.click(box!.x, box!.y);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const col = document.getElementById('inspector')!;
    return { scroll: col.scrollTop, max: col.scrollHeight - col.clientHeight, focused: document.activeElement?.closest('#object-stitches') !== null };
  });
  return { before: box!.scroll, ...after };
}

describe.skipIf(!on)('clicking a setting of the object page', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const { createServer } = await import('vite');
    server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
    await server.listen();
    browser = await launchChromium();
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' });
    await page.goto(server.resolvedUrls!.local[0]);
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('#load-example [data-example="examples/svg/shapes-benchmark.svg"]')!.click());
    await page.locator('#layer-list .layer').first().waitFor();
    await page.waitForTimeout(500);
    // The green circle at the top left: the first object of the first colour.
    await page.locator('#layer-list .layer.color-row .chev').first().click();
    await page.locator('#layer-list .object').first().click();
    await page.locator('#object-stitches .sec').first().waitFor();
    await page.waitForTimeout(300);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  for (const [sec, label] of [
    ['Border', 'Running stitch'],
    ['Border', 'Satin'],
    ['Border', 'Off'],
    ['Underlay', 'Cross'],
    ['Underlay', 'Across'],
    ['Look', 'Hearts'],
  ] as const) {
    it(`keeps the column in place: ${sec}, ${label}`, { timeout: 20_000 }, async () => {
      const r = await clickSetting(page, sec, label);
      expect(r.before).toBeGreaterThan(0);
      // Where the settings get fewer, the column may only end earlier.
      expect(r.scroll).toBe(Math.min(r.before, r.max));
      // The button drawn in the place of the clicked one has the focus: the keyboard goes on from there.
      expect(r.focused).toBe(true);
    });
  }
});
