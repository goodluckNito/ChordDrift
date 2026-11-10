/**
 * Ink in water on the GPU: the same music-to-fluid mapping as fluid-ink.ts (nozzles along the
 * bottom placed by pitch, held notes pouring ink coloured by note, kicks pushing, snares spinning
 * whirlpools), solved with a WebGL2 stable-fluids pipeline: velocity on a coarse grid, ink on a fine
 * one, advected, kept curling by vorticity confinement and made divergence-free by a Jacobi
 * pressure solve. The ink is shaded with a soft light from its own thickness, so it reads glossy.
 *
 * It steps at a fixed rate from the start of the piece (a frame depends only on its time), keeps a
 * few snapshots for jumping back, and draws in screen space (zoom doesn't apply to it). Returns
 * false when WebGL2 float rendering isn't available, so the caller can use the CPU version.
 */
import { drumHits, levelAt, pitchAt } from '../engine/motion';
import type { Score } from '../engine/score';
import { noteInk } from './fluid-ink';
import { skyRange, type ViewArea, type ViewStyle } from './harmony-views';

const DT = 1 / 60;
const MAX_POINTS = 24;
const SNAP_EVERY = 6; // seconds
const MAX_SNAPS = 8;

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}
interface Double {
  read: Target;
  write: Target;
  swap(): void;
}
interface Programs {
  splat: WebGLProgram;
  advect: WebGLProgram;
  divergence: WebGLProgram;
  curl: WebGLProgram;
  vorticity: WebGLProgram;
  pressure: WebGLProgram;
  gradient: WebGLProgram;
  scale: WebGLProgram;
  copy: WebGLProgram;
  display: WebGLProgram;
}
interface GLState {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  gl: WebGL2RenderingContext;
  progs: Programs;
  quad: WebGLBuffer;
  /** Per-score simulation. */
  score: Score | null;
  key: string;
  vel: Double;
  dye: Double;
  pressure: Double;
  div: Target;
  curlT: Target;
  step: number;
  snaps: { step: number; vel: Target; dye: Target }[];
}
let glState: GLState | null | undefined;

const VERT = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() { uv = pos * 0.5 + 0.5; gl_Position = vec4(pos, 0.0, 1.0); }`;

const FRAG: Record<keyof Programs, string> = {
  // Adds up to MAX_POINTS soft discs: rgb = value to add (velocity in .xy, or ink colour), w = radius.
  splat: `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D src; uniform float aspect; uniform int n;
uniform vec2 pts[${MAX_POINTS}]; uniform vec4 vals[${MAX_POINTS}];
void main() {
  vec4 c = texture(src, uv);
  for (int i = 0; i < ${MAX_POINTS}; i++) {
    if (i >= n) break;
    vec2 d = uv - pts[i]; d.x *= aspect;
    c.rgb += vals[i].rgb * exp(-dot(d, d) / vals[i].w);
  }
  o = c;
}`,
  advect: `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D vel; uniform sampler2D src; uniform vec2 texel; uniform vec2 velTexel; uniform float dt; uniform float decay; uniform float walls;
void main() {
  vec2 p = clamp(uv - dt * texture(vel, uv).xy * velTexel, texel * 0.5, 1.0 - texel * 0.5);
  vec4 c = texture(src, p) * decay;
  if (walls > 0.5) {
    // Velocity: solid walls (nothing flows out through the frame's edges).
    if (uv.x < texel.x * 1.5) c.x = max(c.x, 0.0);
    if (uv.x > 1.0 - texel.x * 1.5) c.x = min(c.x, 0.0);
    if (uv.y < texel.y * 1.5) c.y = max(c.y, 0.0);
    if (uv.y > 1.0 - texel.y * 1.5) c.y = min(c.y, 0.0);
  }
  o = c;
}`,
  divergence: `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D vel; uniform vec2 texel;
void main() {
  float l = texture(vel, uv - vec2(texel.x, 0.0)).x;
  float r = texture(vel, uv + vec2(texel.x, 0.0)).x;
  float b = texture(vel, uv - vec2(0.0, texel.y)).y;
  float t = texture(vel, uv + vec2(0.0, texel.y)).y;
  vec2 c = texture(vel, uv).xy;
  if (uv.x - texel.x < 0.0) l = -c.x;
  if (uv.x + texel.x > 1.0) r = -c.x;
  if (uv.y - texel.y < 0.0) b = -c.y;
  if (uv.y + texel.y > 1.0) t = -c.y;
  o = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
}`,
  curl: `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D vel; uniform vec2 texel;
void main() {
  float l = texture(vel, uv - vec2(texel.x, 0.0)).y;
  float r = texture(vel, uv + vec2(texel.x, 0.0)).y;
  float b = texture(vel, uv - vec2(0.0, texel.y)).x;
  float t = texture(vel, uv + vec2(0.0, texel.y)).x;
  o = vec4(0.5 * (r - l - t + b), 0.0, 0.0, 1.0);
}`,
  vorticity: `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D vel; uniform sampler2D curl; uniform vec2 texel; uniform float strength; uniform float dt;
void main() {
  float l = texture(curl, uv - vec2(texel.x, 0.0)).x;
  float r = texture(curl, uv + vec2(texel.x, 0.0)).x;
  float b = texture(curl, uv - vec2(0.0, texel.y)).x;
  float t = texture(curl, uv + vec2(0.0, texel.y)).x;
  float c = texture(curl, uv).x;
  vec2 f = 0.5 * vec2(abs(t) - abs(b), abs(r) - abs(l));
  f /= length(f) + 1e-4;
  f *= strength * c;
  f.y *= -1.0;
  vec2 v = texture(vel, uv).xy + f * dt;
  o = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
}`,
  pressure: `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D pressure; uniform sampler2D div; uniform vec2 texel;
void main() {
  float l = texture(pressure, uv - vec2(texel.x, 0.0)).x;
  float r = texture(pressure, uv + vec2(texel.x, 0.0)).x;
  float b = texture(pressure, uv - vec2(0.0, texel.y)).x;
  float t = texture(pressure, uv + vec2(0.0, texel.y)).x;
  o = vec4((l + r + b + t - texture(div, uv).x) * 0.25, 0.0, 0.0, 1.0);
}`,
  gradient: `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D pressure; uniform sampler2D vel; uniform vec2 texel;
void main() {
  float l = texture(pressure, uv - vec2(texel.x, 0.0)).x;
  float r = texture(pressure, uv + vec2(texel.x, 0.0)).x;
  float b = texture(pressure, uv - vec2(0.0, texel.y)).x;
  float t = texture(pressure, uv + vec2(0.0, texel.y)).x;
  vec2 v = texture(vel, uv).xy - vec2(r - l, t - b);
  if (uv.x < texel.x * 1.5) v.x = max(v.x, 0.0);
  if (uv.x > 1.0 - texel.x * 1.5) v.x = min(v.x, 0.0);
  if (uv.y < texel.y * 1.5) v.y = max(v.y, 0.0);
  if (uv.y > 1.0 - texel.y * 1.5) v.y = min(v.y, 0.0);
  o = vec4(v, 0.0, 1.0);
}`,
  scale: `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D src; uniform float k;
void main() { o = texture(src, uv) * k; }`,
  copy: `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D src;
void main() { o = texture(src, uv); }`,
  // Ink over the water: its own hue where it's thick, with a soft light from its thickness.
  display: `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D dye; uniform vec2 texel; uniform vec3 bg;
void main() {
  vec3 c = texture(dye, uv).rgb;
  float amt = c.r + c.g + c.b;
  // The thinnest wisps fade right back to clear water instead of tinting everything.
  float cover = 1.0 - exp(-max(0.0, amt - 0.008) * 1.5);
  float mx = max(max(c.r, c.g), c.b);
  vec3 hue = mx > 1e-4 ? c / mx * 0.94 : vec3(0.0);
  // Thickness as a height: light from the upper left, so folds and filaments catch the light.
  float hl = dot(texture(dye, uv - vec2(texel.x, 0.0)).rgb, vec3(1.0));
  float hr = dot(texture(dye, uv + vec2(texel.x, 0.0)).rgb, vec3(1.0));
  float hb = dot(texture(dye, uv - vec2(0.0, texel.y)).rgb, vec3(1.0));
  float ht = dot(texture(dye, uv + vec2(0.0, texel.y)).rgb, vec3(1.0));
  vec3 nrm = normalize(vec3(hl - hr, hb - ht, 0.9));
  float light = clamp(dot(nrm, normalize(vec3(-0.5, 0.6, 0.65))), 0.0, 1.0);
  vec3 ink = hue * (0.8 + 0.25 * light) + pow(light, 24.0) * 0.22 * cover;
  o = vec4(mix(bg, ink, cover), 1.0);
}`,
};

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

function initGL(): GLState | null {
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(16, 16) : Object.assign(document.createElement('canvas'), { width: 16, height: 16 });
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const progs = {} as Programs;
    for (const k of Object.keys(FRAG) as (keyof Programs)[]) {
      const p = gl.createProgram()!;
      gl.attachShader(p, vs);
      gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAG[k]));
      gl.bindAttribLocation(p, 0, 'pos');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
      progs[k] = p;
    }
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    return { canvas, gl, progs, quad, score: null, key: '', vel: null!, dye: null!, pressure: null!, div: null!, curlT: null!, step: 0, snaps: [] };
  } catch {
    return null;
  }
}

function target(gl: WebGL2RenderingContext, w: number, h: number, filter: number): Target {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { tex, fbo, w, h };
}
function double(gl: WebGL2RenderingContext, w: number, h: number, filter: number): Double {
  const d = { read: target(gl, w, h, filter), write: target(gl, w, h, filter), swap() {
    const t = d.read;
    d.read = d.write;
    d.write = t;
  } };
  return d;
}
function free(gl: WebGL2RenderingContext, t: Target) {
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
}

/** Run a program into a target with some textures and uniforms. */
/** Uniform locations, looked up once per program (the lookups are slow, on phones especially). */
const locations = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
function loc(gl: WebGL2RenderingContext, prog: WebGLProgram, name: string): WebGLUniformLocation | null {
  let m = locations.get(prog);
  if (!m) locations.set(prog, (m = new Map()));
  if (!m.has(name)) m.set(name, gl.getUniformLocation(prog, name));
  return m.get(name)!;
}

function pass(S: GLState, prog: WebGLProgram, out: Target | null, tex: Record<string, Target>, uni: Record<string, number | number[]>) {
  const gl = S.gl;
  gl.useProgram(prog);
  let unit = 0;
  for (const name in tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex[name].tex);
    gl.uniform1i(loc(gl, prog, name), unit++);
  }
  for (const name in uni) {
    const v = uni[name];
    const loc2 = loc(gl, prog, name);
    if (!loc2) continue;
    if (typeof v === 'number') gl.uniform1f(loc2, v);
    else if (v.length === 2) gl.uniform2f(loc2, v[0], v[1]);
    else gl.uniform3f(loc2, v[0], v[1], v[2]);
  }
  if (out) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.viewport(0, 0, out.w, out.h);
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

const ptsBuf = new Float32Array(MAX_POINTS * 2);
const valsBuf = new Float32Array(MAX_POINTS * 4);
/** Add discs to a field: pts in uv, vals = [r, g, b, radius²]. */
function splats(S: GLState, d: Double, pts: number[][], vals: number[][], aspect: number) {
  const gl = S.gl;
  const prog = S.progs.splat;
  for (let i = 0; i < pts.length; i += MAX_POINTS) {
    const n = Math.min(MAX_POINTS, pts.length - i);
    for (let k = 0; k < n; k++) {
      ptsBuf[k * 2] = pts[i + k][0];
      ptsBuf[k * 2 + 1] = pts[i + k][1];
      for (let c = 0; c < 4; c++) valsBuf[k * 4 + c] = vals[i + k][c];
    }
    gl.useProgram(prog);
    gl.uniform1i(loc(gl, prog, 'n'), n);
    gl.uniform2fv(loc(gl, prog, 'pts'), ptsBuf);
    gl.uniform4fv(loc(gl, prog, 'vals'), valsBuf);
    pass(S, prog, d.write, { src: d.read }, { aspect });
    d.swap();
  }
}

function stepSim(S: GLState, score: Score, time: number) {
  const V = score.config.voices;
  const { lo, span } = skyRange(score);
  const aspect = S.vel.read.w / S.vel.read.h;
  const vPts: number[][] = [];
  const vVals: number[][] = [];
  const dPts: number[][] = [];
  const dVals: number[][] = [];
  // Nozzles along the bottom (uv y = 0 is the bottom here): held notes keep pouring.
  for (let v = 0; v < V; v++) {
    const level = levelAt(score, v, time);
    if (level < 0.03) continue;
    const p = pitchAt(score, v, time);
    // Kept in from the walls: a nozzle right at the edge pours half its ink out of the water.
    const x = 0.1 + 0.8 * Math.max(0, Math.min(1, (p - lo) / span));
    const wob = Math.sin(time * 1.3 + v * 2.1) * 0.25;
    vPts.push([x, 0.05]);
    vVals.push([wob * 24, 150 * level, 0, 0.0009]);
    const col = noteInk(p);
    dPts.push([x, 0.05]);
    // The ink comes out over the same spot as the jet that pushes it, so what flows is what you see.
    dVals.push([col[0] * 0.016 * level, col[1] * 0.016 * level, col[2] * 0.016 * level, 0.0009]);
  }
  for (const h of drumHits(score, time, time + DT)) {
    if (h.voice === 'kick') {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 7) * Math.PI;
        vPts.push([0.5 + Math.cos(ang) * 0.12, 0.06 + Math.sin(ang) * 0.06]);
        vVals.push([Math.cos(ang) * 500 * h.vel, Math.sin(ang) * 500 * h.vel, 0, 0.004]);
      }
    } else if (h.voice === 'snare') {
      const k = Math.round(h.t * 1000);
      const cx = 0.2 + 0.6 * (((k * 2654435761) >>> 0) / 4294967296);
      const cy = 0.3 + 0.4 * ((((k * 40503) >>> 0) % 1000) / 1000);
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        vPts.push([cx + (Math.cos(ang) * 0.05) / aspect, cy + Math.sin(ang) * 0.05]);
        vVals.push([-Math.sin(ang) * 400 * h.vel, Math.cos(ang) * 400 * h.vel, 0, 0.0016]);
      }
    }
  }
  if (vPts.length) splats(S, S.vel, vPts, vVals, aspect);
  if (dPts.length) splats(S, S.dye, dPts, dVals, S.dye.read.w / S.dye.read.h);

  const vt = [1 / S.vel.read.w, 1 / S.vel.read.h];
  pass(S, S.progs.curl, S.curlT, { vel: S.vel.read }, { texel: vt });
  pass(S, S.progs.vorticity, S.vel.write, { vel: S.vel.read, curl: S.curlT }, { texel: vt, strength: 14, dt: DT });
  S.vel.swap();
  pass(S, S.progs.divergence, S.div, { vel: S.vel.read }, { texel: vt });
  pass(S, S.progs.scale, S.pressure.write, { src: S.pressure.read }, { k: 0.8 });
  S.pressure.swap();
  for (let i = 0; i < 16; i++) {
    pass(S, S.progs.pressure, S.pressure.write, { pressure: S.pressure.read, div: S.div }, { texel: vt });
    S.pressure.swap();
  }
  pass(S, S.progs.gradient, S.vel.write, { pressure: S.pressure.read, vel: S.vel.read }, { texel: vt });
  S.vel.swap();
  pass(S, S.progs.advect, S.vel.write, { vel: S.vel.read, src: S.vel.read }, { texel: vt, velTexel: vt, dt: DT, decay: 0.988, walls: 1 });
  S.vel.swap();
  pass(S, S.progs.advect, S.dye.write, { vel: S.vel.read, src: S.dye.read }, { texel: [1 / S.dye.read.w, 1 / S.dye.read.h], dt: DT, decay: Math.exp(-DT / 14), walls: 0, velTexel: vt });
  S.dye.swap();
  S.step++;
}

function hexRgb(c: string): number[] {
  if (!/^#[0-9a-f]{6}$/i.test(c)) return [0.05, 0.05, 0.08];
  const n = parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Draw the GPU ink into ctx; false if WebGL2 float rendering isn't available. */
export function drawInkGL(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, _a: ViewArea, lite = false): boolean {
  if (glState === undefined) glState = initGL();
  const S = glState;
  if (!S) return false;
  const gl = S.gl;
  const Wc = ctx.canvas.width;
  const Hc = ctx.canvas.height;
  const simW = lite ? 96 : 160;
  const dyeW = lite ? 320 : 640;
  const simH = Math.max(32, Math.round((simW * Hc) / Wc));
  const dyeH = Math.max(64, Math.round((dyeW * Hc) / Wc));
  const key = `${simW}x${simH}/${dyeW}x${dyeH}`;
  if (S.score !== score || S.key !== key) {
    if (S.vel) for (const t2 of [S.vel.read, S.vel.write, S.dye.read, S.dye.write, S.pressure.read, S.pressure.write, S.div, S.curlT, ...S.snaps.flatMap((s) => [s.vel, s.dye])]) free(gl, t2);
    S.vel = double(gl, simW, simH, gl.LINEAR);
    S.dye = double(gl, dyeW, dyeH, gl.LINEAR);
    S.pressure = double(gl, simW, simH, gl.NEAREST);
    S.div = target(gl, simW, simH, gl.NEAREST);
    S.curlT = target(gl, simW, simH, gl.NEAREST);
    S.snaps = [];
    S.step = 0;
    S.score = score;
    S.key = key;
  }
  const clearAll = () => {
    for (const t2 of [S.vel.read, S.vel.write, S.dye.read, S.dye.write, S.pressure.read, S.pressure.write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t2.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  };
  const target2 = Math.max(0, Math.floor(t / DT));
  if (target2 < S.step) {
    const snap = [...S.snaps].reverse().find((x) => x.step <= target2);
    if (snap) {
      pass(S, S.progs.copy, S.vel.read, { src: snap.vel }, {});
      pass(S, S.progs.copy, S.dye.read, { src: snap.dye }, {});
      S.step = snap.step;
    } else {
      clearAll();
      S.step = 0;
    }
  }
  const limit = S.step + 1200;
  while (S.step < target2 && S.step < limit) {
    stepSim(S, score, S.step * DT);
    if (S.step % Math.round(SNAP_EVERY / DT) === 0 && !S.snaps.some((x) => x.step === S.step)) {
      let snap = S.snaps.length >= MAX_SNAPS ? S.snaps.splice(1, 1)[0] : null;
      if (!snap) snap = { step: 0, vel: target(gl, simW, simH, gl.LINEAR), dye: target(gl, dyeW, dyeH, gl.LINEAR) };
      pass(S, S.progs.copy, snap.vel, { src: S.vel.read }, {});
      pass(S, S.progs.copy, snap.dye, { src: S.dye.read }, {});
      snap.step = S.step;
      S.snaps.push(snap);
    }
  }
  // Display at (up to) the frame's size, then onto the frame in screen space.
  const outW = Math.min(Wc, lite ? 720 : 1440);
  const outH = Math.round((outW * Hc) / Wc);
  if (S.canvas.width !== outW || S.canvas.height !== outH) {
    S.canvas.width = outW;
    S.canvas.height = outH;
  }
  pass(S, S.progs.display, null, { dye: S.dye.read }, { texel: [1 / dyeW, 1 / dyeH], bg: hexRgb(st.background) });
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(S.canvas as CanvasImageSource, 0, 0, Wc, Hc);
  ctx.restore();
  return true;
}
