import { COLOUR_BY_COMPLEXITY, SIZE_BY_COMPLEXITY, alterChord, chordName, chordSuffix, colourVariant, isMinorish, palette, pcOverlap, romanName, stackChord, suffixIntervals, type Chord } from './chords';
import type { ChordDriftConfig } from './config';
import { parseProgression, type ProgressionToken } from './progression-text';
import { STYLES, StylePlanner, type PlanItem } from './styles';
import { hashSeed, pick, stream, weighted, type Rng } from './rng';
import { PARALLEL_SCALES, SCALES, mod12, romanFor, scalePcs, scaleSteps, tonicName } from './theory';

export type ChordOrigin = 'passing' | 'scale' | 'altered' | 'secondary' | 'borrowed' | 'mediant' | 'pivot' | 'modulation' | 'voiceled' | 'free' | 'cadence' | 'written';

export interface ChordSpec extends Chord {
  /** Tonic and scale the chord was heard in (changes after a pivot). */
  tonic: number;
  scale: string;
  name: string;
  roman: string;
  origin: ChordOrigin;
  /** A written slash bass (pitch class), when the progression asked for one. */
  bass?: number;
}

/**
 * Root-motion preferences, by semitones from the previous root. Generic
 * functional-harmony instincts that work in any scale: falling fifths
 * (I→IV, ii→V, V→I) and falling thirds (I→vi, vi→IV) are strongest.
 */
const MOTION: Record<number, number> = { 5: 3, 8: 2.5, 9: 2.5, 7: 1.5, 2: 1.5, 3: 1.2, 4: 1.2, 10: 1, 11: 0.6, 1: 0.4, 6: 0.3 };

export type CostFn = (chord: Chord) => number;

const MAJOR_FAMILY = ['', 'maj7', 'maj9', 'maj9#11', 'maj13'];
const DOMINANT_FAMILY = ['', '7', '9', '13', '13'];
const MINOR_FAMILY = ['m', 'm7', 'm9', 'm11', 'm13'];

/**
 * Generates chords one at a time, so it can run forever (endless mode). The
 * score builder calls next() for each position and supplies a cost function —
 * the voice-leading cost of a candidate from the current voicing — which the
 * walker uses to prefer smooth, common-tone-rich moves.
 */
export class ProgressionWalker {
  tonic: number;
  scale: string;
  private prev: ChordSpec | null = null;
  private prevPrev: ChordSpec | null = null;
  /** The last few chords, for avoiding repeats. */
  private recent: ChordSpec[] = [];
  /** Root a secondary dominant wants to resolve to next. */
  private resolveTo: number | null = null;
  private sinceHome = 0;
  private complexity: number;
  /** Spice: its own stream (drawn whatever the setting), so the walker's other choices keep their randomness. */
  private spiceRng: Rng;

  /** Style planning: a fixed plan (finite pieces) or a planner pulled phrase by phrase (endless). */
  private plan: PlanItem[] | null = null;
  private planner: StylePlanner | null = null;
  private planQueue: PlanItem[] = [];

  constructor(
    private cfg: ChordDriftConfig,
    tonic: number,
    private rng: Rng,
    private tokens: ProgressionToken[] = [],
    styleRng?: Rng,
  ) {
    this.tonic = tonic;
    this.scale = SCALES[cfg.scale] ? cfg.scale : 'major';
    this.complexity = cfg.complexity;
    this.spiceRng = stream(hashSeed(tonic, String(cfg.seed)), 'spice');
    if (cfg.style !== 'none' && !tokens.length && styleRng) {
      const def = STYLES[cfg.style];
      this.complexity = Math.max(def.complexity[0], Math.min(def.complexity[1], cfg.complexity));
      this.planner = new StylePlanner(def, tonic, this.scale, styleRng, cfg.resolution);
    }
  }

  /** True when a style planner picks the chords. */
  get planned(): boolean {
    return this.planner !== null;
  }

  /**
   * Resolve written chords (the progression language) in the walker's current key, as if played:
   * used for cadences that end song parts.
   */
  resolveText(text: string, origin: ChordOrigin = 'cadence'): ChordSpec[] {
    const out: ChordSpec[] = [];
    for (const t of parseProgression(text).tokens) {
      if (t.kind !== 'chord') continue;
      const spec = this.resolve(t, origin);
      this.prevPrev = this.prev;
      this.prev = spec;
      this.recent = [...this.recent.slice(-3), spec];
      out.push(spec);
    }
    return out;
  }

  /** For finite styled pieces: plan the whole thing up front; returns the number of chords. */
  planPiece(phrases: number): number {
    if (!this.planner) return 0;
    this.plan = this.planner.planPiece(phrases);
    return this.plan.length;
  }

  private nextPlanned(index: number): PlanItem | null {
    if (this.plan) return this.plan[index] ?? null;
    if (!this.planner) return null;
    // Endless: keep at least one phrase queued so modulations can rewrite its ending.
    while (this.planQueue.length < 5) this.planQueue.push(...this.planner.nextPhrase(this.planQueue));
    return this.planQueue.shift()!;
  }

  /** total = number of chords for a finite piece, or null when endless. */
  next(index: number, total: number | null, cost: CostFn): ChordSpec {
    let spec: ChordSpec;
    const planned = this.planner ? this.nextPlanned(index) : null;
    const token = planned ? planned.token : this.tokens.length ? this.tokens[index % this.tokens.length] : null;
    if (planned) {
      // Styled: every chord is heard in its phrase's local key.
      this.tonic = planned.tonic;
      this.scale = planned.scale;
    }
    if (token && token.kind === 'chord') spec = this.resolve(token, planned?.origin, planned?.keyChange);
    else spec = this.generate(index === 0 && !token, !planned && total !== null && index === total - 1 && total > 1, cost);
    // Spice: now and then (mostly at key moments) a generated chord gets richer colour. Only what's
    // returned is spiced: the walker remembers the plain chord. (Later chords can still differ a
    // little, since they're chosen for smooth voice leading from the richer voicing.)
    let out = spec;
    if (!(token && token.kind === 'chord')) {
      const r = this.spiceRng();
      const pickR = this.spiceRng();
      if (this.cfg.spice > 0) {
        const key = spec.origin === 'cadence' || spec.origin === 'secondary' || isDominant(spec) || index % 4 === 3 || (total !== null && index === total - 2);
        if (r < (key ? this.cfg.spice : this.cfg.spice * 0.1)) out = this.spiced(spec, pickR);
      }
    }
    if (spec.origin === 'pivot') {
      this.tonic = spec.tonic;
      this.scale = spec.scale;
    }
    this.sinceHome = spec.root === this.tonic ? 0 : this.sinceHome + 1;
    this.prevPrev = this.prev;
    this.prev = spec;
    this.recent = [...this.recent.slice(-3), spec];
    return out;
  }

  // ---- Building blocks ------------------------------------------------------

  /** The same chord with richer colour: a dominant gets a 9th, 13th or (in minor) ♭9; others a 9th or 11th from the scale. */
  private spiced(spec: ChordSpec, r: number): ChordSpec {
    let intervals: number[] | null = null;
    if (isDominant(spec)) {
      const minorKey = isMinorish(stackChord(spec.tonic, spec.scale, 0, 3).intervals);
      const opts = minorKey ? ['7b9', '9', '13b9'] : ['9', '13', '13sus4'];
      intervals = suffixIntervals(opts[Math.floor(r * opts.length)]);
    } else {
      const d = this.degreeOf(spec.root, spec.tonic, spec.scale);
      if (d >= 0) {
        const rich = stackChord(spec.tonic, spec.scale, d, Math.max(5, spec.intervals.length + 1) + (r < 0.3 ? 1 : 0));
        if (rich.intervals.length > spec.intervals.length) intervals = rich.intervals;
      } else if (!spec.intervals.some((iv) => iv % 12 === 2)) intervals = [...spec.intervals, 14];
    }
    if (!intervals) return spec;
    const chord = { root: spec.root, intervals };
    return { ...spec, intervals, name: chordName(chord, spec.tonic, spec.scale), roman: spec.origin === 'secondary' ? spec.roman : romanName(chord, spec.tonic) };
  }

  private spec(chord: Chord, origin: ChordOrigin, tonic = this.tonic, scale = this.scale, target?: number): ChordSpec {
    let roman = romanName(chord, tonic);
    if (origin === 'pivot') roman += ` (→ ${tonicName(tonic, scale)})`;
    if (origin === 'secondary' && target !== undefined) {
      const t = stackChord(tonic, scale, Math.max(0, this.degreeOf(target, tonic, scale)), 3);
      roman = `V${chordSuffix(chord.intervals)}/${romanFor(target, tonic, isMinorish(t.intervals))}`;
    }
    return { root: mod12(chord.root), intervals: chord.intervals, tonic, scale, name: chordName(chord, tonic, scale), roman, origin };
  }

  private size(): number {
    const [sizes, weights] = SIZE_BY_COMPLEXITY[Math.max(1, Math.min(5, Math.round(this.complexity)))];
    return weighted(this.rng, sizes, weights);
  }

  /** The chord on a scale degree, coloured for the current complexity. */
  private scaleChord(degree: number, tonic = this.tonic, scale = this.scale): Chord {
    let chord = stackChord(tonic, scale, degree, this.size());
    const c = this.complexity;
    const r = this.rng();
    const susP = [0.04, 0.08, 0.14, 0.16, 0.2][c - 1] ?? 0.14;
    const sixP = c >= 2 ? 0.12 : 0;
    if (r < susP) chord = colourVariant(chord, tonic, scale, this.rng() < 0.7 ? 'sus4' : 'sus2') ?? chord;
    else if (r < susP + sixP) chord = colourVariant(chord, tonic, scale, 'six') ?? chord;
    return chord;
  }

  private familyChord(root: number, minor: boolean): Chord {
    const c = Math.max(1, Math.min(5, Math.round(this.complexity))) - 1;
    const scale = scalePcs(this.tonic, this.scale);
    const fam = minor ? MINOR_FAMILY : scale.has(mod12(root + 11)) || !scale.has(mod12(root + 10)) ? MAJOR_FAMILY : DOMINANT_FAMILY;
    return { root, intervals: suffixIntervals(fam[c])! };
  }

  private degreeOf(root: number, tonic = this.tonic, scale = this.scale): number {
    return scaleSteps(scale).indexOf(mod12(root - tonic));
  }

  // ---- Written progressions ---------------------------------------------------

  private resolve(token: Extract<ProgressionToken, { kind: 'chord' }>, origin: ChordOrigin = 'written', keyChange = false): ChordSpec {
    const steps = scaleSteps(this.scale);
    const ref = token.root;
    let root: number;
    let auto: Chord | null = null;
    if (ref.kind === 'absolute') root = ref.pc;
    else if (ref.kind === 'offset') root = mod12(this.tonic + ref.semitones);
    else if (ref.kind === 'roman') root = mod12(this.tonic + ref.semitones);
    else {
      const n = steps.length;
      root = mod12(this.tonic + steps[ref.degree % n] + ref.accidental);
      if (!token.intervals && ref.accidental === 0) auto = this.scaleChord(ref.degree % n);
    }
    let chord: Chord;
    if (token.intervals) chord = { root, intervals: token.intervals };
    else if (auto) chord = auto;
    else {
      const d = this.degreeOf(root);
      const wantMinor = ref.kind === 'roman' ? ref.minor : null;
      const stacked = d >= 0 ? this.scaleChord(d) : null;
      if (stacked && (wantMinor === null || isMinorish(stacked.intervals) === wantMinor)) chord = stacked;
      else chord = this.familyChord(root, wantMinor ?? false);
    }
    const spec = this.spec(chord, origin);
    if (token.bass !== undefined) spec.bass = token.bass;
    if (keyChange) spec.roman += ` (→ ${tonicName(this.tonic, this.scale)} ${this.scale === 'minor' ? 'minor' : this.scale === 'major' ? 'major' : SCALES[this.scale].name})`;
    return spec;
  }

  // ---- Generation ---------------------------------------------------------------

  private generate(isFirst: boolean, isLast: boolean, cost: CostFn): ChordSpec {
    const mode = this.cfg.mode;
    const want = isFirst || mode === 'free' ? 1 : mode === 'voiceled' ? 10 : this.cfg.smoothness > 0 ? 4 : 1;
    const pool: ChordSpec[] = [];
    // A secondary dominant usually resolves to its target.
    if (this.resolveTo !== null && !isLast) {
      const target = this.resolveTo;
      this.resolveTo = null;
      if (this.rng() < 0.85) {
        const d = this.degreeOf(target);
        const chord = d >= 0 ? this.scaleChord(d) : this.familyChord(target, false);
        return this.spec(chord, d >= 0 ? 'scale' : 'borrowed');
      }
    }
    const same = (a: Chord, b: Chord) => a.root === b.root && pcOverlap(a, b) === 1;
    for (let attempt = 0; attempt < 48 && pool.length < want; attempt++) {
      const s = this.propose(isFirst, isLast);
      if (!s) continue;
      if (this.prev && (same(s, this.prev) || (mode !== 'free' && pcOverlap(s, this.prev) === 1))) continue;
      if (this.prev && s.root === this.prev.root && mode !== 'free' && this.rng() < 0.85) continue;
      // Discourage A–B–A ping-pong (I–V–I–V) and recently heard chords.
      if (!isLast && this.prevPrev && s.root === this.prevPrev.root && this.rng() < 0.75) continue;
      if (!isLast && mode !== 'free' && this.recent.some((r) => same(r, s)) && this.rng() < 0.7) continue;
      if (pool.some((p) => same(p, s))) continue;
      pool.push(s);
    }
    // Resolution pull: make sure the strong moves are on the table — the tonic's dominant (a sus
    // dominant at higher complexity) and, after a dominant, the chord it resolves to.
    const pull = this.cfg.resolution;
    if (pull > 0 && !isFirst && !isLast && this.prev) {
      if (this.rng() < 0.35 + 0.5 * pull) {
        const dom = this.dominantOf(this.tonic);
        if (!pool.some((p) => same(p, dom)) && pcOverlap(dom, this.prev) < 1) pool.push(this.spec(dom, 'altered'));
      }
      if (isDominant(this.prev)) {
        const target = mod12(this.prev.root + 5);
        const d = this.degreeOf(target);
        const res = d >= 0 ? this.scaleChord(d) : this.familyChord(target, false);
        if (!pool.some((p) => same(p, res)) && pcOverlap(res, this.prev) < 1) pool.push(this.spec(res, d >= 0 ? 'scale' : 'borrowed'));
      }
    }
    if (!pool.length) return this.spec(this.scaleChord(Math.floor(this.rng() * scaleSteps(this.scale).length)), 'scale');
    const pickedSecondary = (s: ChordSpec) => {
      if (s.origin === 'secondary') this.resolveTo = mod12(s.root + 5);
      return s;
    };
    if (pool.length === 1) return pickedSecondary(pool[0]);
    const costs = pool.map(cost);
    const min = Math.min(...costs);
    const k = this.cfg.smoothness * (mode === 'voiceled' ? 1.5 : 1);
    const weights = pool.map((s, i) => {
      let w = Math.exp(-((costs[i] - min) * k) / 2);
      // Novelty: chords that share almost every note with the last one sound static.
      if (this.prev && mode !== 'free') w *= pcOverlap(s, this.prev) > 0.75 ? 0.35 : 1;
      if (pull > 0 && this.prev) w *= this.functionalPull(this.prev, s, pull);
      return w;
    });
    return pickedSecondary(weighted(this.rng, pool, weights));
  }

  /** A dominant on the fifth above `target`: 7th, 9th, or a 7sus4 / 9sus4 now and then (more at higher complexity). */
  private dominantOf(target: number): Chord {
    const root = mod12(target + 7);
    const c = Math.max(1, Math.min(5, Math.round(this.complexity)));
    const sus = this.rng() < 0.25 + 0.1 * c;
    const ext = c >= 3 ? [14] : [];
    return { root, intervals: sus ? [0, 5, 7, 10, ...ext] : [0, 4, 7, 10, ...ext] };
  }

  /**
   * How much a move from `a` to `b` pulls, as a weight multiplier: dominants resolving down a
   * fifth most, then any falling fifth, then a chord setting up a resolution; an unresolved
   * dominant is held back.
   */
  private functionalPull(a: Chord, b: Chord, pull: number): number {
    const fall5 = mod12(b.root - a.root) === 5;
    let bonus = 0;
    if (isDominant(a)) bonus += fall5 ? (b.root === this.tonic ? 6 : 4) : -0.6;
    else if (fall5) bonus += 2;
    if (isDominant(b) && mod12(b.root + 5) === this.tonic) bonus += 1.5;
    if (mod12(b.root - a.root) === 9 || mod12(b.root - a.root) === 8) bonus += 0.4; // falling thirds
    // Exponential, so it can hold its own against strong smoothness (which is exponential too).
    return Math.exp(pull * bonus * 1.2);
  }

  private propose(isFirst: boolean, isLast: boolean): ChordSpec | null {
    const mode = this.cfg.mode;
    if (isFirst) {
      if (mode === 'voiceled' || mode === 'free') return this.spec(this.familyChord(this.tonic, isMinorish(stackChord(this.tonic, this.scale, 0, 3).intervals)), mode);
      const n = scaleSteps(this.scale).length;
      const d = weighted(this.rng, [0, Math.min(5, n - 1), Math.min(3, n - 1)], [0.8, 0.1, 0.1]);
      return this.spec(this.scaleChord(d), 'scale');
    }
    if (isLast) return this.cadence();
    if (mode === 'voiceled' || mode === 'free') return this.anyChord(mode);
    if (mode === 'drift' && this.rng() < this.cfg.driftProbability) return this.borrow();
    return this.scaleStep();
  }

  /** Weighted walk over the scale's degrees by root motion. */
  private scaleStep(): ChordSpec {
    const steps = scaleSteps(this.scale);
    const from = this.prev?.root ?? this.tonic;
    const weights = steps.map((s) => {
      const root = mod12(this.tonic + s);
      let w = MOTION[mod12(root - from)] ?? 0;
      if (s === 0 && this.sinceHome >= 4) w *= 1.6; // gravity back to the tonic
      return w;
    });
    const d = weighted(this.rng, steps.map((_, i) => i), weights);
    const colour = COLOUR_BY_COMPLEXITY[Math.max(1, Math.min(5, Math.round(this.complexity)))];
    // Secondary dominant: the dominant of the chord we were heading to, which then resolves.
    if (d !== 0 && this.rng() < colour.secondary) {
      const target = mod12(this.tonic + steps[d]);
      const c = Math.round(this.complexity);
      const options = c >= 5 ? ['7b9', '7alt', '13b9', '7#9', '9', '13'] : c >= 4 ? ['9', '13', '7b9', '7'] : ['7', '9'];
      const chord = { root: mod12(target + 7), intervals: suffixIntervals(options[Math.floor(this.rng() * options.length)])! };
      return this.spec(chord, 'secondary', this.tonic, this.scale, target);
    }
    let chord = this.scaleChord(d);
    let origin: ChordOrigin = 'scale';
    if (this.rng() < colour.alter) {
      const altered = alterChord(chord, (n) => Math.floor(this.rng() * n));
      if (altered) {
        chord = altered;
        origin = 'altered';
      }
    }
    return this.spec(chord, origin);
  }

  /** Last chord before the arrival: something that leads home (V, IV, bVII…). */
  private cadence(): ChordSpec {
    const mode = this.cfg.mode;
    const options: [number, number][] = [
      [7, 3],
      [5, 2],
      [10, mode === 'scale' ? 0.5 : 1.5],
      [2, 0.5],
    ];
    if (mode === 'voiceled' || mode === 'free') {
      const [iv] = weighted(this.rng, options, options.map(([, w]) => w));
      const root = mod12(this.tonic + iv);
      const { suffixes, weights } = palette(this.complexity);
      return this.spec({ root, intervals: suffixIntervals(weighted(this.rng, suffixes, weights))! }, 'cadence');
    }
    const avail = options.filter(([iv]) => this.degreeOf(this.tonic + iv) >= 0);
    if (!avail.length) return { ...this.scaleStep(), origin: 'cadence' };
    const [iv] = weighted(this.rng, avail, avail.map(([, w]) => w));
    return this.spec(this.scaleChord(this.degreeOf(this.tonic + iv)), 'cadence');
  }

  /** Drift mode: modal interchange, chromatic mediant, or pivot to a neighbouring key. */
  private borrow(): ChordSpec | null {
    const kind = weighted(this.rng, ['interchange', 'mediant', 'pivot'] as const, [0.5, 0.25, 0.25]);
    const home = scalePcs(this.tonic, this.scale);
    if (kind === 'interchange') {
      const other = pick(this.rng, PARALLEL_SCALES.filter((s) => s !== this.scale));
      const n = scaleSteps(other).length;
      // Prefer chords that actually bring in a new colour.
      const cands = Array.from({ length: n }, (_, d) => stackChord(this.tonic, other, d, 4)).map((c, d) => ({
        d,
        fresh: c.intervals.filter((i) => !home.has(mod12(c.root + i))).length,
      }));
      const pickD = weighted(this.rng, cands.map((c) => c.d), cands.map((c) => (c.fresh > 0 && c.d !== 0 ? 1 + c.fresh : 0.05)));
      return this.spec(this.scaleChord(pickD, this.tonic, other), 'borrowed');
    }
    if (kind === 'mediant') {
      const from = this.prev?.root ?? this.tonic;
      const root = mod12(from + pick(this.rng, [3, 4, -3, -4]));
      return this.spec(this.familyChord(root, false), 'mediant');
    }
    // Pivot: move to the neighbouring key (same scale type) that shares the most notes with the current chord.
    const prevPcs = this.prev ? this.prev.intervals.map((i) => mod12(this.prev!.root + i)) : [this.tonic];
    const keys = [7, 5, 2, 10, 9, 3].map((i) => mod12(this.tonic + i));
    const shared = keys.map((k) => {
      const s = scalePcs(k, this.scale);
      return prevPcs.filter((pc) => s.has(pc)).length;
    });
    const newTonic = weighted(this.rng, keys, shared.map((n) => Math.pow(2, n)));
    const n = scaleSteps(this.scale).length;
    const d = 1 + Math.floor(this.rng() * (n - 1));
    return this.spec(this.scaleChord(d, newTonic, this.scale), 'pivot', newTonic, this.scale);
  }

  /** Voice-led / free modes: any root, any quality from the complexity palette. */
  private anyChord(origin: 'voiceled' | 'free'): ChordSpec {
    const root = Math.floor(this.rng() * 12);
    const { suffixes, weights } = palette(this.complexity);
    return this.spec({ root, intervals: suffixIntervals(weighted(this.rng, suffixes, weights))! }, origin);
  }
}

/** The chord on every degree of a scale at a given complexity (for the palette UI). */
export function scaleChords(tonic: number, scaleId: string, size: number): ChordSpec[] {
  return scaleSteps(scaleId).map((_, d) => {
    const chord = stackChord(tonic, scaleId, d, size);
    return { ...chord, tonic, scale: scaleId, name: chordName(chord, tonic, scaleId), roman: romanName(chord, tonic), origin: 'scale' as const };
  });
}

/** A dominant-function chord: a minor seventh with a major third or a sus4 (7, 9, 13, 7sus4, 9sus4…). */
function isDominant(c: Chord): boolean {
  const pcs = new Set(c.intervals.map(mod12));
  return pcs.has(10) && (pcs.has(4) || pcs.has(5)) && !pcs.has(3);
}
