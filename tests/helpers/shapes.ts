import { JUMP, PatternBuilder, STITCH, TRIM, type Command, type Pattern } from '../../src/model/pattern';

/** Builds synthetic patterns in absolute millimetres (y down). */
export class Shape {
  private b = new PatternBuilder();
  private x = 0;
  private y = 0;

  to(xMm: number, yMm: number, cmd: Command = STITCH): this {
    const X = Math.round(xMm * 10);
    const Y = Math.round(yMm * 10);
    this.b.add(X - this.x, Y - this.y, cmd);
    this.x = X;
    this.y = Y;
    return this;
  }

  jump(xMm: number, yMm: number): this {
    return this.to(xMm, yMm, JUMP);
  }

  trim(): this {
    this.b.mark(TRIM);
    return this;
  }

  /** One fill layer (boustrophedon rows) over a w x h mm rectangle, preceded by trim + jump. */
  fill(x0: number, y0: number, w: number, h: number, dir: 'h' | 'v', spacing = 0.4, stitch = 3.5): this {
    const across = dir === 'h' ? h : w;
    const along = dir === 'h' ? w : h;
    const rows = Math.round(across / spacing);
    const steps = Math.ceil(along / stitch);
    this.trim().jump(x0, y0).to(x0, y0);
    for (let r = 0; r <= rows; r++) {
      const off = r * spacing;
      for (let s = 1; s <= steps; s++) {
        const t = r % 2 === 0 ? s / steps : 1 - s / steps;
        if (dir === 'h') this.to(x0 + t * along, y0 + off);
        else this.to(x0 + off, y0 + t * along);
      }
      if (r < rows) {
        const next = (r + 1) * spacing;
        const end = r % 2 === 0 ? along : 0;
        if (dir === 'h') this.to(x0 + end, y0 + next);
        else this.to(x0 + next, y0 + end);
      }
    }
    return this;
  }

  /**
   * One fill layer over the square centred at (cx, cy) with half size `half`, rows at `angle`
   * radians. Stitch ends are staggered per row like a tatami fill.
   */
  fillAt(cx: number, cy: number, half: number, angle: number, spacing = 0.4, stitch = 3.5): this {
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const at = (u: number, v: number): [number, number] => [cx + u * ca - v * sa, cy + u * sa + v * ca];
    const rows = Math.round((2 * half) / spacing);
    const steps = Math.ceil((2 * half) / stitch);
    this.trim().jump(...at(-half, -half)).to(...at(-half, -half));
    for (let r = 0; r <= rows; r++) {
      const v = -half + r * spacing;
      for (let k = 0; k <= steps; k++) {
        const t = r % 2 ? 1 - k / steps : k / steps;
        const stagger = k > 0 && k < steps ? ((r % 4) - 1.5) * 0.3 : 0;
        this.to(...at(-half + 2 * half * t + stagger, v));
      }
    }
    return this;
  }

  /**
   * Satin column along x: zigzag between y0 and y0 + width. `spacing` is the distance between
   * penetrations on the same side (the usual digitizing definition), so a satin at 0.4 mm has
   * 2 / 0.4 = 5 mm thread per mm².
   */
  satin(x0: number, y0: number, length: number, width: number, spacing: number): this {
    this.trim().jump(x0, y0).to(x0, y0);
    const step = spacing / 2;
    const n = Math.round(length / step);
    for (let i = 1; i <= n; i++) this.to(x0 + i * step, i % 2 ? y0 + width : y0);
    return this;
  }

  build(): Pattern {
    return this.b.build('shape', 'dst', [{ r: 0, g: 0, b: 0 }]);
  }
}
