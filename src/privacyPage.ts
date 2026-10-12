import './docs.css';
import { privacyUrl } from './i18n';
import { initPageLang } from './docsLang';
import { email } from './privacyContact';

// The privacy page: the guide's header and look, one article per language.
initPageLang(privacyUrl, {
  de: ['Diese Seite gibt es auch ', 'auf Deutsch'],
  en: ['This page is also ', 'in English'],
});

const mail = email();
for (const box of document.querySelectorAll<HTMLElement>('[data-email]'))
  box.replaceChildren(Object.assign(document.createElement('a'), { href: `mailto:${mail}`, textContent: mail }));
