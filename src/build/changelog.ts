/**
 * The release notes page (releases.html, de/releases.html), written while the site is built from
 * CHANGELOG.md, the one place the notes are kept. CHANGELOG.md follows "Keep a Changelog": one section
 * per version, newest first, and [Unreleased] on top for what develop has that no release has yet.
 * Each section holds both languages:
 *
 *   ## [1.2.0] - 2026-11-03
 *
 *   ### Deutsch
 *
 *   - **Lücke füllen:** schließt ...
 *
 *   ### English
 *
 *   - **Fill gap:** closes ...
 *
 * Within a language: paragraphs, "- " lists, "#### " headings, **bold**, `code` and [links](url).
 * The beta shows [Unreleased] as "New in the beta"; the real site leaves it out. A release whose
 * notes are still under [Unreleased] (nobody gave them their number yet) shows them under its own
 * number, so publishing a release never waits on renaming the section.
 */

import type { Lang } from './langPages';

export type Release = {
  /** "1.2.0", or null for [Unreleased]. */
  version: string | null;
  /** "2026-11-03", or null. */
  date: string | null;
  /** The notes in each language, as markdown. */
  text: Record<Lang, string>;
};

const LANG_HEADING: Record<string, Lang> = { deutsch: 'de', english: 'en' };

/** The sections of CHANGELOG.md, in the file's order (newest first). */
export function parseChangelog(md: string): Release[] {
  const out: Release[] = [];
  const parts = md.replace(/\r\n/g, '\n').split(/^## /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const head = (nl < 0 ? part : part.slice(0, nl)).trim();
    const m = /^\[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?$/.exec(head);
    if (!m) throw new Error(`CHANGELOG.md: "## ${head}" is not "## [version] - date" or "## [Unreleased]"`);
    const unreleased = m[1].toLowerCase() === 'unreleased';
    if (!unreleased && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(m[1])) throw new Error(`CHANGELOG.md: [${m[1]}] is not a version`);
    const text: Record<Lang, string> = { de: '', en: '' };
    const body = nl < 0 ? '' : part.slice(nl + 1);
    for (const block of body.split(/^### /m).slice(1)) {
      const bl = block.indexOf('\n');
      const lang = LANG_HEADING[(bl < 0 ? block : block.slice(0, bl)).trim().toLowerCase()];
      if (!lang) throw new Error(`CHANGELOG.md: [${m[1]}] has "### ${block.slice(0, bl)}", expected ### Deutsch or ### English`);
      text[lang] = bl < 0 ? '' : block.slice(bl + 1).trim();
    }
    out.push({ version: unreleased ? null : m[1], date: m[2] ?? null, text });
  }
  return out;
}

/**
 * What a page shows: the released sections, and on the beta [Unreleased] first. A release build
 * (version given) whose number has no section yet takes [Unreleased] as its own, dated today.
 */
export function shownReleases(all: Release[], o: { unreleased: boolean; version?: string; today?: string }): Release[] {
  const unreleased = all.find((r) => r.version === null);
  const released = all.filter((r) => r.version !== null);
  if (o.version && unreleased && !released.some((r) => r.version === o.version) && hasText(unreleased))
    return [{ ...unreleased, version: o.version, date: o.today ?? null }, ...released];
  return o.unreleased && unreleased && hasText(unreleased) ? [unreleased, ...released] : released;
}

const hasText = (r: Release): boolean => !!(r.text.de || r.text.en);

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** **bold**, `code` and [text](https://...) on escaped text. */
function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|[\w./#-]+)\)/g, '<a href="$2">$1</a>');
}

/** The small markdown of one language's notes as HTML. */
export function notesHtml(md: string): string {
  const out: string[] = [];
  let list: string[] | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
    if (list) out.push(`<ul>\n${list.map((li) => `  <li>${inline(li)}</li>`).join('\n')}\n</ul>`);
    list = null;
  };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const item = /^[-*] (.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (/^#### /.test(line)) {
      flush();
      out.push(`<h3>${inline(line.slice(5).trim())}</h3>`);
    } else if (item) {
      if (para.length) flush();
      (list ??= []).push(item[1]);
    } else if (list && /^\s+\S/.test(raw)) list[list.length - 1] += ` ${line.trim()}`;
    else {
      if (list) flush();
      para.push(line.trim());
    }
  }
  flush();
  return out.join('\n');
}

const T = {
  beta: { de: 'Neu in der Beta', en: 'New in the beta' },
  betaNote: {
    de: 'Das steckt schon in der Beta und kommt mit der nächsten Version auf heatstitch.app.',
    en: 'This is in the beta already and comes to heatstitch.app with the next version.',
  },
  empty: { de: 'Noch keine Versionen.', en: 'No versions yet.' },
  version: { de: 'Version', en: 'Version' },
} as const;

const MONTHS: Record<Lang, string[]> = {
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

function longDate(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split('-').map(Number);
  return lang === 'de' ? `${d}. ${MONTHS.de[m - 1]} ${y}` : `${MONTHS.en[m - 1]} ${d}, ${y}`;
}

/** The id of a version's section: v1-2-0, so a link can point at it (releases.html#v1-2-0). */
export const releaseId = (version: string): string => `v${version.replace(/[^0-9A-Za-z]+/g, '-')}`;

/** The list of versions on the page, in one language. */
export function releasesHtml(releases: Release[], lang: Lang): string {
  if (!releases.length) return `<p class="release-empty">${T.empty[lang]}</p>`;
  return releases
    .map((r) => {
      const title = r.version ? `${T.version[lang]} ${esc(r.version)}` : T.beta[lang];
      const date = r.date ? ` <time datetime="${r.date}">${longDate(r.date, lang)}</time>` : '';
      const note = r.version ? '' : `\n  <p class="release-note">${T.betaNote[lang]}</p>`;
      return [
        `<section class="release" id="${r.version ? releaseId(r.version) : 'beta'}">`,
        `  <h2>${title}${date}</h2>${note}`,
        notesHtml(r.text[lang] || r.text[lang === 'de' ? 'en' : 'de'])
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n'),
        `</section>`,
      ].join('\n');
    })
    .join('\n');
}

/** Writes the list into the page's placeholders, <!-- releases de --> and <!-- releases en -->. */
export function expandReleases(html: string, releases: Release[]): string {
  return html.replace(/<!-- releases (de|en) -->/g, (_, lang: Lang) => releasesHtml(releases, lang));
}
