// Guide screenshots for heatstitch, taken with Playwright from the built app.
//
//   npm run build && npm run preview &
//   node tools/guide-shots.mjs            # all shots
//   node tools/guide-shots.mjs cat hoop   # only these (a name may carry -de or -en)
//
// Writes JPEGs into public/guide/. Needs Playwright (global or local install) with Chromium;
// PLAYWRIGHT_CHROMIUM may point at a Chrome binary, GUIDE_URL at the served app
// (default http://localhost:4173/heatstitch/). Look at every new image before committing it.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..') + path.sep;
const FINAL = path.join(repo, 'public', 'guide') + path.sep;
const DEMOS = path.join(repo, 'public', 'examples', 'demos') + path.sep;
const URL = process.env.GUIDE_URL ?? 'http://localhost:4173/heatstitch/';
const CAT = 'examples/cat-60mm.pes';

/** Playwright from the local node_modules or a global install. */
async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const spec of ['playwright', process.env.PLAYWRIGHT_PATH, '/opt/node22/lib/node_modules/playwright', '/usr/lib/node_modules/playwright', '/usr/local/lib/node_modules/playwright']) {
    if (!spec) continue;
    try { return require(spec); } catch { /* next */ }
  }
  throw new Error('Playwright not found: npm i -g playwright && npx playwright install chromium');
}
const { chromium } = await loadPlaywright();
const browsers = new Set();

// ---- harness: browser, app, pages
async function boot(lang = 'de', viewport = { width: 1280, height: 800 }) {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  browsers.add(browser);
  const ctx = await browser.newContext({ viewport, colorScheme: 'dark', locale: lang === 'de' ? 'de-DE' : 'en-US', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 200)));
  await page.goto(URL);
  // a clean app: no remembered files or settings from an earlier run
  await page.evaluate(async () => { localStorage.clear(); const dbs = await indexedDB.databases(); for (const d of dbs) indexedDB.deleteDatabase(d.name); });
  await page.goto(URL);
  await page.waitForTimeout(400);
  // the language select sits in the "⋯" menu; force skips the visibility check
  await setControl(page, '#lang', lang);
  return { page, close: () => { browsers.delete(browser); return browser.close(); } };
}
/** Set a form control that sits in a closed popover (checkbox or select) and tell the app. */
async function setControl(page, sel, value) {
  await page.evaluate(([s, v]) => {
    const el = document.querySelector(s);
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [sel, value]);
  await page.waitForTimeout(300);
}
async function loadFile(page, file, wait = 2500) {
  await page.setInputFiles('#file-input', file);
  await page.waitForTimeout(wait);
}
/** Open an example by its data-cmd (cat, overlap, confetti, demo, ...) from the Stickmuster menu. */
async function example(page, cmd, wait = 3000) {
  await page.evaluate((c) => document.querySelector(`#load-example [data-cmd="${c}"]`).click(), cmd);
  await page.waitForTimeout(wait);
}
/** Gestalten (flow) or Prüfen (density). */
async function mode(page, m) {
  await page.click(`#modes input[value="${m}"]`, { force: true });
  await page.waitForTimeout(600);
}
/** The inspector tab: object or design. */
async function tab(page, t) {
  await page.click(`#insp-tabs [data-tab="${t}"]`);
  await page.waitForTimeout(400);
}
/** The level of the stage: objects, shape or stitches (the hidden radios the breadcrumb drives). */
async function level(page, v) {
  await page.click(`input[name="level"][value="${v}"]`, { force: true });
  await page.waitForTimeout(600);
}
/** Run a command by its label through the command search (Strg+K). */
async function cmd(page, text, wait = 800) {
  await page.click('#palette-open');
  await page.waitForTimeout(300);
  await page.fill('.palette-input', text);
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(wait);
  // no focus ring on the search box in the shot
  await page.evaluate(() => document.activeElement?.blur?.());
}

/** Take the final JPEG (optionally clipped). */
async function jpeg(page, name, clip) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: FINAL + name + '.jpg', type: 'jpeg', quality: 86, clip, timeout: 60000 });
  console.log('shot', name);
}
const sidebarTop = (page) => page.evaluate(() => { for (const s of ['.sidebar', '#inspector']) { const el = document.querySelector(s); if (el) el.scrollTop = 0; } });
/** Realistic threads on/off (the checkbox lives in the view menu; force skips the visibility check). */
async function realistic(page, on = true) {
  await setControl(page, '#realistic', on);
  await page.waitForTimeout(1500);
}
/** Scroll the right column so the element is at its top (plus an offset in px). */
const inspectorTo = (page, sel, offset = -8) => page.evaluate(([s, o]) => {
  const el = document.querySelector(s);
  // the nearest scrolling ancestor: the column, or a panel with its own scrollbar
  let box = el.parentElement;
  while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight + 1)) box = box.parentElement;
  if (!box) box = document.querySelector('#inspector');
  box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top + o;
}, [sel, offset]);
const stageBox = (page) => page.locator('#stage').boundingBox();
async function fit(page) { await page.click('#fit'); await page.waitForTimeout(500); }
/** Open the color row (by 1-based number) in #layer-list and return the object rows inside. */
async function expandColor(page, n) {
  const rows = page.locator('#layer-list > li.layer:not(.object)');
  const row = rows.nth(n - 1);
  await row.locator('button.chev').click();
  await page.waitForTimeout(400);
}
async function clickObject(page, index, shift = false) {
  await page.locator(`#layer-list li.object[data-object="${index}"]`).click({ modifiers: shift ? ['Shift'] : [] });
  await page.waitForTimeout(2000);
}
async function objectRows(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#layer-list li.object')).map((li) => ({ i: li.dataset.object, text: li.innerText.replace(/\s+/g, ' ') })));
}
async function clickText(page, text) {
  await page.getByRole('button', { name: text, exact: true }).first().click();
  await page.waitForTimeout(500);
}
async function wheelAt(page, x, y, steps, delta = -120) {
  await page.mouse.move(x, y);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, delta); await page.waitForTimeout(80); }
  await page.waitForTimeout(400);
}

/** Move the mouse off the canvas so no tooltip stays in the shot. */
const mouseAway = (page) => page.mouse.move(640, 30);
/**
 * Zoom in by `steps` wheel clicks at page point (px, py) and then bring that point to the stage
 * center. The pan uses zoom-in at P followed by zoom-out at Q, which shifts the view by
 * (Q - P) * (1 - 1/s) without changing the scale.
 */
async function zoomTo(page, px, py, steps) {
  const b = await stageBox(page);
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await wheelAt(page, px, py, steps);
  const k = 4, s = Math.exp(0.0015 * 120 * k), f = 1 - 1 / s;
  let P = { x: px, y: py };
  for (let i = 0; i < 12 && Math.hypot(cx - P.x, cy - P.y) > 2; i++) {
    const Q = { x: Math.min(b.x + b.width - 10, Math.max(b.x + 10, P.x + (cx - P.x) / f)), y: Math.min(b.y + b.height - 10, Math.max(b.y + 10, P.y + (cy - P.y) / f)) };
    await wheelAt(page, P.x, P.y, k, -120);
    await wheelAt(page, Q.x, Q.y, k, 120);
    P = { x: P.x + (Q.x - P.x) * f, y: P.y + (Q.y - P.y) * f };
  }
  await mouseAway(page);
  await page.waitForTimeout(300);
}

/**
 * Find a needle point (a small white dot of the stitch editor) on the canvas, near canvas-local
 * (cx, cy): returns page coordinates of the cluster center nearest to it, or null.
 */
async function findNeedlePoint(page, cx, cy, radius = 160) {
  const b = await page.locator('#canvas').boundingBox();
  const found = await page.evaluate(([cx, cy, r]) => {
    const c = document.querySelector('#canvas'); const ctx = c.getContext('2d');
    const sx = c.width / c.clientWidth, sy = c.height / c.clientHeight;
    const x0 = Math.max(0, Math.round((cx - r) * sx)), y0 = Math.max(0, Math.round((cy - r) * sy));
    const w = Math.min(c.width - x0, Math.round(2 * r * sx)), h = Math.min(c.height - y0, Math.round(2 * r * sy));
    const d = ctx.getImageData(x0, y0, w, h).data;
    const white = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (d[i * 4] > 235 && d[i * 4 + 1] > 235 && d[i * 4 + 2] > 235) white[i] = 1;
    const seen = new Uint8Array(w * h); const clusters = [];
    for (let i = 0; i < w * h; i++) {
      if (!white[i] || seen[i]) continue;
      const stack = [i]; seen[i] = 1; let n = 0, sx2 = 0, sy2 = 0, minX = w, maxX = 0, minY = h, maxY = 0;
      while (stack.length) {
        const k = stack.pop(); const x = k % w, y = (k - x) / w; n++; sx2 += x; sy2 += y;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx; if (white[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      if (n >= 4 && n <= 60 && bw <= 10 && bh <= 10 && Math.abs(bw - bh) <= 3) clusters.push({ x: (x0 + sx2 / n) / sx, y: (y0 + sy2 / n) / sy, n });
    }
    clusters.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    return clusters.slice(0, 5);
  }, [cx, cy, radius]);
  console.log('needle points', found);
  if (!found.length) return null;
  return { x: b.x + found[0].x, y: b.y + found[0].y };
}

/** Scroll the right column so the first element inside `container` with exactly this text is at the top. */
const inspectorToText = (page, container, text, offset = -8) => page.evaluate(([c, t, o]) => {
  const insp = document.querySelector('#inspector');
  const el = Array.from(document.querySelector(c).querySelectorAll('*')).find((e) => e.children.length === 0 && e.textContent.trim() === t);
  if (el) insp.scrollTop += el.getBoundingClientRect().top - insp.getBoundingClientRect().top + o;
  return !!el;
}, [container, text, offset]);
/** Wait until the element's text no longer matches, up to `ms`. */
async function waitGone(page, sel, re, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const txt = await page.evaluate((s) => document.querySelector(s)?.innerText || '', sel);
    if (!re.test(txt)) return true;
    await page.waitForTimeout(500);
  }
  return false;
}
/** Wait until the element's text matches, up to `ms`. */
async function waitText(page, sel, re, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const txt = await page.evaluate((s) => document.querySelector(s)?.innerText || '', sel);
    if (re.test(txt)) return true;
    await page.waitForTimeout(500);
  }
  return false;
}
/** Propose a correction and wait for the proposals card. */
async function propose(page, lang) {
  await page.click('#fix-all');
  if (!(await waitText(page, '#fix-report', /vorschl|proposal/i, 60000))) throw new Error('no proposals');
  await page.waitForTimeout(800);
}

const shots = {};

const T = {
  de: { suggest: 'Trennlinien und Querlinien vorschlagen', merge: 'Zu einem Objekt zusammenfassen', subtract: 'Obere Form ausschneiden', guide: 'Als Hilfslinie behalten', all: 'Alle auswählen', apply: 'Ausgewählte übernehmen', uncut: 'Ohne Schnitt', covering: 'Deckend', swirl: 'Wirbel', border: 'Umrandung', ready: 'Bereit zum Sticken', cutTool: 'Zerteilen', newDesign: 'Neues leeres Stickmuster' },
  en: { suggest: 'Suggest cut lines and lines across', merge: 'Combine into one object', subtract: 'Cut out the top shape', guide: 'Keep as a guide', all: 'Select all', apply: 'Apply selected', uncut: 'Not trimmed', covering: 'Covering', swirl: 'Swirl', border: 'Border', ready: 'Ready to stitch', cutTool: 'Cut apart', newDesign: 'New empty design' },
};

// 0. start: the start page "Was möchtest du sticken?"
shots.start = async (lang) => {
  const { page, close } = await boot(lang);
  await mouseAway(page);
  await jpeg(page, `start-${lang}`);
  await close();
};

// 1. cat: Gestalten, realistic, player at 62 %, the Stickmuster card on the right
shots.cat = async (lang) => {
  const { page, close } = await boot(lang);
  await example(page, 'cat');
  await realistic(page, true);
  await tab(page, 'design');
  // fully stitched and without marks: the finished patch, not a half-sewn cat (Daniel, review 2026-10-08)
  await fit(page);
  await page.keyboard.press('h');
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(800);
  await sidebarTop(page);
  await mouseAway(page);
  await jpeg(page, `cat-${lang}`);
  await close();
};

// 1b. shapes: the cat with the switch Stiche | Formen set to shapes
shots.shapes = async (lang) => {
  const { page, close } = await boot(lang);
  await example(page, 'cat');
  await page.waitForTimeout(1500);
  await page.click('#shapes-seg [data-shapes="on"]');
  await page.waitForTimeout(1500);
  await page.keyboard.press('h');
  await page.waitForTimeout(600);
  await fit(page);
  await mouseAway(page);
  await jpeg(page, `shapes-${lang}`);
  await close();
};

// 2. heatmap: overlap.pes in Prüfen, findings open
shots.heatmap = async (lang) => {
  const { page, close } = await boot(lang, { width: 1280, height: 960 });
  await loadFile(page, DEMOS + 'overlap.pes');
  await mode(page, 'density');
  await realistic(page, false);
  await page.evaluate(() => { document.querySelector('#findings-panel').open = true; });
  await fit(page);
  await waitGone(page, '#check-summary', /Wird berechnet|Working/, 60000);
  await sidebarTop(page);
  await mouseAway(page);
  await jpeg(page, `heatmap-${lang}`);
  await close();
};

// 3. objects: cat, color 2 expanded, its first object selected, the Objekt card
shots.objects = async (lang) => {
  const { page, close } = await boot(lang);
  await example(page, 'cat');
  await realistic(page, true);
  await expandColor(page, 2);
  // the first fill of the orange (the row before it is the outline as a running stitch)
  const rows = await objectRows(page);
  await clickObject(page, (rows.find((r) => /^(Füllung|Fill)/.test(r.text)) ?? rows[0]).i);
  await inspectorTo(page, '#object-panel');
  await sidebarTop(page);
  await mouseAway(page);
  await jpeg(page, `objects-${lang}`);
  await close();
};

/** patch.pes (the Aufnäher of the demo project) in Gestalten with realistic threads, the given colors expanded. */
async function patchFlow(page, ...colors) {
  await loadFile(page, DEMOS + 'patch.pes');
  await realistic(page, true);
  for (const c of colors) await expandColor(page, c);
}
// patch.pes is recognized from its stitches, so the object numbers change with the recognition.
// The shots find their objects by color row and content instead: the satin S is the first white
// satin in the lower text line, the star is the fills of the third color.
/** Rows of the open color n (1-based) as { i, text, n: stitch count }. */
async function colorRows(page, n) {
  return page.evaluate((n) => {
    const colors = Array.from(document.querySelectorAll('#layer-list > li.layer:not(.object)'));
    const row = colors[n - 1];
    const out = [];
    for (let el = row.nextElementSibling; el && el.classList.contains('object'); el = el.nextElementSibling) {
      const text = el.innerText.replace(/\s+/g, ' ').trim();
      out.push({ i: el.dataset.object, text, n: +((text.match(/(\d[\d.,]*)\s*$/) || [0, '0'])[1]).replace(/[.,]/g, '') });
    }
    return out;
  }, n);
}
/** Center (mm) of the selected object, read from the Mitte fields of the inspector. */
async function selectedCenter(page) {
  return page.evaluate(() => {
    const v = Array.from(document.querySelectorAll('#object-body input')).filter((x) => x.type === 'number' || x.inputMode === 'decimal').map((x) => +x.value.replace(',', '.'));
    return { x: v[2], y: v[3] };
  });
}
/** The satin S of the patch: the first white satin whose center lies in the lower text line. Leaves it selected. */
async function selectPatchS(page) {
  const rows = await colorRows(page, 4);
  let best = null;
  for (const r of rows) {
    await clickObject(page, r.i);
    const c = await selectedCenter(page);
    if (c.y > 65 && (!best || c.x < best.x)) best = { ...r, ...c };
  }
  if (!best) throw new Error('no S found');
  await clickObject(page, best.i);
  return best;
}
/** The star of the patch: the fills of the third color, biggest first. */
async function starParts(page) {
  const rows = await colorRows(page, 3);
  return rows.filter((r) => /^(Füllung|Fill)/.test(r.text)).sort((a, b) => b.n - a.n);
}

/** The rung tool (R) on the selected satin, then one of its bar buttons. */
async function rungTool(page, cmdText) {
  await page.keyboard.press('r');
  await page.waitForTimeout(800);
  // the bar folds its buttons into a "..." menu on narrow stages, so the command search runs it
  await cmd(page, cmdText, 1200);
}

// 4. satin: rungs on the satin S of the patch
/** The brush character 永 from the examples (PR #171), made a satin by its stitch type and opened in the Direction tool (R). */
async function brushSatin(page) {
  await example(page, 'brushSvg');
  await realistic(page, true);
  await expandColor(page, 1);
  const rows = await objectRows(page);
  await clickObject(page, rows[0].i);
  await page.locator('#object-stitches button', { hasText: /^Satin$/ }).first().click();
  await page.waitForTimeout(3000);
  const b = await stageBox(page);
  await wheelAt(page, b.x + b.width / 2, b.y + b.height / 2, 1, 120);
  await page.keyboard.press('r');
  await page.waitForTimeout(2500);
}
shots.satin = async (lang) => {
  const { page, close } = await boot(lang);
  await brushSatin(page);
  await inspectorTo(page, '#object-panel');
  await sidebarTop(page);
  await mouseAway(page);
  await jpeg(page, `satin-${lang}`);
  await close();
};

// 5. merge: the two parts the star was recognized as, combined into one object
shots.merge = async (lang) => {
  const { page, close } = await boot(lang);
  await patchFlow(page, 3);
  const parts = await starParts(page);
  await clickObject(page, parts[0].i);
  for (const p of parts.slice(1)) await clickObject(page, p.i, true);
  await cmd(page, T[lang].merge, 1500);
  await inspectorTo(page, '#object-panel');
  await mouseAway(page);
  await sidebarTop(page);
  await jpeg(page, `merge-${lang}`);
  await close();
};

// 6. stitches: one needle point of the star moved by hand
shots.stitches = async (lang) => {
  const { page, close } = await boot(lang);
  await patchFlow(page, 3);
  // the whole star: its two recognized parts combined first (as in the merge shot), so nothing is faded
  const parts = await starParts(page);
  await clickObject(page, parts[0].i);
  for (const p of parts.slice(1)) await clickObject(page, p.i, true);
  await cmd(page, T[lang].merge, 1500);
  await level(page, 'stitches');
  await page.waitForTimeout(400);
  const b = await stageBox(page);
  await zoomTo(page, b.x + 325, b.y + 240, 1);
  await wheelAt(page, b.x + b.width / 2, b.y + b.height / 2, 2); // two steps closer
  await page.waitForTimeout(500);
  const pt = await findNeedlePoint(page, b.width / 2, b.height / 2);
  if (!pt) throw new Error('no needle point found');
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  // a shift one can see: about 2 mm sideways, the row bends visibly
  for (let i = 1; i <= 12; i++) { await page.mouse.move(pt.x + i * 7, pt.y + i * 3); await page.waitForTimeout(50); }
  await page.mouse.up();
  await page.waitForTimeout(800);
  await mouseAway(page);
  await page.waitForTimeout(400);
  await inspectorTo(page, '#object-panel');
  await sidebarTop(page);
  await jpeg(page, `stitches-${lang}`);
  await close();
};

// 8. lettering: "Minka" in Pacificlo under the cat, font list open
shots.lettering = async (lang) => {
  const { page, close } = await boot(lang);
  await example(page, 'cat');
  await realistic(page, true);
  await page.click('#lettering-new');
  await page.waitForTimeout(1500);
  const ta = page.locator('#lettering-body textarea.lettering-text');
  await ta.fill('Minka');
  await page.waitForTimeout(1200);
  await page.click('#lettering-body .font-current');
  await page.waitForTimeout(600);
  await page.locator('#lettering-body .font-row[data-font="pacificlo"]').scrollIntoViewIfNeeded();
  await page.locator('#lettering-body .font-row[data-font="pacificlo"]').click();
  await page.waitForTimeout(1500);
  await page.click('#lettering-body .font-current'); // open the list again
  await page.waitForTimeout(2500);
  await fit(page);
  await page.waitForTimeout(800);
  await fit(page);
  const b = await stageBox(page);
  await wheelAt(page, b.x + b.width / 2, b.y + b.height * 0.6, 1, 120); // one step out: the lettering sits below the cat
  await inspectorTo(page, '#lettering-panel');
  await mouseAway(page);
  await sidebarTop(page);
  await jpeg(page, `lettering-${lang}`);
  await close();
};

// 9. jumps: confetti.pes in Prüfen, an untrimmed long jump selected
shots.jumps = async (lang) => {
  const { page, close } = await boot(lang);
  await loadFile(page, DEMOS + 'confetti.pes');
  await mode(page, 'density');
  await realistic(page, true);
  await page.evaluate(() => { const d = document.querySelector('#jumps-panel'); if (d && 'open' in d) d.open = true; });
  await page.locator('#jumps .f-chip', { hasText: T[lang].uncut }).click();
  await page.waitForTimeout(500);
  await page.locator('#jumps li.jump').first().click();
  await page.waitForTimeout(1500);
  await fit(page);
  await inspectorTo(page, '#jumps-panel');
  await mouseAway(page);
  await jpeg(page, `jumps-${lang}`);
  await close();
};

/** Prüfen on a file with the given fabric, realistic off, findings open. */
async function density(page, fabric, real = false) {
  await mode(page, 'density');
  await realistic(page, real);
  await setControl(page, '#fabric', fabric);
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelector('#findings-panel').open = true; });
  await sidebarTop(page);
}

// 10. findings: patch.pes on woven fabric, the Ampel "Klappt das?" with its rows
shots.findings = async (lang) => {
  const { page, close } = await boot(lang, { width: 1280, height: 960 });
  await loadFile(page, DEMOS + 'patch.pes');
  await density(page, 'woven');
  await fit(page);
  await mouseAway(page);
  await jpeg(page, `findings-${lang}`);
  await close();
};

// 11. correct: cat on knit, proposals, hovering the second row
shots.correct = async (lang) => {
  const { page, close } = await boot(lang, { width: 1280, height: 960 });
  await example(page, 'cat');
  await density(page, 'knit');
  await propose(page, lang);
  await inspectorTo(page, '#fix-report', -60);
  const row = page.locator('#fix-report .plan-row').nth(1);
  await row.hover();
  await page.waitForTimeout(1200);
  await jpeg(page, `correct-${lang}`);
  await close();
};

// 12. compare: patch.pes corrected, split view with the comparison table
shots.compare = async (lang) => {
  const { page, close } = await boot(lang, { width: 1280, height: 960 });
  await loadFile(page, DEMOS + 'patch.pes');
  await density(page, 'woven', true);
  await page.evaluate(() => document.querySelector('input[name="fix-goal"][value="caution"]').click());
  await page.waitForTimeout(500);
  await propose(page, lang);
  await page.locator('#fix-report button', { hasText: T[lang].all }).first().click();
  await page.waitForTimeout(500);
  await page.locator('#fix-report button', { hasText: T[lang].apply }).first().click();
  await page.waitForTimeout(4000);
  await page.click('#compare-toggle');
  await page.locator('#compare-table').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(2000);
  await inspectorTo(page, '#compare-table', -120);
  await mouseAway(page);
  await jpeg(page, `compare-${lang}`);
  await close();
};

// 13. image: the example image in step 3, Stiche und Ergebnis
shots.image = async (lang) => {
  const { page, close } = await boot(lang);
  await page.evaluate(() => document.querySelector('#image-start').click());
  await page.waitForTimeout(1000);
  await page.click('#image-example');
  await page.waitForTimeout(4000);
  await page.click('#image-next');
  if (!(await waitText(page, '#image-result', /Stiche|Stitches/, 90000))) throw new Error('no stitches');
  await page.click('input[name="image-view"][value="stitches"]', { force: true });
  await page.waitForTimeout(1000);
  if (!(await page.isChecked('#realistic'))) await realistic(page, true);
  await page.waitForTimeout(1500);
  await sidebarTop(page);
  await mouseAway(page);
  await jpeg(page, `image-${lang}`);
  await close();
};


// 13b. crop: the example image in step 1 with the crop frame after "Auf Motiv zuschneiden"
shots.crop = async (lang) => {
  const { page, close } = await boot(lang);
  await page.evaluate(() => document.querySelector('#image-start').click());
  await page.waitForTimeout(1000);
  await page.click('#image-example');
  await page.waitForTimeout(4000);
  await page.click('#image-crop-motif');
  await page.waitForTimeout(1500);
  // then pull two corners of the frame in, so the outside is dimmed and the width follows the cut
  const drag = async (x0, y0, x1, y1) => {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 6 });
    await page.mouse.move(x1, y1, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(600);
  };
  await drag(500, 170, 600, 215);
  await drag(1080, 748, 980, 690);
  await sidebarTop(page);
  await mouseAway(page);
  await jpeg(page, `crop-${lang}`);
  await close();
};

// 14. border: satin border in its own thread around the red circle of overlap.pes
shots.border = async (lang) => {
  const { page, close } = await boot(lang);
  await loadFile(page, DEMOS + 'overlap.pes');
  await realistic(page, true);
  await expandColor(page, 1);
  await clickObject(page, 0);
  // "Satin" in the Umrandung/Border group is the last Satin button of the stitch settings
  await page.locator('#object-stitches button', { hasText: /^Satin$/ }).last().click();
  await page.waitForTimeout(2500);
  await page.locator('#object-stitches button.border-thread').click();
  await page.waitForTimeout(600);
  await page.locator('.color-pop .color-grid button.pick').nth(12).click();
  await page.waitForTimeout(2500);
  await inspectorToText(page, '#object-stitches', T[lang].border, -64);
  await mouseAway(page);
  await jpeg(page, `border-${lang}`);
  await close();
};

// 15. hoop: the 100 × 100 mm hoop around the cat, then one that is too small
shots.hoop = async (lang) => {
  const { page, close } = await boot(lang);
  await example(page, 'cat');
  await realistic(page, true);
  await tab(page, 'design');
  await setControl(page, '#hoop', '100x100');
  await page.waitForTimeout(600);
  await fit(page);
  await mouseAway(page);
  await sidebarTop(page);
  await jpeg(page, `hoop-${lang}`);
  await setControl(page, '#hoop', '50x50');
  await page.waitForTimeout(600);
  await fit(page);
  await mouseAway(page);
  await sidebarTop(page);
  await jpeg(page, `hoop-small-${lang}`);
  await close();
};

// 16. fabric (shared): the canvas only, with a textured fabric behind the threads
shots.fabric = async () => {
  const { page, close } = await boot('de');
  await example(page, 'cat');
  await realistic(page, true);
  await page.evaluate(() => document.querySelectorAll('#bg-swatches button')[2].click()); // Natur: a light fabric color
  await page.waitForTimeout(800);
  for (const look of ['knit', 'leather']) {
    await setControl(page, '#fabric-look', look);
    await page.waitForTimeout(2500);
    await mouseAway(page);
    const b = await stageBox(page);
    await jpeg(page, `fabric-${look}`, { x: b.x, y: b.y, width: b.width, height: b.height });
  }
  await close();
};

// 17. save: the Speichern menu with hoop 100 × 100 and PES
shots.save = async (lang) => {
  const { page, close } = await boot(lang);
  await example(page, 'cat');
  await setControl(page, '#hoop', '100x100');
  await page.waitForTimeout(600);
  await page.click('#save-button');
  await page.waitForTimeout(600);
  await page.click('#save-pop input[name="save-fmt"][value="pes"]', { force: true });
  await page.waitForTimeout(400);
  await mouseAway(page);
  const b = await page.locator('#save-pop').boundingBox();
  await jpeg(page, `save-${lang}`, { x: b.x - 8, y: b.y - 8, width: b.width + 16, height: b.height + 16 });
  await close();
};

// 20. ready: the Stickmuster card scrolled to "Bereit zum Sticken"
shots.ready = async (lang) => {
  const { page, close } = await boot(lang);
  await example(page, 'cat');
  await realistic(page, true);
  await tab(page, 'design');
  await setControl(page, '#hoop', '100x100');
  await page.waitForTimeout(600);
  await inspectorToText(page, '#inspector', T[lang].ready, -64);
  await mouseAway(page);
  await jpeg(page, `ready-${lang}`);
  await close();
};

// 21. cut: the sweater of the cat cut in two with Zerteilen (X)
shots.cut = async (lang) => {
  const { page, close } = await boot(lang);
  // the Aufnäher of the demo project: its disc is a fill the app knows (recognized fills can't be cut)
  await example(page, 'demo');
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const li = Array.from(document.querySelectorAll('#file-list li')).find((l) => /Aufnäher|Patch/.test(l.innerText));
    (li.querySelector('button, .name, span') ?? li).click();
  });
  await page.waitForTimeout(2500);
  await realistic(page, true);
  await expandColor(page, 1);
  await clickObject(page, (await colorRows(page, 1))[0].i);
  await fit(page);
  await cmd(page, T[lang].cutTool, 800);
  // A straight drag (Shift) through the middle of the disc; the cut runs on release.
  const b = await stageBox(page);
  const y = b.y + b.height * 0.5;
  await page.keyboard.down('Shift');
  await drag(page, b.x + b.width * 0.08, y, b.x + b.width * 0.92, y, 10);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(2500);
  await mouseAway(page);
  await sidebarTop(page);
  await jpeg(page, `cut-${lang}`);
  await close();
};

/** Drag on the page from (x0, y0) to (x1, y1) in a few steps. */
async function drag(page, x0, y0, x1, y1, steps = 8, mods = []) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(700);
}
/** Click at a page point, optionally with shift. */
async function clickAt(page, x, y, shift = false) {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(700);
}

// 7. draw: a small house drawn with the four tools, the ground line as a guide
shots.draw = async (lang) => {
  const { page, close } = await boot(lang);
  await cmd(page, T[lang].newDesign, 1500);
  await level(page, 'shape');
  const b = await stageBox(page);
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  // the house body
  await page.click('[data-draw="rect"]');
  await drag(page, cx - 90, cy - 10, cx + 90, cy + 120);
  // a window: a circle inside the body, then cut out of it
  await page.click('[data-draw="ellipse"]');
  await drag(page, cx - 55, cy + 15, cx - 15, cy + 55);
  await page.keyboard.press('Escape'); // leave the tool, the circle stays selected
  await page.waitForTimeout(500);
  await clickObject(page, 1); // the window, then the body added via the object list
  await clickObject(page, 0, true);
  await cmd(page, T[lang].subtract, 1500);
  // the roof with the path tool: three corners, closed on the first node
  await level(page, 'shape');
  await page.click('[data-draw="pen"]');
  await clickAt(page, cx - 105, cy - 12);
  await clickAt(page, cx, cy - 100);
  await clickAt(page, cx + 105, cy - 12);
  await clickAt(page, cx - 105, cy - 12);
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // the roof in its own thread, a red (Daniel, review 2026-10-08)
  await clickObject(page, 1); // the roof
  await page.locator('#object-body .thread-sw').first().click();
  await page.waitForTimeout(600);
  // the first clearly red swatch of the grid, whatever the catalog names it
  const red = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.color-pop .color-grid button.pick')];
    const i = all.findIndex((b) => { const m = b.style.background.match(/rgb\((\d+), (\d+), (\d+)\)/); return m && +m[1] > 170 && +m[2] < 70 && +m[3] < 70; });
    if (i >= 0) all[i].click();
    return i >= 0 ? all[i].title : `none of ${all.length}: ${all.slice(0, 5).map((b) => b.title).join(' | ')}`;
  });
  console.log('roof thread', red);
  await page.waitForTimeout(1500);
  await level(page, 'shape');
  // the sun top right
  await page.click('[data-draw="ellipse"]');
  await drag(page, cx + 150, cy - 150, cx + 205, cy - 95);
  await page.keyboard.press('Escape'); // leaves the tool and the selection
  await page.waitForTimeout(500);
  await clickObject(page, 2); // the sun
  // the sun in its own thread: the color square in the head of the Objekt card
  await page.locator('#object-body .thread-sw').first().click();
  await page.waitForTimeout(600);
  await page.locator('.color-pop .color-grid button.pick').nth(12).click(); // Yellow
  await page.waitForTimeout(1500);
  // a wavy ground line under the house (freehand), then made a guide
  await level(page, 'shape');
  await page.click('[data-draw="free"]');
  await page.mouse.move(cx - 200, cy + 160);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) { await page.mouse.move(cx - 200 + i * 10, cy + 160 + Math.sin(i / 3) * 12); await page.waitForTimeout(20); }
  await page.mouse.up();
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await clickObject(page, 3); // the ground line
  await cmd(page, T[lang].guide, 1200);
  await page.keyboard.press('Escape');
  await fit(page);
  await wheelAt(page, cx, cy - 60, 2, 120); // two steps out: the fit leaves out the guide line
  await mouseAway(page);
  await sidebarTop(page);
  await jpeg(page, `draw-${lang}`);
  await close();
};

// 18. sections and gestickt (shared): the character 永 after Vorschlagen, and sewn, stage only
shots.sections = async () => {
  const { page, close } = await boot('de');
  await brushSatin(page);
  // the floating view bar would sit over the right foot: hide it in this crop
  await page.evaluate(() => {
    const z = Array.from(document.querySelectorAll('*')).find((e) => e.children.length === 0 && /^\d+\s*%$/.test(e.textContent.trim()));
    let el = z; while (el && !['absolute', 'fixed'].includes(getComputedStyle(el).position)) el = el.parentElement;
    if (el) el.style.visibility = 'hidden';
  });
  const clip = { x: 390, y: 140, width: 540, height: 570 };
  await cmd(page, T.de.suggest, 6000);
  await mouseAway(page);
  await jpeg(page, 'sections', clip);
  // the finished look: tool closed, nothing selected, no jump and trim marks, light not following the mouse
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.mouse.click(920, 600);
  await page.waitForTimeout(1500);
  await setControl(page, 'input[data-mark="jumps"]', false);
  await setControl(page, 'input[data-mark="trims"]', false);
  await setControl(page, '#live-light', false);
  await page.waitForTimeout(1500);
  await mouseAway(page);
  await jpeg(page, 'gestickt', clip);
  await close();
};

// 19. decor: the sweater of the cat in the pattern Wirbel, the pattern tabs
shots.decor = async (lang) => {
  const { page, close } = await boot(lang);
  await example(page, 'cat');
  await realistic(page, true);
  await expandColor(page, 4); // Rot: the sweater
  const rows = await objectRows(page);
  const big = rows.map((r) => ({ i: r.i, n: +(r.text.match(/(\d[\d.,]*)\s*$/) || [0, 0])[1].replace(/[.,]/g, '') })).sort((a, b) => b.n - a.n)[0];
  await clickObject(page, big.i);
  await page.locator('.pattern-groups button', { hasText: T[lang].covering }).click();
  await page.waitForTimeout(500);
  await page.locator('.pattern-tiles [role="radio"]', { hasText: T[lang].swirl }).click();
  await page.waitForTimeout(3000);
  await inspectorTo(page, '.pattern-groups', -60);
  await mouseAway(page);
  await jpeg(page, `decor-${lang}`);
  await close();
};

/** The selected object's thread: the first swatch of the color grid whose color passes `test` (r, g, b). */
async function pickThread(page, test) {
  await page.locator('#object-body .thread-sw').first().click();
  await page.waitForTimeout(600);
  const got = await page.evaluate((src) => {
    const ok = new Function('r', 'g', 'b', `return ${src}`);
    const all = [...document.querySelectorAll('.color-pop .color-grid button.pick')];
    const i = all.findIndex((b) => { const m = b.style.background.match(/rgb\((\d+), (\d+), (\d+)\)/); return m && ok(+m[1], +m[2], +m[3]); });
    if (i >= 0) all[i].click();
    return i >= 0;
  }, test);
  if (!got) console.log('no swatch for', test);
  await page.waitForTimeout(1500);
}

// 7b. trace: the example flower laid under a new design as its tracing image, half traced:
// center and petals done, the first leaf drawn, the path tool on the second leaf
shots.trace = async (lang) => {
  const { page, close } = await boot(lang);
  await cmd(page, T[lang].newDesign, 1500);
  await tab(page, 'design');
  await page.setInputFiles('.trace-panel input[type=file]', repo + 'public/examples/image-example.svg');
  await page.waitForTimeout(2500);
  // laid 90 mm wide in the middle of the 100 x 100 mm hoop: the picture's 400 px are 450 screen px
  await page.click('[data-command="design.trace.lock"]');
  await page.waitForTimeout(300);
  const b = await stageBox(page);
  const ox = b.x + b.width / 2, oy = b.y + b.height / 2 - 17;
  const at = (u, v) => [ox + (u - 200) * 1.125, oy + (v - 200) * 1.125];
  const pen = async (pts, close = true) => {
    await page.click('[data-draw="pen"]');
    for (const [u, v] of close ? [...pts, pts[0]] : pts) await clickAt(page, ...at(u, v));
    await page.waitForTimeout(close ? 1200 : 300);
  };
  // the top petal with the ellipse, then the others with the path tool along the picture
  await page.click('[data-draw="ellipse"]');
  await drag(page, ...at(166, 30), ...at(234, 154));
  await page.waitForTimeout(800);
  await pickThread(page, 'r > 190 && g < 110 && b > 70 && b < 160');
  for (const deg of [72, 144, 216, 288]) {
    const a = (deg * Math.PI) / 180;
    const pts = Array.from({ length: 10 }, (_, k) => {
      const t = (k / 10) * 2 * Math.PI;
      const [x, y] = [34 * Math.cos(t), -58 + 62 * Math.sin(t)];
      return [200 + x * Math.cos(a) - y * Math.sin(a), 150 + x * Math.sin(a) + y * Math.cos(a)];
    });
    await pen(pts);
  }
  await page.click('[data-draw="ellipse"]');
  await drag(page, ...at(166, 116), ...at(234, 184));
  await page.waitForTimeout(800);
  await pickThread(page, 'r > 220 && g > 170 && b < 80');
  await pen([[199, 292], [170, 284], [146, 268], [128, 236], [160, 244], [186, 264]]);
  await pickThread(page, 'g > 140 && r < 120 && b < 110');
  // the second leaf under way: three nodes set, the path follows the pointer
  await pen([[201, 262], [232, 254], [256, 234]], false);
  await page.mouse.move(...at(266, 206));
  await realistic(page, true);
  await page.mouse.move(...at(266, 206));
  await page.waitForTimeout(500);
  // the design page with the tracing image, while the path is under way
  await tab(page, 'design');
  await page.mouse.move(...at(268, 204));
  await page.waitForTimeout(400);
  // the stitch tip under the pointer would cover the leaf
  await page.evaluate(() => { for (const el of document.querySelectorAll('.tooltip, #tooltip')) el.hidden = true; });
  await sidebarTop(page);
  await jpeg(page, `trace-${lang}`);
  await close();
};

// ---- runner
const names = process.argv.slice(2);
const list = names.length ? names : Object.keys(shots);
for (const n of list) {
  const [base, lang] = n.match(/^(.*?)(?:-(de|en))?$/).slice(1);
  if (!shots[base]) { console.log('unknown shot', n); continue; }
  const langs = shots[base].length ? (lang ? [lang] : ['de', 'en']) : [null];
  for (const l of langs) {
    try { await shots[base](l); } catch (e) {
      console.log('FAILED', n, l, e.message.slice(0, 300));
      for (const b of browsers) await b.close().catch(() => {});
      browsers.clear();
    }
  }
}
process.exit(0);
