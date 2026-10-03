import { t } from '../i18n';
import { patternStats, type Pattern, type PatternStats } from '../model/pattern';
import { parsePattern, SUPPORTED_EXTENSIONS } from '../parsers';
import { CAUTION, CRITICAL, type ValidationResult } from '../validation/validate';

export interface LoadedFile {
  id: number;
  fileName: string;
  pattern?: Pattern;
  stats?: PatternStats;
  /** Set once the worker has validated the file. */
  validation?: ValidationResult;
  error?: string;
}

export class FileList {
  files: LoadedFile[] = [];
  activeId: number | null = null;
  private nextId = 1;

  constructor(
    private list: HTMLUListElement,
    private onActivate: (f: LoadedFile | null) => void,
    /** Runs the validation for a newly parsed file (in a worker). */
    private validate: (p: Pattern) => Promise<ValidationResult>,
    private onValidated: (f: LoadedFile) => void,
  ) {}

  get active(): LoadedFile | null {
    return this.files.find((f) => f.id === this.activeId) ?? null;
  }

  /** Parses the given files, adds them and activates the first successfully parsed one. */
  async add(files: Iterable<File>): Promise<void> {
    // Copy first: an input's FileList is live and gets cleared while we await.
    const list = Array.from(files);
    let first: LoadedFile | null = null;
    for (const file of list) {
      if (!SUPPORTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) continue;
      const entry: LoadedFile = { id: this.nextId++, fileName: file.name };
      try {
        const pattern = parsePattern(new Uint8Array(await file.arrayBuffer()), file.name);
        entry.pattern = pattern;
        entry.stats = patternStats(pattern);
        first ??= entry;
      } catch (err) {
        entry.error = err instanceof Error ? err.message : String(err);
      }
      this.files.push(entry);
      if (entry.pattern) this.runValidation(entry, entry.pattern);
    }
    if (first) this.activate(first.id);
    else this.render();
  }

  private async runValidation(f: LoadedFile, p: Pattern): Promise<void> {
    try {
      f.validation = await this.validate(p);
    } catch (err) {
      console.error(err);
      return;
    }
    if (!this.files.includes(f)) return;
    this.render();
    this.onValidated(f);
  }

  activate(id: number | null): void {
    this.activeId = id;
    this.render();
    this.onActivate(this.active);
  }

  remove(id: number): void {
    const idx = this.files.findIndex((f) => f.id === id);
    if (idx < 0) return;
    this.files.splice(idx, 1);
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
      const worst = f.validation ? Math.max(0, ...f.validation.zones.map((z) => z.level)) : null;
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
