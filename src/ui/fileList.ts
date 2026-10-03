import { t } from '../i18n';
import { patternStats, type Pattern, type PatternStats } from '../model/pattern';
import { parsePattern, SUPPORTED_EXTENSIONS } from '../parsers';
import {
  acksOf,
  deleteFile,
  fromStored,
  listFiles,
  loadActiveKey,
  putFile,
  saveAcks,
  saveActiveKey,
  saveWorking,
  toStored,
  type StoredPattern,
} from '../storage/fileStore';
import { liveAcknowledgements, openWorst, type Acknowledgement } from '../validation/acks';
import type { Profile } from '../validation/profiles';
import {
  CAUTION,
  classify,
  CRITICAL,
  type Checks,
  type Measurement,
  type ValidationResult,
} from '../validation/validate';

export interface LoadedFile {
  id: number;
  fileName: string;
  pattern?: Pattern;
  stats?: PatternStats;
  /** Set once the worker has measured the file. */
  measurement?: Measurement;
  /** The measurement classified with the current profile. */
  validation?: ValidationResult;
  error?: string;
  /** The pattern as loaded; `pattern` differs once it was corrected or edited. */
  original?: Pattern;
  /** Measurement and classification of `original`, kept for the comparison view. */
  originalMeasurement?: Measurement;
  originalValidation?: ValidationResult;
  /** Earlier versions (undo) and undone versions (redo), most recent last. */
  undo: Pattern[];
  redo: Pattern[];
  /** Key of the stored copy that survives page reloads. */
  storeKey?: number;
  /** Findings the user (or the correction) accepted as they are. */
  acks: Acknowledgement[];
}

interface FileData {
  name: string;
  data: ArrayBuffer;
  storeKey?: number;
  working?: StoredPattern;
  acks?: Acknowledgement[];
}

/** Versions kept per file for undo. */
const HISTORY = 50;

export class FileList {
  files: LoadedFile[] = [];
  activeId: number | null = null;
  private nextId = 1;

  constructor(
    private list: HTMLUListElement,
    private onActivate: (f: LoadedFile | null) => void,
    /** Measures a newly parsed file (in a worker). */
    private measure: (p: Pattern) => Promise<Measurement>,
    private onValidated: (f: LoadedFile) => void,
    private profile: Profile,
    private checks: Checks,
  ) {}

  /** Re-classifies every measured file for a new profile or set of checks. */
  setProfile(profile: Profile, checks: Checks): void {
    this.profile = profile;
    this.checks = checks;
    for (const f of this.files) {
      if (f.measurement) f.validation = classify(f.measurement, profile, checks);
      if (f.originalMeasurement) f.originalValidation = classify(f.originalMeasurement, profile, checks);
    }
    this.render();
  }

  get active(): LoadedFile | null {
    return this.files.find((f) => f.id === this.activeId) ?? null;
  }

  /** Parses the given files, stores them, adds them and activates the first successfully parsed one. */
  async add(files: Iterable<File>): Promise<void> {
    // Copy first: an input's FileList is live and gets cleared while we await.
    const list = Array.from(files).filter((file) =>
      SUPPORTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext)),
    );
    const data = await Promise.all(list.map(async (file) => ({ name: file.name, data: await file.arrayBuffer() })));
    const first = await this.addData(data, true);
    if (first) this.activate(first.id);
    else this.render();
  }

  /** Re-adds the files stored by an earlier visit and activates the one that was active then. */
  async restore(): Promise<void> {
    const stored = await listFiles();
    if (!stored.length) return;
    const first = await this.addData(stored.map((rec) => ({ name: rec.name, data: rec.data, storeKey: rec.key, working: rec.working, acks: acksOf(rec) })), false);
    // Files the user added while we were reading storage keep the focus.
    if (this.activeId !== null) return this.render();
    const activeKey = loadActiveKey();
    const active = this.files.find((f) => f.pattern && f.storeKey === activeKey) ?? first;
    if (active) this.activate(active.id);
    else this.render();
  }

  private async addData(list: FileData[], persist: boolean): Promise<LoadedFile | null> {
    let first: LoadedFile | null = null;
    for (const { name, data, storeKey, working, acks } of list) {
      const entry: LoadedFile = { id: this.nextId++, fileName: name, storeKey, undo: [], redo: [], acks: acks ?? [] };
      try {
        const original = parsePattern(new Uint8Array(data), name);
        entry.original = original;
        entry.pattern = original;
        if (working) {
          const edited = fromStored(original, working);
          if (edited) {
            entry.pattern = edited;
            // One undo step leads back to the original.
            entry.undo.push(original);
          } else {
            console.warn('Stored working copy of', name, 'is unreadable; using the original');
            if (storeKey !== undefined) void saveWorking(storeKey, null);
          }
        }
        entry.stats = patternStats(entry.pattern);
        first ??= entry;
        // Only parseable files are kept; a broken file would just show up again as an error.
        if (persist) entry.storeKey = (await putFile(name, data)) ?? undefined;
      } catch (err) {
        entry.error = err instanceof Error ? err.message : String(err);
      }
      this.files.push(entry);
      if (entry.pattern) this.runValidation(entry, entry.pattern);
      if (entry.original && entry.pattern !== entry.original) this.measureOriginal(entry);
    }
    return first;
  }

  private async runValidation(f: LoadedFile, p: Pattern): Promise<void> {
    let m: Measurement;
    try {
      m = await this.measure(p);
    } catch (err) {
      console.error(err);
      return;
    }
    // An edit made while measuring supersedes this result.
    if (!this.files.includes(f) || f.pattern !== p) return;
    this.store(f, p, m);
    this.render();
    this.onValidated(f);
  }

  /** Measures the original of an edited file for the comparison view. */
  private async measureOriginal(f: LoadedFile): Promise<void> {
    const p = f.original!;
    let m: Measurement;
    try {
      m = await this.measure(p);
    } catch (err) {
      console.error(err);
      return;
    }
    if (!this.files.includes(f) || f.original !== p) return;
    f.originalMeasurement = m;
    f.originalValidation = classify(m, this.profile, this.checks);
    this.render();
    this.onValidated(f);
  }

  /**
   * Replaces a file's pattern with an edited version and re-validates it. `measurement` (of the new
   * pattern) skips the worker round trip when it is already known. With `record`, the previous
   * version goes onto the undo stack.
   */
  setPattern(f: LoadedFile, p: Pattern, opts: { record?: boolean; measurement?: Measurement } = {}): void {
    if (!f.pattern || p === f.pattern) return;
    if (opts.record !== false) {
      f.undo.push(f.pattern);
      if (f.undo.length > HISTORY) f.undo.shift();
      f.redo = [];
    }
    f.pattern = p;
    f.stats = patternStats(p);
    // The working copy is saved next to the original on every change, so a reload restores it.
    if (f.storeKey !== undefined) void saveWorking(f.storeKey, p === f.original ? null : toStored(p));
    if (opts.measurement) {
      this.store(f, p, opts.measurement);
      this.render();
      this.onValidated(f);
    } else {
      f.measurement = undefined;
      f.validation = undefined;
      this.render();
      this.runValidation(f, p);
    }
  }

  /** Replaces the file's acknowledgements and stores them with the file. */
  setAcks(f: LoadedFile, acks: Acknowledgement[]): void {
    f.acks = acks;
    if (f.storeKey !== undefined) void saveAcks(f.storeKey, acks);
    this.render();
  }

  /** Highest level among the findings that are not acknowledged; null while measuring. */
  static openWorst(f: LoadedFile): number | null {
    return f.validation ? openWorst(f.validation.zones, f.acks) : null;
  }

  /** Sets the measurement of `p`, the file's current pattern; the original's is kept for comparing. */
  private store(f: LoadedFile, p: Pattern, m: Measurement): void {
    f.measurement = m;
    f.validation = classify(m, this.profile, this.checks);
    // Acknowledgements of zones an edit removed would otherwise match a new zone there later.
    const live = liveAcknowledgements(f.validation.zones, f.acks);
    if (live.length !== f.acks.length) {
      f.acks = live;
      if (f.storeKey !== undefined) void saveAcks(f.storeKey, live);
    }
    if (p === f.original) {
      f.originalMeasurement = m;
      f.originalValidation = f.validation;
    }
  }

  undo(f: LoadedFile): boolean {
    const prev = f.undo.pop();
    if (!prev || !f.pattern) return false;
    f.redo.push(f.pattern);
    this.setPattern(f, prev, { record: false });
    return true;
  }

  redo(f: LoadedFile): boolean {
    const next = f.redo.pop();
    if (!next || !f.pattern) return false;
    f.undo.push(f.pattern);
    this.setPattern(f, next, { record: false });
    return true;
  }

  /** Back to the pattern as loaded; this step can be undone too. */
  revert(f: LoadedFile): void {
    if (f.original) this.setPattern(f, f.original);
  }

  /** True once the pattern differs from the loaded one. */
  static edited(f: LoadedFile | null): boolean {
    return !!f?.pattern && f.pattern !== f.original;
  }

  activate(id: number | null): void {
    this.activeId = id;
    saveActiveKey(this.active?.storeKey ?? null);
    this.render();
    this.onActivate(this.active);
  }

  remove(id: number): void {
    const idx = this.files.findIndex((f) => f.id === id);
    if (idx < 0) return;
    const [removed] = this.files.splice(idx, 1);
    if (removed.storeKey !== undefined) void deleteFile(removed.storeKey);
    if (this.activeId === id) {
      const next = this.files.slice(idx).find((f) => f.pattern) ?? [...this.files].reverse().find((f) => f.pattern);
      this.activate(next?.id ?? null);
    } else {
      this.render();
    }
  }

  /** Moves the selection by `dir` among parsed files (keyboard navigation). */
  step(dir: 1 | -1): void {
    const ok = this.files.filter((f) => f.pattern);
    if (!ok.length) return;
    const i = ok.findIndex((f) => f.id === this.activeId);
    this.activate(ok[(i + dir + ok.length) % ok.length].id);
  }

  render(): void {
    this.list.replaceChildren(
      ...(this.files.length
        ? this.files.map((f) => this.item(f))
        : [Object.assign(document.createElement('li'), { className: 'muted', textContent: t('files.empty') })]),
    );
  }

  private item(f: LoadedFile): HTMLLIElement {
    const li = document.createElement('li');
    li.classList.toggle('active', f.id === this.activeId);
    li.title = f.error ? `${t('files.error')}: ${f.error}` : f.fileName;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = f.fileName;
    li.append(name);
    if (f.error) {
      const err = document.createElement('span');
      err.className = 'err';
      err.textContent = t('files.error');
      li.append(err);
    } else {
      const fmt = document.createElement('span');
      fmt.className = 'fmt';
      fmt.textContent = f.pattern!.format;
      li.append(fmt);
      if (FileList.edited(f)) {
        const ed = document.createElement('span');
        ed.className = 'edited';
        ed.textContent = t('files.edited');
        li.append(ed);
      }
      const worst = FileList.openWorst(f);
      const dot = document.createElement('span');
      dot.className = `dot ${worst === CRITICAL ? 'critical' : worst === CAUTION ? 'caution' : worst === null ? 'pending' : 'safe'}`;
      dot.title = t(
        worst === CRITICAL ? 'level.critical' : worst === CAUTION ? 'level.caution' : worst === null ? 'validation.pending' : 'level.safe',
      );
      li.append(dot);
      li.addEventListener('click', () => this.activate(f.id));
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = '×';
    rm.title = t('files.remove');
    rm.setAttribute('aria-label', `${t('files.remove')}: ${f.fileName}`);
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      this.remove(f.id);
    });
    li.append(rm);
    return li;
  }
}
