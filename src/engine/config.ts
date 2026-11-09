import { SCALES } from './theory';

/**
 * scale    — key-locked: chords built from the selected scale
 * drift    — key-locked, but sometimes borrows (modal interchange, mediants) or modulates
 * voiceled — any root, any quality; the smoothest voice leading wins
 * free     — any root, any quality, no preference
 */
export type Mode = 'scale' | 'drift' | 'voiceled' | 'free';
const MODE_ALIASES: Record<string, Mode> = { diatonic: 'scale', chromatic: 'voiceled' };
export type Easing = 'smootherstep' | 'cosine';
export type Wave = 'sine' | 'triangle';

export interface Timing {
  /** Unison hold before the bloom (s). */
  intro: number;
  /** Glide from unison to the first chord (s). */
  bloom: number;
  /** Time from one chord change to the next (s), before jitter. */
  hold: number;
  /** ± fraction applied to each hold, seeded. 0.3 = ±30%. */
  holdJitter: number;
  /** Base glide length d (s); scaled up for big leaps. */
  glide: number;
  /** Max per-voice start delay on each change (s). */
  stagger: number;
  /** Final convergence glide (s). */
  arrival: number;
  /** Ring-out on the final unison (s). */
  outro: number;
  /** Video only: zoom-out to the whole piece (s). */
  zoom: number;
  /** Video only: hold on the zoomed-out final frame (s). */
  finalHold: number;
}

export interface ChordDriftConfig {
  seed: string | number;
  /** Big header text. */
  series: string;
  /** Episode number shown as "#15 · Title"; 0 hides it. */
  episode: number;
  /** Piece name, shown in the subtitle. */
  title: string;
  voices: number;
  /** Tonic: "auto" (seeded) or a name like "C", "F#", "Bb". */
  key: string;
  /** Scale id from SCALES (major, dorian, hirajoshi, octatonicHW…). */
  scale: string;
  mode: Mode;
  /** 1 = triads … 3 = 9ths/11ths … 5 = 13ths and altered colours. */
  complexity: number;
  /**
   * Written progression (see progression-text.ts). Empty = generate everything.
   * "?" tokens are filled by the generator. Loops when endless.
   */
  progression: string;
  /** Never arrive: keep generating chords forever. */
  endless: boolean;
  /** Drift mode: chance per change of borrowing a chord from outside the key. */
  driftProbability: number;
  chordCount: [number, number];
  /** 0 = pure random walk; higher = strongly prefer chords that share tones with the last one. */
  smoothness: number;
  range: { bass: [number, number]; upper: [number, number] };
  /** Degree relative to the key ("fifth", "tonic+1oct"), a note name ("G2") or MIDI number. */
  startNote: string | number;
  endNote: string | number;
  timing: Timing;
  voicing: {
    /** Bonus (in semitones of movement) for keeping the top voice as a pedal. */
    pedalBonus: number;
    /** Weight of bass movement in the voice-leading cost. */
    bassWeight: number;
    /** Extra cost per upper voice that moves at all; higher = fewer, larger moves. */
    movePenalty: number;
    /** Below this MIDI note, adjacent voices must be at least minGap apart. */
    mudFloor: number;
    minGap: number;
    /** Max copies of one pitch class among the upper voices. */
    maxCopies: number;
    /** Number of randomized searches per chord. */
    candidates: number;
  };
  motion: { easing: Easing };
  audio: {
    wave: Wave;
    detuneCents: number;
    /** 0..1 wet amount. */
    reverb: number;
    /** Spectral tilt exponent: gain × (f/220)^-tilt. */
    tilt: number;
    lowpass: number;
    /** 0..1 stereo spread of the voices. */
    width: number;
    gain: number;
  };
  video: { width: number; height: number; fps: number; historySeconds: number; nowPosition: number };
}

export const DEFAULT_CONFIG: ChordDriftConfig = {
  seed: '0xF5E68707',
  series: 'Chord Drift',
  episode: 15,
  title: 'Arrival',
  voices: 13,
  key: 'auto',
  scale: 'major',
  mode: 'scale',
  complexity: 3,
  progression: '',
  endless: false,
  driftProbability: 0.25,
  chordCount: [8, 12],
  smoothness: 1,
  range: { bass: [36, 47], upper: [45, 79] },
  startNote: 'fifth',
  endNote: 'tonic+2oct',
  timing: {
    intro: 1.0,
    bloom: 2.7,
    hold: 2.0,
    holdJitter: 0.3,
    glide: 0.8,
    stagger: 0.25,
    arrival: 1.5,
    outro: 1.2,
    zoom: 1.6,
    finalHold: 2.0,
  },
  voicing: { pedalBonus: 1.5, bassWeight: 0.3, movePenalty: 2, mudFloor: 48, minGap: 3, maxCopies: 3, candidates: 24 },
  motion: { easing: 'smootherstep' },
  audio: { wave: 'sine', detuneCents: 3, reverb: 0.35, tilt: 0.3, lowpass: 7000, width: 0.6, gain: 0.9 },
  video: { width: 1080, height: 1920, fps: 60, historySeconds: 5, nowPosition: 0.75 },
};

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch) || !isPlainObject(base)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = k in base ? deepMerge((base as Record<string, unknown>)[k], v) : v;
  }
  return out as T;
}

/** Merge a partial config over the defaults and clamp values into sane ranges. */
export function resolveConfig(partial: DeepPartial<ChordDriftConfig> = {}): ChordDriftConfig {
  const c = deepMerge(structuredClone(DEFAULT_CONFIG), partial);
  c.voices = Math.max(2, Math.min(48, Math.round(c.voices)));
  c.driftProbability = Math.max(0, Math.min(1, c.driftProbability));
  c.smoothness = Math.max(0, c.smoothness);
  const [lo, hi] = c.chordCount;
  c.chordCount = [Math.max(1, Math.round(Math.min(lo, hi))), Math.max(1, Math.round(Math.max(lo, hi)))];
  c.mode = MODE_ALIASES[c.mode] ?? c.mode;
  if (!['scale', 'drift', 'voiceled', 'free'].includes(c.mode)) c.mode = 'scale';
  if (!SCALES[c.scale]) c.scale = 'major';
  c.complexity = Math.max(1, Math.min(5, Math.round(Number(c.complexity) || 3)));
  c.progression = String(c.progression ?? '');
  c.endless = Boolean(c.endless);
  for (const k of Object.keys(c.timing) as (keyof Timing)[]) c.timing[k] = Math.max(0, Number(c.timing[k]) || 0);
  c.timing.bloom = Math.max(0.1, c.timing.bloom);
  c.timing.glide = Math.max(0.05, c.timing.glide);
  c.timing.arrival = Math.max(0.1, c.timing.arrival);
  c.timing.holdJitter = Math.min(0.9, c.timing.holdJitter);
  c.voicing.candidates = Math.max(1, Math.round(c.voicing.candidates));
  return c;
}
