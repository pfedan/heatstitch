import { describe, expect, it } from 'vitest';
import { APP_NAVIGATION, APP_PAGES } from '../src/build/pageCache';

/** Workbox matches the navigation allowlist against path and query. */
const answered = (pathAndQuery: string) => APP_NAVIGATION.test(pathAndQuery);

/** The service worker serves only the app; every other page and file comes from the server as it is. */
describe('service worker scope', () => {
  it('installs the app page in each language', () => {
    expect(APP_PAGES).toEqual(['index.html', 'de/index.html']);
  });

  it('answers the app at its addresses, with a query too', () => {
    for (const path of ['/', '/index.html', '/de/', '/de/index.html', '/?lang=de', '/de/?file=x']) {
      expect(answered(path), path).toBe(true);
    }
  });

  it('leaves the guide, the video page, the sitemap and every other file to the server', () => {
    for (const path of [
      '/docs.html',
      '/de/docs.html',
      '/videos.html',
      '/de/videos.html?x=1',
      '/umzug.html',
      '/sitemap.xml',
      '/robots.txt',
      '/guide/cat-de.jpg',
      '/de/docs',
      '/nope',
    ]) {
      expect(answered(path), path).toBe(false);
    }
  });
});
