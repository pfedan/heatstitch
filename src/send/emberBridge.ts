/**
 * Sending to a Brother or Baby Lock machine over WLAN through Ember Bridge
 * (https://github.com/EmberSoftwareInc/ember-bridge, MIT), a free desktop app.
 *
 * Why a helper app: these machines speak HTTPS with a self-signed certificate and an old TLS key
 * exchange that no browser accepts, so a web page can never reach them itself. Bridge listens on
 * 127.0.0.1 only and passes the file on in the local network; nothing leaves the user's home.
 *
 * Its browser API: /api/health answers anyone; everything else needs a token, which a page gets once
 * by pairing (the user clicks "Approve" in Bridge). Bridge refuses to pair with a page whose address
 * the user has not added to its allowed web origins; the browser then sees only a failed request.
 */

export const BRIDGE_URL = 'http://127.0.0.1:17831';
export const BRIDGE_DOWNLOAD = 'https://github.com/EmberSoftwareInc/ember-bridge/releases/latest';
/** Opens Bridge on its settings page, where the allowed web origins are. */
export const BRIDGE_SETTINGS = 'ember-bridge://connect';
/** Formats Bridge sends (PES and DST of ours; PHC and PHX are Brother's own). */
export const BRIDGE_FORMATS = ['pes', 'dst'] as const;

/** Stable reasons, so the panel can say what to do. */
export type BridgeCode =
  | 'not_running'
  | 'origin_not_allowed'
  | 'pairing_denied'
  | 'pairing_expired'
  | 'unauthorized'
  | 'device_busy'
  | 'machine_unreachable'
  | 'machine_timeout'
  | 'insufficient_storage'
  | 'file_too_large'
  | 'unsupported_format'
  | 'delivery_unknown'
  | (string & {});

export class BridgeError extends Error {
  constructor(readonly code: BridgeCode, message = code) {
    super(message);
  }
}

export interface BridgeMachine {
  ip: string;
  /** The user's nickname, else the machine's name or model. */
  label: string;
  /** Model and manufacturer, when known. */
  model: string;
}

export interface BridgeJob {
  id: string;
  state: 'queued' | 'waiting' | 'uploading' | 'done' | 'failed' | 'cancelled' | 'needs_reconciliation';
  sentBytes: number;
  totalBytes: number;
  storedAs?: string | null;
  errorCode?: string | null;
  error?: string | null;
}

type Fetch = typeof fetch;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A request to Bridge; a failed connection becomes `not_running`, an error answer its own code. */
async function call<T>(f: Fetch, path: string, init: RequestInit = {}, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await f(BRIDGE_URL + path, {
      ...init,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
    });
  } catch {
    throw new BridgeError('not_running');
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!res.ok) throw new BridgeError(json.error?.code ?? (res.status === 401 ? 'unauthorized' : 'unknown'), json.error?.message ?? res.statusText);
  return json as T;
}

/** Whether Bridge runs on this computer; its version when it does. */
export async function bridgeHealth(f: Fetch = fetch): Promise<{ version: string } | null> {
  try {
    const h = await call<{ app?: string; version?: string }>(f, '/api/health');
    return h.app === 'ember-bridge' ? { version: h.version ?? '' } : null;
  } catch {
    return null;
  }
}

/**
 * Asks Bridge for a token. `onWaiting` runs once the request shows in Bridge, waiting for the
 * user's click. A refused request means our address is not on Bridge's list: Bridge answers it
 * without the header the browser needs, so all the page sees is a failed connection.
 */
export async function bridgePair(f: Fetch, onWaiting: () => void, appName = 'heatstitch'): Promise<string> {
  let id: string;
  try {
    const r = await call<{ request?: { id: string }; id?: string }>(f, '/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName }),
    });
    id = r.request?.id ?? r.id!;
  } catch (err) {
    // Bridge answered health a moment ago, so a failed connection here is the origin check.
    if (err instanceof BridgeError && err.code === 'not_running') throw new BridgeError('origin_not_allowed');
    throw err;
  }
  onWaiting();
  // Bridge keeps a request for a few minutes.
  for (let i = 0; i < 300; i++) {
    await wait(1000);
    let poll: { state?: string; token?: string };
    try {
      poll = await call(f, `/api/pair/${encodeURIComponent(id)}`);
    } catch (err) {
      if (err instanceof BridgeError && err.code.includes('not_found')) throw new BridgeError('pairing_expired');
      throw err;
    }
    if (poll.state === 'approved' && poll.token) return poll.token;
    if (poll.state === 'denied') throw new BridgeError('pairing_denied');
    if (poll.state === 'expired') throw new BridgeError('pairing_expired');
  }
  throw new BridgeError('pairing_expired');
}

interface Identity {
  ip?: string;
  name?: string | null;
  model?: string | null;
  manufacturer?: string | null;
}

/** The machines Bridge knows: the ones the user saved and the ones its last search found. */
export async function bridgeMachines(f: Fetch, token: string): Promise<BridgeMachine[]> {
  const r = await call<{ saved?: (Identity & { nickname?: string | null })[]; discovered?: { info?: { identity?: Identity } }[] }>(f, '/api/machines', {}, token);
  const byIp = new Map<string, BridgeMachine>();
  const model = (i: Identity) => [i.manufacturer, i.model].filter(Boolean).join(' ');
  for (const d of r.discovered ?? []) {
    const i = d.info?.identity;
    if (!i?.ip) continue;
    byIp.set(i.ip, { ip: i.ip, label: i.name || i.model || i.ip, model: model(i) });
  }
  for (const s of r.saved ?? []) {
    if (!s.ip) continue;
    const found = byIp.get(s.ip);
    byIp.set(s.ip, { ip: s.ip, label: s.nickname || found?.label || s.name || s.model || s.ip, model: found?.model || model(s) });
  }
  return [...byIp.values()];
}

/** Searches the local network for machines (takes a few seconds), then lists them. */
export async function bridgeDiscover(f: Fetch, token: string): Promise<BridgeMachine[]> {
  await call(f, '/api/discover', { method: 'POST' }, token);
  return bridgeMachines(f, token);
}

/** Sends the file and follows it until the machine has it. `onProgress` gets 0 to 1. */
export async function bridgeSend(f: Fetch, token: string, ip: string, fileName: string, data: Uint8Array, onProgress: (p: number) => void): Promise<BridgeJob> {
  const q = new URLSearchParams({ ip, filename: fileName });
  let { job } = await call<{ job: BridgeJob }>(f, `/api/send?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data as BodyInit }, token);
  for (;;) {
    if (job.state === 'done') return job;
    if (job.state === 'failed' || job.state === 'cancelled') throw new BridgeError(job.errorCode ?? 'unknown', job.error ?? '');
    if (job.state === 'needs_reconciliation') throw new BridgeError('delivery_unknown', job.error ?? '');
    if (job.totalBytes > 0) onProgress(job.sentBytes / job.totalBytes);
    await wait(400);
    ({ job } = await call<{ job: BridgeJob }>(f, `/api/jobs/${encodeURIComponent(job.id)}`, {}, token));
  }
}
