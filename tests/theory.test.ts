import { describe, expect, it } from 'vitest';
import { SCALES, formatSeed, midiToHz, parseSeed, spellNote, stream, tonicName } from '../src/engine';

describe('rng', () => {
  it('is deterministic per (seed, label) and independent across labels', () => {
    const a = stream(1, 'x');
    const b = stream(1, 'x');
    const c = stream(1, 'y');
    const seqA = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seqA);
    expect([c(), c(), c()]).not.toEqual(seqA);
  });
  it('parses and formats seeds', () => {
    expect(parseSeed('0xF5E68707')).toBe(0xf5e68707);
    expect(formatSeed(0xf5e68707)).toBe('0xF5E68707');
    expect(parseSeed('42')).toBe(42);
    expect(parseSeed('hello')).toBe(parseSeed('hello'));
  });
});

describe('theory', () => {
  it('converts MIDI to equal-tempered Hz (the HUD formula)', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 6);
    expect(midiToHz(43)).toBeCloseTo(98.0, 2); // G2, the reference unison
    expect(midiToHz(84)).toBeCloseTo(1046.5, 1); // C6, the reference arrival
  });
  it('defines well-formed scales', () => {
    for (const [id, s] of Object.entries(SCALES)) {
      expect(s.steps[0], id).toBe(0);
      for (let i = 1; i < s.steps.length; i++) expect(s.steps[i], id).toBeGreaterThan(s.steps[i - 1]);
      expect(s.steps.at(-1)!, id).toBeLessThan(12);
    }
  });
  it('spells notes like a key signature', () => {
    expect(spellNote(65, 6, 'major')).toBe('E#4'); // F# major's 7th degree
    expect(spellNote(60, 1, 'harmonicMinor')).toBe('B#3'); // C# harmonic minor's leading tone, written octave kept
    expect(tonicName(1, 'minor')).toBe('C#');
    expect(tonicName(1, 'major')).toBe('Db');
    expect(spellNote(70, 0, 'major')).toBe('Bb4'); // borrowed b7
  });
});
