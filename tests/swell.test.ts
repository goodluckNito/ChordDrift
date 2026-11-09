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
    expect(c.audio.swell).toBe('chord');
    expect(c.timing.glide).toBeGreaterThan(1);
  });
});
