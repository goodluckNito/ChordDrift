/**
 * Harmony views: pictures of the chords as structures rather than lines over time.
 *
 *   Constellation  the voiced chord as stars (angle = note, distance = register), joined
 *                  bass to top with their intervals; recent chords linger as ghosts
 *
 * Pure functions of (score, t), like every other view.
 */
import { chordIndexAt, drumHits, drumSpan, energyAt, smootherstep, soundingPitches } from '../engine/motion';
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
  /** A note's colour: by voice or note when the lines are coloured that way, else the key's harmony colours. */
  noteColor: (p: number, v: number) => string;
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
