import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { ViteDevServer } from 'vite';

/**
 * Narrow screens (src/areas/responsive): on a phone the page never scrolls sideways, the tools sit
 * in a bar at the bottom and the inspector comes up as a sheet; on a tablet the object list is a
 * drawer over the stage that a tap beside it or Esc closes.
 *
 * Runs only with BROWSER_TESTS set: `BROWSER_TESTS=1 npx vitest run tests/responsive.test.ts`.
 * It needs Playwright's Chromium (`npx playwright install chromium`); PW_CHROMIUM points to another.
 */

const on = !!process.env.BROWSER_TESTS;

describe.skipIf(!on)('narrow screens', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let url: string;

  const open = async (width: number, height: number): Promise<[BrowserContext, Page]> => {
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: width < 800 });
    const page = await ctx.newPage();
    await page.goto(url);
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('#load-example [data-example="examples/cat-60mm.pes"]')!.click());
    await page.locator('#layer-list .layer').first().waitFor({ state: 'attached' });
    await page.waitForTimeout(400);
    return [ctx, page];
  };
  const inView = (page: Page, sel: string) =>
    page.locator(sel).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return getComputedStyle(el).visibility !== 'hidden' && r.width > 0 && r.right > 0 && r.left < innerWidth && r.top < innerHeight && r.bottom > 0;
    });

  beforeAll(async () => {
    const { createServer } = await import('vite');
    const { chromium } = await import('playwright');
    server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
    await server.listen();
    url = server.resolvedUrls!.local[0];
    browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  for (const [w, h] of [
    [390, 844],
    [360, 780],
  ]) {
    it(`a phone at ${w} px: no sideways scroll, tools at the bottom, the inspector as a sheet`, { timeout: 30_000 }, async () => {
      const [ctx, page] = await open(w, h);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
      expect(await page.evaluate(() => document.body.dataset.layout)).toBe('phone');
      // The tool rail lies below the stage.
      const rail = await page.locator('.toolrail').boundingBox();
      const stage = await page.locator('#stage').boundingBox();
      expect(rail!.y).toBeGreaterThanOrEqual(stage!.y + stage!.height - 1);
      expect(await inView(page, '#inspector')).toBe(false);
      await page.tap('#rs-insp-dock');
      await page.waitForTimeout(300);
      expect(await page.locator('#layout').getAttribute('data-sheet')).toBe('half');
      expect(await inView(page, '#inspector')).toBe(true);
      // Tapping the head makes it larger; the close button closes it.
      await page.tap('#inspector .rs-title');
      expect(await page.locator('#layout').getAttribute('data-sheet')).toBe('full');
      await page.tap('#inspector .rs-close');
      await page.waitForTimeout(300);
      expect(await page.locator('#layout').getAttribute('data-sheet')).toBe('closed');
      // The object list is a drawer from the left.
      await page.tap('#rs-side-dock');
      await page.waitForTimeout(300);
      expect(await inView(page, '.layout > .sidebar')).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
      await ctx.close();
    });
  }

  it('a tablet: the object list is a drawer that Esc and a tap beside it close', { timeout: 30_000 }, async () => {
    const [ctx, page] = await open(820, 1180);
    expect(await page.evaluate(() => document.body.dataset.layout)).toBe('tablet');
    expect(await inView(page, '.layout > .sidebar')).toBe(false);
    await page.tap('#rs-side-top');
    await page.waitForTimeout(300);
    expect(await inView(page, '.layout > .sidebar')).toBe(true);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(await inView(page, '.layout > .sidebar')).toBe(false);
    await page.tap('#rs-side-top');
    await page.waitForTimeout(300);
    await page.touchscreen.tap(700, 600);
    await page.waitForTimeout(300);
    expect(await inView(page, '.layout > .sidebar')).toBe(false);
    // The stage has the width: only the tool rail beside it.
    const stage = await page.locator('#stage').boundingBox();
    expect(stage!.width).toBeGreaterThan(700);
    await ctx.close();
  });
  /** A drag with a finger on the stage, in page coordinates. */
  const fingerDrag = async (page: Page, from: [number, number], to: [number, number]) => {
    const cdp = await page.context().newCDPSession(page);
    const at = (i: number) => ({ x: from[0] + ((to[0] - from[0]) * i) / 15, y: from[1] + ((to[1] - from[1]) * i) / 15 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at(0)] });
    for (let i = 1; i <= 15; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(i)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(1200);
  };
  const objectCount = (page: Page) => page.locator('#layer-list .layer[data-object]').count();
  /** A new rectangle across the middle of the stage, drawn with the finger; it is selected after. */
  const drawRect = async (page: Page) => {
    await page.tap('#rs-draw');
    await page.locator('.rs-draw-row').first().click();
    await fingerDrag(page, [100, 250], [290, 330]);
  };

  it('a phone: undo from the menu "…" takes back a cut', { timeout: 40_000 }, async () => {
    const [ctx, page] = await open(390, 844);
    await drawRect(page);
    const before = await objectCount(page);
    // Zerteilen, the last tool in the drawing menu.
    await page.tap('#rs-draw');
    await page.locator('.rs-draw-row').last().click();
    await fingerDrag(page, [80, 290], [320, 295]);
    expect(await objectCount(page)).toBe(before + 1);
    // The undo button of the top bar is out of sight on the phone; its row in the menu works all the same.
    await page.tap('#more-button');
    const undo = page.locator('#more-pop .rs-phone-row').first();
    expect(await undo.isDisabled()).toBe(false);
    await undo.tap();
    await page.waitForTimeout(800);
    expect(await objectCount(page)).toBe(before);
    await ctx.close();
  });

  it('a phone: a fill\'s outline is opened with the icon in the bar, and the fill is sewn as a line', { timeout: 40_000 }, async () => {
    const [ctx, page] = await open(390, 844);
    // Drawn, the rectangle is on the level Form already.
    await drawRect(page);
    // A corner tapped (where the drag started): the path opens after it.
    await page.touchscreen.tap(100, 250);
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /^(Pfad öffnen|Open path)$/ }).tap();
    await page.waitForTimeout(1200);
    expect(await page.locator('body').innerText()).toMatch(/Offene Form|Open shape/);
    // Closed again with the icon in its place: it says it can be filled again.
    await page.getByRole('button', { name: /^(Pfad schließen|Close path)$/ }).tap();
    await page.waitForTimeout(1200);
    expect(await page.locator('body').innerText()).toMatch(/wieder geschlossen|closed again/);
    await ctx.close();
  });

  it('a phone: a single rung is deleted with the button in the bar (no Entf key)', { timeout: 40_000 }, async () => {
    const [ctx, page] = await open(390, 844);
    await drawRect(page);
    await page.tap('#tool-direction');
    await page.waitForTimeout(400);
    await fingerDrag(page, [150, 230], [150, 350]);
    await fingerDrag(page, [230, 230], [230, 350]);
    const bar = page.locator('.stitch-bar');
    const del = bar.getByRole('button', { name: /^(Die gewählte Linie löschen|Delete the selected line)$/ });
    // A tap on the first rung selects it (a new one is selected as drawn); the button removes that one only.
    await page.touchscreen.tap(150, 290);
    await page.waitForTimeout(500);
    expect(await bar.innerText()).toMatch(/2 (Querlinien|rungs)/);
    await del.tap();
    await page.waitForTimeout(500);
    expect(await bar.innerText()).toMatch(/1 (Querlinie|rung)\b/);
    expect(await del.count()).toBe(0);
    await ctx.close();
  });
});
