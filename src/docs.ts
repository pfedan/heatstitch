import './docs.css';
import { detectLang, docsUrl, pageLang, type Lang } from './i18n';
import { loadSettings, saveSettings } from './settings';

// Each language has its own address (docs.html, de/docs.html, see src/build/langPages.ts) and only
// its own article. Choosing the other language goes there; whoever reads in the other language is
// shown the way with a hint, not sent there unasked.
const settings = loadSettings();
const select = document.getElementById('lang') as HTMLSelectElement;
const page = pageLang() ?? detectLang(settings.lang);

const HINT: Record<Lang, [string, string]> = {
  de: ['Diese Anleitung gibt es auch ', 'auf Deutsch'],
  en: ['This guide is also ', 'in English'],
};

function show(l: Lang): void {
  document.documentElement.lang = l;
  document.documentElement.dataset.lang = l;
  select.value = l;
}

select.addEventListener('change', () => {
  settings.lang = select.value as Lang;
  saveSettings(settings);
  if (pageLang()) location.href = docsUrl(settings.lang, location.hash);
  else show(settings.lang);
});
show(page);

const wanted = detectLang(settings.lang);
const hint = document.getElementById('lang-hint');
if (hint && pageLang() && wanted !== page) {
  const [text, link] = HINT[wanted];
  const a = Object.assign(document.createElement('a'), { href: docsUrl(wanted), textContent: link });
  a.addEventListener('click', () => (a.href = docsUrl(wanted, location.hash)));
  hint.lang = wanted;
  hint.replaceChildren(text, a, '.');
  hint.hidden = false;
}

// A video card opens the player in a dialog of medium size, with full screen one tap away.
// Subtitles are off until asked for. They come from the same host as the video, which needs a
// CORS request: a first fetch of one subtitle file tells whether that host allows it; where it
// does not (the guide shown from another origin), the video plays without them and the subtitle
// switch goes away.
const dialog = document.getElementById('video-dialog') as HTMLDialogElement;
const dialogTitle = document.getElementById('video-dialog-title') as HTMLElement;
const dialogStage = document.getElementById('video-dialog-stage') as HTMLElement;
const ccGroup = dialog.querySelector<HTMLElement>('.video-cc')!;
const ccButtons = Array.from(ccGroup.querySelectorAll<HTMLButtonElement>('button[data-cc]'));
let cc = 'off';
let player: HTMLVideoElement | null = null;
let subtitlesAllowed: Promise<boolean> | null = null;

function showSubtitles(which: string): void {
  cc = which;
  for (const b of ccButtons) b.setAttribute('aria-pressed', String(b.dataset.cc === which));
  if (!player) return;
  for (const t of Array.from(player.textTracks)) t.mode = t.language === which ? 'showing' : 'disabled';
}
for (const b of ccButtons) b.addEventListener('click', () => showSubtitles(b.dataset.cc ?? 'off'));

function closePlayer(): void {
  if (player) {
    player.pause();
    player.removeAttribute('src');
    player.load();
    player.remove();
    player = null;
  }
  if (dialog.open) dialog.close();
}
document.getElementById('video-close')?.addEventListener('click', closePlayer);
dialog.addEventListener('close', closePlayer);
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) closePlayer();
});
document.getElementById('video-full')?.addEventListener('click', () => {
  const v = player as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
  if (!v) return;
  if (v.requestFullscreen) void v.requestFullscreen();
  else v.webkitEnterFullscreen?.();
});

// Files that belong to a video (the embroidery file or picture the video works with) hang in a
// small menu of the dialog. The page names them on the card; a HEAD request drops the ones the
// host does not have, and where the host refuses the request the names stay as given.
const filesMenu = document.getElementById('video-files') as HTMLDetailsElement;
const filesList = document.getElementById('video-files-menu') as HTMLElement;
const fileKinds: Record<string, [string, string]> = {
  pes: ['Stickmuster', 'embroidery file'],
  dst: ['Stickmuster', 'embroidery file'],
  svg: ['Vektorgrafik', 'vector image'],
  jpg: ['Bild', 'image'],
  jpeg: ['Bild', 'image'],
  png: ['Bild', 'image'],
};
let filesRun = 0;

function offerFiles(base: string, key: string, names: string[]): void {
  const run = ++filesRun;
  filesMenu.open = false;
  filesMenu.hidden = true;
  filesList.replaceChildren();
  if (!names.length) return;
  const items = names.map((name) => {
    const url = `${base}${key}-${name}`;
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.append(name);
    const kind = fileKinds[name.split('.').pop()?.toLowerCase() ?? ''];
    if (kind) {
      const small = document.createElement('small');
      for (const [l, text] of [['de', kind[0]], ['en', kind[1]]]) {
        const span = document.createElement('span');
        span.lang = l;
        span.textContent = text;
        small.append(span);
      }
      a.append(small);
    }
    a.addEventListener('click', () => (filesMenu.open = false));
    li.append(a);
    const exists = fetch(url, { method: 'HEAD', mode: 'cors' })
      .then((r) => r.ok)
      .catch(() => true);
    return { li, exists };
  });
  void Promise.all(items.map((i) => i.exists)).then((found) => {
    if (run !== filesRun || !dialog.open) return;
    const kept = items.filter((_, i) => found[i]).map((i) => i.li);
    filesList.replaceChildren(...kept);
    filesMenu.hidden = kept.length === 0;
  });
}
dialog.addEventListener('click', (e) => {
  if (filesMenu.open && !filesMenu.contains(e.target as Node)) filesMenu.open = false;
});
dialog.addEventListener('close', () => (filesMenu.open = false));

function openPlayer(base: string, key: string, title: string, files: string[] = []): void {
  const build = (subtitles: boolean) => {
    const v = document.createElement('video');
    v.controls = true;
    v.autoplay = true;
    v.playsInline = true;
    v.preload = 'metadata';
    v.poster = `${base}${key}.jpg`;
    if (subtitles) {
      v.crossOrigin = 'anonymous';
      for (const l of ['de', 'en']) {
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.srclang = l;
        track.label = l === 'de' ? 'Deutsch' : 'English';
        track.src = `${base}${key}.${l}.vtt`;
        v.append(track);
      }
    }
    v.src = `${base}${key}.mp4`;
    player?.remove();
    player = v;
    dialogStage.append(v);
    ccGroup.hidden = !subtitles;
    showSubtitles(subtitles ? cc : 'off');
    v.focus();
  };
  dialogTitle.textContent = title;
  offerFiles(base, key, files);
  dialogStage.replaceChildren();
  if (!dialog.open) dialog.showModal();
  subtitlesAllowed ??= fetch(`${base}${key}.de.vtt`, { mode: 'cors' })
    .then((r) => r.ok)
    .catch(() => false);
  void subtitlesAllowed.then((ok) => {
    if (dialog.open) build(ok);
  });
}

for (const li of document.querySelectorAll<HTMLElement>('.video[data-key]')) {
  const btn = li.querySelector<HTMLButtonElement>('.video-play');
  const key = li.dataset.key ?? '';
  const part = li.querySelector('.video-part')?.textContent?.trim() ?? '';
  const name = Array.from(li.querySelector('.video-title')?.childNodes ?? [])
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const title = [part, name].filter(Boolean).join(' · ');
  const files = (li.dataset.files ?? '').split(/\s+/).filter(Boolean);
  btn?.addEventListener('click', () => openPlayer(li.closest<HTMLElement>('.videos')?.dataset.base ?? '', key, title, files));
}

// On narrow screens a button at the thumb opens a sheet with the sections of the shown article
// (src/docs.css hides both beside the rail of wide screens); the button names the current section.
const fab = document.getElementById('toc-open') as HTMLButtonElement;
const here = document.getElementById('toc-here') as HTMLElement;
const sheet = document.getElementById('toc-sheet') as HTMLElement;
const sheetNav = document.getElementById('toc-sheet-nav') as HTMLElement;
const sheetLinks = new Map<string, HTMLAnchorElement>();

function openSheet(open: boolean): void {
  sheet.hidden = !open;
  fab.setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : '';
  if (open) (sheetNav.querySelector<HTMLAnchorElement>('a.active') ?? sheetNav.querySelector<HTMLAnchorElement>('a'))?.focus();
  else fab.focus();
}

function fillSheet(): void {
  sheetNav.replaceChildren();
  sheetLinks.clear();
  const article = [...document.querySelectorAll<HTMLElement>('article')].find((a) => a.offsetParent);
  for (const a of article?.querySelectorAll<HTMLAnchorElement>('.toc a') ?? []) {
    const c = a.cloneNode(true) as HTMLAnchorElement;
    c.classList.remove('active');
    sheetNav.append(c);
    sheetLinks.set(c.hash.slice(1), c);
  }
}

fab.hidden = false;
fab.addEventListener('click', () => openSheet(!!sheet.hidden));
document.getElementById('toc-close')?.addEventListener('click', () => openSheet(false));
sheet.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t === sheet || t.closest('a')) openSheet(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !sheet.hidden) openSheet(false);
});

// The table of contents marks the section that is on screen (a rail on wide screens, the sheet and the button on narrow ones).
const marks: (() => void)[] = [];
for (const article of document.querySelectorAll<HTMLElement>('article')) {
  const links = new Map<string, HTMLAnchorElement>();
  for (const a of article.querySelectorAll<HTMLAnchorElement>('.toc a')) links.set(a.hash.slice(1), a);
  const headings = [...article.querySelectorAll<HTMLElement>('h2[id]')].filter((h) => links.has(h.id));
  let current = '';
  marks.push(() => {
    if (!article.offsetParent) return;
    const line = 90;
    let id = headings[0]?.id ?? '';
    for (const h of headings) if (h.getBoundingClientRect().top <= line) id = h.id;
    if (id === current) return;
    links.get(current)?.classList.remove('active');
    links.get(id)?.classList.add('active');
    sheetLinks.get(current)?.classList.remove('active');
    sheetLinks.get(id)?.classList.add('active');
    here.textContent = links.get(id)?.textContent ?? '';
    current = id;
  });
}
const markAll = (): void => marks.forEach((m) => m());
window.addEventListener('scroll', markAll, { passive: true });
window.addEventListener('resize', markAll);
select.addEventListener('change', () => {
  fillSheet();
  markAll();
});
fillSheet();
markAll();
