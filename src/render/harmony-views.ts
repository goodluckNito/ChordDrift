/**
 * Harmony views: pictures of the chords as structures rather than lines over time.
 *
 *   Chladni plate  each voice drives a standing wave on a plate; sand gathers on the nodal
 *                  lines, and glides melt one pattern into the next
 *   Constellation  the voiced chord as stars (angle = note, distance = register), joined
 *                  bass to top with their intervals; recent chords linger as ghosts
 *
 * Pure functions of (score, t), like every other view.
 */
import { articulationAt, chordIndexAt, drumHits, drumSpan, energyAt, layerAt, levelAt, smootherstep, soundingPitches } from '../engine/motion';
import type { Score, ScoreChord } from '../engine/score';
import { mod12, spellPc } from '../engine/theory';

export interface ViewStyle {
  ink: string;
  accent: string;
  text: string;
  font: string;
  lw: number;
  /** Colour for a pitch class (follows the theme's line colouring, or ink). */
  pcColor: (pc: number) => string;
  /** A distinct colour per voice from the theme's palette (whatever the line colouring). */
  voiceColor: (v: number) => string;
  background: string;
  /** The theme's lights colour (lit windows, comets). */
  lights: string;
}

export interface ViewArea {
  cx: number;
  cy: number;
  /** Radius of the usable area. */
  R: number;
  u: number;
  tu: number;
  /** The whole frame width and the band the picture lives in (for views that use all of it). */
  width: number;
  top: number;
  bottom: number;
}

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const alpha = (color: string, a: number) => (color.startsWith('#') ? `rgba(${rgb(color).join(',')},${a})` : color.replace(/^rgb\(([^)]+)\)$/, `rgba($1,${a})`).replace(/^hsl\(([^)]+)\)$/, `hsla($1 / ${a})`));

/** The chord sounding at t and how far its change has progressed (0 → 1 over the glide). */
export function chordAt(score: Score, t: number): { k: number; c: ScoreChord | null; prev: ScoreChord | null; x: number } {
  const k = chordIndexAt(score, t);
  if (k < 0) return { k, c: null, prev: null, x: 1 };
  const c = score.chords[k];
  const prev = k > 0 ? score.chords[k - 1] : null;
  const span = Math.max(0.05, c.settled - c.t);
  return { k, c, prev, x: smootherstep(Math.min(1, Math.max(0, (t - c.t) / span))) };
}

export const nameOf = (score: Score, pc: number, c?: ScoreChord | null) => spellPc(pc, c?.tonic ?? score.keyPc, c?.scale ?? score.config.scale);

// ---------------------------------------------------------------------------
// Constellation
// ---------------------------------------------------------------------------

const skyCache = new WeakMap<Score, { lo: number; span: number; n: number }>();

/**
 * The sky's register range: the whole piece's, so stars never rescale as the music moves
 * (a moving camera range made every star lurch in or out). Grows only if an endless piece
 * wanders past it.
 */
export function skyRange(score: Score): { lo: number; span: number } {
  const hit = skyCache.get(score);
  if (hit && hit.n === score.chords.length) return hit;
  let lo = Math.min(score.startNote, score.endNote);
  let hi = Math.max(score.startNote, score.endNote);
  for (const c of score.chords) for (const n of c.notes) (lo = Math.min(lo, n)), (hi = Math.max(hi, n));
  const span = Math.max(18, hi - lo + 4);
  const sky = { lo: (lo + hi) / 2 - span / 2, span, n: score.chords.length };
  skyCache.set(score, sky);
  return sky;
}

const INTERVALS = ['P8', 'm2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7'];

export function drawConstellation(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea) {
  const { cx, cy, u, tu } = a;
  const R = a.R * 0.9;
  const { lo, span } = skyRange(score);
  const star = (p: number, scale = 1) => {
    // Continuous in p, so a gliding note sweeps smoothly round from one spoke to the next.
    const ang = -Math.PI / 2 + (p / 12) * Math.PI * 2;
    const r = R * (0.12 + 0.88 * Math.max(0, Math.min(1.05, (p - lo) / span))) * scale;
    return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r };
  };
  ctx.save();
  // The sky: twelve faint spokes (one per note) and octave rings.
  ctx.strokeStyle = alpha(st.text, 0.09);
  ctx.lineWidth = Math.max(1, u);
  ctx.beginPath();
  for (let pc = 0; pc < 12; pc++) {
    const ang = -Math.PI / 2 + (pc / 12) * Math.PI * 2;
    ctx.moveTo(cx + Math.cos(ang) * R * 0.1, cy + Math.sin(ang) * R * 0.1);
    ctx.lineTo(cx + Math.cos(ang) * R * 1.02, cy + Math.sin(ang) * R * 1.02);
  }
  for (let n = Math.ceil(lo / 12) * 12; n <= lo + span; n += 12) {
    const r = R * (0.12 + (0.88 * (n - lo)) / span);
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.font = `500 ${15 * tu}px ${st.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = alpha(st.text, 0.45);
  const now = chordAt(score, t);
  for (let pc = 0; pc < 12; pc++) {
    const ang = -Math.PI / 2 + (pc / 12) * Math.PI * 2;
    ctx.fillText(nameOf(score, pc, now.c), cx + Math.cos(ang) * (R * 1.02 + 22 * tu), cy + Math.sin(ang) * (R * 1.02 + 22 * tu));
  }

  const figure = (pitches: number[], lineA: number, dotA: number, scale: number, labelA: number) => {
    const ps = [...pitches].sort((x, y) => x - y);
    const pts = ps.map((p) => star(p, scale));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 1; i < pts.length; i++) {
      ctx.strokeStyle = alpha(st.ink, lineA);
      ctx.lineWidth = Math.max(1, 1.6 * u * st.lw);
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      if (labelA > 0.01) {
        const iv = INTERVALS[mod12(Math.round(ps[i] - ps[i - 1]))];
        const mx = (pts[i - 1].x + pts[i].x) / 2;
        const my = (pts[i - 1].y + pts[i].y) / 2;
        ctx.fillStyle = alpha(st.text, 0.75 * lineA * labelA);
        ctx.font = `500 ${13 * tu}px ${st.font}`;
        ctx.fillText(Math.round(ps[i] - ps[i - 1]) === 0 ? 'U' : iv, mx, my - 9 * tu);
      }
    }
    pts.forEach((p, i) => {
      ctx.fillStyle = alpha(st.pcColor(mod12(Math.round(ps[i]))), dotA);
      ctx.beginPath();
      ctx.arc(p.x, p.y, (i === 0 ? 8 : 5.5) * u * Math.max(0.7, Math.min(1.8, st.lw)), 0, Math.PI * 2);
      ctx.fill();
    });
  };
  // Ghosts: the last few chords, smaller and fainter the older they are. Ages run continuously
  // through each change (a chord eases back into the ghosts as the next one arrives, and the
  // oldest fades out), so nothing pops.
  const k = now.k;
  const MAX = 4;
  for (let n = Math.max(0, k - MAX - 1); n < k; n++) {
    const c = score.chords[n];
    if (c.unison) continue;
    const age = k - n - 1 + now.x;
    if (age <= 0.001) continue;
    const fade = Math.max(0, Math.min(1, MAX + 1 - age)) * Math.min(1, age * 2);
    figure(c.notes, (0.22 / (1 + age * 0.8)) * fade, (0.3 / (1 + age * 0.8)) * fade, Math.pow(0.94, age), 0);
  }
  // The chord sounding now (gliding voices move between shapes). Interval labels fade out
  // while the voices glide (their values would flicker) and back in once the chord settles.
  const pitches = soundingPitches(score, t);
  const off = pitches.reduce((m, p) => Math.max(m, Math.abs(p - Math.round(p))), 0);
  const settle = 1 - Math.min(1, off * 5);
  figure(pitches, 0.85, 1, 1, settle * settle);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Drums in the picture
// ---------------------------------------------------------------------------

/**
 * How hard the drums are hitting right now, per family (0–1, decaying after each hit), for views
 * that move with them. Only where the drums are heard (song parts without drums stay still).
 */
export function drumPulse(score: Score, t: number): { kick: number; snare: number; hat: number; snareAt: number } {
  const out = { kick: 0, snare: 0, hat: 0, snareAt: 0 };
  if (!score.drums) return out;
  const [s0, s1] = drumSpan(score);
  if (t < s0 || t > s1 + 0.6) return out;
  const e = energyAt(score, t);
  if (e < 0.02) return out;
  for (const h of drumHits(score, t - 0.6, t + 1e-6)) {
    const dt = t - h.t;
    if (dt < 0) continue;
    if (h.voice === 'kick') out.kick += h.vel * Math.exp(-dt / 0.16);
    else if (h.voice === 'snare' || h.voice === 'crash') {
      const v = h.vel * Math.exp(-dt / (h.voice === 'crash' ? 0.35 : 0.12));
      if (v > out.snare) out.snareAt = h.t;
      out.snare = Math.max(out.snare, v);
    } else out.hat += h.vel * 0.6 * Math.exp(-dt / 0.06);
  }
  out.kick = Math.min(1, out.kick) * e;
  out.snare = Math.min(1, out.snare) * e;
  out.hat = Math.min(1, out.hat) * e;
  return out;
}

// ---------------------------------------------------------------------------
// Chladni plate
// ---------------------------------------------------------------------------

/**
 * Real Chladni figures: a square plate's standing waves are
 *   cos(nπx)·cos(mπy) ± cos(mπx)·cos(nπy)   on x, y ∈ [−1, 1]
 * with whole numbers n, m, and sand gathers on the nodal lines, where the plate stays still.
 * Each voice drives one figure, chosen by its interval above the bass (the root a simple figure,
 * fifths and fourths simple ones, seconds and the tritone busy ones), one step finer per octave
 * above the bass. So a chord's shape decides its figure: a major triad draws the same picture in
 * any key, a minor triad another; lower voices weigh more. A glide crossfades between the two
 * figures either side of where the voice is, so patterns melt into each other.
 */
const MODES: [number, number, number][] = [
  [1, 2, 1], // root / octave
  [5, 6, -1], // minor 2nd
  [3, 4, -1], // major 2nd
  [2, 3, -1], // minor 3rd
  [1, 4, 1], // major 3rd
  [2, 5, 1], // 4th
  [4, 7, -1], // tritone
  [1, 3, -1], // 5th
  [3, 5, 1], // minor 6th
  [2, 4, -1], // major 6th
  [3, 6, 1], // minor 7th
  [4, 5, 1], // major 7th
];
interface SandBuffer {
  /** Field grid (smooth, so coarse) and the image it's drawn into (the plate's real size). */
  fn: number;
  on: number;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  img: ImageData;
  /** A fixed grain threshold per pixel, so sand stays put where the pattern holds still. */
  grain: Float32Array;
  field: Float32Array;
}
let sand: SandBuffer | null = null;

function sandBuffer(fn: number, on: number): SandBuffer {
  if (sand && sand.fn === fn && sand.on === on) return sand;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(on, on) : Object.assign(document.createElement('canvas'), { width: on, height: on });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const grain = new Float32Array(on * on);
  for (let i = 0; i < grain.length; i++) {
    let h = Math.imul(i + 1, 0x9e3779b1) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    grain[i] = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  sand = { fn, on, canvas, ctx, img: ctx.createImageData(on, on), grain, field: new Float32Array(fn * fn) };
  return sand;
}
/** A voice's level apart from the swell crossfade (the layers carry that): its articulation. */
const widthLevel = (score: Score, _v: number, t: number) => Math.max(0, Math.min(1, articulationAt(score, t)));

/** Any CSS colour as [r, g, b] (theme colours are usually hex; others go through the canvas parser). */
function toRgb(ctx: CanvasRenderingContext2D, color: string): [number, number, number] {
  if (/^#[0-9a-f]{6}$/i.test(color)) return rgb(color) as [number, number, number];
  ctx.save();
  ctx.fillStyle = color;
  const c = String(ctx.fillStyle);
  ctx.restore();
  if (c.startsWith('#')) return rgb(c) as [number, number, number];
  const m = c.match(/[\d.]+/g);
  return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [128, 128, 128];
}

export function drawChladni(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea, lite = false) {
  const { cx, cy, u } = a;
  // Drums shake the plate: a kick throws the sand up (the lines blur and the plate thumps), a
  // snare scatters grains across it, hats make the edges shimmer.
  const drum = drumPulse(score, t);
  const S = a.R * 1.7 * (1 + 0.02 * drum.kick); // plate side
  const FN = lite ? 110 : 170;
  const ON = Math.max(160, Math.min(lite ? 360 : 560, Math.round(a.R * 1.7)));
  const buf = sandBuffer(FN, ON);
  // Figures, keyed by (n, m, sign); weights add up.
  const figures = new Map<string, { n: number; m: number; sg: number; w: number }>();
  const add = (n: number, m: number, sg: number, w: number) => {
    const key = `${n},${m},${sg}`;
    const f = figures.get(key) ?? { n, m, sg, w: 0 };
    f.w += w;
    figures.set(key, f);
  };
  let power = 0;
  const layer = (ps: number[], ws: number[]) => {
    let bass = Infinity;
    ps.forEach((p, v) => ws[v] > 0.02 && (bass = Math.min(bass, p)));
    if (!Number.isFinite(bass)) return;
    ps.forEach((p, v) => {
      const w0 = ws[v];
      if (w0 <= 0.02) return;
      const x = Math.max(0, p - bass);
      const oct = Math.floor(x / 12 + 1e-9);
      const iv = x - oct * 12;
      const i0 = Math.floor(iv);
      const f = iv - i0;
      const w = w0 / (1 + 0.6 * oct);
      power += w * w;
      for (const [i, wf] of [
        [i0, 1 - f],
        [i0 + 1, f],
      ] as const) {
        if (wf < 1e-3) continue;
        const o = oct + (i >= 12 ? 1 : 0);
        const [n, m, sg] = MODES[i % 12];
        add(n + o, m + o, sg, w * wf);
      }
    });
  };
  const V = score.config.voices;
  if (score.config.motion.transition === 'swell') {
    // Release & swell: both chords drive the plate while one fades and the next swells in.
    for (const L of [0, 1] as const) {
      const ls = Array.from({ length: V }, (_, v) => layerAt(score, L, v, t));
      layer(
        ls.map((l) => l.p),
        ls.map((l, v) => l.g * widthLevel(score, v, t)),
      );
    }
  } else {
    const ps = soundingPitches(score, t);
    layer(
      ps,
      ps.map((_, v) => levelAt(score, v, t)),
    );
  }
  // A change without a glide (swell, pluck) throws the sand up, and it settles into the new
  // figure over about half a second, the way sand jumps when a plate's note changes.
  const now = chordAt(score, t);
  const snap = score.config.motion.transition !== 'glide' && now.c && now.k > 0 ? Math.exp(-Math.max(0, t - now.c.t) / 0.3) : 0;

  const list = [...figures.values()];
  const M = list.length;
  const Cn = new Float32Array(M * FN);
  const Cm = new Float32Array(M * FN);
  list.forEach((f, i) => {
    for (let x = 0; x < FN; x++) {
      const X = -1 + (2 * x) / (FN - 1);
      Cn[i * FN + x] = Math.cos(f.n * Math.PI * X);
      Cm[i * FN + x] = Math.cos(f.m * Math.PI * X);
    }
  });
  const field = buf.field;
  let sumSq = 0;
  for (let y = 0; y < FN; y++) {
    for (let x = 0; x < FN; x++) {
      let v = 0;
      for (let i = 0; i < M; i++) {
        const o = i * FN;
        const f = list[i];
        v += f.w * (Cn[o + x] * Cm[o + y] + f.sg * Cm[o + x] * Cn[o + y]);
      }
      field[y * FN + x] = v;
      sumSq += v * v;
    }
  }
  const rms = Math.sqrt(sumSq / (FN * FN)) + 1e-6;
  // Silence (or a field that cancels out) leaves the plate bare rather than painting it solid.
  const present = Math.min(1, Math.sqrt(power) * 1.5) * Math.min(1, rms / (0.05 * Math.sqrt(power) + 1e-6));
  const [r, g, b] = toRgb(ctx, st.ink);
  const data = buf.img.data;
  const grain = buf.grain;
  // Thrown sand: the band of grains around each line widens, and grains loosen.
  const width = 0.012 * (1 + 6 * Math.max(drum.kick, snap * 0.8) + 1.5 * drum.hat);
  const loose = 0.8 + 0.6 * Math.max(drum.kick, snap);
  // Scattered sand: each snare throws its own random sprinkle (seeded by the hit, so it holds still).
  const dust = drum.snare * 0.03;
  const shift = Math.floor(drum.snareAt * 7919) % (ON * ON);
  const scale = (FN - 1) / (ON - 1);
  for (let y = 0; y < ON; y++) {
    const fy = y * scale;
    const y0 = Math.min(FN - 2, Math.floor(fy));
    const ty = fy - y0;
    for (let x = 0; x < ON; x++) {
      const fx = x * scale;
      const x0 = Math.min(FN - 2, Math.floor(fx));
      const tx = fx - x0;
      // The field is smooth, so the coarse grid sampled bilinearly is exact enough; the grains are full size.
      const i00 = y0 * FN + x0;
      const f = (field[i00] * (1 - tx) + field[i00 + 1] * tx) * (1 - ty) + (field[i00 + FN] * (1 - tx) + field[i00 + FN + 1] * tx) * ty;
      const v = f / rms;
      const s = Math.exp(-(v * v) / width); // close to a nodal line → lots of sand
      const i = y * ON + x;
      // Soft-edged grains (no hard on/off pixels), plus a faint haze where the sand thins out.
      let on = Math.max(0, Math.min(1, (s - grain[i] * loose - 0.06) * 7)) + s * 0.1;
      if (dust > 0 && grain[(i + shift) % (ON * ON)] < dust) on = Math.max(on, 0.7);
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = Math.round(255 * Math.min(1, on) * present);
    }
  }
  buf.ctx.putImageData(buf.img, 0, 0);

  ctx.save();
  // The plate: a faint sheet and edge, the sand, and its centre mount.
  ctx.fillStyle = alpha(st.ink, 0.035);
  ctx.fillRect(cx - S / 2, cy - S / 2, S, S);
  ctx.strokeStyle = alpha(st.text, 0.22);
  ctx.lineWidth = Math.max(1, 1.2 * u);
  ctx.strokeRect(cx - S / 2, cy - S / 2, S, S);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(buf.canvas as CanvasImageSource, cx - S / 2, cy - S / 2, S, S);
  ctx.fillStyle = alpha(st.text, 0.35);
  ctx.beginPath();
  ctx.arc(cx, cy, 4 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
