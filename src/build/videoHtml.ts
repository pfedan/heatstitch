/**
 * The HTML of the tutorial videos, written into the guide and the video page while they are built
 * (and served by the dev server): placeholders in the pages say where, src/videos/catalog.ts says
 * what. So a video is added in one place and shows up everywhere, the same in both languages.
 *
 *   <!-- video:cards de -->              the cards at the top of the guide
 *   <!-- video:ref de 07-a 09-b -->      the links to one or more videos beside a section
 *   <!-- video:page de -->               the video page, in groups
 *   <!-- video:dialog -->                the player (once per page)
 *
 * A placeholder that names an unknown video stops the build.
 */

import { cardPath, GROUPS, seconds, VIDEO_BASE, VIDEOS, videoByKey, type Lang, type Video } from '../videos/catalog';

const T = {
  play: { de: 'Video abspielen', en: 'Play video' },
  part: { de: 'Teil', en: 'Part' },
  video: { de: 'Video', en: 'Video' },
  files: { de: 'Zum Mitmachen', en: 'To follow along' },
} as const;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const posterImage = (key: string): string => `${VIDEO_BASE}${key}.jpg`;

function thumb(v: Video, cls: string): string {
  return `<img class="${cls}" src="/${cardPath(v.key)}" data-poster="${posterImage(v.key)}" width="640" height="480" loading="lazy" alt="" />`;
}

function card(v: Video, lang: Lang, wide: boolean, pad: string): string {
  const title = esc(v.title[lang]);
  const lines = [
    `<li class="video" id="video-${v.key}" data-key="${v.key}">`,
    `  <button type="button" class="video-play" aria-label="${T.play[lang]}: ${title} (${v.length})">`,
    `    ${thumb(v, 'video-thumb')}`,
    `    <span class="video-badge" aria-hidden="true"></span>`,
    `    <span class="video-length" aria-hidden="true">${v.length}</span>`,
    `  </button>`,
    `  <div class="video-text">`,
    `    <p class="video-title"><span class="video-part">${T.part[lang]} ${v.part}</span> ${title}</p>`,
  ];
  if (wide) {
    lines.push(`    <p class="video-goal">${esc(v.goal[lang])}</p>`);
    if (v.files.length) lines.push(`    <p class="video-meta">${T.files[lang]}: ${v.files.map(esc).join(', ')}</p>`);
  }
  lines.push(`  </div>`, `</li>`);
  return lines.map((l) => pad + l).join('\n');
}

/** The cards at the top of the guide, all videos in the order of their parts. */
export function videoCards(lang: Lang, pad = '        '): string {
  const intro =
    lang === 'de'
      ? `<p><b>Zum Ansehen: kurze Videos</b> Jedes zeigt in zwei bis drei Minuten einen Weg durch die App, mit Stimme und Untertiteln; jedes steht für sich. <a href="videos.html">Alle Videos nach Thema</a></p>`
      : `<p><b>To watch: short videos</b> Each shows one way through the app in two to three minutes, spoken in German with English subtitles; each stands on its own. <a href="videos.html">All videos by topic</a></p>`;
  return [
    `<section class="videos" aria-label="Videos">`,
    `  ${intro}`,
    `  <ul class="video-list">`,
    VIDEOS.map((v) => card(v, lang, false, pad + '    ')).join('\n'),
    `  </ul>`,
    `</section>`,
  ]
    .map((l, i) => (i === 3 ? l : pad + l))
    .join('\n')
    .trimStart();
}

/** Links beside a section of the guide to the videos that show it. */
export function videoRef(lang: Lang, keys: string[], pad = '        '): string {
  const links = keys.map((key) => {
    const v = videoByKey(key);
    if (!v) throw new Error(`video:ref names an unknown video: ${key}`);
    return [
      `  <a class="video-ref" href="videos.html#video-${v.key}" data-key="${v.key}">`,
      `    ${thumb(v, 'video-ref-thumb')}`,
      `    <span class="video-ref-text"><small>${T.video[lang]} · ${v.length}</small>${esc(v.title[lang])}</span>`,
      `  </a>`,
    ].join('\n');
  });
  return [`<div class="video-refs">`, ...links, `</div>`]
    .join('\n')
    .split('\n')
    .map((l, i) => (i ? pad + l : l))
    .join('\n');
}

const minutes = (): number => Math.round(VIDEOS.reduce((s, v) => s + seconds(v.length), 0) / 60);

/** The body of the video page: what it is, a way to each group, and the groups with their cards. */
export function videoPage(lang: Lang, pad = '        '): string {
  const n = VIDEOS.length;
  const lead =
    lang === 'de'
      ? `${n} kurze Videos, zusammen ${minutes()} Minuten. Jedes zeigt einen Weg durch die App, mit Stimme und Untertiteln, und steht für sich. Die Dateien aus den Videos kannst du im Player herunterladen und mitmachen.`
      : `${n} short videos, ${minutes()} minutes in all. Each shows one way through the app and stands on its own. They are spoken in German, with English subtitles. The files from the videos can be downloaded in the player, to follow along.`;
  const out = [
    lang === 'de' ? `<h1>heatstitch in Videos</h1>` : `<h1>heatstitch in videos</h1>`,
    `<p class="lead">${lead}</p>`,
    `<nav class="video-groups-nav" aria-label="${lang === 'de' ? 'Themen' : 'Topics'}">`,
    ...GROUPS.map((g) => `  <a href="#${lang}-${g.id}">${esc(g.title[lang])}</a>`),
    `</nav>`,
  ];
  for (const g of GROUPS) {
    const list = VIDEOS.filter((v) => v.group === g.id);
    if (!list.length) continue;
    out.push(
      `<section class="video-group" aria-labelledby="${lang}-${g.id}">`,
      `  <h2 id="${lang}-${g.id}">${esc(g.title[lang])}</h2>`,
      `  <p class="video-group-lead">${esc(g.lead[lang])}</p>`,
      `  <ul class="video-list video-list-wide${list.length === 1 ? ' video-list-one' : ''}">`,
      list.map((v) => card(v, lang, true, '    ')).join('\n'),
      `  </ul>`,
      `</section>`,
    );
  }
  out.push(
    lang === 'de'
      ? `<p class="video-more">Lieber lesen? <a href="docs.html">Die Anleitung</a> erklärt alles Schritt für Schritt.</p>`
      : `<p class="video-more">Rather read? <a href="docs.html">The guide</a> explains everything step by step.</p>`,
  );
  return out
    .join('\n')
    .split('\n')
    .map((l, i) => (i ? pad + l : l))
    .join('\n');
}

/** The player: a medium dialog over the page (src/videos/player.ts), bilingual like the guide's shell. */
export function videoDialog(pad = '    '): string {
  return `<dialog class="video-dialog" id="video-dialog" aria-labelledby="video-dialog-title" data-base="${VIDEO_BASE}">
  <div class="video-dialog-head">
    <b id="video-dialog-title"></b>
    <div class="video-dialog-tools">
      <span class="video-cc" role="group" aria-label="Untertitel / Subtitles">
        <span class="video-cc-label"><span lang="de">Untertitel</span><span lang="en">Subtitles</span></span>
        <button type="button" data-cc="off" aria-pressed="true"><span lang="de">Aus</span><span lang="en">Off</span></button>
        <button type="button" data-cc="de" aria-pressed="false">Deutsch</button>
        <button type="button" data-cc="en" aria-pressed="false">English</button>
      </span>
      <details class="video-files" id="video-files" hidden>
        <summary class="video-dialog-btn">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 3v10m0 0 4-4m-4 4-4-4M4 16h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" /></svg>
          <span lang="de">Dateien</span><span lang="en">Files</span>
          <svg class="video-files-chevron" viewBox="0 0 20 20" width="12" height="12" aria-hidden="true"><path d="m5 8 5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" /></svg>
        </summary>
        <ul class="video-files-menu" id="video-files-menu"></ul>
      </details>
      <button type="button" class="video-dialog-btn" id="video-full">
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" /></svg>
        <span lang="de">Vollbild</span><span lang="en">Full screen</span>
      </button>
      <button type="button" class="video-dialog-btn" id="video-close">
        <span lang="de">Schließen</span><span lang="en">Close</span>
      </button>
    </div>
  </div>
  <div class="video-dialog-stage" id="video-dialog-stage"></div>
  <nav class="video-dialog-foot" id="video-dialog-foot" aria-label="Teile / Parts">
    <button type="button" class="video-step" id="video-prev" hidden></button>
    <button type="button" class="video-step video-step-next" id="video-next" hidden></button>
  </nav>
</dialog>`
    .split('\n')
    .map((l, i) => (i ? pad + l : l))
    .join('\n');
}

/** Writes the videos into a page at its placeholders. */
export function expandVideos(html: string): string {
  return html.replace(/([ \t]*)<!-- video:(\w+)((?: [\w-]+)*) -->/g, (_, pad: string, what: string, rest: string) => {
    const args = rest.trim().split(/\s+/).filter(Boolean);
    const lang = args[0] as Lang;
    const needLang = () => {
      if (lang !== 'de' && lang !== 'en') throw new Error(`video:${what} needs a language: ${rest}`);
    };
    switch (what) {
      case 'cards':
        needLang();
        return pad + videoCards(lang, pad);
      case 'ref':
        needLang();
        if (args.length < 2) throw new Error('video:ref names no video');
        return pad + videoRef(lang, args.slice(1), pad);
      case 'page':
        needLang();
        return pad + videoPage(lang, pad);
      case 'dialog':
        return pad + videoDialog(pad);
      default:
        throw new Error(`unknown video placeholder: video:${what}`);
    }
  });
}
