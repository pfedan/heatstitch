import { t } from '../i18n';
import type { LegendSpec } from '../render/legend';
import { CAUTION_COLOR, CRITICAL_COLOR } from '../render/validationOverlay';
import type { Settings } from '../settings';
import { CAUTION_MM, CRITICAL_MM } from '../validation/thresholds';

/** Legend for the current metric; the thread metric shows the validation thresholds as ticks. */
export function legendSpec(s: Settings): LegendSpec {
  const thread = s.metric === 'thread';
  return {
    max: s.scales[s.metric].max,
    ticks: thread
      ? [
          { value: CAUTION_MM, color: CAUTION_COLOR },
          { value: CRITICAL_MM, color: CRITICAL_COLOR },
        ]
      : [],
    unit: t(thread ? 'unit.thread' : 'unit.penetrations'),
    title: t(thread ? 'metric.thread' : 'metric.penetrations'),
    ink: '#ece8f1',
  };
}
