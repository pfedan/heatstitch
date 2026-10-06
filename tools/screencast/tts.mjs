// Voices the scenes of a screencast and keeps every result, so the same request is never sent
// twice. A take is stored as ton/<key>.flac next to the ablauf, where <key> is a fingerprint of
// model, voice, language, direction prompt and text; ton/takes.json lists what each key was.
//
//   node tools/screencast/tts.mjs <ablauf.mjs> <out-dir>
//       writes <out-dir>/ton/sNN.wav for every scene; with REPLICATE_API_TOKEN set, missing
//       takes are made on Replicate first, otherwise they are listed and the run fails
//   node tools/screencast/tts.mjs <ablauf.mjs> --import <key> <file>
//       stores a take made elsewhere (for example through the Replicate connector)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const [ablaufPath, ...rest] = process.argv.slice(2);
const ablauf = (await import(pathToFileURL(path.resolve(ablaufPath)).href)).default;
const tonDir = path.join(path.dirname(path.resolve(ablaufPath)), 'ton');
const takesFile = path.join(tonDir, 'takes.json');
fs.mkdirSync(tonDir, { recursive: true });
const takes = fs.existsSync(takesFile) ? JSON.parse(fs.readFileSync(takesFile, 'utf8')) : {};

const request = (scene) => ({
  model: ablauf.voice.model,
  voice: ablauf.voice.voice,
  language: ablauf.voice.language,
  prompt: ablauf.voice.prompt,
  text: scene.say,
});
const keyOf = (req) => crypto.createHash('sha256').update(JSON.stringify(req)).digest('hex').slice(0, 16);
const store = (key, req, file) => {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-c:a', 'flac', path.join(tonDir, `${key}.flac`)]);
  takes[key] = req;
  fs.writeFileSync(takesFile, JSON.stringify(takes, null, 2) + '\n');
};

if (rest[0] === '--import') {
  const [, key, file] = rest;
  const scene = ablauf.scenes.find((s) => keyOf(request(s)) === key);
  if (!scene) throw new Error(`no scene has the key ${key}`);
  store(key, request(scene), file);
  console.log(`stored ${key}`);
  process.exit(0);
}

const outDir = rest[0];
fs.mkdirSync(path.join(outDir, 'ton'), { recursive: true });
const missing = [];
for (const [i, scene] of ablauf.scenes.entries()) {
  const req = request(scene);
  const key = keyOf(req);
  const flac = path.join(tonDir, `${key}.flac`);
  if (!fs.existsSync(flac)) {
    if (process.env.REPLICATE_API_TOKEN) {
      const res = await fetch(`https://api.replicate.com/v1/models/${req.model}/predictions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json',
          Prefer: 'wait',
        },
        body: JSON.stringify({
          input: { text: req.text, voice: req.voice, language_code: req.language, prompt: req.prompt },
        }),
      });
      const prediction = await res.json();
      if (prediction.status !== 'succeeded') throw new Error(`scene ${i + 1}: ${prediction.error ?? prediction.status}`);
      const wav = path.join(outDir, 'ton', `take-${key}.wav`);
      fs.writeFileSync(wav, Buffer.from(await (await fetch(prediction.output)).arrayBuffer()));
      store(key, req, wav);
    } else {
      missing.push({ scene: i + 1, key, ...req });
      continue;
    }
  }
  const wav = path.join(outDir, 'ton', `s${String(i + 1).padStart(2, '0')}.wav`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', flac, wav]);
}
if (missing.length) {
  console.log(JSON.stringify(missing, null, 2));
  console.error(`${missing.length} take(s) missing; make them and store each with --import <key> <file>`);
  process.exit(1);
}
console.log(`${ablauf.scenes.length} scenes voiced`);
