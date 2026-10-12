import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * Splits the test files over the CI machines (--shard) by how long they run, not by name.
 *
 * Vitest's own split gives each machine the same number of files, picked by a hash of the path, and
 * on a fresh CI machine runs them in no particular order: one machine got the four slowest files and
 * took 2:40 while another was done after 1:00. Here each file weighs its measured time
 * (tests/timings.json, `npm run test:timings` measures it anew), a file not measured yet its size
 * times the median time per byte. Then the standard rule for spreading jobs over machines (longest
 * processing time first, Graham 1969): the heaviest file goes to the machine with the least so far.
 * On each machine the files start longest first, so no slow file starts last.
 */
type Timings = Record<string, number>;

let timings: Timings | undefined;
const loadTimings = (): Timings => {
  if (!timings) {
    try {
      timings = JSON.parse(readFileSync(new URL('./timings.json', import.meta.url), 'utf8')) as Timings;
    } catch {
      timings = {};
    }
  }
  return timings;
};

const sizeOf = (file: string) => {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
};

export default class DurationSequencer extends BaseSequencer {
  private weights(files: TestSpecification[]): Map<TestSpecification, number> {
    const t = loadTimings();
    const root = this.ctx.config.root;
    const key = (f: TestSpecification) => path.relative(root, f.moduleId).split('\\').join('/');
    // Time per byte of the measured files, for files not measured yet.
    const rates = files.flatMap((f) => {
      const ms = t[key(f)];
      const size = sizeOf(f.moduleId);
      return ms !== undefined && size > 0 ? [ms / size] : [];
    }).sort((a, b) => a - b);
    const rate = rates.length ? rates[rates.length >> 1] : 1;
    return new Map(files.map((f) => [f, t[key(f)] ?? sizeOf(f.moduleId) * rate]));
  }

  /** Longest first, ties by path: the same order on every machine. */
  private byWeight(files: TestSpecification[]): TestSpecification[] {
    const w = this.weights(files);
    return [...files].sort((a, b) => w.get(b)! - w.get(a)! || (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0));
  }

  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const w = this.weights(files);
    const load = new Array<number>(count).fill(0);
    const mine: TestSpecification[] = [];
    for (const f of this.byWeight(files)) {
      let least = 0;
      for (let i = 1; i < count; i++) if (load[i] < load[least]) least = i;
      load[least] += w.get(f)!;
      if (least === index - 1) mine.push(f);
    }
    return mine;
  }

  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return this.byWeight(files);
  }
}
