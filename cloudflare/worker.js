/**
 * heatstitch.app on Cloudflare: the built site (dist/) is served as static assets, each file at
 * exactly its path, as GitHub Pages did (wrangler.jsonc, html_handling "none"). This only runs for a
 * request no file matches: a folder gets its index.html ("/", "/de/"), a folder without the slash
 * goes to it with one, and anything else is a small page that leads back to the app.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (url.pathname.endsWith('/')) {
        const res = await env.ASSETS.fetch(new URL(`${url.pathname}index.html`, url), request);
        if (res.ok) return res;
      } else if (!/\.[^/]*$/.test(url.pathname)) {
        const res = await env.ASSETS.fetch(new URL(`${url.pathname}/index.html`, url), { method: 'HEAD' });
        if (res.ok) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
      }
    }
    const de = url.pathname.startsWith('/de/');
    const text = de ? 'Diese Seite gibt es nicht.' : 'This page does not exist.';
    const link = de ? 'Zu heatstitch' : 'To heatstitch';
    return new Response(
      `<!doctype html><html lang="${de ? 'de' : 'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
        `<title>heatstitch</title><p>${text} <a href="${de ? '/de/' : '/'}">${link}</a></p>`,
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  },
};
