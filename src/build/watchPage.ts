/**
 * One page per tutorial video and language (videos/<key>.html, de/videos/<key>.html): the video is
 * the main content, right under its title, with what it shows, the files to follow along and the
 * parts before and after. Search engines only index a video on such a page ("watch page"); the
 * cards on the video page and beside the guide's sections open the player over the page, but they
 * link here, so the pages are found, and a link opened in a new tab lands here too.
 *
 * Each page carries schema.org VideoObject data and is listed with its video in sitemap.xml
 * (src/build/sitemap.ts). The pages are written from the built template video.html, which brings
 * the page's script and styles (src/videoWatch.ts); see vite.config.ts.
 */

import { cardPath, isoDuration, VIDEO_BASE, VIDEOS, watchPath, type Lang, type Video } from '../videos/catalog';
import { pagePath, SITE } from './langPages';

const T = {
  part: { de: 'Teil', en: 'Part' },
  all: { de: 'Alle Videos', en: 'All videos' },
  guide: { de: 'Anleitung', en: 'Guide' },
  app: { de: 'App öffnen', en: 'Open the app' },
  files: { de: 'Zum Mitmachen', en: 'To follow along' },
  filesLead: { de: 'Die Datei aus dem Video, damit du jeden Schritt selbst machen kannst:', en: 'The file from the video, so you can do every step yourself:' },
  prev: { de: 'Voriger Teil', en: 'Previous part' },
  next: { de: 'Nächster Teil', en: 'Next part' },
  parts: { de: 'Teile', en: 'Parts' },
  spoken: {
    de: 'Deutsch gesprochen, mit Untertiteln auf Deutsch und Englisch.',
    en: 'Spoken in German, with English and German subtitles.',
  },
  privacy: { de: 'Datenschutz', en: 'Privacy' },
  more: {
    de: ['Lieber lesen? ', 'Die Anleitung', ' erklärt alles Schritt für Schritt.'],
    en: ['Rather read? ', 'The guide', ' explains everything step by step.'],
  },
} as const;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The address of a page of the site, absolute from the site's root (so it is the same in de/). */
const local = (path: string): string => `/${path}`;

export const posterUrl = (v: Video): string => `${VIDEO_BASE}${v.key}.jpg`;
export const videoUrl = (v: Video): string => `${VIDEO_BASE}${v.key}.mp4`;
export const watchUrl = (v: Video, lang: Lang): string => SITE + watchPath(v.key, lang);

/** The page's title in search results and the browser tab. */
export function watchTitle(v: Video, lang: Lang): string {
  return lang === 'de' ? `${v.title.de}: Video zu heatstitch, Teil ${v.part}` : `${v.title.en}: heatstitch video, part ${v.part}`;
}

/** The description of the video, for the page's head, its VideoObject and the sitemap. */
export function watchDescription(v: Video, lang: Lang): string {
  return lang === 'de'
    ? `${v.goal.de} Ein kurzes Video zu heatstitch, der kostenlosen Sticksoftware im Browser.`
    : `${v.goal.en} A short video on heatstitch, the free embroidery software in your browser.`;
}

/** schema.org VideoObject: the properties Google requires (name, thumbnailUrl, uploadDate) and those it recommends. */
export function videoObject(v: Video, lang: Lang): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: v.title[lang],
    description: watchDescription(v, lang),
    thumbnailUrl: [posterUrl(v)],
    uploadDate: v.published,
    duration: isoDuration(v.length),
    contentUrl: videoUrl(v),
    url: watchUrl(v, lang),
    inLanguage: 'de',
    isPartOf: { '@type': 'WebSite', name: 'heatstitch', url: SITE },
  };
}

/** The head of a watch page, in place of the template's placeholder. */
export function watchHead(v: Video, lang: Lang, pad = '    '): string {
  const other: Lang = lang === 'de' ? 'en' : 'de';
  const url = watchUrl(v, lang);
  const title = esc(watchTitle(v, lang));
  const description = esc(watchDescription(v, lang));
  // "<" never appears unescaped inside the script, so a title can not end it.
  const json = JSON.stringify(videoObject(v, lang), null, 2).replace(/</g, '\\u003c');
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<link rel="alternate" hreflang="${lang}" href="${url}" />`,
    `<link rel="alternate" hreflang="${other}" href="${watchUrl(v, other)}" />`,
    `<link rel="alternate" hreflang="x-default" href="${watchUrl(v, 'en')}" />`,
    `<meta property="og:type" content="video.other" />`,
    `<meta property="og:site_name" content="heatstitch" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${esc(v.title[lang])}" />`,
    `<meta property="og:description" content="${esc(v.goal[lang])}" />`,
    `<meta property="og:image" content="${posterUrl(v)}" />`,
    `<meta property="og:video" content="${videoUrl(v)}" />`,
    `<meta property="og:video:type" content="video/mp4" />`,
    `<meta property="og:video:width" content="1920" />`,
    `<meta property="og:video:height" content="1080" />`,
    `<meta property="og:locale" content="${lang === 'de' ? 'de_DE' : 'en_US'}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:image" content="${posterUrl(v)}" />`,
    `<script type="application/ld+json">`,
    json,
    `</script>`,
  ]
    .join('\n')
    .split('\n')
    .map((l, i) => (i ? pad + l : l))
    .join('\n');
}

function step(v: Video | undefined, lang: Lang, which: 'prev' | 'next'): string[] {
  if (!v) return [];
  const label = T[which][lang];
  const img = `<img src="/${cardPath(v.key)}" data-poster="${posterUrl(v)}" width="64" height="48" loading="lazy" alt="" />`;
  const text = `<span class="video-step-text"><small>${label} · ${v.length}</small><span>${T.part[lang]} ${v.part}<span class="video-step-title"> · ${esc(v.title[lang])}</span></span></span>`;
  const arrow = `<span class="video-step-arrow" aria-hidden="true">${which === 'prev' ? '‹' : '›'}</span>`;
  const inner = which === 'prev' ? [arrow, img, text] : [text, img, arrow];
  return [`<a class="video-step${which === 'next' ? ' video-step-next' : ''}" href="${local(watchPath(v.key, lang))}" rel="${which}">`, ...inner.map((s) => `  ${s}`), `</a>`];
}

/** The body of a watch page, in place of the template's placeholder: the guide's header, then the video. */
export function watchBody(v: Video, lang: Lang, pad = '    '): string {
  const i = VIDEOS.indexOf(v);
  const title = esc(v.title[lang]);
  const lines = [
    `<header class="doc-top" id="top">`,
    `  <a class="doc-brand" href="${local(pagePath('app', lang))}">`,
    `    <img src="/favicon.svg" alt="" width="26" height="26" />`,
    `    <span>heatstitch</span>`,
    `  </a>`,
    `  <nav>`,
    `    <a class="doc-link" href="${local(pagePath('docs', lang))}">${T.guide[lang]}</a>`,
    `    <a class="doc-link" href="${local(pagePath('videos', lang))}">Videos</a>`,
    `    <a class="doc-open" href="${local(pagePath('app', lang))}">${T.app[lang]}</a>`,
    `    <select id="lang" aria-label="Language">`,
    `      <option value="de">Deutsch</option>`,
    `      <option value="en">English</option>`,
    `    </select>`,
    `  </nav>`,
    `</header>`,
    ``,
    `<main class="doc video-watch">`,
    `  <p class="lang-hint" id="lang-hint" hidden></p>`,
    `  <article lang="${lang}" data-key="${v.key}">`,
    `    <p class="video-watch-back"><a href="${local(pagePath('videos', lang))}#video-${v.key}">‹ ${T.all[lang]}</a></p>`,
    `    <h1><span class="video-part">${T.part[lang]} ${v.part}</span> ${title}</h1>`,
    `    <div class="video-watch-stage">`,
    `      <video id="video-watch" controls playsinline preload="metadata" width="1920" height="1080" poster="${posterUrl(v)}" src="${videoUrl(v)}" data-base="${VIDEO_BASE}" data-key="${v.key}" aria-label="${title}"></video>`,
    `    </div>`,
    `    <p class="lead">${esc(v.goal[lang])}</p>`,
    `    <p class="video-meta">${v.length} · ${T.spoken[lang]}</p>`,
  ];
  if (v.files.length) {
    lines.push(
      `    <section class="video-watch-files" aria-labelledby="files">`,
      `      <h2 id="files">${T.files[lang]}</h2>`,
      `      <p>${T.filesLead[lang]}</p>`,
      `      <ul>`,
      ...v.files.map((f) => `        <li><a href="${VIDEO_BASE}${v.key}-${esc(f)}" download="${esc(f)}">${esc(f)}</a></li>`),
      `      </ul>`,
      `    </section>`,
    );
  }
  const steps = [...step(VIDEOS[i - 1], lang, 'prev'), ...step(VIDEOS[i + 1], lang, 'next')];
  lines.push(
    `    <nav class="video-watch-steps" aria-label="${T.parts[lang]}">`,
    ...steps.map((s) => `      ${s}`),
    `    </nav>`,
    `    <p class="video-more">${T.more[lang][0]}<a href="${local(pagePath('docs', lang))}">${T.more[lang][1]}</a>${T.more[lang][2]}</p>`,
    `  </article>`,
    `</main>`,
    `<footer class="doc-foot">`,
    `  <a href="${local(pagePath('privacy', lang))}">${T.privacy[lang]}</a>`,
    `</footer>`,
  );
  return lines.map((l, j) => (j && l ? pad + l : l)).join('\n');
}

/** A watch page from the template: language, head and body at their placeholders. */
export function watchPage(template: string, v: Video, lang: Lang): string {
  const fill = (html: string, re: RegExp, to: (pad: string) => string, what: string) => {
    if (!re.test(html)) throw new Error(`watchPage: ${what} not found in the template`);
    return html.replace(re, (_, pad: string) => pad + to(pad));
  };
  let out = fill(template, /<html lang="[a-z]+"()/, () => `<html lang="${lang}" data-lang="${lang}" data-page-lang="${lang}"`, 'html element');
  out = fill(out, /([ \t]*)<!-- watch:head -->/, (pad) => watchHead(v, lang, pad), 'watch:head');
  out = fill(out, /([ \t]*)<!-- watch:body -->/, (pad) => watchBody(v, lang, pad), 'watch:body');
  return out;
}
