/** Maps world millimetres (y down) to CSS pixels: screen = world * scale + offset. */
export class Viewport {
  scale = 4;
  offsetX = 0;
  offsetY = 0;

  toScreen(x: number, y: number): [number, number] {
    return [x * this.scale + this.offsetX, y * this.scale + this.offsetY];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.offsetX) / this.scale, (sy - this.offsetY) / this.scale];
  }

  /** Fits a world rectangle (mm) into a w x h pixel area with a margin. */
  fit(minX: number, minY: number, maxX: number, maxY: number, w: number, h: number, margin = 24): void {
    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    this.scale = Math.max(0.05, Math.min((w - 2 * margin) / bw, (h - 2 * margin) / bh));
    this.offsetX = (w - bw * this.scale) / 2 - minX * this.scale;
    this.offsetY = (h - bh * this.scale) / 2 - minY * this.scale;
  }

  /** Zooms by `factor` keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const next = Math.min(400, Math.max(0.05, this.scale * factor));
    const f = next / this.scale;
    this.offsetX = sx - (sx - this.offsetX) * f;
    this.offsetY = sy - (sy - this.offsetY) * f;
    this.scale = next;
  }

  pan(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
  }
}
