/** Growable little-endian byte buffer for the writers. */
export class ByteWriter {
  private buf = new Uint8Array(4096);
  length = 0;

  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.length++] = v & 0xff;
  }

  bytes(values: ArrayLike<number>): void {
    this.ensure(values.length);
    for (let i = 0; i < values.length; i++) this.buf[this.length++] = values[i] & 0xff;
  }

  fill(v: number, count: number): void {
    for (let i = 0; i < count; i++) this.u8(v);
  }

  u16(v: number): void {
    this.u8(v);
    this.u8(v >> 8);
  }

  u24(v: number): void {
    this.u16(v);
    this.u8(v >> 16);
  }

  u32(v: number): void {
    this.u16(v);
    this.u16(v >>> 16);
  }

  f32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    this.bytes(b);
  }

  /** Writes a string as single bytes; characters outside printable ASCII become '_'. */
  ascii(s: string): void {
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      this.u8(ch.length === 1 && c >= 0x20 && c < 0x7f ? c : c === 0x0d || c === 0x1a ? c : 0x5f);
    }
  }

  /** Overwrites `count` bytes (little endian) at `at`. */
  patch(at: number, v: number, count: 2 | 3 | 4): void {
    for (let k = 0; k < count; k++) this.buf[at + k] = (v >>> (8 * k)) & 0xff;
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/**
 * Splits a move into the fewest equal-ish pieces whose components stay within ±max.
 * Always returns at least one piece (a zero move stays one zero piece).
 */
export function splitMove(dx: number, dy: number, max: number): [number, number][] {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / max));
  const out: [number, number][] = [];
  let px = 0;
  let py = 0;
  for (let k = 1; k <= n; k++) {
    const x = Math.round((dx * k) / n);
    const y = Math.round((dy * k) / n);
    out.push([x - px, y - py]);
    px = x;
    py = y;
  }
  return out;
}

/** Design name usable in a header label: printable ASCII, at most `max` characters. */
export function headerLabel(name: string, max: number): string {
  return (name || 'heatstitch')
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .slice(0, max);
}
