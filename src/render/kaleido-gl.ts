/**
 * The kaleidoscope as a fragment shader: every pixel is folded into the mirror wedge (so the seams
 * are exact) and looks into a chamber of backlit glass. Each voice is a cut gem (facets catching the
 * light, a bright rim, a sparkle) with a glossy bead beside it, in its note's jewel colour, placed
 * by note (angle in the wedge) and register (distance out), sized by level; they blend like light
 * through glass over a liquid backdrop with drifting caustics. Colour fringing at the edges, a soft
 * glow, and a soft vignette; it fills the whole frame. Folds = different notes in the chord (at least three),
 * crossfading as chords change. Kicks flash and breathe it, snares shake the glass, hats sparkle.
 * Returns false without WebGL2 (the caller draws the canvas version).
 */
import { levelAt, pitchAt } from '../engine/motion';
import type { Score } from '../engine/score';
import { mod12 } from '../engine/theory';
import { chordAt, drumPulse, skyRange, type ViewArea, type ViewStyle } from './harmony-views';

const MAXV = 24;

const VERT = `#version 300 es
in vec2 pos; out vec2 uv;
void main() { uv = pos * 0.5 + 0.5; gl_Position = vec4(pos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform float t, spin, foldA, foldB, mixAB, kick, snare, hat, aspect;
uniform int n;
uniform vec4 gem[${MAXV}];   // angle (0..1 of the wedge), radius (0..1), size, hue (0..1)
uniform vec4 gem2[${MAXV}];  // level, seed, -, -
const float PI = 3.14159265;

vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
// Regular polygon distance (k sides), for cut-gem outlines.
float poly(vec2 p, float r, float k) {
  float a = atan(p.y, p.x), s = 2.0 * PI / k;
  return cos(floor(0.5 + a / s) * s - a) * length(p) - r;
}

// The chamber, seen at point p (in units of the scope's radius).
vec3 chamber(vec2 p, float wedge) {
  // Liquid backdrop with drifting caustics.
  float c = noise(p * 6.0 + vec2(t * 0.15, -t * 0.1)) * noise(p * 11.0 - vec2(t * 0.1, t * 0.17));
  vec3 col = vec3(0.025, 0.02, 0.05) + vec3(0.12, 0.08, 0.2) * pow(c, 2.0) * (1.0 + 0.6 * kick);
  vec3 glow = vec3(0.0);
  for (int i = 0; i < ${MAXV}; i++) {
    if (i >= n) break;
    vec4 g = gem[i]; vec4 g2 = gem2[i];
    float shake = snare * 0.03 * sin(t * 70.0 + g2.y * 9.0);
    float a = -0.06 + g.x * (wedge + 0.12) + shake + 0.06 * sin(0.2 * t + g2.y * 4.0);
    vec2 cpos = vec2(cos(a), sin(a)) * (0.08 + 0.84 * g.y);
    vec2 q = p - cpos;
    float rot = g2.y * 6.283 + 0.12 * t;
    q = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * q;
    float sides = 5.0 + floor(g2.y * 3.0);
    float size = g.z;
    float d = poly(q, size, sides);
    vec3 jc = hsv(g.w, 0.85, 1.0);
    // Anti-aliased edge: coverage over about a pixel.
    float aa = fwidth(d) * 1.2 + 1e-5;
    float cover = smoothstep(aa, -aa, d);
    if (cover > 0.0) {
      // Facets: brightness steps round the gem and toward its table; a bright rim; a sparkle.
      float fa = floor((atan(q.y, q.x) + PI) / (2.0 * PI) * sides);
      float facet = 0.55 + 0.45 * fract(sin(fa * 12.9898 + g2.y * 78.233) * 43758.5453);
      float table = smoothstep(size * 0.55, size * 0.35, length(q));
      float rim = smoothstep(-size * 0.12, 0.0, d);
      vec3 gemc = jc * (0.3 + 0.6 * facet) * (0.7 + 0.4 * table) + rim * 0.4;
      float sparkle = pow(max(0.0, sin(fa * 3.0 + t * 2.0 + g2.y * 20.0)), 30.0) * (0.6 + hat);
      gemc += sparkle;
      col = 1.0 - (1.0 - col) * (1.0 - gemc * (0.38 + 0.32 * g2.x) * cover);
    }
    glow += jc * exp(-max(d, 0.0) / (size * 0.35)) * 0.08 * g2.x;
    // A glossy bead beside it.
    vec2 bq = q - vec2(size * 1.25, 0.0);
    float br = size * 0.32;
    float bd = length(bq) - br;
    float baa = fwidth(bd) * 1.2 + 1e-5;
    float bcover = smoothstep(baa, -baa, bd);
    if (bcover > 0.0) {
      vec3 bc = hsv(fract(g.w + 0.08), 0.8, 0.9);
      float spec = pow(max(0.0, 1.0 - length(bq + vec2(br * 0.35, -br * 0.35)) / (br * 0.6)), 3.0);
      col = 1.0 - (1.0 - col) * (1.0 - (bc * (0.5 + 0.5 * smoothstep(br, 0.0, length(bq))) + spec) * bcover);
    }
  }
  return col + glow;
}

// Fold a point into the mirror wedge and look into the chamber.
vec3 scope(vec2 p, float fold) {
  float wedge = PI / fold;
  float r = length(p) / (1.0 + 0.05 * kick);
  // Beyond the chamber's edge the pattern mirrors outward again (as a real kaleidoscope repeats),
  // so it reaches every edge of the frame.
  r = 1.0 - abs(mod(r + 1.0, 2.0) - 1.0);
  float a = atan(p.y, p.x) - spin;
  a = mod(a, 2.0 * wedge);
  if (a > wedge) a = 2.0 * wedge - a;
  return chamber(vec2(cos(a), sin(a)) * r, wedge);
}

vec3 view(vec2 p) {
  vec3 a = scope(p, foldA);
  if (mixAB <= 0.0) return a;
  return mix(a, scope(p, foldB), mixAB);
}

void main() {
  // The whole frame: the mandala reaches its corners (1 = the half-diagonal).
  vec2 p = (uv * 2.0 - 1.0) * vec2(aspect, 1.0) / sqrt(aspect * aspect + 1.0) * 0.9;
  float r = length(p);
  // Colour fringing toward the edge: red and blue looked up slightly in and out.
  float ca = 0.006 * r * r;
  vec3 col;
  col.r = view(p * (1.0 - ca)).r;
  col.g = view(p).g;
  col.b = view(p * (1.0 + ca)).b;
  col += vec3(0.08) * kick;
  // A soft vignette toward the corners.
  col *= 0.6 + 0.4 * smoothstep(1.1, 0.4, r);
  o = vec4(col, 1.0);
}`;

interface KState {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
}
let kState: KState | null | undefined;

function init(): KState | null {
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(16, 16) : Object.assign(document.createElement('canvas'), { width: 16, height: 16 });
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false }) as WebGL2RenderingContext | null;
    if (!gl) return null;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, 'pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const loc: KState['loc'] = {};
    for (const k of ['t', 'spin', 'foldA', 'foldB', 'mixAB', 'kick', 'snare', 'hat', 'aspect', 'n', 'gem', 'gem2']) loc[k] = gl.getUniformLocation(prog, k);
    return { canvas, gl, prog, loc };
  } catch {
    return null;
  }
}

export function drawKaleidoscopeGL(ctx: CanvasRenderingContext2D, score: Score, t: number, _st: ViewStyle, _a: ViewArea, lite = false): boolean {
  if (kState === undefined) kState = init();
  const K = kState;
  if (!K) return false;
  const { gl, loc } = K;
  const drum = drumPulse(score, t);
  const { lo, span } = skyRange(score);
  const now = chordAt(score, t);
  const foldOf = (c: Score['chords'][number] | null) => Math.max(3, Math.min(9, c ? new Set(c.notes.map((x) => mod12(Math.round(x)))).size : 3));
  const V = Math.min(MAXV, score.config.voices);
  const gem = new Float32Array(MAXV * 4);
  const gem2 = new Float32Array(MAXV * 4);
  let n = 0;
  for (let v = 0; v < V; v++) {
    const level = levelAt(score, v, t);
    if (level < 0.03) continue;
    const p = pitchAt(score, v, t);
    const pc = ((p % 12) + 12) % 12;
    gem.set([pc / 12, Math.max(0, Math.min(1, (p - lo) / span)), 0.06 + 0.06 * level, ((mod12(Math.round(p) * 7) * 30 + 15) % 360) / 360], n * 4);
    gem2.set([level, ((v * 0.6180339) % 1) + 0.001 * v, 0, 0], n * 4);
    n++;
  }
  // Render the whole frame (capped), then draw it over the frame in screen space.
  const Wc = ctx.canvas.width;
  const Hc = ctx.canvas.height;
  const pw = Math.max(64, Math.min(lite ? 960 : 1600, Wc));
  const ph = Math.round((pw * Hc) / Wc);
  if (K.canvas.width !== pw || K.canvas.height !== ph) {
    K.canvas.width = pw;
    K.canvas.height = ph;
  }
  gl.viewport(0, 0, pw, ph);
  gl.useProgram(K.prog);
  const fNow = foldOf(now.c);
  const fPrev = foldOf(now.prev);
  const crossing = fPrev !== fNow && now.x < 1;
  gl.uniform1f(loc.t, t);
  gl.uniform1f(loc.spin, 0.035 * t);
  gl.uniform1f(loc.foldA, crossing ? fPrev : fNow);
  gl.uniform1f(loc.foldB, fNow);
  gl.uniform1f(loc.mixAB, crossing ? now.x : 0);
  gl.uniform1f(loc.kick, drum.kick);
  gl.uniform1f(loc.snare, drum.snare);
  gl.uniform1f(loc.hat, drum.hat);
  gl.uniform1f(loc.aspect, pw / ph);
  gl.uniform1i(loc.n, n);
  gl.uniform4fv(loc.gem, gem);
  gl.uniform4fv(loc.gem2, gem2);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(K.canvas as CanvasImageSource, 0, 0, Wc, Hc);
  ctx.restore();
  return true;
}
