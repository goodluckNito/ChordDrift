/** Pitch helpers and the scale library. Everything works in MIDI note numbers / pitch classes. */

export const midiToHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
export const hzToMidi = (f: number) => 69 + 12 * Math.log2(f / 440);
export const mod12 = (n: number) => ((n % 12) + 12) % 12;

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Conventional tonic names. */
export const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
/** Major keys written with flats. */
const FLAT_MAJOR_KEYS = new Set([1, 3, 5, 8, 10]);

export interface ScaleDef {
  name: string;
  /** Semitones above the tonic, ascending, starting with 0. */
  steps: number[];
  family: string;
}

/** The scale library. Ids are stable (used in saved projects and URLs). */
export const SCALES: Record<string, ScaleDef> = {
  major: { name: 'Major (Ionian)', steps: [0, 2, 4, 5, 7, 9, 11], family: 'Church modes' },
  dorian: { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10], family: 'Church modes' },
  phrygian: { name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10], family: 'Church modes' },
  lydian: { name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11], family: 'Church modes' },
  mixolydian: { name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10], family: 'Church modes' },
  minor: { name: 'Natural minor (Aeolian)', steps: [0, 2, 3, 5, 7, 8, 10], family: 'Church modes' },
  locrian: { name: 'Locrian', steps: [0, 1, 3, 5, 6, 8, 10], family: 'Church modes' },

  harmonicMinor: { name: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11], family: 'Harmonic & melodic' },
  phrygianDominant: { name: 'Phrygian dominant', steps: [0, 1, 4, 5, 7, 8, 10], family: 'Harmonic & melodic' },
  melodicMinor: { name: 'Melodic minor', steps: [0, 2, 3, 5, 7, 9, 11], family: 'Harmonic & melodic' },
  dorianFlat2: { name: 'Dorian b2', steps: [0, 1, 3, 5, 7, 9, 10], family: 'Harmonic & melodic' },
  lydianAugmented: { name: 'Lydian augmented', steps: [0, 2, 4, 6, 8, 9, 11], family: 'Harmonic & melodic' },
  lydianDominant: { name: 'Lydian dominant', steps: [0, 2, 4, 6, 7, 9, 10], family: 'Harmonic & melodic' },
  mixolydianFlat6: { name: 'Mixolydian b6', steps: [0, 2, 4, 5, 7, 8, 10], family: 'Harmonic & melodic' },
  altered: { name: 'Altered (Super Locrian)', steps: [0, 1, 3, 4, 6, 8, 10], family: 'Harmonic & melodic' },
  harmonicMajor: { name: 'Harmonic major', steps: [0, 2, 4, 5, 7, 8, 11], family: 'Harmonic & melodic' },

  doubleHarmonic: { name: 'Double harmonic (Byzantine)', steps: [0, 1, 4, 5, 7, 8, 11], family: 'Exotic' },
  hungarianMinor: { name: 'Hungarian minor', steps: [0, 2, 3, 6, 7, 8, 11], family: 'Exotic' },
  neapolitanMajor: { name: 'Neapolitan major', steps: [0, 1, 3, 5, 7, 9, 11], family: 'Exotic' },
  neapolitanMinor: { name: 'Neapolitan minor', steps: [0, 1, 3, 5, 7, 8, 11], family: 'Exotic' },
  persian: { name: 'Persian', steps: [0, 1, 4, 5, 6, 8, 11], family: 'Exotic' },
  enigmatic: { name: 'Enigmatic', steps: [0, 1, 4, 6, 8, 10, 11], family: 'Exotic' },

  majorPentatonic: { name: 'Major pentatonic', steps: [0, 2, 4, 7, 9], family: 'Pentatonic & hexatonic' },
  minorPentatonic: { name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10], family: 'Pentatonic & hexatonic' },
  hirajoshi: { name: 'Hirajoshi', steps: [0, 2, 3, 7, 8], family: 'Pentatonic & hexatonic' },
  inSen: { name: 'In-sen', steps: [0, 1, 5, 7, 10], family: 'Pentatonic & hexatonic' },
  iwato: { name: 'Iwato', steps: [0, 1, 5, 6, 10], family: 'Pentatonic & hexatonic' },
  blues: { name: 'Blues', steps: [0, 3, 5, 6, 7, 10], family: 'Pentatonic & hexatonic' },
  wholeTone: { name: 'Whole tone', steps: [0, 2, 4, 6, 8, 10], family: 'Pentatonic & hexatonic' },
  prometheus: { name: 'Prometheus', steps: [0, 2, 4, 6, 9, 10], family: 'Pentatonic & hexatonic' },
  augmented: { name: 'Augmented (hexatonic)', steps: [0, 3, 4, 7, 8, 11], family: 'Pentatonic & hexatonic' },

  octatonicHW: { name: 'Octatonic (half-whole)', steps: [0, 1, 3, 4, 6, 7, 9, 10], family: 'Symmetric & bebop' },
  octatonicWH: { name: 'Octatonic (whole-half)', steps: [0, 2, 3, 5, 6, 8, 9, 11], family: 'Symmetric & bebop' },
  bebopDominant: { name: 'Bebop dominant', steps: [0, 2, 4, 5, 7, 9, 10, 11], family: 'Symmetric & bebop' },
};

export const SCALE_IDS = Object.keys(SCALES);

/** Scales with the same tonic used for modal interchange (borrowed chords). */
export const PARALLEL_SCALES = ['major', 'minor', 'dorian', 'mixolydian', 'lydian', 'phrygian', 'harmonicMinor', 'melodicMinor'];

export function scaleSteps(scaleId: string): number[] {
  return (SCALES[scaleId] ?? SCALES.major).steps;
}

export function scalePcs(tonic: number, scaleId: string): Set<number> {
  return new Set(scaleSteps(scaleId).map((s) => mod12(tonic + s)));
}

/**
 * Whether to spell with flats in this key. Scales with a minor third borrow
 * the signature of their relative major (D minor → F major → flats).
 */
export function prefersFlats(tonic: number, scaleId = 'major'): boolean {
  const steps = scaleSteps(scaleId);
  const t = mod12(tonic);
  if (steps.includes(3) && !steps.includes(4)) return FLAT_MAJOR_KEYS.has(mod12(t + 3)) || t === 5 || t === 0 || t === 7;
  return FLAT_MAJOR_KEYS.has(t);
}

/**
 * Flats or sharps for a chord root heard in a key: diatonic roots follow the
 * key signature; borrowed roots on the "flat side" (b2, b3, b6, b7) use flats,
 * #4 uses a sharp.
 */
export function rootPrefersFlats(root: number, tonic: number, scaleId = 'major'): boolean {
  const keyFlats = prefersFlats(tonic, scaleId);
  const rel = mod12(root - tonic);
  if (scaleSteps(scaleId).includes(rel)) return keyFlats;
  if ([1, 3, 8, 10].includes(rel)) return true;
  return rel === 6 ? false : keyFlats;
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

/** Name of the tonic as conventionally written for this scale (C# minor, Db major). */
export function tonicName(tonic: number, scaleId = 'major'): string {
  return pcName(tonic, prefersFlats(tonic, scaleId));
}

/**
 * Spell a pitch class in a key. In seven-note scales, scale tones get
 * consecutive letters like a key signature (F# major → … D# E#); other notes
 * fall back to flats/sharps by context. Returns the name and its accidental.
 */
export function spellPcParts(pc: number, tonic: number, scaleId = 'major'): { name: string; acc: number } {
  const p = mod12(pc);
  const steps = scaleSteps(scaleId);
  const k = steps.indexOf(mod12(p - tonic));
  if (steps.length === 7 && k >= 0) {
    const letter = (LETTERS.indexOf(tonicName(tonic, scaleId)[0]) + k) % 7;
    const acc = mod12(p - LETTER_PC[letter] + 6) - 6;
    if (Math.abs(acc) <= 1) return { name: LETTERS[letter] + (acc === 1 ? '#' : acc === -1 ? 'b' : ''), acc };
  }
  const name = pcName(p, rootPrefersFlats(p, tonic, scaleId));
  return { name, acc: name.length > 1 ? (name[1] === '#' ? 1 : -1) : 0 };
}

export function spellPc(pc: number, tonic: number, scaleId = 'major'): string {
  return spellPcParts(pc, tonic, scaleId).name;
}

/** Note name with octave, spelled in a key (B#3 and Cb4 keep their written octave). */
export function spellNote(midi: number, tonic: number, scaleId = 'major'): string {
  const n = Math.round(midi);
  const { name, acc } = spellPcParts(n, tonic, scaleId);
  return name + (Math.floor((n - acc) / 12) - 1);
}

export function pcName(pc: number, flats = false): string {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

export function noteName(midi: number, flats = false): string {
  const n = Math.round(midi);
  return pcName(n, flats) + (Math.floor(n / 12) - 1);
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

const ROMAN = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];

/** Roman numeral for a root relative to the tonic (major-scale reference), lower case if minor. */
export function romanFor(root: number, tonic: number, minor: boolean): string {
  const r = ROMAN[mod12(root - tonic)];
  return minor ? r.replace(/[IV]+/, (s) => s.toLowerCase()) : r;
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
