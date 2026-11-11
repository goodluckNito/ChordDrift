/**
 * Alternatives for a chord in the score, ranked by what people usually want to swap in:
 * chords that lead into the next one, the resolution of a dominant before it, smooth
 * substitutes that share notes, and a few borrowed colours.
 */
import { chordName, pcOverlap, romanName, stackChord, typicalSize, type Chord } from './chords';
import type { Score } from './score';
import { mod12, scaleSteps } from './theory';

export interface Alternative {
  chord: Chord;
  name: string;
  roman: string;
  /** Why it's offered, e.g. "leads into Fmaj7 (its dominant)". */
  why: string;
}

const isDominant = (c: Chord) => {
  const pcs = new Set(c.intervals.map(mod12));
  return pcs.has(10) && (pcs.has(4) || pcs.has(5)) && !pcs.has(3);
};

const SCALE_LABEL: Record<string, string> = {
  major: 'major key', minor: 'minor key', dorian: 'Dorian mode', phrygian: 'Phrygian mode', lydian: 'Lydian mode',
  mixolydian: 'Mixolydian mode', locrian: 'Locrian mode', harmonicMinor: 'harmonic minor', melodicMinor: 'melodic minor',
  phrygianDominant: 'Phrygian dominant',
};

/** Signature chords per mode: [offset from the tonic, intervals, why, only when swapping the tonic chord]. */
const MODAL: Record<string, [number, number[], string, boolean][]> = {
  phrygian: [
    [1, [0, 4, 7, 11], 'Phrygian ♭II, the mode’s signature (♭II → i is the Phrygian cadence)', false],
    [10, [0, 3, 7, 10], '♭vii, the mode’s own dominant (no leading tone)', false],
    [0, [0, 3, 7, 10, 13], 'i with the ♭9, the Phrygian tonic colour', true],
  ],
  phrygianDominant: [
    [1, [0, 4, 7, 11], '♭II, the Phrygian signature', false],
    [10, [0, 3, 7], '♭vii, the mode’s own', false],
  ],
  dorian: [
    [5, [0, 4, 7, 10], 'Dorian IV7, the mode’s bright 6th', false],
    [2, [0, 3, 7, 10], 'ii7, the Dorian lift', false],
  ],
  lydian: [
    [2, [0, 4, 7], 'Lydian II, the ♯4', false],
    [0, [0, 4, 7, 11, 18], 'Imaj7♯11, the Lydian tonic colour', true],
  ],
  mixolydian: [
    [10, [0, 4, 7], 'Mixolydian ♭VII, the mode’s signature', false],
    [7, [0, 3, 7, 10], 'v minor, the Mixolydian dominant', false],
  ],
  minor: [
    [8, [0, 4, 7, 11], '♭VI, the Aeolian lift', false],
    [10, [0, 4, 7], '♭VII, the natural-minor dominant', false],
  ],
  locrian: [[1, [0, 4, 7, 11], 'Locrian ♭II, the mode’s stable chord', false]],
};

/** Up to `max` alternatives for chord k, best first. */
export function chordAlternatives(score: Score, k: number, max = 10): Alternative[] {
  const c = score.chords[k];
  if (!c || c.unison) return [];
  const prev = k > 0 && !score.chords[k - 1].unison ? score.chords[k - 1] : null;
  const next = score.chords[k + 1] && !score.chords[k + 1].unison ? score.chords[k + 1] : null;
  const tonic = c.tonic;
  const scale = c.scale;
  const cx = Math.max(1, Math.min(5, score.config.complexity));
  const ext = cx >= 3 ? [14] : [];
  const out: { chord: Chord; why: string; score: number }[] = [];
  const add = (chord: Chord, why: string, rank: number) => {
    const ch = { root: mod12(chord.root), intervals: chord.intervals };
    if (ch.root === mod12(c.root) && pcOverlap(ch, c) === 1) return; // that's the chord already there
    if (out.some((o) => o.chord.root === ch.root && pcOverlap(o.chord, ch) === 1)) return;
    // Smoothness bonus: shares notes with its neighbours.
    const smooth = (prev ? pcOverlap(ch, prev) : 0.5) + (next ? pcOverlap(ch, next) : 0.5);
    out.push({ chord: ch, why, score: rank + smooth });
  };

  if (next) {
    const target = mod12(next.root);
    const label = chordName(next, tonic, scale);
    add({ root: target + 7, intervals: [0, 4, 7, 10, ...ext] }, `leads into ${label} (its dominant)`, 10);
    add({ root: target + 7, intervals: [0, 5, 7, 10, ...ext] }, `leads into ${label} (sus dominant)`, 9.5);
    add({ root: target + 1, intervals: [0, 4, 7, 10] }, `slides into ${label} (tritone sub)`, 8);
    add({ root: target + 2, intervals: [0, 3, 7, 10, ...ext] }, `sets up ${label} (its ii)`, 7.5);
    add({ root: target - 1, intervals: [0, 3, 6, 9] }, `steps up into ${label} (diminished passing)`, 5);
  }
  if (prev && isDominant(prev)) {
    const target = mod12(prev.root + 5);
    const steps = scaleSteps(scale);
    const d = steps.findIndex((s) => mod12(tonic + s) === target);
    const res = d >= 0 ? stackChord(tonic, scale, d, typicalSize(cx)) : { root: target, intervals: [0, 4, 7, 11] };
    add(res, `resolves ${chordName(prev, tonic, scale)}`, 9);
  }
  const steps = scaleSteps(scale);
  const inScale = new Set(steps.map((x) => mod12(tonic + x)));
  // The same chord kept to the mode: a chord with borrowed notes (a harmonic-minor dominant in
  // phrygian, a natural 9th over a phrygian tonic) swapped for the mode's own chord on that root.
  const deg = steps.findIndex((x) => mod12(tonic + x) === mod12(c.root));
  if (deg >= 0 && c.intervals.some((iv) => !inScale.has(mod12(c.root + iv)))) {
    add(stackChord(tonic, scale, deg, typicalSize(cx)), `keeps to the ${SCALE_LABEL[scale] ?? 'scale'} (no borrowed notes)`, 8.5);
  }
  // The mode's signature chords: what makes it sound like itself rather than plain major or minor.
  for (const [off, ivs, why, onTonicOnly] of MODAL[scale] ?? []) {
    if (onTonicOnly && mod12(c.root) !== mod12(tonic)) continue;
    add({ root: tonic + off, intervals: ivs }, why, 6.5);
  }
  // Diatonic substitutes that share notes with this chord (relative major/minor, mediants…).
  for (let d = 0; d < steps.length; d++) {
    const sub = stackChord(tonic, scale, d, typicalSize(cx));
    const o = pcOverlap(sub, c);
    if (o >= 0.5) add(sub, `shares ${Math.round(o * 100)}% of its notes (substitute)`, 4 + o * 2);
  }
  // Same root, another colour.
  for (const [ivs, label] of [
    [[0, 5, 7, 10], 'sus4 colour'],
    [[0, 2, 7], 'sus2 colour'],
    [[0, 4, 7, 9, 14], '6/9 colour'],
  ] as [number[], string][]) {
    add({ root: c.root, intervals: ivs }, label, 3);
  }
  // Borrowed from the parallel key.
  // (Only when they really are borrowed: in a minor mode these are already the scale's own.)
  const borrow = (chord: Chord, why: string, rank: number) => {
    if (chord.intervals.some((iv) => !inScale.has(mod12(chord.root + iv)))) add(chord, why, rank);
  };
  borrow({ root: tonic + 5, intervals: [0, 3, 7, 10] }, 'borrowed iv (bittersweet)', 3.5);
  borrow({ root: tonic + 8, intervals: [0, 4, 7, 11] }, 'borrowed ♭VI (cinematic lift)', 3.5);
  borrow({ root: tonic + 10, intervals: [0, 4, 7, 10] }, 'borrowed ♭VII (back-door)', 3);

  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((o) => ({ chord: o.chord, name: chordName(o.chord, tonic, scale), roman: romanName(o.chord, tonic), why: o.why }));
}
