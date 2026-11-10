/**
 * Randomized melody lines over the chords.
 *
 * Rhythm comes from rhythm notation (looped) or from random one-beat cells
 * chosen by density. Pitch is a seeded random walk: chord tones on strong beats
 * and whenever the harmony changes, scale steps in between (avoiding notes a
 * semitone above a chord tone), with momentum, the odd leap, and gentle
 * reflection off the edges of the register.
 */
import { REGISTERS, type ChordDriftConfig } from './config';
import type { ChordSpec } from './progression';
import type { RhythmStep } from './rhythm';
import { weighted, type Rng } from './rng';
import { mod12, scalePcs } from './theory';

export interface MelodyNote {
  t: number;
  d: number;
  /** MIDI pitch, or null for a rest. */
  p: number | null;
  /** Glide into this note from `from` over this many seconds (defaults to config glide). */
  glide?: number;
  from?: number;
}

/** One-beat (or two-beat) random rhythm cells, weighted by density. */
function cells(density: number): { steps: RhythmStep[]; w: number }[] {
  const n = (beats: number, rest = false): RhythmStep => ({ beats, rest });
  const third = 1 / 3;
  return [
    { steps: [n(2)], w: 1.2 * (1 - density) + 0.1 },
    { steps: [n(1)], w: 1 },
    { steps: [n(0.5), n(0.5)], w: 0.3 + density * 1.4 },
    { steps: [n(1.5), n(0.5)], w: 0.7 },
    { steps: [n(third), n(third), n(third)], w: density * 0.8 },
    { steps: [n(0.25), n(0.25), n(0.5)], w: density * density * 0.9 },
    { steps: [n(0.5, true), n(0.5)], w: 0.45 },
    { steps: [n(1, true)], w: 0.6 * (1 - density) + 0.1 },
    { steps: [n(0.75), n(0.25)], w: density * 0.5 },
  ];
}

export interface MelodyContext {
  /** The chord sounding at time t (null before the first chord). */
  chordAt(t: number): (ChordSpec & { t: number; settled: number }) | null;
  /** True if any chord change glides during [t0, t1). */
  changesDuring(t0: number, t1: number): boolean;
  /** When the next chord change after t starts (Infinity if none is known yet). */
  nextChangeAfter(t: number): number;
}

export class MelodyGenerator {
  readonly notes: MelodyNote[] = [];
  private cursor: number;
  private beat = 0; // position in beats since the grid start
  private patternIndex = 0;
  private queue: RhythmStep[] = [];
  private pitch: number;
  private dir = 1;
  private repeats = 0;
  private lastChord: ChordSpec | null = null;
  private range: [number, number];
  private beatSec: number;

  constructor(
    private cfg: ChordDriftConfig,
    gridStart: number,
    private pattern: RhythmStep[],
    private rhythmRng: Rng,
    private pitchRng: Rng,
  ) {
    this.cursor = gridStart;
    this.range = REGISTERS[cfg.melody.register];
    this.pitch = Math.round((this.range[0] + this.range[1]) / 2);
    this.beatSec = 60 / cfg.rhythm.tempo;
  }

  /** Pitch the line was last on (for gliding into the arrival). */
  get lastPitch(): number {
    return this.pitch;
  }

  private nextStep(): RhythmStep {
    if (this.pattern.length) return this.pattern[this.patternIndex++ % this.pattern.length];
    if (!this.queue.length) {
      const opts = cells(this.cfg.melody.density);
      // Two-beat cells only on even beats keeps phrases square.
      const ok = opts.filter((c) => c.steps.reduce((a, s) => a + s.beats, 0) <= 1 || Math.abs(this.beat % 2) < 1e-6);
      this.queue = [...weighted(this.rhythmRng, ok, ok.map((c) => c.w)).steps];
    }
    return this.queue.shift()!;
  }

  /** Generate notes until `until` (s). The last note is cut at `until` if `hardStop`. */
  extendTo(until: number, ctx: MelodyContext, hardStop = false): void {
    if (this.cfg.melody.style === 'solo' && !this.pattern.length) {
      this.extendSolo(until, ctx, hardStop);
      return;
    }
    let guard = 0;
    while (this.cursor < until - 1e-6 && guard++ < 20000) {
      const step = this.nextStep();
      const t = this.cursor;
      let d = step.beats * this.beatSec;
      if (hardStop && t + d > until) d = until - t;
      const onBeat = Math.abs(this.beat - Math.round(this.beat)) < 1e-6;
      const strongBeat = onBeat && Math.round(this.beat) % 2 === 0;
      this.beat += step.beats;
      this.cursor = t + d;
      if (d <= 1e-6) continue;

      let rest = step.rest;
      const chord = ctx.chordAt(t + Math.min(d, 0.25) * 0.5);
      if (!chord) rest = true;
      if (!rest && this.cfg.melody.fill === 'gaps' && ctx.changesDuring(t, t + d)) rest = true;
      if (rest) {
        this.notes.push({ t, d, p: null });
        continue;
      }
      const changed = chord !== this.lastChord;
      this.lastChord = chord;
      const p = this.choosePitch(chord!, strongBeat || changed);
      this.notes.push({ t, d, p });
    }
  }

  // ---- Solo: long lines -------------------------------------------------------------
  private phraseStep = 0;

  /**
   * A singing line, in the manner of the long solos over slow chord drifts: one long note per
   * chord, landing on its colour tones (3rd, 9th, 7th, ♯11) and moving by step in arched
   * phrases; now and then an approach note or a little turn leads into the next chord, and the
   * line breathes between phrases. Notes glide into each other slowly.
   */
  private extendSolo(until: number, ctx: MelodyContext, hardStop: boolean): void {
    const rng = this.pitchRng;
    const glide = Math.max(this.cfg.melody.glide, 0.38);
    let guard = 0;
    while (this.cursor < until - 1e-6 && guard++ < 5000) {
      const t = this.cursor;
      const chord = ctx.chordAt(t + 0.05);
      let end = Math.min(ctx.nextChangeAfter(t + 0.05), t + 8 * this.beatSec);
      if (!Number.isFinite(end)) end = t + 4 * this.beatSec;
      if (hardStop) end = Math.min(end, until);
      const span = end - t;
      this.cursor = end;
      if (span <= 0.05 || !chord) {
        if (span > 0) this.notes.push({ t, d: Math.max(span, 0.01), p: null });
        continue;
      }
      // Phrases of four chords; a breath (rest) now and then after a phrase.
      const pos = this.phraseStep++ % 4;
      if (pos === 0 && this.phraseStep > 4 && rng() < 0.3 - 0.2 * this.cfg.melody.density) {
        this.notes.push({ t, d: span, p: null });
        this.lastChord = chord;
        continue;
      }
      // "Gaps": rest while the chord glides in, then sing once it has settled.
      let tt = t;
      if (this.cfg.melody.fill === 'gaps' && chord.settled + 0.08 > t) {
        if (chord.settled >= end - 0.3) {
          // Never settles before the next change: rest through it.
          this.notes.push({ t, d: span, p: null });
          this.lastChord = chord;
          continue;
        }
        tt = Math.max(t, chord.settled + 0.08);
        if (tt > t) this.notes.push({ t, d: tt - t, p: null });
      }
      const from = this.pitch;
      const main = this.soloTarget(chord, pos);
      const room = (end - tt) / this.beatSec;
      const roll = rng();
      if (room >= 3 && roll < 0.22) {
        // A turn into the next chord: upper neighbour, back, lower neighbour… then on.
        const quick = Math.min(0.22, this.beatSec * 0.28);
        const hold = end - tt - 3 * quick;
        const up = this.scaleNeighbour(chord, main, 1);
        const down = this.scaleNeighbour(chord, main, -1);
        this.notes.push({ t: tt, d: hold, p: main, glide, from });
        this.notes.push({ t: tt + hold, d: quick, p: up, glide: quick * 0.4, from: main });
        this.notes.push({ t: tt + hold + quick, d: quick, p: main, glide: quick * 0.4, from: up });
        this.notes.push({ t: tt + hold + 2 * quick, d: quick, p: down, glide: quick * 0.4, from: main });
        this.pitch = down;
      } else if (room >= 3 && roll < 0.5) {
        // Hold, then step toward where the line is heading (an approach note).
        const hold = (end - tt) * (0.65 + rng() * 0.1);
        const approach = this.scaleNeighbour(chord, main, this.dir);
        this.notes.push({ t: tt, d: hold, p: main, glide, from });
        this.notes.push({ t: tt + hold, d: end - tt - hold, p: approach, glide: glide * 0.7, from: main });
        this.pitch = approach;
      } else {
        this.notes.push({ t: tt, d: end - tt, p: main, glide, from });
        this.pitch = main;
      }
      this.lastChord = chord;
    }
  }

  /** The note to land on for a chord: a colour tone, near the line, following the phrase's arch. */
  private soloTarget(chord: ChordSpec, pos: number): number {
    const [lo, hi] = this.range;
    const rng = this.pitchRng;
    // The arch: rise through the first half of a phrase, fall through the second.
    this.dir = pos < 2 ? 1 : -1;
    if (this.pitch >= hi - 2) this.dir = -1;
    if (this.pitch <= lo + 2) this.dir = 1;
    const colour: Record<number, number> = { 4: 3, 3: 3, 2: 3, 14: 3, 11: 2, 10: 2, 6: 2, 18: 2, 9: 1.6, 7: 1.4, 0: 0.9, 5: 0.7 };
    const want = new Map<number, number>();
    for (const iv of chord.intervals) want.set(mod12(chord.root + iv), Math.max(want.get(mod12(chord.root + iv)) ?? 0, colour[iv] ?? colour[mod12(iv)] ?? 1));
    const pool: number[] = [];
    const weights: number[] = [];
    for (let n = lo; n <= hi; n++) {
      const w0 = want.get(mod12(n));
      if (!w0) continue;
      const dist = n - this.pitch;
      let w = w0 * Math.exp(-Math.abs(dist) / 2.2);
      if (dist !== 0 && Math.sign(dist) === this.dir) w *= 2.2;
      if (dist === 0) w *= 0.5; // holding over a change is fine, but moving sings more
      if (Math.abs(dist) > 7) w *= 0.1;
      pool.push(n);
      weights.push(w);
    }
    return pool.length ? weighted(rng, pool, weights) : this.pitch;
  }

  /** The scale note one step above (dir 1) or below (dir -1) n, avoiding a semitone over a chord tone. */
  private scaleNeighbour(chord: ChordSpec, n: number, dir: number): number {
    const scale = scalePcs(chord.tonic, chord.scale);
    for (let k = 1; k <= 3; k++) {
      const m = n + dir * k;
      if (scale.has(mod12(m))) return m;
    }
    return n + dir * 2;
  }

  private choosePitch(chord: ChordSpec, strong: boolean): number {
    const [lo, hi] = this.range;
    const chordPcs = new Set(chord.intervals.map((i) => mod12(chord.root + i)));
    const scale = scalePcs(chord.tonic, chord.scale);
    const chordNotes: number[] = [];
    const passing: number[] = [];
    for (let n = lo; n <= hi; n++) {
      const pc = mod12(n);
      if (chordPcs.has(pc)) chordNotes.push(n);
      // Avoid notes: a semitone above a chord tone clashes when held.
      if (chordPcs.has(pc) || (scale.has(pc) && !chordPcs.has(mod12(pc - 1)))) passing.push(n);
    }
    const rng = this.pitchRng;
    const cur = this.pitch;
    if (cur <= lo + 2) this.dir = 1;
    else if (cur >= hi - 2) this.dir = -1;
    else if (rng() < 0.18) this.dir = -this.dir;

    let pool: number[];
    let weights: number[];
    if (strong || !passing.length) {
      pool = chordNotes.length ? chordNotes : passing;
      weights = pool.map((n) => {
        const dist = Math.abs(n - cur);
        let w = Math.exp(-dist / 3);
        if (Math.sign(n - cur) === this.dir) w *= 1.6;
        if (n === cur && this.repeats >= 1) w *= 0.15;
        return w;
      });
    } else if (rng() < 0.12 && chordNotes.length) {
      // An occasional leap to a chord tone a 4th–6th away.
      pool = chordNotes.filter((n) => Math.abs(n - cur) >= 5 && Math.abs(n - cur) <= 9);
      if (!pool.length) pool = chordNotes;
      weights = pool.map(() => 1);
    } else {
      // Step through the scale, mostly in the current direction.
      const idx = passing.reduce((best, n, i) => (Math.abs(n - cur) < Math.abs(passing[best] - cur) ? i : best), 0);
      pool = [];
      weights = [];
      for (const off of [-2, -1, 1, 2]) {
        const n = passing[idx + off];
        if (n === undefined) continue;
        pool.push(n);
        weights.push((Math.abs(off) === 1 ? 3 : 1) * (Math.sign(off) === this.dir ? 2.5 : 1));
      }
      if (!pool.length) {
        pool = passing;
        weights = passing.map(() => 1);
      }
    }
    const p = weighted(rng, pool, weights);
    this.repeats = p === cur ? this.repeats + 1 : 0;
    this.pitch = p;
    return p;
  }
}
