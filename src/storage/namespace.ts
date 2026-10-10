/**
 * Prefix for every storage key: the IndexedDB databases and the localStorage keys. Pull request
 * previews have their own address, so they never share storage with the real site. The moving page
 * (public/umzug.html, tools/moved/) copies everything under this prefix from the old address.
 */
export const STORAGE_NS = 'heatstitch';
