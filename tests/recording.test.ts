import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hashPattern } from '../src/dev/console';
import { decodeProject, encodeProject, projectSettings, type Project } from '../src/storage/project';
import { DEFAULTS } from '../src/settings';
import { STITCH, type Pattern } from '../src/model/pattern';
// @ts-expect-error: a plain Node script without types
import { readRecording, writeAblauf } from '../tools/recording/ablauf.mjs';

const pattern = (xs: number[]): Pattern => ({
  name: 't',
  format: 'dst',
  x: Int32Array.from(xs),
  y: Int32Array.from(xs.map((x) => x * 2)),
  cmd: Uint8Array.from(xs.map(() => STITCH)),
  colors: [{ r: 10, g: 20, b: 30 }],
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
});

const target = (name: string) => ({ role: 'button', name, css: `#${name}`, id: name, fx: 0.5, fy: 0.5 });

/** A small recording as the recorder writes it: a pick, a drag on the stage, typing, two design states in a row. */
function recording() {
  const moves = Array.from({ length: 60 }, (_, i) => [i * 16, i * 0.5, Math.sin(i / 6) * 3]);
  return {
    format: 'heatstitch-recording',
    version: 1,
    started: '2026-10-09T20:00:00.000Z',
    url: 'http://localhost/',
    lang: 'de',
    mac: true,
    viewport: { w: 1440, h: 900 },
    storage: { 'settings.v3': '{}', activeFile: '3' },
    start: new Uint8Array([1, 2, 3]),
    startState: { file: 'a.pes', n: 3, undo: 0, h: 'aaaaaaaa' },
    view: { scale: 4, cx: 10, cy: 20 },
    events: [
      { t: 100, k: 'click', at: target('Duplizieren'), button: 0, count: 1, mods: [] },
      { t: 300, k: 'state', file: 'a.pes', n: 4, undo: 1, h: '11111111' },
      { t: 500, k: 'state', file: 'a.pes', n: 5, undo: 1, h: '22222222' },
      { t: 900, k: 'stage', at: [1.5, 2.5], button: 0, mods: ['Shift'], moves, count: 1 },
      { t: 1200, k: 'key', key: 'ControlOrMeta+KeyZ' },
      // After a long pause: a new scene.
      { t: 9000, k: 'files', at: { css: '#file-input', id: 'file-input', fx: 0.5, fy: 0.5 }, files: [{ name: 'kirschen.svg', type: 'image/svg+xml', data: new Uint8Array([60, 115, 118, 103]) }] },
      { t: 9500, k: 'fill', at: { ...target('Text'), role: 'textbox' }, value: 'Anna', kind: 'text' },
    ],
  };
}

describe('session recording', () => {
  it('hashes a design by its stitches and colors', () => {
    const a = pattern([0, 10, 20]);
    expect(hashPattern(a)).toBe(hashPattern(pattern([0, 10, 20])));
    expect(hashPattern(a)).not.toBe(hashPattern(pattern([0, 10, 21])));
    expect(hashPattern(a)).not.toBe(hashPattern({ ...a, colors: [{ r: 10, g: 20, b: 31 }] }));
  });

  it('travels in the project file and the app still opens the project', async () => {
    const project: Project = { files: [], active: null, image: null, settings: projectSettings(DEFAULTS), recording: recording() };
    const bytes = await encodeProject(project);
    const dir = mkdtempSync(path.join(tmpdir(), 'hs-rec-'));
    const file = path.join(dir, 'p.heatstitch');
    writeFileSync(file, bytes);
    const rec = readRecording(file);
    expect([...rec.start]).toEqual([1, 2, 3]);
    expect([...rec.events[5].files[0].data]).toEqual([60, 115, 118, 103]);
    expect((await decodeProject(bytes)).files).toEqual([]);
  });

  it('becomes a screencast script: scenes at pauses, the last of several states, material beside it', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hs-ablauf-'));
    const r = writeAblauf(recording(), dir, 'test');
    expect(r).toEqual({ steps: 5, scenes: 2 });
    expect(readdirSync(path.join(dir, 'material')).sort()).toEqual(['kirschen.svg', 'start.heatstitch']);
    const text = readFileSync(path.join(dir, 'ablauf.mjs'), 'utf8');
    // Only the state the app ended at after the click is checked, not the one on the way.
    expect(text).toContain('"h":"22222222"');
    expect(text).not.toContain('11111111');
    // The stage drag keeps few points and the key held.
    const stroke = /await stroke\(s, \[1\.5,2\.5\], (\[.*?\]\]), \{"button":0,"mods":\["Shift"\]\}\)/.exec(text);
    expect(stroke).not.toBeNull();
    expect(JSON.parse(stroke![1]).length).toBeLessThanOrEqual(16);
    // The file of the open design stays out of the settings a replay sets.
    expect(text).not.toContain('activeFile');

    const ablauf = (await import(pathToFileURL(path.join(dir, 'ablauf.mjs')).href)).default;
    expect(ablauf.scenes).toHaveLength(2);
    expect(ablauf.viewport).toEqual({ width: 1440, height: 900 });
    expect(ablauf.storage).toEqual({ 'settings.v3': '{}' });
  });
});
