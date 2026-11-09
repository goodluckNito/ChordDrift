import { describe, expect, it } from 'vitest';
import { AMBIENT_PRESET, generateScore, resolveConfig, swellAt } from '../src/engine';

describe('swells', () => {
  it('are off by default (level is always 1)', () => {
    const s = generateScore({ seed: 1 });
    for (let t = 0; t < s.timeline.end; t += 0.37) expect(swellAt(s, 3, t)).toBe(1);
  });

  it('chord mode dips at each change and swells into the chord', () => {
    const s = generateScore({ seed: 2, audio: { swell: 'chord', swellDepth: 0.7 } });
    for (let k = 1; k < s.chords.length - 1; k++) {
      const a = s.chords[k].t;
      const b = s.chords[k + 1].t;
      expect(swellAt(s, 0, a + 1e-6)).toBeCloseTo(0.3, 2);
      expect(swellAt(s, 0, a + (b - a) * 0.55)).toBeCloseTo(1, 2);
    }
    expect(swellAt(s, 0, s.timeline.arrivalStart + 0.1)).toBe(1); // the arrival is never ducked
  });

  it('voice mode only dips voices that move', () => {
    const s = generateScore({ seed: 2, audio: { swell: 'voice', swellDepth: 0.8 } });
    let checkedStill = 0;
    let checkedMoving = 0;
    for (let k = 2; k < s.chords.length; k++) {
      const mid = s.chords[k].t + 0.05;
      for (let v = 0; v < 13; v++) {
        const moving = s.moves[v].some((m) => m.t0 <= mid && m.t0 + m.d >= mid);
        // Still means: no glide anywhere near (swelling back from an earlier move takes a while).
        const still = !s.moves[v].some((m) => m.t0 < mid + 0.5 && m.t0 + m.d > mid - 3);
        if (still) {
          expect(swellAt(s, v, mid)).toBe(1);
          checkedStill++;
        }
        if (moving) {
          expect(swellAt(s, v, mid)).toBeLessThan(0.5);
          checkedMoving++;
        }
      }
    }
    expect(checkedStill).toBeGreaterThan(5);
    expect(checkedMoving).toBeGreaterThan(5);
    const mid = s.chords[3].t + 0.05;
    expect(swellAt(s, -1, mid)).toBe(1); // melody unaffected in voice mode
  });

  it('breath mode stays within depth and varies smoothly', () => {
    const s = generateScore({ seed: 9, endless: true, audio: { swell: 'breath', swellDepth: 0.6 } });
    let prev = swellAt(s, 0, 0);
    for (let t = 0; t < 60; t += 0.05) {
      const g = swellAt(s, 0, t);
      expect(g).toBeGreaterThanOrEqual(0.4 - 1e-9);
      expect(g).toBeLessThanOrEqual(1);
      expect(Math.abs(g - prev)).toBeLessThan(0.05);
      prev = g;
    }
  });

  it('ambient preset is a valid config', () => {
    const c = resolveConfig(AMBIENT_PRESET);
    expect(c.motion.transition).toBe('swell');
    expect(c.timing.swellIn).toBeGreaterThan(1);
    expect(c.timing.release).toBeGreaterThan(c.timing.swellIn);
  });
});

describe('release & swell-in transitions', () => {
  const cfg = { seed: 2, motion: { transition: 'swell' as const }, timing: { swellIn: 1.5, release: 2.5 } };

  it('picks the same chords and voicings as glide mode', () => {
    const glide = generateScore({ seed: 2 });
    const swell = generateScore(cfg);
    expect(swell.chords.map((c) => c.notes)).toEqual(glide.chords.map((c) => c.notes));
  });

  it('fades each new chord in while the previous one releases underneath', async () => {
    const { layerAt } = await import('../src/engine');
    const s = generateScore(cfg);
    for (let k = 1; k < s.chords.length; k++) {
      const c = s.chords[k];
      const L = (k % 2) as 0 | 1;
      const O = (1 - L) as 0 | 1;
      expect(layerAt(s, L, 0, c.t + 1e-6).g).toBeLessThan(0.01); // new chord starts silent…
      expect(layerAt(s, O, 0, c.t + 1e-6).g).toBeGreaterThan(0.99); // …under the full old one
      expect(layerAt(s, L, 0, c.t + 1.5).g).toBeGreaterThan(0.99); // swelled in
      const nextT = s.chords[k + 1]?.t ?? s.timeline.arrivalEnd;
      if (nextT - c.t > 2.6) expect(layerAt(s, O, 0, c.t + 2.55).g).toBeLessThan(0.01); // old one released
    }
  });

  it('only changes a layer\'s pitch while that layer is silent (no audible glides between chords)', async () => {
    const { layerAt } = await import('../src/engine');
    const s = generateScore(cfg);
    const bloomEnd = s.chords[0].settled;
    for (const L of [0, 1] as const) {
      for (let v = 0; v < 13; v++) {
        let prev = layerAt(s, L, v, bloomEnd);
        for (let t = bloomEnd; t < s.timeline.arrivalStart; t += 0.01) {
          const cur = layerAt(s, L, v, t);
          if (cur.p !== prev.p) expect(Math.min(cur.g, prev.g)).toBeLessThan(0.02);
          prev = cur;
        }
      }
    }
  });

  it('still converges on the arrival note', async () => {
    const { layerAt } = await import('../src/engine');
    const s = generateScore(cfg);
    const L = ((s.chords.length - 1) % 2) as 0 | 1;
    const end = layerAt(s, L, 0, s.timeline.arrivalEnd + 0.05);
    expect(end.p).toBe(s.endNote);
    expect(end.g).toBe(1);
  });
});
