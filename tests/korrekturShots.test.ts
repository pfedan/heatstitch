import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planFix } from '../src/correct/engine/solve';
import { writePes } from '../src/writers/pes';
import { corpus } from './helpers/korrekturCorpus';

/**
 * Before/after pictures of the correction engine (SHOTS=1): each case of SHOTS_CASES (or a default set)
 * is fixed, written as PES before and after, opened in the app in a browser and photographed with
 * realistic threads and as Dichte. Pictures go to tests/bench/shots/ (or SHOTS_DIR).
 */
const run = process.env.SHOTS ? describe : describe.skip;
const CASES = (process.env.SHOTS_CASES ?? 'demos/overlap.pes (woven)|demos/letters.pes (woven)|Aufnäher (woven)|Handtuch (knit)|cat-60mm.pes (knit)').split('|');
const env = (globalThis as any).process.env as Record<string, string | undefined>;

run('correction pictures', () => {
  it('photographs before and after', async () => {
    const dir = new URL(env.SHOTS_DIR ? `file://${env.SHOTS_DIR}/` : './bench/shots/', import.meta.url);
    mkdirSync(dir, { recursive: true });
    const cases = corpus().filter((c) => CASES.includes(c.name));
    const files: { name: string; before: URL; after: URL; fabric: string }[] = [];
    for (const c of cases) {
      const r = await planFix(c.pattern, c.profile, 'all', { trimMm: 2 });
      const slug = c.name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
      const before = new URL(`${slug}-vorher.pes`, dir);
      const after = new URL(`${slug}-nachher.pes`, dir);
      writeFileSync(before, writePes(c.pattern));
      writeFileSync(after, writePes(r.pattern));
      files.push({ name: slug, before, after, fabric: c.profile.fabric });
    }
    const { createServer } = await import('vite');
    const { chromium } = await import('playwright');
    const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
    await server.listen();
    const url = server.resolvedUrls!.local[0];
    const browser = await chromium.launch(env.PW_CHROMIUM ? { executablePath: env.PW_CHROMIUM } : {});
    try {
      for (const f of files) {
        for (const [when, file] of [['vorher', f.before], ['nachher', f.after]] as const) {
          const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
          const page = await ctx.newPage();
          await page.goto(url);
          await page.selectOption('#lang', 'de');
          await page.setInputFiles('#file-input', decodeURIComponent(file.pathname));
          await page.locator('#layer-list .layer').first().waitFor();
          await page.locator('#realistic').check({ force: true });
          await page.waitForTimeout(2500);
          await page.locator('#canvas').screenshot({ path: decodeURIComponent(new URL(`${f.name}-${when}-echt.png`, dir).pathname) });
          await page.locator('input[name=mode][value=density]').check({ force: true });
          await page.selectOption('#fabric', f.fabric);
          await page.waitForTimeout(2500);
          await page.locator('#canvas').screenshot({ path: decodeURIComponent(new URL(`${f.name}-${when}-dichte.png`, dir).pathname) });
          await ctx.close();
        }
      }
    } finally {
      await browser.close();
      await server.close();
    }
    expect(files.length).toBe(CASES.length);
  }, 1_800_000);
});
