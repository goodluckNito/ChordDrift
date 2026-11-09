/** Pitch helpers and the chord vocabulary. Everything works in MIDI note numbers. */

export const midiToHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
export const hzToMidi = (f: number) => 69 + 12 * Math.log2(f / 440);
export const mod12 = (n: number) => ((n % 12) + 12) % 12;

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Conventional key names (major keys). */
export const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLAT_KEYS = new Set([1, 3, 5, 8, 10]);

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

export function scalePcs(keyPc: number): Set<number> {
  return new Set(MAJOR_SCALE.map((i) => mod12(keyPc + i)));
}

/**
 * Spell a pitch class in the context of a key: diatonic notes follow the key
 * signature; borrowed notes use flats for the "minor side" degrees (b3, b6, b7, b2)
 * and sharps otherwise (#4).
 */
export function pcName(pc: number, keyPc = 0): string {
  const p = mod12(pc);
  const rel = mod12(p - keyPc);
  if (MAJOR_SCALE.includes(rel)) return FLAT_KEYS.has(mod12(keyPc)) ? FLAT_NAMES[p] : SHARP_NAMES[p];
  if (FLAT_KEYS.has(mod12(keyPc))) return FLAT_NAMES[p];
  return rel === 6 ? SHARP_NAMES[p] : FLAT_NAMES[p];
}

export function noteName(midi: number, keyPc = 0): string {
  const n = Math.round(midi);
  return pcName(n, keyPc) + (Math.floor(n / 12) - 1);
}

/** Parse "C", "F#", "Bb", "Db" etc. to a pitch class, or null. */
export function parsePc(name: string): number | null {
  const m = /^([A-Ga-g])([#b♯♭]?)$/.exec(name.trim());
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase() as 'C'];
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return mod12(base + acc);
}

/** Parse "G2", "C#4", "Bb3" to MIDI, or null. */
export function parseNote(name: string): number | null {
  const m = /^([A-Ga-g][#b♯♭]?)(-?\d)$/.exec(name.trim());
  if (!m) return null;
  const pc = parsePc(m[1]);
  return pc === null ? null : pc + 12 * (Number(m[2]) + 1);
}

export type Quality = 'major' | 'minor' | 'dominant' | 'sus';

export interface ChordType {
  /** Semitones above the root. */
  intervals: number[];
  /** Tones that must appear in the upper voices, most important first (the root is always the bass). */
  required: number[];
  quality: Quality;
  /** Relative likelihood when the progression picks a type for a degree. */
  weight: number;
}

/** The fifth is always optional; everything else colourful is required. */
export const CHORD_TYPES: Record<string, ChordType> = {
  maj7: { intervals: [0, 4, 7, 11], required: [4, 11], quality: 'major', weight: 1 },
  maj9: { intervals: [0, 4, 7, 11, 14], required: [4, 11, 14], quality: 'major', weight: 1.3 },
  'maj7#11': { intervals: [0, 4, 7, 11, 14, 18], required: [4, 11, 18, 14], quality: 'major', weight: 1.3 },
  '6': { intervals: [0, 4, 7, 9], required: [4, 9], quality: 'major', weight: 0.5 },
  '6/9': { intervals: [0, 4, 7, 9, 14], required: [4, 9, 14], quality: 'major', weight: 1 },
  m7: { intervals: [0, 3, 7, 10], required: [3, 10], quality: 'minor', weight: 1 },
  m9: { intervals: [0, 3, 7, 10, 14], required: [3, 10, 14], quality: 'minor', weight: 1.2 },
  m11: { intervals: [0, 3, 7, 10, 14, 17], required: [3, 10, 17, 14], quality: 'minor', weight: 1.3 },
  '7sus4': { intervals: [0, 5, 7, 10], required: [5, 10], quality: 'sus', weight: 0.5 },
  '9sus4': { intervals: [0, 5, 7, 10, 14], required: [5, 10, 14], quality: 'sus', weight: 0.5 },
  '7': { intervals: [0, 4, 7, 10], required: [4, 10], quality: 'dominant', weight: 0.5 },
  '9': { intervals: [0, 4, 7, 10, 14], required: [4, 10, 14], quality: 'dominant', weight: 0.8 },
};

export const ALL_CHORD_TYPES = Object.keys(CHORD_TYPES);

export function chordPcs(root: number, type: string): number[] {
  return CHORD_TYPES[type].intervals.map((i) => mod12(root + i));
}

export function isDiatonic(root: number, type: string, keyPc: number): boolean {
  const scale = scalePcs(keyPc);
  return chordPcs(root, type).every((pc) => scale.has(pc));
}

export function chordName(root: number, type: string, keyPc = 0): string {
  return pcName(root, keyPc) + type;
}

const ROMAN = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];

/** Roman numeral of a chord relative to a key; lower case for minor chords. */
export function romanNumeral(root: number, type: string, keyPc: number): string {
  const r = ROMAN[mod12(root - keyPc)];
  if (CHORD_TYPES[type].quality !== 'minor') return r;
  return r.replace(/[IV]+/, (s) => s.toLowerCase());
}

/** Degree names usable for start/end notes, as semitones above the tonic. */
export const DEGREE_OFFSETS: Record<string, number> = {
  tonic: 0,
  root: 0,
  second: 2,
  third: 4,
  fourth: 5,
  fifth: 7,
  sixth: 9,
  seventh: 11,
};
