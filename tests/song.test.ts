import { describe, expect, it } from 'vitest';
import { drumHits, energyAt, generateScore, parseSongForm, pitchesAt, resolveConfig } from '../src/engine';

describe('song form', () => {
  it('parses parts, bars, energy, shifts and joins', () => {
    const f = parseSongForm('A | B!6+2 > c2-1 D B4!');
    expect(f.errors).toEqual([]);
    expect(f.sections.map((s) => [s.name, s.bars, s.full, s.shift, s.collapse])).toEqual([
      ['a', 8, false, 0, false],
      ['b', 6, true, 2, true],
      ['c', 2, false, -1, false],
      ['d', 8, false, 0, false],
      ['b', 4, true, 0, false],
    ]);
    expect(parseSongForm('A ?? B').errors.length).toBe(1);
  });
});

describe('song mode', () => {
  const cfg = (form: string, extra = {}) => resolveConfig({ seed: 11, key: 'C', song: { enabled: true, form }, ...extra });

  it('repeats a part with the same chords, transposed when shifted', () => {
    const s = generateScore(cfg('A > B > A > A+2'));
    // Bodies repeat; the last few chords are the part's ending, which depends on what follows.
    const names = (i: number) => s.chords.filter((c) => c.section === i).map((c) => c.root).slice(0, 3);
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

  it('makes each part last its bars, one chord a bar by default', () => {
    const s = generateScore(cfg('A4 > B!2 > A1', { rhythm: { tempo: 120 } }));
    const bar = 2;
    expect((s.sections[1].t - s.gridStart) / bar).toBeCloseTo(4);
    expect((s.sections[2].t - s.gridStart) / bar).toBeCloseTo(6);
    expect(s.chords.filter((c) => c.section === 0).length).toBe(4);
    expect(s.chords.filter((c) => c.section === 1).length).toBe(2);
    expect(s.timeline.arrivalStart - s.gridStart).toBeCloseTo(7 * bar);
  });

  it('follows the chord rhythm inside a part, cut at the part end', () => {
    const s = generateScore(cfg('A3 > B1', { rhythm: { tempo: 120, chords: 'h. h.' } }));
    // 12 beats of dotted halves = 4 chords; then B's single bar = 3 + 1 beats.
    expect(s.chords.filter((c) => c.section === 0).length).toBe(4);
    expect(s.chords.filter((c) => c.section === 1).length).toBe(2);
    expect(s.timeline.arrivalStart - s.gridStart).toBeCloseTo(16 * 0.5);
  });

  it('turns endless off', () => {
    expect(resolveConfig({ endless: true, song: { enabled: true } }).endless).toBe(false);
  });
});

describe('part keys, scales and styles', () => {
  it('parses options in braces, with or without spaces', () => {
    const f = parseSongForm('A8{E, dorian} B!4{jazz,Bb} C{nope}');
    expect(f.sections[0]).toMatchObject({ key: 'E', scale: 'dorian', style: null });
    expect(f.sections[1]).toMatchObject({ key: 'Bb', scale: null, style: 'jazz', full: true, bars: 4 });
    expect(f.errors.length).toBe(1);
  });

  it('transposes a repeat to a new key, and makes a scale change a new variation', () => {
    const s = generateScore(resolveConfig({ seed: 4, key: 'C', song: { enabled: true, form: 'A4 > A4{D} > A4{minor}' } }));
    const roots = (i: number) => s.chords.filter((c) => c.section === i && !c.unison).map((c) => c.root);
    expect(roots(1).slice(0, 2)).toEqual(roots(0).slice(0, 2).map((r) => (r + 2) % 12));
    expect(roots(2)).not.toEqual(roots(0));
    expect(s.chords.filter((c) => c.section === 2)[0].scale).toBe('minor');
  });
});

describe('song endings', () => {
  it('ends a part with the next key\'s ii–V, leaves tension before a collapse, and closes on the tonic', () => {
    const s = generateScore(resolveConfig({ seed: 8, key: 'C', song: { enabled: true, form: 'A4 > B4{F} | C4' } }));
    const part = (i: number) => s.chords.filter((c) => c.section === i && !c.unison);
    const a = part(0);
    expect(a.slice(-2).map((c) => c.root)).toEqual([7, 0]); // Gm7 C7 → F
    expect(part(1)[0].root).toBe(5); // B opens on F
    const b = part(1);
    expect([0, 10].includes(b.at(-1)!.root)).toBe(true); // tension in F: on V (C) or iv (B♭), not F
    expect(part(2).at(-1)!.root).toBe(0); // the close lands on C
  });
});
