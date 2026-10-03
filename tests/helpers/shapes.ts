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

  /** Satin column along x: zigzag between y0 and y0 + width, `spacing` mm between stitches. */
  satin(x0: number, y0: number, length: number, width: number, spacing: number): this {
    this.trim().jump(x0, y0).to(x0, y0);
    const n = Math.round(length / spacing);
    for (let i = 1; i <= n; i++) this.to(x0 + i * spacing, i % 2 ? y0 + width : y0);
    return this;
  }

  build(): Pattern {
    return this.b.build('shape', 'dst', [{ r: 0, g: 0, b: 0 }]);
  }
}
