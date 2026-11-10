/**
 * A small, forgiving language for writing progressions.
 *
 *   Cmaj9 Am11 Em7 Fmaj7#11     absolute chord names (literal: "C" is a C major triad)
 *   I vi iii IV                 roman numerals relative to the tonic (major-scale reference)
 *   Imaj9 vi11 iii7 bVII9       numerals with explicit qualities (lower case = minor)
 *   1 6 3 4                     scale degrees of the selected scale (works in any scale)
 *   4maj7  6:m11                degrees with explicit qualities
 *   +0 +9m11 +5maj9             semitones above the tonic
 *   C{0 4 7 11 18}  +5{0 3 7}   explicit interval sets — any root form, key-agnostic
 *   ?                           let the generator choose this one
 *
 * Bare numerals, degrees and offsets (no quality) are coloured automatically:
 * stacked from the selected scale at the current complexity.
 * Separators: spaces, commas, "|", "→" or ">". A slash bass note ("C/G", "Em7/D") puts that note in the bass.
 */
import { chordSuffix, romanName, suffixIntervals } from './chords';
import { mod12, parsePc, romanFor } from './theory';

export type RootRef =
  | { kind: 'absolute'; pc: number }
  | { kind: 'roman'; semitones: number; minor: boolean }
  | { kind: 'degree'; degree: number; accidental: number }
  | { kind: 'offset'; semitones: number };

export type ProgressionToken =
  | { kind: 'wildcard'; text: string }
  | { kind: 'chord'; text: string; root: RootRef; intervals: number[] | null; bass?: number };

export interface ParseResult {
  tokens: ProgressionToken[];
  errors: string[];
}

const ROMANS: [string, number][] = [
  ['VII', 11],
  ['VI', 9],
  ['IV', 5],
  ['V', 7],
  ['III', 4],
  ['II', 2],
  ['I', 0],
];

function accidental(s: string): number {
  let n = 0;
  for (const c of s) n += c === '#' || c === '♯' ? 1 : -1;
  return n;
}

/** Parse "{0 4 7 11}" / "(0,4,7,11)" interval lists or chord suffixes. */
function parseQuality(rest: string): { intervals: number[] | null; ok: boolean } {
  const q = rest.replace(/^:/, '').trim();
  if (q === '') return { intervals: null, ok: true };
  const set = /^[{(\[]\s*(-?\d+(?:[\s,;-]+-?\d+)*)\s*[})\]]$/.exec(q);
  if (set) {
    const iv = [...new Set(set[1].split(/[\s,;]+/).map(Number))].filter((n) => Number.isFinite(n) && n >= 0 && n <= 36);
    if (!iv.includes(0)) iv.push(0);
    return { intervals: iv.sort((a, b) => a - b), ok: iv.length > 0 };
  }
  const iv = suffixIntervals(q);
  return { intervals: iv, ok: iv !== null };
}

function minorise(suffix: string): string {
  if (/^(m(?!aj)|dim|°|ø|o7?$|-)/.test(suffix)) return suffix;
  if (/^Maj/.test(suffix)) return 'm' + suffix; // iMaj7 → mMaj7
  if (/^(maj|M|Δ)/.test(suffix)) return 'mMaj' + suffix.replace(/^(maj|M|Δ)/, ''); // imaj7 → mMaj7
  if (suffix === '' || suffix.startsWith(':') || suffix.startsWith('{') || suffix.startsWith('(')) return suffix;
  return 'm' + suffix;
}

export function parseToken(raw: string): ProgressionToken | string {
  // A slash bass: a note name after the last "/" ("C/G", "Am7/G"). Anything else after a slash
  // ("6/9", "V/V") is read as before.
  const slash = /^(.+)\/([A-G][#b♯♭]?)$/.exec(raw.trim());
  if (slash) {
    const inner = parseToken(slash[1]);
    if (typeof inner !== 'string' && inner.kind === 'chord') return { ...inner, text: raw, bass: parsePc(slash[2].replace('♯', '#').replace('♭', 'b'))! };
  }
  const text = raw.split('/')[0].trim();
  if (!text) return 'empty chord';
  if (/^[?*_]$/.test(text)) return { kind: 'wildcard', text };

  // Absolute: C, F#maj7, Bbm11, C{0 4 7}
  let m = /^([A-G])([#b♯♭]?)(.*)$/.exec(text);
  if (m) {
    const pc = parsePc(m[1] + m[2])!;
    const rest = m[3];
    const q = parseQuality(rest === '' ? '' : rest);
    if (!q.ok) return `unknown chord quality "${rest}" in "${raw}"`;
    return { kind: 'chord', text: raw, root: { kind: 'absolute', pc }, intervals: rest === '' ? suffixIntervals('')! : q.intervals };
  }

  // Semitone offset: +9, +9m11, +5{0 4 7}
  m = /^\+(\d{1,2})(.*)$/.exec(text);
  if (m) {
    const q = parseQuality(m[2]);
    if (!q.ok) return `unknown chord quality "${m[2]}" in "${raw}"`;
    return { kind: 'chord', text: raw, root: { kind: 'offset', semitones: mod12(Number(m[1])) }, intervals: q.intervals };
  }

  // Scale degree: 1..9 with optional accidentals: 4, b7, 6m11, 4:maj7
  m = /^([#b♯♭]*)([1-9])(.*)$/.exec(text);
  if (m) {
    const q = parseQuality(m[3]);
    if (!q.ok) return `unknown chord quality "${m[3]}" in "${raw}"`;
    return { kind: 'chord', text: raw, root: { kind: 'degree', degree: Number(m[2]) - 1, accidental: accidental(m[1]) }, intervals: q.intervals };
  }

  // Roman numeral: bVII9, vi11, IVmaj7, ii°
  m = /^([#b♯♭]*)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/.exec(text);
  if (m) {
    const numeral = m[2];
    const minor = numeral === numeral.toLowerCase();
    const semis = ROMANS.find(([r]) => r === numeral.toUpperCase())![1] + accidental(m[1]);
    const rest = minor ? minorise(m[3]) : m[3];
    const q = parseQuality(rest);
    if (!q.ok) return `unknown chord quality "${m[3]}" in "${raw}"`;
    // Bare lower-case numerals mean "minor chord, auto colour".
    return { kind: 'chord', text: raw, root: { kind: 'roman', semitones: mod12(semis), minor }, intervals: q.intervals };
  }
  return `can't read "${raw}"`;
}

/** Split on separators, but not inside {…} / (…) / […] interval lists. */
export function splitTokens(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (const c of text) {
    if ('{(['.includes(c)) depth++;
    if ('})]'.includes(c)) depth = Math.max(0, depth - 1);
    if (depth === 0 && /[\s,|→>]/.test(c)) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

export function parseProgression(text: string): ParseResult {
  const tokens: ProgressionToken[] = [];
  const errors: string[] = [];
  for (const raw of splitTokens(text)) {
    if (!raw) continue;
    const t = parseToken(raw);
    if (typeof t === 'string') errors.push(t);
    else tokens.push(t);
  }
  return { tokens, errors };
}

/**
 * Write a chord back as a key-relative token that parses to exactly the same
 * chord ("vi11", "IVmaj7#11", "bVII9", or "I{0 5 7 14}" for unnamed sets).
 * Used to "freeze" a generated progression into editable text.
 */
export function chordToToken(chord: { root: number; intervals: number[] }, tonic: number): string {
  const suffix = chordSuffix(chord.intervals);
  const table = suffixIntervals(suffix);
  const pcs = (iv: number[]) => [...new Set(iv.map(mod12))].sort((a, b) => a - b).join(',');
  if (table && pcs(table) === pcs(chord.intervals)) {
    // Bare numerals mean "auto colour", so triads are spelled out.
    const candidates =
      suffix === '' ? [romanFor(chord.root, tonic, false) + 'maj'] : suffix === 'm' ? [romanFor(chord.root, tonic, true) + 'm'] : [romanName(chord, tonic), romanFor(chord.root, tonic, false) + suffix];
    for (const c of candidates) {
      const t = parseToken(c);
      if (typeof t !== 'string' && t.kind === 'chord' && t.intervals && pcs(t.intervals) === pcs(chord.intervals)) return c;
    }
  }
  return `${romanFor(chord.root, tonic, false)}{${chord.intervals.join(' ')}}`;
}
