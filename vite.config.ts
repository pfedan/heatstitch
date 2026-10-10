/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { langPage, type Page } from './src/build/langPages';
import { expandVideos } from './src/build/videoHtml';

// The site lives at the root of heatstitch.app; pull request previews get their own address
// (see .github/workflows/deploy.yml), so every build uses the same base. PREVIEW=1 marks a preview build.
const base = '/';
const isPreview = !!process.env.PREVIEW;

const pageOf = (file: string): Page => (file.endsWith('docs.html') ? 'docs' : file.endsWith('videos.html') ? 'videos' : 'app');

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
      for (const file of ['index.html', 'docs.html', 'videos.html']) {
        const asset = bundle[file];
        if (asset?.type !== 'asset') throw new Error(`lang-pages: ${file} is not in the build`);
        const html = String(asset.source);
        this.emitFile({ type: 'asset', fileName: `de/${file}`, source: langPage(html, pageOf(file), 'de') });
        asset.source = langPage(html, pageOf(file), 'en');
      }
    },
  },
  transformIndexHtml(html, ctx) {
    if (!ctx.server || ctx.originalUrl?.includes('/de/')) return html;
    return langPage(html, pageOf(ctx.path), 'en');
  },
  configureServer(server) {
    server.middlewares.use(async (request, res, next) => {
      const req = request as { url?: string; originalUrl?: string };
      const m = /^\/de\/(index\.html|docs\.html|videos\.html)?(?:[?#]|$)/.exec((req.url ?? '').replace(base, '/'));
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

export default defineConfig({
  base,
  plugins: [
    videoPages,
    langPages,
    // Search engines should only index the real site, not the previews.
    isPreview && {
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
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'heatstitch',
        short_name: 'heatstitch',
        description: 'View, edit and check DST and PES embroidery files, and turn pictures into stitches',
        theme_color: '#1b1026',
        background_color: '#141118',
        display: 'standalone',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
        // The font list and the thread catalogs come along; a font (some 100 KB to 2 MB) only once it is used, then it
        // works offline too. The tooltip pictures are small and come along.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,pes}', 'tips/*.webp', 'fonts/index.json', 'threads/catalogs.json'],
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
        ],
        // Only crawlers and link previews fetch the social image; the moving page only opens once.
        globIgnores: ['og-image.jpg', 'umzug.html'],
        // A file opened on its own, such as a guide picture in a new tab, must reach the network, not the
        // cached app shell: everything with an extension but .html. So must the moving page (public/umzug.html).
        navigateFallbackDenylist: [/\/umzug\.html(?:\?|$)/, /\/[^/?]*\.(?!html(?:\?|$))[^/?]*(?:\?.*)?$/],
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: { main: 'index.html', docs: 'docs.html', videos: 'videos.html' },
    },
  },
  worker: { format: 'es' },
  // Sewing whole designs takes a few seconds; with all test files in parallel on a CI runner the
  // 5 s default made slow tests fail at random.
  test: { testTimeout: 30_000 },
});
