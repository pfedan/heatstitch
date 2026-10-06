import { t } from '../i18n';
import { patternStats, STITCH, type Pattern, type PatternStats } from '../model/pattern';
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
  saveAside,
  saveMaterial,
  saveNaming,
  saveObjects,
  saveWorking,
  toStored,
  type StoredPattern,
} from '../storage/fileStore';
import { backToVersion, keepVersion, restoreRemembered, type StoredObject } from '../model/restitch';
import { asideFrom, asideOf, inheritAside, setAsideOf, storeAside, type StoredAside } from '../model/aside';
import type { ProjectFile } from '../storage/project';
import { liveAcknowledgements, openWorst, type Acknowledgement } from '../validation/acks';
import { normalizeMaterial, type Material } from '../settings';
import {
  CAUTION,
  classify,
  CRITICAL,
  type Measurement,
  type ValidationResult,
} from '../validation/validate';

export interface LoadedFile {
  id: number;
  fileName: string;
  /** The bytes as loaded, kept for project files. */
  data?: Uint8Array;
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
  /** This design's fabric, thread, hoop, fabric color and checks. */
  material: Material;
  /**
   * The name the user gave the design, as the list shows it: a loaded file keeps the extension only
   * as long as the user leaves it there (heatstitch objects may join it). Absent while it goes by its file name.
   */
  title?: string;
  /**
   * Made in the app (empty with "Neu", from an image or SVG): it is named without extension, since
   * the PES behind it is only how it is kept, not a file the user opened.
   */
  own: boolean;
}

interface FileData {
  name: string;
  data: ArrayBuffer;
  storeKey?: number;
  working?: StoredPattern;
  acks?: Acknowledgement[];
  objects?: StoredObject[];
  aside?: StoredAside[];
  /** Unchecked; missing parts come from the material last used. */
  material?: unknown;
  title?: string;
  /** Absent in older records: then a design without stitches counts as made in the app. */
  own?: boolean;
}

/** Versions kept per file for undo. */
const HISTORY = 50;

const EXT = /\.[^.]+$/;
/** The extension of an embroidery format at the end of a name ("Herz 1.5" has none). */
const FORMAT_EXT = new RegExp(`(${SUPPORTED_EXTENSIONS.map((e) => e.replace('.', '\\.')).join('|')})$`, 'i');

export class FileList {
  files: LoadedFile[] = [];
  activeId: number | null = null;
  private nextId = 1;
  /** The file whose name is being edited in the list, with the text typed so far. */
  private renaming: { id: number; text: string } | null = null;
  /** Called after a design got another name (the save field suggests the new one). */
  onRename: (f: LoadedFile) => void = () => {};

  constructor(
    private list: HTMLUListElement,
    private onActivate: (f: LoadedFile | null) => void,
    /** Measures a newly parsed file (in a worker). */
    private measure: (p: Pattern) => Promise<Measurement>,
    private onValidated: (f: LoadedFile) => void,
    /** The material a new design starts with: the one used last. */
    private defaults: () => Material,
  ) {}

  /** Gives a design another material, re-classifies it for the new fabric, thread and checks and stores it. */
  setMaterial(f: LoadedFile, m: Material): void {
    f.material = structuredClone(m);
    const { profile, checks } = f.material;
    if (f.measurement) f.validation = classify(f.measurement, profile, checks);
    if (f.originalMeasurement) f.originalValidation = classify(f.originalMeasurement, profile, checks);
    if (f.storeKey !== undefined) void saveMaterial(f.storeKey, f.material);
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

  /**
   * Adds one file with what is known about its objects (and its own material, else the last used), and
   * activates it. `own`: made in the app, so it is named without the extension of the PES behind it.
   */
  async addWithObjects(name: string, data: ArrayBuffer, objects: StoredObject[], aside: StoredAside[] = [], material?: Material, own = false): Promise<void> {
    const first = await this.addData([{ name, data, objects, aside, material, own }], true);
    if (first) this.activate(first.id);
    else this.render();
  }

  /** Re-adds the files stored by an earlier visit and activates the one that was active then. */
  async restore(): Promise<void> {
    const stored = await listFiles();
    if (!stored.length) return;
    const first = await this.addData(
      stored.map((rec) => ({ name: rec.name, data: rec.data, storeKey: rec.key, working: rec.working, acks: acksOf(rec), objects: rec.objects, aside: rec.aside, material: rec.material, title: rec.title, own: rec.own })),
      false,
    );
    // Files the user added while we were reading storage keep the focus.
    if (this.activeId !== null) return this.render();
    const activeKey = loadActiveKey();
    const active = this.files.find((f) => f.pattern && f.storeKey === activeKey) ?? first;
    if (active) this.activate(active.id);
    else this.render();
  }

  /**
   * Adds the files of a project with their edits, decisions and object shapes, and activates the
   * one that was active when it was saved (else the first).
   */
  async addProject(list: ProjectFile[], active: number | null): Promise<void> {
    const before = this.files.length;
    const first = await this.addData(
      list.map((f) => ({ name: f.name, data: f.data.slice().buffer, working: f.working, acks: f.acks, objects: f.objects, aside: f.aside, material: f.material, title: f.title, own: f.own })),
      true,
    );
    const wanted = active !== null ? this.files[before + active] : undefined;
    const target = wanted?.pattern ? wanted : first;
    if (target) this.activate(target.id);
    else this.render();
  }

  /** Shows a file that could not be opened, with the reason. */
  addError(name: string, error: string): void {
    this.files.push({ id: this.nextId++, fileName: name, undo: [], redo: [], acks: [], error, material: this.defaults(), own: false });
    this.render();
  }

  /** Stores what is remembered about the objects of a file's current version. */
  setObjects(f: LoadedFile, objects: StoredObject[]): void {
    // What the objects learned belongs to this version (undo brings it back with it).
    if (f.pattern) keepVersion(f.pattern);
    if (f.storeKey !== undefined) void saveObjects(f.storeKey, objects);
  }

  private async addData(list: FileData[], persist: boolean): Promise<LoadedFile | null> {
    let first: LoadedFile | null = null;
    for (const { name, data, storeKey, working, acks, objects, aside, material, title, own } of list) {
      const entry: LoadedFile = {
        id: this.nextId++,
        fileName: name,
        data: new Uint8Array(data),
        storeKey,
        undo: [],
        redo: [],
        acks: acks ?? [],
        material: normalizeMaterial(material, this.defaults()),
        ...(typeof title === 'string' && title.trim() ? { title: title.trim() } : {}),
        own: own === true,
      };
      // Stored before materials were kept per design: it keeps the one it was last seen with.
      if (storeKey !== undefined && !material) void saveMaterial(storeKey, entry.material);
      // Remembered by their stitches, so they apply to whichever version has these objects.
      if (objects) restoreRemembered(objects);
      try {
        const original = parsePattern(new Uint8Array(data), name);
        entry.original = original;
        entry.pattern = original;
        // Before designs knew where they came from, an empty one could only have come from "Neu".
        if (own === undefined && !original.cmd.includes(STITCH)) entry.own = true;
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
        // Shapes aside belong to the working copy (to the original only while there is none).
        setAsideOf(original, entry.pattern === original ? asideFrom(aside) : []);
        if (entry.pattern !== original) setAsideOf(entry.pattern, asideFrom(aside));
        entry.stats = patternStats(entry.pattern);
        keepVersion(original);
        if (entry.pattern !== original) keepVersion(entry.pattern);
        first ??= entry;
        // Only parseable files are kept; a broken file would just show up again as an error.
        if (persist) {
          entry.storeKey = (await putFile(name, data)) ?? undefined;
          const key = entry.storeKey;
          if (key !== undefined) {
            if (entry.pattern !== original) void saveWorking(key, toStored(entry.pattern));
            if (entry.acks.length) void saveAcks(key, entry.acks);
            if (objects?.length) void saveObjects(key, objects);
            if (aside?.length) void saveAside(key, aside);
            void saveMaterial(key, entry.material);
            if (entry.title || entry.own) void saveNaming(key, entry.title ?? null, entry.own);
          }
        }
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
    f.originalValidation = classify(m, f.material.profile, f.material.checks);
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
    // A new version keeps the shapes aside of the one before; undo and redo bring back their own.
    inheritAside(f.pattern, p);
    // A version seen before (undo, redo, back to the original) knows again what it knew then; a new one keeps what it knows now.
    if (!backToVersion(p)) keepVersion(p);
    f.pattern = p;
    f.stats = patternStats(p);
    // The working copy is saved next to the original on every change, so a reload restores it.
    if (f.storeKey !== undefined) {
      void saveWorking(f.storeKey, p === f.original ? null : toStored(p));
      void saveAside(f.storeKey, storeAside(asideOf(p)));
    }
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
    f.validation = classify(m, f.material.profile, f.material.checks);
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

  /** A design started empty with "Neu": it has no original stitches to go back to. */
  static blank(f: LoadedFile | null): boolean {
    return !!f?.original && !f.original.cmd.includes(STITCH);
  }

  /** The design's name without an embroidery extension: the one the user gave it, else its file name. */
  static baseName(f: LoadedFile): string {
    return f.title !== undefined ? f.title.replace(FORMAT_EXT, '').trim() : f.fileName.replace(EXT, '');
  }

  /** The name the list shows: the one the user gave it, else loaded embroidery files with their extension, designs made in the app without. */
  static displayName(f: LoadedFile): string {
    if (f.error) return f.fileName;
    return f.title ?? FileList.fileDisplayName(f);
  }

  /** The name a design goes by until the user names it. */
  private static fileDisplayName(f: LoadedFile): string {
    return f.own ? f.fileName.replace(EXT, '') : f.fileName;
  }

  /**
   * The name a save offers, without extension. An edited embroidery file gets "-corrected", so the
   * original is not overwritten by mistake; a design made in the app or named by the user keeps its name.
   */
  static saveName(f: LoadedFile): string {
    const base = FileList.baseName(f) || 'design';
    return FileList.edited(f) && !f.own && !f.title ? `${base}-corrected` : base;
  }

  /** Gives a design another name, exactly as typed; an empty name (or its file name) goes back to the file name. */
  rename(f: LoadedFile, name: string): void {
    const title = name.replace(/[\x00-\x1f]/g, '').trim();
    const next = title && title !== FileList.fileDisplayName(f) ? title : undefined;
    if (next === f.title) return;
    if (next) f.title = next;
    else delete f.title;
    if (f.storeKey !== undefined) void saveNaming(f.storeKey, f.title ?? null, f.own);
    this.render();
    this.onRename(f);
  }

  /** Turns the name of a design in the list into a text field (pencil or double click). */
  startRename(id: number): void {
    const f = this.files.find((x) => x.id === id);
    if (!f?.pattern) return;
    const text = FileList.displayName(f);
    this.renaming = { id, text };
    this.render();
    const input = this.list.querySelector<HTMLInputElement>('input.rename-input');
    input?.focus();
    // Like a file manager: the name is selected, an extension behind it stays as long as one types over the selection.
    input?.setSelectionRange(0, text.length - (text.match(FORMAT_EXT)?.[0].length ?? 0));
  }

  /** Ends editing a name: takes the typed text, or with `keep` false leaves the name as it was. */
  private endRename(keep: boolean): void {
    const r = this.renaming;
    if (!r) return;
    this.renaming = null;
    const f = this.files.find((x) => x.id === r.id);
    if (keep && f) this.rename(f, r.text);
    else this.render();
  }

  activate(id: number | null): void {
    this.activeId = id;
    // Another file's objects may have pushed this one's out of memory meanwhile.
    if (this.active?.pattern) backToVersion(this.active.pattern);
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
    // A list drawn anew while a name is typed (a measurement came in) keeps the field and its focus.
    const typing = !!this.renaming && document.activeElement?.classList.contains('rename-input');
    if (this.renaming && !this.files.some((f) => f.id === this.renaming!.id)) this.renaming = null;
    this.list.replaceChildren(
      ...(this.files.length
        ? this.files.map((f) => this.item(f))
        : [Object.assign(document.createElement('li'), { className: 'muted', textContent: t('files.empty') })]),
    );
    if (typing) this.list.querySelector<HTMLInputElement>('input.rename-input')?.focus();
  }

  /** The text field that replaces a name while it is edited; Enter or leaving it takes the name, Escape keeps the old one. */
  private nameField(f: LoadedFile): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'name rename';
    const input = document.createElement('input');
    input.className = 'rename-input';
    input.type = 'text';
    input.value = this.renaming!.text;
    input.placeholder = FileList.fileDisplayName(f);
    input.setAttribute('aria-label', t('files.rename'));
    input.addEventListener('input', () => {
      if (this.renaming) this.renaming.text = input.value;
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.endRename(true);
      else if (e.key === 'Escape') this.endRename(false);
    });
    input.addEventListener('blur', () => {
      // Drawing the list anew blurs the old field too; only a real leave ends editing.
      if (input.isConnected) this.endRename(true);
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('dblclick', (e) => e.stopPropagation());
    wrap.append(input);
    return wrap;
  }

  private item(f: LoadedFile): HTMLLIElement {
    const li = document.createElement('li');
    li.classList.toggle('active', f.id === this.activeId);
    const shown = FileList.displayName(f);
    li.title = f.error ? `${t('files.error')}: ${f.error}` : shown;
    if (this.renaming?.id === f.id) li.append(this.nameField(f));
    else {
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = shown;
      if (!f.error) {
        name.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          this.startRename(f.id);
        });
      }
      li.append(name);
    }
    if (f.error) {
      const err = document.createElement('span');
      err.className = 'err';
      err.textContent = t('files.error');
      li.append(err);
    } else {
      // The format of a design made in the app is only how it is kept.
      if (!f.own) {
        const fmt = document.createElement('span');
        fmt.className = 'fmt';
        fmt.textContent = f.pattern!.format;
        li.append(fmt);
      }
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
      if (this.renaming?.id !== f.id) {
        const pen = document.createElement('button');
        pen.type = 'button';
        pen.className = 'rename-btn';
        pen.title = t('files.rename');
        pen.setAttribute('aria-label', `${t('files.rename')}: ${shown}`);
        pen.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M11.5 2.5l2 2L6 12l-2.8.8L4 10z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
        pen.addEventListener('click', (e) => {
          e.stopPropagation();
          this.startRename(f.id);
        });
        li.append(pen);
      }
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = '×';
    rm.title = t('files.remove');
    rm.setAttribute('aria-label', `${t('files.remove')}: ${shown}`);
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      this.remove(f.id);
    });
    li.append(rm);
    return li;
  }
}
