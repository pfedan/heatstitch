/**
 * A button that opens a panel lying over the page (no modal): a click beside it, Esc or the
 * button again closes it. Focus moves into the panel and back to the button on close.
 */
export function popover(button: HTMLElement, panel: HTMLElement, opts: { onOpen?: () => void } = {}): { open: () => void; close: () => void; isOpen: () => boolean } {
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  panel.hidden = true;

  const isOpen = () => !panel.hidden;
  const open = () => {
    if (isOpen()) return;
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    opts.onOpen?.();
    panel.querySelector<HTMLElement>('[autofocus], input:not([hidden]), select, button')?.focus({ preventScroll: true });
  };
  const close = (refocus = false) => {
    if (!isOpen()) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (refocus) button.focus({ preventScroll: true });
  };

  button.addEventListener('click', () => (isOpen() ? close() : open()));
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (isOpen() && !panel.contains(t) && !button.contains(t)) close();
  });
  window.addEventListener(
    'keydown',
    (e) => {
      if (isOpen() && e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        close(true);
      }
    },
    { capture: true },
  );
  return { open, close: () => close(), isOpen };
}
