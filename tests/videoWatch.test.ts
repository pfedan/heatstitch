import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sitemap } from '../src/build/sitemap';
import { videoObject, watchPage } from '../src/build/watchPage';
import { isoDuration, seconds, VIDEOS, watchPath } from '../src/videos/catalog';

const template = new TextDecoder().decode(readFileSync(new URL('../video.html', import.meta.url)));
const ldJson = (html: string) => JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]);

describe('the page of each video (for search engines)', () => {
  it('each video has an upload date with its time zone and a duration schema.org reads', () => {
    for (const v of VIDEOS) {
      expect(v.published, v.key).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
      expect(Number.isNaN(Date.parse(v.published))).toBe(false);
      expect(isoDuration(v.length)).toMatch(/^PT(\d+M)?\d+S$/);
    }
    expect(isoDuration('2:58')).toBe('PT2M58S');
  });

  it('the video is the main content: in the page as a video element, right under the title, without a script', () => {
    for (const v of VIDEOS)
      for (const lang of ['en', 'de'] as const) {
        const html = watchPage(template, v, lang);
        expect(html).not.toContain('<!-- watch:');
        expect(html).toContain(`<html lang="${lang}" data-lang="${lang}" data-page-lang="${lang}"`);
        expect(html.split('<video ').length - 1).toBe(1);
        const main = html.slice(html.indexOf('<main'));
        expect(main.indexOf('<video ')).toBeGreaterThan(main.indexOf('<h1>'));
        expect(main.indexOf('<video ')).toBeLessThan(main.indexOf('class="lead"'));
        expect(html).toContain(`src="https://media.heatstitch.app/videos/${v.key}.mp4"`);
        expect(html).toContain(`poster="https://media.heatstitch.app/videos/${v.key}.jpg"`);
        expect(html).toContain(`<link rel="canonical" href="https://heatstitch.app/${watchPath(v.key, lang)}" />`);
        expect(html).toContain('<meta name="robots" content="index, follow" />');
      }
  });

  it('carries VideoObject data with what Google requires and recommends', () => {
    for (const v of VIDEOS)
      for (const lang of ['en', 'de'] as const) {
        const data = ldJson(watchPage(template, v, lang));
        expect(data).toEqual(videoObject(v, lang));
        expect(data['@type']).toBe('VideoObject');
        for (const k of ['name', 'description', 'uploadDate', 'duration', 'contentUrl']) expect(typeof data[k], k).toBe('string');
        expect(data.thumbnailUrl[0]).toMatch(/^https:\/\/.+\.jpg$/);
        expect(data.name).toBe(v.title[lang]);
      }
  });

  it('the names of the videos differ, so search engines tell them apart', () => {
    for (const lang of ['en', 'de'] as const) expect(new Set(VIDEOS.map((v) => v.title[lang])).size).toBe(VIDEOS.length);
  });

  it('a title can not end the data script early', () => {
    const v = { ...VIDEOS[0], title: { de: '</script><b>', en: '</script><b>' } };
    const html = watchPage(template, v, 'en');
    expect(ldJson(html).name).toBe('</script><b>');
  });

  it('the sitemap lists every page and, on the page of each video, the video with its thumbnail', () => {
    const xml = sitemap();
    expect(xml).toContain('xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"');
    for (const page of ['', 'de/', 'docs.html', 'de/docs.html', 'videos.html', 'de/videos.html', 'releases.html', 'de/releases.html']) expect(xml).toContain(`<loc>https://heatstitch.app/${page}</loc>`);
    for (const v of VIDEOS)
      for (const lang of ['en', 'de'] as const) {
        const loc = `<loc>https://heatstitch.app/${watchPath(v.key, lang)}</loc>`;
        const entry = xml.slice(xml.indexOf(loc), xml.indexOf('</url>', xml.indexOf(loc)));
        expect(entry, loc).toContain(`<video:thumbnail_loc>https://media.heatstitch.app/videos/${v.key}.jpg</video:thumbnail_loc>`);
        expect(entry).toContain(`<video:content_loc>https://media.heatstitch.app/videos/${v.key}.mp4</video:content_loc>`);
        expect(entry).toContain(`<video:duration>${seconds(v.length)}</video:duration>`);
        expect(entry).toMatch(/<video:title>[^<]+<\/video:title>/);
        expect(entry).toMatch(/<video:description>[^<]+<\/video:description>/);
      }
    expect(xml.split('<url>').length - 1).toBe(8 + 2 * VIDEOS.length);
  });
});
