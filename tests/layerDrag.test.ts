import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import type { ViteDevServer } from 'vite';

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
    const { chromium } = await import('playwright');
    server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
    await server.listen();
    browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
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
    // Creme (one object) and Orange (four objects) open; the Creme fill is dragged among the orange ones.
    await page.click('#layer-list [data-block="0"] [data-part="chev"]');
    await page.click('#layer-list [data-block="1"] [data-part="chev"]');
    const colors = await page.locator('#layer-list .color-row').count();
    const src = page.locator('#layer-list .layer[data-object]').nth(0);
    const dst = page.locator('#layer-list .layer[data-object]').nth(3);
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
    // Creme is empty and gone, the fill is sewn in orange now.
    expect(await page.locator('#layer-list .color-row').count()).toBe(colors - 1);
    expect(await page.locator('#layer-list .color-row').first().innerText()).toMatch(/Orange[\s\S]*5/);
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
