import { t } from '../i18n';
import type { LegendSpec } from '../render/legend';
import { CAUTION_COLOR, CRITICAL_COLOR } from '../render/validationOverlay';
import type { Settings } from '../settings';
import { thresholdsFor } from '../validation/thresholds';

/** Legend for the current metric; the thread metric shows the profile's density limits as ticks. */
export function legendSpec(s: Settings): LegendSpec {
  const thread = s.metric === 'thread';
  const th = thresholdsFor(s.profile);
  return {
    max: s.scales[s.metric].max,
    ticks: thread
      ? [
          { value: th.caution, color: CAUTION_COLOR },
          { value: th.critical, color: CRITICAL_COLOR },
        ]
      : [],
    unit: t(thread ? 'unit.thread' : 'unit.penetrations'),
    title: t(thread ? 'metric.thread' : 'metric.penetrations'),
    ink: '#ece8f1',
  };
}
