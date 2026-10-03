import { registerSW } from 'virtual:pwa-register';

/** How often an open tab asks the server for a new service worker. */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Registers the service worker and shows a small notice once a new version is waiting.
 * The new version only takes over when the user clicks reload, so an open tab is never
 * reloaded underneath them. Loaded files and their working copies live in IndexedDB and
 * come back after the reload.
 */
export function initUpdateNotice(el: HTMLElement): void {
  const reload = el.querySelector<HTMLButtonElement>('[data-update="reload"]')!;
  const dismiss = el.querySelector<HTMLButtonElement>('[data-update="dismiss"]')!;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => (el.hidden = false),
    onRegisteredSW: (url, reg) => {
      if (!reg) return;
      const check = async () => {
        // Skip while offline or while an update is already installing.
        if (!navigator.onLine || reg.installing) return;
        try {
          // Probe first: a failed fetch inside update() would log an uncaught error.
          const res = await fetch(url, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
          if (res.ok) await reg.update();
        } catch {
          // Offline or the server is unreachable; the next check tries again.
        }
      };
      window.setInterval(check, CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void check();
      });
    },
  });

  reload.addEventListener('click', () => {
    reload.disabled = true;
    // The plugin only reloads tabs that had a controller when they opened, so a first visit
    // would stay on the old version; reloading on the switch covers every tab.
    navigator.serviceWorker?.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    void updateSW(true);
  });
  dismiss.addEventListener('click', () => (el.hidden = true));
}
