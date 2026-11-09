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
