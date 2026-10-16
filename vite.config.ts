/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { langPage, type Page } from './src/build/langPages';
import { expandVideos } from './src/build/videoHtml';
import { watchPage } from './src/build/watchPage';
import { sitemap } from './src/build/sitemap';
import { videoByKey, VIDEOS, watchPath } from './src/videos/catalog';
import { APP_NAVIGATION, APP_PAGES } from './src/build/pageCache';
import { expandReleases, parseChangelog, shownReleases } from './src/build/changelog';
import { buildChannel, buildVersion } from './src/build/version';

// The site lives at the root of heatstitch.app; the beta (beta.heatstitch.app) and pull request previews
// get their own address (see .github/workflows/deploy.yml), so every build uses the same base.
// CHANNEL says which one a build is for (release, beta, preview, dev; PREVIEW=1 is preview), see src/build/version.ts.
const base = '/';
const channel = buildChannel(process.env);
const isPreview = channel === 'preview';
const version = buildVersion(process.env);

const pageOf = (file: string): Page =>
  file.endsWith('docs.html')
    ? 'docs'
    : file.endsWith('videos.html')
      ? 'videos'
      : file.endsWith('releases.html')
        ? 'releases'
        : file.endsWith('privacy.html')
          ? 'privacy'
          : 'app';

/**
 * The app and the guide once per language: English at their address, German under de/ (see
 * src/build/langPages.ts). The build writes de/ from the finished English pages; the dev server
 * serves de/ the same way.
 */
const langPages: Plugin = {
  name: 'lang-pages',
  // After Vite wrote the pages, before vite-plugin-pwa lists them, so de/ is precached too.
  generateBundle: {
    order: 'post',
    handler(_, bundle) {
      for (const file of ['index.html', 'docs.html', 'videos.html', 'releases.html', 'privacy.html']) {
        const asset = bundle[file];
        if (asset?.type !== 'asset') throw new Error(`lang-pages: ${file} is not in the build`);
        const html = String(asset.source);
        this.emitFile({ type: 'asset', fileName: `de/${file}`, source: langPage(html, pageOf(file), 'de') });
        asset.source = langPage(html, pageOf(file), 'en');
      }
      // The page of each video in both languages, from the template, which is not served itself.
      const template = bundle['video.html'];
      if (template?.type !== 'asset') throw new Error('lang-pages: video.html is not in the build');
      for (const v of VIDEOS)
        for (const lang of ['en', 'de'] as const)
          this.emitFile({ type: 'asset', fileName: watchPath(v.key, lang), source: watchPage(String(template.source), v, lang) });
      delete bundle['video.html'];
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap() });
    },
  },
  transformIndexHtml(html, ctx) {
    if (!ctx.server || ctx.originalUrl?.includes('/de/')) return html;
    return langPage(html, pageOf(ctx.path), 'en');
  },
  configureServer(server) {
    server.middlewares.use(async (request, res, next) => {
      const req = request as { url?: string; originalUrl?: string };
      const path = (req.url ?? '').replace(base, '/');
      const watch = /^\/(de\/)?videos\/([\w-]+)\.html(?:[?#]|$)/.exec(path);
      const video = watch && videoByKey(watch[2]);
      if (video) {
        const html = await server.transformIndexHtml('/video.html', new TextDecoder().decode(readFileSync(new URL('video.html', import.meta.url))), req.originalUrl);
        res.setHeader('Content-Type', 'text/html');
        res.end(watchPage(html, video, watch[1] ? 'de' : 'en'));
        return;
      }
      if (path === '/sitemap.xml') {
        res.setHeader('Content-Type', 'application/xml');
        res.end(sitemap());
        return;
      }
      const m = /^\/de\/(index\.html|docs\.html|videos\.html|releases\.html|privacy\.html)?(?:[?#]|$)/.exec(path);
      if (!m) return next();
      const file = m[1] ?? 'index.html';
      const html = await server.transformIndexHtml(`/${file}`, new TextDecoder().decode(readFileSync(new URL(file, import.meta.url))), req.originalUrl);
      res.setHeader('Content-Type', 'text/html');
      res.end(langPage(html, pageOf(file), 'de'));
    });
  },
};

/** The tutorial videos, written into the guide and the video page from one list (src/build/videoHtml.ts). */
const videoPages: Plugin = {
  name: 'video-pages',
  transformIndexHtml: { order: 'pre', handler: (html) => expandVideos(html) },
};

/**
 * The release notes (releases.html) from CHANGELOG.md. The beta and the previews show what is not
 * released yet on top; a release build shows the notes waiting under [Unreleased] as its own version.
 */
const releasePages: Plugin = {
  name: 'release-pages',
  transformIndexHtml: {
    order: 'pre',
    handler(html) {
      if (!html.includes('<!-- releases ')) return html;
      const all = parseChangelog(readFileSync(new URL('CHANGELOG.md', import.meta.url), 'utf8'));
      const today = new Date().toISOString().slice(0, 10);
      return expandReleases(html, shownReleases(all, { unreleased: channel !== 'release', version: channel === 'release' ? version : undefined, today }));
    },
  },
};

export default defineConfig({
  base,
  // The version and where the build runs, for the app's menu and the beta's badge (src/ui/version.ts).
  define: {
    'import.meta.env.APP_VERSION': JSON.stringify(version),
    'import.meta.env.APP_CHANNEL': JSON.stringify(channel),
  },
  plugins: [
    videoPages,
    releasePages,
    langPages,
    // Search engines should only index the real site, not the beta or the previews.
    (isPreview || channel === 'beta') && {
      name: 'preview-noindex',
      transformIndexHtml: (html: string) =>
        html.replace('<meta name="robots" content="index, follow" />', '<meta name="robots" content="noindex" />'),
    },
    VitePWA({
      // A preview changes with every push and is only looked at a few times, so it ships no
      // service worker: a reload always shows the latest push instead of a cached one.
      selfDestroying: isPreview,
      // The app asks before switching to a new version (see src/ui/updateNotice.ts).
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'heatstitch',
        short_name: 'heatstitch',
        description: 'View, edit and check DST and PES embroidery files, and turn pictures into stitches',
        theme_color: '#0b1424',
        background_color: '#141118',
        display: 'standalone',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        file_handlers: [
          {
            action: base,
            accept: {
              'application/octet-stream': ['.dst', '.pes', '.pec', '.jef', '.exp', '.vp3', '.xxx', '.sew'],
              'application/x-heatstitch-project': ['.heatstitch'],
              'image/png': ['.png'],
              'image/jpeg': ['.jpg', '.jpeg'],
              'image/webp': ['.webp'],
              'image/svg+xml': ['.svg'],
            },
          },
        ],
      },
      workbox: {
        // A first visit is controlled right away, so the reload button can swap versions in it too.
        clientsClaim: true,
        // Only the app's own pages are installed; the guide, the video page and the moving page always come
        // from the server (src/build/pageCache.ts). The font list and the thread catalogs come along; a font
        // (some 100 KB to 2 MB) only once it is used, then it works offline too. The tooltip pictures are small and come along.
        // So does the list of motifs; a category of motifs (up to some 300 KB) once it was opened.
        globPatterns: [...APP_PAGES, '**/*.{js,css,svg,png,webmanifest,pes}', 'tips/*.webp', 'fonts/index.json', 'threads/catalogs.json', 'library/index.json'],
        runtimeCaching: [
          // The demo project is not part of the install (some 500 KB); it is kept once it was opened.
          {
            urlPattern: /\/examples\/.+\.heatstitch$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'examples', expiration: { maxEntries: 4 } },
          },
          {
            urlPattern: /\/fonts\/.+\.(json|txt)$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'fonts', expiration: { maxEntries: 120 } },
          },
          {
            urlPattern: /\/library\/.+\/[\w-]+\.json$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'library', expiration: { maxEntries: 40 } },
          },
        ],
        // Only crawlers and link previews fetch the social image.
        globIgnores: ['og-image.jpg'],
        // The cached app answers only the app's own addresses. Any other page or file opened on its own (the
        // guide, sitemap.xml, a guide picture in a new tab) reaches the server untouched.
        navigateFallbackAllowlist: [APP_NAVIGATION],
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: { main: 'index.html', docs: 'docs.html', videos: 'videos.html', releases: 'releases.html', privacy: 'privacy.html', watch: 'video.html' },
    },
  },
  worker: { format: 'es' },
  // Sewing whole designs takes a few seconds; with all test files in parallel on a CI runner the
  // 5 s default made slow tests fail at random.
  test: { testTimeout: 30_000 },
});
