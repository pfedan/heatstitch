import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS, run by Cloudflare
import worker from '../cloudflare/worker.js';

/** The Worker behind heatstitch.app only sees requests no built file matched (wrangler.jsonc). */
const files = new Set(['/index.html', '/de/index.html', '/docs.html']);
const env = {
  ASSETS: {
    fetch: async (input: URL | string) => {
      const path = new URL(String(input)).pathname;
      return new Response(files.has(path) ? path : null, { status: files.has(path) ? 200 : 404 });
    },
  },
};
const get = (path: string) => worker.fetch(new Request(`https://heatstitch.app${path}`), env) as Promise<Response>;

describe('heatstitch.app routing', () => {
  it('serves a folder its index.html', async () => {
    expect(await (await get('/')).text()).toBe('/index.html');
    expect(await (await get('/de/')).text()).toBe('/de/index.html');
  });

  it('adds the slash to a folder, keeping the query', async () => {
    const res = await get('/de?x=1');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://heatstitch.app/de/?x=1');
  });

  it('answers anything else with a page back to the app, in its language', async () => {
    const en = await get('/nope.pes');
    expect(en.status).toBe(404);
    expect(await en.text()).toContain('href="/"');
    const de = await get('/de/nope');
    expect(de.status).toBe(404);
    expect(await de.text()).toContain('href="/de/"');
  });
});
