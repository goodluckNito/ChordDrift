import { SCALES } from './theory';
import { STYLE_IDS, type StyleId } from './styles';
import { DRUM_PRESETS, type DrumVoice, type KitId } from './drums';
import { FONT_NAMES, PALETTES, THEME_PRESETS, type Theme } from './themes';
import { DEFAULT_SONG_FORM } from './song';

/**
 * scale    — key-locked: chords built from the selected scale
 * drift    — key-locked, but sometimes borrows (modal interchange, mediants) or modulates
 * voiceled — any root, any quality; the smoothest voice leading wins
 * free     — any root, any quality, no preference
 */
export type Mode = 'scale' | 'drift' | 'voiceled' | 'free';
const MODE_ALIASES: Record<string, Mode> = { diatonic: 'scale', chromatic: 'voiceled' };
export type Easing = 'smootherstep' | 'cosine';
/**
 * How one chord becomes the next: voices glide · the old chord releases while the new one swells in ·
 * pluck: voices glide into a strike and ring out, re-struck on the strike pattern.
 */
export type Transition = 'glide' | 'swell' | 'pluck';
export type Wave = 'warm' | 'sine' | 'triangle' | 'sawtooth' | 'square';
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
  /** Chop: a 16th-step time/volume controller over the chords (see chop.ts). */
  chop: { enabled: boolean; pattern: string; drums: boolean; chords: boolean; melody: boolean };
  /** Song mode: a piece in parts (see song.ts). Overrides endless. */
  song: { enabled: boolean; form: string };
  /** Loop the piece seamlessly: it returns to the starting unison and starts again (no zoom-out, no fade). */
  loop: boolean;
  /** Drift mode: chance per change of borrowing a chord from outside the key. */
  driftProbability: number;
  chordCount: [number, number];
  /** 0 = pure random walk; higher = strongly prefer chords that share tones with the last one. */
  smoothness: number;
  /** 0..1: chance of a chromatic passing chord when the bass moves a whole step (A → A♯dim7 → B). */
  passing: number;
  /** 0..1: pull toward strong resolutions (falling fifths, dominants and sus dominants resolving, ii–V). */
  resolution: number;
  range: { bass: [number, number]; upper: [number, number] };
  /** Degree relative to the key ("fifth", "tonic+1oct"), a note name ("G2") or MIDI number. */
  startNote: string | number;
  /** Same forms as startNote, or "start" to resolve back to the starting unison. */
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
    /** Chance (0..1) that a chord is voiced as an inversion: the lowest voice or two jump up an octave, crossing the others. */
    inversion: number;
  };
  motion: { easing: Easing; transition: Transition };
  rhythm: {
    /** Beats (quarter notes) per minute, for chord and melody rhythms. */
    tempo: number;
    /** Chord-change rhythm in rhythm notation (see rhythm.ts); empty = free timing in seconds. Loops. */
    chords: string;
    /** Pluck chord changes: strike pattern that re-strikes the current chord (rests = no strike); empty = strike only on changes. */
    pluck: string;
  };
  melody: {
    enabled: boolean;
    /** Melody rhythm in rhythm notation; empty = random rhythm at `density`. Loops. */
    rhythm: string;
    /** 0 = sparse, long notes … 1 = busy, short notes (random rhythm only). */
    density: number;
    register: Register;
    /** solo = long singing lines, one note per chord with approach notes and turns; free = busier random rhythm (or the written rhythm). */
    style: 'solo' | 'free';
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
    /** 0..1 sub-bass: a sine an octave under the bass voice. */
    sub: number;
    /** 0..1 gentle saturation on the chords. */
    warmth: number;
    /** Low shelf at 110 Hz, in dB (0..12). */
    bass: number;
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
  drums: {
    enabled: boolean;
    kit: KitId;
    /** One step string per drum (16ths): x hit, X accent, . rest, o open hat, r roll. */
    kick: string;
    snare: string;
    hat: string;
    crash: string;
    ride: string;
    levels: Record<DrumVoice, number>;
    /** Drum bus level, 0..1. */
    level: number;
    /** Reverb send, 0..1. */
    reverb: number;
    /** Only the snare goes to the reverb. */
    reverbSnareOnly: boolean;
    /** Double time: patterns play at twice the speed (each character a 32nd note). */
    double: boolean;
    /** Sidechain: duck the chords under the kick and/or snare. */
    duck: { kick: boolean; snare: boolean; depth: number; release: number };
  };
  video: {
    width: number;
    height: number;
    fps: number;
    historySeconds: number;
    nowPosition: number;
    /** Spiral views: the chord name in the middle. */
    centerLabel: boolean;
    /** Zoom of the picture (titles and HUD stay put): 1 = normal. */
    zoom: number;
    /** timeline = pitch over time · spiral = pitch on a spiral · waterfall = rotating 3D spectrograph, depth is time */
    view: 'timeline' | 'spiral' | 'waterfall' | 'chladni' | 'constellation' | 'marbling' | 'murmur' | 'city' | 'kaleido';
    /** Night city look. */
    city: 'neon' | 'blueprint';
    /**
     * Spiral motion. orbit = rotation is time, distance from the centre is pitch, the past spirals inward ·
     * drain = like orbit, but the past sinks into the centre · fly = travel forward through time · inward = pitch-class clock
     */
    spiral: 'orbit' | 'drain' | 'fly' | 'inward';
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
  loop: false,
  song: { enabled: false, form: DEFAULT_SONG_FORM },
  chop: { enabled: false, pattern: 'xxxxxxxxxxxx<<<<', drums: true, chords: false, melody: false },
  driftProbability: 0.25,
  chordCount: [8, 12],
  smoothness: 1,
  resolution: 0.35,
  passing: 0.25,
  range: { bass: [36, 47], upper: [45, 79] },
  startNote: 'fifth',
  endNote: 'tonic+1oct',
  timing: {
    intro: 1.0,
    bloom: 2.7,
    hold: 3.5,
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
  voicing: { pedalBonus: 1.5, bassWeight: 0.3, movePenalty: 2, mudFloor: 48, minGap: 3, maxCopies: 3, candidates: 24, inversion: 0 },
  motion: { easing: 'smootherstep', transition: 'glide' },
  rhythm: { tempo: 54, chords: '?', pluck: 'e' },
  melody: { enabled: false, style: 'solo', rhythm: '', density: 0.5, register: 'high', fill: 'continuous', glide: 0.09, wave: 'triangle', level: 0.6 },
  audio: { wave: 'warm', detuneCents: 3, reverb: 0.35, tilt: 0.3, lowpass: 10000, width: 0.12, gain: 0.9, sub: 0.4, warmth: 0, bass: 2, swell: 'off', swellDepth: 0.65, envelope: 'sustain', attack: 0.008, decay: 0.45, sustain: 0.15 },
  theme: { ...THEME_PRESETS.paper },
  drums: {
    enabled: false,
    kit: 'witch',
    kick: DRUM_PRESETS[0].kick,
    snare: DRUM_PRESETS[0].snare,
    hat: DRUM_PRESETS[0].hat,
    crash: DRUM_PRESETS[0].crash,
    ride: DRUM_PRESETS[0].ride,
    levels: { kick: 0.9, snare: 0.75, hat: 0.4, crash: 0.45, ride: 0.4 },
    level: 0.8,
    reverb: 0.35,
    reverbSnareOnly: true,
    double: false,
    duck: { kick: true, snare: false, depth: 0.5, release: 0.25 },
  },
  video: { width: 1080, height: 1920, fps: 60, historySeconds: 5, nowPosition: 0.75, view: 'timeline', spiral: 'orbit', city: 'neon', zoom: 1, centerLabel: true },
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
  c.passing = Math.max(0, Math.min(1, Number(c.passing ?? 0.25)));
  c.resolution = Math.max(0, Math.min(1, Number(c.resolution ?? 0.35)));
  c.smoothness = Math.max(0, c.smoothness);
  const [lo, hi] = c.chordCount;
  c.chordCount = [Math.max(1, Math.round(Math.min(lo, hi))), Math.max(1, Math.round(Math.max(lo, hi)))];
  c.mode = MODE_ALIASES[c.mode] ?? c.mode;
  if (!['scale', 'drift', 'voiceled', 'free'].includes(c.mode)) c.mode = 'scale';
  if (!SCALES[c.scale]) c.scale = 'major';
  c.complexity = Math.max(1, Math.min(5, Math.round(Number(c.complexity) || 3)));
  c.progression = String(c.progression ?? '');
  if (!STYLE_IDS.includes(c.style)) c.style = 'none';
  c.video.centerLabel = c.video.centerLabel !== false;
  c.video.zoom = Math.max(0.4, Math.min(4, Number(c.video.zoom) || 1));
  if ((c.video.view as string) === 'tonnetz') c.video.view = 'chladni'; // the Chladni plate took its place
  // Retired views open in the nearest one that's left.
  if (['fifths', 'compass', 'scope'].includes(c.video.view as string)) c.video.view = 'constellation';
  if (['transit', 'ferro', 'pendulum', 'lava'].includes(c.video.view as string)) c.video.view = 'constellation';
  if (!['timeline', 'spiral', 'waterfall', 'chladni', 'constellation', 'marbling', 'murmur', 'city', 'kaleido'].includes(c.video.view)) c.video.view = 'timeline';
  if (c.video.city !== 'blueprint') c.video.city = 'neon';
  if ((c.video.spiral as string) === 'zoom') c.video.spiral = 'fly'; // older projects
  if (!['orbit', 'drain', 'fly', 'inward'].includes(c.video.spiral)) c.video.spiral = 'orbit';
  c.drums.double = Boolean(c.drums.double);
  c.voicing.inversion = Math.max(0, Math.min(1, Number(c.voicing.inversion) || 0));
  c.song.enabled = Boolean(c.song.enabled);
  c.song.form = String(c.song.form ?? '');
  c.chop.enabled = Boolean(c.chop.enabled);
  c.chop.pattern = String(c.chop.pattern ?? '');
  for (const k of ['drums', 'chords', 'melody'] as const) c.chop[k] = Boolean(c.chop[k]);
  c.endless = Boolean(c.endless) && !c.song.enabled;
  c.loop = Boolean(c.loop) && !c.endless;
  c.rhythm.tempo = Math.max(20, Math.min(320, Number(c.rhythm.tempo) || 54));
  c.rhythm.chords = String(c.rhythm.chords ?? '');
  c.rhythm.pluck = String(c.rhythm.pluck ?? '');
  c.melody.enabled = Boolean(c.melody.enabled);
  if (c.melody.style !== 'free') c.melody.style = 'solo';
  c.melody.rhythm = String(c.melody.rhythm ?? '');
  c.melody.density = Math.max(0, Math.min(1, Number(c.melody.density)));
  if (!(c.melody.register in REGISTERS)) c.melody.register = 'high';
  if (c.melody.fill !== 'gaps') c.melody.fill = 'continuous';
  c.melody.glide = Math.max(0, Number(c.melody.glide) || 0);
  c.melody.level = Math.max(0, Math.min(1, Number(c.melody.level)));
  if (!['off', 'chord', 'voice', 'breath'].includes(c.audio.swell)) c.audio.swell = 'off';
  c.audio.bass = Math.max(0, Math.min(12, Number(c.audio.bass) || 0));
  c.audio.swellDepth = Math.max(0, Math.min(0.95, Number(c.audio.swellDepth)));
  if (c.audio.envelope !== 'pluck') c.audio.envelope = 'sustain';
  c.audio.attack = Math.max(0.001, Math.min(1, Number(c.audio.attack) || 0.008));
  c.audio.decay = Math.max(0.03, Math.min(10, Number(c.audio.decay) || 0.45));
  c.audio.sustain = Math.max(0, Math.min(1, Number(c.audio.sustain)));
  const hex = /^#[0-9a-f]{6}$/i;
  const th = c.theme;
  for (const k of ['background', 'background2', 'ink', 'accent', 'text', 'lights'] as const) if (!hex.test(String(th[k]))) th[k] = THEME_PRESETS.paper[k];
  if (!(th.font in FONT_NAMES)) th.font = 'inter';
  if (!['none', 'voice', 'pitch', 'register'].includes(th.colorBy)) th.colorBy = 'none';
  th.lineWidth = Math.max(0.3, Math.min(4, Number(th.lineWidth) || 1));
  th.glow = Math.max(0, Math.min(1, Number(th.glow) || 0));
  th.colorSeed = Math.max(0, Math.floor(Number(th.colorSeed) || 0)) >>> 0;
  if (!(th.palette in PALETTES)) th.palette = 'rainbow';
  th.gradient = Boolean(th.gradient);
  th.grid = Boolean(th.grid);
  th.ripples = th.ripples !== false;
  th.hud = th.hud !== false;
  th.labels = th.labels !== false;
  // Older projects stored the melody colour on video.
  const legacy = (partial as { video?: { melodyColor?: string } }).video?.melodyColor;
  if (legacy && hex.test(legacy) && !(partial as { theme?: unknown }).theme) th.accent = legacy;
  const d = c.drums;
  d.enabled = Boolean(d.enabled);
  if (!['808', 'witch', 'acoustic', 'industrial', 'jungle'].includes(d.kit)) d.kit = 'witch';
  for (const v of ['kick', 'snare', 'hat', 'crash', 'ride'] as const) {
    d[v] = String(d[v] ?? '');
    d.levels[v] = Math.max(0, Math.min(1, Number(d.levels[v])));
  }
  d.level = Math.max(0, Math.min(1, Number(d.level)));
  d.reverb = Math.max(0, Math.min(1, Number(d.reverb)));
  d.reverbSnareOnly = Boolean(d.reverbSnareOnly);
  d.duck.kick = Boolean(d.duck.kick);
  d.duck.snare = Boolean(d.duck.snare);
  d.duck.depth = Math.max(0, Math.min(1, Number(d.duck.depth)));
  d.duck.release = Math.max(0.03, Math.min(2, Number(d.duck.release) || 0.25));
  const waves: Wave[] = ['warm', 'sine', 'triangle', 'sawtooth', 'square'];
  if (!waves.includes(c.audio.wave)) c.audio.wave = 'warm';
  c.audio.sub = Math.max(0, Math.min(1, Number(c.audio.sub)));
  c.audio.warmth = Math.max(0, Math.min(1, Number(c.audio.warmth)));
  c.audio.width = Math.max(0, Math.min(1, Number(c.audio.width)));
  if (!waves.includes(c.melody.wave)) c.melody.wave = 'triangle';
  for (const k of Object.keys(c.timing) as (keyof Timing)[]) c.timing[k] = Math.max(0, Number(c.timing[k]) || 0);
  c.timing.bloom = Math.max(0.1, c.timing.bloom);
  c.timing.glide = Math.max(0.05, c.timing.glide);
  c.timing.arrival = Math.max(0.1, c.timing.arrival);
  c.timing.holdJitter = Math.min(0.9, c.timing.holdJitter);
  c.timing.swellIn = Math.max(0.05, c.timing.swellIn);
  c.timing.release = Math.max(0.05, c.timing.release);
  // Older projects had pluck as an envelope setting; it is now a chord-change mode.
  const legacyPluck = (partial as { audio?: { envelope?: string } }).audio?.envelope === 'pluck';
  if (legacyPluck && !(partial as { motion?: { transition?: string } }).motion?.transition) c.motion.transition = 'pluck';
  if (!['glide', 'swell', 'pluck'].includes(c.motion.transition)) c.motion.transition = 'glide';
  c.voicing.candidates = Math.max(1, Math.round(c.voicing.candidates));
  return c;
}

/**
 * Sound presets change only the sound: envelope (ADSR-ish), swells, reverb and
 * tone. Never rhythm, timing, chord changes, harmony or theme.
 */
/** "Ambient": soft swells into each chord, a dark triangle tone, wide detune, deep reverb. */
export const AMBIENT_PRESET: DeepPartial<ChordDriftConfig> = {
  motion: { transition: 'glide' },
  audio: { wave: 'triangle', reverb: 0.75, detuneCents: 7, lowpass: 3600, swell: 'breath', swellDepth: 0.4, envelope: 'sustain' },
};

/** "Pluck": a fast strike that decays to a low level, a brighter triangle and a short room (strikes happen with Pluck chord changes). */
export const PLUCK_PRESET: DeepPartial<ChordDriftConfig> = {
  motion: { transition: 'pluck' },
  audio: { attack: 0.006, decay: 0.32, sustain: 0.1, wave: 'triangle', reverb: 0.3, lowpass: 6500, swell: 'off' },
};

/** "Dark": detuned saws through a low filter, deep reverb, slow breathing. Pairs well with the Witch house style and Hex theme. */
export const DARK_PRESET: DeepPartial<ChordDriftConfig> = {
  audio: { wave: 'sawtooth', lowpass: 1600, detuneCents: 11, reverb: 0.85, swell: 'breath', swellDepth: 0.35, envelope: 'sustain' },
};
