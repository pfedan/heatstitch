/**
 * Prefix for every storage key. Pull request previews run on the same origin as the real site,
 * so they get their own IndexedDB database and localStorage keys and never touch the files and
 * settings someone keeps in the real app.
 */
const preview = /\/pr-preview\/([^/]+)\//.exec(import.meta.env.BASE_URL)?.[1];

export const STORAGE_NS = preview ? `heatstitch-preview-${preview}` : 'heatstitch';
