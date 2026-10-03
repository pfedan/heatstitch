/** Grab distance around the divider, CSS pixels. */
export const DIVIDER_GRAB_PX = 10;

function label(ctx: CanvasRenderingContext2D, text: string, x: number, align: 'left' | 'right'): void {
  ctx.font = '600 12px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 16;
  const bx = align === 'left' ? Math.max(4, x - w - 10) : x + 10;
  ctx.fillStyle = 'rgba(13, 11, 16, 0.75)';
  ctx.beginPath();
  ctx.roundRect(bx, 12, w, 22, 6);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + 8, 23);
}

/** The split line of the comparison view with its handle and side labels. */
export function drawDivider(ctx: CanvasRenderingContext2D, x: number, h: number, left: string, right: string): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(x - 2, 0, 4, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 1, 0, 2, h);
  const cy = h / 2;
  ctx.beginPath();
  ctx.arc(x, cy, 14, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Arrows pointing left and right.
  ctx.fillStyle = '#2a2530';
  ctx.beginPath();
  ctx.moveTo(x - 9, cy);
  ctx.lineTo(x - 3, cy - 5);
  ctx.lineTo(x - 3, cy + 5);
  ctx.moveTo(x + 9, cy);
  ctx.lineTo(x + 3, cy - 5);
  ctx.lineTo(x + 3, cy + 5);
  ctx.fill();
  label(ctx, left, x, 'left');
  label(ctx, right, x, 'right');
  ctx.restore();
}
