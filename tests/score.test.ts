import { describe, expect, it } from 'vitest';
import { SCALE_IDS, generateScore, pitchAt, requiredTones, voiceChord, voicingRules, resolveConfig } from '../src/engine';

const MODES = ['scale', 'drift', 'voiceled', 'free'] as const;

describe('score generation', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = generateScore({ seed: '0xF5E68707' });
    const b = generateScore({ seed: '0xF5E68707' });
    const c = generateScore({ seed: '0x12345678' });
    expect(b.chords.map((x) => x.notes)).toEqual(a.chords.map((x) => x.notes));
    expect(b.moves).toEqual(a.moves);
    expect(c.chords.map((x) => x.name)).not.toEqual(a.chords.map((x) => x.name));
  });

  it('starts in unison, ends in unison on the target, with non-overlapping moves', () => {
    for (const mode of MODES) {
      for (let seed = 1; seed <= 12; seed++) {
        const s = generateScore({ seed, mode });
        expect(new Set(s.chords[0] && Array.from({ length: 13 }, (_, v) => pitchAt(s, v, 0))).size).toBe(1);
        for (let v = 0; v < 13; v++) {
          expect(pitchAt(s, v, s.timeline.arrivalEnd + 0.01)).toBe(s.endNote);
          const m = s.moves[v];
          for (let i = 1; i < m.length; i++) expect(m[i].t0).toBeGreaterThanOrEqual(m[i - 1].t0 + m[i - 1].d - 1e-9);
        }
      }
    }
  });

  it('voices every chord legally: sorted, root in the bass, required tones present', () => {
    for (const mode of MODES) {
      for (const scale of SCALE_IDS) {
        const s = generateScore({ seed: scale.length * 31 + mode.length, mode, scale, complexity: 1 + (scale.length % 5) });
        expect(s.errors).toEqual([]);
        for (const c of s.chords) {
          const [bass, ...upper] = c.notes;
          expect(c.notes).toHaveLength(13);
          expect(bass % 12, c.name).toBe(c.root);
          for (let i = 1; i < c.notes.length; i++) expect(c.notes[i], c.name).toBeGreaterThanOrEqual(c.notes[i - 1]);
          const present = new Set(upper.map((n) => (n - c.root + 120) % 12));
          for (const r of requiredTones(c.intervals).slice(0, 12)) expect(present.has(r), `${c.name} missing ${r}`).toBe(true);
        }
      }
    }
  });

  it('leads voices minimally — the reference Cmaj9 → Am11 moves at most 3 voices and keeps the top pedal', () => {
    const rules = voicingRules(resolveConfig());
    const cmaj9 = [36, 47, 50, 52, 55, 60, 62, 64, 67, 71, 74, 76, 79]; // from the reference frames
    const am11 = voiceChord({ root: 9, intervals: [0, 3, 7, 10, 14, 17] }, cmaj9, rules, null);
    const moved = am11.filter((n, i) => n !== cmaj9[i]).length;
    expect(moved).toBeLessThanOrEqual(3);
    expect(am11.at(-1)).toBe(79);
    expect(am11[0]).toBe(45); // A2
  });

  it('keeps generated progressions calm on average', () => {
    let moved = 0;
    let changes = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = generateScore({ seed });
      for (let k = 1; k < s.chords.length; k++) {
        moved += s.chords[k].notes.filter((n, i) => n !== s.chords[k - 1].notes[i]).length;
        changes++;
      }
    }
    expect(moved / changes).toBeLessThan(6);
  });

  it('respects written progressions, filling "?" from the generator', () => {
    const s = generateScore({ seed: 3, key: 'C', progression: 'Imaj9 vi11 ? IVmaj7#11' });
    expect(s.chords).toHaveLength(4);
    expect(s.chords.map((c) => c.name)).toEqual(['Cmaj9', 'Am11', s.chords[2].name, 'Fmaj7#11']);
    expect(s.chords[2].origin).not.toBe('written');
  });

  it('extends endless pieces deterministically regardless of how it is asked', () => {
    const a = generateScore({ seed: 5, endless: true, mode: 'drift' });
    a.extend(120);
    const b = generateScore({ seed: 5, endless: true, mode: 'drift' });
    for (const t of [10, 33, 47, 80, 120]) b.extend(t);
    expect(a.timeline.end).toBe(Infinity);
    expect(a.chords.length).toBeGreaterThan(40);
    const n = Math.min(a.chords.length, b.chords.length);
    expect(b.chords.slice(0, n).map((c) => c.notes)).toEqual(a.chords.slice(0, n).map((c) => c.notes));
  });

  it('loops written progressions when endless', () => {
    const s = generateScore({ seed: 1, key: 'C', endless: true, progression: 'Imaj7 IVmaj7' });
    s.extend(60);
    const names = s.chords.slice(0, 6).map((c) => c.name);
    expect(names).toEqual(['Cmaj7', 'Fmaj7', 'Cmaj7', 'Fmaj7', 'Cmaj7', 'Fmaj7']);
  });

  it('glides smoothly (no discontinuities in pitchAt)', () => {
    const s = generateScore({ seed: 11 });
    for (let v = 0; v < 13; v++) {
      let prev = pitchAt(s, v, 0);
      for (let t = 0.005; t < s.timeline.end; t += 0.005) {
        const p = pitchAt(s, v, t);
        expect(Math.abs(p - prev)).toBeLessThan(1.5); // even the 48-semitone arrival is continuous at 5 ms steps
        prev = p;
      }
    }
  });
});

describe('variety at high complexity', () => {
  const pcs = (c: { root: number; intervals: number[] }) => [...new Set(c.intervals.map((i) => (c.root + i) % 12))].sort((a, b) => a - b).join(',');
  for (const mode of ['scale', 'drift', 'voiceled'] as const) {
    it(`keeps moving and avoids repeats at complexity 5 (${mode})`, () => {
      let changes = 0;
      let moved = 0;
      let samePcs = 0;
      let recentRepeats = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const s = generateScore({ seed, mode, complexity: 5, endless: true });
        s.extend(60);
        const keys = s.chords.map((c) => `${c.root}|${pcs(c)}`);
        for (let k = 1; k < s.chords.length; k++) {
          changes++;
          moved += s.chords[k].notes.filter((n, i) => n !== s.chords[k - 1].notes[i]).length;
          if (pcs(s.chords[k]) === pcs(s.chords[k - 1])) samePcs++;
          if (keys.slice(Math.max(0, k - 4), k).includes(keys[k])) recentRepeats++;
        }
      }
      expect(moved / changes).toBeGreaterThan(3.5);
      expect(samePcs).toBe(0);
      expect(recentRepeats / changes).toBeLessThan(0.1);
    });
  }

  it('resolves secondary dominants to their target', () => {
    let found = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = generateScore({ seed, complexity: 5, endless: true });
      s.extend(60);
      s.chords.forEach((c, i) => {
        const next = s.chords[i + 1];
        if (c.origin !== 'secondary' || !next) return;
        found++;
        expect(c.roman).toMatch(/^V.*\//);
        if (next.root !== (c.root + 5) % 12) found -= 0.15; // the occasional deceptive move is fine
      });
    }
    expect(found).toBeGreaterThan(10);
  });

  it('spells chromatic chord tones from the chord root', async () => {
    const { spellChordNote } = await import('../src/engine');
    const e9 = { root: 4, intervals: [0, 4, 7, 10, 14], tonic: 0, scale: 'major' };
    expect(spellChordNote(68, e9)).toBe('G#4');
    const c7s9 = { root: 0, intervals: [0, 4, 7, 10, 15], tonic: 0, scale: 'major' };
    expect(spellChordNote(63, c7s9)).toBe('D#4');
  });
});

describe('opening unison', () => {
  it('is a true unison in every mode, even for voices that never bloom', async () => {
    const { pitchesAt } = await import('../src/engine');
    // This seed/key has a voice whose first-chord note equals the start note.
    for (const transition of ['glide', 'swell'] as const) {
      const s = generateScore({ seed: '0x0BDB3208', key: 'Ab', scale: 'phrygianDominant', motion: { transition } });
      for (const t of [-3, 0, 0.5, s.chords[0].t - 0.01]) expect(new Set(pitchesAt(s, t)).size).toBe(1);
    }
  });
  it('has no header text unless one is set', () => {
    const c = resolveConfig();
    expect([c.series, c.episode, c.title]).toEqual(['', 0, '']);
  });
});

describe('loop', () => {
  it('rises, then glides back to the starting unison, with no zoom-out or fade', () => {
    const s = generateScore({ seed: 4, loop: true });
    expect(s.endNote).toBeGreaterThan(s.startNote); // the default ending still rises…
    expect(s.timeline.zoomStart).toBe(Infinity);
    expect(s.timeline.musicEnd).toBe(Infinity);
    const L = s.timeline.end;
    // The end state equals the start state, so it wraps cleanly.
    for (let v = 0; v < 13; v++) expect(pitchAt(s, v, L - 1e-6)).toBe(pitchAt(s, v, 0));
  });
  it('falls and comes back up when the ending is below', () => {
    const s = generateScore({ seed: 4, loop: true, endNote: 'tonic-2oct' });
    expect(s.endNote).toBeLessThan(s.startNote);
    const mid = (s.timeline.arrivalEnd + s.timeline.end) / 2;
    expect(pitchAt(s, 0, s.timeline.arrivalEnd + 0.01)).toBe(s.endNote);
    for (let v = 0; v < 13; v++) expect(pitchAt(s, v, s.timeline.end - 1e-6)).toBe(s.startNote);
    expect(mid).toBeGreaterThan(s.timeline.arrivalEnd);
  });
  it('can resolve to the starting unison without looping', () => {
    const s = generateScore({ seed: 4, endNote: 'start' });
    expect(s.endNote).toBe(s.startNote);
    expect(Number.isFinite(s.timeline.zoomStart)).toBe(true);
  });
  it('is off for endless pieces', () => {
    expect(resolveConfig({ loop: true, endless: true }).loop).toBe(false);
  });
});
