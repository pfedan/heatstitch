import './docs.css';
import { releasesUrl } from './i18n';
import { initPageLang } from './docsLang';

// The release notes: the guide's header and look, the versions written in by the build (src/build/changelog.ts).
initPageLang(releasesUrl, {
  de: ['Diese Seite gibt es auch ', 'auf Deutsch'],
  en: ['This page is also ', 'in English'],
});
