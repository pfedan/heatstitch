/**
 * Texts of the splash shown while the app and its compute core load (index.html). They are needed
 * before the app's script is there, so the build writes both languages into the page
 * (src/build/boot.ts). English mirrors German.
 */
export const de = {
  'boot.loading': 'heatstitch wird geladen',
  'boot.failed': 'heatstitch konnte nicht geladen werden. Prüfe die Internetverbindung und lade die Seite neu.',
  'boot.old': 'Dieser Browser kann heatstitch nicht ausführen. Nimm bitte eine aktuelle Version von Chrome, Edge, Firefox oder Safari.',
  'boot.reload': 'Neu laden',
} as const;

export const en: Record<keyof typeof de, string> = {
  'boot.loading': 'Loading heatstitch',
  'boot.failed': 'heatstitch could not be loaded. Check the internet connection and reload the page.',
  'boot.old': 'This browser cannot run heatstitch. Please use a current version of Chrome, Edge, Firefox or Safari.',
  'boot.reload': 'Reload',
};
