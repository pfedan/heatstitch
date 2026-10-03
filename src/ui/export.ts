import { drawLegend, LEGEND_HEIGHT } from '../render/legend';
import { drawScene, type Scene } from '../render/scene';
import { t } from '../i18n';
import { legendSpec } from './legendSpec';
import { fabricLabel, threadLabel } from './profilePanel';

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
  const caption = 18; // profile line above the legend
  ctx.fillStyle = 'rgba(13, 11, 16, 0.7)';
  ctx.beginPath();
  ctx.roundRect(lx - 10, ly - 8 - caption, lw + 20, LEGEND_HEIGHT + 14 + caption, 8);
  ctx.fill();
  ctx.fillStyle = '#a49cb0';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(t('export.profile', { fabric: fabricLabel(s.profile), thread: threadLabel(s.profile) }), lx, ly - 6, lw);
  drawLegend(ctx, lx, ly, lw, legendSpec(s));

  c.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${fileName}-${s.metric}-density.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}
