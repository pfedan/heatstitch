import { t } from '../i18n';
import { drawLegend, LEGEND_HEIGHT } from '../render/legend';
import { drawScene, type Scene } from '../render/scene';

/** Renders the current view (plus legend) at device resolution and downloads it as PNG. */
export function exportPng(scene: Scene, w: number, h: number, background: string, fileName: string): void {
  const dpr = window.devicePixelRatio || 1;
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  drawScene(ctx, w, h, scene, background);

  const s = scene.settings;
  const lw = Math.min(260, w - 24);
  const lx = w - lw - 12;
  const ly = h - LEGEND_HEIGHT - 20;
  ctx.fillStyle = 'rgba(13, 11, 16, 0.7)';
  ctx.beginPath();
  ctx.roundRect(lx - 10, ly - 8, lw + 20, LEGEND_HEIGHT + 14, 8);
  ctx.fill();
  drawLegend(ctx, lx, ly, lw, {
    ...s.scales[s.metric],
    unit: t(s.metric === 'thread' ? 'unit.thread' : 'unit.penetrations'),
    title: t(s.metric === 'thread' ? 'metric.thread' : 'metric.penetrations'),
    ink: '#ece8f1',
  });

  c.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${fileName}-${s.metric}-density.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}
