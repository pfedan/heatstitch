import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import type { ViteDevServer } from 'vite';
import { launchChromium } from './helpers/browser';

/**
 * Dragging an object row in the Ablauf list moves it (and takes the thread of the color it is
 * dropped into); it never shows the "drop files here" overlay of the file opener, which is only
 * for files dragged in from outside.
 *
 * Runs only with BROWSER_TESTS set: `BROWSER_TESTS=1 npx vitest run tests/layerDrag.test.ts`.
 */

const on = !!process.env.BROWSER_TESTS;

describe.skipIf(!on)('dragging an object in the list', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const { createServer } = await import('vite');
    server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
    await server.listen();
    browser = await launchChromium();
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(server.resolvedUrls!.local[0]);
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('#load-example [data-example="examples/cat-60mm.pes"]')!.click());
    await page.locator('#layer-list .layer').first().waitFor();
    await page.waitForTimeout(500);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it('moves the object into the other color without the file overlay', { timeout: 30_000 }, async () => {
    // Creme and Orange open; the first Creme fill is dragged among the orange ones.
    await page.click('#layer-list [data-block="0"] [data-part="chev"]');
    await page.click('#layer-list [data-block="1"] [data-part="chev"]');
    const colors = await page.locator('#layer-list .color-row').count();
    const countOf = async (b: number) => Number((await page.locator(`#layer-list .color-row[data-block="${b}"] .layer-sub`).innerText()).match(/(\d+)\s*(Objekt|object)/i)![1]);
    const creme = await countOf(0);
    const orange = await countOf(1);
    const src = page.locator('#layer-list .layer[data-object]').filter({ hasText: /Fill|Füllung/ }).first();
    const dst = page.locator('#layer-list .color-row[data-block="1"] ~ .layer[data-object]').nth(2);
    const a = (await src.boundingBox())!;
    const b = (await dst.boundingBox())!;
    await page.mouse.move(a.x + 40, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 50, a.y + a.height / 2 + 5, { steps: 3 });
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.8, { steps: 10 });
    await page.mouse.move(b.x + b.width * 0.6 + 2, b.y + b.height * 0.8, { steps: 2 });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.body.classList.contains('dragging'))).toBe(false);
    // The line says which thread it is sewn in.
    const label = await page.locator('#layer-list .drop-after, #layer-list .drop-before').first().evaluate((r) => (r as HTMLElement).dataset.drop ?? '');
    expect(label).toMatch(/Orange/);
    // What is dragged follows as a small chip that keeps clear of the label on the line.
    const boxes = await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>('#layer-list [data-drop]')!;
      const r = row.getBoundingClientRect();
      const after = getComputedStyle(row, '::after');
      const lt = row.classList.contains('drop-after') ? r.bottom - parseFloat(after.bottom) - parseFloat(after.height) : r.top + parseFloat(after.top);
      const chip = document.querySelector<HTMLElement>('.drag-chip')!.getBoundingClientRect();
      return { label: [lt, lt + parseFloat(after.height)], chip: [chip.top, chip.bottom], text: document.querySelector('.drag-chip')!.textContent };
    });
    expect(boxes.text).toMatch(/Fill|Füllung/);
    expect(boxes.chip[1] <= boxes.label[0] || boxes.chip[0] >= boxes.label[1]).toBe(true);
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => document.body.classList.contains('dragging'))).toBe(false);
    expect(await page.locator('.drag-chip').count()).toBe(0);
    // The fill is sewn in orange now; Creme keeps the rest (or is gone when it was its only object).
    expect(await page.locator('#layer-list .color-row').count()).toBe(creme > 1 ? colors : colors - 1);
    const orangeRow = page.locator('#layer-list .color-row').filter({ hasText: 'Orange' });
    expect(Number((await orangeRow.locator('.layer-sub').innerText()).match(/(\d+)\s*(Objekt|object)/i)![1])).toBe(orange + 1);
  });

  it('on a closed color the side chooses the thread, as among objects', { timeout: 30_000 }, async () => {
    // Creme open, Gold (the third color) closed: the Creme fill goes onto the Gold row.
    const reload = async () => {
      await page.reload();
      await page.evaluate(() => document.querySelector<HTMLButtonElement>('#load-example [data-example="examples/cat-60mm.pes"]')!.click());
      await page.locator('#layer-list .layer').first().waitFor();
      await page.waitForTimeout(500);
      await page.click('#layer-list [data-block="0"] [data-part="chev"]');
    };
    const gold = page.locator('#layer-list .color-row', { hasText: 'Gold' });
    const count = async () => Number((await gold.innerText()).match(/(\d+) (objects?|Objekte?)/)![1]);
    const dragOnto = async (x: number, y: number) => {
      const src = page.locator('#layer-list .layer[data-object]').first();
      const dst = page.locator('#layer-list [data-block="2"]');
      expect(await dst.getAttribute('class')).not.toMatch(/\bopen\b/);
      const a = (await src.boundingBox())!;
      const b = (await dst.boundingBox())!;
      await page.mouse.move(a.x + 40, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + 50, a.y + a.height / 2 + 5, { steps: 3 });
      await page.mouse.move(b.x + b.width * x, b.y + b.height * y, { steps: 10 });
      await page.mouse.move(b.x + b.width * x + 2, b.y + b.height * y, { steps: 2 });
      await page.waitForTimeout(100);
      const row = page.locator('#layer-list .drop-after, #layer-list .drop-before').first();
      const label = await row.evaluate((r) => (r as HTMLElement).dataset.drop ?? '');
      await page.mouse.up();
      await page.waitForTimeout(500);
      return label;
    };

    // Right of the front third, lower half: the end of Gold, in Gold's thread.
    await reload();
    let before = await count();
    expect(await dragOnto(0.6, 0.8)).toMatch(/Gold/);
    expect(await count()).toBe(before + 1);

    // Front third: next to Gold in its own thread, Gold keeps its objects.
    await reload();
    before = await count();
    expect(await dragOnto(0.15, 0.8)).toMatch(/Creme/);
    expect(await count()).toBe(before);
  });

  it('still shows the overlay for files dragged in from outside', { timeout: 30_000 }, async () => {
    const shown = await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['x'], 'a.pes'));
      document.body.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
      const on = document.body.classList.contains('dragging');
      document.body.dispatchEvent(new DragEvent('dragleave', { dataTransfer: dt, bubbles: true }));
      return [on, document.body.classList.contains('dragging')];
    });
    expect(shown).toEqual([true, false]);
  });
});
