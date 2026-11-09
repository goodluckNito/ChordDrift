/**
 * A whole song from anything: text (or a random draw) seeds every choice — scale, style,
 * generator, rhythm, drums, sound, theme, view — not just the chords. The same text always
 * gives the same song, so a link can be just the text.
 */
import type { ChordDriftConfig, DeepPartial } from './config';
import { CHOP_PRESETS } from './chop';
import { DRUM_PRESETS, type KitId } from './drums';
import { hashSeed, stream, type Rng } from './rng';
import { RHYTHM_PRESETS, STRIKE_PRESETS } from './rhythm';
import { SONG_PRESETS } from './song';
import { STYLE_IDS, type StyleId } from './styles';
import { randomTheme } from './themes';
import { KEY_NAMES } from './theory';

const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const weighted = <T>(r: Rng, xs: readonly [T, number][]): T => {
  let x = r() * xs.reduce((a, [, w]) => a + w, 0);
  for (const [v, w] of xs) if ((x -= w) < 0) return v;
  return xs[0][0];
};
const between = (r: Rng, lo: number, hi: number, step = 0.05) => Math.round((lo + r() * (hi - lo)) / step) * step;

/** Every setting of a song, drawn from one random stream. Leaves the output format alone. */
export function surpriseConfig(seed: string | number, r: Rng): DeepPartial<ChordDriftConfig> {
  const style = r() < 0.5 ? 'none' : pick(r, STYLE_IDS.filter((s) => s !== 'none') as StyleId[]);
  const scale = weighted(r, [
    ['major', 3],
    ['minor', 3],
    ['dorian', 2.5],
    ['mixolydian', 1.5],
    ['lydian', 1.5],
    ['phrygian', 1],
    ['harmonicMinor', 1],
    ['melodicMinor', 1],
    ['phrygianDominant', 0.6],
    ['lydianDominant', 0.5],
    ['hungarianMinor', 0.4],
    ['hirajoshi', 0.4],
    ['majorPentatonic', 0.5],
    ['wholeTone', 0.2],
  ] as [string, number][]);
  const transition = weighted(r, [
    ['glide', 6],
    ['swell', 2],
    ['pluck', 2],
  ] as ['glide' | 'swell' | 'pluck', number][]);
  const song = r() < 0.35;
  const drums = r() < 0.45;
  const drumPreset = pick(r, DRUM_PRESETS);
  const kit = pick(r, ['witch', '808', 'acoustic', 'industrial', 'jungle'] as KitId[]);
  const view = weighted(r, [
    ['timeline', 6],
    ['spiral', 3],
    ['waterfall', 1.5],
  ] as ['timeline' | 'spiral' | 'waterfall', number][]);
  const theme = randomTheme(r);
  return {
    seed,
    key: r() < 0.25 ? 'auto' : pick(r, KEY_NAMES),
    scale,
    style,
    mode: weighted(r, [
      ['scale', 4],
      ['drift', 3],
      ['voiceled', 2],
    ] as ['scale' | 'drift' | 'voiceled', number][]),
    complexity: weighted(r, [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 2],
      [5, 1],
    ] as [number, number][]),
    voices: pick(r, [7, 9, 11, 13, 13, 15]),
    smoothness: between(r, 0.4, 2, 0.1),
    resolution: between(r, 0.15, 0.75),
    driftProbability: between(r, 0.1, 0.45),
    voicing: { inversion: r() < 0.5 ? 0 : between(r, 0.1, 0.4) },
    endNote: pick(r, ['tonic+1oct', 'tonic+1oct', 'tonic+2oct', 'tonic', 'tonic-2oct', 'start']),
    loop: r() < 0.2,
    endless: false,
    song: { enabled: song, form: pick(r, SONG_PRESETS).form },
    motion: { transition },
    rhythm: {
      tempo: Math.round(between(r, 56, 104, 1)),
      chords: r() < 0.45 ? '' : pick(r, RHYTHM_PRESETS).chords,
      pluck: pick(r, STRIKE_PRESETS).pattern,
    },
    melody: { enabled: r() < 0.35, density: between(r, 0.15, 0.7), level: between(r, 0.3, 0.6) },
    drums: {
      enabled: drums,
      kit,
      kick: drumPreset.kick,
      snare: drumPreset.snare,
      hat: drumPreset.hat,
      crash: drumPreset.crash,
      ride: drumPreset.ride,
      double: kit === 'jungle' && r() < 0.6,
    },
    chop: { enabled: r() < 0.15, pattern: pick(r, CHOP_PRESETS).pattern, drums: true, chords: r() < 0.4, melody: false },
    audio: {
      wave: weighted(r, [
        ['warm', 3],
        ['triangle', 3],
        ['sine', 2],
        ['sawtooth', 1],
      ] as ['warm' | 'triangle' | 'sine' | 'sawtooth', number][]),
      reverb: between(r, 0.2, 0.8),
      lowpass: Math.round(between(r, 2800, 10000, 100)),
      detuneCents: Math.round(between(r, 2, 10, 0.5) * 2) / 2,
      width: between(r, 0.08, 0.35),
      swell: weighted(r, [
        ['off', 5],
        ['breath', 2],
        ['chord', 1],
      ] as ['off' | 'breath' | 'chord', number][]),
      swellDepth: between(r, 0.25, 0.6),
    },
    theme,
    video: { view, spiral: pick(r, ['orbit', 'drain', 'inward', 'fly'] as const) },
  };
}

/** A song from any text: the same words always make the same song. */
export function songFromText(text: string): DeepPartial<ChordDriftConfig> {
  const t = text.trim();
  return surpriseConfig(t, stream(hashSeed(0, t), 'surprise'));
}
