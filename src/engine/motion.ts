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

/**
 * Swell multiplier (0..1) for voice v at time t; v = -1 is the melody. Pure, so
 * audio and picture agree.
 *   chord  — every change dips, then the new chord swells in (peaks ~55% through)
 *   voice  — a voice that moves fades just before its glide and swells back after
 *   breath — slow overlapping waves, slightly out of phase per voice
 */
export function swellAt(score: Score, v: number, t: number): number {
  const a = score.config.audio;
  if (a.swell === 'off' || a.swellDepth <= 0) return 1;
  const tl = score.timeline;
  const depth = a.swellDepth;
  if (t >= tl.arrivalStart) return 1;

  if (a.swell === 'chord') {
    const k = chordIndexAt(score, t);
    if (k < 0) return 1;
    const start = score.chords[k].t;
    const next = score.chords[k + 1]?.t ?? (Number.isFinite(tl.arrivalStart) ? tl.arrivalStart : start + score.config.timing.hold);
    const x = Math.min(1, Math.max(0, (t - start) / Math.max(0.05, next - start)));
    const peak = 0.55;
    const e = x < peak ? smootherstep(x / peak) : 1 - smootherstep((x - peak) / (1 - peak));
    // The bloom starts from the unison at full level, then breathes like the rest.
    if (k === 0 && x < peak) return 1;
    return 1 - depth * (1 - e);
  }

  if (a.swell === 'voice') {
    if (v < 0) return 1;
    const moves = score.moves[v];
    const pre = 0.35;
    const post = Math.min(2, score.config.timing.hold * 0.5);
    const bloomEnd = tl.introEnd + score.config.timing.bloom * 0.5;
    let lo = 0;
    let hi = moves.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (moves[mid].t0 - pre <= t) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    let dip = 0;
    for (let i = Math.max(0, idx - 1); i <= idx; i++) {
      const m = moves[i];
      if (!m || m.t0 < bloomEnd) continue;
      const end = m.t0 + m.d;
      if (t < m.t0 - pre || t > end + post) continue;
      if (t < m.t0) dip = Math.max(dip, smootherstep((t - (m.t0 - pre)) / pre));
      else if (t <= end) dip = 1;
      else dip = Math.max(dip, 1 - smootherstep((t - end) / post));
    }
    return 1 - depth * dip;
  }

  // breath
  const s = score.seed;
  const p1 = 7 + (s % 5);
  const p2 = 11.5 + ((s >>> 8) % 6);
  const ph = ((s >>> 16) % 628) / 100 + (v + 1) * 0.35;
  const e = 0.5 + 0.3 * Math.sin((2 * Math.PI * t) / p1 + ph) + 0.2 * Math.sin((2 * Math.PI * t) / p2 + ph * 1.7);
  // Ease in from full level during the intro so the opening unison isn't swallowed.
  const ramp = Math.min(1, t / Math.max(0.1, tl.introEnd + score.config.timing.bloom));
  return 1 - depth * ramp * (1 - e);
}

/**
 * "Release & swell in" transitions use two alternating layers of voices: chord
 * k sounds on layer k % 2, swells in when it starts, and releases when chord
 * k + 1 starts — so each chord fades out underneath the next one swelling in.
 * The bloom (chord 0) and the arrival still glide. Returns the pitch (MIDI) and
 * level (0..1) of voice v on layer L at time t.
 */
export function layerAt(score: Score, L: 0 | 1, v: number, t: number): { p: number; g: number } {
  const chords = score.chords;
  const T = score.config.timing;
  const tl = score.timeline;
  let k = chordIndexAt(score, t);
  if (k >= 0 && k % 2 !== L) k -= 1;
  if (k < 0) {
    // Before this layer's first chord: layer 0 holds the opening unison, layer 1 waits silently.
    return L === 0 ? { p: pitchAt(score, v, t), g: 1 } : { p: chords[1]?.notes[v] ?? score.startNote, g: 0 };
  }
  const c = chords[k];
  const next = chords[k + 1];
  const after = chords[k + 2];
  const last = k === chords.length - 1;
  const p = k === 0 || (last && t >= tl.arrivalStart) ? pitchAt(score, v, t) : c.notes[v];
  const nextT = next ? next.t : tl.arrivalStart;
  const swellIn = Math.max(0.01, Math.min(T.swellIn, nextT - c.t));
  const gIn = k === 0 ? 1 : smootherstep((t - c.t) / swellIn);
  let gOut = 1;
  if (next) {
    // The release must finish before this layer is reused (by chord k + 2) or the arrival ends.
    const limit = (after ? after.t : Number.isFinite(tl.arrivalEnd) ? tl.arrivalEnd : Infinity) - next.t;
    const release = Math.max(0.01, Math.min(T.release, limit));
    gOut = 1 - smootherstep((t - next.t) / release);
  }
  return { p, g: gIn * gOut };
}

/**
 * The pitches you'd point at right now: the gliding voices, or — with
 * release-&-swell transitions — the newest chord. Used for the camera, labels and HUD.
 */
export function soundingPitches(score: Score, t: number): number[] {
  if (score.config.motion.transition !== 'swell') return pitchesAt(score, t);
  const k = chordIndexAt(score, t);
  if (k <= 0 || t >= score.timeline.arrivalStart) return pitchesAt(score, t);
  return score.chords[k].notes.slice();
}
