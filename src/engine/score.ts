import { resolveConfig, type ChordDriftConfig, type DeepPartial } from './config';
import { ProgressionWalker, type ChordSpec } from './progression';
import { MelodyGenerator, type MelodyNote } from './melody';
import { parseProgression, type ProgressionToken } from './progression-text';
import { chordDurations, parseRhythm, randomizeSteps, strikeOnsets } from './rhythm';
import { DRUM_VOICES, parseDrumRows, type DrumRows, type DrumVoice } from './drums';
import { formatSeed, parseSeed, randInt, stream, uniform, type Rng } from './rng';
import { DEGREE_OFFSETS, SCALES, mod12, parseNote, parsePc, pcName, scaleSteps, spellNote, spellPc, tonicName } from './theory';
import { STYLES, type StyleId } from './styles';
import { parseSongForm, type SongSection } from './song';
import { parseChop, type ChopPattern } from './chop';
import { chordName, romanName, stackChord, typicalSize } from './chords';
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
  private inversionRng: Rng;
  private current: number[];
  private nextChange: number;
  private total: number | null;
  /** Chord durations in seconds from the chord rhythm, or null for free timing. */
  private durations: number[] | null;
  private melody: MelodyGenerator | null = null;
  /** Song mode: the chord plan, the parts, and a generator per distinct part. */
  private song: {
    items: { kind: 'unison' | 'chord'; section: number; local: number; slot: number; fromEnd: number; dominant?: boolean }[];
    sections: SongSection[];
    parts: Map<string, { walker: ProgressionWalker; cadence: ProgressionWalker; specs: ChordSpec[]; bass: (number | undefined)[]; count: number; tonic: number }>;
    /** Per section: the ending it plays (written chords in its key), resolved lazily. */
    endings: ({ text: string; specs: ChordSpec[] | null } | null)[];
  } | null = null;
  private songTonic = 0;
  /** addChord calls so far (chords from the plan; passing chords are extra). */
  private step = 0;
  private passingRng: Rng;
  private climbRng: Rng;
  /** A written progression: play exactly its chords. */
  private written = false;
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
    const durs = chordDurations(randomizeSteps(chordRhythm.steps, stream(seed, 'chord-lengths')));
    this.durations = durs.length ? durs.map((b) => b * beat) : null;
    const melodyRhythm = parseRhythm(cfg.melody.rhythm);
    const gridStart = cfg.timing.intro + cfg.timing.bloom;
    const tokens: ProgressionToken[] = parsed.tokens;
    this.written = tokens.length > 0;
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
      const parts = new Map<string, { walker: ProgressionWalker; cadence: ProgressionWalker; specs: ChordSpec[]; bass: (number | undefined)[]; count: number; tonic: number }>();
      const items: { kind: 'unison' | 'chord'; section: number; local: number; slot: number; fromEnd: number; dominant?: boolean }[] = [];
      // Parts last whole bars. Chords change on the chord rhythm (once a bar without one),
      // restarting at each part; the last chord is cut to end on the part's last bar line.
      const rhythm = durs.length ? durs : [4];
      const bar = 4 * beat;
      // A collapse is a breath, not a section: a quick converge and a short hold, about 2–3 s,
      // rounded to whole bars (half bars at slow tempos; parts restart their patterns anyway).
      const unit = bar > 3.4 ? bar / 2 : bar;
      const collapseSlot = Math.max(1, Math.min(4, Math.round((Math.min(cfg.timing.arrival, 2) + 0.8) / unit))) * unit;
      songForm.sections.forEach((sec, i) => {
        const slots: number[] = [];
        let left = sec.bars * 4;
        // A release is one chord held for the whole part.
        if (sec.release) slots.push(left * beat), (left = 0);
        for (let r = 0; left > 1e-6 && slots.length < 512; r++) {
          const b = Math.min(rhythm[r % rhythm.length], left);
          slots.push(b * beat);
          left -= b;
        }
        const id = partId(sec);
        let part = parts.get(id);
        if (!part) {
          // Each distinct part (or scale/style variation of one) gets its own seeded generator, in its own key.
          const pcfg: ChordDriftConfig = sec.scale || sec.style ? { ...cfg, scale: sec.scale ?? cfg.scale, style: (sec.style as StyleId | null) ?? cfg.style } : cfg;
          const tonic = partTonic(sec, keyPc);
          const walker = new ProgressionWalker(pcfg, mod12(tonic), stream(seed, `progression:${id}`), tokens, stream(seed, `style:${id}`));
          let count = slots.length;
          // A styled part plays its planned phrases, then repeats them to fill its bars.
          if (pcfg.style !== 'none' && !tokens.length) count = Math.min(count, walker.planPiece(Math.max(1, Math.round(count / 4))));
          const cadence = new ProgressionWalker({ ...pcfg, style: 'none' }, mod12(tonic), stream(seed, `cadence:${id}`), []);
          part = { walker, cadence, specs: [], bass: [], count, tonic };
          parts.set(id, part);
        }
        if (sec.collapse) items.push({ kind: 'unison', section: i, local: 0, slot: collapseSlot, fromEnd: 0 });
        slots.forEach((slot, j) => items.push({ kind: 'chord', section: i, local: j, slot, fromEnd: slots.length - 1 - j }));
      });
      // A collapse lands on the next part's tonic, or now and then high on its dominant, so the
      // unison itself is the last tension before the part blooms home (always after a climb or a
      // release, which lead there). Its own stream, so nothing else about the song changes.
      const collapseRng = stream(seed, 'song-collapse');
      for (const it of items) {
        if (it.kind !== 'unison') continue;
        const before = songForm.sections[it.section - 1];
        it.dominant = collapseRng() < 0.3 || !!(before && (before.climb || before.release));
      }
      // Endings that make the joins mean something (free generation only; styles and written
      // progressions have their own cadences).
      const endingRng = stream(seed, 'song-endings');
      const endings = songForm.sections.map((sec, i) => {
        // Keep at least one generated chord in the part: only endings shorter than it are options.
        const len = items.filter((it) => it.section === i && it.kind === 'chord').length;
        const pickOne = (xs: string[]) => {
          const fit = xs.filter((x) => x.split(/\s+/).length < len);
          const roll = endingRng();
          return fit.length ? fit[Math.floor(roll * fit.length)] : '';
        };
        if (tokens.length || (sec.style ?? cfg.style) !== 'none' || sec.climb || sec.release) return null;
        const steps = scaleSteps(sec.scale ?? cfg.scale);
        const minor = steps.includes(3) && !steps.includes(4);
        const next = songForm.sections[i + 1];
        let text: string;
        if (!next) {
          // The close: a lift, a minor plagal, a climbing bass, a backdoor, or a plain cadence (minor may end on a Picardy major).
          text = minor ? pickOne(['bVI bVII i', 'iv V i', 'bII i', 'bVI bVII I', 'iv bVII i']) : pickOne(['bVI bVII I', 'IV iv I', 'IV V vi bVII I', 'iv bVII I', 'ii V I', 'IV bII I']);
        } else if (next.release && !next.collapse) {
          // Into a held sus dominant: a pre-dominant, so the release is the arrival on V.
          text = minor ? pickOne(['iv', 'bVI', 'ii']) : pickOne(['IV', 'ii', 'vi']);
        } else if (next.collapse) {
          // Leave tension hanging; the unison resolves it.
          text = minor ? pickOne(['bVI V', 'iv V', 'bII V', 'bVI bVII']) : pickOne(['IV V', 'bVI V', 'ii V', 'IV iv']);
        } else if (mod12(partTonic(next, keyPc)) !== mod12(partTonic(sec, keyPc))) {
          // Into a new key: its ii–V, so the next part lands on its tonic.
          const t = mod12(partTonic(next, keyPc));
          text = pickOne([`${pcName(mod12(t + 2), true)}m7 ${pcName(mod12(t + 7), true)}7`, `${pcName(mod12(t + 7), true)}7`]);
        } else text = minor ? pickOne(['V', 'bVI V', 'bVII']) : pickOne(['V', 'IV V', 'ii V']);
        return text ? { text, specs: null } : null;
      });
      this.song = { items, sections: songForm.sections, parts, endings };
      this.total = items.length;
      this.songTonic = keyPc;
    }
    this.voicingRng = stream(seed, 'voicing');
    this.timeRng = stream(seed, 'timing');
    this.staggerRng = stream(seed, 'stagger');
    this.inversionRng = stream(seed, 'inversion');
    this.passingRng = stream(seed, 'passing');
    this.climbRng = stream(seed, 'song-climb');
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
    const written = cfg.melody.enabled ? parseWrittenMelody(cfg.melody.notes, gridStart, beat) : [];
    if (written.length) {
      // A written melody (a MIDI import's tune) plays exactly as written.
      this.score.melody = written;
    } else if (cfg.melody.enabled) {
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
      nextChangeAfter: (t: number) => {
        const i = this.chordIndexAt(t);
        const next = chords[i + 1];
        if (next) return next.t;
        // The last chord known so far: its change is the next one the builder will add.
        return this.total !== null && chords.length >= this.total ? this.nextChange : Math.max(this.nextChange, t + 0.5);
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
    // Position in the plan (song items, style plans, written tokens): passing chords don't count.
    const k = this.step++;
    const song = this.song;
    const item = song ? song.items[k] : null;
    const unison = item?.kind === 'unison';
    // After a collapse the next part blooms out of the unison, like the opening.
    const reBloom = k > 0 && song?.items[k - 1]?.kind === 'unison';
    const ref = k === 0 ? spreadTemplate(V, score.startNote, rules) : reBloom ? spreadTemplate(V, this.current[0], rules) : this.current;
    const cost = (c: { root: number; intervals: number[] }) => {
      const v = voiceChord(c, ref, rules, null);
      // A change where nothing (or a single voice) moves reads as a repeat; nudge away from those,
      // but let two- and three-voice changes through: common tones are what makes them smooth.
      const moved = v.reduce((n, x, i) => n + (x !== ref[i] ? 1 : 0), 0);
      return voiceLeadingCost(ref, v, rules) + (moved === 0 ? 6 : moved === 1 ? 3 : 0);
    };
    let spec: ChordSpec;
    let notes: number[];
    /** Climb and release parts choose their own bass; random inversions leave them alone. */
    let fixedBass: number | undefined;
    let fixed = false;
    if (song && item && unison) {
      // Collapse: every voice converges on the next part's tonic, near where the voices are now.
      const next = song.sections[item.section];
      const tonic = mod12(partTonic(next, score.keyPc));
      const pc = item.dominant ? mod12(tonic + 7) : tonic;
      const sorted = [...this.current].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      let u = median - mod12(median - pc);
      if (median - u > 6) u += 12;
      // On the dominant it rises an octave: a high held note waiting to come home.
      if (item.dominant && u + 12 <= cfg.range.upper[1]) u += 12;
      u = Math.max(cfg.range.bass[0], Math.min(cfg.range.upper[1], u));
      const scale = next.scale ?? this.walker.scale;
      spec = { root: pc, intervals: [0], tonic, scale, name: `unison ${spellNote(u, tonic, scale)}`, roman: item.dominant ? 'V' : '—', origin: 'cadence' };
      notes = new Array<number>(V).fill(u);
    } else if (song && item) {
      const sec = song.sections[item.section];
      const part = song.parts.get(partId(sec))!;
      let base: ChordSpec;
      const ending = song.endings[item.section];
      const endLen = ending ? ending.text.split(/\s+/).length : 0;
      if (sec.climb || sec.release) {
        const idx = item.local;
        if (!part.specs[idx]) {
          const steps = scaleSteps(part.walker.scale);
          const size = typicalSize(Math.max(1, Math.min(5, cfg.complexity)));
          const make = (c: { root: number; intervals: number[] }, origin: ChordSpec['origin']): ChordSpec => ({
            ...c,
            tonic: part.tonic,
            scale: part.walker.scale,
            name: chordName(c, part.tonic, part.walker.scale),
            roman: romanName(c, part.tonic),
            origin,
          });
          if (sec.release) {
            // The long suspended dominant: V7sus4, with the 9th once chords get colourful.
            part.specs[idx] = make({ root: mod12(part.tonic + 7), intervals: size >= 5 ? [0, 5, 7, 10, 14] : [0, 5, 7, 10] }, 'cadence');
          } else {
            // Climb: the bass walks up from the tonic to the dominant (1 2 3 4 5, with a chromatic ♯4
            // when there's room: Horizon's A → A♯ → B), spread over the part's chords. Each step is
            // harmonised by a chord with it as root, 3rd or 5th (I, I/3 → ii, IV/4…); the first is
            // the tonic and the last the dominant itself, which the next part (or unison) answers.
            const c = item.local + item.fromEnd + 1;
            const five = steps.findIndex((x) => x === 7);
            const top = five > 0 ? five : Math.min(4, steps.length - 1);
            const path: (number | 'sharp4')[] = [];
            for (let i = 0; i <= top; i++) path.push(i);
            if (c > path.length && top > 0 && steps[top] - steps[top - 1] === 2) path.splice(top, 0, 'sharp4');
            const at = c <= 1 ? 0 : Math.round((idx * (path.length - 1)) / (c - 1));
            const step = path[Math.min(path.length - 1, at)];
            const roll = this.climbRng();
            if (step === 'sharp4') {
              const bass = mod12(part.tonic + steps[top] - 1);
              part.specs[idx] = make({ root: bass, intervals: [0, 3, 6, 9] }, 'passing');
              part.bass[idx] = bass;
            } else {
              let over = step === 0 || step === top ? 0 : roll < 0.45 ? 0 : roll < 0.85 ? 2 : 4;
              const prevSpec = part.specs[idx - 1];
              const same = (o: number) => {
                const ch = stackChord(part.tonic, part.walker.scale, step - o, size);
                return !!prevSpec && prevSpec.root === ch.root && prevSpec.intervals.join() === ch.intervals.join();
              };
              // Two chords on one bass step: the second re-harmonises it rather than repeating.
              if (same(over)) over = [0, 2, 4].find((o) => !same(o)) ?? over;
              part.specs[idx] = make(stackChord(part.tonic, part.walker.scale, step - over, size), 'scale');
              part.bass[idx] = mod12(part.tonic + steps[step]);
            }
          }
        }
        base = part.specs[idx];
        fixedBass = part.bass[idx];
        if (fixedBass !== undefined) fixedBass = mod12(fixedBass + partTonic(sec, score.keyPc) - part.tonic);
      } else if (item.local === 0 && k > 0 && (song.items[k - 1].dominant || song.sections[song.items[k - 1].section].release)) {
        // Home: after a unison on the dominant or a held sus dominant, the part opens on its tonic.
        const size = typicalSize(Math.max(1, Math.min(5, cfg.complexity)));
        const c = stackChord(part.tonic, part.walker.scale, 0, size);
        base = { ...c, tonic: part.tonic, scale: part.walker.scale, name: chordName(c, part.tonic, part.walker.scale), roman: romanName(c, part.tonic), origin: 'cadence' };
      } else if (ending && item.fromEnd < endLen) {
        // The part's ending for this join, in the part's own key (then transposed like the rest).
        ending.specs ??= part.cadence.resolveText(ending.text);
        base = ending.specs[endLen - 1 - item.fromEnd];
      } else {
        // Chords are kept by slot, so a repeat lines up with the first time even when endings
        // took different slots; a slot never played yet is generated now.
        const idx = item.local % part.count;
        if (!part.specs[idx]) {
          // A part that follows straight on in the same key needn't open on the tonic; after a
          // collapse or a key change it does, so the ending before it resolves.
          const prev = song.sections[item.section - 1];
          const sameKeyFlow = prev && !sec.collapse && mod12(partTonic(prev, score.keyPc)) === mod12(partTonic(sec, score.keyPc));
          const off = sameKeyFlow && !part.walker.planned ? 1 : 0;
          part.specs[idx] = part.walker.next(idx + off, part.count + off, cost);
        }
        base = part.specs[idx];
      }
      const d = partTonic(sec, score.keyPc) - part.tonic;
      spec = d ? transposeSpec(base, d) : base;
      // A climb is voiced from the lowest tonic upwards (it may rise past the bass range's top).
      const lowTonic = cfg.range.bass[0] + mod12(spec.tonic - cfg.range.bass[0]);
      const vr = sec.climb ? { ...rules, bass: [lowTonic, lowTonic + 8] as [number, number] } : rules;
      notes = voiceChord(spec, ref, vr, this.voicingRng, fixedBass);
      if (fixedBass !== undefined && fixedBass !== mod12(spec.root)) spec = { ...spec, name: `${spec.name}/${spellPc(fixedBass, spec.tonic, spec.scale)}` };
      if (sec.climb || sec.release) fixed = true;
      this.songTonic = spec.tonic;
    } else {
      spec = this.walker.next(k, this.total, cost);
      notes = voiceChord(spec, ref, rules, this.voicingRng);
    }
    // A written slash bass ("Em7/D"): that note in the bass (and no random inversion on top).
    if (!unison && spec.bass !== undefined && fixedBass === undefined) {
      notes = voiceChord(spec, ref, rules, this.voicingRng, spec.bass);
      if (mod12(spec.bass) !== mod12(spec.root)) spec = { ...spec, name: `${spec.name}/${spellPc(spec.bass, spec.tonic, spec.scale)}` };
      fixed = true;
    }
    // Inversion: now and then a chord puts its 3rd, 5th (or 7th) in the bass instead of its root
    // (C/E, C/G), voiced from the current chord like any other change. It draws on its own random
    // stream, so the setting changes nothing else about the piece.
    if (!unison && k > 0) {
      const roll = this.inversionRng();
      const pick = this.inversionRng();
      if (roll < cfg.voicing.inversion && !fixed) {
        const has = (i: number[]) => spec.intervals.map(mod12).find((x) => i.includes(x));
        const options: [number, number][] = [];
        const third = has([3, 4]);
        const fifth = has([7, 6, 8]);
        const seventh = has([10, 11]);
        if (third !== undefined) options.push([third, 3]);
        if (fifth !== undefined) options.push([fifth, 2]);
        if (seventh !== undefined) options.push([seventh, 1]);
        if (options.length) {
          const total = options.reduce((acc, [, w]) => acc + w, 0);
          let x = pick * total;
          const iv = options.find(([, w]) => (x -= w) < 0)?.[0] ?? options[0][0];
          const bassPc = mod12(spec.root + iv);
          notes = voiceChord(spec, ref, rules, this.inversionRng, bassPc);
          spec = { ...spec, name: `${spec.name}/${spellPc(bassPc, spec.tonic, spec.scale)}` };
        }
      }
    }

    const pluckGrid = cfg.motion.transition === 'pluck' && score.strikes && !this.durations && !song && k > 0;
    // Plucked over a strike pattern with free timing, a change waits for the next strike, so it
    // lands on the pulse instead of cutting into a ringing note.
    const t = pluckGrid ? this.nextStrikeAt(this.nextChange) : this.nextChange;

    // Passing chord: when the bass is about to move a whole step, slip the chord on the half step
    // between into the second half of the current one (A → A♯dim7 → B; G♯m → G7 → F♯m).
    const before = score.chords[score.chords.length - 1];
    // (Not in written progressions: those chords are exactly what was asked for.)
    if (!unison && !reBloom && k > 1 && before && !before.unison && !this.written) {
      const roll = this.passingRng();
      const step = mod12(spec.root - before.root);
      if (roll < cfg.passing && (step === 2 || step === 10)) {
        const gap = t - before.t;
        const half = this.durations || song ? Math.floor(gap / score.beat / 2 + 1e-6) * score.beat : gap * 0.5;
        const at = t - half;
        if (half >= Math.min(score.beat, 1.0) - 1e-6 && at - before.t >= half - 1e-6) {
          const up = step === 2;
          const pass: ChordSpec = {
            root: mod12(before.root + (up ? 1 : -1)),
            intervals: up ? [0, 3, 6, 9] : [0, 4, 7, 10],
            tonic: before.tonic,
            scale: before.scale,
            name: '',
            roman: '',
            origin: 'passing',
          };
          pass.name = chordName(pass, pass.tonic, pass.scale);
          pass.roman = romanName(pass, pass.tonic);
          const pnotes = voiceChord(pass, this.current, rules, null);
          let pspan = 0;
          // (Release & swell in crossfades chords instead of gliding them; see layerAt.)
          const glide = cfg.motion.transition !== 'swell';
          for (let v = 0; v < V && glide; v++) {
            if (pnotes[v] === this.current[v]) continue;
            // A voice joins once its own previous glide has finished (moves must not overlap).
            const last = score.moves[v][score.moves[v].length - 1];
            const start = Math.max(at, last ? last.t0 + last.d : 0);
            const d = Math.max(0.05, Math.min(T.glide * 0.6, half * 0.5, t - start - 0.05));
            if (t - start < 0.15) {
              pnotes[v] = this.current[v]; // no room: this voice holds through the passing chord
              continue;
            }
            score.moves[v].push({ t0: start, d, p0: this.current[v], p1: pnotes[v] });
            pspan = Math.max(pspan, start + d - at);
          }
          score.chords.push({ ...pass, index: score.chords.length, notes: pnotes, t: at, settled: at + pspan, section: before.section });
          score.labels.push({ t: at, text: pass.name });
          this.current = pnotes;
          // The next chord now leads on from the passing chord.
          notes = voiceChord(spec, pnotes, rules, this.voicingRng);
        }
      }
    }
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
    // Plucked chords change like a strum: every voice jumps to its new note right on
    // the strike, so the attack hits the new chord (on the beat, with a rhythm).
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
        // Strummed: every voice jumps to its new note right on the strike, no slide.
        const d = 0.003;
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
    const chord: ScoreChord = { ...spec, index: score.chords.length, notes, t, settled: t + span };
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
    this.current = notes;
  }

  /** The first strike of the pluck pattern at or after time t. */
  private nextStrikeAt(t: number): number {
    const { score } = this;
    const pat = score.strikes!;
    const pos = Math.max(0, (t - score.gridStart) / score.beat);
    for (let loop = Math.floor(pos / pat.length); loop < Math.floor(pos / pat.length) + 3; loop++) {
      for (const o of pat.onsets) {
        const at = score.gridStart + (loop * pat.length + o) * score.beat;
        if (at >= t - 1e-9) return at;
      }
    }
    return t;
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
    if (!this.melody && score.melody.length) {
      // A written melody stops where the progression does (the arrival is the chords' own ending).
      score.melody = score.melody.filter((n) => n.t < arrivalStart);
      for (const n of score.melody) n.d = Math.min(n.d, arrivalStart - n.t);
    }
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
  return { ...spec, root, tonic, name: chordName({ root, intervals: spec.intervals }, tonic, spec.scale), ...(spec.bass !== undefined ? { bass: mod12(spec.bass + d) } : {}) };
}

/** A part's identity: its name, plus scale/style when it changes them (a variation gets its own chords). */
function partId(sec: SongSection): string {
  const kind = sec.climb ? ',climb' : sec.release ? ',release' : '';
  return sec.scale || sec.style || kind ? `${sec.name}{${sec.scale ?? ''},${sec.style ?? ''}${kind}}` : sec.name;
}

/** A part's tonic as a pitch number (not reduced mod 12): its own key or the piece's, plus its shift. */
function partTonic(sec: SongSection, keyPc: number): number {
  return (sec.key ? parsePc(sec.key) ?? keyPc : keyPc) + sec.shift;
}

/** A written melody ("pitch:start:length" in beats from the first chord) as melody notes. */
export function parseWrittenMelody(text: string, gridStart: number, beat: number): MelodyNote[] {
  const out: MelodyNote[] = [];
  for (const tok of text.trim().split(/\s+/)) {
    const m = /^(\d{1,3}):(-?[\d.]+):([\d.]+)$/.exec(tok);
    if (!m) continue;
    const p = Number(m[1]);
    const start = Number(m[2]);
    const len = Number(m[3]);
    if (!(p >= 0 && p <= 127) || !(len > 0) || start < 0) continue;
    out.push({ t: gridStart + start * beat, d: len * beat, p });
  }
  out.sort((x, y) => x.t - y.t);
  // Overlaps (two notes at once) keep the later one: the melody is one line.
  for (let i = 0; i + 1 < out.length; i++) if (out[i].t + out[i].d > out[i + 1].t) out[i].d = Math.max(0.01, out[i + 1].t - out[i].t);
  return out;
}

