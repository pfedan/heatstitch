/**
 * Small reactive values for the interface: a signal holds a value, an effect runs again when a
 * signal it read changes, computed derives a value. Enough for the shell; no library.
 */

type Runner = { run: () => void; deps: Set<Set<Runner>> };

let current: Runner | null = null;
let batching = 0;
const pending = new Set<Runner>();

export interface Signal<T> {
  (): T;
  set(v: T): void;
  update(fn: (v: T) => T): void;
  /** The value without subscribing the running effect. */
  peek(): T;
}

export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const subs = new Set<Runner>();
  const read = (() => {
    if (current) {
      subs.add(current);
      current.deps.add(subs);
    }
    return value;
  }) as Signal<T>;
  read.peek = () => value;
  read.set = (v: T) => {
    if (Object.is(v, value)) return;
    value = v;
    for (const r of [...subs]) pending.add(r);
    if (!batching) flush();
  };
  read.update = (fn) => read.set(fn(value));
  return read;
}

function flush(): void {
  while (pending.size) {
    const runs = [...pending];
    pending.clear();
    for (const r of runs) r.run();
  }
}

/** Runs fn now and again whenever a signal it read changes. Returns the way to stop it. */
export function effect(fn: () => void): () => void {
  const runner: Runner = {
    deps: new Set(),
    run: () => {
      for (const d of runner.deps) d.delete(runner);
      runner.deps.clear();
      const prev = current;
      current = runner;
      try {
        fn();
      } finally {
        current = prev;
      }
    },
  };
  runner.run();
  return () => {
    for (const d of runner.deps) d.delete(runner);
    runner.deps.clear();
    pending.delete(runner);
  };
}

/** A value derived from other signals, recomputed when they change. */
export function computed<T>(fn: () => T): () => T {
  const s = signal<T>(undefined as T);
  effect(() => s.set(fn()));
  return () => s();
}

/** Changes several signals and lets the effects run once afterwards. */
export function batch(fn: () => void): void {
  batching++;
  try {
    fn();
  } finally {
    batching--;
    if (!batching) flush();
  }
}
