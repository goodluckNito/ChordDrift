/**
 * Chop: a step pattern (one character per 16th note) that plays the chords
 * back through a time and volume controller, in the spirit of tape/beat
 * repeat effects. Everything here is a pure function of score time, so the
 * chords can be played backwards, repeated or slowed exactly.
 *
 *   x  play
 *   .  cut (silence)
 *   -  half volume
 *   <  reverse: a run of them plays that stretch backwards
 *   =  repeat: a run of n of them replays the n steps just before it
 *   ~  tape stop: a run of them slows to a stop (and the pitch falls with it)
 *   ?  decided by the seed each bar: usually play, sometimes one of the others
 *      (neighbouring ?s that land on the same move join into one run)
 */
export type ChopKind = 'play' | 'cut' | 'half' | 'rev' | 'rep' | 'tape' | 'maybe';

export interface ChopStep {
  kind: ChopKind;
  /** The run of identical steps this one belongs to, in steps within the pattern: [start, end). */
  start: number;
  end: number;
}

export interface ChopPattern {
  steps: ChopStep[];
  length: number;
  /** Has ? steps (resolved per bar by chopSteps). */
  random: boolean;
  cache?: Map<string, ChopStep[]>;
}

const KINDS: Record<string, ChopKind> = { x: 'play', X: 'play', '.': 'cut', '-': 'half', '<': 'rev', '=': 'rep', '~': 'tape', '?': 'maybe' };

export const CHOP_PRESETS: { name: string; pattern: string }[] = [
  { name: 'Gate', pattern: 'xxx.xx.xxx.xx.x.' },
  { name: 'Half-bar cut', pattern: 'xxxxxxxx........' },
  { name: 'Stutter end', pattern: 'xxxxxxxxxxxx====' },
  { name: 'Reverse tail', pattern: 'xxxxxxxxxxxx<<<<' },
  { name: 'Reverse bar', pattern: 'xxxxxxxxxxxxxxxx<<<<<<<<<<<<<<<<' },
  { name: 'Tape stop', pattern: 'xxxxxxxxxxxxxxxxxxxxxxxx~~~~~~~~' },
  { name: 'Choppy', pattern: 'x.x-xx.x<<..==x~' },
  { name: 'Wildcard', pattern: 'xxxxxxxx????????' },
];

/** Parse a chop pattern; unknown characters are errors. Empty or all-play patterns return null (no effect). */
export function parseChop(text: string): { pattern: ChopPattern | null; errors: string[] } {
  const chars = [...text.replace(/[\s|]/g, '')].slice(0, 256);
  const errors: string[] = [];
  const kinds: ChopKind[] = [];
  for (const c of chars) {
    const k = KINDS[c];
    if (!k) {
      errors.push(`unknown step "${c}"`);
      kinds.push('play');
    } else kinds.push(k);
  }
  if (!kinds.length || kinds.every((k) => k === 'play')) return { pattern: null, errors };
  return { pattern: { steps: runsOf(kinds), length: kinds.length, random: kinds.includes('maybe') }, errors: [...new Set(errors)] };
}

function runsOf(kinds: ChopKind[]): ChopStep[] {
  const steps: ChopStep[] = [];
  for (let i = 0; i < kinds.length; ) {
    let j = i;
    while (j < kinds.length && kinds[j] === kinds[i]) j++;
    for (let k = i; k < j; k++) steps.push({ kind: kinds[i], start: i, end: j });
    i = j;
  }
  return steps;
}

const MAYBE: [ChopKind, number][] = [
  ['play', 4],
  ['cut', 1.6],
  ['half', 1],
  ['rev', 1.2],
  ['rep', 1.2],
  ['tape', 0.5],
];

/**
 * The pattern's steps for one pass (bar) of one part, with every ? decided by the seed.
 * Patterns without ? return their steps unchanged.
 */
export function chopSteps(pattern: ChopPattern, seed: number, part: number, pass: number): ChopStep[] {
  if (!pattern.random) return pattern.steps;
  const key = `${part}:${pass}`;
  pattern.cache ??= new Map();
  const hit = pattern.cache.get(key);
  if (hit) return hit;
  const total = MAYBE.reduce((a, [, w]) => a + w, 0);
  const kinds = pattern.steps.map((st, i) => {
    if (st.kind !== 'maybe') return st.kind;
    let h = (seed ^ Math.imul(part + 1, 0x9e3779b1) ^ Math.imul(pass + 0x51ed27, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    let x = (((h ^ (h >>> 16)) >>> 0) / 4294967296) * total;
    for (const [k, w] of MAYBE) {
      if ((x -= w) < 0) return k;
    }
    return 'play' as ChopKind;
  });
  const steps = runsOf(kinds);
  if (pattern.cache.size > 2000) pattern.cache.clear();
  pattern.cache.set(key, steps);
  return steps;
}
