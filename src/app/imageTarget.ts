import type { Mode } from '../settings';

/** An SVG by its type or name. */
export const isSvgFile = (f: { type: string; name: string }) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name);

/**
 * Where an opened picture goes: into the assistant ("Bild umwandeln") while it is open, like a
 * photo always does, so a dropped SVG stays in its steps. Elsewhere an SVG of shapes opens
 * straight as a design (`digitize`), a photo in the assistant.
 */
export function imageTarget(file: { type: string; name: string }, mode: Mode): 'assistant' | 'digitize' {
  return mode !== 'image' && isSvgFile(file) ? 'digitize' : 'assistant';
}
