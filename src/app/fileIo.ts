import { t } from '../i18n';
import { digitizeDefaults, type Digitized } from '../digitize/digitize';
import { asideOf, storeAside } from '../model/aside';
import type { Pattern } from '../model/pattern';
import { rememberedIn } from '../model/restitch';
import { applyMaterial, materialOf, sameMaterial, saveSettings, type Mode, type Settings } from '../settings';
import { toStored } from '../storage/fileStore';
import { decodeProject, encodeProject, isProjectName, PROJECT_EXT, PROJECT_MIME, projectSettings, ProjectError, type Project, type ProjectSettings } from '../storage/project';
import type { CorrectPanel } from '../ui/correctPanel';
import { FileList, type LoadedFile } from '../ui/fileList';
import { digitizeSvg, type ImageMode, type LeftOut } from '../ui/imageMode';
import { threadWidthMm } from '../validation/profiles';
import { writePattern } from '../writers';
import { toast } from '../shell/ui';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** What opening and saving files needs from the app. */
export interface FileIoApp {
  readonly setFormLevel: (on: boolean) => void;
  files: FileList;
  settings: Settings;
  imageMode: ImageMode;
  profile: { refresh(): void };
  controls: { refresh(): void };
  correctPanel: CorrectPanel;
  redraw(): void;
  /** The objects of a pattern, as the stitch sequence knows them. */
  seq(p: Pattern): { objects: Parameters<typeof rememberedIn>[1] };
  setMode(mode: Mode): void;
  addDigitized(d: Digitized & { leftOut?: LeftOut[] }, name: string): Promise<void>;
}

/**
 * Opening files (picker, drag and drop, examples, "Open with"), projects (.heatstitch) in both
 * directions, and the material that goes with the active design.
 */
export function bindFileIo(app: FileIoApp) {

  const input = $<HTMLInputElement>('file-input');
  input.addEventListener('change', () => {
    if (input.files) void openFiles(input.files);
    input.value = '';
  });

  const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;

  /** Embroidery files go to the file list, an image to the Bild mode, a project opens everything it holds. */
  const isSvgFile = (f: File) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name);

  async function openFiles(list: Iterable<File>): Promise<void> {
    const all = [...list];
    for (const f of all.filter((f) => isProjectName(f.name))) await openProject(f);
    const images = all.filter((f) => f.type.startsWith('image/') || IMAGE_FILE.test(f.name));
    const image = images[0];
    // One picture is converted at a time; the others are not dropped silently.
    if (images.length > 1) toast(t('image.onlyFirst', { n: images.length }));
    const rest = all.filter((f) => f !== image && !isProjectName(f.name) && !f.type.startsWith('image/') && !IMAGE_FILE.test(f.name));
    if (image && isSvgFile(image)) {
      // An SVG of shapes opens as stitches in Ablauf, every shape whole; the Bild mode only for SVGs
      // that are pictures (embedded photos, many colors).
      try {
        const d = await digitizeSvg(image, app.settings.image.prepare, digitizeDefaults(app.settings.profile));
        await app.addDigitized(d, image.name.replace(/\.svg$/i, ''));
        app.setMode('flow');
      } catch {
        app.setMode('image');
        void app.imageMode.load(image);
      }
    } else if (image) {
      app.setMode('image');
      void app.imageMode.load(image);
    }
    return rest.length ? app.files.add(rest) : Promise.resolve();
  }

  // Project files ---------------------------------------------------------------

  /** A project holds every open file, so it is named by the day, not by one of them: "2026-10-05-heatstitch-projekt". */
  function projectName(): string {
    const d = new Date();
    const day = [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((v) => String(v).padStart(2, '0')).join('-');
    return `${day}-${t('save.project.file')}${PROJECT_EXT}`;
  }

  /** Everything open in the app as a project: the files with their edits, the image and the design settings. */
  function currentProject(): Project {
    const list = app.files.files.filter((f) => f.pattern && f.data);
    const active = list.findIndex((f) => f === app.files.active);
    const snap = app.imageMode.snapshot();
    return {
      files: list.map((f) => ({
        name: f.fileName,
        data: f.data!,
        ...(FileList.edited(f) ? { working: toStored(f.pattern!) } : {}),
        acks: f.acks,
        objects: rememberedIn(f.pattern!, app.seq(f.pattern!).objects),
        ...(asideOf(f.pattern).length ? { aside: storeAside(asideOf(f.pattern)) } : {}),
        material: f.material,
        ...(f.title ? { title: f.title } : {}),
        ...(f.own ? { own: true } : {}),
      })),
      active: active >= 0 ? active : null,
      image: snap && { name: snap.image.name, type: snap.image.type, data: new Uint8Array(snap.image.data), work: snap.work },
      settings: projectSettings(app.settings),
    };
  }

  async function saveProject(): Promise<void> {
    const bytes = await encodeProject(currentProject());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: PROJECT_MIME }));
    a.download = projectName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $('save-project').addEventListener('click', () => void saveProject());
  $('image-save-project').addEventListener('click', () => void saveProject());

  /** The settings take the material of the design that becomes active (its fabric, thread, hoop, color, checks). */
  function adoptMaterial(f: LoadedFile): void {
    if (sameMaterial(f.material, materialOf(app.settings))) return;
    applyMaterial(app.settings, f.material);
    saveSettings(app.settings);
    app.profile.refresh();
    app.controls.refresh();
    app.imageMode.profileChanged();
  }

  /** A change of the material in the panels goes to the active design only; new designs start with it. */
  function storeMaterial(): void {
    const f = app.files.active;
    if (f && !sameMaterial(f.material, materialOf(app.settings))) app.files.setMaterial(f, materialOf(app.settings));
  }

  /** Takes over the material, checks, correction and order options of a project (and its image's, if it has one). */
  function applyProjectSettings(s: ProjectSettings, withImage: boolean): void {
    if (s.profile.thread !== app.settings.profile.thread) app.settings.threadMm = threadWidthMm(s.profile);
    app.settings.profile = s.profile;
    app.settings.checks = s.checks;
    // The panels keep these objects, so they change in place.
    Object.assign(app.settings.correction, s.correction);
    Object.assign(app.settings.order, s.order);
    app.settings.trimMm = s.trimMm;
    app.settings.machineSpm = s.machineSpm;
    if (s.background !== undefined) app.settings.background = s.background;
    if (withImage) {
      Object.assign(app.settings.image.prepare, s.image.prepare);
      for (const k of Object.keys(app.settings.image.stitch)) delete app.settings.image.stitch[k as keyof typeof app.settings.image.stitch];
      Object.assign(app.settings.image.stitch, s.image.stitch);
    }
    saveSettings(app.settings);
    app.profile.refresh();
    app.controls.refresh();
    app.correctPanel.sync();
    app.imageMode.profileChanged();
  }

  async function openProject(file: File): Promise<void> {
    let project: Project;
    try {
      project = await decodeProject(new Uint8Array(await file.arrayBuffer()));
    } catch (err) {
      console.warn('Could not open the project', err);
      app.files.addError(file.name, t(err instanceof ProjectError && err.reason === 'newer' ? 'project.error.newer' : 'project.error.invalid'));
      if (app.settings.mode === 'image') app.setMode('flow');
      return;
    }
    applyProjectSettings(project.settings, !!project.image);
    if (project.image) await app.imageMode.open({ ...project.image, data: project.image.data.slice().buffer }, project.image.work);
    if (project.files.length) {
      await app.files.addProject(project.files, project.active);
      if (app.settings.mode === 'image') app.setMode('flow');
    } else if (project.image) app.setMode('image');
    app.redraw();
  }

  // A new, empty design: it takes the material used last, opens in Ablauf and waits for shapes and text.
  const EMPTY = { name: '', format: 'pes', x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } } satisfies Pattern;

  /** "Neues Stickmuster", or "Neues Stickmuster 2" and so on when that name is taken. */
  function newName(): string {
    const base = t('draw.newName');
    const taken = new Set(app.files.files.map((f) => FileList.baseName(f)));
    let name = base;
    for (let k = 2; taken.has(name); k++) name = `${base} ${k}`;
    return name;
  }

  $('new-design').addEventListener('click', async () => {
    const name = newName();
    const data = writePattern({ ...EMPTY, name }, 'pes');
    // Without a hoop there would be nothing to draw into: the common 10 x 10 cm one stands in.
    const material = materialOf(app.settings);
    material.hoop ??= { w: 100, h: 100 };
    await app.files.addWithObjects(`${name}.pes`, data.slice().buffer, [], [], material, true);
    app.setMode('flow');
    // Nothing to choose yet: straight to drawing.
    app.setFormLevel(true);
  });

  const exampleSelect = $<HTMLSelectElement>('load-example');
  exampleSelect.addEventListener('change', async () => {
    const path = exampleSelect.value;
    exampleSelect.value = '';
    if (!path) return;
    const name = path.split('/').pop()!;
    const svg = name.endsWith('.svg');
    const project = isProjectName(name);
    // An SVG example is sewn first and a project is fetched only now: the list says so meanwhile.
    const label = exampleSelect.options[0];
    if (svg || project) {
      exampleSelect.disabled = true;
      label.textContent = t(svg ? 'files.example.loading' : 'files.example.opening');
    }
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const file = new File([await res.blob()], name, svg ? { type: 'image/svg+xml' } : undefined);
      if (svg) {
        const d = await digitizeSvg(file, app.settings.image.prepare, digitizeDefaults(app.settings.profile));
        await app.addDigitized(d, name.replace(/\.svg$/, ''));
      } else if (project) await openFiles([file]);
      else await app.files.add([file]);
    } catch (err) {
      console.error('Loading the example failed', err);
    } finally {
      exampleSelect.disabled = false;
      label.textContent = t('files.example');
    }
  });

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (++dragDepth === 1) document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      document.body.classList.remove('dragging');
    }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    if (e.dataTransfer?.files.length) void openFiles(e.dataTransfer.files);
  });

  // Installed PWA opened via "Open with" on a .dst/.pes file (manifest file_handlers).
  interface LaunchParams {
    files: { getFile(): Promise<File> }[];
  }
  const launchQueue = (window as unknown as { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } })
    .launchQueue;
  launchQueue?.setConsumer(async (params) => {
    if (params.files.length) void openFiles(await Promise.all(params.files.map((h) => h.getFile())));
  });

  return { openFiles, openProject, adoptMaterial, storeMaterial };
}
