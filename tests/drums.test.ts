import { describe, expect, it } from 'vitest';
import { DRUM_PRESETS, drumHits, drumHitsBetween, duckAt, generateScore, parseDrumRows, parseSteps, resolveConfig } from '../src/engine';

describe('drum patterns', () => {
  it('parses 16th-note step strings', () => {
    const p = parseSteps('X..x | o.r.');
    expect(p.length).toBe(8);
    expect(p.steps.map((s) => s.i)).toEqual([0, 3, 4, 6]);
    expect(p.steps[0].vel).toBeGreaterThan(p.steps[1].vel);
    expect(p.steps[2].open).toBe(true);
    expect(p.steps[3].roll).toBe(true);
  });
  it('ships presets that parse', () => {
    for (const pr of DRUM_PRESETS) for (const v of ['kick', 'snare', 'hat', 'crash', 'ride'] as const) expect(parseSteps(pr[v]).length % 16, `${pr.name} ${v}`).toBe(0);
  });
});

describe('drum timing', () => {
  const cfg = { seed: 3, rhythm: { tempo: 120, chords: '' }, drums: { enabled: true, kick: 'x...x...x...x...', snare: '....x.......x...', hat: '', crash: '', ride: '' } };
  it('starts when the bloom lands, sits on the 16th grid, and stops at the arrival', () => {
    const s = generateScore(cfg);
    const hits = drumHits(s, 0, s.timeline.end);
    expect(hits.length).toBeGreaterThan(20);
    expect(hits[0].t).toBeCloseTo(s.gridStart, 9);
    const step = s.beat / 4;
    for (const h of hits) {
      const k = (h.t - s.gridStart) / step;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
      expect(h.t).toBeLessThan(s.timeline.arrivalStart);
    }
    const kicks = hits.filter((h) => h.voice === 'kick');
    kicks.slice(1).forEach((h, i) => expect(h.t - kicks[i].t).toBeCloseTo(s.beat, 6)); // four on the floor
  });
  it('rolls are three hits inside one step', () => {
    const s = generateScore({ ...cfg, drums: { ...cfg.drums, kick: '', snare: '', hat: 'r...............' } });
    const h = drumHits(s, s.gridStart, s.gridStart + 0.2);
    expect(h).toHaveLength(3);
    expect(h[2].t - h[0].t).toBeCloseTo(((2 / 3) * s.beat) / 4, 6);
  });
  it('ducks the chords under the kick and recovers with the release', () => {
    const s = generateScore({ ...cfg, drums: { ...cfg.drums, duck: { kick: true, snare: false, depth: 0.6, release: 0.2 } } });
    const k = drumHits(s, s.gridStart + 2, s.gridStart + 4).find((h) => h.voice === 'kick')!;
    expect(duckAt(s, k.t - 0.001)).toBeGreaterThan(0.85);
    expect(duckAt(s, k.t + 0.005)).toBeCloseTo(1 - 0.6, 1);
    expect(duckAt(s, k.t + 0.45)).toBeGreaterThan(duckAt(s, k.t + 0.05));
  });
  it('is off by default and changes nothing musical when turned on', () => {
    expect(resolveConfig().drums.enabled).toBe(false);
    const a = generateScore({ seed: 5 });
    const b = generateScore({ seed: 5, drums: { enabled: true } });
    expect(b.chords.map((c) => c.notes)).toEqual(a.chords.map((c) => c.notes));
    expect(duckAt(a, 10)).toBe(1);
  });
});

describe('witch house style', () => {
  it('loops a falling-thirds minor progression (i–♭III–♭VI–V and relatives)', () => {
    const s = generateScore({ seed: 3, key: 'F', scale: 'minor', style: 'witchhouse' });
    const roots = s.chords.map((c) => c.root);
    expect(roots.slice(0, 4)).toEqual([5, 8, 1, 0]); // F Ab Db C
    expect(s.chords.at(-1)!.root).toBe(5);
  });
});

describe('random steps', () => {
  const rows = parseDrumRows({ kick: '', snare: '????????????????', hat: '', crash: '', ride: '' });
  const bars = (seed: number) => {
    const hits = drumHitsBetween(rows, 0, 64, 0.125, 0, 64, seed);
    return Array.from({ length: 32 }, (_, k) => hits.filter((h) => h.t >= k * 2 && h.t < k * 2 + 2).map((h) => `${(h.t - k * 2).toFixed(3)}:${h.vel.toFixed(2)}`).join(','));
  };
  it('changes from bar to bar, repeatably, and differs by seed', () => {
    const a = bars(1);
    expect(new Set(a).size).toBeGreaterThan(20);
    expect(bars(1)).toEqual(a);
    expect(bars(2)).not.toEqual(a);
    const count = drumHitsBetween(rows, 0, 64, 0.125, 0, 64, 1).length;
    expect(count).toBeGreaterThan(512 * 0.4);
    expect(count).toBeLessThan(512 * 0.9);
  });
});
