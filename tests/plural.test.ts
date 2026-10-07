import { describe, expect, it } from 'vitest';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { t } from '../src/i18n';

/** A count of one reads in the singular: t() picks "<key>.one" for n = 1, as number or formatted. */
describe('plural', () => {
  it('picks the singular for one', () => {
    expect(t('image.verdict.findings', { n: 1 })).toBe(en['image.verdict.findings.one']);
    expect(t('image.verdict.findings', { n: '1' })).toBe(en['image.verdict.findings.one']);
    expect(t('image.verdict.findings', { n: 2 })).toMatch(/^2 areas/);
    expect(t('findings.count', { n: 0 })).toBe('0 zones');
  });

  it('every singular has its plural in both languages', () => {
    for (const d of [de, en] as Record<string, string>[]) {
      for (const k of Object.keys(d)) if (k.endsWith('.one')) expect(d[k.slice(0, -4)], k).toBeDefined();
    }
  });
});
