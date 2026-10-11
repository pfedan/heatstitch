import './docs.css';
import { initPageLang } from './docsLang';
import { watchPath } from './videos/catalog';
import { initWatch } from './videos/player';

// The page of one video: the guide's header, the video, and the parts before and after.
const key = document.querySelector<HTMLElement>('article[data-key]')?.dataset.key ?? '';
initPageLang((l) => import.meta.env.BASE_URL + watchPath(key, l), {
  de: ['Diese Seite gibt es auch ', 'auf Deutsch'],
  en: ['This page is also ', 'in English'],
});
initWatch();
