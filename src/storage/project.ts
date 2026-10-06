/**
 * The heatstitch project file (.heatstitch): everything open in the app in one file, including what
 * DST and PES cannot hold. Per embroidery file: the original bytes as loaded, the working copy with
 * its exact thread colors, the acknowledged findings and the shapes and fill settings of objects
 * given new stitches; besides the files the image of the Bild mode with its color changes and
 * brush strokes, and the material and design settings.
 *
 * The file is gzip-compressed JSON. Binary data is stored as base64 of its little-endian bytes,
 * tagged with its array type: `{ "$bin": "i32", "b64": "..." }`.
 */

import { normalizeCorrection } from '../correct/auto';
import type { StoredAside } from '../model/aside';
import type { StoredObject } from '../model/restitch';
import { DEFAULTS, hexColor, normalizeImage, type ImageSettings, type Settings } from '../settings';
import { isAcknowledgement, type Acknowledgement } from '../validation/acks';
import { normalizeProfile } from '../validation/profiles';
import { normalizeChecks } from '../validation/validate';
import { titlesOf, type StoredPattern, type Titles } from './fileStore';
import type { StoredWork } from './imageStore';

export const PROJECT_EXT = '.heatstitch';
export const PROJECT_MIME = 'application/x-heatstitch-project';
/** Raised whenever the content changes in a way older versions would misread. */
export const PROJECT_VERSION = 1;
const MAGIC = 'heatstitch-project';

export interface ProjectFile {
  name: string;
  /** The file as it was loaded (DST or PES bytes). */
  data: Uint8Array;
  /** The edited version; absent while the file is unchanged. */
  working?: StoredPattern;
  acks: Acknowledgement[];
  objects: StoredObject[];
  /** Shapes of the working copy that are not sewn (absent in older projects). */
  aside?: StoredAside[];
  /** This design's fabric, thread, hoop, fabric color and checks (absent in older projects, which share the project settings). */
  material?: unknown;
  /** The name the user gave the design, without extension (absent: its file name). */
  title?: string;
  /** The name per app language, in place of `title` (the demo project's designs); absent once renamed. */
  titles?: Titles;
  /** Made in the app rather than loaded as an embroidery file (absent in older projects). */
  own?: boolean;
}

export interface ProjectImage {
  name: string;
  type: string;
  data: Uint8Array;
  work: StoredWork;
}

/** The settings that belong to the design rather than to how the app is looked at. */
export type ProjectSettings = Pick<Settings, 'profile' | 'checks' | 'correction' | 'trimMm' | 'order' | 'machineSpm' | 'trimSeconds' | 'colorSeconds'> & {
  image: Pick<ImageSettings, 'prepare' | 'stitch'>;
  /** The fabric color the design is shown on (null: the theme's); absent in older projects. */
  background?: string | null;
};

export interface Project {
  files: ProjectFile[];
  /** Index of the file that was active, or null. */
  active: number | null;
  image: ProjectImage | null;
  settings: ProjectSettings;
}

/** Why a project could not be opened: not a project file (or damaged), or written by a newer version. */
export class ProjectError extends Error {
  constructor(
    readonly reason: 'invalid' | 'newer',
    message: string,
  ) {
    super(message);
  }
}

export const isProjectName = (name: string) => name.toLowerCase().endsWith(PROJECT_EXT);

export function projectSettings(s: Settings): ProjectSettings {
  return structuredClone({
    profile: s.profile,
    checks: s.checks,
    correction: s.correction,
    trimMm: s.trimMm,
    order: s.order,
    machineSpm: s.machineSpm,
    trimSeconds: s.trimSeconds,
    colorSeconds: s.colorSeconds,
    image: { prepare: s.image.prepare, stitch: s.image.stitch },
    background: s.background,
  });
}

// Binary data in JSON -------------------------------------------------------------------------

type Tag = 'u8' | 'i32' | 'f32';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function encodeArray(a: Uint8Array | Int32Array | Float32Array): { $bin: Tag; b64: string } {
  if (a instanceof Uint8Array) return { $bin: 'u8', b64: toBase64(a) };
  const bytes = new Uint8Array(a.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < a.length; i++) {
    if (a instanceof Int32Array) view.setInt32(i * 4, a[i], true);
    else view.setFloat32(i * 4, a[i], true);
  }
  return { $bin: a instanceof Int32Array ? 'i32' : 'f32', b64: toBase64(bytes) };
}

function decodeArray(tag: Tag, b64: string): Uint8Array | Int32Array | Float32Array {
  const bytes = fromBase64(b64);
  if (tag === 'u8') return bytes;
  if (bytes.length % 4) throw new ProjectError('invalid', 'Truncated binary data');
  const view = new DataView(bytes.buffer);
  const n = bytes.length / 4;
  const out = tag === 'i32' ? new Int32Array(n) : new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = tag === 'i32' ? view.getInt32(i * 4, true) : view.getFloat32(i * 4, true);
  return out;
}

// Compression ---------------------------------------------------------------------------------

const GZIP = [0x1f, 0x8b];

async function through(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

// Writing and reading -------------------------------------------------------------------------

/** The project as the bytes of a .heatstitch file. */
export async function encodeProject(p: Project, savedAt = new Date()): Promise<Uint8Array> {
  const doc = {
    format: MAGIC,
    version: PROJECT_VERSION,
    savedAt: savedAt.toISOString(),
    settings: p.settings,
    active: p.active,
    files: p.files,
    image: p.image,
  };
  const json = JSON.stringify(doc, (_k, v: unknown) =>
    v instanceof Uint8Array || v instanceof Int32Array || v instanceof Float32Array ? encodeArray(v) : v,
  );
  const bytes = new TextEncoder().encode(json);
  // Browsers without compression streams write the JSON as it is; both open again.
  return typeof CompressionStream === 'function' ? through(bytes, new CompressionStream('gzip')) : bytes;
}

/** Reads a .heatstitch file. Throws a ProjectError when it is not one or is too new to read. */
export async function decodeProject(bytes: Uint8Array): Promise<Project> {
  let raw: unknown;
  try {
    const plain = bytes[0] === GZIP[0] && bytes[1] === GZIP[1] ? await through(bytes, new DecompressionStream('gzip')) : bytes;
    raw = JSON.parse(new TextDecoder().decode(plain), (_k, v: unknown) => {
      const b = v as { $bin?: unknown; b64?: unknown } | null;
      if (b && typeof b === 'object' && typeof b.$bin === 'string' && typeof b.b64 === 'string' && ['u8', 'i32', 'f32'].includes(b.$bin)) {
        return decodeArray(b.$bin as Tag, b.b64);
      }
      return v;
    });
  } catch (err) {
    if (err instanceof ProjectError) throw err;
    throw new ProjectError('invalid', 'Not a heatstitch project file');
  }
  const doc = raw as Record<string, unknown> | null;
  if (!doc || doc.format !== MAGIC || typeof doc.version !== 'number') throw new ProjectError('invalid', 'Not a heatstitch project file');
  if (doc.version > PROJECT_VERSION) throw new ProjectError('newer', `Project version ${doc.version} is newer than this app`);

  const files = (Array.isArray(doc.files) ? doc.files : []).flatMap((f): ProjectFile[] => {
    const e = f as Partial<ProjectFile> | null;
    if (typeof e?.name !== 'string' || !(e.data instanceof Uint8Array)) return [];
    return [
      {
        name: e.name,
        data: e.data,
        ...(isWorking(e.working) ? { working: e.working } : {}),
        acks: Array.isArray(e.acks) ? e.acks.filter(isAcknowledgement) : [],
        // Checked when they are remembered again (restoreRemembered).
        objects: Array.isArray(e.objects) ? e.objects : [],
        // Checked when they are read (asideFrom).
        ...(Array.isArray(e.aside) && e.aside.length ? { aside: e.aside } : {}),
        // Checked when it is read (normalizeMaterial).
        ...(e.material && typeof e.material === 'object' ? { material: e.material } : {}),
        ...(typeof e.title === 'string' && e.title.trim() ? { title: e.title.trim() } : {}),
        ...(titlesOf(e.titles) ? { titles: titlesOf(e.titles) } : {}),
        ...(e.own === true ? { own: true } : {}),
      },
    ];
  });
  const active = typeof doc.active === 'number' && Number.isInteger(doc.active) && doc.active >= 0 && doc.active < files.length ? doc.active : null;
  return { files, active, image: readImage(doc.image), settings: readSettings(doc.settings) };
}

function isWorking(w: unknown): w is StoredPattern {
  const s = w as StoredPattern | null;
  return !!s && s.x instanceof Int32Array && s.y instanceof Int32Array && s.cmd instanceof Uint8Array && Array.isArray(s.colors);
}

function readImage(v: unknown): ProjectImage | null {
  const i = v as Partial<ProjectImage> | null;
  if (!i || typeof i.name !== 'string' || typeof i.type !== 'string' || !(i.data instanceof Uint8Array)) return null;
  const w = (i.work ?? {}) as Partial<StoredWork>;
  return {
    name: i.name,
    type: i.type,
    data: i.data,
    work: { edits: Array.isArray(w.edits) ? w.edits : [], strokes: Array.isArray(w.strokes) ? w.strokes : [] },
  };
}

function readSettings(v: unknown): ProjectSettings {
  const s = (v ?? {}) as Partial<ProjectSettings>;
  const positive = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : d);
  const image = normalizeImage({ prepare: s.image?.prepare, stitch: s.image?.stitch } as Partial<ImageSettings>);
  return {
    profile: normalizeProfile(s.profile),
    checks: normalizeChecks(s.checks),
    correction: normalizeCorrection(s.correction),
    trimMm: positive(s.trimMm, DEFAULTS.trimMm),
    order: {
      combineColors: typeof s.order?.combineColors === 'boolean' ? s.order.combineColors : true,
      shortestWays: typeof s.order?.shortestWays === 'boolean' ? s.order.shortestWays : true,
      reverse: typeof s.order?.reverse === 'boolean' ? s.order.reverse : true,
    },
    machineSpm: positive(s.machineSpm, DEFAULTS.machineSpm),
    trimSeconds: typeof s.trimSeconds === 'number' && s.trimSeconds >= 0 ? s.trimSeconds : DEFAULTS.trimSeconds,
    colorSeconds: typeof s.colorSeconds === 'number' && s.colorSeconds >= 0 ? s.colorSeconds : DEFAULTS.colorSeconds,
    image: { prepare: image.prepare, stitch: image.stitch },
    ...('background' in s ? { background: hexColor(s.background) } : {}),
  };
}
