import { resolveConfig, type ChordDriftConfig, type DeepPartial } from './config';
import { ProgressionWalker, type ChordSpec } from './progression';
import { parseProgression, type ProgressionToken } from './progression-text';
import { formatSeed, parseSeed, randInt, stream, uniform, type Rng } from './rng';
import { DEGREE_OFFSETS, SCALES, mod12, parseNote, parsePc, spellNote, tonicName } from './theory';
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
  /** Sorted MIDI notes, bass first. */
  notes: number[];
  /** When the change starts (s). */
  t: number;
  /** When every voice has arrived (s). */
  settled: number;
}

export interface Timeline {
  introEnd: number;
  /** Infinity for endless pieces (and everything after it). */
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
  scaleName: string;
  finalKeyPc: number;
  startNote: number;
  endNote: number;
  endless: boolean;
  /** Grows over time when endless. */
  chords: ScoreChord[];
  /** Per voice, sorted, non-overlapping. Grows over time when endless. */
  moves: Move[][];
  /** Per-voice detune in cents (audio only; the picture shows exact pitches). */
  detune: number[];
  /** Per-voice stereo position, -1..1. */
  pan: number[];
  /** HUD chord label changes. */
  labels: { t: number; text: string }[];
  timeline: Timeline;
  /** Lowest and highest MIDI pitch anywhere in the (generated part of the) piece. */
  pitchRange: [number, number];
  /** Problems reading the written progression, if any. */
  errors: string[];
  /** Make sure chords exist up to time t (no-op for finite pieces). Deterministic. */
  extend(t: number): void;
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

/** How far ahead of the requested time an endless score keeps chords ready (s). */
const LOOKAHEAD = 12;

/**
 * Builds a score chord by chord. Finite pieces are built completely up front;
 * endless pieces grow on demand via score.extend(t). Every random stream lives
 * here, so the result depends only on the config, never on when extend() runs.
 */
class ScoreBuilder {
  readonly score: Score;
  private cfg: ChordDriftConfig;
  private rules: VoicingRules;
  private walker: ProgressionWalker;
  private voicingRng: Rng;
  private timeRng: Rng;
  private staggerRng: Rng;
  private current: number[];
  private nextChange: number;
  private total: number | null;

  constructor(input: DeepPartial<ChordDriftConfig> | ChordDriftConfig) {
    const cfg = (this.cfg = resolveConfig(input as DeepPartial<ChordDriftConfig>));
    const seed = parseSeed(cfg.seed);
    const V = cfg.voices;
    this.rules = voicingRules(cfg);

    const keyRng = stream(seed, 'key');
    const autoKey = Math.floor(keyRng() * 12);
    const keyPc = cfg.key === 'auto' ? autoKey : parsePc(cfg.key) ?? 0;

    const parsed = parseProgression(cfg.progression);
    const tokens: ProgressionToken[] = parsed.tokens;
    const lengthRng = stream(seed, 'length');
    const randomCount = randInt(lengthRng, cfg.chordCount[0], cfg.chordCount[1]);
    this.total = cfg.endless ? null : tokens.length ? tokens.length : randomCount;

    const startNote = resolveNote(cfg.startNote, keyPc, 'low');
    this.walker = new ProgressionWalker(cfg, keyPc, stream(seed, 'progression'), tokens);
    this.voicingRng = stream(seed, 'voicing');
    this.timeRng = stream(seed, 'timing');
    this.staggerRng = stream(seed, 'stagger');
    this.current = new Array<number>(V).fill(startNote);
    this.nextChange = cfg.timing.intro;

    const detuneRng = stream(seed, 'detune');
    const panRng = stream(seed, 'pan');
    const inf = Number.POSITIVE_INFINITY;
    this.score = {
      config: cfg,
      seed,
      seedLabel: formatSeed(seed),
      keyPc,
      keyName: tonicName(keyPc, cfg.scale),
      scaleName: SCALES[cfg.scale].name,
      finalKeyPc: keyPc,
      startNote,
      endNote: startNote,
      endless: cfg.endless,
      chords: [],
      moves: Array.from({ length: V }, () => []),
      detune: Array.from({ length: V }, () => uniform(detuneRng, -1, 1) * cfg.audio.detuneCents),
      pan: Array.from({ length: V }, () => uniform(panRng, -1, 1) * cfg.audio.width),
      labels: [{ t: 0, text: `unison ${spellNote(startNote, keyPc, cfg.scale)}` }],
      timeline: { introEnd: cfg.timing.intro, arrivalStart: inf, arrivalEnd: inf, musicEnd: inf, zoomStart: inf, zoomEnd: inf, end: inf },
      pitchRange: [startNote, startNote],
      errors: parsed.errors,
      extend: (t: number) => this.extendTo(t),
    };

    if (this.total !== null) {
      for (let k = 0; k < this.total; k++) this.addChord();
      this.addArrival();
    } else {
      this.extendTo(0);
    }
  }

  private extendTo(t: number) {
    if (this.total !== null) return;
    // Hard cap so a runaway request can't hang the page.
    let guard = 0;
    while (this.nextChange < t + LOOKAHEAD && guard++ < 500) this.addChord();
  }

  private addChord() {
    const { cfg, rules, score } = this;
    const T = cfg.timing;
    const V = cfg.voices;
    const k = score.chords.length;
    const ref = k === 0 ? spreadTemplate(V, score.startNote, rules) : this.current;
    const cost = (c: { root: number; intervals: number[] }) => voiceLeadingCost(ref, voiceChord(c, ref, rules, null), rules);
    const spec = this.walker.next(k, this.total, cost);
    const notes = voiceChord(spec, ref, rules, this.voicingRng);

    const t = this.nextChange;
    const bloom = k === 0;
    let span = 0;
    for (let v = 0; v < V; v++) {
      const delay = this.staggerRng() * (bloom ? Math.min(T.stagger, T.bloom * 0.2) * 0.3 : T.stagger);
      const p0 = this.current[v];
      const p1 = notes[v];
      if (p0 === p1) continue;
      const leap = Math.abs(p1 - p0);
      // The bloom fans out with a slight stagger but every voice lands together.
      const d = bloom ? T.bloom - delay : T.glide * (1 + leap / 12);
      score.moves[v].push({ t0: t + delay, d, p0, p1 });
      span = Math.max(span, delay + d);
    }
    const chord: ScoreChord = { ...spec, index: k, notes, t, settled: t + span };
    score.chords.push(chord);
    score.labels.push({ t, text: spec.name });
    score.finalKeyPc = this.walker.tonic;
    score.pitchRange = [Math.min(score.pitchRange[0], ...notes), Math.max(score.pitchRange[1], ...notes)];
    const jitter = 1 + uniform(this.timeRng, -T.holdJitter, T.holdJitter);
    this.nextChange = t + span + Math.max(0.35, T.hold * jitter - T.glide);
    this.current = notes;
  }

  private addArrival() {
    const { cfg, score } = this;
    const T = cfg.timing;
    const endNote = resolveNote(cfg.endNote, this.walker.tonic, 'high');
    const arrivalStart = score.chords.length ? this.nextChange : T.intro;
    for (let v = 0; v < cfg.voices; v++) {
      // Slight stagger at the start, but everyone lands together.
      const delay = this.staggerRng() * Math.min(T.stagger, T.arrival * 0.3) * 0.5;
      if (this.current[v] !== endNote) score.moves[v].push({ t0: arrivalStart + delay, d: T.arrival - delay, p0: this.current[v], p1: endNote });
    }
    const arrivalEnd = arrivalStart + T.arrival;
    const musicEnd = arrivalEnd + T.outro;
    const zoomStart = arrivalEnd + 0.4;
    const zoomEnd = zoomStart + T.zoom;
    score.endNote = endNote;
    score.labels.push({ t: arrivalStart, text: `→ ${spellNote(endNote, this.walker.tonic, this.walker.scale)}` });
    score.pitchRange = [Math.min(score.pitchRange[0], endNote), Math.max(score.pitchRange[1], endNote)];
    score.timeline = {
      introEnd: T.intro,
      arrivalStart,
      arrivalEnd,
      musicEnd,
      zoomStart,
      zoomEnd,
      end: Math.max(musicEnd + 1.5, zoomEnd) + T.finalHold,
    };
  }
}

export function generateScore(input: DeepPartial<ChordDriftConfig> | ChordDriftConfig = {}): Score {
  return new ScoreBuilder(input).score;
}
