/**
 * Song form: a piece made of parts.
 *
 *   A | B! > C! | A | B!+1
 *
 * - A name is a part. The same name plays the same chords every time it comes back.
 * - `!` makes a part full: the sub bass opens up and the drums (if on) play.
 *   Parts without it are soft: no drums, the sub almost gone.
 * - `+N` / `-N` moves the part N semitones from the home key (a repeat is transposed).
 * - `:N` sets the number of chords (default 4).
 * - `|` between parts collapses every voice into a unison, holds, and blooms
 *   out into the next part. `>` resolves straight into it. Nothing between
 *   two parts means `>`.
 */
export interface SongSection {
  /** Identity (case-insensitive) and the name as written. */
  name: string;
  label: string;
  full: boolean;
  shift: number;
  /** Chords in this part, or null for the default (4, or the first appearance's count). */
  count: number | null;
  /** Collapse into a unison before this part (always false for the first). */
  collapse: boolean;
}

export interface SongForm {
  sections: SongSection[];
  errors: string[];
}

export const DEFAULT_SONG_FORM = 'A | B! > C! | A | B!+1';

export const SONG_PRESETS: { name: string; form: string }[] = [
  { name: 'Build, drop, lift', form: DEFAULT_SONG_FORM },
  { name: 'Verse / chorus', form: 'V > C! | V > C! > B | C!+2' },
  { name: 'Nebula-ish', form: 'intro:6 > drop!:8 | drop!+1:8 > lift!:6 | break:4 > drop!+1:4' },
  { name: 'Rondo', form: 'A | B | A | C | A' },
  { name: 'Climb', form: 'A > A+2 > A+4 > A+5!' },
];

const SECTION = /^([A-Za-z][\w']*)(!?)([+-]\d{1,2})?(?::(\d{1,2}))?$/;

export function parseSongForm(text: string): SongForm {
  const sections: SongSection[] = [];
  const errors: string[] = [];
  let pending: '|' | '>' | null = null;
  for (const tok of text.split(/\s*([|>])\s*|\s+/).filter((x) => x !== undefined && x !== '')) {
    if (tok === '|' || tok === '>') {
      pending = tok;
      continue;
    }
    const m = SECTION.exec(tok);
    if (!m) {
      errors.push(`can't read part "${tok}"`);
      continue;
    }
    sections.push({
      name: m[1].toLowerCase(),
      label: m[1],
      full: m[2] === '!',
      shift: m[3] ? Math.max(-24, Math.min(24, Number(m[3]))) : 0,
      count: m[4] ? Math.max(1, Math.min(32, Number(m[4]))) : null,
      collapse: sections.length > 0 && pending === '|',
    });
    pending = null;
    if (sections.length >= 32) {
      errors.push('at most 32 parts');
      break;
    }
  }
  return { sections, errors };
}
