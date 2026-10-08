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
      return t(c.to ? 'plan.change.underCross' : 'plan.change.underSingle');
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
    case 'underCover':
      return t('plan.change.underCover');
    case 'edgeShare':
      return t('plan.change.edgeShare', { a: formatNumber(Number(c.from || 0) * 100), b: formatNumber(Number(c.to) * 100) });
    case 'byWidth':
      return t('plan.change.byWidth');
    case 'knockout':
      return t('plan.change.knockout');
    case 'fine.zeroLength':
      return t('plan.change.fine.zeroLength');
    case 'fine.mergeShort':
      return t('plan.change.fine.mergeShort');
    case 'fine.pullBack':
      return t('plan.change.fine.pullBack');
    case 'fine.satinShort':
      return t('plan.change.fine.satinShort');
    case 'fine.hiddenRows':
      return t('plan.change.fine.hiddenRows');
    default:
      // A stitch step of the fine stage this list does not know yet: its kind, never its key.
      return c.field.startsWith('fine.') ? t('plan.change.fine') : `${c.field}: ${String(c.from)} → ${String(c.to)}`;
  }
}
