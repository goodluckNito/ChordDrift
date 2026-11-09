import { resolveConfig, type ChordDriftConfig, type DeepPartial } from './config';
import { ProgressionWalker, type ChordSpec } from './progression';
import { formatSeed, parseSeed, randInt, stream, uniform } from './rng';
import { DEGREE_OFFSETS, KEY_NAMES, chordName, mod12, noteName, parseNote, parsePc } from './theory';
import { spreadTemplate, voiceChord, voiceLeadingCost, type VoicingRules } from './voicing';

/** One glide of one voice, in MIDI pitch space. */
export interface Move {
  /** Start time including the per-voice stagger (s). */
  t0: number;
  d: number;
  p0: number;
  p1: number;
}

export interface ScoreChord extends ChordSpec {
  index: number;
  name: string;
  /** Sorted MIDI notes, bass first. */
  notes: number[];
  /** When the change starts (s). */
  t: number;
  /** When every voice has arrived (s). */
  settled: number;
}

export interface Timeline {
  introEnd: number;
  arrivalStart: number;
  arrivalEnd: number;
  /** Voices fade out by here. */
  musicEnd: number;
  zoomStart: number;
  zoomEnd: number;
  /** Total length of the render, audio tail and final hold included. */
  end: number;
}

export interface Score {
  config: ChordDriftConfig;
  seed: number;
  seedLabel: string;
  keyPc: number;
  keyName: string;
  finalKeyPc: number;
  startNote: number;
  endNote: number;
  chords: ScoreChord[];
  /** Per voice, sorted, non-overlapping. */
  moves: Move[][];
  /** Per-voice detune in cents (audio only; the picture shows exact pitches). */
  detune: number[];
  /** Per-voice stereo position, -1..1. */
  pan: number[];
  /** HUD chord label changes. */
  labels: { t: number; text: string }[];
  timeline: Timeline;
  /** Lowest and highest MIDI pitch anywhere in the piece. */
  pitchRange: [number, number];
}

/**
 * Resolve "fifth", "tonic+2oct", "G2" or 43. Degree names are placed relative to
 * a reference octave: low notes (start) land in MIDI 40–51, high notes (end) in 60–71,
 * then shifted by the given number of octaves.
 */
export function resolveNote(spec: string | number, keyPc: number, register: 'low' | 'high'): number {
  if (typeof spec === 'number') return Math.round(spec);
  const asNote = parseNote(spec);
  if (asNote !== null) return asNote;
  const m = /^\s*([a-z]+|[A-G][#b]?)\s*(?:([+-])\s*(\d+)\s*oct)?\s*$/i.exec(spec);
  if (!m) throw new Error(`Can't read note "${spec}"`);
  const word = m[1].toLowerCase();
  let pc: number;
  if (word in DEGREE_OFFSETS) pc = mod12(keyPc + DEGREE_OFFSETS[word]);
  else {
    const p = parsePc(m[1]);
    if (p === null) throw new Error(`Can't read note "${spec}"`);
    pc = p;
  }
  const base = register === 'low' ? 40 : 60;
  const octaves = m[2] ? (m[2] === '-' ? -1 : 1) * Number(m[3]) : 0;
  return base + mod12(pc - base) + 12 * octaves;
}

export function voicingRules(cfg: ChordDriftConfig): VoicingRules {
  return { ...cfg.voicing, bass: cfg.range.bass, upper: cfg.range.upper };
}

export function generateScore(input: DeepPartial<ChordDriftConfig> | ChordDriftConfig = {}): Score {
  const cfg = resolveConfig(input as DeepPartial<ChordDriftConfig>);
  const seed = parseSeed(cfg.seed);
  const V = cfg.voices;
  const rules = voicingRules(cfg);

  const keyRng = stream(seed, 'key');
  const autoKey = Math.floor(keyRng() * 12);
  const keyPc = cfg.key === 'auto' ? autoKey : parsePc(cfg.key) ?? 0;

  const lengthRng = stream(seed, 'length');
  const chordCount = randInt(lengthRng, cfg.chordCount[0], cfg.chordCount[1]);

  const startNote = resolveNote(cfg.startNote, keyPc, 'low');

  // ---- Progression + voicing -------------------------------------------------
  const walker = new ProgressionWalker(cfg, keyPc, stream(seed, 'progression'));
  const voicingRng = stream(seed, 'voicing');
  const template = spreadTemplate(V, startNote, rules);
  let current = new Array<number>(V).fill(startNote);
  const chords: ScoreChord[] = [];
  for (let k = 0; k < chordCount; k++) {
    const ref = k === 0 ? template : current;
    const cost = (spec: ChordSpec) => voiceLeadingCost(ref, voiceChord(spec, ref, rules, null), rules);
    const spec = walker.next(k, chordCount, cost);
    const notes = voiceChord(spec, ref, rules, voicingRng);
    chords.push({ ...spec, index: k, name: chordName(spec.root, spec.type, spec.keyPc), notes, t: 0, settled: 0 });
    current = notes;
  }
  const finalKeyPc = walker.key;
  const endNote = resolveNote(cfg.endNote, finalKeyPc, 'high');

  // ---- Timing ----------------------------------------------------------------
  const T = cfg.timing;
  const timeRng = stream(seed, 'timing');
  const staggerRng = stream(seed, 'stagger');
  const moves: Move[][] = Array.from({ length: V }, () => []);
  let prev = new Array<number>(V).fill(startNote);
  let t = T.intro;
  for (const chord of chords) {
    const bloom = chord.index === 0;
    let span = 0;
    for (let v = 0; v < V; v++) {
      const delay = staggerRng() * (bloom ? Math.min(T.stagger, T.bloom * 0.2) * 0.3 : T.stagger);
      const p0 = prev[v];
      const p1 = chord.notes[v];
      if (p0 === p1) continue;
      const leap = Math.abs(p1 - p0);
      // The bloom fans out with a slight stagger but every voice lands together.
      const d = bloom ? T.bloom - delay : T.glide * (1 + leap / 12);
      moves[v].push({ t0: t + delay, d, p0, p1 });
      span = Math.max(span, delay + d);
    }
    chord.t = t;
    chord.settled = t + span;
    const jitter = 1 + uniform(timeRng, -T.holdJitter, T.holdJitter);
    t = t + span + Math.max(0.35, T.hold * jitter - T.glide);
    prev = chord.notes;
  }
  const arrivalStart = chords.length ? t : T.intro;
  for (let v = 0; v < V; v++) {
    // Slight stagger at the start, but everyone lands together.
    const delay = staggerRng() * Math.min(T.stagger, T.arrival * 0.3) * 0.5;
    if (prev[v] !== endNote) moves[v].push({ t0: arrivalStart + delay, d: T.arrival - delay, p0: prev[v], p1: endNote });
  }
  const arrivalEnd = arrivalStart + T.arrival;
  const musicEnd = arrivalEnd + T.outro;
  const zoomStart = arrivalEnd + 0.4;
  const zoomEnd = zoomStart + T.zoom;
  const end = Math.max(musicEnd + 1.5, zoomEnd) + T.finalHold;

  // ---- Per-voice audio colour ------------------------------------------------
  const detuneRng = stream(seed, 'detune');
  const detune = Array.from({ length: V }, () => uniform(detuneRng, -1, 1) * cfg.audio.detuneCents);
  const panRng = stream(seed, 'pan');
  const pan = Array.from({ length: V }, () => uniform(panRng, -1, 1) * cfg.audio.width);

  const labels = [
    { t: 0, text: `unison ${noteName(startNote, keyPc)}` },
    ...chords.map((c) => ({ t: c.t, text: c.name })),
    { t: arrivalStart, text: `→ ${noteName(endNote, finalKeyPc)}` },
  ];

  let lo = Math.min(startNote, endNote);
  let hi = Math.max(startNote, endNote);
  for (const c of chords) {
    lo = Math.min(lo, ...c.notes);
    hi = Math.max(hi, ...c.notes);
  }

  return {
    config: cfg,
    seed,
    seedLabel: formatSeed(seed),
    keyPc,
    keyName: KEY_NAMES[keyPc],
    finalKeyPc,
    startNote,
    endNote,
    chords,
    moves,
    detune,
    pan,
    labels,
    timeline: { introEnd: T.intro, arrivalStart, arrivalEnd, musicEnd, zoomStart, zoomEnd, end },
    pitchRange: [lo, hi],
  };
}
