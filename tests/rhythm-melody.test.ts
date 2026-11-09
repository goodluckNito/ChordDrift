import { describe, expect, it } from 'vitest';
import { REGISTERS, chordDurations, generateScore, melodyAt, parseRhythm, resolveConfig } from '../src/engine';

const beats = (text: string) => parseRhythm(text).steps.map((s) => (s.rest ? -s.beats : s.beats));

describe('rhythm notation', () => {
  it('reads note values as letters or numbers', () => {
    expect(beats('w h q e s')).toEqual([4, 2, 1, 0.5, 0.25]);
    expect(beats('1 2 4 8 16 32')).toEqual([4, 2, 1, 0.5, 0.25, 0.125]);
  });
  it('handles dots, triplets, ties and rests', () => {
    expect(beats('q. h..')).toEqual([1.5, 3.5]);
    const t = beats('et et et');
    expect(t.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(beats('h+e')).toEqual([2.5]);
    expect(beats('rq r8 -h')).toEqual([-1, -0.5, -2]);
  });
  it('repeats notes and groups, ignoring bar lines', () => {
    expect(beats('e*3 | (q e)*2')).toEqual([0.5, 0.5, 0.5, 1, 0.5, 1, 0.5]);
  });
  it('reports what it cannot read', () => {
    const r = parseRhythm('q x (e');
    expect(r.steps.length).toBe(2);
    expect(r.errors.length).toBe(2);
  });
  it('turns rests into longer chords for chord rhythms', () => {
    expect(chordDurations(parseRhythm('h rq q').steps)).toEqual([3, 1]);
  });
});

describe('chord rhythm', () => {
  it('puts every chord change on the beat grid', () => {
    const s = generateScore({ seed: 2, rhythm: { tempo: 90, chords: 'q. e+h' } });
    const grid = s.chords.slice(1).map((c) => (c.t - s.gridStart) / s.beat);
    expect(grid[0]).toBeCloseTo(1.5);
    expect(grid[1]).toBeCloseTo(4);
    expect(grid[2]).toBeCloseTo(5.5);
    // Glides fit inside their slots, so moves never overlap.
    for (const m of s.moves) for (let i = 1; i < m.length; i++) expect(m[i].t0).toBeGreaterThanOrEqual(m[i - 1].t0 + m[i - 1].d - 1e-9);
  });
  it('keeps the default free timing when empty', () => {
    expect(generateScore({ seed: 2 }).chords.map((c) => c.t)).toEqual(generateScore({ seed: 2, rhythm: { chords: '' } }).chords.map((c) => c.t));
  });
});

describe('melody', () => {
  it('is off by default and leaves the piece unchanged when turned on', () => {
    const plain = generateScore({ seed: 6 });
    const withMelody = generateScore({ seed: 6, melody: { enabled: true } });
    expect(plain.melody).toEqual([]);
    expect(withMelody.chords.map((c) => c.notes)).toEqual(plain.chords.map((c) => c.notes));
  });
  it('stays in its register, follows a written rhythm, and joins the arrival', () => {
    const s = generateScore({ seed: 3, melody: { enabled: true, rhythm: 'e e q', register: 'mid' } });
    const [lo, hi] = REGISTERS.mid;
    const body = s.melody.slice(0, -1);
    for (const n of body) if (n.p !== null) expect(n.p).toBeGreaterThanOrEqual(lo), expect(n.p).toBeLessThanOrEqual(hi);
    expect(body.slice(0, 6).map((n) => +(n.d / s.beat).toFixed(6))).toEqual([0.5, 0.5, 1, 0.5, 0.5, 1]);
    expect(melodyAt(s, s.timeline.arrivalEnd + 0.05)!.p).toBe(s.endNote);
  });
  it('lands on chord tones on strong beats', () => {
    const s = generateScore({ seed: 8, key: 'C', melody: { enabled: true, rhythm: 'q' } });
    let strong = 0;
    let onChord = 0;
    for (const n of s.melody.slice(0, -1)) {
      if (n.p === null) continue;
      const beat = Math.round((n.t - s.gridStart) / s.beat);
      if (beat % 2 !== 0) continue;
      const chord = [...s.chords].reverse().find((c) => c.t <= n.t)!;
      strong++;
      if (chord.intervals.some((i) => (chord.root + i) % 12 === n.p! % 12)) onChord++;
    }
    expect(onChord / strong).toBeGreaterThan(0.9);
  });
  it('rests through chord changes in "gaps" mode', () => {
    const s = generateScore({ seed: 4, melody: { enabled: true, fill: 'gaps', density: 0.9 } });
    const notes = s.melody.slice(0, -1).filter((n) => n.p !== null);
    expect(notes.length).toBeGreaterThan(5);
    for (const n of notes) expect(s.chords.some((c) => c.t < n.t + n.d && c.settled + 0.05 > n.t)).toBe(false);
  });
  it('is silent in rests and continuous while sounding', () => {
    const s = generateScore({ seed: 5, melody: { enabled: true, rhythm: 'q rq e e' } });
    const rest = s.melody.find((n) => n.p === null)!;
    expect(melodyAt(s, rest.t + rest.d / 2)!.g).toBe(0);
    let prev = melodyAt(s, s.gridStart)!.p;
    // Even a two-octave leap over the 60 ms portamento moves < 0.4 semitones per 0.5 ms.
    for (let t = s.gridStart; t < s.timeline.arrivalStart; t += 0.0005) {
      const m = melodyAt(s, t)!;
      if (m.g > 0.5) expect(Math.abs(m.p - prev)).toBeLessThan(0.4);
      prev = m.p;
    }
  });
  it('extends with endless pieces', () => {
    const s = generateScore({ seed: 4, endless: true, melody: { enabled: true } });
    s.extend(90);
    expect(s.melody.at(-1)!.t).toBeGreaterThan(80);
  });
});

describe('waves', () => {
  it('accepts saw and square, and falls back for unknown waves', () => {
    expect(resolveConfig({ audio: { wave: 'sawtooth' } }).audio.wave).toBe('sawtooth');
    expect(resolveConfig({ melody: { wave: 'square' } }).melody.wave).toBe('square');
    expect(resolveConfig({ audio: { wave: 'kazoo' as never } }).audio.wave).toBe('sine');
  });
});
