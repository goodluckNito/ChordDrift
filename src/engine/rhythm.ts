/**
 * Rhythm notation, shared by chord changes and melodies. Durations are in beats
 * (a beat is a quarter note at the configured tempo).
 *
 *   w h q e s          whole, half, quarter, eighth, sixteenth
 *   1 2 4 8 16 32      the same as numbers (4 = quarter)
 *   q.  q..            dotted (×1.5), double-dotted (×1.75)
 *   et  qt  8t         triplets (×2/3): "et et et" fills one beat
 *   h+e                tie: one note lasting a half plus an eighth
 *   rq  r8  -q         rests (for chord rhythms a rest just extends the chord)
 *   e*4   (q e e)*2    repeat a note or a group
 *   |  ,               bar lines and commas are ignored
 */

export interface RhythmStep {
  beats: number;
  rest: boolean;
}

export interface RhythmParse {
  steps: RhythmStep[];
  errors: string[];
}

const LETTER: Record<string, number> = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };
const MAX_STEPS = 4096;

function parseAtom(atom: string): RhythmStep | null {
  const m = /^(r|-)?(w|h|q|e|s|1|2|4|8|16|32)(\.{0,2})(t?)$/i.exec(atom);
  if (!m) return null;
  const base = m[2].toLowerCase();
  let beats = base in LETTER ? LETTER[base] : 4 / Number(base);
  if (m[3].length === 1) beats *= 1.5;
  if (m[3].length === 2) beats *= 1.75;
  if (m[4]) beats *= 2 / 3;
  return { beats, rest: Boolean(m[1]) };
}

/** A note with optional ties: "h+e", "rq+re". */
function parseNote(token: string): RhythmStep | null {
  const parts = token.split('+');
  let beats = 0;
  let rest = true;
  for (const p of parts) {
    const a = parseAtom(p);
    if (!a) return null;
    beats += a.beats;
    rest = rest && a.rest;
  }
  return { beats, rest };
}

export function parseRhythm(text: string): RhythmParse {
  const errors: string[] = [];
  const tokens = text
    .replace(/[|,]/g, ' ')
    .replace(/\(/g, ' ( ')
    .replace(/\)\s*(\*\s*\d+)?/g, (_, rep) => ` ) ${rep ? rep.replace(/\s+/g, '') : ''} `)
    .split(/\s+/)
    .filter(Boolean);
  let i = 0;

  function seq(depth: number): RhythmStep[] {
    const out: RhythmStep[] = [];
    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok === ')') {
        if (depth === 0) {
          errors.push('unmatched ")"');
          i++;
          continue;
        }
        return out;
      }
      if (tok === '(') {
        i++;
        const inner = seq(depth + 1);
        if (tokens[i] !== ')') errors.push('missing ")"');
        i++;
        let times = 1;
        const rep = /^\*(\d+)$/.exec(tokens[i] ?? '');
        if (rep) {
          times = Math.min(64, Number(rep[1]));
          i++;
        }
        for (let k = 0; k < times && out.length < MAX_STEPS; k++) out.push(...inner);
        continue;
      }
      i++;
      const m = /^(.+?)(?:\*(\d+))?$/.exec(tok)!;
      const note = parseNote(m[1]);
      if (!note) {
        errors.push(`can't read "${tok}"`);
        continue;
      }
      const times = m[2] ? Math.min(64, Number(m[2])) : 1;
      for (let k = 0; k < times && out.length < MAX_STEPS; k++) out.push({ ...note });
    }
    return out;
  }

  const steps = seq(0).filter((s) => s.beats > 0);
  return { steps, errors };
}

/**
 * Durations for chord changes: rests and ties just lengthen the current chord.
 * Returns beats per chord.
 */
export function chordDurations(steps: RhythmStep[]): number[] {
  const out: number[] = [];
  for (const s of steps) {
    if (s.rest && out.length) out[out.length - 1] += s.beats;
    else out.push(s.beats);
  }
  return out;
}

/** Common patterns offered in the UI. Values are notation strings. */
export const RHYTHM_PRESETS: { name: string; chords: string }[] = [
  { name: 'Free (seconds, no grid)', chords: '' },
  { name: 'Whole notes', chords: 'w' },
  { name: 'Half notes', chords: 'h' },
  { name: 'Dotted halves', chords: 'h.' },
  { name: 'Charleston', chords: 'q. e+h' },
  { name: 'Tresillo (3+3+2)', chords: 'q. q. q' },
  { name: 'Half-note triplets', chords: 'ht ht ht' },
  { name: 'Long–short', chords: 'w+h h' },
  { name: 'Push', chords: 'h+q. e' },
];
