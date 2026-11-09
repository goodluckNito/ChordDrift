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
