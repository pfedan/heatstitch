import { describe, expect, it } from 'vitest';
import { BRIDGE_URL, BridgeError, bridgeHealth, bridgeMachines, bridgePair, bridgeSend } from '../src/send/emberBridge';
import { stickFileName, stickFolder, writeToStick, type StickHandle } from '../src/send/stick';

/** A folder of a stick in memory, as far as the File System Access API is used. */
class Dir {
  files = new Map<string, Uint8Array<ArrayBufferLike>>();
  dirs = new Map<string, Dir>();
  readonly kind = 'directory' as const;
  constructor(readonly name: string, private permission: PermissionState = 'granted') {}
  async getDirectoryHandle(name: string): Promise<Dir> {
    const d = this.dirs.get(name);
    if (!d) throw new DOMException('missing', 'NotFoundError');
    return d;
  }
  async getFileHandle(name: string, o: { create?: boolean } = {}) {
    if (!this.files.has(name) && !o.create) throw new DOMException('missing', 'NotFoundError');
    return {
      createWritable: async () => {
        let data: Uint8Array<ArrayBufferLike> = new Uint8Array();
        return { write: async (d: BlobPart) => void (data = d as Uint8Array), close: async () => void this.files.set(name, data) };
      },
    };
  }
  async queryPermission() {
    return this.permission;
  }
  async requestPermission() {
    return this.permission;
  }
}
const asHandle = (d: Dir) => d as unknown as StickHandle;

describe('USB stick', () => {
  it('gives names every machine reads', () => {
    expect(stickFileName('Rose', 'pes')).toBe('Rose.PES');
    expect(stickFileName('Grüße für Jörg', 'jef')).toBe('Gruesse_fuer_Joerg.JEF');
    expect(stickFileName('Café (groß) v2.1', 'dst')).toBe('Cafe_gross_v2_1.DST');
    expect(stickFileName('  ***  ', 'vp3')).toBe('design.VP3');
    expect(stickFileName('x'.repeat(80), 'exp')).toBe(`${'x'.repeat(32)}.EXP`);
  });

  it('writes a JEF into EMB/Embf where a Janome machine made it, else into the root', async () => {
    const janome = new Dir('JANOME');
    const emb = new Dir('EMB');
    emb.dirs.set('Embf', new Dir('Embf'));
    janome.dirs.set('EMB', emb);
    expect((await stickFolder(asHandle(janome), 'jef')).path).toEqual(['EMB', 'Embf']);
    expect((await stickFolder(asHandle(janome), 'pes')).path).toEqual([]);
    expect((await stickFolder(asHandle(new Dir('STICK')), 'jef')).path).toEqual([]);
  });

  it('writes the bytes and says when it replaced a file', async () => {
    const stick = new Dir('STICK');
    const first = await writeToStick(asHandle(stick), 'pes', 'Rose', new Uint8Array([1, 2]));
    expect(first).toEqual({ name: 'Rose.PES', path: [], replaced: false });
    expect([...stick.files.get('Rose.PES')!]).toEqual([1, 2]);
    const again = await writeToStick(asHandle(stick), 'pes', 'Rose', new Uint8Array([3]));
    expect(again.replaced).toBe(true);
    expect([...stick.files.get('Rose.PES')!]).toEqual([3]);
  });

  it('writes nothing without permission', async () => {
    const stick = new Dir('STICK', 'denied');
    await expect(writeToStick(asHandle(stick), 'pes', 'Rose', new Uint8Array([1]))).rejects.toMatchObject({ code: 'denied' });
    expect(stick.files.size).toBe(0);
  });
});

/** A pretend Ember Bridge: answers by path, records what was asked. */
function bridge(routes: Record<string, (init: RequestInit) => { status?: number; body: unknown } | 'refuse'>) {
  const calls: { path: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const path = url.slice(BRIDGE_URL.length);
    calls.push({ path, init });
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    if (!key) throw new TypeError('Failed to fetch');
    const r = routes[key](init);
    if (r === 'refuse') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { f, calls };
}

describe('Ember Bridge', () => {
  it('is found only when it runs', async () => {
    expect(await bridgeHealth(bridge({ '/api/health': () => ({ body: { app: 'ember-bridge', version: '0.5.4', apiVersion: 1 } }) }).f)).toEqual({ version: '0.5.4' });
    expect(await bridgeHealth(bridge({}).f)).toBeNull();
    expect(await bridgeHealth(bridge({ '/api/health': () => ({ body: { app: 'something else' } }) }).f)).toBeNull();
  });

  it('reads a refused pairing as our address missing from its list', async () => {
    const { f } = bridge({ '/api/pair': () => 'refuse' });
    await expect(bridgePair(f, () => {})).rejects.toMatchObject({ code: 'origin_not_allowed' });
  });

  it('pairs once the user approves', async () => {
    let polls = 0;
    let waiting = false;
    const { f } = bridge({
      '/api/pair/': () => ({ body: ++polls < 2 ? { state: 'pending' } : { state: 'approved', token: 'tok' } }),
      '/api/pair': () => ({ status: 202, body: { request: { id: 'r1' } } }),
    });
    expect(await bridgePair(f, () => (waiting = true))).toBe('tok');
    expect(waiting).toBe(true);
  }, 10000);

  it('reports a denied pairing', async () => {
    const { f } = bridge({
      '/api/pair/': () => ({ body: { state: 'denied' } }),
      '/api/pair': () => ({ status: 202, body: { request: { id: 'r1' } } }),
    });
    await expect(bridgePair(f, () => {})).rejects.toMatchObject({ code: 'pairing_denied' });
  }, 10000);

  it('lists saved and found machines once each, the nickname first', async () => {
    const { f, calls } = bridge({
      '/api/machines': () => ({
        body: {
          saved: [{ ip: '192.168.1.20', nickname: 'Nähzimmer' }],
          discovered: [
            { info: { identity: { ip: '192.168.1.20', name: 'NQ1700E', model: 'NQ1700E', manufacturer: 'Brother' } } },
            { info: { identity: { ip: '192.168.1.31', model: 'Altair 2', manufacturer: 'Baby Lock' } } },
          ],
        },
      }),
    });
    expect(await bridgeMachines(f, 'tok')).toEqual([
      { ip: '192.168.1.20', label: 'Nähzimmer', model: 'Brother NQ1700E' },
      { ip: '192.168.1.31', label: 'Altair 2', model: 'Baby Lock Altair 2' },
    ]);
    expect(new Headers(calls[0].init.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('sends the bytes and follows the job to the end', async () => {
    let n = 0;
    const progress: number[] = [];
    const { f, calls } = bridge({
      '/api/send': () => ({ status: 202, body: { job: { id: 'j1', state: 'queued', sentBytes: 0, totalBytes: 0 } } }),
      '/api/jobs/j1': () => ({
        body: { job: ++n < 2 ? { id: 'j1', state: 'uploading', sentBytes: 50, totalBytes: 100 } : { id: 'j1', state: 'done', sentBytes: 100, totalBytes: 100, storedAs: 'ROSE.PES' } },
      }),
    });
    const job = await bridgeSend(f, 'tok', '192.168.1.20', 'Rose.PES', new Uint8Array([1, 2, 3]), (p) => progress.push(p));
    expect(job.storedAs).toBe('ROSE.PES');
    expect(progress).toContain(0.5);
    expect(calls[0].path).toBe('/api/send?ip=192.168.1.20&filename=Rose.PES');
    expect([...(calls[0].init.body as Uint8Array)]).toEqual([1, 2, 3]);
  }, 10000);

  it('passes on why a send failed', async () => {
    const { f } = bridge({
      '/api/send': () => ({ status: 202, body: { job: { id: 'j1', state: 'failed', sentBytes: 0, totalBytes: 0, errorCode: 'insufficient_storage', error: 'full' } } }),
    });
    const err = await bridgeSend(f, 'tok', '192.168.1.20', 'Rose.PES', new Uint8Array([1]), () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(BridgeError);
    expect(err.code).toBe('insufficient_storage');
  });

  it('turns an error answer into its code', async () => {
    const { f } = bridge({ '/api/machines': () => ({ status: 401, body: { error: { code: 'unauthorized', message: 'bad token' } } }) });
    await expect(bridgeMachines(f, 'old')).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
