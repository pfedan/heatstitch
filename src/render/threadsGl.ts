import type { Pattern } from '../model/pattern';
import { colorRuns } from './threads';
import type { Viewport } from './viewport';

/**
 * WebGL2 thread renderer for the realistic view. Every stitch is one instanced quad; the fragment shader
 * treats it as a round thread lying on the fabric (a capsule whose ends dive into the needle
 * holes), lights it with a diffuse term and a Kajiya-Kay fiber highlight, and optionally adds
 * the diagonal ridges of a twisted ply. Each stitch is drawn twice in sewing order, first its
 * soft shadow and then the thread, so every stitch darkens what was sewn before it.
 */

const THREAD_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_seg;
layout(location = 2) in vec4 a_color;
uniform float u_scale;
uniform vec2 u_offset;
uniform vec2 u_res;
uniform float u_halfw;
uniform vec2 u_light;
out vec2 v_local;
out float v_len;
out vec4 v_color;
flat out int v_pass;
flat out vec2 v_dir;
void main() {
  int pass = gl_InstanceID % 2;
  vec2 p0 = a_seg.xy * u_scale + u_offset;
  vec2 p1 = a_seg.zw * u_scale + u_offset;
  vec2 d = p1 - p0;
  float len = length(d);
  vec2 u = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-u.y, u.x);
  float hw = u_halfw;
  // The shadow is wider and falls away from the light; both quads get a pixel of room for AA.
  float pad = pass == 0 ? hw * 1.8 + 1.5 : hw + 1.5;
  vec2 shift = pass == 0 ? -u_light * hw * 0.55 : vec2(0.0);
  float along = mix(-pad, len + pad, a_corner.x);
  float across = a_corner.y * pad;
  vec2 pos = p0 + u * along + n * across + shift;
  v_local = vec2(along, across);
  v_len = len;
  v_color = a_color;
  v_pass = pass;
  v_dir = u;
  vec2 clip = pos / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const THREAD_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in float v_len;
in vec4 v_color;
flat in int v_pass;
flat in vec2 v_dir;
uniform float u_halfw;
// Below half a pixel the thread stays one pixel wide and fades instead, so thin threads still read as thin.
uniform float u_thin;
uniform vec2 u_light;
out vec4 o;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

void main() {
  float hw = u_halfw;
  float t = v_local.x;
  float a = v_local.y;
  if (v_pass == 0) {
    float dt = t - clamp(t, 0.0, v_len);
    float d = length(vec2(dt, a));
    float s = 1.0 - smoothstep(hw * 0.3, hw * 1.7, d);
    float alpha = 0.42 * s * s * u_thin;
    o = vec4(0.0, 0.0, 0.0, alpha);
    return;
  }

  // Capsule around the stitch, pulled in at both ends so the needle holes stay open.
  float inset = min(hw * 0.35, v_len * 0.3);
  float tc = clamp(t, inset, max(inset, v_len - inset));
  vec2 q = vec2(t - tc, a);
  float d = length(q);
  float aa = 0.75;
  float cover = 1.0 - smoothstep(hw - aa, hw + aa, d);
  if (cover <= 0.0) discard;

  // Normal of the round thread in screen space (x right, y down, z towards the viewer).
  vec2 qn = q / hw;
  float r2 = min(dot(qn, qn), 0.98);
  vec2 u = v_dir;
  vec2 n = vec2(-u.y, u.x);
  vec3 N = normalize(vec3(u * qn.x + n * qn.y, sqrt(1.0 - r2)));

  // Twisted ply: ridges running diagonally across the thread, as on a real two ply thread.
  float seed = v_color.a;
  float pitch = hw * 2.0;
  float twistVis = smoothstep(4.0, 9.0, pitch);
  float phase = (t + a * 0.9) / pitch * 6.2831853 + seed * 40.0;
  float ridge = sin(phase);
  float groove = 1.0 - twistVis * 0.28 * (0.5 - 0.5 * cos(phase)) * (1.0 - r2 * 0.5);
  vec3 bump = vec3(u * cos(phase) * 0.45 * twistVis, 0.0);
  N = normalize(N + bump * N.z);

  // Fibers follow the ply, tilted against the stitch direction.
  float tilt = mix(0.0, 0.62, twistVis);
  vec2 fiber2 = u * cos(tilt) - n * sin(tilt);
  vec3 T = normalize(vec3(fiber2, 0.0) - N * dot(vec3(fiber2, 0.0), N));

  vec3 L = normalize(vec3(u_light, 0.85));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);

  vec3 base = toLinear(v_color.rgb) * (0.94 + 0.12 * fract(seed * 13.7));
  float ndl = max(dot(N, L), 0.0);
  // Edges roll into the fabric and the neighbours, so they get less ambient light.
  float occl = mix(0.35, 1.0, smoothstep(0.0, 0.75, N.z));
  vec3 col = base * (0.3 * occl + 1.0 * ndl) * groove;

  float th = dot(T, H);
  float sinTH = sqrt(max(1.0 - th * th, 0.0));
  float spec1 = pow(sinTH, 90.0) * 0.32;
  float spec2 = pow(sinTH, 14.0) * 0.12;
  float specMask = smoothstep(0.0, 0.25, N.z) * groove;
  col += (mix(base, vec3(1.0), 0.6) * spec1 + base * spec2 * 2.0) * specMask;

  // Far out the shading is smaller than a pixel: fade to the plain thread color to avoid shimmer.
  float detail = smoothstep(0.8, 2.0, hw);
  col = mix(base * 0.95, col, detail);

  float alpha = cover * u_thin;
  o = vec4(toSrgb(col) * alpha, alpha);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
  return prog;
}

/** Per stitch: x1, y1, x2, y2 (0.1 mm) and r, g, b (0..1), seed, in sewing order. */
export function buildInstances(p: Pattern): { segs: Float32Array; colors: Float32Array; count: number } {
  const runs = colorRuns(p);
  const count = runs.reduce((n, r) => n + r.segs.length / 4, 0);
  const segs = new Float32Array(count * 4);
  const colors = new Float32Array(count * 4);
  let k = 0;
  for (const { color, segs: s } of runs) {
    for (let i = 0; i < s.length; i += 4, k++) {
      segs.set(s.subarray(i, i + 4), k * 4);
      colors[k * 4] = color.r / 255;
      colors[k * 4 + 1] = color.g / 255;
      colors[k * 4 + 2] = color.b / 255;
      // Cheap hash so each stitch gets its own twist phase and a slight brightness change.
      colors[k * 4 + 3] = ((k * 2654435761) >>> 0) / 4294967296;
    }
  }
  return { segs, colors, count };
}

export class GlThreadRenderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private segBuf: WebGLBuffer;
  private colBuf: WebGLBuffer;
  private u: Record<string, WebGLUniformLocation | null>;
  private count = 0;
  private pattern: Pattern | null = null;

  /** Throws when WebGL2 is not available. */
  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    const prog = (this.prog = compile(gl, THREAD_VS, THREAD_FS));
    this.u = Object.fromEntries(
      ['u_scale', 'u_offset', 'u_res', 'u_halfw', 'u_thin', 'u_light'].map((n) => [n, gl.getUniformLocation(prog, n)]),
    );

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.segBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    // Two instances (shadow, thread) per stitch share one record.
    gl.vertexAttribDivisor(1, 2);
    this.colBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 2);
    gl.bindVertexArray(null);
  }

  get lost(): boolean {
    return this.gl.isContextLost();
  }

  private setPattern(p: Pattern): void {
    if (this.pattern === p) return;
    this.pattern = p;
    const { segs, colors, count } = buildInstances(p);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf);
    gl.bufferData(gl.ARRAY_BUFFER, segs, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    this.count = count;
  }

  /**
   * Draws `p` onto a transparent canvas of w x h device pixels. `vp` is in CSS pixels and
   * `dpr` maps them to device pixels; `threadMm` is the visual thread width.
   */
  draw(p: Pattern, vp: Viewport, dpr: number, w: number, h: number, threadMm: number): void {
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.setPattern(p);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.count) return;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.uniform1f(this.u.u_scale, (vp.scale / 10) * dpr);
    gl.uniform2f(this.u.u_offset, vp.offsetX * dpr, vp.offsetY * dpr);
    gl.uniform2f(this.u.u_res, w, h);
    const hw = (threadMm * vp.scale * dpr) / 2;
    gl.uniform1f(this.u.u_halfw, Math.max(0.5, hw));
    gl.uniform1f(this.u.u_thin, Math.min(1, hw / 0.5));
    gl.uniform2f(this.u.u_light, -0.55, -0.65);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count * 2);
    gl.bindVertexArray(null);
  }
}
