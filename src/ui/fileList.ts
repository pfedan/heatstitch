import { getLang, onLangChange, t } from '../i18n';
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
  saveTrace,
  saveWorking,
  titlesOf,
  toStored,
  type StoredPattern,
  type Titles,
} from '../storage/fileStore';
import { backToVersion, keepVersion, rememberedIn, restoreRemembered, type ObjectsAsStored } from '../model/restitch';
import { asideFrom, asideOf, inheritAside, setAsideOf, storeAside, type StoredAside } from '../model/aside';
import { inheritTrace, readTrace, setTraceOf, storeTrace, traceFrom, traceOf, traceOpacity, TRACE_VIEW, type StoredTrace, type TraceView } from '../model/trace';
import type { ProjectFile } from '../storage/project';
import { liveAcknowledgements, openWorst, type Acknowledgement } from '../validation/acks';
import { normalizeMaterial, type Material } from '../settings';
import { toast } from '../shell/ui';
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
  /**
   * The version a project brought along when it was opened (absent for plain files): the
   * comparison with the original is offered once the design differs from it, not right away.
   */
  opened?: Pattern;
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
  /** The name per app language, shown in place of `title` (the demo project's designs); dropped on rename. */
  titles?: Titles;
  /**
   * Made in the app (empty with "Neu", from an image or SVG): it is named without extension, since
   * the PES behind it is only how it is kept, not a file the user opened.
   */
  own: boolean;
  /** Whether the tracing image (traceOf the pattern) is shown and locked; kept while undo takes the image away and back. */
  traceView: TraceView;
}

interface FileData {
  name: string;
  data: ArrayBuffer;
  storeKey?: number;
  working?: StoredPattern;
  acks?: Acknowledgement[];
  objects?: ObjectsAsStored;
  aside?: StoredAside[];
  /** Unchecked; missing parts come from the material last used. */
  material?: unknown;
  title?: string;
  titles?: Titles;
  /** Absent in older records: then a design without stitches counts as made in the app. */
  own?: boolean;
  /** The tracing image with its view (unchecked, read with readTrace). */
  trace?: unknown;
}

/** Versions kept per file for undo. */
const HISTORY = 50;
/** How long a removed design can still be brought back (a little longer than its note shows). */
const REMOVE_GRACE_MS = 8000;

const EXT = /\.[^.]+$/;
/** The extension of an embroidery format at the end of a name ("Herz 1.5" has none). */
const FORMAT_EXT = new RegExp(`(${SUPPORTED_EXTENSIONS.map((e) => e.replace('.', '\\.')).join('|')})$`, 'i');

export class FileList {
  files: LoadedFile[] = [];
  activeId: number | null = null;
  private nextId = 1;
  /** The file whose name is being edited in the list, with the text typed so far. */
  private renaming: { id: number; text: string } | null = null;
  /** True while the list is drawn anew: the name field it takes away loses its focus then, which is no real leave. */
  private drawing = false;
  /** Called after a design got another name (the save field suggests the new one). */
  onRename: (f: LoadedFile) => void = () => {};
  /** Called when the user picks a design (list, keys), not when the app activates one itself. */
  onPick: (f: LoadedFile | null) => void = () => {};

  constructor(
    private list: HTMLUListElement,
    private onActivate: (f: LoadedFile | null) => void,
    /** Measures a newly parsed file (in a worker). */
    private measure: (p: Pattern) => Promise<Measurement>,
    private onValidated: (f: LoadedFile) => void,
    /** The material a new design starts with: the one used last. */
    private defaults: () => Material,
  ) {
    onLangChange(() => this.render());
  }

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
  async addWithObjects(name: string, data: ArrayBuffer, objects: ObjectsAsStored, aside: StoredAside[] = [], material?: Material, own = false, trace?: StoredTrace): Promise<void> {
    const first = await this.addData([{ name, data, objects, aside, material, own, trace }], true);
    if (first) this.activate(first.id);
    else this.render();
  }

  /** Re-adds the files stored by an earlier visit and activates the one that was active then. */
  async restore(): Promise<void> {
    const stored = await listFiles();
    if (!stored.length) return;
    const first = await this.addData(
      stored.map((rec) => ({ name: rec.name, data: rec.data, storeKey: rec.key, working: rec.working, acks: acksOf(rec), objects: rec.objects, aside: rec.aside, material: rec.material, title: rec.title, titles: titlesOf(rec.titles), own: rec.own, trace: rec.trace })),
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
    // Opening the same project again (say after a reload brought it back) does not list its designs
    // twice: a design that is already open exactly as the project holds it is shown, not added.
    const used = new Set<LoadedFile>();
    const open = list.map((f) => {
      const o = this.files.find((o) => !used.has(o) && sameDesign(o, f));
      if (o) used.add(o);
      return o;
    });
    const before = this.files.length;
    const fresh = list.filter((_, i) => !open[i]);
    const first = await this.addData(
      fresh.map((f) => ({ name: f.name, data: f.data.slice().buffer, working: f.working, acks: f.acks, objects: f.objects, aside: f.aside, material: f.material, title: f.title, titles: f.titles, own: f.own, trace: f.trace })),
      true,
    );
    const wanted = active !== null ? (open[active] ?? this.files[before + fresh.indexOf(list[active])]) : undefined;
    const target = wanted?.pattern ? wanted : (first ?? open.find((o) => o?.pattern));
    if (target) this.activate(target.id);
    else this.render();
  }

  /** Shows a file that could not be opened, with the reason. */
  addError(name: string, error: string): void {
    this.files.push({ id: this.nextId++, fileName: name, undo: [], redo: [], acks: [], error, material: this.defaults(), own: false, traceView: { ...TRACE_VIEW } });
    this.render();
  }

  /** Stores what is remembered about the objects of a file's current version. */
  setObjects(f: LoadedFile, objects: ObjectsAsStored): void {
    // What the objects learned belongs to this version (undo brings it back with it).
    if (f.pattern) keepVersion(f.pattern);
    if (f.storeKey !== undefined) void saveObjects(f.storeKey, objects);
  }

  private async addData(list: FileData[], persist: boolean): Promise<LoadedFile | null> {
    let first: LoadedFile | null = null;
    for (const { name, data, storeKey, working, acks, objects, aside, material, title, titles, own, trace } of list) {
      const stored = readTrace(trace);
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
        ...(titles ? { titles } : {}),
        own: own === true,
        traceView: stored ? { shown: stored.shown !== false, locked: stored.locked === true, opacity: traceOpacity(stored.opacity) } : { ...TRACE_VIEW },
      };
      // Stored before materials were kept per design: it keeps the one it was last seen with.
      if (storeKey !== undefined && !material) void saveMaterial(storeKey, entry.material);
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
            if (persist) entry.opened = edited;
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
        // The tracing image lies under both: going back to the original does not take it away.
        setTraceOf(original, stored && traceFrom(stored));
        if (entry.pattern !== original) setTraceOf(entry.pattern, stored && traceFrom(stored));
        // The objects of the version as stored; an older project knew them by their stitches, so
        // its original knows those that are in it too.
        if (objects) {
          restoreRemembered(entry.pattern, objects);
          if (Array.isArray(objects) && entry.pattern !== original) restoreRemembered(original, objects);
          // Kept from an older version of the app: kept as an object list from now on.
          if (!persist && storeKey !== undefined && Array.isArray(objects)) void saveObjects(storeKey, rememberedIn(entry.pattern));
        }
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
            if (objects) void saveObjects(key, rememberedIn(entry.pattern));
            if (aside?.length) void saveAside(key, aside);
            if (stored) void saveTrace(key, stored);
            void saveMaterial(key, entry.material);
            if (entry.title || entry.titles || entry.own) void saveNaming(key, entry.title ?? null, entry.own, entry.titles);
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
    inheritTrace(f.pattern, p);
    const traceChanged = traceOf(p) !== traceOf(f.pattern);
    // A version seen before (undo, redo, back to the original) knows again what it knew then; a new one keeps what it knows now.
    if (!backToVersion(p)) keepVersion(p);
    f.pattern = p;
    f.stats = patternStats(p);
    // The working copy is saved next to the original on every change, so a reload restores it.
    if (f.storeKey !== undefined) {
      void saveWorking(f.storeKey, p === f.original ? null : toStored(p));
      void saveAside(f.storeKey, storeAside(asideOf(p)));
      // The picture is only written again when it changed, not with every stitch edit.
      if (traceChanged) this.storeTrace(f, p);
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

  /** Shows or hides, locks or frees the tracing image of a design (no undo step: it is how it is looked at). */
  setTraceView(f: LoadedFile, view: Partial<TraceView>): void {
    f.traceView = { ...f.traceView, ...view };
    if (f.storeKey !== undefined && f.pattern) this.storeTrace(f, f.pattern);
  }

  private storeTrace(f: LoadedFile, p: Pattern): void {
    const t = traceOf(p);
    void saveTrace(f.storeKey!, t && storeTrace(t, f.traceView));
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

  /** Changed since it was opened: edited, and not the version a project came with. Offers the comparison. */
  static changed(f: LoadedFile | null): boolean {
    return FileList.edited(f) && f!.pattern !== f!.opened;
  }

  /** A design started empty with "Neu": it has no original stitches to go back to. */
  static blank(f: LoadedFile | null): boolean {
    return !!f?.original && !f.original.cmd.includes(STITCH);
  }

  /** The design's name without an embroidery extension: the one the user gave it, else its file name. */
  static baseName(f: LoadedFile): string {
    const title = FileList.titleOf(f);
    return title !== undefined ? title.replace(FORMAT_EXT, '').trim() : f.fileName.replace(EXT, '');
  }

  /** The name the design was given: in the app's language when it has one per language. */
  private static titleOf(f: LoadedFile): string | undefined {
    return f.titles?.[getLang()] ?? f.title;
  }

  /** The name the list shows: the one the user gave it, else loaded embroidery files with their extension, designs made in the app without. */
  static displayName(f: LoadedFile): string {
    if (f.error) return f.fileName;
    return FileList.titleOf(f) ?? FileList.fileDisplayName(f);
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
    if (next === FileList.titleOf(f)) return;
    // A name the user types is the same in every language.
    delete f.titles;
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

  /** The user picks a design: it becomes active and is shown, wherever the user was. */
  pick(id: number): void {
    this.activate(id);
    this.onPick(this.active);
  }

  /**
   * Takes a design out of the list and activates the next one. It stays in storage for a few
   * seconds: the returned function puts it back as it was (with its undo history), until then.
   */
  remove(id: number): (() => void) | null {
    const idx = this.files.findIndex((f) => f.id === id);
    if (idx < 0) return null;
    const [removed] = this.files.splice(idx, 1);
    const wasActive = this.activeId === id;
    let settled = false;
    const drop = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('pagehide', drop);
      if (removed.storeKey !== undefined) void deleteFile(removed.storeKey);
    };
    const timer = window.setTimeout(drop, REMOVE_GRACE_MS);
    window.addEventListener('pagehide', drop);
    if (this.renaming?.id === id) this.renaming = null;
    if (wasActive) {
      const next = this.files.slice(idx).find((f) => f.pattern) ?? [...this.files].reverse().find((f) => f.pattern);
      this.activate(next?.id ?? null);
    } else {
      this.render();
    }
    return () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('pagehide', drop);
      this.files.splice(Math.min(idx, this.files.length), 0, removed);
      if (wasActive || this.activeId === null) this.activate(removed.id);
      else this.render();
    };
  }

  /** Removes a design and says so, with a way back (no question before). */
  removeWithUndo(id: number): void {
    const f = this.files.find((x) => x.id === id);
    if (!f) return;
    const name = FileList.displayName(f);
    const undo = this.remove(id);
    if (undo) toast(t('files.removed', { name }), { label: t('files.undo'), run: undo });
  }

  /** Moves the selection by `dir` among parsed files (keyboard navigation). */
  step(dir: 1 | -1): void {
    const ok = this.files.filter((f) => f.pattern);
    if (!ok.length) return;
    const i = ok.findIndex((f) => f.id === this.activeId);
    this.pick(ok[(i + dir + ok.length) % ok.length].id);
  }

  render(): void {
    // A list drawn anew while a name is typed (a measurement came in) keeps the field and its focus.
    const typing = !!this.renaming && document.activeElement?.classList.contains('rename-input');
    const old = typing ? (document.activeElement as HTMLInputElement) : null;
    const sel = old ? [old.selectionStart ?? 0, old.selectionEnd ?? 0] : null;
    if (this.renaming && !this.files.some((f) => f.id === this.renaming!.id)) this.renaming = null;
    this.drawing = true;
    this.list.replaceChildren(
      ...(this.files.length
        ? this.files.map((f) => this.item(f))
        : [Object.assign(document.createElement('li'), { className: 'muted', textContent: t('files.empty') })]),
    );
    this.drawing = false;
    if (typing) {
      // The new field takes over the focus and what was selected in the old one.
      const input = this.list.querySelector<HTMLInputElement>('input.rename-input');
      input?.focus();
      if (sel) input?.setSelectionRange(sel[0], sel[1]);
    }
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
      if (input.isConnected && !this.drawing) this.endRename(true);
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
      li.addEventListener('click', () => this.pick(f.id));
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
    rm.className = 'remove-btn';
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeWithUndo(f.id);
    });
    li.append(rm);
    return li;
  }
}

/** True if the open design is the project's design as it was saved: same file, same stitches, same name. */
export function sameDesign(o: LoadedFile, f: ProjectFile): boolean {
  if (!o.pattern || !o.original || !o.data || o.fileName !== f.name || (o.title ?? '') !== (f.title ?? '')) return false;
  if (!sameBytes(o.data, f.data)) return false;
  const p = o.pattern;
  const w = f.working;
  const sameAside = JSON.stringify(storeAside(asideOf(p))) === JSON.stringify(f.aside ?? []);
  if (!w) return p === o.original && sameAside;
  if (p === o.original) return false;
  return (
    sameAside &&
    sameBytes(p.cmd, w.cmd) &&
    sameBytes(new Uint8Array(p.x.buffer, p.x.byteOffset, p.x.byteLength), new Uint8Array(w.x.buffer, w.x.byteOffset, w.x.byteLength)) &&
    sameBytes(new Uint8Array(p.y.buffer, p.y.byteOffset, p.y.byteLength), new Uint8Array(w.y.buffer, w.y.byteOffset, w.y.byteLength)) &&
    JSON.stringify(p.colors) === JSON.stringify(w.colors)
  );
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
