import { describe, expect, it } from 'vitest';
import { beatsToNotation, generateScore, midiToConfig, nameChord, parseRhythm, readMidi, resolveConfig, writeMidi } from '../src/engine';

const w = (pcs: number[]) => {
  const a = new Array(12).fill(0);
  for (const p of pcs) a[p] = 1;
  return a;
};

describe('midi', () => {
  it('names common chords', () => {
    expect(nameChord(w([0, 4, 7]), 0, false)!.name).toBe('C');
    expect(nameChord(w([9, 0, 4]), 9, false)!.name).toBe('Am');
    expect(nameChord(w([7, 11, 2, 5]), 7, false)!.name).toBe('G7');
    expect(nameChord(w([2, 5, 9, 0]), 2, false)!.name).toBe('Dm7');
    expect(nameChord(w([8, 0, 3]), 8, true)!.name).toBe('Ab');
  });

  it('writes beats as tied rhythm notation that parses back', () => {
    for (const b of [0.25, 1, 1.5, 3, 4, 6, 7, 8]) {
      const n = beatsToNotation(b);
      expect(parseRhythm(n).steps[0].beats).toBeCloseTo(b);
    }
  });

  it('round-trips a written progression through a MIDI file', () => {
    const cfg = resolveConfig({ seed: 7, key: 'C', progression: 'C Am F G7', rhythm: { chords: 'w w h h', tempo: 100 }, drums: { enabled: true } });
    const score = generateScore(cfg);
    const out = writeMidi(score);
    expect(String.fromCharCode(...out.bytes.slice(0, 4))).toBe('MThd');
    const file = readMidi(out.bytes);
    expect(file.tempo).toBe(100);
    expect(file.notes.some((n) => n.channel === 9)).toBe(true);
    const imp = midiToConfig(file);
    // The opening unison and the final note come along too; the four chords must be there, in order, with their lengths.
    const i = 0;
    expect(imp.chords.slice(i, i + 4)).toEqual(['C', 'Am', 'F', 'G7']);
    const rhythm = (imp.patch.rhythm!.chords as string).split(' ').slice(i, i + 4);
    expect(rhythm).toEqual(['w', 'w', 'h', 'h']);
    expect(imp.patch.drums?.enabled).toBe(true);
    expect(imp.key).toBe('C major');
  });

  it('exports endless pieces up to a limit', () => {
    const score = generateScore(resolveConfig({ seed: 3, endless: true }));
    const out = writeMidi(score);
    expect(out.chords).toBeGreaterThanOrEqual(30);
    expect(readMidi(out.bytes).notes.length).toBeGreaterThan(30);
  });

  it('rejects non-MIDI data', () => {
    expect(() => readMidi(new TextEncoder().encode('hello world'))).toThrow();
  });
});
