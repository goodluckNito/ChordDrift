/**
 * Standard MIDI File export and import.
 *
 * Export writes what the piece plays: the chords (one block chord per change,
 * re-struck on every pluck strike), the melody and the drums (General MIDI,
 * channel 10), with the tempo, chord names as markers and the bloom as a
 * pickup so the beat grid lines up with the bars.
 *
 * Import reads any .mid, hears a chord on every beat (duration-weighted pitch
 * classes, with the bass weighted up), merges repeats, and turns the result
 * into a written progression with a matching chord rhythm, tempo and key.
 * Drums on channel 10 become step patterns.
 */
import { chordSuffix } from './chords';
import type { ChordDriftConfig, DeepPartial } from './config';
import type { DrumVoice } from './drums';
import { drumHits, strikeTimesBetween } from './motion';
import { parseProgression } from './progression-text';
import type { Score } from './score';
import { KEY_NAMES, mod12, pcName, prefersFlats } from './theory';

export const PPQ = 480;

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

interface Ev {
  tick: number;
  /** Sort order at equal ticks: offs before metas before ons. */
  order: number;
  bytes: number[];
}

function vlq(n: number): number[] {
  n = Math.max(0, Math.round(n));
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0) & 0x7f);
const meta = (type: number, data: number[]) => [0xff, type, ...vlq(data.length), ...data];

function trackChunk(events: Ev[], name: string): number[] {
  const evs = [{ tick: 0, order: 0, bytes: meta(0x03, ascii(name)) }, ...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const e of evs) {
    body.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  return [...ascii('MTrk'), ...u32(body.length), ...body];
}

function note(events: Ev[], ch: number, pitch: number, vel: number, on: number, off: number) {
  if (off <= on || pitch < 0 || pitch > 127) return;
  const v = Math.max(1, Math.min(127, Math.round(vel)));
  events.push({ tick: on, order: 2, bytes: [0x90 | ch, pitch, v] });
  events.push({ tick: off, order: 0, bytes: [0x80 | ch, pitch, 0] });
}

const GM: Record<DrumVoice, number> = { kick: 36, snare: 38, hat: 42, crash: 49, ride: 51 };
const GM_OPEN_HAT = 46;

export interface MidiExport {
  bytes: Uint8Array;
  /** Seconds of the piece covered. */
  duration: number;
  chords: number;
}

/**
 * Write the score as a format-1 MIDI file. Endless pieces are written up to
 * `until` seconds (default: the first 32 chords).
 */
export function writeMidi(score: Score, until?: number): MidiExport {
  if (score.endless) {
    if (until === undefined) {
      let guard = 0;
      while (score.chords.length < 33 && guard++ < 200) score.extend((score.chords.at(-1)?.t ?? 0) + 30);
      until = score.chords[32]?.t ?? score.chords.at(-1)!.t + 8;
    } else score.extend(until);
  }
  const tl = score.timeline;
  const beat = score.beat;
  const pickup = Math.max(0, Math.ceil(score.gridStart / beat / 4 - 1e-6) * 4);
  const tick = (t: number) => Math.max(0, Math.round(((t - score.gridStart) / beat + pickup) * PPQ));
  const stop = score.endless ? (until as number) : score.loop ? tl.end : Math.min(tl.musicEnd, tl.end);

  // Conductor track: tempo, metre, chord names.
  const conductor: Ev[] = [
    { tick: 0, order: 1, bytes: meta(0x51, [(Math.round(beat * 1e6) >> 16) & 255, (Math.round(beat * 1e6) >> 8) & 255, Math.round(beat * 1e6) & 255]) },
    { tick: 0, order: 1, bytes: meta(0x58, [4, 2, 24, 8]) },
  ];
  for (const l of score.labels) if (l.t < stop) conductor.push({ tick: tick(Math.max(l.t, 0)), order: 1, bytes: meta(0x06, ascii(l.text)) });

  // Chords: the opening unison through the bloom, each chord until the next change, then the arrival.
  const chordEv: Ev[] = [];
  const chords = score.chords.filter((c) => c.t < stop);
  const arrival = score.endless ? stop : Math.min(stop, tl.arrivalStart);
  note(chordEv, 0, score.startNote, 70, tick(tl.introEnd), tick(score.gridStart));
  chords.forEach((c, i) => {
    const a = i === 0 ? score.gridStart : c.t;
    const b = i + 1 < chords.length ? chords[i + 1].t : arrival;
    const strikes = strikeTimesBetween(score, a, b - 1e-6).filter((s) => s > a + 1e-6);
    const hits = [a, ...strikes, b];
    const pitches = [...new Set(c.notes)];
    for (let h = 0; h + 1 < hits.length; h++) {
      for (const p of pitches) note(chordEv, 0, p, h === 0 ? 92 : 76, tick(hits[h]), tick(hits[h + 1]));
    }
  });
  if (!score.endless) {
    const back = score.loop ? score.moves.flat().filter((m) => m.t0 > tl.arrivalEnd).reduce((x, m) => Math.min(x, m.t0), Infinity) : Infinity;
    note(chordEv, 0, score.endNote, 80, tick(tl.arrivalStart), tick(Math.min(stop, back)));
    if (Number.isFinite(back) && score.endNote !== score.startNote) note(chordEv, 0, score.startNote, 70, tick(back), tick(stop));
  }

  // Melody.
  const melodyEv: Ev[] = [];
  for (const n of score.melody) {
    if (n.p === null || n.t >= stop) continue;
    note(melodyEv, 1, n.p, 96, tick(n.t), tick(Math.min(stop, n.t + n.d)));
  }

  // Drums (GM, channel 10).
  const drumEv: Ev[] = [];
  for (const h of drumHits(score, 0, stop)) {
    const p = h.voice === 'hat' && h.open ? GM_OPEN_HAT : GM[h.voice];
    const len = h.voice === 'crash' || h.voice === 'ride' ? beat : beat / 4;
    note(drumEv, 9, p, 30 + h.vel * 97, tick(h.t), tick(h.t) + Math.max(1, Math.round((len / beat) * PPQ * 0.9)));
  }

  const tracks = [trackChunk(conductor, score.config.title || 'Chord Drift'), trackChunk(chordEv, 'Chords')];
  if (melodyEv.length) tracks.push(trackChunk(melodyEv, 'Melody'));
  if (drumEv.length) tracks.push(trackChunk(drumEv, 'Drums'));
  const header = [...ascii('MThd'), ...u32(6), 0, 1, 0, tracks.length, (PPQ >> 8) & 255, PPQ & 255];
  const bytes = new Uint8Array([...header, ...tracks.flat()]);
  return { bytes, duration: stop, chords: chords.length };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface MidiNote {
  /** Start and length in beats (quarter notes). */
  start: number;
  length: number;
  pitch: number;
  vel: number;
  channel: number;
}

export interface MidiFile {
  notes: MidiNote[];
  /** Beats per minute of the first tempo event (120 if none). */
  tempo: number;
  name: string;
}

export function readMidi(data: ArrayBuffer | Uint8Array): MidiFile {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  let pos = 0;
  const str = (n: number) => String.fromCharCode(...b.subarray(pos, (pos += n)));
  const u = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + b[pos++];
    return v;
  };
  const readVlq = () => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const c = b[pos++];
      v = v * 128 + (c & 0x7f);
      if (!(c & 0x80)) break;
    }
    return v;
  };
  // RIFF-wrapped MIDI (.rmi)
  if (str(4) === 'RIFF') {
    const at = indexOf(b, 'MThd');
    if (at < 0) throw new Error('not a MIDI file');
    pos = at;
  } else pos = 0;
  if (str(4) !== 'MThd') throw new Error('not a MIDI file');
  const hlen = u(4);
  const hstart = pos;
  u(2); // format
  const ntrks = u(2);
  const division = u(2);
  pos = hstart + hlen;
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported');
  const ppq = division || 480;

  const notes: MidiNote[] = [];
  let tempo = 0;
  let name = '';
  for (let tr = 0; tr < ntrks && pos + 8 <= b.length; tr++) {
    const id = str(4);
    const len = u(4);
    const end = Math.min(b.length, pos + len);
    if (id !== 'MTrk') {
      pos = end;
      continue;
    }
    let tick = 0;
    let status = 0;
    const open = new Map<number, { tick: number; vel: number }[]>();
    const close = (ch: number, p: number, at: number) => {
      const stack = open.get(ch * 128 + p);
      const on = stack?.shift();
      if (on && at > on.tick) notes.push({ start: on.tick / ppq, length: (at - on.tick) / ppq, pitch: p, vel: on.vel, channel: ch });
    };
    while (pos < end) {
      tick += readVlq();
      let s = b[pos];
      if (s & 0x80) pos++;
      else s = status;
      if (s === 0xff) {
        const type = b[pos++];
        const l = readVlq();
        if (type === 0x51 && l === 3 && !tempo) tempo = 60e6 / ((b[pos] << 16) | (b[pos + 1] << 8) | b[pos + 2]);
        if (type === 0x03 && !name && tr === 0) name = String.fromCharCode(...b.subarray(pos, pos + l)).trim();
        pos += l;
        if (type === 0x2f) break;
        continue;
      }
      if (s === 0xf0 || s === 0xf7) {
        pos += readVlq();
        continue;
      }
      status = s;
      const kind = s & 0xf0;
      const ch = s & 0x0f;
      const d1 = b[pos++];
      const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : b[pos++];
      if (kind === 0x90 && d2 > 0) {
        const k = ch * 128 + d1;
        if (!open.has(k)) open.set(k, []);
        open.get(k)!.push({ tick, vel: d2 });
      } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) close(ch, d1, tick);
    }
    // Notes left hanging end at the end of the track.
    for (const [k, stack] of open) for (const on of stack) if (tick > on.tick) notes.push({ start: on.tick / ppq, length: (tick - on.tick) / ppq, pitch: k % 128, vel: on.vel, channel: Math.floor(k / 128) });
    pos = end;
  }
  notes.sort((x, y) => x.start - y.start || x.pitch - y.pitch);
  return { notes, tempo: Math.round(tempo || 120), name };
}

function indexOf(b: Uint8Array, s: string): number {
  outer: for (let i = 0; i + s.length <= b.length; i++) {
    for (let j = 0; j < s.length; j++) if (b[i + j] !== s.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Hearing chords
// ---------------------------------------------------------------------------

// Krumhansl–Kessler key profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function detectKey(weights: number[]): { tonic: number; scale: 'major' | 'minor' } {
  let best = { tonic: 0, scale: 'major' as 'major' | 'minor', r: -Infinity };
  const corr = (prof: number[], k: number) => {
    const xs = weights;
    const ys = xs.map((_, i) => prof[mod12(i - k)]);
    const mx = xs.reduce((a, c) => a + c, 0) / 12;
    const my = ys.reduce((a, c) => a + c, 0) / 12;
    let n = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < 12; i++) {
      n += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    return n / Math.sqrt(dx * dy || 1);
  };
  for (let k = 0; k < 12; k++) {
    for (const [scale, prof] of [['major', MAJOR], ['minor', MINOR]] as const) {
      const r = corr(prof, k);
      if (r > best.r) best = { tonic: k, scale, r };
    }
  }
  return { tonic: best.tonic, scale: best.scale };
}

/** Name the chord a set of weighted pitch classes makes (root chosen by bass, fifths and thirds). */
export function nameChord(weights: number[], bass: number | null, flats: boolean): { root: number; name: string } | null {
  const max = Math.max(...weights);
  if (max <= 0) return null;
  let pcs = weights.map((w, pc) => (w >= max * 0.2 ? pc : -1)).filter((pc) => pc >= 0);
  // Keep at most 6 pitch classes: the strongest.
  pcs = pcs.sort((a, b) => weights[b] - weights[a]).slice(0, 6);
  const has = (r: number, i: number) => pcs.includes(mod12(r + i));
  let best: { root: number; name: string; score: number } | null = null;
  for (const r of pcs) {
    let set = [...pcs];
    let name = '';
    // Drop the weakest tensions until the name is one the progression parser reads back.
    for (;;) {
      name = pcName(r, flats) + chordSuffix(set.map((p) => mod12(p - r)));
      if (!parseProgression(name).errors.length) break;
      const drop = set.filter((p) => p !== r && ![3, 4, 7].includes(mod12(p - r))).sort((a, b) => weights[a] - weights[b])[0];
      if (drop === undefined) {
        name = pcName(r, flats) + (has(r, 3) && !has(r, 4) ? 'm' : '');
        break;
      }
      set = set.filter((p) => p !== drop);
    }
    const score =
      (r === bass ? 3 : 0) +
      (has(r, 7) ? 2 : 0) +
      (has(r, 4) || has(r, 3) ? 1.5 : 0) +
      (has(r, 10) || has(r, 11) ? 0.4 : 0) +
      (0.6 * weights[r]) / max -
      (name.includes('(') ? 1 : 0) -
      Math.max(0, name.length - 5) * 0.15;
    if (!best || score > best.score) best = { root: r, name, score };
  }
  return best && { root: best.root, name: best.name };
}

/** Beats → rhythm notation with ties ("w+h", "q.", …), to a 16th. */
export function beatsToNotation(beats: number): string {
  let left = Math.max(0.25, Math.round(beats * 4) / 4);
  const parts: string[] = [];
  const atoms: [number, string][] = [[4, 'w'], [3, 'h.'], [2, 'h'], [1.5, 'q.'], [1, 'q'], [0.75, 'e.'], [0.5, 'e'], [0.25, 's']];
  while (left > 1e-6 && parts.length < 64) {
    const a = atoms.find(([b]) => b <= left + 1e-6)!;
    parts.push(a[1]);
    left -= a[0];
  }
  return parts.join('+');
}

const DRUM_MAP: Record<number, DrumVoice> = {
  35: 'kick', 36: 'kick',
  37: 'snare', 38: 'snare', 39: 'snare', 40: 'snare',
  42: 'hat', 44: 'hat', 46: 'hat',
  49: 'crash', 52: 'crash', 55: 'crash', 57: 'crash',
  51: 'ride', 53: 'ride', 59: 'ride',
};

export interface MidiImport {
  patch: DeepPartial<ChordDriftConfig>;
  chords: string[];
  key: string;
  tempo: number;
  drums: boolean;
}

/** Turn a MIDI file into a progression, chord rhythm, tempo, key and (optionally) drum patterns. */
export function midiToConfig(file: MidiFile, maxChords = 64): MidiImport {
  const pitched = file.notes.filter((n) => n.channel !== 9);
  if (!pitched.length) throw new Error('no notes outside the drum channel');
  const total = new Array(12).fill(0);
  for (const n of pitched) total[mod12(n.pitch)] += n.length;
  const key = detectKey(total);
  const flats = prefersFlats(key.tonic, key.scale);

  const base = Math.floor(pitched[0].start + 1e-6);
  const last = Math.max(...pitched.map((n) => n.start + n.length));
  const cells = Math.min(4096, Math.ceil(last - base - 1e-6));
  // One chord guess per beat. A lone pitch class (a unison or a bass note) is not a chord.
  const guesses: ({ name: string; root: number } | null)[] = [];
  for (let c = 0; c < cells; c++) {
    const a = base + c;
    const w = new Array(12).fill(0);
    let bass: { p: number; o: number } | null = null;
    for (const n of pitched) {
      const o = Math.min(a + 1, n.start + n.length) - Math.max(a, n.start);
      if (o <= 0.05) continue;
      w[mod12(n.pitch)] += o;
      if (!bass || n.pitch < bass.p) bass = { p: n.pitch, o };
    }
    const distinct = w.filter((x) => x > 0.05).length;
    if (bass) w[mod12(bass.p)] += bass.o * 0.5;
    guesses.push(distinct < 2 ? null : nameChord(w, bass ? mod12(bass.p) : null, flats));
  }
  const first = guesses.findIndex((g) => g !== null);
  if (first < 0) throw new Error('no chords found (only single notes)');
  const origin = base + first;
  // Merge repeats; empty beats extend the chord before them.
  const segs: { name: string; root: number; beats: number }[] = [];
  // Beats after the last chord (a closing unison, a fade) don't stretch it.
  let lastChord = guesses.length - 1;
  while (guesses[lastChord] === null) lastChord--;
  for (const g of guesses.slice(first, lastChord + 1)) {
    if (segs.length && (g === null || segs[segs.length - 1].name === g.name)) {
      segs[segs.length - 1].beats += 1;
      continue;
    }
    if (g) segs.push({ ...g, beats: 1 });
  }
  // A one-beat chord on the same root as a neighbour is a colour change or a smeared change: fold it in.
  for (let i = segs.length - 1; i >= 0 && segs.length > 1; i--) {
    if (segs[i].beats !== 1) continue;
    const prev = segs[i - 1];
    const next = segs[i + 1];
    if (prev && prev.root === segs[i].root) {
      prev.beats += 1;
      segs.splice(i, 1);
    } else if (next && next.root === segs[i].root) {
      next.beats += 1;
      segs.splice(i, 1);
    }
  }
  // Lone single-beat chords between two of the same chord are passing notes.
  for (let i = segs.length - 2; i > 0; i--) {
    if (segs[i].beats === 1 && segs[i - 1].name === segs[i + 1].name) {
      segs[i - 1].beats += 1 + segs[i + 1].beats;
      segs.splice(i, 2);
    }
  }
  // Merging can leave neighbours equal again.
  for (let i = segs.length - 1; i > 0; i--) {
    if (segs[i].name === segs[i - 1].name) {
      segs[i - 1].beats += segs[i].beats;
      segs.splice(i, 1);
    }
  }
  const used = segs.slice(0, maxChords);
  const chords = used.map((s) => s.name);

  const keyName = KEY_NAMES[key.tonic];
  const patch: DeepPartial<ChordDriftConfig> = {
    key: keyName,
    scale: key.scale,
    progression: chords.join(' '),
    endless: false,
    rhythm: { tempo: Math.max(30, Math.min(300, file.tempo)), chords: used.map((s) => beatsToNotation(s.beats)).join(' ') },
  };

  // Drums: 16th-note steps from where the chords start; each row repeats every 1, 2 or 4 bars.
  const drums = file.notes.filter((n) => n.channel === 9 && DRUM_MAP[n.pitch]);
  if (drums.length) {
    const rows = {} as Record<DrumVoice, string>;
    for (const voice of ['kick', 'snare', 'hat', 'crash', 'ride'] as DrumVoice[]) {
      const steps = new Array(64).fill('.');
      for (const n of drums) {
        if (DRUM_MAP[n.pitch] !== voice) continue;
        const i = Math.round((n.start - origin) * 4);
        if (i < 0 || i >= 64) continue;
        const open = n.pitch === 46;
        steps[i] = open ? (n.vel >= 110 ? 'O' : 'o') : n.vel >= 110 ? 'X' : 'x';
      }
      const s = steps.join('');
      if (!/[xXoO]/.test(s)) {
        rows[voice] = '';
        continue;
      }
      const period = [16, 32].find((p) => s === s.slice(0, p).repeat(64 / p)) ?? 64;
      rows[voice] = s.slice(0, period);
    }
    patch.drums = { enabled: true, ...rows };
  }
  return { patch, chords, key: `${keyName} ${key.scale}`, tempo: patch.rhythm!.tempo as number, drums: drums.length > 0 };
}
