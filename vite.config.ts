import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const SITE_BASE = '/heatstitch/';
// Pull request previews build into a subfolder of the site (see .github/workflows/deploy.yml).
const base = process.env.BASE_PATH || SITE_BASE;
const isPreview = base !== SITE_BASE;

export default defineConfig({
  base,
  plugins: [
    // Search engines should only index the real site, not the previews.
    isPreview && {
      name: 'preview-noindex',
      transformIndexHtml: (html: string) =>
        html.replace('<meta name="robots" content="index, follow" />', '<meta name="robots" content="noindex" />'),
    },
    VitePWA({
      // A preview shares the origin and the scope of the real site's service worker, so it
      // ships none and removes any it finds instead of caching itself over the real app.
      selfDestroying: isPreview,
      // The app asks before switching to a new version (see src/ui/updateNotice.ts).
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'heatstitch',
        short_name: 'heatstitch',
        description: 'Check and fix stitch density in DST and PES embroidery files',
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
            accept: { 'application/octet-stream': ['.dst', '.pes'] },
          },
        ],
      },
      workbox: {
        // A first visit is controlled right away, so the reload button can swap versions in it too.
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,pes}'],
        // Only crawlers and link previews fetch the social image.
        globIgnores: ['og-image.jpg'],
        // Navigations into a preview must reach the network, not the cached app shell.
        navigateFallbackDenylist: [/\/pr-preview\//],
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: { main: 'index.html', docs: 'docs.html' },
    },
  },
  worker: { format: 'es' },
});
