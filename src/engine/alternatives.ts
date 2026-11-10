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

/** Up to `max` alternatives for chord k, best first. */
export function chordAlternatives(score: Score, k: number, max = 8): Alternative[] {
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
  // Diatonic substitutes that share notes with this chord (relative major/minor, mediants…).
  const steps = scaleSteps(scale);
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
  add({ root: tonic + 5, intervals: [0, 3, 7, 10] }, 'borrowed iv (bittersweet)', 3.5);
  add({ root: tonic + 8, intervals: [0, 4, 7, 11] }, 'borrowed ♭VI (cinematic lift)', 3.5);
  add({ root: tonic + 10, intervals: [0, 4, 7, 10] }, 'borrowed ♭VII (back-door)', 3);

  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((o) => ({ chord: o.chord, name: chordName(o.chord, tonic, scale), roman: romanName(o.chord, tonic), why: o.why }));
}
