import { getLang, onLangChange, releasesUrl } from '../i18n';

/** Which build this is (vite.config.ts, src/build/version.ts); a test run has neither and counts as dev. */
export const APP_VERSION = import.meta.env.APP_VERSION ?? '0.0.0';
export const APP_CHANNEL = import.meta.env.APP_CHANNEL ?? 'dev';

/**
 * The version at the end of the "More" menu, linked to the release notes, and on the beta a badge
 * beside the logo: it says this is the newest state of development, with designs kept apart from
 * heatstitch.app (another address has its own storage), and leads to what is new in it.
 */
export function initVersion(link: HTMLAnchorElement, label: HTMLElement, badge: HTMLAnchorElement): void {
  const beta = APP_CHANNEL === 'beta';
  badge.hidden = !beta;
  label.textContent = APP_VERSION;
  onLangChange(() => {
    const lang = getLang();
    link.href = releasesUrl(lang);
    badge.href = releasesUrl(lang, '#beta');
  });
}
