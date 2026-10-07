/**
 * Every value that depends on the thread weight. Factor: Madeira spacing table (60 wt 0.35, 40 wt
 * 0.40, 30 wt 0.50, 12 wt 0.80 mm), the ratio to the 0.40 mm reference.
 */

export type ThreadId = '60' | '40' | '30' | '12';

export interface Thread {
  id: ThreadId;
  factor: number;
}

export const THREAD: Readonly<Record<ThreadId, Thread>> = {
  '60': { id: '60', factor: 1.15 },
  '40': { id: '40', factor: 1 },
  '30': { id: '30', factor: 0.8 },
  '12': { id: '12', factor: 0.5 },
};

/** Thinnest first, as the pickers list them. */
export const THREADS: readonly Thread[] = [THREAD['60'], THREAD['40'], THREAD['30'], THREAD['12']];
