import { onLangChange, t, type Key } from '../../i18n';
import { h, icon } from '../../shell/h';
import type { OutputFormat } from '../../writers';
import { STORAGE_NS } from '../../storage/namespace';
import {
  BRIDGE_ALLOW_GUIDE,
  BRIDGE_FORMATS,
  BRIDGE_GUIDE,
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

/** Ember Bridge runs on Windows, macOS and Linux only: no Wi-Fi entry on a phone or tablet. */
function onComputer(): boolean {
  const n = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (n.userAgentData?.mobile) return false;
  // An iPad says it is a Mac; it has touch points, a Mac has none.
  return !/Android|iPhone|iPad/i.test(n.userAgent) && !(/Macintosh/.test(n.userAgent) && n.maxTouchPoints > 1);
}

/** What the Wi-Fi part shows; one state at a time, drawn by `wlanView`. */
type Wlan =
  | { s: 'closed' }
  | { s: 'checking' }
  | { s: 'missing' }
  | { s: 'allow'; copied: boolean }
  | { s: 'pairing' }
  | { s: 'refused'; key: Key }
  | { s: 'searching' }
  | { s: 'machines'; list: BridgeMachine[]; note?: { kind: 'ok' | 'warn'; text: string } }
  | { s: 'sending'; list: BridgeMachine[]; pct: number };

/** What to tell the user when the machine or Bridge said no; anything else gets a plain "try again". */
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
 * "An die Maschine" in the save popover, a section that opens on demand: write onto a USB stick (or
 * a machine on the cable that shows up as a drive), send over Wi-Fi through Ember Bridge (Brother,
 * Babylock), or share to an app. Each way shows only where the browser and the chosen format allow
 * it; where the stick cannot be written, a line says how to get the file there by hand. The Wi-Fi
 * steps speak of the machine and the app, never of addresses, ports or tokens.
 */
export function initSendToMachine(body: HTMLElement, design: () => DesignFile | null): { refresh(): void; toStick(): void } {
  const rows = h('div', { class: 'send-rows' });
  const status = h('p', { class: 'send-status', role: 'status', hidden: true });
  const wlanBox = h('div', { class: 'send-wlan', hidden: true });
  body.replaceChildren(rows, wlanBox);
  let wlan: Wlan = { s: 'closed' };
  let selected = load(MACHINE_KEY);

  let stick: StickHandle | null = null;
  void rememberedStick().then((s) => {
    stick = s;
    draw();
  });

  const say = (text: string, kind: 'ok' | 'warn' = 'ok') => {
    status.hidden = false;
    status.dataset.kind = kind;
    status.replaceChildren(icon(kind === 'ok' ? 'files-check' : 'files-alert'), h('span', null, text));
  };

  async function toStick(pickNew: boolean): Promise<void> {
    const d = design();
    if (!d) return;
    if (wlan.s !== 'sending') wlan = { s: 'closed' };
    try {
      if (pickNew || !stick) stick = await pickStick();
      const w = await writeToStick(stick, d.format, d.name, d.data());
      const vars = { file: w.name, stick: stick.name, where: w.path.length ? t('files.send.stick.where', { path: w.path.join('/') }) : '', n: w.cleaned };
      say(t(w.cleaned === 0 ? 'files.send.stick.done' : w.cleaned === 1 ? 'files.send.stick.cleaned.one' : 'files.send.stick.cleaned', vars));
    } catch (err) {
      if (err instanceof StickError && err.code === 'cancelled') return;
      console.warn('Writing to the stick failed', err);
      say(t(err instanceof StickError ? 'files.send.stick.denied' : 'files.send.stick.failed'), 'warn');
    }
    draw();
  }

  // Wi-Fi through Ember Bridge -----------------------------------------------------------------

  const setWlan = (w: Wlan) => {
    wlan = w;
    draw();
  };

  /** Finds Bridge, asks once whether heatstitch may send, then lists the machines. */
  async function connect(): Promise<void> {
    setWlan({ s: 'checking' });
    if (!(await bridgeHealth())) return setWlan({ s: 'missing' });
    let token = load(TOKEN_KEY);
    try {
      try {
        if (token) return setWlan({ s: 'machines', list: await bridgeMachines(fetch, token) });
      } catch (err) {
        // Allowed once, but no longer (renewed in Bridge): ask again.
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
      store(TOKEN_KEY, null);
      return void connect();
    }
    if (code === 'not_running') return setWlan({ s: 'missing' });
    if (code === 'origin_not_allowed') return setWlan({ s: 'allow', copied: false });
    if (code === 'pairing_denied') return setWlan({ s: 'refused', key: 'files.send.wlan.denied' });
    if (code === 'pairing_expired') return setWlan({ s: 'refused', key: 'files.send.wlan.expired' });
    console.warn('Sending over Wi-Fi failed', err);
    const list = 'list' in wlan ? wlan.list : [];
    setWlan({ s: 'machines', list, note: { kind: 'warn', text: t(ERRORS[code] ?? 'files.send.wlan.err.other') } });
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
      await bridgeSend(fetch, token, m.ip, stickFileName(d.name, d.format), d.data(), (p) => setWlan({ s: 'sending', list, pct: Math.round(p * 100) }));
      setWlan({ s: 'machines', list, note: { kind: 'ok', text: t('files.send.wlan.done', { machine: m.label }) } });
    } catch (err) {
      fail(err);
    }
  }

  const button = (key: Key, onclick: () => void, cls = 'send-btn') => h('button', { type: 'button', class: cls, onclick }, t(key));
  const link = (key: Key, href: string) => h('a', { class: 'send-btn', href, target: href.startsWith('http') ? '_blank' : null, rel: 'noopener' }, t(key));
  const line = (text: string, kind?: 'ok' | 'warn' | 'busy') =>
    h('p', { class: 'send-status', 'data-kind': kind ?? null, role: 'status' }, kind && kind !== 'busy' ? icon(kind === 'ok' ? 'files-check' : 'files-alert') : null, h('span', null, text));
  const actions = (...items: Node[]) => h('div', { class: 'send-actions' }, ...items);

  function wlanView(): Node[] {
    switch (wlan.s) {
      case 'closed':
        return [];
      case 'checking':
        return [line(t('files.send.wlan.checking'), 'busy')];
      case 'missing':
        return [
          line(t('files.send.wlan.missing')),
          actions(link('files.send.wlan.guide', BRIDGE_GUIDE), button('files.send.wlan.retry', () => void connect(), 'link')),
          h('p', { class: 'send-hint' }, t('files.send.wlan.nosupport')),
        ];
      case 'allow': {
        // Bridge lets only pages it knows ask; the address goes to the clipboard, not on the screen.
        const copy = () =>
          void navigator.clipboard?.writeText(location.origin).then(
            () => setWlan({ s: 'allow', copied: true }),
            () => {},
          );
        return [
          line(t('files.send.wlan.allow')),
          actions(button(wlan.copied ? 'files.send.wlan.copied' : 'files.send.wlan.copy', copy), link('files.send.wlan.guide', BRIDGE_ALLOW_GUIDE), button('files.send.wlan.next', () => void connect(), 'link')),
          h('p', { class: 'send-hint' }, t('files.send.wlan.nosupport')),
        ];
      }
      case 'pairing':
        return [line(t('files.send.wlan.pairing'), 'busy')];
      case 'refused':
        return [line(t(wlan.key), 'warn'), actions(button('files.send.wlan.retry', () => void connect(), 'link'))];
      case 'searching':
        return [line(t('files.send.wlan.searching'), 'busy')];
      case 'machines':
      case 'sending': {
        const { list } = wlan;
        const sending = wlan.s === 'sending';
        if (!list.length) return [line(t('files.send.wlan.none')), actions(button('files.send.wlan.search', () => void search()))];
        const target = list.find((m) => m.ip === selected) ?? list[0];
        const opts = list.map((m) =>
          h(
            'label',
            { class: 'send-target' },
            h('input', {
              type: 'radio',
              name: 'send-target',
              checked: m === target,
              disabled: sending,
              onchange: () => {
                selected = m.ip;
                store(MACHINE_KEY, m.ip);
                draw();
              },
            }),
            h('b', null, m.label),
            m.model && m.model !== m.label ? h('small', null, m.model) : null,
          ),
        );
        const go = h('button', { type: 'button', class: 'send-btn send-go', disabled: sending, onclick: () => void send(target, list) }, t('files.send.wlan.send', { machine: target.label }));
        return [
          h('div', { class: 'send-targets', role: 'radiogroup', 'aria-label': t('files.send.wlan') }, opts),
          actions(go, h('button', { type: 'button', class: 'link', disabled: sending, onclick: () => void search() }, t('files.send.wlan.search.again'))),
          ...(wlan.s === 'sending'
            ? [h('div', { class: 'send-progress' }, h('progress', { max: 100, value: wlan.pct, 'aria-label': t('files.send.wlan.sending') }), h('span', null, t('files.send.wlan.sending')))]
            : wlan.note
              ? [line(wlan.note.text, wlan.note.kind)]
              : []),
        ];
      }
    }
  }

  const row = (ic: string, label: string, sub: string, hint: Key, onclick: () => void, extra: Record<string, unknown> = {}) =>
    h('button', { type: 'button', class: 'pop-row save-row', title: t(hint), onclick, ...extra }, icon(ic), h('span', null, h('span', null, label), h('small', null, sub)));

  function draw(): void {
    const format = design()?.format ?? 'pes';
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
        status,
      );
    } else {
      // Without a direct way to the stick: how to do it by hand.
      out.push(h('p', { class: 'send-hint' }, t(format === 'jef' ? 'files.send.stick.copy.jef' : 'files.send.stick.copy')));
    }
    const wlanOk = onComputer() && (BRIDGE_FORMATS as readonly string[]).includes(format);
    if (wlanOk) {
      out.push(
        row('files-wifi', t('files.send.wlan'), t('files.send.wlan.sub'), 'files.send.wlan.hint', () => {
          // One piece of news at a time.
          status.hidden = true;
          if (wlan.s === 'closed') void connect();
          else setWlan({ s: 'closed' });
        }, { 'aria-expanded': String(wlan.s !== 'closed') }),
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
    wlanBox.hidden = !wlanOk || wlan.s === 'closed';
    wlanBox.replaceChildren(...(wlanOk ? wlanView() : []));
  }

  onLangChange(draw);
  draw();
  return {
    refresh: () => {
      // A new look at the popover starts without old news.
      status.hidden = true;
      if (wlan.s === 'machines') wlan = { ...wlan, note: undefined };
      draw();
    },
    toStick: () => void toStick(false),
  };
}
