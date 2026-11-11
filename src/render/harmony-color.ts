/**
 * Harmony colours: colour that follows the key, so intervals read as colour relations without
 * every chord turning into a rainbow.
 *
 * - The key's notes are one family of neighbouring hues around an anchor (the theme's accent):
 *   each step round the circle of fifths from the tonic shifts the hue a little, so a fifth is a
 *   close shade and a tonic chord a tight family. How far each step turns, which way, where
 *   outside notes jump and how bright it all is vary with the theme (schemeOf).
 * - Notes outside the key (borrowed notes, chromatic tension) jump across to the complementary
 *   hue, so they pop against the family.
 * - Higher notes are lighter, lower ones deeper.
 */
import type { Score } from '../engine/score';
import { mod12, scaleSteps } from '../engine/theory';
import { paletteStops } from './palette';

const OUT_STEP = 10;

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return { h: 210, s: 0, l: 0.5 };
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h: (h + 360) % 360, s, l };
}

/** The anchor hue: the theme's accent, or its line colour if the accent is grey, or a calm blue. */
export function anchorHue(accent: string, ink: string): number {
  const a = hexToHsl(accent);
  if (a.s > 0.18) return a.h;
  const i = hexToHsl(ink);
  return i.s > 0.18 ? i.h : 205;
}

export interface HarmonyKey {
  tonic: number;
  inKey: Set<number>;
  anchor: number;
  dark: boolean;
  /** The theme's own variation of the scheme (see schemeOf). */
  step: number;
  dir: number;
  out: number;
  sat: number;
  light: number;
  lspan: number;
  /** The chosen line palette's colours (0..255), when there is one: harmony then draws from it. */
  stops: [number, number, number][] | null;
}

/**
 * Each theme gets its own variation of the harmony scheme, read from its colours (so the same theme
 * always looks the same, and a new theme genuinely differs): how far each step round the circle of
 * fifths turns the hue (a tight family of shades … a broad sweep), which way round, where notes
 * outside the key jump to (the complement, a triad or a split), and how saturated and how bright.
 */
function schemeOf(accent: string, ink: string, bg: string) {
  let h = 0x811c9dc5;
  for (const ch of accent + ink + bg) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  const r = (k: number) => {
    let x = Math.imul(h ^ Math.imul(k + 1, 0x9e3779b1), 0x85ebca6b);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  };
  return {
    step: 9 + 25 * r(1),
    dir: r(2) < 0.5 ? 1 : -1,
    out: [180, 150, 120, 210, 165][Math.floor(r(3) * 5)],
    sat: 0.62 + 0.36 * r(4),
    light: r(5),
    lspan: 0.12 + 0.18 * r(6),
  };
}

export function harmonyKey(tonic: number, scale: string, accent: string, ink: string, dark: boolean, bg = '', stops: [number, number, number][] | null = null): HarmonyKey {
  return { tonic: mod12(tonic), inKey: new Set(scaleSteps(scale).map(mod12)), anchor: anchorHue(accent, ink), dark, ...schemeOf(accent, ink, bg), stops };
}

/**
 * With a palette chosen, harmony draws from it: the key's notes spread along the palette by their
 * distance from the tonic round the circle of fifths (the tonic in the middle), notes outside the
 * key from the other end of it, and higher notes a little brighter.
 */
function paletteRgb(p: number, k: HarmonyKey, stops: [number, number, number][]): [number, number, number] {
  const rel = mod12(Math.round(p) - k.tonic);
  const f = mod12(rel * 7);
  const signed = f <= 6 ? f : f - 12;
  let u = 0.5 + (k.dir * signed) / 13;
  if (!k.inKey.has(rel)) u = (u + 0.5) % 1;
  const x = Math.max(0, Math.min(1, u)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const t = x - i;
  const a = stops[i];
  const b = stops[Math.min(stops.length - 1, i + 1)];
  const reg = Math.max(0, Math.min(1, (p - 40) / 44));
  const lift = 0.82 + 0.36 * reg;
  return [0, 1, 2].map((c) => Math.max(0, Math.min(1, ((a[c] + (b[c] - a[c]) * t) / 255) * lift))) as [number, number, number];
}

/** The harmony colour of a pitch as HSL (h in degrees, s and l 0..1). */
export function harmonyHsl(p: number, k: HarmonyKey): [number, number, number] {
  const rel = mod12(Math.round(p) - k.tonic);
  const f = mod12(rel * 7); // steps round the circle of fifths from the tonic
  const signed = f <= 6 ? f : f - 12;
  const inKey = k.inKey.has(rel);
  const h = inKey ? k.anchor + k.dir * signed * k.step : k.anchor + k.out + k.dir * signed * OUT_STEP;
  const reg = Math.max(0, Math.min(1, (p - 40) / 44));
  const s = Math.min(1, inKey ? k.sat : k.sat + 0.12);
  const l = k.dark ? 0.4 + 0.12 * k.light + k.lspan * reg : 0.3 + 0.1 * k.light + (k.lspan * 0.8) * reg;
  return [((h % 360) + 360) % 360, s, l];
}

export function harmonyCss(p: number, k: HarmonyKey): string {
  if (k.stops && k.stops.length) {
    const [r, g, b] = paletteRgb(p, k, k.stops);
    return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
  }
  const [h, s, l] = harmonyHsl(p, k);
  return `hsl(${h.toFixed(1)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
}

export function harmonyRgb(p: number, k: HarmonyKey): [number, number, number] {
  if (k.stops && k.stops.length) return paletteRgb(p, k, k.stops);
  const [h, s, l] = harmonyHsl(p, k);
  const f = (n: number) => {
    const q = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(q - 3, 9 - q, 1));
  };
  return [f(0), f(8), f(4)];
}

/** The key at a moment of the piece (follows modulations: the sounding chord's key). */
export function harmonyKeyAt(score: Score, t: number, dark: boolean): HarmonyKey {
  const th = score.config.theme;
  let k = 0;
  while (k + 1 < score.chords.length && score.chords[k + 1].t <= t) k++;
  const c = score.chords[k];
  return harmonyKey(c ? c.tonic : score.keyPc, c ? c.scale : score.config.scale, th.accent, th.ink, dark, th.background, paletteStops(th));
}
