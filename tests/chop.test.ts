import { describe, expect, it } from 'vitest';
import { chopAt, drumHits, generateScore, parseChop, parseSongForm, resolveConfig } from '../src/engine';


describe('chop', () => {
  it('parses runs and rejects unknown steps', () => {
    const { pattern, errors } = parseChop('xx<<<=.~');
    expect(errors).toEqual([]);
    expect(pattern!.steps.map((s) => `${s.kind}:${s.start}-${s.end}`)).toEqual(['play:0-2', 'play:0-2', 'rev:2-5', 'rev:2-5', 'rev:2-5', 'rep:5-6', 'cut:6-7', 'tape:7-8']);
    expect(parseChop('xxxx').pattern).toBeNull();
    expect(parseChop('x?x').errors.length).toBe(1);
  });

  const score = (pattern: string, extra = {}) => generateScore(resolveConfig({ seed: 3, rhythm: { tempo: 120 }, chop: { enabled: true, pattern, chords: true }, ...extra }));

  it('reverses, repeats, cuts and tape-stops in time', () => {
    const step = 0.125;
    const s = score('xxxx<<<<====..~~');
    const g = s.gridStart;
    const at = (k: number) => chopAt(s, g + k * step);
    expect(at(1.5).s).toBeCloseTo(g + 1.5 * step);
    expect(at(1.5).level).toBe(1);
    expect(at(5).s).toBeCloseTo(g + 7 * step); // reverse: 4..8 plays 8..4
    expect(at(9).s).toBeCloseTo(g + 5 * step); // repeat: 8..12 replays 4..8
    expect(at(12.5).level).toBe(0);
    const tape = at(15.5);
    expect(tape.rate).toBeLessThan(0.5);
    expect(tape.s).toBeLessThan(g + 15.5 * step);
    // Next loop starts over.
    expect(at(17.5).s).toBeCloseTo(g + 17.5 * step);
  });

  it('fades at jumps instead of clicking', () => {
    const s = score('xxxx<<<<');
    const edge = s.gridStart + 4 * 0.125;
    expect(chopAt(s, edge - 0.001).level).toBeLessThan(0.5);
    expect(chopAt(s, edge + 0.001).level).toBeLessThan(0.5);
    expect(chopAt(s, edge + 0.02).level).toBe(1);
  });

  it('only plays in full song parts, restarting with each part', () => {
    const s = score('<<<<<<<<<<<<<<<<', { song: { enabled: true, form: 'A2 > B!3 > C!2' } });
    const [, b, c] = s.sections;
    expect(chopAt(s, s.sections[0].t + 1).s).toBeCloseTo(s.sections[0].t + 1);
    expect(chopAt(s, b.t + 0.25).s).toBeCloseTo(b.t + 2 - 0.25); // reversed bar from B's start
    expect(chopAt(s, c.t + 0.25).s).toBeCloseTo(c.t + 2 - 0.25); // restarted at C even mid-bar of B's loop
  });
});

describe('song drums', () => {
  it('reads per-part drums', () => {
    const f = parseSongForm('A[h] B![ks] C! D[]');
    expect(f.errors).toEqual([]);
    expect(f.sections.map((s) => s.drums)).toEqual([['hat'], ['kick', 'snare'], null, []]);
  });

  it('plays only the picked drums, and restarts patterns at each part', () => {
    const cfg = resolveConfig({
      seed: 5,
      rhythm: { tempo: 120 },
      song: { enabled: true, form: 'A2[h] | B!2[k] | C!2' },
      drums: { enabled: true, kick: 'x...............', hat: 'x.x.x.x.x.x.x.x.', snare: '....x.......x...', crash: 'x' + '.'.repeat(63) },
    });
    const s = generateScore(cfg);
    const [a, b, c] = s.sections;
    const voices = (t0: number, t1: number) => new Set(drumHits(s, t0, t1).map((h) => h.voice));
    expect([...voices(a.t, a.t + 3.9)]).toEqual(['hat']);
    expect([...voices(b.t, b.t + 3.9)]).toEqual(['kick']);
    expect(voices(c.t, c.t + 3.9)).toEqual(new Set(['kick', 'snare', 'hat', 'crash']));
    // The 4-bar crash restarts on C's downbeat even though C starts mid-cycle from the piece start.
    expect(drumHits(s, c.t - 0.01, c.t + 0.01).some((h) => h.voice === 'crash')).toBe(true);
  });
});

describe('drum chop', () => {
  const make = (pattern: string, targets = {}) =>
    generateScore(
      resolveConfig({
        seed: 2,
        rhythm: { tempo: 120 },
        drums: { enabled: true, kick: 'x...x...x...x...', snare: '', hat: 'xxxxxxxxxxxxxxxx', crash: '', ride: '' },
        chop: { enabled: true, pattern, ...targets },
      }),
    );
  const bar = (s: ReturnType<typeof make>) => drumHits(s, s.gridStart, s.gridStart + 2);

  it('chops the drums by default, not the chords', () => {
    const s = make('xxxxxxxx........');
    expect(bar(s).every((h) => h.t < s.gridStart + 1 - 1e-9)).toBe(true);
    expect(chopAt(s, s.gridStart + 1.5).level).toBe(1);
  });

  it('repeats, reverses and tape-stops hits', () => {
    const rep = bar(make('xxxx====xxxxxxxx'));
    const s = make('xxxx====xxxxxxxx');
    // Steps 4-7 replay steps 0-3: a kick on step 4 (from step 0) and hats on each step.
    const g = s.gridStart;
    expect(rep.filter((h) => h.voice === 'kick' && Math.abs(h.t - (g + 0.5)) < 1e-6).length).toBe(1);
    const rev = bar(make('xxxx<<<<xxxxxxxx'));
    expect(rev.filter((h) => h.rev).length).toBe(5); // 4 hats + 1 kick in the reversed stretch
    const tape = bar(make('xxxxxxxxxxxx~~~~'));
    const slowed = tape.filter((h) => h.rate !== undefined);
    expect(slowed.length).toBeGreaterThan(0);
    expect(slowed.every((h) => h.rate! <= 1)).toBe(true);
    expect(slowed.some((h) => h.rate! < 0.8)).toBe(true);
  });

  it('leaves the drums alone when not targeted', () => {
    const s = make('................', { drums: false, chords: true });
    expect(bar(s).length).toBe(20);
  });
});
