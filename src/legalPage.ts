import './docs.css';
import { legalUrl } from './i18n';
import { initPageLang } from './docsLang';

// Legal notice and privacy: the guide's header and look, one article per language.
initPageLang(legalUrl, {
  de: ['Diese Seite gibt es auch ', 'auf Deutsch'],
  en: ['This page is also ', 'in English'],
});
