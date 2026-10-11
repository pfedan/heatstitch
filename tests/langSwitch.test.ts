import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import type { ViteDevServer } from 'vite';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { launchChromium } from './helpers/browser';

/**
 * Switching the language changes every text at once, without a reload: the app is opened in a
 * browser, brought into a state (an object selected, a menu open, Dichte, Bild, a lettering...),
 * switched over and searched for any text of the other language still on the page, shown or
 * hidden, in text, titles (tooltips), labels and placeholders. Then back again.
 *
 * A part that writes text with t() and keeps it (a panel, a card, a menu) listens with
 * onLangChange (src/i18n); one that forgets shows up here with the key of the text it left behind.
 *
 * Runs only with BROWSER_TESTS set: `BROWSER_TESTS=1 npx vitest run tests/langSwitch.test.ts`.
 * It needs Playwright's Chromium (`npx playwright install chromium`); PW_CHROMIUM points to another.
 */

const on = !!process.env.BROWSER_TESTS;
const dicts = { de, en } as Record<'de' | 'en', Record<string, string>>;
/** Not texts of the app: the name a new design was given is its own from then on, "White" is also a thread's name. */
const KEPT = new Set(['draw.newName', 'bg.white']);

/** The pieces of the texts of `from` that the same texts of `to` do not have, by key. */
function marks(from: 'de' | 'en', to: 'de' | 'en'): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, a] of Object.entries(dicts[from])) {
    const b = dicts[to][k];
    if (KEPT.has(k) || a === b) continue;
    for (const piece of a.split(/\{\w+\}/)) {
      const g = piece.trim();
      if (g.length >= 4 && /\p{L}{3}/u.test(g) && !b.toLowerCase().includes(g.toLowerCase())) out.push([k, g]);
    }
  }
  return out;
}

/** Every text on the page with where it is: text nodes, titles, labels and placeholders. */
function pageTexts(page: Page): Promise<[string, string][]> {
  return page.evaluate(() => {
    const out: [string, string][] = [];
    const where = (el: Element) => `${el.tagName.toLowerCase()}#${el.id || el.closest('[id]')?.id || ''}`;
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const el = walk.currentNode.parentElement!;
      const s = walk.currentNode.textContent!.trim();
      // The language list names each language in its own.
      if (s && !el.closest('script, style, #lang')) out.push([s, where(el)]);
    }
    // data-tip: a title once the tooltip layer took it over (src/shell/tooltip.ts).
    for (const el of document.querySelectorAll('[title], [data-tip], [aria-label], [placeholder], optgroup[label]'))
      for (const a of ['title', 'data-tip', 'aria-label', 'placeholder', 'label']) {
        const v = el.getAttribute(a);
        if (v && !el.closest('#lang')) out.push([v, `${where(el)}[${a}]`]);
      }
    return out;
  });
}

/** The texts of `from` left on the page, as "key: text (where)". */
async function leftOver(page: Page, from: 'de' | 'en', to: 'de' | 'en'): Promise<string[]> {
  const m = marks(from, to);
  const found = new Set<string>();
  for (const [s, where] of await pageTexts(page)) {
    let best: [string, string] | null = null;
    for (const x of m) if (s.includes(x[1]) && (!best || x[1].length > best[1].length)) best = x;
    // A short piece counts only as the whole text, so a word inside a longer one does not.
    if (best && (best[1].length >= 12 || best[1] === s)) found.add(`${best[0]}: ${s.slice(0, 60)} (${where})`);
  }
  return [...found];
}

const wait = (page: Page, ms: number) => page.waitForTimeout(ms);
const canvasAt = async (page: Page, fx = 0.5, fy = 0.5) => {
  const b = (await page.locator('#canvas').boundingBox())!;
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
};
const loadCat = async (page: Page) => {
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#load-example [data-example="examples/cat-60mm.pes"]')!.click());
  await page.locator('#layer-list .layer').first().waitFor();
  await wait(page, 500);
};
/** A point inside the cat's red sweater, a fill clear of jumps (the middle of the stage meets a jump line). */
const SWEATER = [0.45, 0.68] as const;
const selectMiddle = async (page: Page) => {
  const p = await canvasAt(page, ...SWEATER);
  await page.mouse.click(p.x, p.y);
  await page.locator('#object-panel:not([hidden])').waitFor();
};
/** Opens every color of the shapes example and selects one object in the list. */
const selectInList = async (page: Page, object: number) => {
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#load-example [data-example="examples/svg/shapes-benchmark.svg"]')!.click());
  await page.locator('#layer-list .layer').first().waitFor();
  const blocks = await page.locator('#layer-list .layer[data-block]').count();
  for (let b = 0; b < blocks; b++) await page.locator(`#layer-list .layer[data-block="${b}"] .chev`).click();
  await page.locator(`#layer-list [data-object="${object}"]`).click();
  await page.locator('#object-panel:not([hidden])').waitFor();
};
const mode = async (page: Page, m: 'flow' | 'density' | 'image') => {
  // Bild has no tab of its own: it starts from the design menu.
  if (m === 'image') await page.evaluate(() => document.getElementById('image-start')!.click());
  else await page.locator(`input[name=mode][value=${m}]`).check({ force: true });
  await wait(page, 1500);
};

/** The states the switch is tried in. */
/** How long the slowest step (converting the example picture) may take; the test gets that much more. */
const SLOW_STEP = 90_000;

const STATES: Record<string, (page: Page) => Promise<void>> = {
  'nothing loaded': async () => {},
  'an object selected': async (page) => {
    await loadCat(page);
    await selectMiddle(page);
  },
  'the stitch level': async (page) => {
    await loadCat(page);
    await selectMiddle(page);
    await page.locator('input[name=level][value=stitches]').check({ force: true });
    await wait(page, 500);
  },
  'the shape level': async (page) => {
    await loadCat(page);
    await selectMiddle(page);
    await page.locator('input[name=level][value=shape]').check({ force: true });
    await wait(page, 500);
  },
  'a satin selected': (page) => selectInList(page, 3),
  'a line selected': (page) => selectInList(page, 12),
  'the order card open': async (page) => {
    await loadCat(page);
    await page.click('#order-optimize');
    await page.locator('#order-card:not([hidden])').waitFor();
  },
  'the object menu open': async (page) => {
    await loadCat(page);
    const p = await canvasAt(page, ...SWEATER);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await wait(page, 500);
  },
  'the color list open': async (page) => {
    await loadCat(page);
    await page.click('#save-button');
    await page.click('#color-list');
    await page.locator('dialog.color-list[open]').waitFor();
  },
  'Dichte with findings': async (page) => {
    await loadCat(page);
    await mode(page, 'density');
    await page.locator('#validation .val-zones, #validation li').first().waitFor();
    const p = await canvasAt(page);
    await page.mouse.move(p.x, p.y);
    await wait(page, 500);
  },
  'Bild with a picture': async (page) => {
    await mode(page, 'image');
    await page.click('#image-example');
    // The assistant opens the colors of a new picture; its last step shows the result and take over.
    await page.click('.image-stepper [data-goto="3"]');
    // Converting the picture runs in a worker and can take long on a busy machine.
    await page.locator('#image-take:not([hidden]):not([disabled])').waitFor({ timeout: SLOW_STEP });
  },
  'a lettering': async (page) => {
    await page.evaluate(() => document.getElementById('new-design')!.click());
    await page.click('#lettering-new');
    await page.locator('#lettering-panel:not([hidden])').waitFor();
  },
};

describe.skipIf(!on)('switching the language', () => {
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

  for (const [name, reach] of Object.entries(STATES)) {
    it(`leaves no text of the old language with ${name}`, { timeout: name === 'Bild with a picture' ? 60_000 + SLOW_STEP : 90_000 }, async () => {
      const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      try {
        await page.goto(url);
        await page.selectOption('#lang', 'de', { force: true });
        await reach(page);
        await page.selectOption('#lang', 'en', { force: true });
        await wait(page, 500);
        expect(await leftOver(page, 'de', 'en'), 'German texts after switching to English').toEqual([]);
        await page.selectOption('#lang', 'de', { force: true });
        await wait(page, 500);
        expect(await leftOver(page, 'en', 'de'), 'English texts after switching back to German').toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
