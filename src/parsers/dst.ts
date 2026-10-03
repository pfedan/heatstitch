import { COLOR_CHANGE, JUMP, PatternBuilder, STITCH, TRIM, type Pattern } from '../model/pattern';
import { defaultColor } from './pecPalette';

export const DST_HEADER_SIZE = 512;
/** A run of at least this many consecutive jumps is interpreted as a trim (same default as pyembroidery). */
export const DST_TRIM_JUMP_COUNT = 3;

const bit = (b: number, n: number): number => (b >> n) & 1;

export function decodeDx(b0: number, b1: number, b2: number): number {
  return (
    bit(b2, 2) * 81 - bit(b2, 3) * 81 +
    bit(b1, 2) * 27 - bit(b1, 3) * 27 +
    bit(b0, 2) * 9 - bit(b0, 3) * 9 +
    bit(b1, 0) * 3 - bit(b1, 1) * 3 +
    bit(b0, 0) * 1 - bit(b0, 1) * 1
  );
}

/** Returns dy in DST orientation (y up). */
export function decodeDy(b0: number, b1: number, b2: number): number {
  return (
    bit(b2, 5) * 81 - bit(b2, 4) * 81 +
    bit(b1, 5) * 27 - bit(b1, 4) * 27 +
    bit(b0, 5) * 9 - bit(b0, 4) * 9 +
    bit(b1, 7) * 3 - bit(b1, 6) * 3 +
    bit(b0, 7) * 1 - bit(b0, 6) * 1
  );
}

function readLabel(data: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(data.subarray(0, Math.min(DST_HEADER_SIZE, data.length)));
  const m = /LA:([^\r\n\x1a]*)/.exec(head);
  return m ? m[1].trim() : '';
}

export function parseDst(data: Uint8Array, fileName = ''): Pattern {
  if (data.length < DST_HEADER_SIZE) throw new Error('DST: file too short');
  const b = new PatternBuilder();
  let jumpRun = 0;
  let jumpRunStart = -1;
  let blocks = 1;
  let sequinMode = false;

  // Trims are inferred afterwards: we remember where each jump run started.
  const trimAt: number[] = [];
  const closeJumpRun = () => {
    if (jumpRun >= DST_TRIM_JUMP_COUNT) trimAt.push(jumpRunStart);
    jumpRun = 0;
  };

  for (let i = DST_HEADER_SIZE; i + 2 < data.length; i += 3) {
    const b0 = data[i];
    const b1 = data[i + 1];
    const b2 = data[i + 2];
    const dx = decodeDx(b0, b1, b2);
    const dy = -decodeDy(b0, b1, b2);
    if ((b2 & 0xf3) === 0xf3) break;
    if ((b2 & 0xc3) === 0xc3) {
      closeJumpRun();
      b.mark(COLOR_CHANGE);
      if (dx || dy) b.add(dx, dy, JUMP);
      blocks++;
    } else if ((b2 & 0x43) === 0x43) {
      // Sequin mode toggle; does not move.
      sequinMode = !sequinMode;
    } else if ((b2 & 0x83) === 0x83) {
      if (jumpRun === 0) jumpRunStart = b.length;
      jumpRun++;
      b.add(dx, dy, sequinMode ? STITCH : JUMP);
    } else {
      closeJumpRun();
      b.add(dx, dy, STITCH);
    }
  }
  closeJumpRun();

  const p = b.build(readLabel(data) || fileName, 'dst', []);
  const result = trimAt.length ? insertTrims(p, trimAt) : p;
  result.colors = Array.from({ length: blocks }, (_, k) => defaultColor(k));
  return result;
}

/** Inserts a TRIM record before each given record index. */
function insertTrims(p: Pattern, at: number[]): Pattern {
  const n = p.cmd.length + at.length;
  const x = new Int32Array(n);
  const y = new Int32Array(n);
  const cmd = new Uint8Array(n);
  let k = 0;
  let o = 0;
  for (let i = 0; i < p.cmd.length; i++) {
    if (k < at.length && at[k] === i) {
      x[o] = i > 0 ? p.x[i - 1] : 0;
      y[o] = i > 0 ? p.y[i - 1] : 0;
      cmd[o++] = TRIM;
      k++;
    }
    x[o] = p.x[i];
    y[o] = p.y[i];
    cmd[o++] = p.cmd[i];
  }
  return { ...p, x, y, cmd };
}
