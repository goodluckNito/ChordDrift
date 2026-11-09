import { COLOUR_BY_COMPLEXITY, SIZE_BY_COMPLEXITY, alterChord, chordName, chordSuffix, colourVariant, isMinorish, palette, pcOverlap, romanName, stackChord, suffixIntervals, type Chord } from './chords';
import type { ChordDriftConfig } from './config';
import type { ProgressionToken } from './progression-text';
import { STYLES, StylePlanner, type PlanItem } from './styles';
import { pick, weighted, type Rng } from './rng';
import { PARALLEL_SCALES, SCALES, mod12, romanFor, scalePcs, scaleSteps, tonicName } from './theory';

export type ChordOrigin = 'scale' | 'altered' | 'secondary' | 'borrowed' | 'mediant' | 'pivot' | 'modulation' | 'voiceled' | 'free' | 'cadence' | 'written';

export interface ChordSpec extends Chord {
  /** Tonic and scale the chord was heard in (changes after a pivot). */
  tonic: number;
  scale: string;
  name: string;
  roman: string;
  origin: ChordOrigin;
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
    if (cfg.style !== 'none' && !tokens.length && styleRng) {
      const def = STYLES[cfg.style];
      this.complexity = Math.max(def.complexity[0], Math.min(def.complexity[1], cfg.complexity));
      this.planner = new StylePlanner(def, tonic, this.scale, styleRng);
    }
  }

  /** True when a style planner picks the chords. */
  get planned(): boolean {
    return this.planner !== null;
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
    if (spec.origin === 'pivot') {
      this.tonic = spec.tonic;
      this.scale = spec.scale;
    }
    this.sinceHome = spec.root === this.tonic ? 0 : this.sinceHome + 1;
    this.prevPrev = this.prev;
    this.prev = spec;
    this.recent = [...this.recent.slice(-3), spec];
    return spec;
  }

  // ---- Building blocks ------------------------------------------------------

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
      return w;
    });
    return pickedSecondary(weighted(this.rng, pool, weights));
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
