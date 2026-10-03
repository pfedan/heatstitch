import { formatNumber, t, type Key } from '../i18n';
import { JOIN_MAX_EXCESS, JOIN_MAX_MM2, SMALL_CAUTION_MM2 } from '../validation/practice';
import type { Settings } from '../settings';
import {
  FABRICS,
  fabricOf,
  recommendedSpacing,
  THREADS,
  threadWidthMm,
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
import type { Checks } from '../validation/validate';

const CHECK_IDS = ['density', 'shortStitches', 'perforation'] as const satisfies readonly (keyof Checks)[];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const fabricLabel = (p: Profile) => t(`fabric.${p.fabric}` as Key);
export const threadLabel = (p: Profile) => t(`thread.${p.thread}` as Key);

/**
 * Fabric and thread pickers, the resulting limits, the check switches and the "how it works"
 * explanation.
 * `refresh` re-renders texts after a language change.
 */
export function bindProfile(s: Settings, onChange: () => void): { refresh: () => void } {
  const fabric = $<HTMLSelectElement>('fabric');
  const thread = $<HTMLSelectElement>('thread');
  const info = $<HTMLElement>('profile-info');
  const explain = $<HTMLUListElement>('explain');
  const checks = $<HTMLElement>('checks');

  const renderChecks = () => {
    const perforationApplies = fabricOf(s.profile).perforation;
    checks.replaceChildren(
      ...CHECK_IDS.map((id) => {
        const na = id === 'perforation' && !perforationApplies;
        const box = Object.assign(document.createElement('input'), {
          type: 'checkbox',
          checked: s.checks[id] && !na,
          disabled: na,
        });
        box.addEventListener('change', () => {
          s.checks = { ...s.checks, [id]: box.checked };
          onChange();
        });
        const hint =
          id === 'shortStitches'
            ? t('checks.shortStitches.hint', { count: SHORT_STITCH_COUNT, len: formatNumber(SHORT_STITCH_MM, 1) })
            : t(na ? 'checks.perforation.na' : (`checks.${id}.hint` as Key));
        const text = document.createElement('span');
        text.append(t(`checks.${id}` as Key), Object.assign(document.createElement('small'), { textContent: hint }));
        const label = Object.assign(document.createElement('label'), { className: na ? 'check na' : 'check' });
        label.append(box, text);
        return label;
      }),
    );
  };

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
    renderChecks();

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
    items.push(
      t('validation.explain.practice', {
        small: SMALL_CAUTION_MM2,
        join: JOIN_MAX_MM2,
        excess: Math.round((JOIN_MAX_EXCESS - 1) * 100),
      }),
      t('validation.explain.note'),
    );
    explain.replaceChildren(...items.map((text) => Object.assign(document.createElement('li'), { textContent: text })));
  };

  const update = () => {
    const next: ThreadId = thread.value as ThreadId;
    // A new thread weight moves the width slider to that weight; it can be adjusted afterwards.
    if (next !== s.profile.thread) s.threadMm = threadWidthMm({ ...s.profile, thread: next });
    s.profile = { fabric: fabric.value as FabricId, thread: next };
    refresh();
    onChange();
  };
  fabric.addEventListener('change', update);
  thread.addEventListener('change', update);
  refresh();
  return { refresh };
}
