import { describe, expect, it } from 'vitest';
import { FINE_STEPS } from '../src/correct/engine/fine';
import { setLang } from '../src/i18n';
import { fixText } from '../src/ui/fixText';

/** "Von der Korrektur geändert" names every step of the fine stage in words, never by its key. */
describe('fixText', () => {
  // setLang also fills the page; here there is none.
  (globalThis as { document?: unknown }).document ??= { documentElement: {}, body: { querySelectorAll: () => [] } };
  for (const lang of ['de', 'en'] as const) {
    it(`names every fine step in ${lang}`, () => {
      setLang(lang);
      const texts = FINE_STEPS.map((s) => fixText({ field: `fine.${s}`, from: '', to: true }));
      for (const x of texts) expect(x).not.toMatch(/fine\.|→|true/);
      expect(new Set(texts).size).toBe(FINE_STEPS.length);
      expect(fixText({ field: 'fine.somethingNew', from: '', to: true })).not.toMatch(/fine\.|true/);
    });
  }
});
