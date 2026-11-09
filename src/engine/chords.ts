/**
 * Chord vocabulary: symbol table, naming, and building chords from scales.
 *
 * A chord is a root pitch class plus intervals in semitones above it
 * (extensions written above the octave: 14 = 9th, 17 = 11th, 21 = 13th).
 */
import { mod12, romanFor, scaleSteps, spellPc } from './theory';

export interface Chord {
  root: number;
  intervals: number[];
}

/** Canonical suffixes, in naming-preference order, with aliases accepted by the parser. */
const TABLE: [suffix: string, intervals: number[], aliases?: string[]][] = [
  ['', [0, 4, 7], ['maj', 'M', 'major']],
  ['m', [0, 3, 7], ['min', '-', 'minor']],
  ['5', [0, 7]],
  ['sus4', [0, 5, 7], ['sus']],
  ['sus2', [0, 2, 7]],
  ['dim', [0, 3, 6], ['°', 'o']],
  ['aug', [0, 4, 8], ['+']],
  ['maj7', [0, 4, 7, 11], ['M7', 'Δ', 'Δ7', 'ma7', 'major7']],
  ['m7', [0, 3, 7, 10], ['min7', '-7', 'mi7']],
  ['7', [0, 4, 7, 10], ['dom7']],
  ['6', [0, 4, 7, 9], ['M6', 'maj6']],
  ['m6', [0, 3, 7, 9], ['min6', '-6']],
  ['m7b5', [0, 3, 6, 10], ['ø', 'ø7', '-7b5', 'min7b5']],
  ['dim7', [0, 3, 6, 9], ['°7', 'o7']],
  ['mMaj7', [0, 3, 7, 11], ['m(maj7)', 'mM7', 'mΔ', 'minMaj7', '-Δ']],
  ['maj7#5', [0, 4, 8, 11], ['+M7', 'augMaj7', 'Δ#5']],
  ['7#5', [0, 4, 8, 10], ['aug7', '+7', '7+']],
  ['7sus4', [0, 5, 7, 10], ['7sus']],
  ['add9', [0, 4, 7, 14], ['add2']],
  ['madd9', [0, 3, 7, 14], ['m(add9)', 'madd2']],
  ['add11', [0, 4, 7, 17]],
  ['6/9', [0, 4, 7, 9, 14], ['69', '6add9']],
  ['m6/9', [0, 3, 7, 9, 14], ['m69']],
  ['maj9', [0, 4, 7, 11, 14], ['M9', 'Δ9', 'ma9']],
  ['m9', [0, 3, 7, 10, 14], ['min9', '-9', 'mi9']],
  ['9', [0, 4, 7, 10, 14], ['dom9']],
  ['9sus4', [0, 5, 7, 10, 14], ['9sus']],
  ['mMaj9', [0, 3, 7, 11, 14], ['m(maj9)', 'mM9']],
  ['m7add11', [0, 3, 7, 10, 17], ['m7(11)', 'm7add4']],
  ['maj7#11', [0, 4, 7, 11, 18], ['M7#11', 'Δ#11', 'maj7(#11)']],
  ['maj9#11', [0, 4, 7, 11, 14, 18], ['M9#11', 'Δ9#11']],
  ['m11', [0, 3, 7, 10, 14, 17], ['min11', '-11', 'mi11']],
  ['m11b5', [0, 3, 6, 10, 17], ['ø11']],
  ['maj11', [0, 4, 7, 11, 14, 17]],
  ['11', [0, 7, 10, 14, 17]],
  ['7#11', [0, 4, 7, 10, 18], ['7(#11)']],
  ['9#11', [0, 4, 7, 10, 14, 18]],
  ['7b9', [0, 4, 7, 10, 13], ['7(b9)']],
  ['7#9', [0, 4, 7, 10, 15], ['7(#9)']],
  ['7b13', [0, 4, 7, 10, 20]],
  ['7b9b13', [0, 4, 7, 10, 13, 20]],
  ['7alt', [0, 4, 10, 13, 15, 20], ['alt']],
  ['maj13', [0, 4, 7, 11, 14, 21], ['M13', 'Δ13']],
  ['maj13#11', [0, 4, 7, 11, 14, 18, 21], ['Δ13#11']],
  ['m13', [0, 3, 7, 10, 14, 17, 21], ['min13', '-13']],
  ['13', [0, 4, 7, 10, 14, 21], ['dom13']],
  ['13sus4', [0, 5, 7, 10, 14, 21], ['13sus']],
  ['13#11', [0, 4, 7, 10, 14, 18, 21]],
  ['13b9', [0, 4, 7, 10, 13, 21]],
  ['quartal', [0, 5, 10, 15], ['q', '4ths']],
];

const BY_SUFFIX = new Map<string, number[]>();
for (const [s, iv, aliases] of TABLE) {
  BY_SUFFIX.set(s, iv);
  for (const a of aliases ?? []) BY_SUFFIX.set(a, iv);
}

export const CHORD_SUFFIXES = TABLE.map(([s]) => s);

/** Intervals for a chord suffix ("maj7", "m11", "Δ9", "ø"…), or null. */
export function suffixIntervals(suffix: string): number[] | null {
  const s = suffix.trim();
  const hit = BY_SUFFIX.get(s) ?? BY_SUFFIX.get(s.replace(/[()]/g, ''));
  return hit ? [...hit] : null;
}

/** Pitch-class set signature, ignoring the root and the perfect fifth (both optional for naming). */
function signature(intervals: number[]): string {
  const set = new Set(intervals.map(mod12));
  set.delete(0);
  set.delete(7);
  return [...set].sort((a, b) => a - b).join(',');
}
const BY_SIGNATURE = new Map<string, string>();
for (const [s, iv] of TABLE) if (!BY_SIGNATURE.has(signature(iv))) BY_SIGNATURE.set(signature(iv), s);
// When the fifth is altered we can't ignore it; record exact sets too.
const BY_EXACT = new Map<string, string>();
for (const [s, iv] of TABLE) {
  const k = [...new Set(iv.map(mod12))].sort((a, b) => a - b).join(',');
  if (!BY_EXACT.has(k)) BY_EXACT.set(k, s);
}

const EXT_NAMES: Record<number, string> = { 1: 'b9', 2: '9', 3: '#9', 5: '11', 6: '#11', 8: 'b13', 9: '13' };

/** Name the chord quality for a set of intervals, e.g. [0,4,7,11,14] → "maj9". */
export function chordSuffix(intervals: number[]): string {
  const pcs = new Set(intervals.map(mod12));
  const exact = [...pcs].sort((a, b) => a - b).join(',');
  if (BY_EXACT.has(exact)) return BY_EXACT.get(exact)!;
  const sig = signature(intervals);
  if (pcs.has(7) && BY_SIGNATURE.has(sig)) return BY_SIGNATURE.get(sig)!;
  // Generic: base triad/seventh + listed tensions.
  const has = (n: number) => pcs.has(n);
  let base: string;
  const used = new Set<number>([0]);
  const third = has(4) ? 4 : has(3) ? 3 : null;
  if (third !== null) used.add(third);
  const seventh = has(11) ? 11 : has(10) ? 10 : null;
  if (seventh !== null) used.add(seventh);
  if (third === 3 && has(6) && !has(7)) {
    used.add(6);
    base = seventh === 10 ? 'm7b5' : has(9) && seventh === null ? 'dim7' : 'dim';
    if (base === 'dim7') used.add(9);
  } else {
    if (has(7)) used.add(7);
    const q = third === 3 ? 'm' : '';
    if (seventh === 11) base = third === 3 ? 'mMaj7' : 'maj7';
    else if (seventh === 10) base = q + '7';
    else if (third !== null && has(9)) {
      // No seventh but a sixth: 6, 6/9.
      used.add(9);
      base = q + (has(2) ? '6/9' : '6');
      if (has(2)) used.add(2);
    } else base = q;
    if (third === null) {
      const sus = has(5) ? 'sus4' : has(2) ? 'sus2' : '';
      if (sus) used.add(sus === 'sus4' ? 5 : 2);
      base = (seventh === 11 ? 'maj7' : seventh === 10 ? '7' : '') + sus;
    }
    if (!has(7) && has(8) && third === 4) {
      used.add(8);
      base += '#5';
    }
  }
  const tensions = [...pcs]
    .filter((p) => !used.has(p))
    .sort((a, b) => a - b)
    .map((p) => EXT_NAMES[p] ?? (p === 7 ? '5' : p === 4 ? '3' : p === 3 ? 'b3' : p === 10 ? 'b7' : p === 11 ? '7' : String(p)));
  return tensions.length ? `${base}(${tensions.join(',')})` : base;
}

/** Chord name with the root spelled in the given key, e.g. "E#m7b5" in F# major. */
export function chordName(chord: Chord, tonic = 0, scaleId = 'major'): string {
  return spellPc(chord.root, tonic, scaleId) + chordSuffix(chord.intervals);
}

export function isMinorish(intervals: number[]): boolean {
  const pcs = new Set(intervals.map(mod12));
  return pcs.has(3) && !pcs.has(4);
}

export function romanName(chord: Chord, tonic: number): string {
  const minor = isMinorish(chord.intervals);
  const suffix = chordSuffix(chord.intervals);
  // Lower-case numerals already say "minor"; drop the redundant leading m.
  const tail = minor && suffix.startsWith('m') && !suffix.startsWith('mMaj') ? suffix.slice(1) : minor && suffix.startsWith('mMaj') ? suffix.slice(1) : suffix;
  return romanFor(chord.root, tonic, minor) + tail;
}

/**
 * Upper-voice tones that must be present, most important first: the 3rd (or
 * sus), the 7th/6th, then extensions from the top down. Root and fifth are optional.
 */
export function requiredTones(intervals: number[]): number[] {
  const rank = (i: number) => {
    const p = mod12(i);
    if (p === 3 || p === 4) return 0;
    if (p === 10 || p === 11) return 1;
    if ((p === 5 || p === 2) && !intervals.some((x) => mod12(x) === 3 || mod12(x) === 4)) return 0;
    if (p === 6 && intervals.some((x) => mod12(x) === 3) && !intervals.some((x) => mod12(x) === 7)) return 0; // dim fifth
    if (p === 9 && !intervals.some((x) => mod12(x) === 10 || mod12(x) === 11)) return 1; // sixth chords
    return 2;
  };
  const seen = new Set<number>();
  const out: number[] = [];
  for (const i of [...intervals].sort((a, b) => rank(a) - rank(b) || b - a)) {
    const p = mod12(i);
    if (p === 0 || p === 7 || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * Build the chord on a scale degree by stacking every other scale note
 * ("thirds" within the scale) — works for any scale, not just major/minor.
 * Extensions that would sit a minor 9th above a lower chord tone (the classic
 * avoid notes, e.g. the 11th over a major 3rd) are dropped.
 */
export function stackChord(tonic: number, scaleId: string, degree: number, size: number): Chord {
  const steps = scaleSteps(scaleId);
  const n = steps.length;
  const d = ((degree % n) + n) % n;
  const base = steps[d];
  const tones: number[] = [];
  for (let k = 0; k < Math.max(2, size); k++) {
    const idx = d + 2 * k;
    const iv = steps[idx % n] + 12 * Math.floor(idx / n) - base;
    if (tones.some((lower) => mod12(lower) === mod12(iv))) continue; // symmetric scales wrap onto the root
    if (k >= 3 && tones.some((lower) => iv > lower && mod12(iv - lower) === 1)) continue;
    tones.push(iv);
  }
  return { root: mod12(tonic + base), intervals: tones };
}

/** Variants that keep the chord inside the scale: sus4 / sus2 instead of the 3rd, 6 instead of the 7th. */
export function colourVariant(chord: Chord, tonic: number, scaleId: string, kind: 'sus4' | 'sus2' | 'six'): Chord | null {
  const scale = new Set(scaleSteps(scaleId).map((s) => mod12(tonic + s)));
  const inScale = (iv: number) => scale.has(mod12(chord.root + iv));
  const iv = chord.intervals;
  const third = iv.findIndex((x) => x === 3 || x === 4);
  if (kind === 'six') {
    const seventh = iv.findIndex((x) => x === 10 || x === 11);
    if (seventh < 0 || iv[third] !== 4 || !inScale(9)) return null;
    const out = iv.filter((x) => x !== 21);
    out[out.indexOf(iv[seventh])] = 9;
    return { root: chord.root, intervals: [...new Set(out)].sort((a, b) => a - b) };
  }
  const repl = kind === 'sus4' ? 5 : 2;
  if (third < 0 || !inScale(repl)) return null;
  // maj7sus4 puts the 4th a semitone above the 7th's octave — harsh; skip it.
  if (kind === 'sus4' && iv.some((x) => mod12(x) === 11)) return null;
  const out = iv.filter((x) => mod12(x) !== repl);
  out[out.indexOf(iv[third])] = repl;
  return { root: chord.root, intervals: [...new Set(out)].sort((a, b) => a - b) };
}

/** Chord qualities by complexity tier, for scale-free (voice-led / free) generation. */
export const COMPLEXITY_TIERS: string[][] = [
  ['', 'm', 'sus4', 'sus2'],
  ['maj7', 'm7', '7', '6', 'm6', 'm7b5'],
  ['maj9', 'm9', '9', '6/9', 'add9', 'madd9', '7sus4', '9sus4'],
  ['maj9#11', 'm11', '13', '7#11', 'maj13', 'mMaj9', '13sus4', 'm7add11'],
  ['7b9', '7#9', '7alt', 'maj7#5', 'dim7', '13b9', 'm11b5', 'aug', '7#5', 'quartal'],
];

/** Weighted palette for a complexity level 1–5: its own tier dominates, lower tiers appear less. */
export function palette(complexity: number): { suffixes: string[]; weights: number[] } {
  const c = Math.max(1, Math.min(5, Math.round(complexity)));
  const suffixes: string[] = [];
  const weights: number[] = [];
  for (let t = 0; t < c; t++) {
    const w = t === c - 1 ? 3 : t === c - 2 ? 1 : 0.25;
    for (const s of COMPLEXITY_TIERS[t]) {
      suffixes.push(s);
      weights.push(w);
    }
  }
  return { suffixes, weights };
}

/** How many stacked tones a scale chord gets at each complexity level. */
export const SIZE_BY_COMPLEXITY: Record<number, [sizes: number[], weights: number[]]> = {
  1: [[3], [1]],
  2: [[3, 4], [0.2, 0.8]],
  3: [[4, 5, 6], [0.3, 0.45, 0.25]],
  4: [[5, 6, 7], [0.35, 0.4, 0.25]],
  5: [[6, 7], [0.4, 0.6]],
};

/** Most typical size for a complexity (used by the chord palette UI). */
export function typicalSize(complexity: number): number {
  const [sizes, weights] = SIZE_BY_COMPLEXITY[Math.max(1, Math.min(5, Math.round(complexity)))];
  return sizes[weights.indexOf(Math.max(...weights))];
}
