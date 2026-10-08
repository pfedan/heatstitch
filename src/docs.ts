import './docs.css';
import { detectLang, type Lang } from './i18n';
import { loadSettings, saveSettings } from './settings';

// The guide holds both languages; without JS both show, with JS only the app's language.
const settings = loadSettings();
const select = document.getElementById('lang') as HTMLSelectElement;

function show(l: Lang): void {
  document.documentElement.lang = l;
  document.documentElement.dataset.lang = l;
  select.value = l;
}

select.addEventListener('change', () => {
  settings.lang = select.value as Lang;
  saveSettings(settings);
  show(settings.lang);
});
show(detectLang(settings.lang));

// A video card becomes the player on a tap; nothing of the video loads before that.
// The subtitles come from the same host as the video, which needs a CORS request: where that is
// refused (the guide shown from another origin), the video plays again without them.
for (const li of document.querySelectorAll<HTMLElement>('.video[data-key]')) {
  const btn = li.querySelector<HTMLButtonElement>('.video-play');
  const base = li.closest<HTMLElement>('.videos')?.dataset.base ?? '';
  const key = li.dataset.key ?? '';
  const lang = li.closest('article')?.getAttribute('lang') ?? 'de';
  btn?.addEventListener('click', () => {
    const play = (subtitles: boolean) => {
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
          if (l === lang) track.default = true;
          v.append(track);
        }
        v.addEventListener('error', () => play(false), { once: true });
      }
      v.src = `${base}${key}.mp4`;
      li.querySelector('.video-play, video')?.replaceWith(v);
      v.focus();
    };
    play(true);
  });
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
