import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import type { ViteDevServer } from 'vite';
import { splitKeys } from '../src/shell/tooltip';
import { launchChromium } from './helpers/browser';

describe('keys at the end of a tooltip', () => {
  it('sets apart a key the text ends with', () => {
    expect(splitKeys('Duplizieren (Strg+D)')).toEqual({ text: 'Duplizieren', keys: ['Strg+D'] });
    expect(splitKeys('Rückgängig (⌘⇧Z)')).toEqual({ text: 'Rückgängig', keys: ['⌘⇧Z'] });
    expect(splitKeys('Sprungmarken (H)')).toEqual({ text: 'Sprungmarken', keys: ['H'] });
    expect(splitKeys('Geführt (Taste G)')).toEqual({ text: 'Geführt', keys: ['G'] });
    expect(splitKeys('Kopieren (Strg+C, Strg+V)')).toEqual({ text: 'Kopieren', keys: ['Strg+C', 'Strg+V'] });
    expect(splitKeys('Löschen (Entf)')).toEqual({ text: 'Löschen', keys: ['Entf'] });
  });

  it('leaves a remark in brackets as text', () => {
    expect(splitKeys('Drehen (Umschalt: 15°)').keys).toEqual([]);
    expect(splitKeys('Wechseln (Taste T wechselt)').keys).toEqual([]);
    expect(splitKeys('Breite (mm)').keys).toEqual([]);
    expect(splitKeys('(H)')).toEqual({ text: '(H)', keys: [] });
  });
});

/**
 * The app's own tooltip in a real browser: no title is left for the browser to show, the tooltip
 * comes on hover, on keyboard focus and on a long press (which does not click), follows a language
 * switch and goes away when the pointer leaves.
 *
 * Runs only with BROWSER_TESTS set: `BROWSER_TESTS=1 npx vitest run tests/tooltip.test.ts`.
 */
const on = !!process.env.BROWSER_TESTS;

const tipText = (page: Page) => page.evaluate(() => (document.getElementById('tip')!.hidden ? null : document.getElementById('tip')!.textContent));

describe.skipIf(!on)('the tooltip', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let url: string;

  beforeAll(async () => {
    const { createServer } = await import('vite');
    server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
    await server.listen();
    url = server.resolvedUrls!.local[0];
    browser = await launchChromium();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it('replaces every title and shows on hover, focus and language switch', { timeout: 60_000 }, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto(url);
      await page.selectOption('#lang', 'de', { force: true });
      await page.evaluate(() => document.querySelector<HTMLButtonElement>('#load-example [data-example="examples/cat-60mm.pes"]')!.click());
      await page.locator('#layer-list .layer').first().waitFor();
      await page.waitForTimeout(300);

      // No title left for the browser's own box, outside native option lists.
      const left = await page.evaluate(() => [...document.body.querySelectorAll('[title]')].filter((e) => !/^(OPTION|OPTGROUP|IFRAME|ABBR)$/.test(e.tagName)).map((e) => e.outerHTML.slice(0, 80)));
      expect(left).toEqual([]);

      // Hover: after a short rest, with the key set apart.
      const save = page.locator('#save-button');
      await save.hover();
      expect(await tipText(page)).toBeNull();
      await page.waitForTimeout(700);
      expect(await tipText(page)).toMatch(/Speichern/);
      expect(await page.locator('#tip kbd').count()).toBeGreaterThan(0);

      // Leaving hides it.
      await page.mouse.move(700, 450);
      await page.waitForTimeout(50);
      await page.mouse.move(5, 890);
      await page.waitForTimeout(200);
      expect(await tipText(page)).toBeNull();

      // A tooltip with a picture shows it above the text.
      await page.locator('#shapes-seg [data-shapes=on]').hover();
      await page.waitForTimeout(700);
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('#tip .tip-img')?.complete);
      expect(await page.evaluate(() => document.querySelector<HTMLImageElement>('#tip .tip-img')!.naturalWidth)).toBe(400);
      await page.mouse.move(5, 890);
      await page.waitForTimeout(200);

      // Language switch: the title is written anew and the tooltip says it in English.
      await page.selectOption('#lang', 'en', { force: true });
      await save.hover();
      await page.waitForTimeout(700);
      expect(await tipText(page)).toMatch(/Save/);
      await page.mouse.move(5, 890);

      // Keyboard: Tab onto a button with a tooltip shows it.
      await page.locator('#save-button').focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(400);
      expect(await tipText(page)).toMatch(/Save/);
      await page.keyboard.press('Escape');
      expect(await tipText(page)).toBeNull();
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  it('shows on a long press without clicking', { timeout: 60_000 }, async () => {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1100 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    try {
      await page.goto(url);
      const target = await page.evaluate(() => {
        const el = [...document.querySelectorAll<HTMLButtonElement>('button[data-tip]')].find((b) => b.offsetParent && !b.disabled)!;
        el.id ||= 'tip-target';
        let clicks = 0;
        el.addEventListener('click', () => (document.body.dataset.clicks = String(++clicks)));
        return `#${el.id}`;
      });
      const b = (await page.locator(target).boundingBox())!;
      const cdp = await ctx.newCDPSession(page);
      const at = [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at });
      await page.waitForTimeout(700);
      expect(await tipText(page)).not.toBeNull();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.body.dataset.clicks ?? '0')).toBe('0');
      expect(await tipText(page)).not.toBeNull();
      await page.waitForTimeout(1800);
      expect(await tipText(page)).toBeNull();
    } finally {
      await ctx.close();
    }
  });
});
