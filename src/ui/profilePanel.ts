import { formatNumber, t, type Key } from '../i18n';
import type { Settings } from '../settings';
import {
  FABRICS,
  fabricOf,
  recommendedSpacing,
  THREADS,
  type FabricId,
  type Profile,
  type ThreadId,
} from '../validation/profiles';
import { TIE_MAX } from '../validation/shortStitches';
import {
  BASE,
  HOLES_CAUTION,
  HOLES_CRITICAL,
  SHORT_STITCH_COUNT,
  SHORT_STITCH_MM,
  thresholdsFor,
} from '../validation/thresholds';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const fabricLabel = (p: Profile) => t(`fabric.${p.fabric}` as Key);
export const threadLabel = (p: Profile) => t(`thread.${p.thread}` as Key);

/**
 * Fabric and thread pickers, the resulting limits and the "how it works" explanation.
 * `refresh` re-renders texts after a language change.
 */
export function bindProfile(s: Settings, onChange: () => void): { refresh: () => void } {
  const fabric = $<HTMLSelectElement>('fabric');
  const thread = $<HTMLSelectElement>('thread');
  const info = $<HTMLElement>('profile-info');
  const explain = $<HTMLUListElement>('explain');

  const refresh = () => {
    fabric.replaceChildren(...FABRICS.map((f) => new Option(t(`fabric.${f.id}` as Key), f.id)));
    thread.replaceChildren(...THREADS.map((th) => new Option(t(`thread.${th.id}` as Key), th.id)));
    fabric.value = s.profile.fabric;
    thread.value = s.profile.thread;

    const th = thresholdsFor(s.profile);
    const [min, max] = recommendedSpacing(s.profile);
    const lines = [
      t(`fabric.${s.profile.fabric}.ex` as Key),
      t('profile.limits', { caution: formatNumber(th.caution, 1), critical: formatNumber(th.critical, 1) }),
      t('profile.spacing', { min: formatNumber(min, 2), max: formatNumber(max, 2) }),
    ];
    if (fabricOf(s.profile).perforation) lines.push(t('profile.perforation'));
    info.replaceChildren(...lines.map((l) => Object.assign(document.createElement('span'), { textContent: l })));

    const items: string[] = [
      t('validation.explain.metric'),
      t('validation.explain.limits', {
        caution: formatNumber(BASE.caution, 1),
        critical: formatNumber(BASE.critical, 1),
        factor: formatNumber(th.factor, 2),
      }),
      t('validation.explain.satin', {
        satinCaution: formatNumber(th.satinCaution, 1),
        satinCritical: formatNumber(th.satinCritical, 1),
      }),
      t('validation.explain.shorts', {
        count: SHORT_STITCH_COUNT,
        len: formatNumber(SHORT_STITCH_MM, 1),
        tie: TIE_MAX,
      }),
    ];
    if (th.holes) items.push(t('validation.explain.perforation', { caution: HOLES_CAUTION, critical: HOLES_CRITICAL }));
    items.push(t('validation.explain.note'));
    explain.replaceChildren(...items.map((text) => Object.assign(document.createElement('li'), { textContent: text })));
  };

  const update = () => {
    s.profile = { fabric: fabric.value as FabricId, thread: thread.value as ThreadId };
    refresh();
    onChange();
  };
  fabric.addEventListener('change', update);
  thread.addEventListener('change', update);
  refresh();
  return { refresh };
}
