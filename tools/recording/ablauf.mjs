// Turns a session recorded in the app (heatstitch.record() in the browser console, then saving the
// project) into a screencast script like docs/screencasts/*/ablauf.mjs. The same script replays
// the session for a bug (tools/recording/replay.mjs) and is the first draft of a tutorial: fill in
// say, text and textEn per scene, smooth the pointer, then record as usual.
//
//   node tools/recording/ablauf.mjs projekt.heatstitch OUT_DIR
//
// Writes OUT_DIR/ablauf.mjs and OUT_DIR/material/ (what was open at the start, and every file
// opened or dropped while recording).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** A pause longer than this (ms) starts a new scene. */
const SCENE_GAP_MS = 5000;
/** Waits are kept up to this (s); longer pauses were the person thinking, not the app working. */
const MAX_WAIT_S = 3;
/** Points a drag on the stage keeps at most, after simplifying its path. */
const STROKE_POINTS = 16;

/** The recording in a .heatstitch file, with its files as Buffers. */
export function readRecording(file) {
  let bytes = fs.readFileSync(file);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = zlib.gunzipSync(bytes);
  const doc = JSON.parse(bytes.toString('utf8'), (_k, v) => (v && typeof v === 'object' && v.$bin === 'u8' ? Buffer.from(v.b64, 'base64') : v));
  if (doc?.format !== 'heatstitch-project') throw new Error(`${file}: keine heatstitch-Projektdatei`);
  if (!doc.recording) throw new Error(`${file}: enthält keine Aufzeichnung (heatstitch.record() vor dem Speichern)`);
  return doc.recording;
}

/** Ramer-Douglas-Peucker on the moves of a stroke, keeping the first and last. */
function simplify(moves, keep) {
  if (moves.length <= keep) return moves;
  let eps = 0.05;
  let out = moves;
  while (out.length > keep && eps < 100) {
    out = rdp(moves, eps);
    eps *= 1.5;
  }
  return out;
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [, ax, ay] = pts[0];
  const [, bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let worst = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [, x, y] = pts[i];
    const d = Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / len;
    if (d > worst) [worst, at] = [d, i];
  }
  if (worst <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, at + 1), eps).slice(0, -1), ...rdp(pts.slice(at), eps)];
}

const js = (v) => JSON.stringify(v);
/** A target without what only the recorder needed, written compactly. */
const target = (t) => js(Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined)));
const sayTarget = (t) => (t.name ? `${t.role} „${t.name}“` : t.id ? `#${t.id}` : t.css);
const time = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** Unique file names in material/, the same file (same bytes) once. */
function materialStore(dir) {
  const byContent = new Map();
  const used = new Set();
  return (f) => {
    const key = `${f.name}:${f.data.length}:${f.data.subarray(0, 64).toString('hex')}`;
    if (byContent.has(key)) return byContent.get(key);
    const ext = path.extname(f.name);
    const base = path.basename(f.name, ext).replace(/[^\w.-]+/g, '-') || 'datei';
    let name = `${base}${ext}`;
    for (let i = 2; used.has(name); i++) name = `${base}-${i}${ext}`;
    used.add(name);
    fs.writeFileSync(path.join(dir, name), f.data);
    byContent.set(key, name);
    return name;
  };
}

/** The script lines for one step, with a comment saying what it was. */
function stepLines(e, n, store) {
  const where = js(`Schritt ${n}`);
  switch (e.k) {
    case 'click': {
      const opts = e.button || e.count > 1 || e.mods.length ? `, ${js({ button: e.button, count: e.count, mods: e.mods })}` : '';
      const what = e.button === 2 ? 'Rechtsklick' : e.count > 1 ? 'Doppelklick' : 'Klick';
      return [`// ${what} auf ${sayTarget(e.at)}`, `await clickAt(s, await at(s, ${target(e.at)})${opts});`];
    }
    case 'stage': {
      const opts = e.button || e.mods.length ? `, ${js({ button: e.button, mods: e.mods })}` : '';
      if (!e.moves.length) {
        const c = e.button || e.count > 1 || e.mods.length ? `, ${js({ button: e.button, count: e.count, mods: e.mods })}` : '';
        return [`// ${e.count > 1 ? 'Doppelklick' : 'Klick'} auf der Bühne bei ${e.at[0]} mm, ${e.at[1]} mm`, `await clickAt(s, await stage(s, ${e.at.join(', ')})${c});`];
      }
      const moves = simplify(e.moves, STROKE_POINTS);
      return [`// Ziehen auf der Bühne ab ${e.at[0]} mm, ${e.at[1]} mm`, `await stroke(s, ${js(e.at)}, ${js(moves)}${opts});`];
    }
    case 'wheel':
      return [`// ${e.dy < 0 ? 'Hineinzoomen' : 'Herauszoomen'} mit dem Mausrad`, `await wheel(s, ${js(e.at)}, ${Math.round(e.dy)});`];
    case 'key':
      return [`await s.press(${js(e.key)});`];
    case 'fill':
      if (e.kind === 'text') return [`// Eingabe in ${sayTarget(e.at)}`, `await typeInto(s, ${target(e.at)}, ${js(e.value)});`];
      if (e.kind === 'select') return [`// Auswahl in ${sayTarget(e.at)}`, `await select(s, ${target(e.at)}, ${js(e.value)});`];
      return [`// Wert in ${sayTarget(e.at)}`, `await fill(s, ${target(e.at)}, ${js(e.value)});`];
    case 'files':
      return [`// Datei gewählt: ${e.files.map((f) => f.name).join(', ')}`, `await setFiles(s, ${target(e.at)}, [${e.files.map((f) => `material(${js(store(f))})`).join(', ')}]);`];
    case 'drop': {
      const point = e.stage ? `await stage(s, ${e.stage.join(', ')})` : js(e.page);
      return [`// Datei hineingezogen: ${e.files.map((f) => f.name).join(', ')}`, `await dropFiles(s, [${e.files.map((f) => `material(${js(store(f))})`).join(', ')}], ${point});`];
    }
    case 'drag':
      return [`// Ziehen von ${sayTarget(e.from)} nach ${sayTarget(e.to)}`, `await s.drag([await at(s, ${target(e.from)}), await at(s, ${target(e.to)})]);`];
    case 'state':
      return [`await check(s, ${js({ n: e.n, h: e.h })}, ${where});`];
    default:
      return [`// unbekannter Schritt ${js(e.k)}`];
  }
}

/** Splits the steps into scenes at long pauses and where a file comes in. */
function scenesOf(events) {
  const scenes = [];
  let cur = null;
  let prevT = 0;
  for (const e of events) {
    const newFile = e.k === 'files' || e.k === 'drop';
    if (!cur || (e.k !== 'state' && (e.t - prevT > SCENE_GAP_MS || (newFile && cur.steps.some((x) => x.k !== 'state'))))) {
      cur = { from: e.t, steps: [] };
      scenes.push(cur);
    }
    cur.steps.push(e);
    if (e.k !== 'state') prevT = e.t;
  }
  return scenes;
}

/** Of several design states in a row only the last counts: the ones before were the app still working. */
const lastStates = (events) => events.filter((e, i) => e.k !== 'state' || events[i + 1]?.k !== 'state');

export function writeAblauf(rec, outDir, source = 'Aufzeichnung') {
  const matDir = path.join(outDir, 'material');
  fs.mkdirSync(matDir, { recursive: true });
  const store = materialStore(matDir);
  if (rec.start) fs.writeFileSync(path.join(matDir, 'start.heatstitch'), rec.start);
  // Relative inside the repository (docs/screencasts/...), else the absolute file URL.
  const stepsFile = fileURLToPath(new URL('./steps.mjs', import.meta.url));
  const repo = path.resolve(path.dirname(stepsFile), '../..');
  const rel = path.relative(path.resolve(outDir), stepsFile).split(path.sep).join('/');
  const steps = path.resolve(outDir).startsWith(repo + path.sep) ? (rel.startsWith('.') ? rel : `./${rel}`) : pathToFileURL(stepsFile).href;

  const events = lastStates(rec.events);
  let n = 0;
  const scenes = scenesOf(events).map((sc, i) => {
    const body = [];
    let prevT = sc.from;
    for (const e of sc.steps) {
      const gap = Math.min(MAX_WAIT_S, (e.t - prevT) / 1000);
      if (e.k !== 'state' && gap >= 0.3) body.push(`await s.wait(${gap.toFixed(1)});`);
      if (e.k !== 'state') {
        n++;
        prevT = e.t;
      }
      body.push(...stepLines(e, n, store));
    }
    return [
      '    {',
      `      // Szene ${i + 1}, ab ${time(sc.from)} der Aufzeichnung`,
      "      say: '',",
      "      text: '',",
      "      textEn: '',",
      '      run: async (s) => {',
      ...body.map((l) => `        ${l}`),
      '      },',
      '    },',
    ].join('\n');
  });

  const storage = Object.fromEntries(Object.entries(rec.storage).filter(([k]) => k !== 'activeFile'));
  const out = `// Aus einer Aufzeichnung (${source}, ${rec.started}, ${rec.lang}, Fenster ${rec.viewport.w} × ${rec.viewport.h}).
// Abspielen: node tools/recording/replay.mjs ${path.join(outDir, 'ablauf.mjs')}
// Als Video: Sprechtext je Szene ergänzen, dann wie jedes ablauf.mjs (docs/screencasts/konzept.md).
//
// Punkte auf der Bühne stehen in mm des Stickmusters, Knöpfe und Felder mit Rolle und Namen;
// check() vergleicht das Stickmuster mit dem aufgezeichneten Stand.
import { fileURLToPath } from 'node:url';
import { at, check, clickAt, dropFiles, fill, select, setFiles, stage, start, stroke, typeInto, wheel } from '${steps}';

const material = (name) => fileURLToPath(new URL(\`./material/\${name}\`, import.meta.url));

export default {
  title: ${js(`Aufzeichnung vom ${rec.started.slice(0, 10)}`)},
  viewport: ${js({ width: rec.viewport.w, height: rec.viewport.h })},
  locale: ${js(rec.lang === 'de' ? 'de-DE' : 'en-US')},
  /** localStorage before the app loads (settings and view choices at the start), keys without the storage prefix. */
  storage: ${js(storage)},
  prepare: (s) => start(s, { project: ${rec.start ? "material('start.heatstitch')" : 'null'}, state: ${js({ n: rec.startState.n, h: rec.startState.h })}, view: ${js(rec.view)} }),
  voice: {
    model: 'google/gemini-3.1-flash-tts',
    voice: 'Aoede',
    language: 'de-DE',
    prompt:
      'Speak German in a calm, friendly and clear voice, like an experienced embroiderer showing a friend something on the computer. Natural pace, small pauses between thoughts. Let real enthusiasm show when something nice happens.',
  },
  lead: 0.4,
  tail: 0.6,
  scenes: [
${scenes.join('\n')}
  ],
};
`;
  fs.writeFileSync(path.join(outDir, 'ablauf.mjs'), out);
  return { steps: n, scenes: scenes.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, outDir] = process.argv.slice(2);
  if (!file || !outDir) {
    console.error('node tools/recording/ablauf.mjs projekt.heatstitch OUT_DIR');
    process.exit(2);
  }
  const r = writeAblauf(readRecording(file), outDir, path.basename(file));
  console.log(`${path.join(outDir, 'ablauf.mjs')}: ${r.steps} Schritte in ${r.scenes} Szenen`);
}
