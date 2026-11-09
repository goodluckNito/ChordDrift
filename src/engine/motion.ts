import type { Easing } from './config';
import type { Score } from './score';
import { midiToHz } from './theory';

/** Smootherstep, clamped: 6x^5 - 15x^4 + 10x^3. */
export function smootherstep(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export function cosineEase(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return (1 - Math.cos(Math.PI * x)) / 2;
}

export const ease = (x: number, easing: Easing) => (easing === 'cosine' ? cosineEase(x) : smootherstep(x));

/**
 * Pitch of voice v at time t, in MIDI (fractional). The single source of truth:
 * the audio and the picture both read this, so they can't drift apart.
 */
export function pitchAt(score: Score, v: number, t: number): number {
  const moves = score.moves[v];
  // Binary search for the last move starting at or before t.
  let lo = 0;
  let hi = moves.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (moves[mid].t0 <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (idx < 0) return moves.length ? moves[0].p0 : score.startNote;
  const m = moves[idx];
  if (t >= m.t0 + m.d) return m.p1;
  return m.p0 + (m.p1 - m.p0) * ease((t - m.t0) / m.d, score.config.motion.easing);
}

export function pitchesAt(score: Score, t: number): number[] {
  const out = new Array<number>(score.config.voices);
  for (let v = 0; v < out.length; v++) out[v] = pitchAt(score, v, t);
  return out;
}

export function frequenciesAt(score: Score, t: number): number[] {
  return pitchesAt(score, t).map(midiToHz);
}

/** HUD chord label at time t. */
export function chordLabelAt(score: Score, t: number): string {
  const labels = score.labels;
  let lo = 0;
  let hi = labels.length - 1;
  let idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (labels[mid].t <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return labels[idx].text;
}

/** Index of the chord sounding (or gliding in) at time t, -1 before the first change. */
export function chordIndexAt(score: Score, t: number): number {
  const chords = score.chords;
  let lo = 0;
  let hi = chords.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chords[mid].t <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return idx;
}

/** Σf and f↑/f↓ (highest ÷ lowest frequency). */
export function frequencyStats(freqs: number[]): { sum: number; spread: number } {
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const f of freqs) {
    sum += f;
    if (f > max) max = f;
    if (f < min) min = f;
  }
  return { sum, spread: max / min };
}

/**
 * The melody at time t: pitch (MIDI) and gain 0..1 (0 during rests). Notes glide
 * into each other legato; repeated notes and notes after rests re-attack.
 */
export function melodyAt(score: Score, t: number): { p: number; g: number } | null {
  const notes = score.melody;
  if (!notes.length) return null;
  let lo = 0;
  let hi = notes.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].t <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const lastPitch = (from: number) => {
    for (let i = from; i >= 0; i--) if (notes[i].p !== null) return notes[i].p as number;
    for (const n of notes) if (n.p !== null) return n.p;
    return score.startNote;
  };
  if (idx < 0) return { p: lastPitch(0), g: 0 };
  const n = notes[idx];
  if (n.p === null || t >= n.t + n.d) return { p: lastPitch(idx), g: 0 };
  const prev = notes[idx - 1];
  const next = notes[idx + 1];
  const legatoFrom = prev && prev.p !== null && prev.t + prev.d >= n.t - 1e-6 ? prev.p : null;
  const from = n.from ?? legatoFrom;
  const glide = Math.min(n.glide ?? score.config.melody.glide, n.d * (n.glide ? 1 : 0.5));
  const x = t - n.t;
  const p = from !== null && glide > 0 && from !== n.p ? from + (n.p - from) * ease(x / glide, score.config.motion.easing) : n.p;
  let g = 1;
  const attack = 0.012;
  if (legatoFrom === null) g *= Math.min(1, x / attack);
  else if (legatoFrom === n.p) g *= 0.35 + 0.65 * Math.min(1, x / attack); // re-articulate repeated notes
  const remaining = n.t + n.d - t;
  if (!next || next.p === null || next.p === n.p) g *= Math.min(1, remaining / 0.04);
  return { p, g };
}
