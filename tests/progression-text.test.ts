import { describe, expect, it } from 'vitest';
import { chordToToken, generateScore, parseProgression } from '../src/engine';

describe('progression language', () => {
  it('parses absolute names, numerals, degrees, offsets, interval sets and wildcards', () => {
    const { tokens, errors } = parseProgression('Cmaj9, Am11 | vi11 bVII9 4 6:m11 +9m11 C{0 4 7 11 18} ? G/B');
    expect(errors).toEqual([]);
    expect(tokens.map((t) => t.kind)).toEqual(['chord', 'chord', 'chord', 'chord', 'chord', 'chord', 'chord', 'chord', 'wildcard', 'chord']);
    const [, , vi11, bVII9, four, , plus9, custom] = tokens as Extract<(typeof tokens)[number], { kind: 'chord' }>[];
    expect(vi11.root).toEqual({ kind: 'roman', semitones: 9, minor: true });
    expect(vi11.intervals).toEqual([0, 3, 7, 10, 14, 17]);
    expect(bVII9.root).toEqual({ kind: 'roman', semitones: 10, minor: false });
    expect(four.root).toEqual({ kind: 'degree', degree: 3, accidental: 0 });
    expect(four.intervals).toBeNull(); // auto colour
    expect(plus9.root).toEqual({ kind: 'offset', semitones: 9 });
    expect(custom.intervals).toEqual([0, 4, 7, 11, 18]);
  });
  it('reports unreadable tokens', () => {
    const { errors, tokens } = parseProgression('Cmaj7 Xfoo Cblah');
    expect(tokens).toHaveLength(1);
    expect(errors).toHaveLength(2);
  });
  it('handles minor numerals with major sevenths', () => {
    const { tokens } = parseProgression('iMaj7 imaj7');
    for (const t of tokens) expect(t.kind === 'chord' && t.intervals).toEqual([0, 3, 7, 11]);
  });
  it('freezes generated chords to text that regenerates the same chords', () => {
    for (const mode of ['scale', 'drift', 'voiceled', 'free'] as const) {
      for (const scale of ['major', 'dorian', 'hirajoshi', 'octatonicHW']) {
        for (const complexity of [1, 3, 5]) {
          const s = generateScore({ seed: 7, mode, scale, complexity });
          const text = s.chords.map((c) => chordToToken(c, s.keyPc)).join(' ');
          const again = generateScore({ seed: 7, scale, complexity, key: s.keyName, progression: text });
          expect(again.errors).toEqual([]);
          const sig = (c: { root: number; intervals: number[] }) => `${c.root}:${[...new Set(c.intervals.map((i) => i % 12))].sort((a, b) => a - b)}`;
          expect(again.chords.map(sig), `${mode} ${scale} ${complexity}: ${text}`).toEqual(s.chords.map(sig));
        }
      }
    }
  });
});

describe('hints', () => {
  it('explains a lower-case numeral with maj7 (a minor-major 7th)', () => {
    const r = parseProgression('iiMaj7 Vmaj7 Imaj7');
    expect(r.errors).toEqual([]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toContain('IImaj7');
    expect(r.notes[0]).toContain('ii7');
    expect(parseProgression('ii7 V7 Imaj7 imMaj7').notes).toEqual([]);
  });
});
