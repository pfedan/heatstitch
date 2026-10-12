#!/usr/bin/env node
// Sews every motif of the library as the app puts it in (src/library/sew.ts, at MOTIF_MM on the
// default fabric and thread) and keeps only those Prüfen shows no red for. The ones left out are
// listed in tools/library/excluded.json with why, so the next build leaves them out too.
//
//   node tools/library/check.mjs            all motifs
//   node tools/library/check.mjs 1f98a ...  only these (prints, changes nothing)
//
// Runs the app's own code in Chromium from the Vite dev server.

import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const ROOT = new URL('../../', import.meta.url).pathname;
const LIB = `${ROOT}public/library/`;
const EXCLUDED = `${ROOT}tools/library/excluded.json`;
const only = process.argv.slice(2);

const index = JSON.parse(readFileSync(`${LIB}index.json`, 'utf8'));
const server = await createServer({ root: ROOT, server: { port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const results = [];
/** One motif sewn and checked in a page of the app. */
const check = (page, svg, name) =>
  page.evaluate(
    async ({ svg, name }) => {
      const { sewMotif, MOTIF_MM } = await import('/src/library/sew.ts');
      const { DEFAULT_PREPARE } = await import('/src/image/prepare.ts');
      const { digitizeDefaults } = await import('/src/digitize/digitize.ts');
      const { DEFAULT_PROFILE } = await import('/src/validation/profiles.ts');
      const { validatePattern } = await import('/src/validation/validate.ts');
      const { tally } = await import('/src/areas/ampel/verdict.ts');
      const { sewObjects } = await import('/src/model/objects.ts');
      const t0 = performance.now();
      try {
        const p = await sewMotif(svg, name, MOTIF_MM, DEFAULT_PREPARE, { ...digitizeDefaults(DEFAULT_PROFILE), trimMm: 3 });
        const v = tally(validatePattern(p, DEFAULT_PROFILE), []);
        const stitches = p.cmd.reduce((n, c) => n + (c === 0 ? 1 : 0), 0);
        return { light: v.verdict.light, reasons: v.reasons.filter((x) => x.level === 'critical').map((x) => x.type), stitches, objects: sewObjects(p).length, colors: p.colors.length, ms: Math.round(performance.now() - t0) };
      } catch (e) {
        return { light: 'failed', reasons: [String(e?.message ?? e)], ms: Math.round(performance.now() - t0) };
      }
    },
    { svg, name },
  );
try {
  const jobs = [];
  for (const source of index.sources) {
    for (const c of source.categories) {
      const pack = JSON.parse(readFileSync(`${ROOT}public/${source.base}${c}.json`, 'utf8'));
      for (const m of source.motifs.filter((m) => m.c === c && (!only.length || only.includes(m.id)))) jobs.push({ source, m, svg: pack[m.id] });
    }
  }
  // A few pages side by side: each motif is sewn in a worker of its page.
  const PAGES = Math.max(1, Math.min(Number(process.env.PAGES ?? 4), jobs.length));
  let next = 0;
  await Promise.all(
    Array.from({ length: PAGES }, async () => {
      const page = await browser.newPage();
      await page.goto(server.resolvedUrls.local[0]);
      while (next < jobs.length) {
        const { source, m, svg } = jobs[next++];
        const r = await check(page, svg, m.en);
        results.push({ source: source.id, id: m.id, name: m.de, ...r });
        if (only.length || r.light !== 'green') console.log(`${m.id} ${m.de}: ${r.light} ${r.reasons?.join(' ') ?? ''} ${r.stitches ?? ''} St. ${r.ms} ms`);
        if (results.length % 50 === 0) console.log(`${results.length} / ${jobs.length}`);
      }
    }),
  );
} finally {
  await browser.close();
  await server.close();
}

const counts = results.reduce((a, r) => ({ ...a, [r.light]: (a[r.light] ?? 0) + 1 }), {});
console.log(counts);
if (!only.length) {
  const out = results.filter((r) => r.light === 'red' || r.light === 'failed').sort((a, b) => a.id.localeCompare(b.id));
  const gone = new Set(out.map((r) => `${r.source}/${r.id}`));
  for (const source of index.sources) {
    source.motifs = source.motifs.filter((m) => !gone.has(`${source.id}/${m.id}`));
    for (const c of source.categories) {
      const file = `${ROOT}public/${source.base}${c}.json`;
      const pack = JSON.parse(readFileSync(file, 'utf8'));
      for (const id of Object.keys(pack)) if (gone.has(`${source.id}/${id}`)) delete pack[id];
      writeFileSync(file, JSON.stringify(pack));
    }
    source.categories = source.categories.filter((c) => source.motifs.some((m) => m.c === c));
  }
  writeFileSync(`${LIB}index.json`, JSON.stringify(index));
  writeFileSync(EXCLUDED, JSON.stringify(out.map(({ source, id, name, light, reasons }) => ({ source, id, name, light, reasons })), null, 1) + '\n');
}
