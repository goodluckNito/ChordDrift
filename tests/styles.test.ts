import { describe, expect, it } from 'vitest';
import { STYLES, generateScore, parseProgression, type StyleId } from '../src/engine';

const ids = Object.keys(STYLES) as Exclude<StyleId, 'none'>[];

describe('styles', () => {
  it('only uses chords the progression language can read', () => {
    for (const [id, st] of Object.entries(STYLES)) {
      const all = [...st.phrases.major, ...st.phrases.minor, ...st.final.major, ...st.final.minor, ...st.modulations.map((m) => m.via), st.returnVia, ...(st.finalLift?.options.map((m) => m.via) ?? [])];
      for (const text of all) expect(parseProgression(text).errors, `${id}: ${text}`).toEqual([]);
    }
  });

  for (const id of ids) {
    it(`${id}: plans phrases and closes on the final key's tonic`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        for (const scale of ['major', 'minor']) {
          const s = generateScore({ seed, style: id, scale });
          expect(s.errors).toEqual([]);
          expect(s.chords.length).toBeGreaterThanOrEqual(8);
          const last = s.chords.at(-1)!;
          expect(last.root, `${id} ${scale} seed ${seed}: ${s.chords.map((c) => c.name).join(' ')}`).toBe(s.finalKeyPc);
        }
      }
    });
  }

  it('modulates in styles that travel, and marks the key change', () => {
    for (const id of ['classical', 'jazz', 'cinematic', 'gospel'] as const) {
      let changes = 0;
      for (let seed = 1; seed <= 10; seed++) changes += generateScore({ seed, style: id }).chords.filter((c) => c.roman.includes('→')).length;
      expect(changes, id).toBeGreaterThan(3);
    }
  });

  it('returns home when the style says so', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = generateScore({ seed, style: 'classical', key: 'C' });
      expect(s.finalKeyPc).toBe(0);
    }
  });

  it('impressionist planing moves voices together', () => {
    const s = generateScore({ seed: 3, style: 'impressionist', key: 'C' });
    let parallel = 0;
    let changes = 0;
    for (let k = 2; k < s.chords.length; k++) {
      const a = s.chords[k - 1].notes;
      const b = s.chords[k].notes;
      if (a.join() === b.join()) continue;
      changes++;
      const moved = b.filter((n, i) => n !== a[i]).length;
      if (moved >= 10) parallel++;
    }
    expect(parallel / changes).toBeGreaterThan(0.5);
  });

  it('runs endlessly and deterministically', () => {
    for (const id of ids) {
      const a = generateScore({ seed: 4, style: id, endless: true });
      a.extend(120);
      const b = generateScore({ seed: 4, style: id, endless: true });
      for (const t of [20, 70, 120]) b.extend(t);
      expect(a.chords.length).toBeGreaterThan(30);
      expect(b.chords.slice(0, 30).map((c) => c.name)).toEqual(a.chords.slice(0, 30).map((c) => c.name));
    }
  });

  it('leaves unstyled pieces exactly as before', () => {
    const plain = generateScore({ seed: 9 });
    const none = generateScore({ seed: 9, style: 'none' });
    expect(none.chords.map((c) => c.notes)).toEqual(plain.chords.map((c) => c.notes));
  });
});

describe('generative styles', () => {
  it('every vocabulary, ending and spark chord parses', async () => {
    const { STYLES, parseProgression } = await import('../src/engine');
    for (const [id, def] of Object.entries(STYLES)) {
      const g = def.gen!;
      expect(g, id).toBeTruthy();
      for (const mode of ['major', 'minor'] as const) {
        const all = [...Object.keys(g.vocab[mode]), ...g.endings[mode], ...(g.sparks?.chords[mode] ?? [])].join(' ');
        expect(parseProgression(all).errors, `${id} ${mode}`).toEqual([]);
      }
    }
  });

  it('witch house no longer repeats the same few loops', async () => {
    const { generateScore, resolveConfig } = await import('../src/engine');
    const phrases = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const s = generateScore(resolveConfig({ seed, key: 'F', scale: 'minor', style: 'witchhouse', chordCount: [16, 16] }));
      for (let i = 0; i + 4 <= s.chords.length; i += 4) phrases.add(s.chords.slice(i, i + 4).map((c) => c.roman.replace(/[0-9b#()]+$/, '')).join(' '));
    }
    expect(phrases.size).toBeGreaterThan(20);
  });
});
