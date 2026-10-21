import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import type { ViteDevServer } from 'vite';
import { downloadTotal, withProgress } from '../src/wasm/progress';
import { arcOf } from '../src/ui/boot';
import { bootPage } from '../src/build/boot';
import { de, en } from '../src/i18n/areas/boot';
import { SETTINGS_KEY } from '../src/settings';
import { launchChromium } from './helpers/browser';

/** A response that sends `chunks` one after another, with these headers. */
function streamed(chunks: number[], headers: Record<string, string>, status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const n of chunks) c.enqueue(new Uint8Array(n).fill(7));
      c.close();
    },
  });
  return new Response(body, { status, headers });
}

describe('the progress of the core download', () => {
  it('counts against Content-Length only when the body comes uncompressed', () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(downloadTotal(h({ 'content-length': '1000' }), 3000)).toBe(1000);
    expect(downloadTotal(h({ 'content-length': '1000', 'content-encoding': 'identity' }), 3000)).toBe(1000);
    // Compressed: the length is that of the gzip bytes, the reader counts the bytes after it.
    expect(downloadTotal(h({ 'content-length': '1000', 'content-encoding': 'gzip' }), 3000)).toBe(3000);
    expect(downloadTotal(h({ 'content-encoding': 'br' }), 3000)).toBe(3000);
    expect(downloadTotal(h({}), 3000)).toBe(3000);
    // Neither: unknown, the ring only turns.
    expect(downloadTotal(h({ 'content-encoding': 'gzip' }), 0)).toBeNull();
  });

  it('reports each chunk as it arrives, ends at 1 and hands the bytes on unchanged', async () => {
    const seen: (number | null)[] = [];
    const res = withProgress(streamed([100, 200, 700], { 'content-length': '1000', 'content-type': 'application/octet-stream' }), 5000, (d) => seen.push(d));
    expect(res.headers.get('content-type')).toBe('application/wasm');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(1000);
    expect(bytes.every((b) => b === 7)).toBe(true);
    expect(seen).toEqual([0, 0.1, 0.3, 1]);
  });

  it('never goes above 1 when the known size is off, and stays unknown without a total', async () => {
    const over: (number | null)[] = [];
    await withProgress(streamed([600, 600], { 'content-encoding': 'gzip' }), 1000, (d) => over.push(d)).arrayBuffer();
    expect(over).toEqual([0, 0.6, 1]);
    const unknown: (number | null)[] = [];
    await withProgress(streamed([10, 10], {}), 0, (d) => unknown.push(d)).arrayBuffer();
    expect(unknown).toEqual([null, null, null]);
  });

  it('fails on a server error instead of handing on an error page as the core', () => {
    expect(() => withProgress(streamed([10], {}, 404), 10, () => {})).toThrow(/404/);
  });

  it('draws a ring with a gap that grows with the progress', () => {
    expect(arcOf(0)).toBe(6);
    expect(arcOf(100)).toBe(94);
    expect(arcOf(50)).toBeGreaterThan(arcOf(25));
    expect(arcOf(250)).toBe(94);
  });
});

describe('the splash texts in the page', () => {
  const html = bootPage(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  const boot = html.slice(html.indexOf('<div class="boot"'), html.indexOf('<noscript>'));

  it('carries both languages and the key the settings are kept under', () => {
    expect(html).not.toContain('__BOOT_');
    expect(boot).toContain(JSON.stringify(de['boot.loading']));
    expect(boot).toContain(JSON.stringify(en['boot.failed']));
    expect(boot).toContain(JSON.stringify(SETTINGS_KEY));
  });

  it('names only texts it has, and its script is plain old JavaScript', () => {
    const keys = [...boot.matchAll(/data-i18n(?:-aria)?="([\w.]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(3);
    for (const k of keys) expect(Object.keys(de), k).toContain(k);
    const script = /<script>([\s\S]*?)<\/script>/.exec(boot)![1];
    expect(() => new Function(script)).not.toThrow();
    // Old browsers have to read it to say they are too old: no arrows, let, const or template strings.
    expect(script).not.toMatch(/=>|\blet\b|\bconst\b|`/);
  });

  it('refuses a page without the splash script', () => {
    expect(() => bootPage('<html></html>')).toThrow(/splash/);
  });
});

/**
 * The splash in a real browser: gone once the app is set up, having shown how far the core was;
 * a core that does not load ends in a message with a reload button, in the page's language.
 *
 * Runs only with BROWSER_TESTS set: `BROWSER_TESTS=1 npx vitest run tests/boot.test.ts`.
 */
const on = !!process.env.BROWSER_TESTS;

describe.skipIf(!on)('the splash in the browser', () => {
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

  it('shows the progress of the core and leaves once the app is set up', { timeout: 60_000 }, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      const w = window as unknown as { seen: string[] };
      w.seen = [];
      new MutationObserver((ms) => {
        for (const m of ms) if ((m.target as Element).id === 'boot-ring') w.seen.push((m.target as Element).getAttribute('aria-valuenow') ?? 'none');
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['aria-valuenow'] });
    });
    try {
      await page.goto(url);
      await page.waitForSelector('#boot', { state: 'detached', timeout: 2000 });
      const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
      expect(seen.at(-1)).toBe('100');
      expect(await page.locator('#design-button').isVisible()).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it('says so with a reload button when the core does not load', { timeout: 60_000 }, async () => {
    // Its own browser: the failed load is the point here, not an error of the app (helpers/browser).
    const { chromium } = await import('playwright');
    const own = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
    try {
      const page = await own.newPage({ locale: 'de-DE' });
      await page.route('**/*.wasm', (r) => r.fulfill({ status: 503, body: 'down' }));
      await page.goto(url);
      await page.waitForSelector('#boot[data-state="error"]', { timeout: 20_000 });
      expect(await page.locator('#boot [data-i18n="boot.failed"]').innerText()).toBe(de['boot.failed']);
      expect(await page.locator('#boot [data-i18n="boot.old"]').isVisible()).toBe(false);
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('boot-reload');
      expect(await page.locator('#boot').getAttribute('aria-busy')).toBe('false');
      // The reload tries again; this time the core comes.
      await page.unroute('**/*.wasm');
      await page.click('#boot-reload');
      await page.waitForSelector('html[data-ready]', { state: 'attached', timeout: 20_000 });
    } finally {
      await own.close();
    }
  });
});
