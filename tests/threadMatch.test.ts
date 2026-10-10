import { describe, expect, it } from 'vitest';
import { deltaE2000, rgbToLab, type Rgb } from '../src/image/color';
import { matchThreads, nearestThread } from '../src/image/threadMatch';

const lab = (c: Rgb) => rgbToLab(...c);

describe('threads for the colors of an image, chosen together', () => {
  it('keeps eye white and light fur apart when each alone would take the same thread', () => {
    const white: Rgb = [250, 250, 248];
    const fur: Rgb = [236, 230, 214];
    // Alone, both take the same thread: the colors used to merge into one.
    expect(nearestThread(lab(fur)).thread.pecIndex).toBe(nearestThread(lab(white)).thread.pecIndex);
    const [a, b] = matchThreads([lab(white), lab(fur)]);
    expect(a.thread.pecIndex).not.toBe(b.thread.pecIndex);
    expect(a.thread.pecIndex).toBe(nearestThread(lab(white)).thread.pecIndex);
    // The second thread is still close to the color it stands for.
    expect(b.deltaE).toBeLessThan(12);
  });

  it('keeps dark pupils apart from a brown outline', () => {
    const outline: Rgb = [104, 71, 44];
    const pupil: Rgb = [45, 35, 30];
    expect(nearestThread(lab(pupil)).thread.pecIndex).toBe(nearestThread(lab(outline)).thread.pecIndex);
    const [a, b] = matchThreads([lab(outline), lab(pupil)]);
    expect([a.thread.name, b.thread.name]).toEqual(['Dark Brown', 'Black']);
  });

  it('still lets colors too close to tell apart share a thread', () => {
    const [a, b] = matchThreads([lab([200, 30, 40]), lab([204, 32, 38])]);
    expect(a.thread.pecIndex).toBe(b.thread.pecIndex);
  });

  it('changes nothing when every color has a thread of its own', () => {
    const colors: Rgb[] = [[237, 23, 31], [10, 85, 163], [255, 255, 0], [0, 0, 0]];
    const m = matchThreads(colors.map(lab));
    expect(m.map((x) => x.thread.pecIndex)).toEqual(colors.map((c) => nearestThread(lab(c)).thread.pecIndex));
  });

  it('loses less contrast across a light gradient than the nearest threads', () => {
    const steps: Rgb[] = [0, 1, 2, 3, 4, 5].map((k) => [250 - 12 * k, 245 - 14 * k, 235 - 18 * k]);
    const loss = (threads: Rgb[]) => {
      let e = 0;
      for (let i = 0; i < steps.length; i++)
        for (let j = i + 1; j < steps.length; j++)
          e += Math.max(0, deltaE2000(lab(steps[i]), lab(steps[j])) - deltaE2000(lab(threads[i]), lab(threads[j]))) ** 2;
      return e;
    };
    const rgb = (t: { r: number; g: number; b: number }): Rgb => [t.r, t.g, t.b];
    const near = steps.map((c) => rgb(nearestThread(lab(c)).thread));
    const together = matchThreads(steps.map(lab)).map((m) => rgb(m.thread));
    expect(loss(together)).toBeLessThan(loss(near));
  });
});

describe('matching many colors', () => {
  it('stays quick with sixteen colors', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 255;
    const colors = Array.from({ length: 16 }, () => lab([rnd(), rnd(), rnd()].map(Math.round) as Rgb));
    const t = performance.now();
    expect(matchThreads(colors)).toHaveLength(16);
    expect(performance.now() - t).toBeLessThan(500);
  });
});
