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
    expect(c.audio.reverb).toBeGreaterThan(0.5);
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
        for (let t = bloomEnd; t < s.timeline.arrivalEnd + 0.5; t += 0.002) {
          const cur = layerAt(s, L, v, t);
          // Pitch may only jump while silent; the arrival glide moves continuously.
          if (Math.abs(cur.p - prev.p) > 0.5) expect(Math.min(cur.g, prev.g)).toBeLessThan(0.02);
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

describe('pluck articulation', () => {
  it('re-strikes at each chord change and decays toward the sustain level', async () => {
    const { articulationAt, PLUCK_PRESET } = await import('../src/engine');
    const s = generateScore({ ...PLUCK_PRESET, seed: 2, motion: { transition: 'pluck' }, rhythm: { pluck: '' } });
    const sus = s.config.audio.sustain;
    for (const c of s.chords.slice(1, -1)) {
      expect(articulationAt(s, c.t)).toBeCloseTo(sus, 5); // starts from sustain: no click
      expect(articulationAt(s, c.t + s.config.audio.attack)).toBeCloseTo(1, 5); // full at the end of the attack
      expect(articulationAt(s, c.t + 0.3)).toBeLessThan(0.7); // decaying
    }
    expect(articulationAt(s, s.timeline.arrivalEnd)).toBe(1); // the arrival rings
  });
  it('re-strikes the current chord on the strike pattern, at the tempo', async () => {
    const { articulationAt } = await import('../src/engine');
    const s = generateScore({ seed: 2, motion: { transition: 'pluck' }, rhythm: { tempo: 120, pluck: 'e' } });
    // Eighths at 120 BPM: a strike every 0.25 s after the bloom, even while the chord holds.
    const c = s.chords[2];
    const start = s.gridStart + Math.ceil((c.t - s.gridStart) / 0.25 + 1) * 0.25;
    for (let i = 0; i < 4; i++) {
      const strike = start + i * 0.25;
      if (s.chords.some((x) => Math.abs(x.t - strike) < 0.3)) continue;
      expect(articulationAt(s, strike + s.config.audio.attack)).toBeCloseTo(1, 5);
      expect(articulationAt(s, strike + 0.2)).toBeLessThan(articulationAt(s, strike + s.config.audio.attack));
    }
  });
  it('treats rests in the pattern as no strike', async () => {
    const { articulationAt } = await import('../src/engine');
    const s = generateScore({ seed: 2, motion: { transition: 'pluck' }, rhythm: { tempo: 120, pluck: 're e' } });
    const onBeat = s.gridStart + 8 * 0.5; // a downbeat = rest
    if (!s.chords.some((x) => Math.abs(x.t - onBeat) < 0.6)) {
      expect(articulationAt(s, onBeat + 0.01)).toBeLessThan(0.9);
      expect(articulationAt(s, onBeat + 0.25 + s.config.audio.attack)).toBeCloseTo(1, 5);
    }
  });
  it('maps old pluck-envelope links to Pluck chord changes', () => {
    expect(resolveConfig({ audio: { envelope: 'pluck' } }).motion.transition).toBe('pluck');
    expect(resolveConfig({ audio: { envelope: 'pluck' }, motion: { transition: 'swell' } }).motion.transition).toBe('swell');
  });
  it('is off (level 1) for sustained chords', async () => {
    const { articulationAt } = await import('../src/engine');
    const s = generateScore({ seed: 2 });
    expect(articulationAt(s, s.chords[2].t + 0.3)).toBe(1);
  });
});

describe('pluck glides into the strike', () => {
  it('lands every glide exactly on the chord change, without overlaps', async () => {
    const { PLUCK_PRESET } = await import('../src/engine');
    for (const cfg of [{ audio: { envelope: 'pluck' as const } }, { ...PLUCK_PRESET, motion: { transition: 'pluck' as const } }, { motion: { transition: 'pluck' as const }, style: 'gospel' as const }]) {
      const s = generateScore({ seed: '0x23487296', key: 'F', ...cfg });
      for (const c of s.chords.slice(1)) {
        for (let v = 0; v < 13; v++) {
          const m = s.moves[v].find((x) => Math.abs(x.t0 + x.d - c.t) < 1e-9);
          const prev = s.chords[c.index - 1].notes[v];
          if (prev !== c.notes[v]) expect(m, `voice ${v} at chord ${c.index}`).toBeTruthy();
        }
      }
      for (const m of s.moves) for (let i = 1; i < m.length; i++) expect(m[i].t0).toBeGreaterThanOrEqual(m[i - 1].t0 + m[i - 1].d - 1e-9);
    }
  });
  it('keeps levels within 0..1 everywhere, including before the start', async () => {
    const { levelAt } = await import('../src/engine');
    const s = generateScore({ seed: 1, audio: { envelope: 'pluck', swell: 'breath' } });
    for (let t = -6; t < s.timeline.end; t += 0.05) {
      const g = levelAt(s, 0, t);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });
});
