// Measures how long each test file runs and writes tests/timings.json, which tests/sequencer.ts
// splits the files over the CI machines by. Run it again (npm run test:timings) when files have
// been added or have become much slower; a file not in it is weighed by its size meanwhile.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'timings-'));
const out = join(dir, 'report.json');
try {
  execFileSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${out}`], { stdio: 'inherit' });
} catch {
  // A failing test still has its time; the report is written all the same.
}
const report = JSON.parse(readFileSync(out, 'utf8'));
rmSync(dir, { recursive: true, force: true });
const timings = Object.fromEntries(
  report.testResults
    .map((r) => [relative(process.cwd(), r.name).split('\\').join('/'), Math.round(r.endTime - r.startTime)])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
);
writeFileSync(new URL('../tests/timings.json', import.meta.url), `${JSON.stringify(timings, null, 1)}\n`);
console.log(`tests/timings.json: ${Object.keys(timings).length} files`);
