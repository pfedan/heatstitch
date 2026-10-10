import { afterEach, expect } from 'vitest';
import type { Browser, Page } from 'playwright';

/**
 * Chromium for the browser tests. Every page it opens is watched: an uncaught error or a
 * console.error in the app fails the test that caused it, whatever the test itself checks.
 */
export async function launchChromium(): Promise<Browser> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  // browser.newPage goes through newContext too, so watching each new context covers both.
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const ctx = await newContext(options);
    ctx.on('page', watch);
    return ctx;
  };
  return browser;
}

const errors: string[] = [];

function watch(page: Page): void {
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
}

afterEach(() => {
  const seen = errors.splice(0);
  expect(seen, 'errors in the page').toEqual([]);
});
