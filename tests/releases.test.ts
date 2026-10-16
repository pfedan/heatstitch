import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expandReleases, notesHtml, parseChangelog, releasesHtml, shownReleases } from '../src/build/changelog';
import { langPage } from '../src/build/langPages';
import { buildChannel, versionFromDescribe } from '../src/build/version';

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

const MD = `# Changelog

Intro text.

## [Unreleased]

### Deutsch

- **Neu:** etwas

### English

- **New:** something

## [1.1.0] - 2026-11-03

### Deutsch

#### Neu

- Ein [Werkzeug](https://example.com) mit \`code\`,
  über zwei Zeilen

Ein Absatz.

### English

- A tool <b>
`;

describe('release notes from CHANGELOG.md', () => {
  it('reads the sections in order, both languages each', () => {
    const all = parseChangelog(MD);
    expect(all.map((r) => [r.version, r.date])).toEqual([
      [null, null],
      ['1.1.0', '2026-11-03'],
    ]);
    expect(all[0].text).toEqual({ de: '- **Neu:** etwas', en: '- **New:** something' });
  });

  it('the real CHANGELOG.md reads and has both languages in every section', () => {
    const all = parseChangelog(read('CHANGELOG.md'));
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) expect(!!r.text.de, `${r.version}`).toBe(!!r.text.en);
  });

  it('refuses a heading that is not a version', () => {
    expect(() => parseChangelog('## [soon]\n')).toThrow(/not a version/);
    expect(() => parseChangelog('## 1.0.0\n')).toThrow(/## \[version\]/);
    expect(() => parseChangelog('## [1.0.0] - 2026-01-01\n\n### Français\n')).toThrow(/Deutsch or ### English/);
  });

  it('the beta shows what is unreleased on top, the real site only releases', () => {
    const all = parseChangelog(MD);
    expect(shownReleases(all, { unreleased: true }).map((r) => r.version)).toEqual([null, '1.1.0']);
    expect(shownReleases(all, { unreleased: false }).map((r) => r.version)).toEqual(['1.1.0']);
  });

  it('a release whose notes are still under [Unreleased] shows them under its own number', () => {
    const all = parseChangelog(MD);
    const shown = shownReleases(all, { unreleased: false, version: '1.2.0', today: '2026-12-01' });
    expect(shown.map((r) => [r.version, r.date])).toEqual([
      ['1.2.0', '2026-12-01'],
      ['1.1.0', '2026-11-03'],
    ]);
    // Already renamed: nothing taken from [Unreleased].
    expect(shownReleases(all, { unreleased: false, version: '1.1.0' }).map((r) => r.version)).toEqual(['1.1.0']);
  });

  it('writes lists, headings, paragraphs, links and code, and escapes the rest', () => {
    const html = notesHtml(parseChangelog(MD)[1].text.de);
    expect(html).toContain('<h3>Neu</h3>');
    expect(html).toContain('<li>Ein <a href="https://example.com">Werkzeug</a> mit <code>code</code>, über zwei Zeilen</li>');
    expect(html).toContain('<p>Ein Absatz.</p>');
    expect(notesHtml('- A tool <b>')).toBe('<ul>\n  <li>A tool &lt;b&gt;</li>\n</ul>');
  });

  it('dates and titles in each language, the beta section marked', () => {
    const all = parseChangelog(MD);
    const de = releasesHtml(shownReleases(all, { unreleased: true }), 'de');
    expect(de).toContain('<section class="release" id="beta">');
    expect(de).toContain('Neu in der Beta');
    expect(de).toContain('<section class="release" id="v1-1-0">');
    expect(de).toContain('Version 1.1.0 <time datetime="2026-11-03">3. November 2026</time>');
    expect(releasesHtml(shownReleases(all, { unreleased: false }), 'en')).toContain('Version 1.1.0 <time datetime="2026-11-03">November 3, 2026</time>');
    expect(releasesHtml([], 'de')).toContain('Noch keine Versionen.');
  });

  it('the page has a list in each language and keeps only one per address', () => {
    const page = expandReleases(read('releases.html'), parseChangelog(MD));
    expect(page).not.toContain('<!-- releases');
    const de = langPage(page, 'releases', 'de');
    expect(de).toContain('<h1>Neu in heatstitch</h1>');
    expect(de).not.toContain('<article lang="en">');
    expect(de).toContain('<link rel="canonical" href="https://heatstitch.app/de/releases.html" />');
    expect(de).toContain('<a class="doc-link" href="docs.html">');
  });
});

describe('the version of a build', () => {
  it('comes from the last release tag and the commits since', () => {
    expect(versionFromDescribe('v1.4.0')).toBe('1.4.0');
    expect(versionFromDescribe('v1.4.0-23-gabc1234')).toBe('1.4.0+23');
    expect(versionFromDescribe('v1.0.0-rc.1')).toBe('1.0.0-rc.1');
    expect(versionFromDescribe('v1.0.0-rc.1-5-gabc1234')).toBe('1.0.0-rc.1+5');
    expect(versionFromDescribe(null, 361)).toBe('0.0.0+361');
    expect(versionFromDescribe(null)).toBe('0.0.0');
  });

  it('the channel comes from CHANNEL, PREVIEW=1 is a preview', () => {
    expect(buildChannel({})).toBe('dev');
    expect(buildChannel({ PREVIEW: '1' })).toBe('preview');
    expect(buildChannel({ CHANNEL: 'beta' })).toBe('beta');
    expect(buildChannel({ CHANNEL: 'release' })).toBe('release');
    expect(() => buildChannel({ CHANNEL: 'prod' })).toThrow(/not one of/);
  });
});
