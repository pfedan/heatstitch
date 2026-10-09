import { detectLang, pageLang, type Lang } from './i18n';
import { loadSettings, saveSettings } from './settings';

/**
 * The language of the guide and the video page. Each language has its own address (docs.html,
 * de/docs.html, see src/build/langPages.ts) and only its own article. Choosing the other language
 * goes there; whoever reads in the other language is shown the way with a hint, not sent there
 * unasked.
 */
export function initPageLang(url: (l: Lang, hash?: string) => string, hint: Record<Lang, [string, string]>): HTMLSelectElement {
  const settings = loadSettings();
  const select = document.getElementById('lang') as HTMLSelectElement;
  const page = pageLang() ?? detectLang(settings.lang);

  function show(l: Lang): void {
    document.documentElement.lang = l;
    document.documentElement.dataset.lang = l;
    select.value = l;
  }

  select.addEventListener('change', () => {
    settings.lang = select.value as Lang;
    saveSettings(settings);
    if (pageLang()) location.href = url(settings.lang, location.hash);
    else show(settings.lang);
  });
  show(page);

  const wanted = detectLang(settings.lang);
  const box = document.getElementById('lang-hint');
  if (box && pageLang() && wanted !== page) {
    const [text, link] = hint[wanted];
    const a = Object.assign(document.createElement('a'), { href: url(wanted), textContent: link });
    a.addEventListener('click', () => (a.href = url(wanted, location.hash)));
    box.lang = wanted;
    box.replaceChildren(text, a, '.');
    box.hidden = false;
  }
  return select;
}
