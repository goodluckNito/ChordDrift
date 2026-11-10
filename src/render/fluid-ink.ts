/**
 * Ink in water: a small stable-fluids simulation (after Stam) of velocity and coloured dye on a
 * coarse grid. Every voice is a nozzle along the bottom, placed by pitch (low notes on the left,
 * high on the right): while a note sounds it keeps pouring its colour upwards, harder the louder it
 * is, so held notes build up plumes and big chords flood the water; a glide slides the nozzle
 * across. Vorticity confinement keeps the ink curling, and old ink slowly fades. Kicks push the
 * water outward from the bottom; snares spin up a little whirlpool.
 *
 * The simulation steps at a fixed rate from the start of the piece, so a frame depends only on its
 * time; snapshots every few seconds make jumping backwards cheap (it replays from the nearest one).
 */
import { drumHits, levelAt, pitchAt } from '../engine/motion';
import type { Score } from '../engine/score';
import { skyRange, type ViewArea, type ViewStyle } from './harmony-views';

const DT = 1 / 30;
const SNAP_EVERY = 4; // seconds
const MAX_SNAPS = 90;

interface Grid {
  nx: number;
  ny: number;
  u: Float32Array;
  v: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}
interface Sim extends Grid {
  step: number;
  key: string;
  snaps: { step: number; data: Float32Array[] }[];
  // scratch
  u0: Float32Array;
  v0: Float32Array;
  p: Float32Array;
  div: Float32Array;
  tmp: Float32Array;
  curl: Float32Array;
}
const sims = new WeakMap<Score, Sim>();

/** Ink colour for a (possibly gliding) note: hue round the circle of fifths, blending between neighbours. */
function noteInk(p: number): [number, number, number] {
  const r = Math.round(p);
  const pc = ((r % 12) + 12) % 12;
  const h = (((pc * 7) % 12) * 30 + 10) / 360;
  const s = 0.8;
  const l = 0.55;
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function rgbOf(color: string): [number, number, number] {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const n = parseInt(color.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const m = color.match(/hsla?\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%/);
  if (m) {
    const h = Number(m[1]) / 360;
    const s = Number(m[2]) / 100;
    const l = Number(m[3]) / 100;
    const f = (n: number) => {
      const k = (n + h * 12) % 12;
      return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
  }
  const r = color.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (r) return [Number(r[1]) / 255, Number(r[2]) / 255, Number(r[3]) / 255];
  return [0.8, 0.8, 0.8];
}

function makeSim(nx: number, ny: number, key: string): Sim {
  const n = (nx + 2) * (ny + 2);
  const f = () => new Float32Array(n);
  return { nx, ny, u: f(), v: f(), r: f(), g: f(), b: f(), u0: f(), v0: f(), p: f(), div: f(), tmp: f(), curl: f(), step: 0, key, snaps: [] };
}

function bound(s: Sim, kind: 0 | 1 | 2, x: Float32Array) {
  const { nx, ny } = s;
  const W = nx + 2;
  for (let j = 1; j <= ny; j++) {
    x[j * W] = kind === 1 ? -x[j * W + 1] : x[j * W + 1];
    x[j * W + nx + 1] = kind === 1 ? -x[j * W + nx] : x[j * W + nx];
  }
  for (let i = 1; i <= nx; i++) {
    x[i] = kind === 2 ? -x[W + i] : x[W + i];
    x[(ny + 1) * W + i] = kind === 2 ? -x[ny * W + i] : x[ny * W + i];
  }
}

function advect(s: Sim, kind: 0 | 1 | 2, d: Float32Array, d0: Float32Array, u: Float32Array, v: Float32Array) {
  const { nx, ny } = s;
  const W = nx + 2;
  const dt0x = DT * nx;
  const dt0y = DT * nx; // square cells
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx; i++) {
      const k = j * W + i;
      let x = i - dt0x * u[k];
      let y = j - dt0y * v[k];
      x = Math.max(0.5, Math.min(nx + 0.5, x));
      y = Math.max(0.5, Math.min(ny + 0.5, y));
      const i0 = Math.floor(x);
      const j0 = Math.floor(y);
      const s1 = x - i0;
      const t1 = y - j0;
      const a = j0 * W + i0;
      d[k] = (1 - s1) * ((1 - t1) * d0[a] + t1 * d0[a + W]) + s1 * ((1 - t1) * d0[a + 1] + t1 * d0[a + W + 1]);
    }
  }
  bound(s, kind, d);
}

function project(s: Sim) {
  const { nx, ny, u, v, p, div } = s;
  const W = nx + 2;
  const h = 1 / nx;
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx; i++) {
      const k = j * W + i;
      div[k] = -0.5 * h * (u[k + 1] - u[k - 1] + v[k + W] - v[k - W]);
    }
  }
  bound(s, 0, div);
  bound(s, 0, p);
  // Warm-started from the last step's pressure, so a few sweeps are enough.
  for (let it = 0; it < 10; it++) {
    for (let j = 1; j <= ny; j++) {
      for (let i = 1; i <= nx; i++) {
        const k = j * W + i;
        p[k] = (div[k] + p[k - 1] + p[k + 1] + p[k - W] + p[k + W]) / 4;
      }
    }
    bound(s, 0, p);
  }
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx; i++) {
      const k = j * W + i;
      u[k] -= (0.5 * (p[k + 1] - p[k - 1])) / h;
      v[k] -= (0.5 * (p[k + W] - p[k - W])) / h;
    }
  }
  bound(s, 1, u);
  bound(s, 2, v);
}

/** Vorticity confinement: nudge the flow round its own eddies, so the ink keeps curling. */
function confine(s: Sim, strength: number) {
  const { nx, ny, u, v, curl } = s;
  const W = nx + 2;
  for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
    const k = j * W + i;
    curl[k] = (v[k + 1] - v[k - 1] - (u[k + W] - u[k - W])) * 0.5;
  }
  for (let j = 2; j < ny; j++) for (let i = 2; i < nx; i++) {
    const k = j * W + i;
    const gx = (Math.abs(curl[k + 1]) - Math.abs(curl[k - 1])) * 0.5;
    const gy = (Math.abs(curl[k + W]) - Math.abs(curl[k - W])) * 0.5;
    const len = Math.hypot(gx, gy) + 1e-5;
    u[k] += (strength * DT * (gy / len) * curl[k]);
    v[k] -= (strength * DT * (gx / len) * curl[k]);
  }
}

/** Splat a soft disc of velocity and/or dye at grid position (x, y). */
function splat(s: Sim, x: number, y: number, rad: number, du: number, dv: number, col: [number, number, number] | null, amount: number) {
  const { nx, ny } = s;
  const W = nx + 2;
  const r = Math.ceil(rad * 2.2);
  for (let j = Math.max(1, Math.floor(y - r)); j <= Math.min(ny, Math.ceil(y + r)); j++) {
    for (let i = Math.max(1, Math.floor(x - r)); i <= Math.min(nx, Math.ceil(x + r)); i++) {
      const w = Math.exp(-((i - x) ** 2 + (j - y) ** 2) / (rad * rad));
      if (w < 0.01) continue;
      const k = j * W + i;
      s.u[k] += du * w;
      s.v[k] += dv * w;
      if (col) {
        s.r[k] += col[0] * amount * w;
        s.g[k] += col[1] * amount * w;
        s.b[k] += col[2] * amount * w;
      }
    }
  }
}

function stepSim(s: Sim, score: Score, time: number) {
  const { nx, ny } = s;
  const V = score.config.voices;
  const { lo, span } = skyRange(score);
  // Nozzles along the bottom: low notes left, high notes right; held notes keep pouring.
  for (let vc = 0; vc < V; vc++) {
    const level = levelAt(score, vc, time);
    if (level < 0.03) continue;
    const p = pitchAt(score, vc, time);
    const x = 1 + ((p - lo) / span) * (nx - 1);
    const y = ny - 3;
    const wob = Math.sin(time * 1.3 + vc * 2.1) * 0.25;
    // The ink's colour is its note's (round the circle of fifths), so each chord pours its own colours.
    splat(s, x, y, 2.2, wob * 0.1, -0.5 * level, noteInk(p), 0.035 * level);
  }
  // Drums: a kick pushes the water outward from the bottom; a snare spins up a whirlpool.
  for (const h of drumHits(score, time, time + DT)) {
    if (h.voice === 'kick') {
      for (let a = 0; a < 8; a++) {
        const ang = Math.PI + (a / 7) * Math.PI;
        splat(s, nx / 2 + Math.cos(ang) * 6, ny - 4 + Math.sin(ang) * 6, 4, Math.cos(ang) * 0.9 * h.vel, Math.sin(ang) * 0.9 * h.vel, null, 0);
      }
    } else if (h.voice === 'snare') {
      const k = Math.round(h.t * 1000);
      const cx = nx * (0.2 + 0.6 * (((k * 2654435761) >>> 0) / 4294967296));
      const cy = ny * (0.25 + 0.4 * (((k * 40503) >>> 0) % 1000) / 1000);
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        splat(s, cx + Math.cos(ang) * 4, cy + Math.sin(ang) * 4, 3, -Math.sin(ang) * 0.7 * h.vel, Math.cos(ang) * 0.7 * h.vel, null, 0);
      }
    }
  }
  confine(s, 9);
  project(s);
  s.u0.set(s.u);
  s.v0.set(s.v);
  advect(s, 1, s.u, s.u0, s.u0, s.v0);
  advect(s, 2, s.v, s.v0, s.u0, s.v0);
  project(s);
  // Gentle drag on the water, and the ink fading over ~10 s.
  const drag = 0.995;
  for (let k = 0; k < s.u.length; k++) {
    s.u[k] *= drag;
    s.v[k] *= drag;
  }
  const fade = Math.exp(-DT / 6);
  for (const d of [s.r, s.g, s.b]) {
    s.tmp.set(d);
    advect(s, 0, d, s.tmp, s.u, s.v);
    for (let k = 0; k < d.length; k++) d[k] *= fade;
  }
  s.step++;
}

let image: { w: number; h: number; canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D; img: ImageData } | null = null;

export function drawInk(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea, lite = false) {
  // The whole frame is the water.
  const m = ctx.getTransform();
  const W = a.width;
  const top = -m.f / m.d;
  const H = ctx.canvas.height / m.d;
  const nx = lite ? 64 : 100;
  const ny = Math.max(24, Math.round((nx * H) / W));
  const key = `${nx}x${ny}`;
  let s = sims.get(score);
  if (!s || s.key !== key) {
    s = makeSim(nx, ny, key);
    sims.set(score, s);
  }
  const target = Math.max(0, Math.floor(t / DT));
  if (target < s.step) {
    // Jumped back: restore the latest snapshot before the target (or start over).
    const snap = [...s.snaps].reverse().find((x) => x.step <= target);
    const fields = [s.u, s.v, s.r, s.g, s.b];
    if (snap) {
      fields.forEach((f, i) => f.set(snap.data[i]));
      s.step = snap.step;
    } else {
      fields.forEach((f) => f.fill(0));
      s.step = 0;
    }
  }
  // Catch up (a long jump forward is capped per frame, so the view never freezes for long).
  const limit = s.step + 900;
  while (s.step < target && s.step < limit) {
    stepSim(s, score, s.step * DT);
    if (s.step % Math.round(SNAP_EVERY / DT) === 0 && !s.snaps.some((x) => x.step === s!.step)) {
      s.snaps.push({ step: s.step, data: [s.u, s.v, s.r, s.g, s.b].map((f) => f.slice()) });
      if (s.snaps.length > MAX_SNAPS) s.snaps.splice(1, 1);
    }
  }

  // Draw: dye over the theme's background, the ink's colour where it's thick.
  if (!image || image.w !== nx || image.h !== ny) {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(nx, ny) : Object.assign(document.createElement('canvas'), { width: nx, height: ny });
    const c = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    image = { w: nx, h: ny, canvas, ctx: c, img: c.createImageData(nx, ny) };
  }
  const bg = rgbOf(st.background);
  const data = image.img.data;
  const GW = nx + 2;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = (j + 1) * GW + i + 1;
      const r = s.r[k];
      const g = s.g[k];
      const b = s.b[k];
      const amt = r + g + b;
      const cover = 1 - Math.exp(-amt * 1.3);
      const mx = Math.max(r, g, b);
      const n = mx > 1e-5 ? 0.92 / mx : 0;
      // The ink's own hue (normalised by its brightest channel, so mixes stay vivid), laid over
      // the water as it thickens.
      const cr = r * n;
      const cg = g * n;
      const cb = b * n;
      const o = (j * nx + i) * 4;
      data[o] = 255 * (bg[0] * (1 - cover) + cr * cover);
      data[o + 1] = 255 * (bg[1] * (1 - cover) + cg * cover);
      data[o + 2] = 255 * (bg[2] * (1 - cover) + cb * cover);
      data[o + 3] = 255;
    }
  }
  image.ctx.putImageData(image.img, 0, 0);
  ctx.save();
  // (Default-quality smoothing: the ink is soft anyway, and 'high' is costly on big frames.)
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image.canvas as CanvasImageSource, 0, top, W, H);
  ctx.restore();
}
