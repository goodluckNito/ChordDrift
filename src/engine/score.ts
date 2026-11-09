import { resolveConfig, type ChordDriftConfig, type DeepPartial } from './config';
import { ProgressionWalker, type ChordSpec } from './progression';
import { MelodyGenerator, type MelodyNote } from './melody';
import { parseProgression, type ProgressionToken } from './progression-text';
import { chordDurations, parseRhythm, strikeOnsets } from './rhythm';
import { DRUM_VOICES, parseDrumRows, type DrumRows, type DrumVoice } from './drums';
import { formatSeed, parseSeed, randInt, stream, uniform, type Rng } from './rng';
import { DEGREE_OFFSETS, SCALES, mod12, parseNote, parsePc, spellNote, tonicName } from './theory';
import { STYLES } from './styles';
import { parseSongForm, type SongSection } from './song';
import { parseChop, type ChopPattern } from './chop';
import { chordName } from './chords';
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
  /** Song mode: index into score.sections, and whether this is a collapse into a unison between parts. */
  section?: number;
  unison?: boolean;
}

export interface ScoreSection {
  name: string;
  /** Drums that play in this part. */
  drums: DrumVoice[];
  label: string;
  full: boolean;
  shift: number;
  /** When its first chord starts (s). */
  t: number;
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
  /** Plays as a seamless loop of length timeline.end (ends on the starting unison). */
  loop: boolean;
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
  /** Pluck strike pattern (onsets in beats within a loop), or null for strikes only on chord changes. */
  strikes: { onsets: number[]; length: number } | null;
  /** Shortest time between pattern strikes (s), Infinity without a pattern. */
  strikeGap: number;
  /** Parsed drum rows when drums are on. */
  drums: DrumRows | null;
  /** Melody line (empty when the melody is off). Grows over time when endless. */
  melody: MelodyNote[];
  /** Where the beat grid starts (end of the bloom), and seconds per beat. */
  gridStart: number;
  beat: number;
  /** Chop pattern when chop is on (and does something). */
  chop: ChopPattern | null;
  /** Song mode: the parts in order (empty otherwise). */
  sections: ScoreSection[];
  /** Song mode: energy steps (1 = full part, 0 = soft part or collapse); empty otherwise. */
  energy: { t: number; e: number }[];
  /** Problems reading the written progression or rhythms, if any. */
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
  const style = cfg.style !== 'none' ? STYLES[cfg.style].voicing : undefined;
  return { ...cfg.voicing, bass: cfg.range.bass, upper: cfg.range.upper, ...style };
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
  /** Chord durations in seconds from the chord rhythm, or null for free timing. */
  private durations: number[] | null;
  private melody: MelodyGenerator | null = null;
  /** When the previous chord's glides had all landed. */
  private lastSettled = 0;
  /** Song mode: the chord plan, the parts, and a generator per distinct part. */
  private song: {
    items: { kind: 'unison' | 'chord'; section: number; local: number; slot: number }[];
    sections: SongSection[];
    parts: Map<string, { walker: ProgressionWalker; specs: ChordSpec[]; count: number; shift: number }>;
  } | null = null;
  private songTonic = 0;
  /** Index into the chord rhythm (collapses don't use a slot of it). */
  private rhythmIndex = 0;

  constructor(input: DeepPartial<ChordDriftConfig> | ChordDriftConfig) {
    const cfg = (this.cfg = resolveConfig(input as DeepPartial<ChordDriftConfig>));
    const seed = parseSeed(cfg.seed);
    const V = cfg.voices;
    this.rules = voicingRules(cfg);

    const keyRng = stream(seed, 'key');
    const autoKey = Math.floor(keyRng() * 12);
    const keyPc = cfg.key === 'auto' ? autoKey : parsePc(cfg.key) ?? 0;

    const parsed = parseProgression(cfg.progression);
    const beat = 60 / cfg.rhythm.tempo;
    const chordRhythm = parseRhythm(cfg.rhythm.chords);
    const durs = chordDurations(chordRhythm.steps);
    this.durations = durs.length ? durs.map((b) => b * beat) : null;
    const melodyRhythm = parseRhythm(cfg.melody.rhythm);
    const gridStart = cfg.timing.intro + cfg.timing.bloom;
    const tokens: ProgressionToken[] = parsed.tokens;
    const lengthRng = stream(seed, 'length');
    const randomCount = randInt(lengthRng, cfg.chordCount[0], cfg.chordCount[1]);
    this.total = cfg.endless ? null : tokens.length ? tokens.length : randomCount;

    const startNote = resolveNote(cfg.startNote, keyPc, 'low');
    this.walker = new ProgressionWalker(cfg, keyPc, stream(seed, 'progression'), tokens, stream(seed, 'style'));
    if (cfg.style !== 'none' && !tokens.length && this.total !== null) {
      // Styled finite pieces are planned in 4-chord phrases (chord count sets the phrase count).
      this.total = this.walker.planPiece(Math.max(2, Math.min(6, Math.round(randomCount / 4))));
    }
    const songForm = cfg.song.enabled ? parseSongForm(cfg.song.form) : null;
    if (songForm && songForm.sections.length) {
      const parts = new Map<string, { walker: ProgressionWalker; specs: ChordSpec[]; count: number; shift: number }>();
      const items: { kind: 'unison' | 'chord'; section: number; local: number; slot: number }[] = [];
      // Parts last whole bars. Chords change on the chord rhythm (once a bar without one),
      // restarting at each part; the last chord is cut to end on the part's last bar line.
      const rhythm = durs.length ? durs : [4];
      const bar = 4 * beat;
      const collapseSlot = Math.max(1, Math.ceil((cfg.timing.arrival + Math.max(0.8, cfg.timing.hold * 0.6)) / bar - 1e-6)) * bar;
      songForm.sections.forEach((sec, i) => {
        const slots: number[] = [];
        let left = sec.bars * 4;
        for (let r = 0; left > 1e-6 && slots.length < 512; r++) {
          const b = Math.min(rhythm[r % rhythm.length], left);
          slots.push(b * beat);
          left -= b;
        }
        let part = parts.get(sec.name);
        if (!part) {
          // Each distinct part gets its own seeded generator, in its own key.
          const walker = new ProgressionWalker(cfg, mod12(keyPc + sec.shift), stream(seed, `progression:${sec.name}`), tokens, stream(seed, `style:${sec.name}`));
          let count = slots.length;
          // A styled part plays its planned phrases, then repeats them to fill its bars.
          if (cfg.style !== 'none' && !tokens.length) count = Math.min(count, walker.planPiece(Math.max(1, Math.round(count / 4))));
          part = { walker, specs: [], count, shift: sec.shift };
          parts.set(sec.name, part);
        }
        if (sec.collapse) items.push({ kind: 'unison', section: i, local: 0, slot: collapseSlot });
        slots.forEach((slot, j) => items.push({ kind: 'chord', section: i, local: j, slot }));
      });
      this.song = { items, sections: songForm.sections, parts };
      this.total = items.length;
      this.songTonic = keyPc;
    }
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
      endless: cfg.endless && !this.song,
      loop: cfg.loop,
      chords: [],
      moves: Array.from({ length: V }, () => []),
      detune: Array.from({ length: V }, () => uniform(detuneRng, -1, 1) * cfg.audio.detuneCents),
      pan: Array.from({ length: V }, () => uniform(panRng, -1, 1) * cfg.audio.width),
      labels: [{ t: 0, text: `unison ${spellNote(startNote, keyPc, cfg.scale)}` }],
      timeline: { introEnd: cfg.timing.intro, arrivalStart: inf, arrivalEnd: inf, musicEnd: inf, zoomStart: inf, zoomEnd: inf, end: inf },
      pitchRange: [startNote, startNote],
      strikes: cfg.motion.transition === 'pluck' ? strikeOnsets(cfg.rhythm.pluck) : null,
      strikeGap: Infinity,
      drums: cfg.drums.enabled ? parseDrumRows(cfg.drums) : null,
      melody: [],
      sections: [],
      energy: [],
      chop: cfg.chop.enabled ? parseChop(cfg.chop.pattern).pattern : null,
      gridStart,
      beat,
      errors: [
        ...parsed.errors,
        ...chordRhythm.errors.map((e) => `chord rhythm: ${e}`),
        ...(cfg.motion.transition === 'pluck' ? parseRhythm(cfg.rhythm.pluck).errors.map((e) => `strike pattern: ${e}`) : []),
        ...(cfg.melody.enabled ? melodyRhythm.errors.map((e) => `melody rhythm: ${e}`) : []),
        ...(songForm ? songForm.errors.map((e) => `song form: ${e}`) : []),
        ...(cfg.chop.enabled ? parseChop(cfg.chop.pattern).errors.map((e) => `chop: ${e}`) : []),
      ],
      extend: (t: number) => this.extendTo(t),
    };
    if (this.score.strikes) {
      const { onsets, length } = this.score.strikes;
      let gap = Infinity;
      onsets.forEach((o, i) => (gap = Math.min(gap, (i + 1 < onsets.length ? onsets[i + 1] : onsets[0] + length) - o)));
      this.score.strikeGap = gap * beat;
    }
    if (cfg.melody.enabled) {
      this.melody = new MelodyGenerator(cfg, gridStart, melodyRhythm.steps, stream(seed, 'melody-rhythm'), stream(seed, 'melody-pitch'));
      this.score.melody = this.melody.notes;
    }

    if (this.total !== null) {
      for (let k = 0; k < this.total; k++) this.addChord();
      this.melody?.extendTo(this.nextChange, this.melodyContext(), true);
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
    // Melody only runs where the harmony is known.
    this.melody?.extendTo(this.nextChange - 1e-6, this.melodyContext());
  }

  private chordIndexAt(t: number): number {
    const chords = this.score.chords;
    let lo = 0;
    let hi = chords.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (chords[mid].t <= t) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return idx;
  }

  private melodyContext() {
    const chords = this.score.chords;
    return {
      chordAt: (t: number) => {
        const i = this.chordIndexAt(t);
        return i >= 0 ? chords[i] : null;
      },
      changesDuring: (t0: number, t1: number) => {
        const i = Math.max(0, this.chordIndexAt(t1));
        for (let k = i; k >= 0 && k >= i - 2; k--) {
          const c = chords[k];
          if (c.t < t1 && c.settled + 0.05 > t0) return true;
        }
        return false;
      },
    };
  }

  private addChord() {
    const { cfg, rules, score } = this;
    const T = cfg.timing;
    const V = cfg.voices;
    const k = score.chords.length;
    const song = this.song;
    const item = song ? song.items[k] : null;
    const unison = item?.kind === 'unison';
    // After a collapse the next part blooms out of the unison, like the opening.
    const reBloom = k > 0 && song?.items[k - 1]?.kind === 'unison';
    const ref = k === 0 ? spreadTemplate(V, score.startNote, rules) : reBloom ? spreadTemplate(V, this.current[0], rules) : this.current;
    const cost = (c: { root: number; intervals: number[] }) => {
      const v = voiceChord(c, ref, rules, null);
      // Changes where almost nothing moves read as repeats; nudge the choice away from them.
      const moved = v.reduce((n, x, i) => n + (x !== ref[i] ? 1 : 0), 0);
      return voiceLeadingCost(ref, v, rules) + (moved <= 1 ? 6 : moved === 2 ? 2.5 : 0);
    };
    let spec: ChordSpec;
    let notes: number[];
    if (song && item && unison) {
      // Collapse: every voice converges on the next part's tonic, near where the voices are now.
      const next = song.sections[item.section];
      const pc = mod12(score.keyPc + next.shift);
      const sorted = [...this.current].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      let u = median - mod12(median - pc);
      if (median - u > 6) u += 12;
      u = Math.max(cfg.range.bass[0], Math.min(cfg.range.upper[1], u));
      const scale = this.walker.scale;
      spec = { root: pc, intervals: [0], tonic: pc, scale, name: `unison ${spellNote(u, pc, scale)}`, roman: '—', origin: 'cadence' };
      notes = new Array<number>(V).fill(u);
    } else if (song && item) {
      const sec = song.sections[item.section];
      const part = song.parts.get(sec.name)!;
      let base: ChordSpec;
      if (part.specs.length < part.count) {
        // Parts after the first don't have to open on the tonic (only styled parts follow their plan from the top).
        const off = song.sections[0].name !== sec.name && !part.walker.planned ? 1 : 0;
        base = part.walker.next(part.specs.length + off, part.count + off, cost);
        part.specs.push(base);
      } else base = part.specs[item.local % part.specs.length];
      const d = sec.shift - part.shift;
      spec = d ? transposeSpec(base, d) : base;
      notes = voiceChord(spec, ref, rules, this.voicingRng);
      this.songTonic = spec.tonic;
    } else {
      spec = this.walker.next(k, this.total, cost);
      notes = voiceChord(spec, ref, rules, this.voicingRng);
    }

    const t = this.nextChange;
    const bloom = k === 0;
    // With a chord rhythm, each chord owns a fixed slot; glides must finish inside it.
    // A collapse takes whole bars (it doesn't use a slot of the chord rhythm), so the grid stays on the bar.
    const bar = 4 * score.beat;
    const slot = item
      ? item.slot
      : this.durations
      ? unison
        ? Math.max(1, Math.ceil((T.arrival + Math.max(0.8, T.hold * 0.6)) / bar - 1e-6)) * bar
        : this.durations[this.rhythmIndex++ % this.durations.length]
      : Infinity;
    const crossfade = cfg.motion.transition === 'swell' && !bloom;
    // Plucked chords glide *into* the strike: the slide happens in the quiet tail
    // of the previous chord and every voice lands together on the change, so the
    // attack hits the new chord (on the beat, with a rhythm) instead of the old one.
    const pluck = cfg.motion.transition === 'pluck' && !bloom;
    let span = 0;
    for (let v = 0; v < V; v++) {
      // Release-&-swell transitions don't glide: the new chord fades in on its own voices (see layerAt).
      if (crossfade) break;
      const maxDelay = bloom || reBloom ? Math.min(T.stagger, T.bloom * 0.2) * 0.3 : Math.min(T.stagger, slot * 0.15);
      const delay = this.staggerRng() * maxDelay;
      const p0 = this.current[v];
      const p1 = notes[v];
      if (p0 === p1) continue;
      const leap = Math.abs(p1 - p0);
      if (pluck) {
        const room = Math.max(0.02, (t - this.lastSettled) * 0.9);
        const d = Math.max(0.02, Math.min(T.glide * (1 + leap / 12), room));
        score.moves[v].push({ t0: t - d, d, p0, p1 });
        continue;
      }
      // The bloom fans out with a slight stagger but every voice lands together.
      let d = bloom ? T.bloom - delay : unison ? T.arrival : reBloom ? T.bloom : T.glide * (1 + leap / 12);
      if (!bloom) d = Math.max(0.02, Math.min(d, slot * 0.85 - delay));
      score.moves[v].push({ t0: t + delay, d, p0, p1 });
      span = Math.max(span, delay + d);
    }
    if (crossfade) {
      span = Math.min(T.swellIn, slot * 0.9);
      // Keep the stagger stream in step so switching transition modes doesn't change later randomness.
      for (let v = 0; v < V; v++) this.staggerRng();
    }
    const chord: ScoreChord = { ...spec, index: k, notes, t, settled: t + span };
    if (song && item) {
      chord.section = item.section;
      if (unison) chord.unison = true;
      else if (item.local === 0) {
        const sec = song.sections[item.section];
        score.sections.push({ name: sec.name, label: sec.label, full: sec.full, shift: sec.shift, drums: sec.drums ?? (sec.full ? [...DRUM_VOICES] : []), t });
      }
    }
    score.chords.push(chord);
    score.labels.push({ t, text: spec.name });
    score.finalKeyPc = song ? this.songTonic : this.walker.tonic;
    score.pitchRange = [Math.min(score.pitchRange[0], ...notes), Math.max(score.pitchRange[1], ...notes)];
    const jitter = 1 + uniform(this.timeRng, -T.holdJitter, T.holdJitter);
    if (this.durations || song) {
      // The bloom is a pickup: the beat grid starts when it lands.
      this.nextChange = (bloom ? score.gridStart : t) + slot;
    } else if (unison) {
      this.nextChange = t + span + Math.max(0.8, T.hold * 0.6);
    } else if (pluck) {
      // The glide happens before the next strike, so the whole hold is ring time.
      this.nextChange = t + Math.max(0.35 + T.glide * 0.5, T.hold * jitter);
    } else {
      this.nextChange = t + span + Math.max(0.35, T.hold * jitter - (crossfade ? T.swellIn : T.glide));
    }
    this.lastSettled = t + span;
    this.current = notes;
  }

  private addArrival() {
    const { cfg, score } = this;
    const T = cfg.timing;
    const tonic = this.song ? this.songTonic : this.walker.tonic;
    const endNote = cfg.endNote === 'start' ? score.startNote : resolveNote(cfg.endNote, tonic, 'high');
    const arrivalStart = score.chords.length ? this.nextChange : T.intro;
    for (let v = 0; v < cfg.voices; v++) {
      // Slight stagger at the start, but everyone lands together.
      const delay = this.staggerRng() * Math.min(T.stagger, T.arrival * 0.3) * 0.5;
      if (this.current[v] !== endNote) score.moves[v].push({ t0: arrivalStart + delay, d: T.arrival - delay, p0: this.current[v], p1: endNote });
    }
    const arrivalEnd = arrivalStart + T.arrival;
    const musicEnd = arrivalEnd + T.outro;
    // Loops always come home: if the arrival went up (or down), every voice
    // glides back to the starting unison after a short hold, then it wraps.
    let loopEnd = arrivalEnd + T.outro;
    if (cfg.loop && endNote !== score.startNote) {
      const back = arrivalEnd + Math.max(0.6, T.outro * 0.6);
      const d = Math.max(1, T.arrival * 1.3);
      for (let v = 0; v < cfg.voices; v++) score.moves[v].push({ t0: back, d, p0: endNote, p1: score.startNote });
      score.labels.push({ t: back, text: `↺ ${spellNote(score.startNote, tonic, this.walker.scale)}` });
      loopEnd = back + d + Math.min(0.6, T.intro);
    }
    if (this.melody) {
      // The melody joins the final unison.
      score.melody.push({ t: arrivalStart, d: musicEnd - arrivalStart, p: endNote, glide: T.arrival, from: this.melody.lastPitch });
    }
    if (this.song) {
      // Energy steps: full parts open the sub and the drums; soft parts and collapses close them; the arrival is soft.
      const steps: { t: number; e: number }[] = [];
      const push = (t: number, e: number) => {
        if (!steps.length || steps[steps.length - 1].e !== e) steps.push({ t, e });
      };
      const sections = this.song.sections;
      score.chords.forEach((c, i) => push(i === 0 ? 0 : c.t, c.unison || c.section === undefined ? 0 : sections[c.section].full ? 1 : 0));
      push(arrivalStart, 0);
      score.energy = steps;
    }
    const zoomStart = arrivalEnd + 0.4;
    const zoomEnd = zoomStart + T.zoom;
    score.endNote = endNote;
    score.labels.push({ t: arrivalStart, text: `→ ${spellNote(endNote, tonic, this.walker.scale)}` });
    score.pitchRange = [Math.min(score.pitchRange[0], endNote), Math.max(score.pitchRange[1], endNote)];
    for (const n of score.melody) {
      if (n.p === null) continue;
      score.pitchRange = [Math.min(score.pitchRange[0], n.p), Math.max(score.pitchRange[1], n.p)];
    }
    score.timeline = cfg.loop
      ? {
          // A loop: no zoom-out, no fade; it wraps straight back to the opening unison.
          introEnd: T.intro,
          arrivalStart,
          arrivalEnd,
          musicEnd: Number.POSITIVE_INFINITY,
          zoomStart: Number.POSITIVE_INFINITY,
          zoomEnd: Number.POSITIVE_INFINITY,
          end: loopEnd,
        }
      : {
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

/** A chord moved by d semitones, renamed in its new key. */
function transposeSpec(spec: ChordSpec, d: number): ChordSpec {
  const root = mod12(spec.root + d);
  const tonic = mod12(spec.tonic + d);
  return { ...spec, root, tonic, name: chordName({ root, intervals: spec.intervals }, tonic, spec.scale) };
}
