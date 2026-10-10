// The old address's service worker, replaced after the move to heatstitch.app (tools/moved/build.mjs).
// An installed or offline copy of the app would otherwise keep showing the old version forever. This
// one takes over at once, drops the app's caches, removes itself and reloads the open tabs, which then
// get the moving page from the network. The origin is shared with other pfedan.github.io sites, so
// only heatstitch's caches go.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.includes('/heatstitch/') || name === 'examples' || name === 'fonts') await caches.delete(name);
      }
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
    })(),
  );
});
