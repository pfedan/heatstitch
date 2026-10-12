import { onLangChange, t, type Key } from '../../i18n';
import { h, icon } from '../../shell/h';
import { STORAGE_NS } from '../../storage/namespace';
import type { OutputFormat } from '../../writers';
import {
  BRIDGE_DOWNLOAD,
  BRIDGE_FORMATS,
  BRIDGE_SETTINGS,
  BridgeError,
  bridgeDiscover,
  bridgeHealth,
  bridgeMachines,
  bridgePair,
  bridgeSend,
  type BridgeMachine,
} from '../../send/emberBridge';
import { shareFile, shareSupported } from '../../send/share';
import { pickStick, rememberedStick, stickFileName, stickSupported, StickError, writeToStick, type StickHandle } from '../../send/stick';

/** The design as it would be saved now: the format and name chosen in the popover, and its bytes. */
export interface DesignFile {
  format: OutputFormat;
  name: string;
  data: () => Uint8Array;
}

const TOKEN_KEY = `${STORAGE_NS}.emberToken`;
const MACHINE_KEY = `${STORAGE_NS}.sendMachine`;
const load = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const store = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // Not remembered; asked again next time.
  }
};

/** What the WLAN part shows; one state at a time, drawn by `wlanView`. */
type Wlan =
  | { s: 'closed' }
  | { s: 'checking' }
  | { s: 'missing' }
  | { s: 'origin' }
  | { s: 'pairing' }
  | { s: 'refused'; key: Key }
  | { s: 'searching' }
  | { s: 'machines'; list: BridgeMachine[]; note?: { kind: 'ok' | 'warn'; text: string } }
  | { s: 'sending'; list: BridgeMachine[]; pct: number };

const ERRORS: Record<string, Key> = {
  device_busy: 'files.send.wlan.err.busy',
  machine_unreachable: 'files.send.wlan.err.unreachable',
  machine_timeout: 'files.send.wlan.err.unreachable',
  insufficient_storage: 'files.send.wlan.err.storage',
  file_too_large: 'files.send.wlan.err.size',
  unsupported_format: 'files.send.wlan.err.format',
  delivery_unknown: 'files.send.wlan.err.unknown',
  interrupted: 'files.send.wlan.err.unknown',
};

/**
 * "An die Maschine" in the save popover: write onto a USB stick (or a machine on the cable that
 * shows up as a drive), send over WLAN through Ember Bridge (Brother, Baby Lock), or share to an
 * app. Each way shows only where the browser and the chosen format allow it; where none does, a
 * line says how to get the file onto the stick by hand.
 */
export function initSendToMachine(root: HTMLElement, design: () => DesignFile | null): { refresh(): void } {
  const rows = h('div', { class: 'send-rows' });
  const stickStatus = h('p', { class: 'send-status', role: 'status', hidden: true });
  const wlanBox = h('div', { class: 'send-wlan', hidden: true });
  root.replaceChildren(h('h3', { class: 'send-title' }, t('files.send.title')), rows, wlanBox);
  const title = root.firstElementChild as HTMLElement;

  let stick: StickHandle | null = null;
  void rememberedStick().then((s) => {
    stick = s;
    draw();
  });
  let wlan: Wlan = { s: 'closed' };
  let selected = load(MACHINE_KEY);

  // USB stick ----------------------------------------------------------------------------------

  const say = (text: string, kind: 'ok' | 'warn' = 'ok') => {
    stickStatus.hidden = false;
    stickStatus.dataset.kind = kind;
    stickStatus.replaceChildren(icon(kind === 'ok' ? 'files-check' : 'files-alert'), h('span', null, text));
  };

  async function toStick(pickNew: boolean): Promise<void> {
    const d = design();
    if (!d) return;
    if (wlan.s !== 'sending') wlan = { s: 'closed' };
    try {
      if (pickNew || !stick) stick = await pickStick();
      const w = await writeToStick(stick, d.format, d.name, d.data());
      const where = w.path.length ? t('files.send.stick.where', { path: w.path.join('/') }) : '';
      say(t(w.replaced ? 'files.send.stick.replaced' : 'files.send.stick.done', { file: w.name, stick: stick.name, where }));
    } catch (err) {
      if (err instanceof StickError && err.code === 'cancelled') return;
      console.warn('Writing to the stick failed', err);
      say(t(err instanceof StickError ? 'files.send.stick.denied' : 'files.send.stick.failed'), 'warn');
    }
    draw();
  }

  // WLAN through Ember Bridge -------------------------------------------------------------------

  const setWlan = (w: Wlan) => {
    wlan = w;
    draw();
  };

  /** Finds Bridge, pairs once, then lists the machines. Every step that waits on the user says what to do. */
  async function connect(): Promise<void> {
    setWlan({ s: 'checking' });
    if (!(await bridgeHealth())) return setWlan({ s: 'missing' });
    let token = load(TOKEN_KEY);
    try {
      try {
        if (token) return setWlan({ s: 'machines', list: await bridgeMachines(fetch, token) });
      } catch (err) {
        // A token renewed in Bridge since: pair anew.
        if (!(err instanceof BridgeError && err.code === 'unauthorized')) throw err;
        store(TOKEN_KEY, null);
      }
      token = await bridgePair(fetch, () => setWlan({ s: 'pairing' }));
      store(TOKEN_KEY, token);
      setWlan({ s: 'machines', list: await bridgeMachines(fetch, token) });
    } catch (err) {
      fail(err);
    }
  }

  function fail(err: unknown): void {
    const code = err instanceof BridgeError ? err.code : 'unknown';
    if (code === 'unauthorized') {
      // The token was renewed in Bridge while the panel was open: pair again.
      store(TOKEN_KEY, null);
      return void connect();
    }
    if (code === 'not_running') return setWlan({ s: 'missing' });
    if (code === 'origin_not_allowed') return setWlan({ s: 'origin' });
    if (code === 'pairing_denied') return setWlan({ s: 'refused', key: 'files.send.wlan.denied' });
    if (code === 'pairing_expired') return setWlan({ s: 'refused', key: 'files.send.wlan.expired' });
    const list = 'list' in wlan ? wlan.list : [];
    const text = ERRORS[code] ? t(ERRORS[code]) : t('files.send.wlan.err.other', { msg: err instanceof Error ? err.message : String(err) });
    setWlan({ s: 'machines', list, note: { kind: 'warn', text } });
  }

  async function search(): Promise<void> {
    const token = load(TOKEN_KEY);
    if (!token) return connect();
    setWlan({ s: 'searching' });
    try {
      setWlan({ s: 'machines', list: await bridgeDiscover(fetch, token) });
    } catch (err) {
      fail(err);
    }
  }

  async function send(m: BridgeMachine, list: BridgeMachine[]): Promise<void> {
    const d = design();
    const token = load(TOKEN_KEY);
    if (!d || !token) return;
    setWlan({ s: 'sending', list, pct: 0 });
    try {
      const job = await bridgeSend(fetch, token, m.ip, stickFileName(d.name, d.format), d.data(), (p) => setWlan({ s: 'sending', list, pct: Math.round(p * 100) }));
      setWlan({ s: 'machines', list, note: { kind: 'ok', text: t('files.send.wlan.done', { file: job.storedAs || stickFileName(d.name, d.format), machine: m.label }) } });
    } catch (err) {
      fail(err);
    }
  }

  const button = (key: Key, onclick: () => void, cls = 'send-btn') => h('button', { type: 'button', class: cls, onclick }, t(key));
  const link = (key: Key, href: string) => h('a', { class: 'send-btn', href, target: href.startsWith('http') ? '_blank' : null, rel: 'noopener' }, t(key));
  const line = (text: string, kind?: 'ok' | 'warn' | 'busy') =>
    h('p', { class: 'send-status', 'data-kind': kind ?? null, role: 'status' }, kind && kind !== 'busy' ? icon(kind === 'ok' ? 'files-check' : 'files-alert') : null, h('span', null, text));

  function wlanView(): Node[] {
    switch (wlan.s) {
      case 'closed':
        return [];
      case 'checking':
        return [line(t('files.send.wlan.checking'), 'busy')];
      case 'missing':
        return [line(t('files.send.wlan.missing')), h('div', { class: 'send-actions' }, link('files.send.wlan.download', BRIDGE_DOWNLOAD), button('files.send.wlan.retry', () => void connect(), 'link'))];
      case 'origin':
        return [
          line(t('files.send.wlan.origin', { origin: location.origin })),
          h(
            'div',
            { class: 'send-actions' },
            link('files.send.wlan.open', BRIDGE_SETTINGS),
            button('files.send.wlan.copy', () => void navigator.clipboard?.writeText(location.origin), 'link'),
            button('files.send.wlan.retry', () => void connect(), 'link'),
          ),
        ];
      case 'pairing':
        return [line(t('files.send.wlan.pairing'), 'busy')];
      case 'refused':
        return [line(t(wlan.key), 'warn'), h('div', { class: 'send-actions' }, button('files.send.wlan.retry', () => void connect(), 'link'))];
      case 'searching':
        return [line(t('files.send.wlan.searching'), 'busy')];
      case 'machines':
      case 'sending': {
        const { list } = wlan;
        const sending = wlan.s === 'sending';
        if (!list.length) return [line(t('files.send.wlan.none')), h('div', { class: 'send-actions' }, button('files.send.wlan.search', () => void search()))];
        const target = list.find((m) => m.ip === selected) ?? list[0];
        const opts = list.map((m) =>
          h(
            'label',
            { class: 'send-target' },
            h('input', {
              type: 'radio',
              name: 'send-target',
              value: m.ip,
              checked: m === target,
              disabled: sending,
              onchange: () => {
                selected = m.ip;
                store(MACHINE_KEY, m.ip);
                draw();
              },
            }),
            h('b', null, m.label),
            h('small', null, [m.model, m.ip].filter(Boolean).join(' · ')),
          ),
        );
        const go = h('button', { type: 'button', class: 'send-btn send-go', disabled: sending, onclick: () => void send(target, list) }, t('files.send.wlan.send', { machine: target.label }));
        return [
          h('div', { class: 'send-targets', role: 'radiogroup', 'aria-label': t('files.send.wlan') }, opts),
          h('div', { class: 'send-actions' }, go, h('button', { type: 'button', class: 'link', disabled: sending, onclick: () => void search() }, t('files.send.wlan.search'))),
          ...(wlan.s === 'sending'
            ? [h('div', { class: 'send-progress' }, h('progress', { max: 100, value: wlan.pct }), h('span', null, t('files.send.wlan.sending', { pct: wlan.pct })))]
            : wlan.note
              ? [line(wlan.note.text, wlan.note.kind)]
              : []),
        ];
      }
    }
  }

  // Rows ---------------------------------------------------------------------------------------

  const row = (ic: string, label: string, sub: string, hint: Key, onclick: () => void, extra: Record<string, unknown> = {}) =>
    h('button', { type: 'button', class: 'pop-row save-row', title: t(hint), onclick, ...extra }, icon(ic), h('span', null, h('span', null, label), h('small', null, sub)));

  function draw(): void {
    title.textContent = t('files.send.title');
    const d = design();
    const format = d?.format ?? 'pes';
    const out: Node[] = [];
    if (stickSupported()) {
      const main = row('files-usb', t('files.send.stick'), stick ? t('files.send.stick.on', { name: stick.name }) : t('files.send.stick.pick'), 'files.send.stick.hint', () => void toStick(false));
      out.push(
        stick
          ? h(
              'div',
              { class: 'save-split' },
              main,
              h('button', { type: 'button', class: 'save-split-toggle', title: t('files.send.stick.other'), 'aria-label': t('files.send.stick.other'), onclick: () => void toStick(true) }, icon('files-open')),
            )
          : main,
        // The news of the last write, right under it.
        stickStatus,
      );
    }
    const wlanOk = (BRIDGE_FORMATS as readonly string[]).includes(format);
    if (wlanOk) {
      out.push(
        row('files-wifi', t('files.send.wlan'), t('files.send.wlan.sub'), 'files.send.wlan.hint', () => {
          // One piece of news at a time.
          stickStatus.hidden = true;
          if (wlan.s === 'closed') void connect();
          else setWlan({ s: 'closed' });
        }, {
          'aria-expanded': String(wlan.s !== 'closed'),
        }),
      );
    }
    if (shareSupported(format)) {
      out.push(
        row('files-share', t('files.send.share'), t('files.send.share.sub'), 'files.send.share.hint', () => {
          const f = design();
          if (f) void shareFile(stickFileName(f.name, f.format), f.data()).catch((err) => console.warn('Sharing failed', err));
        }),
      );
    }
    rows.replaceChildren(...out);
    // Without a direct way to the stick: how to do it by hand.
    if (!stickSupported()) rows.append(h('p', { class: 'send-hint' }, t(format === 'jef' ? 'files.send.stick.copy.jef' : 'files.send.stick.copy')));
    wlanBox.hidden = !wlanOk || wlan.s === 'closed';
    wlanBox.replaceChildren(...(wlanOk ? wlanView() : []));
  }

  onLangChange(draw);
  draw();
  return {
    refresh: () => {
      // A new look at the popover starts without old news.
      stickStatus.hidden = true;
      if (wlan.s === 'machines') wlan = { ...wlan, note: undefined };
      draw();
    },
  };
}
