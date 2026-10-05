import { LETTERING_DEFAULTS, type Align, type LetterOverride, type Lettering, type LetteringShape } from './layout';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const ALIGNS: Align[] = ['left', 'center', 'right', 'block'];
const SHAPES: LetteringShape[] = ['line', 'arcUp', 'arcDown', 'circle'];

/** A lettering as stored (project file, browser storage), checked; null when malformed. */
export function letteringFrom(v: unknown): Lettering | null {
  const o = v as Partial<Lettering> | null;
  if (!o || typeof o !== 'object') return null;
  if (typeof o.id !== 'string' || typeof o.text !== 'string' || typeof o.font !== 'string') return null;
  if (![o.height, o.x, o.y].every(finite) || !(o.height! > 0)) return null;
  const c = o.color;
  if (!c || ![c.r, c.g, c.b].every(finite)) return null;
  const num = (x: unknown, d: number) => (finite(x) ? x : d);
  const letters: LetterOverride[] = Array.isArray(o.letters)
    ? o.letters.filter((l): l is LetterOverride => !!l && finite(l.at) && typeof l.ch === 'string' && [l.dx, l.dy, l.rot].every(finite)).map((l) => ({ ...l }))
    : [];
  return {
    id: o.id,
    text: o.text,
    font: o.font,
    height: o.height!,
    align: ALIGNS.includes(o.align as Align) ? (o.align as Align) : LETTERING_DEFAULTS.align,
    spacing: num(o.spacing, 0),
    wordSpacing: num(o.wordSpacing, 0),
    lineSpacing: num(o.lineSpacing, 1),
    shape: SHAPES.includes(o.shape as LetteringShape) ? (o.shape as LetteringShape) : 'line',
    radius: num(o.radius, LETTERING_DEFAULTS.radius),
    x: o.x!,
    y: o.y!,
    angle: num(o.angle, 0),
    color: { r: c.r, g: c.g, b: c.b, ...(typeof c.name === 'string' ? { name: c.name } : {}), ...(finite(c.pecIndex) ? { pecIndex: c.pecIndex } : {}) },
    back: o.back !== false,
    density: num(o.density, 1),
    underlay: o.underlay !== false,
    letters,
  };
}
