/**
 * Drums: step patterns on the tempo grid, and sidechain ducking.
 *
 * Each pattern row is a string of 16th-note steps:
 *   x  hit        X  accent      .  rest
 *   o  open hat (hat row)        r  roll: three quick hits in one step (hat row)
 * Spaces and | are ignored. Rows loop independently (so rows of different
 * lengths make polyrhythms). Drums start when the bloom lands and stop at the
 * arrival (they run forever in endless pieces and wrap with loops).
 */
export type DrumVoice = 'kick' | 'snare' | 'hat' | 'crash' | 'ride';
export const DRUM_VOICES: DrumVoice[] = ['kick', 'snare', 'hat', 'crash', 'ride'];
export type KitId = '808' | 'witch' | 'acoustic' | 'industrial' | 'jungle';

export interface DrumHit {
  t: number;
  voice: DrumVoice;
  vel: number;
  /** open hat / roll sub-hit */
  open?: boolean;
}

export interface DrumStep {
  i: number;
  vel: number;
  open?: boolean;
  roll?: boolean;
  /** "?": decided per bar by the seed (nothing, a ghost note, a hit, an accent, sometimes a roll or an open hat). */
  maybe?: boolean;
}

export function parseSteps(text: string): { steps: DrumStep[]; length: number } {
  const chars = text.replace(/[\s|]/g, '');
  const steps: DrumStep[] = [];
  [...chars].forEach((c, i) => {
    if (c === 'x') steps.push({ i, vel: 0.8 });
    else if (c === 'X') steps.push({ i, vel: 1 });
    else if (c === 'o') steps.push({ i, vel: 0.8, open: true });
    else if (c === 'O') steps.push({ i, vel: 1, open: true });
    else if (c === 'r') steps.push({ i, vel: 0.65, roll: true });
    else if (c === '?') steps.push({ i, vel: 0.8, maybe: true });
  });
  return { steps, length: chars.length };
}

export interface DrumPreset {
  name: string;
  kick: string;
  snare: string;
  hat: string;
  crash: string;
  ride: string;
}

const bars = (n: number, first: string) => first + '.'.repeat(16 * n - first.length);

export const DRUM_PRESETS: DrumPreset[] = [
  {
    name: 'Witch house (half-time)',
    kick: 'x.........x.....',
    snare: '........X.......',
    hat: 'x.x.x.x.x.x.x.rr',
    crash: bars(4, 'x'),
    ride: '',
  },
  {
    name: 'Trap (half-time)',
    kick: 'x......x..x.....',
    snare: '........X.......',
    hat: 'xxxxxxxxxxxxrrxx',
    crash: bars(8, 'x'),
    ride: '',
  },
  {
    name: 'Four on the floor',
    kick: 'X...x...x...x...',
    snare: '....x.......x...',
    hat: '..o...o...o...o.',
    crash: bars(4, 'x'),
    ride: '',
  },
  {
    name: 'Boom bap',
    kick: 'x.......x.x.....',
    snare: '....X.......X...',
    hat: 'x.x.x.x.x.x.x.x.',
    crash: '',
    ride: '',
  },
  {
    name: 'Breakbeat',
    kick: 'x.x.......xx....',
    snare: '....X..x.x..X..x',
    hat: 'x.x.x.x.x.x.x.x.',
    crash: bars(4, 'x'),
    ride: '',
  },
  {
    // A chopped two-bar break in the spirit of the classic one: syncopated kicks, ghosted snares, ride on the 8ths.
    name: 'Jungle break',
    kick: 'X.x.......xx....' + 'x.x.......x.....',
    snare: '....X..x.x..X..x' + '.x..X..x.x....X.',
    hat: '',
    crash: bars(4, 'x'),
    ride: 'x.x.x.x.x.x.x.x.',
  },
  {
    // Rolling: the snare's ghost notes and the last hat are rolled by the seed every bar.
    name: 'Jungle roller',
    kick: 'X.........x.....' + 'x.x.......x.....',
    snare: '....X..?.?..X..?',
    hat: 'x.xxx.x.x.xxx.x?',
    crash: bars(8, 'x'),
    ride: '',
  },
  {
    name: 'Ride groove',
    kick: 'x.......x.......',
    snare: '....x.......x...',
    hat: '',
    crash: '',
    ride: 'x..xx..xx..xx..x',
  },
  {
    name: 'Sparse (ambient)',
    kick: bars(1, 'x'),
    snare: bars(2, '........x'),
    hat: '',
    crash: bars(4, 'x'),
    ride: '',
  },
];

/** Parsed rows, ready for timing. */
export interface DrumRows {
  rows: Record<DrumVoice, { steps: DrumStep[]; length: number }>;
}

export function parseDrumRows(p: Record<DrumVoice, string>): DrumRows {
  const rows = {} as DrumRows['rows'];
  for (const v of DRUM_VOICES) rows[v] = parseSteps(p[v] ?? '');
  return { rows };
}

/** Three uniform numbers for (seed, voice, absolute step): the same every time, so "?" steps are reproducible. */
function rolls(seed: number, voice: number, n: number): [number, number, number] {
  let h = (seed ^ Math.imul(voice + 1, 0x9e3779b1) ^ Math.imul(n + 0x632be5ab, 0x85ebca6b)) >>> 0;
  const next = () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let x = h;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return [next(), next(), next()];
}

/** What a "?" step does this time round, or null for nothing. */
function resolveMaybe(seed: number, voice: DrumVoice, n: number): Omit<DrumStep, 'i'> | null {
  const [play, loud, extra] = rolls(seed, DRUM_VOICES.indexOf(voice), n);
  if (play < 0.45) return null;
  const vel = loud < 0.3 ? 0.45 : loud < 0.8 ? 0.8 : 1;
  if ((voice === 'snare' || voice === 'hat') && extra < 0.12) return { vel: 0.65, roll: true };
  if (voice === 'hat' && extra < 0.27) return { vel, open: true };
  return { vel };
}

/**
 * All drum hits in [a, b), from `start` (when the bloom lands) to `stop`.
 * step = seconds per 16th note. `seed` decides the "?" steps.
 */
export function drumHitsBetween(rows: DrumRows, start: number, stop: number, step: number, a: number, b: number, seed = 0): DrumHit[] {
  const out: DrumHit[] = [];
  const lo = Math.max(a, start);
  const hi = Math.min(b, stop);
  if (hi <= lo) return out;
  for (const voice of DRUM_VOICES) {
    const { steps, length } = rows.rows[voice];
    if (!steps.length || !length) continue;
    const loopSec = length * step;
    const first = Math.floor((lo - start) / loopSec);
    for (let loop = first; start + loop * loopSec < hi; loop++) {
      for (const raw of steps) {
        const s = raw.maybe ? resolveMaybe(seed, voice, loop * length + raw.i) : raw;
        if (!s) continue;
        const t = start + (loop * length + raw.i) * step;
        if (s.roll) {
          for (let k = 0; k < 3; k++) {
            const tr = t + (k * step) / 3;
            if (tr >= lo && tr < hi) out.push({ t: tr, voice, vel: s.vel * (0.75 + 0.12 * k) });
          }
        } else if (t >= lo && t < hi) out.push({ t, voice, vel: s.vel, open: s.open });
      }
      if (out.length > 20000) break;
    }
  }
  return out.sort((x, y) => x.t - y.t);
}
