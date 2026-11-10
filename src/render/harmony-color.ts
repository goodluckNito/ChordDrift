/**
 * Harmony colours: colour that follows the key, so intervals read as colour relations without
 * every chord turning into a rainbow.
 *
 * - The key's notes are one family of neighbouring hues around an anchor (the theme's accent):
 *   each step round the circle of fifths from the tonic shifts the hue a little, so a fifth is a
 *   close shade, a tonic chord a tight family, and the diatonic colours never span more than a
 *   third of the wheel.
 * - Notes outside the key (borrowed notes, chromatic tension) jump across to the complementary
 *   hue, so they pop against the family.
 * - Higher notes are lighter, lower ones deeper.
 */
import type { Score } from '../engine/score';
import { mod12, scaleSteps } from '../engine/theory';

const FIFTH_STEP = 16; // degrees of hue per step round the circle of fifths, inside the key
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
}

export function harmonyKey(tonic: number, scale: string, accent: string, ink: string, dark: boolean): HarmonyKey {
  return { tonic: mod12(tonic), inKey: new Set(scaleSteps(scale).map(mod12)), anchor: anchorHue(accent, ink), dark };
}

/** The harmony colour of a pitch as HSL (h in degrees, s and l 0..1). */
export function harmonyHsl(p: number, k: HarmonyKey): [number, number, number] {
  const rel = mod12(Math.round(p) - k.tonic);
  const f = mod12(rel * 7); // steps round the circle of fifths from the tonic
  const signed = f <= 6 ? f : f - 12;
  const inKey = k.inKey.has(rel);
  const h = inKey ? k.anchor + signed * FIFTH_STEP : k.anchor + 180 + signed * OUT_STEP;
  const reg = Math.max(0, Math.min(1, (p - 40) / 44));
  const s = inKey ? 0.8 : 0.95;
  const l = k.dark ? 0.46 + 0.22 * reg : 0.34 + 0.18 * reg;
  return [((h % 360) + 360) % 360, s, l];
}

export function harmonyCss(p: number, k: HarmonyKey): string {
  const [h, s, l] = harmonyHsl(p, k);
  return `hsl(${h.toFixed(1)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
}

export function harmonyRgb(p: number, k: HarmonyKey): [number, number, number] {
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
  return harmonyKey(c ? c.tonic : score.keyPc, c ? c.scale : score.config.scale, th.accent, th.ink, dark);
}
