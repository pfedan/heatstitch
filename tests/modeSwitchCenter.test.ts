import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import type { ViteDevServer } from 'vite';
import { launchChromium } from './helpers/browser';

/**
 * Switching from Gestalten to Prüfen widens the stage by the side panel. The design must stay in
 * the middle: it used to keep its distance from the left edge, so in the comparison view it sat
 * mostly left of the divider and the corrected half ("Korrigiert") looked empty.
 *
 * Runs only with BROWSER_TESTS set: `BROWSER_TESTS=1 npx vitest run tests/modeSwitchCenter.test.ts`.
 */

const on = !!process.env.BROWSER_TESTS;
const PATCH = decodeURIComponent(new URL('../public/examples/demos/patch.pes', import.meta.url).pathname);

describe.skipIf(!on)('switching between Gestalten and Prüfen', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const { createServer } = await import('vite');
    server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
    await server.listen();
    browser = await launchChromium();
    page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
    await page.goto(server.resolvedUrls!.local[0]);
    await page.waitForTimeout(500);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  type View = { scale: number; cx: number; cy: number };
  const view = () => page.evaluate(() => (window as unknown as { heatstitch: { view(): View } }).heatstitch.view());
  const stageWidth = () => page.evaluate(() => document.getElementById('stage')!.clientWidth);
  const mode = async (m: 'flow' | 'density') => {
    await page.click(`#modes input[value="${m}"]`, { force: true });
    await page.waitForTimeout(500);
  };

  it('keeps the design in the middle of the stage', { timeout: 60_000 }, async () => {
    await page.setInputFiles('#file-input', PATCH);
    await page.locator('#player:not([hidden])').waitFor();
    await page.waitForTimeout(500);
    const flow = await view();
    const flowW = await stageWidth();
    await mode('density');
    // The premise: Prüfen has a wider stage than Gestalten.
    expect(await stageWidth()).toBeGreaterThan(flowW + 100);
    const density = await view();
    expect(density.scale).toBeCloseTo(flow.scale, 6);
    expect(Math.abs(density.cx - flow.cx)).toBeLessThan(0.5);
    expect(Math.abs(density.cy - flow.cy)).toBeLessThan(0.5);
    await mode('flow');
    const back = await view();
    expect(Math.abs(back.cx - flow.cx)).toBeLessThan(0.5);
  });
});
