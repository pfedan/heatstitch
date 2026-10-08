/**
 * One address per language, so search engines find the German pages too: the app and the guide
 * are built at their address (English) and again under de/ (German), each with its own title,
 * descriptions and hreflang links to the other. The guide keeps only the article of its language;
 * the app's texts come from src/i18n, the page only says which language it starts in
 * (data-page-lang, read by src/main.ts and src/docs.ts).
 *
 * Plain string work on the built HTML (see vite.config.ts); a head tag that is missing throws, so a
 * renamed tag breaks the build instead of shipping an English head under de/.
 */

export type Lang = 'de' | 'en';
export type Page = 'app' | 'docs';

export const SITE = 'https://pfedan.github.io/heatstitch/';

/** Where a page lives, relative to the site's base. */
export function pagePath(page: Page, lang: Lang): string {
  return (lang === 'de' ? 'de/' : '') + (page === 'docs' ? 'docs.html' : '');
}

const DE: Record<Page, { title: string; description: string; ogTitle: string; ogDescription: string }> = {
  app: {
    title: 'heatstitch: Stickdateien (PES, DST) im Browser ansehen, bearbeiten und prüfen',
    description:
      'Kostenloser Stick-Editor im Browser: PES, DST, JEF, VP3, EXP oder SVG öffnen, Reihenfolge, Füllmuster und einzelne Stiche bearbeiten, die Stichdichte prüfen und für deine Stickmaschine speichern.',
    ogTitle: 'heatstitch: Stickdateien ansehen, bearbeiten und prüfen',
    ogDescription:
      'Reihenfolge, Objekte, Füllmuster und einzelne Stiche, dazu eine Dichteprüfung, die zu Dichtes behebt. Macht aus Bildern und SVG Stiche. Kostenlos, und deine Dateien verlassen nie dein Gerät.',
  },
  docs: {
    title: 'heatstitch Anleitung: Stickdateien ansehen, bearbeiten, zeichnen und prüfen',
    description:
      'Wie heatstitch die Reihenfolge von Stickdateien (PES, DST, JEF, VP3, EXP, PEC) zeigt, Objekte mit anderen Füllmustern, Umrandungen und Satin-Einstellungen neu stickt, Formen und einzelne Stiche bearbeitet, Formen und Schrift zeichnet, die Stichdichte für deinen Stoff prüft, Bilder in Stiche umwandelt und das Ergebnis für Maschine und Stickrahmen speichert.',
    ogTitle: 'heatstitch Anleitung: Stickdateien ansehen, bearbeiten und prüfen',
    ogDescription:
      'Reihenfolge und Sprünge, Objekte und Füllmuster, Formen, Schrift, einzelne Stiche, Dichteprüfung und Korrektur, Bilder zu Stichen, Stickrahmen und Formate, in wenigen Minuten erklärt.',
  },
};

const DE_IMAGE_ALT = 'Eine gestickte Katze in heatstitch, dreifach gezeigt: realistische Fäden, Reihenfolge und Dichte-Heatmap';

function replaceOnce(html: string, re: RegExp, to: string, what: string): string {
  if (!re.test(html)) throw new Error(`langPages: ${what} not found`);
  return html.replace(re, to);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Sets the content of every <meta> with this name or property; at least one has to be there. */
function setMeta(html: string, key: string, value: string): string {
  const re = new RegExp(`(<meta (?:name|property)="${key.replace(/[.:]/g, '\\$&')}" content=")[^"]*(")`, 'g');
  return replaceOnce(html, re, `$1${esc(value)}$2`, `meta ${key}`);
}

/** The hreflang links of a page: both languages and English as the default. */
export function hreflangLinks(page: Page): string {
  const en = SITE + pagePath(page, 'en');
  const de = SITE + pagePath(page, 'de');
  return [
    `<link rel="alternate" hreflang="en" href="${en}" />`,
    `<link rel="alternate" hreflang="de" href="${de}" />`,
    `<link rel="alternate" hreflang="x-default" href="${en}" />`,
  ].join('\n    ');
}

/**
 * The page in one language: the html element says it (lang for readers and search engines,
 * data-lang for src/docs.css even without JS, data-page-lang for the scripts), the guide's other
 * article is gone, and the hreflang links follow the canonical one.
 */
export function langPage(html: string, page: Page, lang: Lang): string {
  // The app at its own address is everyone's (x-default): it starts in the language of the
  // settings or the browser, as before. Under de/ it starts in German.
  let out = page === 'app' && lang === 'en' ? html : replaceOnce(html, /<html lang="[a-z]+"/, `<html lang="${lang}" data-lang="${lang}" data-page-lang="${lang}"`, 'html element');
  if (page === 'docs') {
    const other = lang === 'de' ? 'en' : 'de';
    out = replaceOnce(out, new RegExp(`\\s*<article lang="${other}">[\\s\\S]*?</article>`), '', `article ${other}`);
  }
  out = replaceOnce(out, /(<link rel="canonical" href=")[^"]*(" \/>)/, `$1${SITE + pagePath(page, lang)}$2\n    ${hreflangLinks(page)}`, 'canonical link');
  return lang === 'de' ? german(out, page) : out;
}

/** The German head, and links relative to the site's base pointed one folder up (de/ is a folder). */
function german(html: string, page: Page): string {
  const t = DE[page];
  const url = SITE + pagePath(page, 'de');
  let out = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${esc(t.title)}</title>`, 'title');
  out = setMeta(out, 'description', t.description);
  out = setMeta(out, 'og:url', url);
  out = setMeta(out, 'og:title', t.ogTitle);
  out = setMeta(out, 'og:description', t.ogDescription);
  out = setMeta(out, 'og:image:alt', DE_IMAGE_ALT);
  out = setMeta(out, 'twitter:image:alt', DE_IMAGE_ALT);
  out = setMeta(out, 'og:locale', 'de_DE');
  out = setMeta(out, 'og:locale:alternate', 'en_US');
  if (page === 'app') {
    out = setMeta(out, 'twitter:title', t.ogTitle);
    out = setMeta(out, 'twitter:description', t.ogDescription);
  }
  // "./" (the app) and "docs.html" (the guide) stay in de/; files of the site are one folder up.
  return out.replace(/(\s(?:href|src)=")(?!https?:|\/|#|data:|mailto:|\.\/|docs\.html)([^"]+")/g, '$1../$2');
}
