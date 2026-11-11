/** Line palettes as colour stops (shared by the renderer and the harmony colours). */
import { mulberry32 } from '../engine/rng';
import { PALETTES, type Theme } from '../engine/themes';

function rgbOf(hex: string): [number, number, number] {
  const n = /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0x808080;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Colour stops for the line palette, or null for the hue wheel (rainbow). A rolled palette
 * (colorSeed) is one of: a dark-to-bright ramp in one hue family, a duotone, or a split scheme.
 */
export function paletteStops(th: Theme): [number, number, number][] | null {
  if (th.colorSeed) {
    const r = mulberry32(th.colorSeed);
    const h0 = r() * 360;
    const kind = r();
    const sat = 45 + r() * 50;
    const hues = kind < 0.4 ? [h0, h0 + 15 + r() * 30, h0 + 30 + r() * 40] : kind < 0.75 ? [h0, h0 + 140 + r() * 80] : [h0, h0 + 100 + r() * 40, h0 + 200 + r() * 40];
    const n = hues.length;
    return hues.map((h, i) => hslRgb(h % 360, sat - 10 * (1 - i / Math.max(1, n - 1)), 22 + (56 * i) / Math.max(1, n - 1) + (r() - 0.5) * 8));
  }
  const name = th.palette ?? 'rainbow';
  if (name === 'rainbow' || !(name in PALETTES)) return null;
  if (name === 'duotone') return [rgbOf(th.ink), rgbOf(th.accent)];
  if (name === 'mono') {
    const ink = rgbOf(th.ink);
    const bg = rgbOf(th.background);
    const mix = (f: number) => ink.map((c, i) => c * f + bg[i] * (1 - f)) as [number, number, number];
    return [mix(0.35), mix(0.65), ink];
  }
  return PALETTES[name].map(rgbOf);
}

function hslRgb(h: number, s: number, l: number): [number, number, number] {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

