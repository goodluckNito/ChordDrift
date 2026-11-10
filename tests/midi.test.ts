import { describe, expect, it } from 'vitest';
import { beatsToNotation, generateScore, midiToConfig, nameChord, parseRhythm, readMidi, resolveConfig, writeMidi } from '../src/engine';
import type { MidiFile, MidiNote } from '../src/engine/midi';

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

describe('midi import that follows the file', () => {
  // A made-up file: a harp arpeggiating C then G/B, a soprano singing over it, a bass underneath.
  const notes: MidiNote[] = [];
  const arp = (start: number, pcs: number[]) => {
    for (let i = 0; i < 16; i++) notes.push({ start: start + i * 0.25, length: 0.25, pitch: pcs[i % pcs.length], vel: 90, channel: 1 });
  };
  arp(0, [60, 64, 67, 72]);
  arp(4, [62, 67, 71, 74]);
  notes.push({ start: 0, length: 4, pitch: 48, vel: 90, channel: 2 }, { start: 4, length: 4, pitch: 47, vel: 90, channel: 2 });
  [76, 77, 79, 77, 76, 74, 72, 74].forEach((p, i) => notes.push({ start: i, length: 1, pitch: p, vel: 100, channel: 0 }));
  notes.sort((a, b) => a.start - b.start);
  const file: MidiFile = { notes, tempo: 72, name: '', programs: { 0: 52, 1: 46, 2: 32 }, trackNames: { 0: 'SOPRANO', 1: 'ARPA', 2: 'BASSO' }, beatsPerBar: 4 };

  it('keeps the tune as a written melody and the bass as slash chords', () => {
    const imp = midiToConfig(file);
    expect(imp.chords).toEqual(['C', 'G/B']);
    expect(imp.patch.melody?.enabled).toBe(true);
    expect(String(imp.patch.melody?.notes).split(' ').length).toBe(8);
    expect(imp.notes.join(' ')).toMatch(/SOPRANO/);
  });

  it('picks the sound from the instruments', () => {
    const imp = midiToConfig(file);
    expect(imp.patch.motion?.transition).toBe('pluck'); // a harp plucks
    expect(imp.patch.melody?.wave).toBe('sine'); // a choir sings
  });

  it('plays the written melody and slash basses in the score', () => {
    const imp = midiToConfig(file);
    const s = generateScore({ ...imp.patch, seed: 1 } as never);
    expect(s.melody.filter((n) => n.p !== null).length).toBe(8);
    const gb = s.chords.find((c) => c.name === 'G/B')!;
    expect(Math.min(...gb.notes) % 12).toBe(11);
  });
});

describe('slash chords', () => {
  it('reads a bass note after a slash, and leaves 6/9 and V/V alone', async () => {
    const { parseProgression } = await import('../src/engine/progression-text');
    const t = parseProgression('Em7/D C6/9 V/V F#m/C#').tokens as { kind: string; bass?: number }[];
    expect(t.map((x) => x.bass)).toEqual([2, undefined, undefined, 1]);
  });
  it('voices the slash bass at the bottom', () => {
    const s = generateScore({ seed: 2, key: 'C', progression: 'C/E F/A G/B C', passing: 0 });
    const named = s.chords.filter((c) => /\//.test(c.name)).map((c) => [c.name, Math.min(...c.notes) % 12]);
    expect(named).toEqual([['C/E', 4], ['F/A', 9], ['G/B', 11]]);
  });
});

