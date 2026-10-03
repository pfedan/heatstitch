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
