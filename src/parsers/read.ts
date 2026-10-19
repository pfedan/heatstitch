import { core } from '../wasm/core';
import { computeBounds, type FileFormat, type Pattern, type ThreadColor } from '../model/pattern';

type ReadDesign = ReturnType<ReturnType<typeof core>['readDesign']>;

/** The Pattern of a design the core read (core/src/parsers): records, colors, name, format, hoop. */
function toPattern(d: ReadDesign): Pattern {
  try {
    const x = d.x;
    const y = d.y;
    const cmd = d.cmd;
    const hoop = d.hoop as { w: number; h: number } | undefined;
    const p: Pattern = { name: d.name, format: d.format as FileFormat, x, y, cmd, colors: d.colors as ThreadColor[], bounds: computeBounds(x, y, cmd) };
    if (hoop) p.hoop = hoop;
    return p;
  } finally {
    d.free();
  }
}

/** Reads an embroidery file by its signature, or else by the extension of `fileName`. */
export const readDesign = (data: Uint8Array, fileName: string): Pattern => toPattern(core().readDesign(data, fileName));

/** Reads `data` as `format`; `name` is used when the file names no design. */
export const readFormat = (format: FileFormat, data: Uint8Array, name: string): Pattern => toPattern(core().readFormat(format, data, name));
