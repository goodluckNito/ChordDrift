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
 */
export type ChopKind = 'play' | 'cut' | 'half' | 'rev' | 'rep' | 'tape';

export interface ChopStep {
  kind: ChopKind;
  /** The run of identical steps this one belongs to, in steps within the pattern: [start, end). */
  start: number;
  end: number;
}

export interface ChopPattern {
  steps: ChopStep[];
  length: number;
}

const KINDS: Record<string, ChopKind> = { x: 'play', X: 'play', '.': 'cut', '-': 'half', '<': 'rev', '=': 'rep', '~': 'tape' };

export const CHOP_PRESETS: { name: string; pattern: string }[] = [
  { name: 'Gate', pattern: 'xxx.xx.xxx.xx.x.' },
  { name: 'Half-bar cut', pattern: 'xxxxxxxx........' },
  { name: 'Stutter end', pattern: 'xxxxxxxxxxxx====' },
  { name: 'Reverse tail', pattern: 'xxxxxxxxxxxx<<<<' },
  { name: 'Reverse bar', pattern: 'xxxxxxxxxxxxxxxx<<<<<<<<<<<<<<<<' },
  { name: 'Tape stop', pattern: 'xxxxxxxxxxxxxxxxxxxxxxxx~~~~~~~~' },
  { name: 'Choppy', pattern: 'x.x-xx.x<<..==x~' },
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
  const steps: ChopStep[] = [];
  for (let i = 0; i < kinds.length; ) {
    let j = i;
    while (j < kinds.length && kinds[j] === kinds[i]) j++;
    for (let k = i; k < j; k++) steps.push({ kind: kinds[i], start: i, end: j });
    i = j;
  }
  return { pattern: { steps, length: kinds.length }, errors: [...new Set(errors)] };
}
