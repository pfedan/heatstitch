import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import type { ViteDevServer } from 'vite';

/**
 * Opening or closing a section of the right column, scrolled down, leaves its heading where it was:
 * the column does not jump. In Prüfen the Stickmuster page comes first in the markup but is shown
 * last, and the browser's scroll anchoring used to follow it down when a section above it opened.
 *
 * Runs only with BROWSER_TESTS set: `BROWSER_TESTS=1 npx vitest run tests/sectionScroll.test.ts`.
 * It needs Playwright's Chromium (`npx playwright install chromium`); PW_CHROMIUM points to another.
 */

const on = !!process.env.BROWSER_TESTS;

/**
 * Each visible section heading of the column: scrolled into its middle, clicked twice; how far it
 * moved after each click. Closing a section at the end of the column may pull the column back (there
 * is nothing left below), so such a click counts as not moved.
 */
const moves = (page: Page) =>
  page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const col = document.getElementById('inspector')!;
    const visible = (el: Element) => (el as HTMLElement).offsetParent !== null;
    const heads = [...col.querySelectorAll<HTMLElement>('details > summary')].filter(visible);
    const out: { head: string; scrolled: number; moved: number[] }[] = [];
    for (const head of heads) {
      if (!visible(head)) continue;
      const top = () => head.getBoundingClientRect().top - col.getBoundingClientRect().top;
      col.scrollTop = Math.max(0, col.scrollTop + top() - col.clientHeight / 2);
      await frame();
      const moved: number[] = [];
      for (let k = 0; k < 2; k++) {
        const before = top();
        head.click();
        await frame();
        await frame();
        const end = col.scrollTop >= col.scrollHeight - col.clientHeight - 1;
        const closed = !(head.parentElement as HTMLDetailsElement).open;
        const d = Math.round(top() - before);
        moved.push(end && closed && d > 0 ? 0 : d);
      }
      out.push({ head: head.textContent!.trim().slice(0, 40), scrolled: col.scrollTop, moved });
    }
    return out;
  });

describe.skipIf(!on)('opening a section in the right column', () => {
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
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('#load-example [data-example="examples/demos/confetti.pes"]')!.click());
    await page.locator('#layer-list .layer').first().waitFor();
    await page.waitForTimeout(500);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it('keeps "Sprünge und Schnitte" in place in Prüfen, scrolled down', { timeout: 30_000 }, async () => {
    await page.keyboard.press('2');
    await page.waitForTimeout(500);
    const r = await page.evaluate(async () => {
      const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const col = document.getElementById('inspector')!;
      const box = document.getElementById('jumps-panel') as HTMLDetailsElement;
      if (box.open) box.querySelector('summary')!.click();
      await frame();
      col.scrollTop = 400;
      await frame();
      const before = { scroll: col.scrollTop, top: box.getBoundingClientRect().top };
      box.querySelector('summary')!.click();
      await frame();
      await frame();
      return { before, scroll: col.scrollTop, top: box.getBoundingClientRect().top, open: box.open };
    });
    expect(r.before.scroll).toBe(400);
    expect(r.open).toBe(true);
    expect(r.scroll).toBe(400);
    expect(r.top).toBe(r.before.top);
  });

  for (const [key, name] of [
    ['2', 'Prüfen'],
    ['1', 'Gestalten'],
  ] as const) {
    it(`keeps every section heading in place in ${name}`, { timeout: 60_000 }, async () => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press(key);
      await page.waitForTimeout(500);
      const r = await moves(page);
      expect(r.length).toBeGreaterThan(3);
      // Somewhere down the column, where scroll anchoring acts.
      expect(r.some((x) => x.scrolled > 0)).toBe(true);
      for (const x of r) expect({ head: x.head, moved: x.moved }).toEqual({ head: x.head, moved: [0, 0] });
    });
  }
});
