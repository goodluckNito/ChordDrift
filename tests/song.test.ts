import { describe, expect, it } from 'vitest';
import { drumHits, energyAt, generateScore, parseSongForm, pitchesAt, resolveConfig } from '../src/engine';

describe('song form', () => {
  it('parses parts, energy, shifts, counts and joins', () => {
    const f = parseSongForm('A | B!+2:6 > c-1 D');
    expect(f.errors).toEqual([]);
    expect(f.sections.map((s) => [s.name, s.full, s.shift, s.count, s.collapse])).toEqual([
      ['a', false, 0, null, false],
      ['b', true, 2, 6, true],
      ['c', false, -1, null, false],
      ['d', false, 0, null, false],
    ]);
    expect(parseSongForm('A ?? B').errors.length).toBe(1);
  });
});

describe('song mode', () => {
  const cfg = (form: string, extra = {}) => resolveConfig({ seed: 11, key: 'C', song: { enabled: true, form }, ...extra });

  it('repeats a part with the same chords, transposed when shifted', () => {
    const s = generateScore(cfg('A > B > A > A+2'));
    const names = (i: number) => s.chords.filter((c) => c.section === i).map((c) => c.root);
    expect(names(2)).toEqual(names(0));
    expect(names(3)).toEqual(names(0).map((r) => (r + 2) % 12));
    expect(s.sections.map((x) => x.label)).toEqual(['A', 'B', 'A', 'A']);
    expect(s.endless).toBe(false);
  });

  it('collapses every voice into a unison between parts joined by |', () => {
    const s = generateScore(cfg('A | B'));
    const u = s.chords.find((c) => c.unison)!;
    expect(u).toBeTruthy();
    expect(new Set(u.notes).size).toBe(1);
    expect(u.root).toBe(0); // the next part's tonic (C)
    const next = s.chords[u.index + 1];
    const held = pitchesAt(s, next.t - 0.01);
    expect(Math.max(...held) - Math.min(...held)).toBeLessThan(0.01);
  });

  it('opens the sub and drums only in full parts', () => {
    const s = generateScore(cfg('A > B!', { drums: { enabled: true } }));
    const b = s.sections[1].t;
    expect(energyAt(s, s.sections[0].t + 1)).toBe(0);
    expect(energyAt(s, b + 1)).toBe(1);
    expect(drumHits(s, s.gridStart, b - 0.01).length).toBe(0);
    expect(drumHits(s, b, b + 4).length).toBeGreaterThan(0);
  });

  it('keeps chord rhythms on the bar through a collapse', () => {
    const s = generateScore(cfg('A | B', { rhythm: { chords: 'w', tempo: 120 } }));
    for (const c of s.chords.slice(1)) {
      const bars = (c.t - s.gridStart) / 2;
      expect(Math.abs(bars - Math.round(bars))).toBeLessThan(1e-6);
    }
  });

  it('works with styles, swells and plucks', () => {
    for (const extra of [{ style: 'jazz' }, { motion: { transition: 'swell' } }, { motion: { transition: 'pluck' }, rhythm: { chords: 'h', pluck: 'q' } }, { loop: true }]) {
      const s = generateScore(cfg('A | B! > A+1', extra));
      expect(s.errors).toEqual([]);
      expect(Number.isFinite(s.timeline.end)).toBe(true);
      expect(s.sections.length).toBe(3);
    }
  });

  it('turns endless off', () => {
    expect(resolveConfig({ endless: true, song: { enabled: true } }).endless).toBe(false);
  });
});
