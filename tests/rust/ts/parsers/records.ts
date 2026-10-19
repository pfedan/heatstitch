import { computeBounds, type FileFormat, type Pattern, type ThreadColor } from '../../../../src/model/pattern';

/**
 * heatstitch's own container for the records of a design, without loss: exact thread colors with
 * brand and catalog number, every record as it is. Designs made in the app (from a picture, an SVG,
 * the motif library) are kept in it, in the browser and in project files; an embroidery format
 * would round their colors to its palette and change their records (see digitizedFile). It is never
 * offered as a file to save.
 *
 * Layout, little-endian: the magic, the length of a JSON header and the header (format, colors,
 * hoop), the number of records n, then n x (int32), n y (int32) and n commands (uint8).
 */
const MAGIC = [0x48, 0x53, 0x52, 0x45, 0x43, 0x00, 0x00, 0x01]; // "HSREC\0\0\1"

interface Header {
  format: FileFormat;
  colors: ThreadColor[];
  hoop?: { w: number; h: number };
}

export const isRecords = (data: Uint8Array): boolean => data.length >= MAGIC.length && MAGIC.every((b, i) => data[i] === b);

export function encodeRecords(p: Pattern): Uint8Array {
  const header: Header = { format: p.format, colors: p.colors, ...(p.hoop ? { hoop: p.hoop } : {}) };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const n = p.cmd.length;
  const out = new Uint8Array(MAGIC.length + 4 + json.length + 4 + n * 9);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  let at = MAGIC.length;
  view.setUint32(at, json.length, true);
  out.set(json, (at += 4));
  view.setUint32((at += json.length), n, true);
  at += 4;
  for (let i = 0; i < n; i++, at += 4) view.setInt32(at, p.x[i], true);
  for (let i = 0; i < n; i++, at += 4) view.setInt32(at, p.y[i], true);
  out.set(p.cmd, at);
  return out;
}

export function parseRecords(data: Uint8Array, name: string): Pattern {
  const fail = () => new Error('Damaged heatstitch records');
  if (!isRecords(data)) throw fail();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = MAGIC.length;
  if (at + 4 > data.length) throw fail();
  const len = view.getUint32(at, true);
  at += 4;
  if (at + len + 4 > data.length) throw fail();
  const header = JSON.parse(new TextDecoder().decode(data.subarray(at, at + len))) as Partial<Header>;
  at += len;
  const n = view.getUint32(at, true);
  at += 4;
  if (at + n * 9 !== data.length || !Array.isArray(header.colors) || typeof header.format !== 'string') throw fail();
  const x = new Int32Array(n);
  const y = new Int32Array(n);
  for (let i = 0; i < n; i++, at += 4) x[i] = view.getInt32(at, true);
  for (let i = 0; i < n; i++, at += 4) y[i] = view.getInt32(at, true);
  const cmd = data.slice(at, at + n);
  if (cmd.some((c) => c > 4)) throw fail();
  return { name, format: header.format, x, y, cmd, colors: header.colors, bounds: computeBounds(x, y, cmd), ...(header.hoop ? { hoop: header.hoop } : {}) };
}
