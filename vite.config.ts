import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/heatstitch/',
  plugins: [
    VitePWA({
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
            action: '/heatstitch/',
            accept: { 'application/octet-stream': ['.dst', '.pes'] },
          },
        ],
      },
      workbox: {
        // A first visit is controlled right away, so the reload button can swap versions in it too.
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,pes}'],
        // Only crawlers and link previews fetch the social image.
        globIgnores: ['og-image.png'],
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
