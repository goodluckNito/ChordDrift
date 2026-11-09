import type { Rng } from './rng';
import { requiredTones, type Chord } from './chords';
import { mod12 } from './theory';

/**
 * Voicing and voice leading — the musical core.
 *
 * A voicing is a sorted array of MIDI notes: index 0 is the bass, the rest are
 * the upper voices. Voices are matched sorted-to-sorted, so they never cross.
 *
 * Instead of sampling random voicings and hoping one is smooth, we search the
 * space directly with dynamic programming: assign each current upper voice
 * (low to high) a strictly higher target note than the voice below, tracking
 * which required chord tones have been used. The DP finds the cheapest legal
 * voicing exactly; re-running it with small seeded noise on the costs yields a
 * pool of near-optimal alternatives, which are then checked against rules the
 * DP cannot express (pitch-class doubling) and scored with the true cost.
 */

export interface VoicingRules {
  bass: [number, number];
  upper: [number, number];
  mudFloor: number;
  minGap: number;
  maxCopies: number;
  pedalBonus: number;
  bassWeight: number;
  /** Extra cost for each upper voice that moves at all (favours few movers, long plateaus). */
  movePenalty: number;
  candidates: number;
}


interface Level {
  lo: number;
  hi: number;
  cap: number;
  strict: boolean;
}

/** Progressively relaxed search spaces, used only when stricter ones have no solution. */
function levels(r: VoicingRules): Level[] {
  const [lo, hi] = r.upper;
  return [
    { lo, hi, cap: r.maxCopies, strict: true },
    { lo: lo - 5, hi, cap: r.maxCopies, strict: true },
    // Allow an extra doubling before widening the top, which would break the pedal.
    { lo: lo - 5, hi, cap: r.maxCopies + 1, strict: true },
    { lo: lo - 5, hi: hi + 5, cap: r.maxCopies + 1, strict: true },
    // Sparse chords (sus2, 5ths, pentatonic colours) need more room before doubling unisons.
    { lo: lo - 7, hi: hi + 12, cap: Infinity, strict: true },
    { lo: lo - 7, hi: hi + 12, cap: Infinity, strict: false },
  ];
}

export function chooseBass(root: number, currentBass: number, range: [number, number]): number {
  let best = -1;
  for (let n = range[0]; n <= range[1]; n++) {
    if (mod12(n) !== mod12(root)) continue;
    if (best < 0 || Math.abs(n - currentBass) < Math.abs(best - currentBass)) best = n;
  }
  if (best >= 0) return best;
  // Range narrower than an octave and missing the root: nearest root to the range.
  const mid = (range[0] + range[1]) / 2;
  return Math.round((mid - mod12(root)) / 12) * 12 + mod12(root);
}

/** The true cost of moving from one voicing to another. */
export function voiceLeadingCost(
  from: number[],
  to: number[],
  rules: Pick<VoicingRules, 'bassWeight' | 'pedalBonus' | 'movePenalty'>,
  pedalOk = true,
): number {
  let cost = rules.bassWeight * Math.abs(to[0] - from[0]);
  for (let i = 1; i < to.length; i++) {
    const d = Math.abs(to[i] - from[i]);
    cost += d + (d > 0 ? rules.movePenalty : 0);
  }
  const top = to.length - 1;
  if (pedalOk && to[top] === from[top]) cost -= rules.pedalBonus;
  return cost;
}

function validStep(a: number, b: number, isBass: boolean, rules: VoicingRules, strict: boolean): boolean {
  if (b < a) return false;
  if (b === a && (strict || isBass)) return false;
  if (b === a) return a >= rules.mudFloor; // unison doubling only allowed up high, relaxed level only
  if (a < rules.mudFloor && b - a < rules.minGap) return false;
  return true;
}

/**
 * One DP pass. Returns the chosen upper notes, or null if impossible.
 * costNoise > 0 perturbs per-(voice, note) costs to explore alternatives.
 */
function solve(
  bass: number,
  current: number[],
  notes: number[],
  requiredPcs: number[],
  rules: VoicingRules,
  strict: boolean,
  rng: Rng | null,
  costNoise: number,
): number[] | null {
  const U = current.length - 1;
  const M = notes.length;
  const R = requiredPcs.length;
  const S = 1 << R;
  const full = S - 1;
  if (M === 0 || U === 0) return U === 0 ? [] : null;

  const bit = notes.map((n) => {
    const idx = requiredPcs.indexOf(mod12(n));
    return idx >= 0 ? 1 << idx : 0;
  });
  const top = current[U];
  const cost = new Float64Array(U * M);
  for (let i = 0; i < U; i++) {
    for (let j = 0; j < M; j++) {
      const d = Math.abs(notes[j] - current[i + 1]);
      let c = d + (d > 0 ? rules.movePenalty : 0);
      if (i === U - 1 && notes[j] === top) c -= rules.pedalBonus;
      if (rng && costNoise > 0) c += costNoise * rng();
      cost[i * M + j] = c;
    }
  }

  const INF = Number.POSITIVE_INFINITY;
  const dp = new Float64Array(U * M * S).fill(INF);
  const back = new Int32Array(U * M * S).fill(-1);
  const at = (i: number, j: number, m: number) => (i * M + j) * S + m;

  for (let j = 0; j < M; j++) {
    if (!validStep(bass, notes[j], true, rules, strict)) continue;
    dp[at(0, j, bit[j])] = cost[j];
  }
  for (let i = 1; i < U; i++) {
    for (let j = 0; j < M; j++) {
      const cij = cost[i * M + j];
      for (let jp = 0; jp <= j; jp++) {
        if (!validStep(notes[jp], notes[j], false, rules, strict)) continue;
        for (let m = 0; m < S; m++) {
          const prev = dp[at(i - 1, jp, m)];
          if (prev === INF) continue;
          const m2 = m | bit[j];
          const k = at(i, j, m2);
          const v = prev + cij;
          if (v < dp[k]) {
            dp[k] = v;
            back[k] = jp * S + m;
          }
        }
      }
    }
  }

  let bestJ = -1;
  let bestV = INF;
  for (let j = 0; j < M; j++) {
    const v = dp[at(U - 1, j, full)];
    if (v < bestV) {
      bestV = v;
      bestJ = j;
    }
  }
  if (bestJ < 0) return null;

  const out = new Array<number>(U);
  let j = bestJ;
  let m = full;
  for (let i = U - 1; i >= 0; i--) {
    out[i] = notes[j];
    if (i === 0) break;
    const b = back[at(i, j, m)];
    j = Math.floor(b / S);
    m = b % S;
  }
  return out;
}

function pcCountsOk(upper: number[], cap: number): boolean {
  if (!Number.isFinite(cap)) return true;
  const counts = new Array(12).fill(0);
  for (const n of upper) if (++counts[mod12(n)] > cap) return false;
  return true;
}

/**
 * Voice `chord` so that moving from `current` costs as little as possible.
 * Deterministic for a given rng state. `rng` null = single noiseless search
 * (used for cheap cost estimates).
 */
export function voiceChord(chord: Chord, current: number[], rules: VoicingRules, rng: Rng | null): number[] {
  const U = current.length - 1;
  const bass = chooseBass(chord.root, current[0], rules.bass);
  const pcs = new Set(chord.intervals.map((i) => mod12(chord.root + i)));
  const required = requiredTones(chord.intervals).map((i) => mod12(chord.root + i)).slice(0, Math.max(0, U));
  const top = current[U];
  const pedalOk = pcs.has(mod12(top));

  for (const level of levels(rules)) {
    const notes: number[] = [];
    for (let n = Math.max(level.lo, bass + 1); n <= level.hi; n++) if (pcs.has(mod12(n))) notes.push(n);

    const runs = rng ? rules.candidates : 1;
    const seen = new Set<string>();
    let best: number[] | null = null;
    let bestCost = Infinity;
    let ties = 0;
    for (let r = 0; r < runs; r++) {
      const upper = solve(bass, current, notes, required, rules, level.strict, rng, r === 0 ? 0 : 0.9);
      if (!upper) break; // infeasible at this level regardless of noise
      const key = upper.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      if (!pcCountsOk(upper, level.cap)) continue;
      const voicing = [bass, ...upper];
      const c = voiceLeadingCost(current, voicing, rules, pedalOk);
      if (c < bestCost - 1e-9) {
        best = voicing;
        bestCost = c;
        ties = 1;
      } else if (Math.abs(c - bestCost) <= 1e-9 && rng) {
        // Reservoir-style seeded tie break.
        ties++;
        if (rng() < 1 / ties) best = voicing;
      }
    }
    if (best) return best;
  }
  // Unreachable in practice (the last level allows doublings); keep a safe fallback.
  return [bass, ...current.slice(1).map(() => bass + 12)];
}

/**
 * A neutral "spread" voicing used as the reference for the very first chord, so
 * the bloom fans out across the whole range instead of hugging the start note.
 */
export function spreadTemplate(voices: number, startNote: number, rules: VoicingRules): number[] {
  const U = voices - 1;
  const lo = rules.upper[0] + 2;
  const hi = rules.upper[1];
  const out = [startNote];
  for (let i = 0; i < U; i++) {
    // Slightly denser toward the top, like a natural open voicing.
    const x = U === 1 ? 1 : i / (U - 1);
    out.push(Math.round(lo + (hi - lo) * Math.pow(x, 0.85)));
  }
  return out;
}
