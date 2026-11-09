import { SCALES } from './theory';
import { STYLE_IDS, type StyleId } from './styles';
import { FONT_NAMES, THEME_PRESETS, type Theme } from './themes';

/**
 * scale    — key-locked: chords built from the selected scale
 * drift    — key-locked, but sometimes borrows (modal interchange, mediants) or modulates
 * voiceled — any root, any quality; the smoothest voice leading wins
 * free     — any root, any quality, no preference
 */
export type Mode = 'scale' | 'drift' | 'voiceled' | 'free';
const MODE_ALIASES: Record<string, Mode> = { diatonic: 'scale', chromatic: 'voiceled' };
export type Easing = 'smootherstep' | 'cosine';
/** How one chord becomes the next: voices glide, or the old chord releases while the new one swells in. */
export type Transition = 'glide' | 'swell';
export type Wave = 'sine' | 'triangle' | 'sawtooth' | 'square';
export type Register = 'low' | 'mid' | 'high' | 'top';
/** off · chord: dip at each change, swell into the chord · voice: moving voices fade and re-swell · breath: slow waves */
export type Swell = 'off' | 'chord' | 'voice' | 'breath';

/** MIDI ranges for the melody's registers. */
export const REGISTERS: Record<Register, [number, number]> = { low: [57, 72], mid: [67, 81], high: [79, 93], top: [86, 100] };

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
  /** "Release & swell in" transitions: fade-in time of each new chord (s). */
  swellIn: number;
  /** "Release & swell in" transitions: release time of the outgoing chord (s). */
  release: number;
}

export interface ChordDriftConfig {
  seed: string | number;
  /** Big header text; empty = no header. */
  series: string;
  /** Episode number shown as "#15 · Title"; 0 hides it. */
  episode: number;
  /** Piece name, shown in the subtitle; empty = none. */
  title: string;
  voices: number;
  /** Tonic: "auto" (seeded) or a name like "C", "F#", "Bb". */
  key: string;
  /** Scale id from SCALES (major, dorian, hirajoshi, octatonicHW…). */
  scale: string;
  mode: Mode;
  /** 1 = triads … 3 = 9ths/11ths … 5 = 13ths and altered colours. */
  complexity: number;
  /** Genre planner: phrases, cadences and key changes in a style ('none' = use the generator). */
  style: StyleId;
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
  motion: { easing: Easing; transition: Transition };
  rhythm: {
    /** Beats (quarter notes) per minute, for chord and melody rhythms. */
    tempo: number;
    /** Chord-change rhythm in rhythm notation (see rhythm.ts); empty = free timing in seconds. Loops. */
    chords: string;
  };
  melody: {
    enabled: boolean;
    /** Melody rhythm in rhythm notation; empty = random rhythm at `density`. Loops. */
    rhythm: string;
    /** 0 = sparse, long notes … 1 = busy, short notes (random rhythm only). */
    density: number;
    register: Register;
    /** continuous = over everything; gaps = only while chords hold still, resting through changes. */
    fill: 'continuous' | 'gaps';
    /** Portamento between notes (s). */
    glide: number;
    wave: Wave;
    /** 0..1 level relative to the chords. */
    level: number;
  };
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
    /** Volume swells (an ambient option). */
    swell: Swell;
    /** 0..1 how deep the swells dip. */
    swellDepth: number;
    /** sustain = chords hold at full level · pluck = each chord change re-strikes and decays */
    envelope: 'sustain' | 'pluck';
    /** Pluck: attack time (s). */
    attack: number;
    /** Pluck: decay time constant toward the sustain level (s). */
    decay: number;
    /** Pluck: level the decay settles at, 0..1. */
    sustain: number;
  };
  theme: Theme;
  video: {
    width: number;
    height: number;
    fps: number;
    historySeconds: number;
    nowPosition: number;
    /** timeline = pitch over time (the classic view) · spiral = pitch wrapped around a spiral, history curling inward */
    view: 'timeline' | 'spiral';
    /** Spiral motion: fly = travel forward through time, upcoming notes rushing toward you · inward = history curls toward the centre */
    spiral: 'fly' | 'inward';
  };
}

export const DEFAULT_CONFIG: ChordDriftConfig = {
  seed: '0xF5E68707',
  series: '',
  episode: 0,
  title: '',
  voices: 13,
  key: 'auto',
  scale: 'major',
  mode: 'scale',
  complexity: 3,
  style: 'none',
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
    swellIn: 1.8,
    release: 2.6,
  },
  voicing: { pedalBonus: 1.5, bassWeight: 0.3, movePenalty: 2, mudFloor: 48, minGap: 3, maxCopies: 3, candidates: 24 },
  motion: { easing: 'smootherstep', transition: 'glide' },
  rhythm: { tempo: 76, chords: '' },
  melody: { enabled: false, rhythm: '', density: 0.5, register: 'high', fill: 'continuous', glide: 0.09, wave: 'triangle', level: 0.6 },
  audio: { wave: 'sine', detuneCents: 3, reverb: 0.35, tilt: 0.3, lowpass: 7000, width: 0.6, gain: 0.9, swell: 'off', swellDepth: 0.65, envelope: 'sustain', attack: 0.008, decay: 0.45, sustain: 0.15 },
  theme: { ...THEME_PRESETS.paper },
  video: { width: 1080, height: 1920, fps: 60, historySeconds: 5, nowPosition: 0.75, view: 'timeline', spiral: 'fly' },
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
  if (!STYLE_IDS.includes(c.style)) c.style = 'none';
  if (c.video.view !== 'spiral') c.video.view = 'timeline';
  if (c.video.spiral !== 'inward') c.video.spiral = 'fly'; // ('zoom' from older projects becomes 'fly')
  c.endless = Boolean(c.endless);
  c.rhythm.tempo = Math.max(20, Math.min(320, Number(c.rhythm.tempo) || 76));
  c.rhythm.chords = String(c.rhythm.chords ?? '');
  c.melody.enabled = Boolean(c.melody.enabled);
  c.melody.rhythm = String(c.melody.rhythm ?? '');
  c.melody.density = Math.max(0, Math.min(1, Number(c.melody.density)));
  if (!(c.melody.register in REGISTERS)) c.melody.register = 'high';
  if (c.melody.fill !== 'gaps') c.melody.fill = 'continuous';
  c.melody.glide = Math.max(0, Number(c.melody.glide) || 0);
  c.melody.level = Math.max(0, Math.min(1, Number(c.melody.level)));
  if (!['off', 'chord', 'voice', 'breath'].includes(c.audio.swell)) c.audio.swell = 'off';
  c.audio.swellDepth = Math.max(0, Math.min(0.95, Number(c.audio.swellDepth)));
  if (c.audio.envelope !== 'pluck') c.audio.envelope = 'sustain';
  c.audio.attack = Math.max(0.001, Math.min(1, Number(c.audio.attack) || 0.008));
  c.audio.decay = Math.max(0.03, Math.min(10, Number(c.audio.decay) || 0.45));
  c.audio.sustain = Math.max(0, Math.min(1, Number(c.audio.sustain)));
  const hex = /^#[0-9a-f]{6}$/i;
  const th = c.theme;
  for (const k of ['background', 'background2', 'ink', 'accent', 'text'] as const) if (!hex.test(String(th[k]))) th[k] = THEME_PRESETS.paper[k];
  if (!(th.font in FONT_NAMES)) th.font = 'inter';
  if (!['none', 'voice', 'pitch', 'register'].includes(th.colorBy)) th.colorBy = 'none';
  th.lineWidth = Math.max(0.3, Math.min(4, Number(th.lineWidth) || 1));
  th.glow = Math.max(0, Math.min(1, Number(th.glow) || 0));
  th.gradient = Boolean(th.gradient);
  th.grid = Boolean(th.grid);
  th.hud = th.hud !== false;
  th.labels = th.labels !== false;
  // Older projects stored the melody colour on video.
  const legacy = (partial as { video?: { melodyColor?: string } }).video?.melodyColor;
  if (legacy && hex.test(legacy) && !(partial as { theme?: unknown }).theme) th.accent = legacy;
  const waves: Wave[] = ['sine', 'triangle', 'sawtooth', 'square'];
  if (!waves.includes(c.audio.wave)) c.audio.wave = 'sine';
  if (!waves.includes(c.melody.wave)) c.melody.wave = 'triangle';
  for (const k of Object.keys(c.timing) as (keyof Timing)[]) c.timing[k] = Math.max(0, Number(c.timing[k]) || 0);
  c.timing.bloom = Math.max(0.1, c.timing.bloom);
  c.timing.glide = Math.max(0.05, c.timing.glide);
  c.timing.arrival = Math.max(0.1, c.timing.arrival);
  c.timing.holdJitter = Math.min(0.9, c.timing.holdJitter);
  c.timing.swellIn = Math.max(0.05, c.timing.swellIn);
  c.timing.release = Math.max(0.05, c.timing.release);
  if (c.motion.transition !== 'swell') c.motion.transition = 'glide';
  c.voicing.candidates = Math.max(1, Math.round(c.voicing.candidates));
  return c;
}

/**
 * Sound presets change only the sound: envelope (ADSR-ish), swells, reverb and
 * tone. Never rhythm, timing, chord changes, harmony or theme.
 */
/** "Ambient": soft swells into each chord, a dark triangle tone, wide detune, deep reverb. */
export const AMBIENT_PRESET: DeepPartial<ChordDriftConfig> = {
  audio: { wave: 'triangle', reverb: 0.8, detuneCents: 7, lowpass: 3200, swell: 'chord', swellDepth: 0.6, envelope: 'sustain' },
};

/** "Pluck": each chord change strikes and decays; brighter triangle, short room. */
export const PLUCK_PRESET: DeepPartial<ChordDriftConfig> = {
  audio: { envelope: 'pluck', attack: 0.006, decay: 0.38, sustain: 0.12, wave: 'triangle', reverb: 0.3, lowpass: 6500, swell: 'off' },
};

/** "Dark": detuned saws through a low filter, deep reverb, slow breathing. Pairs well with the Witch house style and Hex theme. */
export const DARK_PRESET: DeepPartial<ChordDriftConfig> = {
  audio: { wave: 'sawtooth', lowpass: 1600, detuneCents: 11, reverb: 0.85, swell: 'breath', swellDepth: 0.35, envelope: 'sustain' },
};
