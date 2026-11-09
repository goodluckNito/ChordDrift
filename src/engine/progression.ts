import type { ChordDriftConfig } from './config';
import { pick, weighted, type Rng } from './rng';
import { CHORD_TYPES, KEY_NAMES, chordPcs, isDiatonic, mod12, romanNumeral, scalePcs, type Quality } from './theory';

export interface ChordSpec {
  root: number;
  type: string;
  keyPc: number;
  roman: string;
  /** How the chord was chosen: diatonic, borrowed (modal interchange), mediant, pivot, chromatic, cadence. */
  origin: 'diatonic' | 'borrowed' | 'mediant' | 'pivot' | 'chromatic' | 'cadence';
}

/** Scale degrees as semitones above the tonic. vii° is left out on purpose. */
const DEGREES = [0, 2, 4, 5, 7, 9];

/** Weighted random walk over degrees: from -> {to: weight}. Loosely functional harmony. */
const WALK: Record<number, Record<number, number>> = {
  0: { 2: 2, 4: 1.5, 5: 3, 7: 1, 9: 3 },
  2: { 7: 3, 5: 1.5, 4: 1, 9: 1 },
  4: { 9: 3, 5: 2.5, 2: 1 },
  5: { 0: 1.5, 7: 2, 2: 1.5, 4: 1, 9: 1.5 },
  7: { 0: 1.5, 9: 2.5, 5: 1, 4: 1 },
  9: { 2: 2, 5: 3, 4: 2, 7: 1, 0: 0.5 },
};

const typesOf = (types: string[], qualities: Quality[]) => types.filter((t) => qualities.includes(CHORD_TYPES[t].quality));

function typeWeight(type: string, degree: number): number {
  const q = CHORD_TYPES[type].quality;
  let w = CHORD_TYPES[type].weight;
  // Sus and dominant colours belong on V; elsewhere they are rare spice.
  if (degree === 7 && (q === 'sus' || q === 'dominant')) w *= 3;
  else if (q === 'dominant') w *= 0.2;
  // With 13 voices, four-note chords force octave doublings of everything and
  // make whole stacks shift; richer chords give the upper voices room to stay put.
  else if (CHORD_TYPES[type].intervals.length === 4) w *= 0.6;
  return w;
}

export type CostFn = (spec: ChordSpec) => number;

/**
 * Generates chords one at a time. The score generator calls next() for each
 * position and supplies a cost function (voice-leading cost of a candidate from
 * the current voicing), which chromatic mode uses to keep movement smooth.
 */
export class ProgressionWalker {
  key: number;
  private prev: ChordSpec | null = null;
  private prevPrev: ChordSpec | null = null;
  private prevDegree: number | null = null;

  constructor(
    private cfg: ChordDriftConfig,
    initialKey: number,
    private rng: Rng,
  ) {
    this.key = initialKey;
  }

  next(index: number, total: number, cost: CostFn): ChordSpec {
    const isFirst = index === 0;
    const isLast = index === total - 1 && total > 1;
    // Draw a few legal candidates from the generator, then prefer the ones that
    // voice-lead smoothly (many common tones = few moving voices = calm).
    const pool: ChordSpec[] = [];
    const want = isFirst || this.cfg.smoothness <= 0 ? 1 : 4;
    for (let attempt = 0; attempt < 32 && pool.length < want; attempt++) {
      const s = this.propose(isFirst, isLast, cost);
      if (!s || (this.prev && s.root === this.prev.root)) continue;
      // Discourage A–B–A ping-pong (e.g. I–V–I–V).
      if (!isLast && this.prevPrev && s.root === this.prevPrev.root && this.rng() < 0.8) continue;
      if (pool.some((p) => p.root === s.root && p.type === s.type)) continue;
      pool.push(s);
    }
    let spec: ChordSpec;
    if (pool.length > 1) {
      const costs = pool.map(cost);
      const min = Math.min(...costs);
      spec = weighted(this.rng, pool, costs.map((c) => Math.exp(-((c - min) * this.cfg.smoothness) / 2)));
    } else {
      // Guard rails failed (tiny vocabulary): accept any diatonic chord with a new root.
      spec = pool[0] ?? this.diatonic(true) ?? this.fallback();
    }
    if (spec.origin === 'pivot') this.key = spec.keyPc;
    this.prevPrev = this.prev;
    this.prev = spec;
    const deg = mod12(spec.root - this.key);
    this.prevDegree = DEGREES.includes(deg) && isDiatonic(spec.root, spec.type, this.key) ? deg : null;
    return spec;
  }

  private propose(isFirst: boolean, isLast: boolean, cost: CostFn): ChordSpec | null {
    if (isFirst) return this.first();
    if (isLast) return this.cadence();
    if (this.cfg.mode === 'chromatic') return this.chromatic(cost);
    if (this.cfg.mode === 'drift' && this.rng() < this.cfg.driftProbability) return this.borrow();
    return this.diatonic();
  }

  private make(root: number, type: string, origin: ChordSpec['origin'], keyPc = this.key): ChordSpec {
    const r = mod12(root);
    let roman = romanNumeral(r, type, keyPc);
    if (origin === 'pivot') roman += ` (→ ${KEY_NAMES[keyPc]})`;
    return { root: r, type, keyPc, roman, origin };
  }

  /** Pick a type for a diatonic degree of `key`. */
  private typeFor(degree: number, key: number): string | null {
    const root = mod12(key + degree);
    const types = this.cfg.chordTypes.filter((t) => isDiatonic(root, t, key));
    if (!types.length) return null;
    return weighted(this.rng, types, types.map((t) => typeWeight(t, degree)));
  }

  private degreeChord(degree: number, origin: ChordSpec['origin'], key = this.key): ChordSpec | null {
    const t = this.typeFor(degree, key);
    return t ? this.make(key + degree, t, origin, key) : null;
  }

  private first(): ChordSpec | null {
    const d = weighted(this.rng, [0, 9, 5], [0.8, 0.1, 0.1]);
    return this.degreeChord(d, 'diatonic');
  }

  private diatonic(anyNewRoot = false): ChordSpec | null {
    const from = this.prevDegree ?? 0;
    const opts = WALK[from] ?? WALK[0];
    let degrees = Object.keys(opts).map(Number);
    let weights = degrees.map((d) => opts[d]);
    if (anyNewRoot) {
      degrees = DEGREES.filter((d) => !this.prev || mod12(this.key + d) !== this.prev.root);
      weights = degrees.map(() => 1);
    }
    const d = weighted(this.rng, degrees, weights);
    return this.degreeChord(d, 'diatonic');
  }

  /** Last chord before Arrival: something that leads home (V, IV, or bVII in drift). */
  private cadence(): ChordSpec | null {
    const opts: { interval: number; w: number; qualities: Quality[] }[] = [
      { interval: 7, w: 3, qualities: ['sus', 'dominant', 'major'] },
      { interval: 5, w: 2, qualities: ['major', 'minor'] },
    ];
    if (this.cfg.mode !== 'diatonic') opts.push({ interval: 10, w: 2, qualities: ['major', 'dominant'] });
    const o = weighted(this.rng, opts, opts.map((x) => x.w));
    const root = mod12(this.key + o.interval);
    // Prefer diatonic colours for V and IV; bVII is borrowed by definition.
    let types = this.cfg.chordTypes.filter((t) => isDiatonic(root, t, this.key));
    if (o.interval === 10 || !types.length) types = typesOf(this.cfg.chordTypes, o.qualities);
    if (!types.length) return null;
    const t = weighted(this.rng, types, types.map((x) => typeWeight(x, o.interval === 10 ? 7 : o.interval)));
    return this.make(root, t, 'cadence');
  }

  /** Drift mode: modal interchange, chromatic mediant, or pivot to a neighbouring key. */
  private borrow(): ChordSpec | null {
    const kind = weighted(this.rng, ['interchange', 'mediant', 'pivot'] as const, [0.5, 0.25, 0.25]);
    const types = this.cfg.chordTypes;
    if (kind === 'interchange') {
      const choices = [
        { interval: 5, q: ['minor'] as Quality[] }, // iv
        { interval: 8, q: ['major'] as Quality[] }, // bVI
        { interval: 10, q: ['major', 'dominant'] as Quality[] }, // bVII
        { interval: 3, q: ['major'] as Quality[] }, // bIII
      ];
      const c = pick(this.rng, choices);
      const ts = typesOf(types, c.q);
      return ts.length ? this.make(this.key + c.interval, pick(this.rng, ts), 'borrowed') : null;
    }
    if (kind === 'mediant') {
      const from = this.prev?.root ?? this.key;
      const ts = typesOf(types, ['major']);
      return ts.length ? this.make(from + pick(this.rng, [3, 4, -3, -4]), pick(this.rng, ts), 'mediant') : null;
    }
    // Pivot: move to the neighbouring key that shares the most notes with the current chord.
    const prevPcs = this.prev ? chordPcs(this.prev.root, this.prev.type) : [this.key];
    const keys = [7, 5, 2, 10, 9, 3].map((i) => mod12(this.key + i));
    const shared = keys.map((k) => {
      const s = scalePcs(k);
      return prevPcs.filter((pc) => s.has(pc)).length;
    });
    const newKey = weighted(this.rng, keys, shared.map((n) => Math.pow(2, n)));
    const degree = weighted(this.rng, [2, 5, 7, 9], [2, 2, 1, 2]);
    return this.degreeChord(degree, 'pivot', newKey);
  }

  /** Chromatic mode: any root, any type, chosen with a strong preference for smooth voice leading. */
  private chromatic(cost: CostFn): ChordSpec | null {
    const cands: ChordSpec[] = [];
    for (let i = 0; i < 10; i++) {
      const root = Math.floor(this.rng() * 12);
      if (this.prev && root === this.prev.root) continue;
      cands.push(this.make(root, pick(this.rng, this.cfg.chordTypes), 'chromatic'));
    }
    if (!cands.length) return null;
    const costs = cands.map(cost);
    const min = Math.min(...costs);
    return weighted(this.rng, cands, costs.map((c) => Math.exp(-(c - min) / 3)));
  }

  private fallback(): ChordSpec {
    const t = this.cfg.chordTypes[0];
    const root = mod12((this.prev?.root ?? this.key) + 5);
    return this.make(root, t, 'diatonic');
  }
}
