import type { FabricId } from '../validation/profiles';
import { lightDir } from './light';
import { compile } from './threadsGl';
import type { Viewport } from './viewport';

/**
 * WebGL2 fabric behind the realistic threads. Nothing is loaded: the fragment shader builds the
 * surface of the material from the world position in mm, so the cloth pans and zooms with the
 * design, stays sharp at any zoom and costs no download. Every material is a height field (yarns
 * crossing over and under, knitted loops, terry loops, brushed fleece, open sheer weave, leather
 * grain) lit with the same light as
 * the threads: a diffuse term, Kajiya-Kay sheen along the fibers and occlusion in the gaps.
 *
 * The shading is divided by that of a flat surface, so on average the cloth keeps the chosen
 * background color. When a yarn gets smaller than a few pixels the relief fades out (no moiré)
 * and only the slow, cloudy unevenness of real cloth is left.
 */

/** A look the shader draws: a ground fabric, or felt (only laid on as appliqué, see model/applique.ts). */
export type FabricLook = FabricId | 'felt';

/** Per material: shader number, yarn pitch in mm (sets when detail fades in) and relief depth. */
const LOOK: Record<FabricLook, { kind: number; pitch: number; relief: number }> = {
  woven: { kind: 0, pitch: 0.26, relief: 1 },
  // Denim and canvas: the twill of the cap with thicker yarns and deeper ribs.
  woven_heavy: { kind: 1, pitch: 0.46, relief: 1.45 },
  cap: { kind: 1, pitch: 0.36, relief: 1.25 },
  knit: { kind: 2, pitch: 0.7, relief: 1 },
  fleece: { kind: 6, pitch: 0.6, relief: 0.8 },
  terry: { kind: 3, pitch: 0.75, relief: 1.2 },
  light: { kind: 4, pitch: 0.13, relief: 0.45 },
  sheer: { kind: 7, pitch: 0.16, relief: 0.55 },
  leather: { kind: 5, pitch: 0.5, relief: 0.7 },
  // Felt: fibers of about a third of a millimetre show, the mat is flat (shallow relief).
  felt: { kind: 8, pitch: 0.3, relief: 0.55 },
};

const VS = `#version 300 es
void main() {
  // One triangle that covers the screen.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_scale;   // device pixels per mm
uniform vec2 u_offset;   // device pixels
uniform vec3 u_color;    // sRGB
uniform vec2 u_light;
uniform int u_kind;
uniform float u_pitch;
uniform float u_relief;
uniform float u_detail;  // 0 far out (only the cloudiness), 1 when the yarns are resolved
uniform int u_ss;        // samples per pixel: 1, or 4 while a yarn spans only a few pixels
out vec4 o;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash22(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y);
}
float noise1(float x) {
  float i = floor(x), f = fract(x);
  return mix(hash1(i), hash1(i + 1.0), f * f * (3.0 - 2.0 * f));
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

// A surface sample: height (in pitch units), fiber direction (zero: no fiber sheen), tint.
struct Surf { float h; vec2 fiber; float tint; };

// Woven cloth: warp yarns run down (y), weft yarns across (x). 'twill' is the length of the
// repeat (3: 2/1 twill with its diagonal ribs, 2: plain weave).
int over(int i, int j, int twill) {
  int k = (i + j) % twill; if (k < 0) k += twill;
  return twill == 2 ? (k == 0 ? 1 : -1) : (k == twill - 1 ? -1 : 1);
}
// Elevation of a yarn at position t along it (cell units): +1 over, -1 under, smooth between crossings.
float elev(int i, float t, int twill, bool warp) {
  float u = t - 0.5;
  float j0 = floor(u);
  int a = int(j0), b = a + 1;
  float s0 = warp ? float(over(i, a, twill)) : float(-over(a, i, twill));
  float s1 = warp ? float(over(i, b, twill)) : float(-over(b, i, twill));
  return mix(s0, s1, smoothstep(0.0, 1.0, u - j0));
}
// Spun yarn: fine fiber streaks at the twist angle of the yarn (along, across in cell units).
float fibers(float along, float across, float seed) {
  float x = along + across * 0.45;
  return noise(vec2(x * 2.2, across * 14.0 + seed * 31.0)) * 0.6 + noise(vec2(x * 5.0, across * 30.0 + seed * 7.0)) * 0.4;
}
Surf weave(vec2 p, float pitch, int twill) {
  // Twill has more warp yarns than weft yarns; plain weave has as many of each.
  vec2 c = p / (twill == 2 ? vec2(pitch) : vec2(pitch, pitch * 1.3));
  // Real cloth is never exactly straight: the yarns wander a little.
  c += vec2(noise(c * vec2(0.05, 0.11)), noise(c * vec2(0.11, 0.05) + 9.0)) * 0.6;
  vec2 cell = floor(c);
  vec2 f = c - cell;
  int i = int(cell.x), j = int(cell.y);
  // Yarns are flattened and packed side by side; their thickness changes from yarn to yarn and
  // along it (slubs).
  float tw = 0.92 + 0.12 * hash1(cell.x) + 0.12 * (noise1(c.y * 0.3 + cell.x * 7.0) - 0.5);
  float tf = 0.9 + 0.12 * hash1(cell.y + 91.0) + 0.12 * (noise1(c.x * 0.3 + cell.y * 5.0) - 0.5);
  float aw = (f.x - 0.5) * 2.0 / tw;
  float af = (f.y - 0.5) * 2.0 / tf;
  float cw = pow(max(0.0, 1.0 - aw * aw), 0.55);
  float cf = pow(max(0.0, 1.0 - af * af), 0.55);
  float sw = fibers(c.y, f.x, cell.x);
  float sf = fibers(c.x, f.y, cell.y + 50.0);
  float hw = elev(i, c.y, twill, true) * (twill == 2 ? 0.2 : 0.3) + cw * 0.42 + (sw - 0.5) * 0.08 * cw;
  // In twill the weft lies deeper, under the dense warp.
  float hf = elev(j, c.x, twill, false) * 0.2 + cf * (twill == 2 ? 0.42 : 0.24) - (twill == 2 ? 0.0 : 0.14) + (sf - 0.5) * 0.08 * cf;
  float k = smoothstep(-0.05, 0.05, hw - hf);
  Surf s;
  s.h = mix(hf, hw, k);
  s.fiber = normalize(mix(vec2(1.0, -0.3), vec2(-0.3, 1.0), k));
  s.tint = mix(hash1(cell.y + 3.0) * 0.5 + sf - 0.75, hash1(cell.x + 41.0) * 0.5 + sw - 0.75, k) * 1.4;
  return s;
}

// Single jersey (t-shirt, polo, sweat): columns of V shaped loops, each leg a round yarn.
float seg(vec2 p, vec2 a, vec2 b, out float t) {
  vec2 pa = p - a, ba = b - a;
  t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t);
}
Surf knit(vec2 p, float pitch) {
  vec2 c = p / vec2(pitch, pitch * 0.72);
  c.x += (noise(c * 0.08) - 0.5) * 0.8;
  vec2 cell = floor(c);
  Surf s; s.h = -0.5; s.fiber = vec2(0.0); s.tint = 0.0;
  for (int dj = -1; dj <= 1; dj++) {
    vec2 cc = cell + vec2(0.0, float(dj));
    vec2 f = c - cc;
    float var = hash2(cc);
    for (int side = 0; side < 2; side++) {
      float sx = side == 0 ? -1.0 : 1.0;
      // A leg: a plump oval leaning out at the top, reaching into the rows above and below.
      vec2 ctr = vec2(0.5 + sx * 0.24, 0.55);
      vec2 ax = normalize(vec2(sx * 0.42, -1.0));
      vec2 d = f - ctr;
      float along = dot(d, ax) / (0.7 + 0.05 * var);
      float across = dot(d, vec2(-ax.y, ax.x)) / 0.27;
      float r2 = along * along + across * across;
      if (r2 >= 1.0) continue;
      float h = sqrt(1.0 - r2) * 0.55 - 0.12 * abs(along);
      float fb = fibers(along * 3.0, across * 0.3, var * 9.0 + float(side));
      h += (fb - 0.5) * 0.08 * (1.0 - r2);
      if (h > s.h) { s.h = h; s.fiber = ax; s.tint = (var - 0.5) * 0.6 + (fb - 0.5); }
    }
  }
  return s;
}

// Terry: a pile of small yarn loops standing up, seen from above as crowded rings.
Surf terry(vec2 p, float pitch) {
  vec2 c = p / pitch;
  vec2 cell = floor(c);
  // Underneath: more of the pile, a dense fuzzy mass in deep shadow.
  float pile = fbm(c * 2.7);
  Surf s; s.h = -0.25 + 0.45 * pile; s.fiber = normalize(vec2(noise(c * 5.0) - 0.5, noise(c * 5.0 + 7.0) - 0.5) + 1e-3); s.tint = pile - 0.7;
  // Loops reach less than half a cell from their middle: the 2 x 2 cells nearest the point do.
  vec2 near = step(0.5, c - cell) * 2.0 - 1.0;
  for (int dy = 0; dy <= 1; dy++) for (int dx = 0; dx <= 1; dx++) {
    vec2 cc = cell + vec2(dx, dy) * near;
    for (int k = 0; k < 5; k++) {
      vec2 rnd = hash22(cc + float(k) * 17.3);
      vec2 ctr = cc + rnd;
      float ang = hash2(cc + float(k) * 5.7) * 3.14159;
      vec2 ax = vec2(cos(ang), sin(ang));
      vec2 d = c - ctr;
      // A loop leaning over: an ellipse, its yarn a thick ring.
      vec2 q = vec2(dot(d, ax), dot(d, vec2(-ax.y, ax.x)) * 1.6);
      float R = 0.24 + 0.08 * rnd.x;
      float ring = abs(length(q) - R) / 0.15;
      if (ring >= 1.0) continue;
      float tq = atan(q.y, q.x);
      float fz = noise(vec2(tq * 3.0, ring * 2.0) + rnd * 40.0);
      float h = sqrt(1.0 - ring * ring) * 0.4 + 0.45 * rnd.y + 0.08 * (fz - 0.5);
      if (h > s.h) {
        s.h = h;
        vec2 t2 = vec2(-sin(tq), cos(tq));
        s.fiber = normalize(ax * t2.x + vec2(-ax.y, ax.x) * t2.y);
        s.tint = (rnd.y - 0.5) * 0.6 + (fz - 0.5);
      }
    }
  }
  return s;
}

// Fleece: brushed pile, the knit underneath hidden by soft tufts of fibers lying every way.
Surf fleece(vec2 p, float pitch) {
  vec2 c = p / pitch;
  float tuft = fbm(c * 0.9);
  float fine = noise(c * 3.1 + 4.0);
  vec2 dir = vec2(noise(c * 0.6) - 0.5, noise(c * 0.6 + 13.0) - 0.5);
  Surf s;
  s.h = 0.55 * tuft + 0.22 * fine + 0.08 * noise(c * 9.0);
  s.fiber = normalize(dir + 1e-3);
  s.tint = (tuft - 0.5) * 0.9 + (fine - 0.5) * 0.3;
  return s;
}

// Sheer (organza, chiffon, tulle): thin smooth filaments in plain weave with open gaps between
// them. The gaps lie deep and get little light, so the cloth reads as thin.
Surf sheer(vec2 p, float pitch) {
  vec2 c = p / pitch;
  c += vec2(noise(c * vec2(0.04, 0.09)), noise(c * vec2(0.09, 0.04) + 9.0)) * 0.4;
  vec2 cell = floor(c);
  vec2 f = c - cell - 0.5;
  // A yarn takes about half of its cell, the rest is open.
  float cw = smoothstep(0.3, 0.16, abs(f.x));
  float cf = smoothstep(0.3, 0.16, abs(f.y));
  float hw = elev(int(cell.x), c.y, 2, true) * 0.15 + cw * 0.5;
  float hf = elev(int(cell.y), c.x, 2, false) * 0.15 + cf * 0.5;
  float k = smoothstep(-0.05, 0.05, hw - hf);
  float yarn = max(cw, cf);
  Surf s;
  s.h = mix(-0.6, mix(hf, hw, k), yarn);
  s.fiber = yarn > 0.0 ? mix(vec2(1.0, 0.0), vec2(0.0, 1.0), k) : vec2(0.0);
  if (s.fiber != vec2(0.0)) s.fiber = normalize(s.fiber);
  s.tint = (hash1(cell.x + 41.0) - 0.5) * 0.3 * yarn;
  return s;
}

// Leather: pebbled grain from a cell pattern, the creases between the pebbles pressed in.
Surf leather(vec2 p, float pitch) {
  vec2 c = p / pitch;
  c += vec2(fbm(c * 0.7), fbm(c * 0.7 + 5.0)) * 0.6;
  vec2 cell = floor(c);
  float f1 = 9.0, f2 = 9.0;
  for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
    vec2 cc = cell + vec2(dx, dy);
    vec2 pt = cc + 0.15 + 0.7 * hash22(cc);
    float d = length(c - pt);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  Surf s;
  float crease = smoothstep(0.0, 0.2, f2 - f1);
  // Pebbles are domed, their size and depth uneven.
  s.h = crease * (0.4 + 0.2 * noise(c * 0.5)) + 0.18 * (1.0 - f1) + 0.12 * fbm(c * 4.0) + 0.05 * noise(c * 14.0);
  s.fiber = vec2(0.0);
  s.tint = (fbm(c * 0.25) - 0.5) * 0.8;
  return s;
}

// Felt: no yarns and no grid, a mat of short fibers pressed together lying every way. Drawn as a
// random fiber network (as non-wovens are modeled: straight fiber segments with random centers and
// angles, a Poisson segment process): per cell three slightly bent fibers, found as in Worley noise
// by searching the 3 x 3 cells around the point, over filtered noise (fbm) for the cloudy density
// of the mat and its fuzz. Filtered noise alone reads as paper or suede; the segments give the
// fine hairs felt shows. The fibers lie low in the mat, so the relief is shallow and the sheen weak.
Surf felt(vec2 p, float pitch) {
  vec2 c = p / pitch;
  float mat = fbm(c * 0.35);
  float fuzz = noise(c * 2.3);
  Surf s;
  s.fiber = vec2(0.0);
  // The fibers add up (a soft web), not the top one alone (which would read as straw).
  float web = 0.0;
  float top = 0.0;
  vec2 cell = floor(c);
  for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
    vec2 cc = cell + vec2(dx, dy);
    for (int k = 0; k < 4; k++) {
      vec2 rnd = hash22(cc + float(k) * 11.7);
      float ang = hash2(cc + float(k) * 3.1) * 3.14159;
      vec2 ax = vec2(cos(ang), sin(ang));
      vec2 d = c - (cc + rnd);
      float along = dot(d, ax);
      float len = 0.7 + 0.6 * rnd.x;
      if (abs(along) >= len) continue;
      // Bent a little, thinner toward its ends.
      float across = dot(d, vec2(-ax.y, ax.x)) + 0.3 * (rnd.y - 0.5) * along * along;
      float r = abs(across) / (0.06 * (1.0 - 0.4 * abs(along) / len));
      if (r >= 1.0) continue;
      float f = (1.0 - r * r) * (0.4 + 0.6 * rnd.y);
      web += f;
      if (f > top) {
        top = f;
        s.fiber = normalize(ax + vec2(-ax.y, ax.x) * 0.6 * (rnd.y - 0.5) * along);
      }
    }
  }
  web = min(web, 1.6);
  s.h = -0.1 + 0.35 * mat + 0.12 * fuzz + 0.16 * web;
  s.tint = (mat - 0.5) * 0.5 + (fuzz - 0.5) * 0.25 + (web - 0.5) * 0.15;
  return s;
}

Surf surf(vec2 p) {
  if (u_kind == 0) return weave(p, u_pitch, 3);
  if (u_kind == 1) return weave(p, u_pitch, 4);
  if (u_kind == 2) return knit(p, u_pitch);
  if (u_kind == 3) return terry(p, u_pitch);
  if (u_kind == 4) return weave(p, u_pitch, 2);
  if (u_kind == 6) return fleece(p, u_pitch);
  if (u_kind == 7) return sheer(p, u_pitch);
  if (u_kind == 8) return felt(p, u_pitch);
  return leather(p, u_pitch);
}

// Light on one point of the surface with normal N.
vec3 shadeAt(Surf s, vec3 N, vec3 base, vec3 L) {
  float flatShade = 0.35 + 0.8 * L.z;
  float shade = (0.35 + 0.8 * max(dot(N, L), 0.0)) / flatShade;
  // Gaps between yarns and under crossings get less light.
  float ao = mix(0.5, 1.08, smoothstep(-0.2, 0.75, s.h));
  // Yarns of a pixel or two: the deep gaps would only read as grain, so they are shallower.
  if (u_ss != 1) ao = mix(1.0, ao, 0.55);
  vec3 lit = base * shade * ao * (1.0 + 0.08 * s.tint);
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  if (s.fiber != vec2(0.0)) {
    vec3 T = normalize(vec3(s.fiber, 0.0) - N * dot(vec3(s.fiber, 0.0), N));
    float th = dot(T, H);
    float sinTH = sqrt(max(1.0 - th * th, 0.0));
    // Spun cotton has a soft, wide sheen; the fine and the sheer fabric shine more, like silk.
    // Felt is matt: its fibers lie every way and scatter the light.
    float gloss = u_kind == 4 || u_kind == 7 ? 0.22 : u_kind == 8 ? 0.012 : 0.07;
    lit += (base * 0.6 + 0.04) * pow(sinTH, 24.0) * gloss * 3.0 * smoothstep(0.0, 0.6, s.h);
  } else {
    // Leather: a broad, slightly glossy highlight on the pebbles.
    lit += (base * 0.3 + 0.05) * pow(max(dot(N, H), 0.0), 22.0) * 0.45 * smoothstep(0.1, 0.5, s.h);
  }
  return lit;
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 p = (screen - u_offset) / u_scale;
  vec3 base = toLinear(u_color);
  // Cloudy unevenness of real cloth (dye and yarn density), visible at every zoom.
  float cloud = (fbm(p * 0.09) - 0.5) * 0.10 + (fbm(p * 0.6 + 3.0) - 0.5) * 0.05;
  vec3 col = base * (1.0 + cloud);
  vec3 L = normalize(vec3(u_light, 0.85));
  if (u_detail > 0.0) {
    float k = u_relief * u_pitch;
    vec3 lit;
    if (u_ss == 1) {
      // Height and slope from three samples, half a pixel apart (but never coarser than a yarn).
      float e = min(0.5 / u_scale, u_pitch * 0.12);
      Surf s0 = surf(p);
      float hx = surf(p + vec2(e, 0.0)).h;
      float hy = surf(p + vec2(0.0, e)).h;
      lit = shadeAt(s0, normalize(vec3(-(hx - s0.h) * k / e, -(hy - s0.h) * k / e, 1.0)), base, L);
    } else {
      // Yarns of one or two pixels: four samples spread over the pixel (rotated grid) are averaged,
      // so the weave still shows as it would to the eye, without moiré. The slope is the plane
      // through the four heights.
      vec2 off[4] = vec2[4](vec2(-0.125, -0.375), vec2(0.375, -0.125), vec2(0.125, 0.375), vec2(-0.375, 0.125));
      Surf ss[4];
      float gx = 0.0, gy = 0.0;
      for (int i = 0; i < 4; i++) {
        ss[i] = surf(p + off[i] / u_scale);
        gx += ss[i].h * off[i].x;
        gy += ss[i].h * off[i].y;
      }
      // Sum of the squared offsets is 0.3125 per axis; the slope is per mm.
      vec3 N = normalize(vec3(-gx / 0.3125 * u_scale * k, -gy / 0.3125 * u_scale * k, 1.0));
      lit = vec3(0.0);
      for (int i = 0; i < 4; i++) lit += shadeAt(ss[i], N, base, L);
      lit *= 0.25;
    }
    col = mix(col, lit * (1.0 + cloud), u_detail);
  }
  o = vec4(toSrgb(col), 1.0);
}`;

const UNIFORMS = ['u_res', 'u_scale', 'u_offset', 'u_color', 'u_light', 'u_kind', 'u_pitch', 'u_relief', 'u_detail', 'u_ss'];

export class GlFabricRenderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private u: Record<string, WebGLUniformLocation | null>;
  /** What the canvas shows now; redraws with nothing changed (a hover, the player) reuse it. */
  private shown = '';

  /** Throws when WebGL2 is not available. */
  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    const prog = (this.prog = compile(gl, VS, FS));
    this.u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(prog, n)]));
    this.vao = gl.createVertexArray()!;
  }

  get lost(): boolean {
    return this.gl.isContextLost();
  }

  /**
   * Draws `fabric` in `rgb` (0..255) over the whole w x h device pixel canvas. `vp` is in CSS
   * pixels and `dpr` maps them to device pixels; `light` is the light of the thread view.
   */
  draw(fabric: FabricLook, rgb: [number, number, number], vp: Pick<Viewport, 'scale' | 'offsetX' | 'offsetY'>, dpr: number, w: number, h: number, light: readonly [number, number]): void {
    const key = [fabric, rgb, vp.scale, vp.offsetX, vp.offsetY, dpr, w, h, light].join();
    if (key === this.shown) return;
    this.shown = key;
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const look = LOOK[fabric];
    const pxMm = vp.scale * dpr;
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.u_res, w, h);
    gl.uniform1f(this.u.u_scale, pxMm);
    gl.uniform2f(this.u.u_offset, vp.offsetX * dpr, vp.offsetY * dpr);
    gl.uniform3f(this.u.u_color, rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    gl.uniform2f(this.u.u_light, light[0], light[1]);
    gl.uniform1i(this.u.u_kind, look.kind);
    gl.uniform1f(this.u.u_pitch, look.pitch);
    const yarnPx = look.pitch * pxMm;
    // Slopes of yarns barely a pixel wide are mostly noise: the relief is flatter there.
    gl.uniform1f(this.u.u_relief, look.relief * (0.4 + 0.6 * smooth((yarnPx - 1.5) / 2.5)));
    gl.uniform1f(this.u.u_detail, fabricDetail(yarnPx));
    gl.uniform1i(this.u.u_ss, yarnPx < 5 ? 4 : 1);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * How much of the yarn structure shows for a yarn pitch of `px` device pixels (0 to 1): fully from
 * 2 px on, so the fabric still reads at real size on screen; below that it fades into the
 * cloudiness, where single yarns would only flicker.
 */
export function fabricDetail(px: number): number {
  return smooth((px - 0.9) / 1.1);
}

let gl: GlFabricRenderer | null = null;
let unavailable = false;

/** "rgb(r, g, b)" or "#rrggbb" as 0..255 values, or null. */
export function parseColor(css: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css);
  if (hex) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)];
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(css);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

/**
 * Covers the canvas with the fabric in the color `background`, in the light of the thread view.
 * Returns false when WebGL2 is not available; the flat color then stays.
 */
export function drawFabric(ctx: CanvasRenderingContext2D, vp: Viewport, fabric: FabricId, background: string): boolean {
  const rgb = parseColor(background);
  if (!rgb || unavailable) return false;
  if (!gl || gl.lost) {
    try {
      gl = new GlFabricRenderer(document.createElement('canvas'));
    } catch {
      unavailable = true;
      gl = null;
      return false;
    }
  }
  const { width: cw, height: ch } = ctx.canvas;
  gl.draw(fabric, rgb, vp, ctx.getTransform().a, cw, ch, lightDir());
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(gl.canvas, 0, 0);
  ctx.restore();
  return true;
}

/** A renderer of its own for appliqué pieces, so the ground keeps its picture (see GlFabricRenderer.shown). */
let pieceGl: GlFabricRenderer | null = null;

/**
 * Draws `fabric` in `rgb` into the CSS pixel box `box` [x0, y0, x1, y1] of the canvas, in the light
 * of the thread view, where the clip set on `ctx` lets it (an appliqué's piece of fabric). Only the
 * box is shaded. Returns false when WebGL2 is not available.
 */
export function drawFabricIn(ctx: CanvasRenderingContext2D, vp: Viewport, fabric: FabricLook, rgb: [number, number, number], box: [number, number, number, number]): boolean {
  if (unavailable) return false;
  if (!pieceGl || pieceGl.lost) {
    try {
      pieceGl = new GlFabricRenderer(document.createElement('canvas'));
    } catch {
      unavailable = true;
      pieceGl = null;
      return false;
    }
  }
  const dpr = ctx.getTransform().a;
  const { width: cw, height: ch } = ctx.canvas;
  const x0 = Math.max(0, Math.floor(box[0] * dpr));
  const y0 = Math.max(0, Math.floor(box[1] * dpr));
  const x1 = Math.min(cw, Math.ceil(box[2] * dpr));
  const y1 = Math.min(ch, Math.ceil(box[3] * dpr));
  if (x1 <= x0 || y1 <= y0) return true;
  // The same world under the box as on the whole canvas: the offset moves with the box.
  pieceGl.draw(fabric, rgb, { scale: vp.scale, offsetX: vp.offsetX - x0 / dpr, offsetY: vp.offsetY - y0 / dpr }, dpr, x1 - x0, y1 - y0, lightDir());
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(pieceGl.canvas, 0, 0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
  return true;
}
