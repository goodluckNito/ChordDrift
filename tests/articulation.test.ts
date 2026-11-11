import { describe, expect, it } from 'vitest';
import { generateScore, pitchAt, songFromText, swellAt } from '../src/engine';

const notes = (s: ReturnType<typeof generateScore>) => s.chords.map((c) => c.notes.join(','));

describe('glide feel and strikes', () => {
  it('never change the chords or their timing', () => {
    const even = generateScore({ seed: 7 });
    for (const motion of [{ feel: 'varied' as const }, { strikes: 0.6 }, { feel: 'varied' as const, strikes: 1 }]) {
      const s = generateScore({ seed: 7, motion });
      expect(notes(s)).toEqual(notes(even));
      expect(s.chords.map((c) => c.t)).toEqual(even.chords.map((c) => c.t));
    }
  });

  it('varied glides land on the same notes by a different path', () => {
    const even = generateScore({ seed: 7 });
    const varied = generateScore({ seed: 7, motion: { feel: 'varied' } });
    let differs = 0;
    for (let v = 0; v < even.config.voices; v++) {
      const m = varied.moves[v].find((x) => x.shape !== undefined);
      if (!m) continue;
      expect(pitchAt(varied, v, m.t0 + m.d + 1e-6)).toBe(m.p1);
      if (Math.abs(pitchAt(varied, v, m.t0 + m.d * 0.4) - pitchAt(even, v, m.t0 + m.d * 0.4)) > 1e-3) differs++;
    }
    expect(differs).toBeGreaterThan(0);
  });

  it('a strike jumps to the note and re-attacks it', () => {
    const s = generateScore({ seed: 7, motion: { strikes: 1 } });
    expect(s.struck).toBe(true);
    const v = s.moves.findIndex((ms) => ms.some((m) => m.shape === 4));
    const m = s.moves[v].find((x) => x.shape === 4)!;
    expect(m.d).toBeLessThan(0.01);
    expect(swellAt(s, v, m.t0)).toBeLessThan(0.4); // released just before the new note
    expect(swellAt(s, v, m.t0 + 0.02)).toBeCloseTo(1, 2); // and struck again
    expect(swellAt(s, v, m.t0 + 3)).toBe(1);
  });

  it('is off by default, and word songs keep their notes', () => {
    expect(generateScore({ seed: 7 }).struck).toBe(false);
    const patch = songFromText('quiet harbor');
    const s = generateScore(patch);
    const plain = generateScore({ ...patch, motion: { ...patch.motion, feel: 'even', strikes: 0 } });
    expect(notes(s)).toEqual(notes(plain));
  });
});

import { resolveConfig, seedArrangement } from '../src/engine';
describe('new seeds roll an arrangement', () => {
  it('is the same for the same seed and varies across seeds', () => {
    const base = resolveConfig({ seed: 'a' });
    expect(seedArrangement(base)).toEqual(seedArrangement(resolveConfig({ seed: 'a' })));
    const rolls = Array.from({ length: 40 }, (_, i) => seedArrangement(resolveConfig({ seed: `s${i}` })));
    expect(new Set(rolls.map((r) => r.drums?.enabled)).size).toBe(2);
    expect(new Set(rolls.map((r) => r.melody?.enabled)).size).toBe(2);
    expect(new Set(rolls.map((r) => r.rhythm?.chords)).size).toBeGreaterThan(4);
    expect(new Set(rolls.map((r) => r.drums?.kick)).size).toBeGreaterThan(4);
  });
  it('leaves the kit, sound and tempo alone', () => {
    const r = seedArrangement(resolveConfig({ seed: 'b' }));
    expect(r.drums?.kit).toBeUndefined();
    expect(r.audio).toBeUndefined();
    expect(r.rhythm?.tempo).toBeUndefined();
  });
});

import { chordAlternatives } from '../src/engine';
describe('chord swaps know the mode', () => {
  it('offers the Phrygian ♭II and an in-mode chord for a borrowed dominant', () => {
    const s = generateScore({ seed: 1, key: 'G#', scale: 'phrygian', progression: 'iv9 V7b9 i9' });
    const k = s.chords.findIndex((c) => c.name.startsWith('D#7'));
    expect(k).toBeGreaterThan(0);
    const names = chordAlternatives(s, k).map((a) => a.name);
    expect(names).toContain('Amaj7');
    expect(names).toContain('D#m7b5');
  });
});

import { voiceNotesAt } from '../src/engine';
describe('views follow release-&-swell changes', () => {
  it('voiceNotesAt gives the chord that is actually sounding', () => {
    const s = generateScore({ seed: 4, motion: { transition: 'swell' } });
    const k = 3;
    const c = s.chords[k];
    const later = c.t + s.config.timing.swellIn + 0.3;
    if (s.chords[k + 1] && later < s.chords[k + 1].t) {
      const loud = voiceNotesAt(s, 2, later).sort((a, b) => b.g - a.g)[0];
      expect(loud.p).toBe(c.notes[2]);
    }
    // Gliding: one note, the glide's.
    const g = generateScore({ seed: 4 });
    expect(voiceNotesAt(g, 2, 10)).toEqual([{ p: pitchAt(g, 2, 10), g: 1 }]);
  });
});

import { chordDurations, parseRhythm } from '../src/engine';
describe('chill and quick rhythms stay in tune', () => {
  it('glides take at most 40% of a chord slot', () => {
    const s = generateScore({ seed: 9, rhythm: { chords: 'h', tempo: 100 } });
    const slot = (2 * 60) / 100;
    for (const ms of s.moves) for (const m of ms) if (m.t0 > s.gridStart + 0.1 && m.t0 < s.timeline.arrivalStart - 0.1) expect(m.d).toBeLessThanOrEqual(slot * 0.4 + 1e-6);
  });
  it('chill songs change chords unhurriedly and rarely pass chromatically', () => {
    for (let i = 0; i < 80; i++) {
      const p = songFromText('calm ' + i, 'chill');
      expect(p.passing).toBe(0.08);
      const rc = p.rhythm?.chords;
      if (!rc) continue;
      const beats = chordDurations(parseRhythm(rc).steps);
      expect(((beats.reduce((a, b) => a + b, 0) / beats.length) * 60) / p.rhythm!.tempo!).toBeGreaterThanOrEqual(2.25); // (whole notes at the fastest chill tempo: ~2.3 s)
    }
  });
});
