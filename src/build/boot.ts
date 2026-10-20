import { de, en } from '../i18n/areas/boot';
import { STORAGE_NS } from '../storage/namespace';

/** As src/settings.ts keeps it; that module is not loaded here, its imports reach far into the app (tests/boot.test.ts). */
const SETTINGS_KEY = `${STORAGE_NS}.settings.v3`;

/** As JavaScript in a <script>: no "</script>" can come out of a text. */
const js = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/**
 * The splash of the app (#boot in index.html) speaks before the app's script is there: the build
 * writes its texts in both languages and the key of the settings (where the chosen language is)
 * into the small script beside it, which picks the language as the app does.
 */
export function bootPage(html: string): string {
  if (!html.includes('__BOOT_TEXTS__') || !html.includes('__BOOT_SETTINGS__')) throw new Error('boot: the splash script is not in the page');
  return html.replace('__BOOT_TEXTS__', () => js({ de, en })).replace('__BOOT_SETTINGS__', () => js(SETTINGS_KEY));
}
