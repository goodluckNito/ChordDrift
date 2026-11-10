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
import { STYLES, STYLE_IDS, type StyleId } from './styles';
import { THEME_PRESETS, randomTheme } from './themes';
import { KEY_NAMES } from './theory';

const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const weighted = <T>(r: Rng, xs: readonly [T, number][]): T => {
  let x = r() * xs.reduce((a, [, w]) => a + w, 0);
  for (const [v, w] of xs) if ((x -= w) < 0) return v;
  return xs[0][0];
};
const between = (r: Rng, lo: number, hi: number, step = 0.05) => Math.round((lo + r() * (hi - lo)) / step) * step;

/**
 * How far a word song may wander. Chill keeps to familiar ground — major and minor (with the odd
 * dorian or mixolydian), simpler chords, friendly styles, key-locked harmony and a firm pull home.
 * Adventurous opens up every scale, style and generator.
 */
export type SongMood = 'pure' | 'chill' | 'adventurous';

/** Friendly styles for chill songs (the others lean dark, jazzy or exotic). */
const CHILL_STYLES: StyleId[] = ['pop', 'classical', 'cinematic', 'gospel'];

/**
 * Every setting of a song, drawn from one random stream. Leaves the output format alone. Both
 * moods make the same draws in the same order (so adding chill didn't change adventurous songs).
 */
export function surpriseConfig(seed: string | number, r: Rng, mood: SongMood = 'adventurous'): DeepPartial<ChordDriftConfig> {
  // "Just chords" shares chill's harmony (same draws), then strips the arrangement back below.
  const chill = mood === 'chill' || mood === 'pure';
  const styleRoll = r();
  const style = styleRoll < 0.5 ? 'none' : chill ? pick(r, CHILL_STYLES) : pick(r, STYLE_IDS.filter((s) => s !== 'none') as StyleId[]);
  const scale = chill
    ? weighted(r, [
        ['major', 5],
        ['minor', 4],
        ['dorian', 1],
        ['mixolydian', 0.8],
      ] as [string, number][])
    : weighted(r, [
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
    ['glide', chill ? 7 : 6],
    ['swell', 2],
    ['pluck', chill ? 1 : 2],
  ] as ['glide' | 'swell' | 'pluck', number][]);
  const song = r() < 0.35;
  const drums = r() < (chill ? 0.35 : 0.45);
  const drumPreset = pick(r, chill ? DRUM_PRESETS.filter((p) => !/trap|breakbeat|jungle/i.test(p.name)) : DRUM_PRESETS);
  const kit = pick(r, (chill ? ['808', 'acoustic', '808', 'acoustic', 'witch'] : ['witch', '808', 'acoustic', 'industrial', 'jungle']) as KitId[]);
  const view = weighted(r, [
    ['timeline', 6],
    ['spiral', 3],
    ['waterfall', 1.5],
    ['chladni', 1.2],
    ['fifths', 1.2],
    ['constellation', 1.2],
  ] as ['timeline' | 'spiral' | 'waterfall' | 'chladni' | 'fifths' | 'constellation', number][]);
  const theme = randomTheme(r);
  let tempo = 0;
  const out: DeepPartial<ChordDriftConfig> = {
    seed,
    key: r() < 0.25 ? 'auto' : pick(r, KEY_NAMES),
    scale,
    style,
    mode: weighted(r, [
      ['scale', chill ? 6 : 4],
      ['drift', chill ? 1.5 : 3],
      ['voiceled', chill ? 0 : 2],
    ] as ['scale' | 'drift' | 'voiceled', number][]),
    // Within the style's range when there is one (the style would clamp it anyway).
    complexity: ((c: number) => (style === 'none' ? c : Math.max(STYLES[style].complexity[0], Math.min(STYLES[style].complexity[1], c))))(
      weighted(r, [
        [1, chill ? 1.2 : 1],
        [2, chill ? 3.5 : 2],
        [3, chill ? 1.5 : 3],
        [4, chill ? 0 : 2],
        [5, chill ? 0 : 1],
      ] as [number, number][]),
    ),
    voices: pick(r, [7, 9, 11, 13, 13, 15]),
    smoothness: chill ? between(r, 0.8, 2, 0.1) : between(r, 0.4, 2, 0.1),
    resolution: chill ? between(r, 0.4, 0.8) : between(r, 0.15, 0.75),
    driftProbability: chill ? between(r, 0.05, 0.2) : between(r, 0.1, 0.45),
    voicing: { inversion: r() < (chill ? 0.75 : 0.5) ? 0 : chill ? between(r, 0.1, 0.25) : between(r, 0.1, 0.4) },
    endNote: pick(r, ['tonic+1oct', 'tonic+1oct', 'tonic+2oct', 'tonic', 'tonic-2oct', 'start']),
    loop: r() < 0.2,
    endless: false,
    // (The original forms, so word songs keep their shape: Long arc joined the presets later.)
    song: { enabled: song, form: pick(r, SONG_PRESETS.filter((p) => p.name !== 'Long arc')).form },
    motion: { transition },
    rhythm: {
      tempo: (tempo = Math.round(between(r, 56, 104, 1))),
      // (The original list, so word songs keep their rhythms: '?' joined the presets later.)
      chords: r() < 0.45 ? '' : pick(r, RHYTHM_PRESETS.filter((p) => p.chords !== '?')).chords,
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
      // Double time only where it stays sane (about 180 bpm at most).
      double: kit === 'jungle' && r() < 0.6 && tempo <= 90,
    },
    chop: { enabled: r() < (chill ? 0.04 : 0.15), pattern: pick(r, CHOP_PRESETS).pattern, drums: true, chords: r() < 0.4, melody: false },
    audio: {
      wave: weighted(r, [
        ['warm', 3],
        ['triangle', 3],
        ['sine', 2],
        ['sawtooth', chill ? 0 : 1],
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
  // Drawn last, so adding them didn't change any earlier choice (word songs keep their music).
  out.drums = { ...out.drums, level: between(r, 0.5, 0.75), reverb: between(r, 0.1, 0.3) };
  if (mood === 'pure') {
    // Just chords: one piece, gliding freely on a clean, steady tone, in the classic timeline view.
    const calm = pick(r, ['paper', 'midnight', 'sepia', 'hex', 'moth', 'ossuary'] as const);
    Object.assign(out, {
      song: { enabled: false },
      loop: false,
      motion: { transition: 'glide' },
      rhythm: { ...out.rhythm, chords: '' },
      melody: { enabled: false },
      drums: { ...out.drums, enabled: false },
      chop: { ...out.chop, enabled: false },
      audio: { ...out.audio, swell: 'off', wave: pick(r, ['warm', 'triangle', 'sine'] as const), reverb: between(r, 0.3, 0.55) },
      theme: { ...THEME_PRESETS[calm] },
      video: { view: 'timeline' },
      voicing: { inversion: 0 },
    } as DeepPartial<ChordDriftConfig>);
  }
  // The compass came later: it shares the circle of fifths' share of songs (drawn last, so nothing else changes).
  if (out.video?.view === 'fifths' && r() < 0.5) out.video = { ...out.video, view: 'compass' };
  return out;
}

/** A song from any text: the same words (and mood) always make the same song. */
export function songFromText(text: string, mood: SongMood = 'adventurous'): DeepPartial<ChordDriftConfig> {
  const t = text.trim();
  return surpriseConfig(t, stream(hashSeed(0, t), 'surprise'), mood);
}
