import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Sequence } from '../src/app/types';
import { createLive } from '../src/areas/ampel/live';
import type { ReadyFix } from '../src/areas/ampel/engine';
import { EngineClient, type WorkerLike } from '../src/correct/engine/client';
import { handleEngine, type EngineRequest } from '../src/correct/engine/worker';
import type { WorkerClient } from '../src/density/client';
import { sewObjects } from '../src/model/objects';
import type { Pattern } from '../src/model/pattern';
import { forgetAll, holdMemory } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';
import type { FileList, LoadedFile } from '../src/ui/fileList';
import { measurePattern, type Measurement } from '../src/validation/measure';
import { classify, ALL_CHECKS } from '../src/validation/validate';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);
const same = (a: Pattern, b: Pattern) => a.cmd.length === b.cmd.length && a.x.every((v, i) => v === b.x[i]) && a.y.every((v, i) => v === b.y[i]) && a.cmd.every((v, i) => v === b.cmd[i]);

/** Workers in this process: each request goes through structured clone, as across a real worker. */
const spawn = (): WorkerLike => {
  let alive = true;
  const w: WorkerLike = {
    onmessage: null,
    postMessage: (req: EngineRequest) => {
      // A worker has its own memory: what it learns stays there.
      const release = holdMemory();
      void handleEngine(structuredClone(req))
        .finally(release)
        .then((data) => alive && w.onmessage?.({ data } as MessageEvent));
    },
    terminate: () => void (alive = false),
  };
  return w;
};

describe('Ampel on the correction engine', () => {
  it('offers a measured density fix, applies it as one step and takes it back exactly', async () => {
    forgetAll();
    const p0 = load('demos/overlap.pes');
    const profile = { fabric: 'woven', thread: '40' } as const;
    const file = { pattern: p0, acks: [], validation: classify(measurePattern(p0), profile, ALL_CHECKS) } as unknown as LoadedFile;
    const files = { active: file } as unknown as FileList;
    const commits: Pattern[] = [];
    const commit = (q: Pattern, m: Measurement) => {
      commits.push(q);
      file.pattern = q;
      file.validation = classify(m, profile, ALL_CHECKS);
    };
    const engine = createLive({
      files,
      seq: (p) => ({ objects: sewObjects(p) }) as unknown as Sequence,
      validator: { measure: async (p: Pattern, skip?: Uint8Array) => measurePattern(p, skip) } as unknown as WorkerClient,
      trimMm: () => 2,
      commit,
      onRequest: () => false,
      client: new EngineClient(1, spawn),
      settleMs: 0,
    });
    const r0 = engine.report()!;
    expect(r0.fabrics.woven.verdict.light).toBe('red');
    expect(r0.fabrics.woven.fixes?.density?.direct.state).toBe('pending');
    // Every pending part settles.
    const fix = await new Promise<ReadyFix>((resolve) =>
      engine.onChange(() => {
        const d = engine.report()!.fabrics.woven.fixes?.density;
        if (d?.direct.state === 'ready' && d.rest.state !== 'pending') resolve(d.direct.value);
      }),
    );
    expect(fix.outcome.fixedMm2).toBeGreaterThan(0);
    expect(fix.objects.length).toBeGreaterThan(0);
    const done = engine.apply(fix)!;
    expect(done).toBeTruthy();
    expect(commits.length).toBe(1);
    expect(engine.revertable().length).toBe(fix.objects.length);
    // The new version gets its own fixes; the old one is gone.
    expect(engine.report()!.fabrics.woven.verdict.light).not.toBe('red');
    expect(engine.revert(done)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(commits.length).toBe(2);
    expect(same(commits[1], p0)).toBe(true);
    expect(engine.revertable()).toEqual([]);
  }, 300_000);
});
