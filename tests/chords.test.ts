import { describe, expect, it } from 'vitest';
import { CHORD_SUFFIXES, chordName, chordSuffix, colourVariant, palette, requiredTones, stackChord, suffixIntervals } from '../src/engine';

const pcs = (iv: number[]) => [...new Set(iv.map((x) => x % 12))].sort((a, b) => a - b).join(',');

describe('chord vocabulary', () => {
  it('names every table chord back to an equivalent chord', () => {
    for (const s of CHORD_SUFFIXES) {
      const iv = suffixIntervals(s)!;
      expect(pcs(suffixIntervals(chordSuffix(iv))!), s).toBe(pcs(iv));
    }
  });
  it('accepts common aliases', () => {
    expect(suffixIntervals('Δ7')).toEqual(suffixIntervals('maj7'));
    expect(suffixIntervals('ø')).toEqual(suffixIntervals('m7b5'));
    expect(suffixIntervals('-7')).toEqual(suffixIntervals('m7'));
    expect(suffixIntervals('nonsense')).toBeNull();
  });
  it('names unusual sets generically', () => {
    expect(chordSuffix([0, 4, 7, 9, 14, 18])).toBe('6/9(#11)');
  });
  it('requires the 3rd and 7th before extensions; never the root or fifth', () => {
    const req = requiredTones([0, 3, 7, 10, 14, 17]);
    expect(req.slice(0, 2).sort((a, b) => a - b)).toEqual([3, 10]);
    expect(req).not.toContain(0);
    expect(req).not.toContain(7);
  });
});

describe('stacking chords from scales', () => {
  const name = (d: number, size: number, scale = 'major') => chordName(stackChord(0, scale, d, size), 0, scale);
  it('builds the familiar diatonic chords in C major', () => {
    expect([0, 1, 2, 3, 4, 5].map((d) => name(d, 4))).toEqual(['Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7']);
    expect(name(4, 3)).toBe('G');
  });
  it('drops avoid notes (minor 9ths above chord tones)', () => {
    expect(name(0, 6)).toBe('Cmaj9'); // F (11th) would clash with E
    expect(name(5, 6)).toBe('Am11'); // the reference video's Am11
    expect(name(3, 6)).toBe('Fmaj9#11'); // Lydian #11 survives
    expect(name(4, 7)).toBe('G13');
  });
  it('works in non-heptatonic scales', () => {
    expect(stackChord(0, 'majorPentatonic', 0, 4).intervals).toEqual([0, 4, 9, 14]);
    const oct = stackChord(0, 'octatonicHW', 0, 6);
    expect(new Set(oct.intervals.map((i) => i % 12)).size).toBe(oct.intervals.length); // no wrapped duplicates
  });
  it('makes in-scale sus and six variants', () => {
    const g7 = stackChord(0, 'major', 4, 4);
    expect(chordName(colourVariant(g7, 0, 'major', 'sus4')!, 0)).toBe('G7sus4');
    expect(colourVariant(stackChord(0, 'major', 0, 4), 0, 'major', 'sus4')).toBeNull(); // no maj7sus4
    expect(chordName(colourVariant(stackChord(0, 'major', 0, 4), 0, 'major', 'six')!, 0)).toBe('C6');
  });
  it('weights palettes toward the chosen complexity', () => {
    const p1 = palette(1);
    expect(p1.suffixes).toEqual(['', 'm', 'sus4', 'sus2']);
    const p5 = palette(5);
    expect(p5.suffixes).toContain('7alt');
    expect(p5.weights[p5.suffixes.indexOf('7alt')]).toBeGreaterThan(p5.weights[p5.suffixes.indexOf('m')]);
  });
});
