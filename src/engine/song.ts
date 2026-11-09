/**
 * Song form: a piece made of parts.
 *
 *   A8 | B!8 > C!8 | A4 | B!8+1
 *
 * - A name (letters) is a part. The same name plays the same chords every time it comes back.
 * - A number after the name is its length in bars (default 8). Chords change on the
 *   chord rhythm, or once a bar without one, restarting at each part.
 * - `!` makes a part full: the sub bass opens up and the drums play.
 *   Parts without it are soft: no drums, the sub almost gone.
 * - `[khs]` picks the drums for the part: k(ick) s(nare) h(at) c(rash) r(ide); `[]` = none.
 *   Without brackets a full part has every drum and a soft part none.
 * - `{E,dorian,jazz}` sets the part's key (tonic), scale and/or style. A repeat with another key
 *   (or +N) is transposed; one with another scale or style is a new variation with its own chords.
 * - `+N` / `-N` moves the part N semitones from the home key (a repeat is transposed).
 * - `|` between parts collapses every voice into a unison, holds, and blooms
 *   out into the next part. `>` resolves straight into it. Nothing between
 *   two parts means `>`.
 */
import type { DrumVoice } from './drums';
import { STYLE_IDS } from './styles';
import { SCALES, parsePc } from './theory';

export interface SongSection {
  /** Identity (case-insensitive) and the name as written. */
  name: string;
  label: string;
  full: boolean;
  shift: number;
  /** Drums written for this part, or null for the default (all when full, none when soft). */
  drums: DrumVoice[] | null;
  /** Overrides for this part: tonic name, scale id and style id (null = the piece's). */
  key: string | null;
  scale: string | null;
  style: string | null;
  /** Length in bars of 4 beats. */
  bars: number;
  /** Collapse into a unison before this part (always false for the first). */
  collapse: boolean;
}

export interface SongForm {
  sections: SongSection[];
  errors: string[];
}

export const DEFAULT_PART_BARS = 8;
export const DEFAULT_SONG_FORM = 'A8 | B!8 > C!8 | A4 | B!8+1';

export const SONG_PRESETS: { name: string; form: string }[] = [
  { name: 'Build, drop, lift', form: DEFAULT_SONG_FORM },
  { name: 'Verse / chorus', form: 'V8[h] > C!8 | V8[h] > C!8 > B4[kh] | C!8+2' },
  { name: 'Long drops', form: 'intro8 > drop!16 | drop!16+1 > lift!8[kh] | break8[h] > drop!8+1' },
  { name: 'Rondo', form: 'A8 | B8 | A8 | C8 | A8' },
  { name: 'Climb', form: 'A4 > A4+2 > A4+4 > A!8+5' },
];

const SECTION = /^([A-Za-z][A-Za-z']*)((?::?\d{1,3}|!|[+-]\d{1,2}|\[[kshcrKSHCR]*\]|\{[^}]*\})*)$/;
const DRUM_LETTERS: Record<string, DrumVoice> = { k: 'kick', s: 'snare', h: 'hat', c: 'crash', r: 'ride' };

export function parseSongForm(text: string): SongForm {
  const sections: SongSection[] = [];
  const errors: string[] = [];
  let pending: '|' | '>' | null = null;
  // Spaces inside {…} separate options, not parts.
  const src = text.replace(/\{[^}]*\}/g, (g) => g.replace(/\s+/g, ','));
  for (const tok of src.split(/\s*([|>])\s*|\s+/).filter((x) => x !== undefined && x !== '')) {
    if (tok === '|' || tok === '>') {
      pending = tok;
      continue;
    }
    const m = SECTION.exec(tok);
    if (!m) {
      errors.push(`can't read part "${tok}"`);
      continue;
    }
    let bars = DEFAULT_PART_BARS;
    let full = false;
    let shift = 0;
    let drums: DrumVoice[] | null = null;
    let key: string | null = null;
    let scale: string | null = null;
    let style: string | null = null;
    for (const [, n, bang, sh, kit, opts] of m[2].matchAll(/:?(\d{1,3})|(!)|([+-]\d{1,2})|\[([a-zA-Z]*)\]|\{([^}]*)\}/g)) {
      if (opts !== undefined) {
        for (const o of opts.split(',').map((x) => x.trim()).filter(Boolean)) {
          const scaleId = Object.keys(SCALES).find((id) => id.toLowerCase() === o.toLowerCase());
          const styleId = STYLE_IDS.find((id) => id.toLowerCase() === o.toLowerCase().replace(/[\s-]/g, ''));
          if (/^[A-Ga-g][#b]?$/.test(o) && parsePc(o[0].toUpperCase() + o.slice(1)) !== null) key = o[0].toUpperCase() + o.slice(1);
          else if (scaleId) scale = scaleId;
          else if (styleId) style = styleId;
          else errors.push(`"${o}" in ${m[1]} isn't a key, scale or style`);
        }
        continue;
      }
      if (kit !== undefined) drums = [...new Set([...kit.toLowerCase()].map((c) => DRUM_LETTERS[c]))];
      else if (n) bars = Math.max(1, Math.min(128, Number(n)));
      else if (bang) full = true;
      else if (sh) shift = Math.max(-24, Math.min(24, Number(sh)));
    }
    sections.push({ name: m[1].toLowerCase(), label: m[1], full, shift, drums, key, scale, style, bars, collapse: sections.length > 0 && pending === '|' });
    pending = null;
    if (sections.length >= 32) {
      errors.push('at most 32 parts');
      break;
    }
  }
  return { sections, errors };
}
