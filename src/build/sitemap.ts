/**
 * sitemap.xml, written by the build (vite.config.ts): the app, the guide and the video page in both
 * languages, and the page of every video with the video itself, in Google's video sitemap
 * extension (https://www.google.com/schemas/sitemap-video/1.1). So a new video in
 * src/videos/catalog.ts is listed without touching this file.
 */

import { seconds, VIDEOS, type Lang } from '../videos/catalog';
import { pagePath, SITE, type Page } from './langPages';
import { posterUrl, videoUrl, watchDescription, watchUrl } from './watchPage';

const LANGS: Lang[] = ['en', 'de'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function alternates(url: (l: Lang) => string): string[] {
  return [
    ...LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${url(l)}" />`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${url('en')}" />`,
  ];
}

export function sitemap(): string {
  const out = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">`,
  ];
  for (const page of ['app', 'docs', 'videos'] as Page[]) {
    const url = (l: Lang) => SITE + pagePath(page, l);
    for (const lang of LANGS) out.push(`  <url>`, `    <loc>${url(lang)}</loc>`, ...alternates(url), `  </url>`);
  }
  for (const v of VIDEOS) {
    const url = (l: Lang) => watchUrl(v, l);
    for (const lang of LANGS) {
      out.push(
        `  <url>`,
        `    <loc>${url(lang)}</loc>`,
        ...alternates(url),
        `    <video:video>`,
        `      <video:thumbnail_loc>${posterUrl(v)}</video:thumbnail_loc>`,
        `      <video:title>${esc(v.title[lang])}</video:title>`,
        `      <video:description>${esc(watchDescription(v, lang))}</video:description>`,
        `      <video:content_loc>${videoUrl(v)}</video:content_loc>`,
        `      <video:duration>${seconds(v.length)}</video:duration>`,
        `      <video:publication_date>${v.published}</video:publication_date>`,
        `      <video:family_friendly>yes</video:family_friendly>`,
        `    </video:video>`,
        `  </url>`,
      );
    }
  }
  out.push(`</urlset>`, ``);
  return out.join('\n');
}
