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

// The table of contents marks the section that is on screen (a rail on wide screens).
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
    current = id;
  });
}
const markAll = (): void => marks.forEach((m) => m());
window.addEventListener('scroll', markAll, { passive: true });
window.addEventListener('resize', markAll);
select.addEventListener('change', markAll);
markAll();
