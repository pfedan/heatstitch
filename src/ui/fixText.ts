import { formatNumber, t, type Key } from '../i18n';
import type { Fixed } from '../model/restitch';

const mm = (v: Fixed['from']) => (typeof v === 'number' ? formatNumber(v, 2) : v === '' ? '…' : String(v));
const signed = (v: Fixed['from']) => (typeof v === 'number' ? (v > 0 ? '+' : '') + formatNumber(v, 2) : v === '' ? '…' : String(v));
const UNDER: Record<string, Key> = {
  auto: 'stitch.under.auto',
  center: 'stitch.under.center',
  contour: 'stitch.under.contour',
  zigzag: 'stitch.under.zigzag',
  both: 'stitch.under.both',
};

/** One change the correction made or proposes, in words: "Abstand 0,41 → 0,44 mm". */
export function fixText(c: Fixed): string {
  switch (c.field) {
    case 'spacing':
      return t('plan.change.spacing', { a: mm(c.from), b: mm(c.to) });
    case 'underlay':
      return t(c.to ? 'plan.change.underlayOn' : 'plan.change.underlayOff');
    case 'underCross':
      return t('plan.change.underSingle');
    case 'under':
      return t('plan.change.under', { a: t(UNDER[String(c.from)] ?? 'stitch.under.auto'), b: t(UNDER[String(c.to)] ?? 'stitch.under.auto') });
    case 'edge':
      return t('plan.change.edge', { a: signed(c.from), b: signed(c.to) });
    case 'short':
      return t('plan.change.short');
    case 'split':
      return t('plan.change.split', { a: mm(c.from), b: mm(c.to) });
    case 'stagger':
      return t('plan.change.stagger');
    case 'stitch':
      return t('plan.change.stitch', { a: mm(c.from), b: mm(c.to) });
    case 'angle':
      return t('plan.change.angle', { a: c.from === '' ? '…' : formatNumber(Number(c.from)), b: formatNumber(Number(c.to)) });
    case 'knockout':
      return t('plan.change.knockout');
    default:
      return `${c.field}: ${String(c.from)} → ${String(c.to)}`;
  }
}
