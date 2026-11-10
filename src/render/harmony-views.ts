/**
 * Harmony views: pictures of the chords as structures rather than lines over time.
 *
 *   Chladni plate  each voice drives a standing wave on a plate; sand gathers on the nodal
 *                  lines, and glides melt one pattern into the next
 *   Compass        the voices as arrows on the circle of fifths, chained tip to tail: where the
 *                  chain ends is the chord's pull, and its tip leaves a trail
 *   Circle of 5ths every chord change is an arc between roots on the circle of fifths;
 *                  repeated moves thicken into a web of the piece's habits
 *   Constellation  the voiced chord as stars (angle = note, distance = register), joined
 *                  bass to top with their intervals; recent chords linger as ghosts
 *
 * Pure functions of (score, t), like every other view.
 */
import { chordIndexAt, levelAt, smootherstep, soundingPitches } from '../engine/motion';
import type { Score, ScoreChord } from '../engine/score';
import { mod12, scaleSteps, spellPc } from '../engine/theory';

export interface ViewStyle {
  ink: string;
  accent: string;
  text: string;
  font: string;
  lw: number;
  /** Colour for a pitch class (follows the theme's line colouring, or ink). */
  pcColor: (pc: number) => string;
}

export interface ViewArea {
  cx: number;
  cy: number;
  /** Radius of the usable area. */
  R: number;
  u: number;
  tu: number;
}

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const alpha = (color: string, a: number) => (color.startsWith('#') ? `rgba(${rgb(color).join(',')},${a})` : color.replace(/^rgb\(([^)]+)\)$/, `rgba($1,${a})`).replace(/^hsl\(([^)]+)\)$/, `hsla($1 / ${a})`));

/** The chord sounding at t and how far its change has progressed (0 → 1 over the glide). */
function chordAt(score: Score, t: number): { k: number; c: ScoreChord | null; prev: ScoreChord | null; x: number } {
  const k = chordIndexAt(score, t);
  if (k < 0) return { k, c: null, prev: null, x: 1 };
  const c = score.chords[k];
  const prev = k > 0 ? score.chords[k - 1] : null;
  const span = Math.max(0.05, c.settled - c.t);
  return { k, c, prev, x: smootherstep(Math.min(1, Math.max(0, (t - c.t) / span))) };
}

const pcsOf = (c: ScoreChord) => [...new Set(c.notes.map((n) => mod12(n)))];
const nameOf = (score: Score, pc: number, c?: ScoreChord | null) => spellPc(pc, c?.tonic ?? score.keyPc, c?.scale ?? score.config.scale);

// ---------------------------------------------------------------------------
// Circle of fifths
// ---------------------------------------------------------------------------

export function drawFifths(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea) {
  const { cx, cy, u, tu } = a;
  const R = a.R * 0.82;
  const now = chordAt(score, t);
  const k = now.k;
  const angle = (pc: number) => -Math.PI / 2 + (mod12(pc * 7) / 12) * Math.PI * 2;
  const at = (pc: number, r = R) => ({ x: cx + Math.cos(angle(pc)) * r, y: cy + Math.sin(angle(pc)) * r });

  ctx.save();
  // The circle, the twelve stations and the key's tonic.
  ctx.strokeStyle = alpha(st.text, 0.14);
  ctx.lineWidth = Math.max(1, 1.2 * u);
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  const tonic = now.c?.tonic ?? score.keyPc;
  ctx.font = `600 ${18 * tu}px ${st.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let pc = 0; pc < 12; pc++) {
    const p = at(pc);
    const q = at(pc, R + 30 * tu);
    ctx.fillStyle = alpha(st.text, pc === tonic ? 0.95 : 0.5);
    ctx.fillText(nameOf(score, pc, now.c), q.x, q.y);
    ctx.fillStyle = alpha(st.text, 0.35);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  const tp = at(tonic);
  ctx.strokeStyle = alpha(st.accent, 0.8);
  ctx.lineWidth = Math.max(1, 2 * u);
  ctx.beginPath();
  ctx.arc(tp.x, tp.y, 13 * u, 0, Math.PI * 2);
  ctx.stroke();

  // The web: every root-to-root move so far as an arc bowed toward the centre; repeats thicken.
  const moves = new Map<string, { a: number; b: number; n: number; last: number }>();
  for (let n = 1; n <= k; n++) {
    const ra = mod12(score.chords[n - 1].root);
    const rb = mod12(score.chords[n].root);
    if (ra === rb || score.chords[n].unison || score.chords[n - 1].unison) continue;
    const key = `${ra}>${rb}`;
    const m = moves.get(key) ?? { a: ra, b: rb, n: 0, last: 0 };
    m.n++;
    m.last = n;
    moves.set(key, m);
  }
  const arc = (ra: number, rb: number, frac = 1) => {
    const p0 = at(ra);
    const p1 = at(rb);
    // Close neighbours bow gently; far jumps cut deep toward the centre.
    const d = Math.min(mod12(mod12(rb * 7) - mod12(ra * 7)), mod12(mod12(ra * 7) - mod12(rb * 7)));
    const bow = 0.15 + 0.12 * d;
    const mx = (p0.x + p1.x) / 2 + (cx - (p0.x + p1.x) / 2) * bow;
    const my = (p0.y + p1.y) / 2 + (cy - (p0.y + p1.y) / 2) * bow;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    if (frac >= 1) ctx.quadraticCurveTo(mx, my, p1.x, p1.y);
    else {
      // Partial quadratic (de Casteljau) for the arc being drawn right now.
      const q = (s: number) => ({ x: (1 - s) ** 2 * p0.x + 2 * (1 - s) * s * mx + s * s * p1.x, y: (1 - s) ** 2 * p0.y + 2 * (1 - s) * s * my + s * s * p1.y });
      for (let i = 1; i <= 24; i++) {
        const p = q((i / 24) * frac);
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  for (const m of moves.values()) {
    if (m.last === k && now.x < 1 && m.n === 1) continue; // being drawn below
    const age = k - m.last;
    ctx.strokeStyle = alpha(st.pcColor(m.b), Math.max(0.12, 0.7 * Math.exp(-age / 10)));
    ctx.lineWidth = Math.max(1, (1.2 + 1.6 * Math.log2(1 + m.n)) * u * st.lw);
    arc(m.a, m.b);
  }
  if (now.c && now.prev && !now.c.unison && !now.prev.unison && mod12(now.c.root) !== mod12(now.prev.root)) {
    ctx.strokeStyle = st.accent;
    ctx.lineWidth = Math.max(1, 3 * u * st.lw);
    arc(mod12(now.prev.root), mod12(now.c.root), Math.max(0.02, now.x));
  }

  // The chord's shape inscribed in the circle (its notes joined in fifths order).
  if (now.c && !now.c.unison) {
    const pcs = pcsOf(now.c).sort((x, y) => mod12(x * 7) - mod12(y * 7));
    ctx.beginPath();
    pcs.forEach((pc, i) => {
      const p = at(pc, R * 0.97);
      if (i) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = alpha(st.ink, 0.08 + 0.08 * now.x);
    ctx.fill();
    ctx.strokeStyle = alpha(st.ink, 0.55 * now.x);
    ctx.lineWidth = Math.max(1, 1.6 * u * st.lw);
    ctx.stroke();
    for (const pc of pcs) {
      const p = at(pc);
      ctx.fillStyle = st.pcColor(pc);
      ctx.beginPath();
      ctx.arc(p.x, p.y, (pc === mod12(now.c.root) ? 11 : 7) * u, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Constellation
// ---------------------------------------------------------------------------

const skyCache = new WeakMap<Score, { lo: number; span: number; n: number }>();

/**
 * The sky's register range: the whole piece's, so stars never rescale as the music moves
 * (a moving camera range made every star lurch in or out). Grows only if an endless piece
 * wanders past it.
 */
function skyRange(score: Score): { lo: number; span: number } {
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
// Chladni plate
// ---------------------------------------------------------------------------

/**
 * Each voice drives the plate in one standing-wave mode,
 *   cos(nπx)·cos(mπy) + s·cos(mπx)·cos(nπy)   on x, y ∈ [−1, 1],
 * and sand gathers on the nodal lines, where the summed waves cancel. Register sets the mode's
 * size (k = √(n² + m²): higher notes, finer patterns), the note sets its angle (n = k·cosθ,
 * m = k·sinθ) and its symmetry s. Everything is continuous in pitch, so a glide melts one
 * pattern into the next; a unison is one clean classic figure, and big chords tangle.
 */
interface SandBuffer {
  n: number;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  img: ImageData;
  /** A fixed grain threshold per pixel, so sand stays put where the pattern holds still. */
  grain: Float32Array;
  field: Float32Array;
}
let sand: SandBuffer | null = null;

function sandBuffer(n: number): SandBuffer {
  if (sand && sand.n === n) return sand;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(n, n) : Object.assign(document.createElement('canvas'), { width: n, height: n });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const grain = new Float32Array(n * n);
  for (let i = 0; i < grain.length; i++) {
    let h = Math.imul(i + 1, 0x9e3779b1) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    grain[i] = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  sand = { n, canvas, ctx, img: ctx.createImageData(n, n), grain, field: new Float32Array(n * n) };
  return sand;
}

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
  const S = a.R * 1.7; // plate side
  const N = lite ? 120 : 200;
  const buf = sandBuffer(N);
  const { lo, span } = skyRange(score);
  const pitches = soundingPitches(score, t);
  // One mode per distinct (rounded to a hundredth) pitch; doubled notes just drive it harder.
  const modes = new Map<number, { p: number; w: number }>();
  pitches.forEach((p, v) => {
    const key = Math.round(p * 100);
    const m = modes.get(key) ?? { p, w: 0 };
    m.w += levelAt(score, v, t);
    modes.set(key, m);
  });
  const list = [...modes.values()].filter((m) => m.w > 1e-3);
  const M = list.length;
  const Cn = new Float32Array(M * N);
  const Cm = new Float32Array(M * N);
  const W = new Float32Array(M);
  const Sy = new Float32Array(M);
  let power = 0;
  list.forEach((m, i) => {
    const k = 2.2 + 7 * Math.max(0, Math.min(1, (m.p - lo) / span));
    const theta = (((m.p % 12) + 12) % 12) / 12 * (Math.PI / 2);
    const n = k * Math.cos(theta);
    const mm = k * Math.sin(theta);
    for (let x = 0; x < N; x++) {
      const X = -1 + (2 * x) / (N - 1);
      Cn[i * N + x] = Math.cos(n * Math.PI * X);
      Cm[i * N + x] = Math.cos(mm * Math.PI * X);
    }
    W[i] = m.w;
    // Symmetry: −1 at the ends of the note's turn (so the wrap from B to C, which swaps n and m,
    // is seamless) and +1 in the middle, where n = m and the − form would cancel to nothing.
    Sy[i] = -Math.cos(4 * theta);
    power += m.w * m.w;
  });
  const field = buf.field;
  let sumSq = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let f = 0;
      for (let i = 0; i < M; i++) {
        const o = i * N;
        f += W[i] * (Cn[o + x] * Cm[o + y] + Sy[i] * Cm[o + x] * Cn[o + y]);
      }
      field[y * N + x] = f;
      sumSq += f * f;
    }
  }
  const rms = Math.sqrt(sumSq / (N * N)) + 1e-6;
  // Silence (or a field that cancels out) leaves the plate bare rather than painting it solid.
  const present = Math.min(1, Math.sqrt(power) * 1.5) * Math.min(1, rms / (0.05 * Math.sqrt(power) + 1e-6));
  const [r, g, b] = toRgb(ctx, st.ink);
  const data = buf.img.data;
  const grain = buf.grain;
  for (let i = 0; i < N * N; i++) {
    const v = field[i] / rms;
    const s = Math.exp(-(v * v) / 0.03); // close to a nodal line → lots of sand
    const on = s > grain[i] * 0.85 + 0.08 ? 1 : s * 0.25;
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = Math.round(255 * on * present * (0.55 + 0.45 * s));
  }
  buf.ctx.putImageData(buf.img, 0, 0);

  ctx.save();
  // The plate: a faint square, its centre mount, and tick marks for the edge.
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
  // Each mode as a dot on the plate's edge (where along it: the note; colour: its pitch class).
  for (const m of list) {
    const pos = (((m.p % 12) + 12) % 12) / 12;
    ctx.fillStyle = st.pcColor(mod12(Math.round(m.p)));
    ctx.beginPath();
    ctx.arc(cx - S / 2 + pos * S, cy + S / 2 + 12 * u, 3.5 * u * Math.min(2, 0.6 + m.w * 0.4), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Harmonic compass
// ---------------------------------------------------------------------------

/**
 * Every voice is an arrow pointing at its note on the circle of fifths, and the arrows are
 * chained tip to tail (bass first). Notes close together on the circle (a diatonic chord) line
 * up into a long reach; spread or symmetric chords (diminished, augmented, whole-tone) curl back
 * toward the centre. Where the chain ends is the chord's pull: its direction leans toward the
 * key the notes belong to, its length is how strongly. Glides swing the arrows round (a
 * semitone is seven steps on the circle), and the tip leaves a trail.
 */
export function drawCompass(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea) {
  const { cx, cy, u, tu } = a;
  const R = a.R * 0.82;
  const V = score.config.voices;
  const L = (R * 1.5) / V;
  const ang = (p: number) => -Math.PI / 2 + (Math.PI * 2 * 7 * p) / 12;
  const station = (pc: number, r = R) => ({ x: cx + Math.cos(ang(pc)) * r, y: cy + Math.sin(ang(pc)) * r });
  const now = chordAt(score, t);
  const chain = (time: number) => {
    const ps = soundingPitches(score, time);
    const pts = [{ x: cx, y: cy }];
    let x = cx;
    let y = cy;
    ps.forEach((p, v) => {
      const len = L * (0.35 + 0.65 * levelAt(score, v, time));
      x += Math.cos(ang(p)) * len;
      y += Math.sin(ang(p)) * len;
      pts.push({ x, y });
    });
    // Arrows are long enough to read; a chain that would leave the dial (a unison) is shrunk to fit.
    const reach = Math.hypot(x - cx, y - cy);
    const f = reach > R * 0.92 ? (R * 0.92) / reach : 1;
    if (f < 1) for (const q of pts) (q.x = cx + (q.x - cx) * f), (q.y = cy + (q.y - cy) * f);
    return { ps, pts };
  };

  ctx.save();
  // The dial: the circle, faint rings, and the twelve notes in fifths order; the key's notes are brighter.
  const tonic = now.c?.tonic ?? score.keyPc;
  const inKey = new Set(scaleSteps(now.c?.scale ?? score.config.scale).map((s) => mod12(tonic + s)));
  ctx.strokeStyle = alpha(st.text, 0.14);
  ctx.lineWidth = Math.max(1, 1.2 * u);
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.moveTo(cx + R * 0.5, cy);
  ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = alpha(st.text, 0.06);
  ctx.beginPath();
  for (let pc = 0; pc < 12; pc++) {
    const p = station(pc);
    ctx.moveTo(cx, cy);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.font = `600 ${18 * tu}px ${st.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let pc = 0; pc < 12; pc++) {
    const p = station(pc);
    const q = station(pc, R + 30 * tu);
    const k = inKey.has(pc);
    ctx.fillStyle = alpha(st.text, pc === tonic ? 0.95 : k ? 0.6 : 0.25);
    ctx.fillText(nameOf(score, pc, now.c), q.x, q.y);
    ctx.fillStyle = alpha(st.text, k ? 0.45 : 0.2);
    ctx.beginPath();
    ctx.arc(p.x, p.y, (k ? 3.5 : 2.5) * u, 0, Math.PI * 2);
    ctx.fill();
  }
  const tp = station(tonic);
  ctx.strokeStyle = alpha(st.accent, 0.8);
  ctx.lineWidth = Math.max(1, 2 * u);
  ctx.beginPath();
  ctx.arc(tp.x, tp.y, 13 * u, 0, Math.PI * 2);
  ctx.stroke();

  // The trail: where the chain's tip has been over the last few seconds.
  const TRAIL = 6;
  const steps = 120;
  const start = Math.max(0, t - TRAIL);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let prev: { x: number; y: number } | null = null;
  for (let i = 0; i <= steps; i++) {
    const time = start + ((t - start) * i) / steps;
    const pts = chain(time).pts;
    const tip = pts[pts.length - 1];
    if (prev) {
      ctx.strokeStyle = alpha(st.accent, 0.05 + 0.5 * (i / steps) ** 2);
      ctx.lineWidth = Math.max(1, 2.2 * u * st.lw);
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }
    prev = tip;
  }

  // The chain itself.
  const { ps, pts } = chain(t);
  const tip = pts[pts.length - 1];
  ctx.setLineDash([4 * u, 5 * u]);
  ctx.strokeStyle = alpha(st.text, 0.3);
  ctx.lineWidth = Math.max(1, u);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  ctx.setLineDash([]);
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const color = st.pcColor(mod12(Math.round(ps[i - 1])));
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1, 2 * u * st.lw);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    // A small head, pointing along the arrow.
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const d = Math.hypot(dx, dy);
    if (d > 4 * u) {
      const h = Math.min(7 * u, d * 0.45);
      const ux = dx / d;
      const uy = dy / d;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p1.x - ux * h - uy * h * 0.5, p1.y - uy * h + ux * h * 0.5);
      ctx.lineTo(p1.x - ux * h + uy * h * 0.5, p1.y - uy * h - ux * h * 0.5);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.fillStyle = st.accent;
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 6 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = alpha(st.text, 0.5);
  ctx.beginPath();
  ctx.arc(cx, cy, 3 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
