/**
 * Records how the app is used, as steps a person would describe: "clicked the button Duplizieren",
 * "dragged on the stage from 12.5 mm, 30 mm by 40 px to the right", "typed Anna into Text". After
 * each change of the active design it notes a hash of it, so a replay can tell where it parts from
 * what happened here. tools/recording/ablauf.mjs turns a recording into a screencast script
 * (docs/screencasts/*\/ablauf.mjs), and tools/recording/replay.mjs plays it back.
 *
 * Raw events would not replay: the stage is a canvas, and its pixels depend on the window and the
 * zoom. So buttons and fields are named as Playwright finds them (role and accessible name, with
 * the id and a CSS path to fall back on), and points on the stage are kept in mm of the design.
 * Only trusted events count: what the app does by itself (a click on a hidden file input) is not
 * a step.
 */
import { encodeProject } from '../storage/project';
import { STORAGE_NS } from '../storage/namespace';
import { isMac } from '../shell/commands';
import { getLang } from '../i18n';
import { tapInput } from './tap';
import { designState, viewState, type DesignState, type DevApp, type ViewState } from './console';

/** A button, field or other element: how a replay finds it, and where in it the pointer was (0..1). */
export interface Target {
  role?: string;
  name?: string;
  /** Index among the visible elements with the same role and name, when there are several. */
  nth?: number;
  id?: string;
  css: string;
  fx: number;
  fy: number;
}

export interface RecordedFile {
  name: string;
  type: string;
  data: Uint8Array;
}

/** Milliseconds since the recording started. */
type At = { t: number };
export type RecordedEvent = At &
  (
    | { k: 'click'; at: Target; button: number; count: number; mods: string[] }
    /**
     * A press on the stage at `at` (mm), then pointer moves relative to the press: [ms after the press, dx, dy], in mm at the
     * zoom of the press (screen pixels / pixels per mm). Not the design point under the pointer: while panning that stays
     * the same; and not pixels: another window fits the design at another zoom.
     */
    | { k: 'stage'; at: [number, number]; button: number; mods: string[]; moves: [number, number, number][]; count: number }
    | { k: 'wheel'; at: [number, number]; dy: number; mods: string[] }
    | { k: 'key'; key: string }
    /** A field's new value: typed text, a slider, a number or a choice in a list. */
    | { k: 'fill'; at: Target; value: string; kind: 'text' | 'value' | 'select' }
    | { k: 'files'; at: Target; files: RecordedFile[] }
    /** Files dropped from outside, at a point of the page (and of the design, when on the stage). */
    | { k: 'drop'; page: [number, number]; stage?: [number, number]; files: RecordedFile[] }
    /** A drag between elements: a row to another place in a list, a panel edge. */
    | { k: 'drag'; from: Target; to: Target; html5: boolean }
    | ({ k: 'state' } & DesignState)
  );

export interface Recording {
  format: 'heatstitch-recording';
  version: 1;
  started: string;
  url: string;
  lang: string;
  mac: boolean;
  viewport: { w: number; h: number };
  /** The app's localStorage at the start, keys without the storage prefix (settings, view choices). */
  storage: Record<string, string>;
  /** What was open at the start, as a .heatstitch file; null when nothing was. */
  start: Uint8Array | null;
  startState: DesignState;
  view: ViewState;
  events: RecordedEvent[];
}

export interface Recorder {
  readonly running: boolean;
  stop(): void;
  recording(): Recording;
}

const INTERACTIVE =
  'button, a[href], input, select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=option], [role=slider], [role=spinbutton], [role=textbox], [role=combobox], [role=treeitem], [draggable=true]';

const INPUT_ROLE: Record<string, string> = {
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  number: 'spinbutton',
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
  search: 'searchbox',
};

/** The ARIA role Playwright's getByRole would find the element by, for the elements a click lands on. */
export function roleOf(el: Element): string | undefined {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.split(' ')[0];
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a' && el.hasAttribute('href')) return 'link';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') return (el as HTMLSelectElement).multiple || (el as HTMLSelectElement).size > 1 ? 'listbox' : 'combobox';
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type;
    if (type === 'file' || type === 'hidden' || type === 'color') return undefined;
    return INPUT_ROLE[type] ?? 'textbox';
  }
  if (tag === 'li') return 'listitem';
  return undefined;
}

/** Roles whose accessible name may come from their content; a list item's does not. */
const NAME_FROM_CONTENT = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'cell', 'heading', 'tooltip']);

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function hidden(el: Element): boolean {
  return el.getAttribute('aria-hidden') === 'true' || (el instanceof HTMLElement && (el.hidden !== false || getComputedStyle(el).display === 'none'));
}

/** Text of the element's content, as the accessible name takes it (aria-label and alt of children count, hidden parts not). */
function contentName(el: Element): string {
  let out = '';
  for (const n of el.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? '';
    else if (n instanceof Element && !hidden(n)) {
      const label = n.getAttribute('aria-label');
      if (label) out += ` ${label} `;
      else if (n.tagName === 'IMG') out += ` ${n.getAttribute('alt') ?? ''} `;
      else out += ` ${contentName(n)} `;
    }
  }
  return out;
}

/** The accessible name, close to how Chromium computes it for buttons, links and fields. */
export function nameOf(el: Element): string {
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const text = by
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .map((e) => (e ? (e.getAttribute('aria-label') ?? contentName(e)) : ''))
      .join(' ');
    if (clean(text)) return clean(text);
  }
  const label = el.getAttribute('aria-label');
  if (label && clean(label)) return clean(label);
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    const f = el as HTMLInputElement;
    const labels = f.labels ? [...f.labels].map((l) => contentName(l)).join(' ') : '';
    if (clean(labels)) return clean(labels);
    if (tag === 'input' && ['button', 'submit', 'reset'].includes(f.type) && f.value) return clean(f.value);
    if (f.placeholder) return clean(f.placeholder);
  } else if (NAME_FROM_CONTENT.has(roleOf(el) ?? '')) {
    const text = clean(contentName(el));
    if (text) return text;
  }
  return clean(el.getAttribute('title') ?? '');
}

const visible = (el: Element) => el.getClientRects().length > 0 && !el.closest('[aria-hidden=true], [inert]');

/** A CSS path to the element: from the nearest ancestor with an id, by tag and place among its kind. */
export function cssPath(el: Element): string {
  const parts: string[] = [];
  let e: Element | null = el;
  while (e && e !== document.documentElement) {
    if (e.id) {
      parts.unshift(`#${CSS.escape(e.id)}`);
      break;
    }
    const tag = e.tagName.toLowerCase();
    const same: Element[] = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e!.tagName) : [];
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(e) + 1})` : tag);
    e = e.parentElement;
  }
  return parts.join(' > ');
}

/** Describes the element a pointer or key event landed on: the button or field around it, how to find it again. */
export function describe(raw: Element, x?: number, y?: number): Target {
  const el = raw.closest(INTERACTIVE) ?? raw;
  const r = el.getBoundingClientRect();
  const fx = x === undefined || r.width === 0 ? 0.5 : Math.min(1, Math.max(0, (x - r.left) / r.width));
  const fy = y === undefined || r.height === 0 ? 0.5 : Math.min(1, Math.max(0, (y - r.top) / r.height));
  const t: Target = { css: cssPath(el), fx: Math.round(fx * 100) / 100, fy: Math.round(fy * 100) / 100 };
  if (el.id) t.id = el.id;
  const role = roleOf(el);
  const name = role ? nameOf(el) : '';
  if (role && name) {
    t.role = role;
    t.name = name;
    const all = [...document.querySelectorAll(el.tagName)].concat([...document.querySelectorAll(`[role="${role}"]`)]);
    const same = [...new Set(all)].filter((e) => visible(e) && roleOf(e) === role && nameOf(e) === name);
    const i = same.indexOf(el);
    if (same.length > 1 && i >= 0) t.nth = i;
  }
  return t;
}

const MODS = ['Shift', 'Alt'] as const;
/** Modifier keys held during a pointer event, as Playwright names them; Cmd on a Mac and Ctrl elsewhere both become ControlOrMeta. */
function modsOf(e: MouseEvent | KeyboardEvent): string[] {
  const out: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) out.push('ControlOrMeta');
  if (isMac && e.ctrlKey) out.push('Control');
  for (const m of MODS) if (e.getModifierState(m)) out.push(m);
  return out;
}

/** The key as Playwright's keyboard.press takes it: "ControlOrMeta+KeyZ", "Delete", "k". */
export function keyName(e: KeyboardEvent): string | null {
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Unidentified'].includes(e.key)) return null;
  const mods = modsOf(e);
  // With a modifier the layout's character can change (Shift+7 is "/"), the code does not.
  const key = mods.length && /^(Key|Digit)/.test(e.code) ? e.code : e.key === ' ' ? 'Space' : e.key;
  return [...mods, key].join('+');
}

const editable = (el: EventTarget | null): el is HTMLElement =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(el.type)) ||
  (el instanceof HTMLElement && el.isContentEditable);

const readFiles = (list: FileList): Promise<RecordedFile[]> =>
  Promise.all([...list].map(async (f) => ({ name: f.name, type: f.type, data: new Uint8Array(await f.arrayBuffer()) })));

/** A press counts as a drag once the pointer moved this far (CSS px). */
const DRAG_PX = 4;
/** Pointer moves during a press are kept at most this often (ms) unless the pointer turned. */
const MOVE_MS = 30;
/** Wheel steps closer than this (ms) at the same point make one step. */
const WHEEL_MS = 200;
/** How often the active design is looked at for a change (ms). */
const STATE_MS = 250;

function storageNow(): Record<string, string> {
  const out: Record<string, string> = {};
  const prefix = `${STORAGE_NS}.`;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = localStorage.getItem(k) ?? '';
  }
  return out;
}

export async function startRecorder(app: DevApp): Promise<Recorder> {
  const project = app.project();
  delete project.recording;
  const somethingOpen = project.files.length > 0 || !!project.image;
  const t0 = performance.now();
  const rec: Recording = {
    format: 'heatstitch-recording',
    version: 1,
    started: new Date().toISOString(),
    url: location.href,
    lang: getLang(),
    mac: isMac,
    viewport: { w: innerWidth, h: innerHeight },
    storage: storageNow(),
    start: somethingOpen ? await encodeProject(project) : null,
    startState: designState(app.files),
    view: viewState(app),
    events: [],
  };
  const ev = rec.events;
  const now = () => Math.round(performance.now() - t0);
  const last = () => ev[ev.length - 1];
  const toMm = (e: MouseEvent): [number, number] => {
    const r = app.canvas.getBoundingClientRect();
    const [x, y] = app.vp.toWorld(e.clientX - r.left, e.clientY - r.top);
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
  };
  const onStage = (e: Event) => e.target === app.canvas;

  // Pointer: presses on the stage, clicks and drags elsewhere ----------------------------------

  let stroke: Extract<RecordedEvent, { k: 'stage' }> | null = null;
  let strokeAt = { x: 0, y: 0, t: 0, scale: 1 };
  /** The pointer's way since the press, in mm at the zoom of the press. */
  const strokeMove = (e: PointerEvent): [number, number] => [
    Math.round(((e.clientX - strokeAt.x) / strokeAt.scale) * 100) / 100,
    Math.round(((e.clientY - strokeAt.y) / strokeAt.scale) * 100) / 100,
  ];
  let press: { el: Element; x: number; y: number; moved: boolean } | null = null;
  let html5: { from: Target; x: number; y: number } | null = null;
  /** Set once a press became a drag, so its click (fired on the common parent) is not a step too. */
  let dragged = false;

  // Every handler hears its events through the tap (src/dev/tap.ts), ahead of the app's own.
  const handlers = new Map<string, (e: Event) => void>();
  const on = <E extends Event>(_target: Window, type: string, fn: (e: E) => void) => handlers.set(type, fn as (e: Event) => void);

  on<PointerEvent>(window, 'pointerdown', (e) => {
    if (!e.isTrusted || !e.isPrimary) return;
    dragged = false;
    if (onStage(e)) {
      stroke = { t: now(), k: 'stage', at: toMm(e), button: e.button, mods: modsOf(e), moves: [], count: 1 };
      strokeAt = { x: e.clientX, y: e.clientY, t: performance.now(), scale: app.vp.scale };
      ev.push(stroke);
      return;
    }
    press = e.target instanceof Element ? { el: e.target, x: e.clientX, y: e.clientY, moved: false } : null;
  });

  on<PointerEvent>(window, 'pointermove', (e) => {
    if (!e.isTrusted || !e.isPrimary) return;
    if (stroke) {
      const [dx, dy] = strokeMove(e);
      const dt = Math.round(performance.now() - strokeAt.t);
      const prev = stroke.moves[stroke.moves.length - 1];
      if (prev && prev[1] === dx && prev[2] === dy) return;
      // Thin out: a move closer than MOVE_MS to the one before replaces it.
      if (prev && dt - prev[0] < MOVE_MS && stroke.moves.length > 1) stroke.moves[stroke.moves.length - 1] = [dt, dx, dy];
      else stroke.moves.push([dt, dx, dy]);
    } else if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_PX) press.moved = true;
  });

  on<PointerEvent>(window, 'pointerup', (e) => {
    if (!e.isTrusted || !e.isPrimary) return;
    if (stroke) {
      const [dx, dy] = strokeMove(e);
      const prev = stroke.moves[stroke.moves.length - 1];
      if (stroke.moves.length && (!prev || prev[1] !== dx || prev[2] !== dy)) stroke.moves.push([Math.round(performance.now() - strokeAt.t), dx, dy]);
      // A press that hardly moved is a click: its moves would only shake the replay.
      if (stroke.moves.every(([, x, y]) => Math.hypot(x, y) * strokeAt.scale <= DRAG_PX)) stroke.moves = [];
      stroke = null;
      return;
    }
    const p = press;
    press = null;
    // A slider says its value itself (fill); its thumb dragged is not a step of its own.
    if (!p || !p.moved || html5 || (p.el instanceof HTMLInputElement && p.el.type === 'range')) return;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (!under) return;
    ev.push({ t: now(), k: 'drag', from: describe(p.el, p.x, p.y), to: describe(under, e.clientX, e.clientY), html5: false });
    dragged = true;
  });

  on<PointerEvent>(window, 'pointercancel', () => {
    stroke = null;
  });

  on<MouseEvent>(window, 'click', (e) => {
    if (!e.isTrusted || onStage(e) || !(e.target instanceof Element)) return;
    if (dragged) return void (dragged = false);
    const prev = last();
    const at = describe(e.target, e.clientX, e.clientY);
    // The second click of a double click: the click before becomes the double click.
    if (e.detail === 2 && prev?.k === 'click' && prev.at.css === at.css) {
      prev.count = 2;
      return;
    }
    if (e.detail > 2) return;
    ev.push({ t: now(), k: 'click', at, button: 0, count: 1, mods: modsOf(e) });
  });

  on<MouseEvent>(window, 'contextmenu', (e) => {
    if (!e.isTrusted || onStage(e) || !(e.target instanceof Element)) return;
    ev.push({ t: now(), k: 'click', at: describe(e.target, e.clientX, e.clientY), button: 2, count: 1, mods: modsOf(e) });
  });

  // A double click on the stage: its two presses become one step that a replay double clicks.
  on<MouseEvent>(window, 'dblclick', (e) => {
    if (!e.isTrusted || !onStage(e)) return;
    const presses = ev.flatMap((x, i) => (x.k === 'stage' ? [i] : [])).slice(-2);
    if (presses.length < 2) return;
    const [a, b] = presses.map((i) => ev[i] as Extract<RecordedEvent, { k: 'stage' }>);
    if (a.moves.length || b.moves.length || a.count !== 1) return;
    a.count = 2;
    ev.splice(presses[1], 1);
  });

  on<WheelEvent>(window, 'wheel', (e) => {
    if (!e.isTrusted || !onStage(e)) return;
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const prev = last();
    const at = toMm(e);
    // Wheel events come many per gesture; one step per gesture is enough to zoom the same way.
    if (prev?.k === 'wheel' && now() - prev.t < WHEEL_MS) {
      prev.dy += delta;
      prev.t = now();
      return;
    }
    ev.push({ t: now(), k: 'wheel', at, dy: delta, mods: modsOf(e) });
  });

  // Drag and drop: rows in lists, files from outside -----------------------------------------

  on<DragEvent>(window, 'dragstart', (e) => {
    if (!e.isTrusted || !(e.target instanceof Element)) return;
    const from = press ? describe(press.el, press.x, press.y) : describe(e.target, e.clientX, e.clientY);
    html5 = { from, x: e.clientX, y: e.clientY };
  });
  on<DragEvent>(window, 'dragover', (e) => {
    if (html5 && e.isTrusted) {
      html5.x = e.clientX;
      html5.y = e.clientY;
    }
  });
  const endDrag = () => {
    if (!html5) return;
    const under = document.elementFromPoint(html5.x, html5.y);
    if (under) ev.push({ t: now(), k: 'drag', from: html5.from, to: describe(under, html5.x, html5.y), html5: true });
    html5 = null;
    press = null;
    dragged = true;
  };
  // Files count also when the drop or the choice was not a trusted event: the app makes none itself,
  // but a browser test hands files over that way.
  on<DragEvent>(window, 'drop', (e) => {
    if (html5) return e.isTrusted ? endDrag() : undefined;
    const list = e.dataTransfer?.files;
    if (!list?.length) return;
    const step: Extract<RecordedEvent, { k: 'drop' }> = { t: now(), k: 'drop', page: [Math.round(e.clientX), Math.round(e.clientY)], files: [] };
    if (onStage(e)) step.stage = toMm(e);
    ev.push(step);
    void readFiles(list).then((f) => (step.files = f));
  });
  on<DragEvent>(window, 'dragend', () => endDrag());

  // Keys and fields ---------------------------------------------------------------------------

  on<KeyboardEvent>(window, 'keydown', (e) => {
    if (!e.isTrusted || e.isComposing) return;
    // Typing into a field is kept as the field's value (fill); only keys that leave or confirm it count.
    if (editable(e.target) && !['Enter', 'Escape', 'Tab'].includes(e.key) && !(isMac ? e.metaKey : e.ctrlKey)) return;
    const key = keyName(e);
    if (key) ev.push({ t: now(), k: 'key', key });
  });

  on<Event>(window, 'input', (e) => {
    const el = e.target;
    if (!e.isTrusted || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'file'].includes(el.type)) return;
    const at = describe(el);
    const kind = editable(el) ? 'text' : 'value';
    const prev = last();
    // One step per field and edit: the value it ends with.
    if (prev?.k === 'fill' && prev.at.css === at.css) {
      prev.value = el.value;
      prev.t = now();
      return;
    }
    ev.push({ t: now(), k: 'fill', at, value: el.value, kind });
  });

  on<Event>(window, 'change', (e) => {
    const el = e.target;
    if (el instanceof HTMLSelectElement && e.isTrusted) ev.push({ t: now(), k: 'fill', at: describe(el), value: el.value, kind: 'select' });
    else if (el instanceof HTMLInputElement && el.type === 'file' && el.files?.length) {
      const step: Extract<RecordedEvent, { k: 'files' }> = { t: now(), k: 'files', at: describe(el), files: [] };
      ev.push(step);
      void readFiles(el.files).then((f) => (step.files = f));
    }
  });

  // The design after each change ----------------------------------------------------------------

  let seen = app.files.active?.pattern ?? null;
  let seenFile = app.files.active ?? null;
  const timer = setInterval(() => {
    const f = app.files.active ?? null;
    const p = f?.pattern ?? null;
    if (p === seen && f === seenFile) return;
    seen = p;
    seenFile = f;
    ev.push({ t: now(), k: 'state', ...designState(app.files) });
  }, STATE_MS);

  // A small mark in the corner, so it is plain that a recording runs.
  const mark = document.createElement('div');
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = '● REC';
  mark.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:2147483647;pointer-events:none;padding:2px 8px;border-radius:999px;' +
    'background:#c62828;color:#fff;font:600 11px/18px system-ui,sans-serif;letter-spacing:.04em;opacity:.85';
  document.body.append(mark);

  tapInput((e) => handlers.get(e.type)?.(e));

  let running = true;
  return {
    get running() {
      return running;
    },
    stop() {
      if (!running) return;
      running = false;
      clearInterval(timer);
      tapInput(null);
      mark.remove();
    },
    recording: () => rec,
  };
}
