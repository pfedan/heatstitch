// The steps a script made from a recording uses (tools/recording/ablauf.mjs writes it). `s` is the
// API of tools/screencast/record.mjs (frames for a video) or of tools/recording/replay.mjs
// (as fast as the app allows): page, wait, move, click, drag, type, press.
import fs from 'node:fs';
import path from 'node:path';

/** How long check() waits for the design to reach the recorded state (s). */
const CHECK_S = 20;

/**
 * The element a recorded target names: by role and name as a person would say it, else by id,
 * else by its CSS path. Role and name only count when they still find as many elements as at the
 * recording, so a renamed button falls back instead of hitting a neighbour.
 */
export async function el(s, t) {
  const { page } = s;
  if (t.role && t.name) {
    const byRole = page.getByRole(t.role, { name: t.name, exact: true });
    const n = await byRole.count();
    if (n === 1 && !t.nth) return byRole;
    if (n > (t.nth ?? 0) && t.nth !== undefined) return byRole.nth(t.nth);
  }
  if (t.id) {
    const byId = page.locator(`[id="${t.id}"]`);
    if ((await byId.count()) === 1) return byId;
  }
  return page.locator(t.css).first();
}

/** The point in the element where the pointer was; small elements are hit in the middle. */
export async function at(s, t) {
  const loc = await el(s, t);
  await loc.waitFor({ state: 'visible', timeout: CHECK_S * 1000 });
  const b = await loc.boundingBox();
  const fx = b.width > 80 ? t.fx : 0.5;
  const fy = b.height > 80 ? t.fy : 0.5;
  return [b.x + b.width * fx, b.y + b.height * fy];
}

/** A point of the design (mm) on the page, wherever the view is now. */
export const stage = (s, x, y) => s.page.evaluate(([x, y]) => window.heatstitch.toPage(x, y), [x, y]);

const hold = async (s, mods, down) => {
  for (const m of mods ?? []) await (down ? s.page.keyboard.down(m) : s.page.keyboard.up(m));
};

/** A click with another button, more than once or with keys held; a plain click is s.click. */
export async function clickAt(s, point, { button = 0, count = 1, mods = [] } = {}) {
  if (button === 0 && count === 1 && !mods.length) return s.click(point);
  await s.move(point);
  await s.wait(0.2);
  await hold(s, mods, true);
  const opts = { button: button === 2 ? 'right' : button === 1 ? 'middle' : 'left' };
  for (let c = 1; c <= count; c++) {
    await s.page.mouse.down({ ...opts, clickCount: c });
    await s.page.mouse.up({ ...opts, clickCount: c });
  }
  await hold(s, mods, false);
  await s.wait(0.3);
}

/** A press on the stage that moved: from a point of the design, the pointer's way in mm at the zoom of the press. */
export async function stroke(s, start, moves, { button = 0, mods = [] } = {}) {
  const [x0, y0] = await stage(s, ...start);
  const { scale } = await s.page.evaluate(() => window.heatstitch.view());
  await s.move([x0, y0]);
  await hold(s, mods, true);
  await s.page.mouse.down({ button: button === 2 ? 'right' : 'left' });
  let t = 0;
  for (const [ms, dx, dy] of moves) {
    await s.move([x0 + dx * scale, y0 + dy * scale], Math.max(1 / 30, (ms - t) / 1000));
    t = ms;
  }
  await s.page.mouse.up({ button: button === 2 ? 'right' : 'left' });
  await hold(s, mods, false);
}

/** Zooms with the wheel at a point of the design. */
export async function wheel(s, point, dy) {
  await s.move(await stage(s, ...point), 0.3);
  await s.page.mouse.wheel(0, dy);
  await s.wait(0.3);
}

/** Types into a field, replacing what it held, so the video shows the letters coming. */
export async function typeInto(s, t, value) {
  const loc = await el(s, t);
  if (!value) return loc.fill('');
  await loc.selectText().catch(() => loc.focus());
  await s.type(value);
}

export async function fill(s, t, value) {
  await (await el(s, t)).fill(value);
  await s.wait(0.3);
}

export async function select(s, t, value) {
  await (await el(s, t)).selectOption(value);
  await s.wait(0.3);
}

/** Files dropped onto the page at a point, with the events a drop from the file manager brings. */
export async function dropFiles(s, files, point) {
  await s.move(point, 0.6);
  const data = files.map((f) => ({ name: path.basename(f), b64: fs.readFileSync(f).toString('base64'), type: typeOf(f) }));
  await s.page.evaluate(
    ({ data, x, y }) => {
      const dt = new DataTransfer();
      for (const f of data) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
      const target = document.elementFromPoint(x, y) ?? document.body;
      for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    },
    { data, x: point[0], y: point[1] },
  );
  await s.wait(0.5);
}

const TYPES = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const typeOf = (f) => TYPES[path.extname(f).slice(1).toLowerCase()] ?? 'application/octet-stream';

export async function setFiles(s, t, files) {
  await (await el(s, t)).setInputFiles(files);
  await s.wait(0.5);
}

/**
 * Waits until the active design is the one recorded at this point (same number of records, same
 * hash). When it does not get there, the replay has parted from the recording: s.report says
 * where (replay.mjs counts it), or a warning when there is no report.
 */
export async function check(s, want, where) {
  let got = null;
  for (let i = 0; i < CHECK_S * 10; i++) {
    got = await s.page.evaluate(() => window.heatstitch.state());
    if (got.n === want.n && got.h === want.h) return true;
    await s.wait(0.1);
  }
  const msg = `${where}: Stickmuster weicht ab: erwartet ${want.n} Stiche (${want.h}), ist ${got.n} (${got.h})`;
  if (s.report) await s.report(msg);
  else console.warn(msg);
  return false;
}

/**
 * Brings a fresh page to where the recording started: opens what was open then and sets the view.
 * The settings came earlier, with `storage` (see replay.mjs and record.mjs).
 */
export async function start(s, { project, state, view }) {
  if (project) {
    await s.page.locator('#file-input').setInputFiles(project);
    await check(s, state, 'Start');
  }
  await s.page.evaluate((v) => window.heatstitch.setView(v), view);
  await s.wait(0.3);
}
