/** Visual themes for the canvas (and exported video). Pure data so configs can embed them. */

export type FontId =
  | 'inter'
  | 'space-grotesk'
  | 'ibm-plex-sans'
  | 'ibm-plex-mono'
  | 'jetbrains-mono'
  | 'fraunces'
  | 'playfair'
  | 'pirata-one'
  | 'cinzel'
  | 'syne'
  | 'major-mono-display'
  | 'vt323'
  | 'bebas-neue'
  | 'space-mono';
/** none = one colour · voice = a hue per voice, bass to top · pitch = a hue per pitch class (circle of fifths) · register = gradient by height */
export type ColorBy = 'none' | 'voice' | 'pitch' | 'register' | 'harmony';

export interface Theme {
  /** Name of the preset this came from, or "custom" once edited. */
  preset: string;
  background: string;
  /** Second background colour for a top-to-bottom gradient (used when `gradient`). */
  background2: string;
  gradient: boolean;
  /** Line colour. */
  ink: string;
  /** Melody colour. */
  accent: string;
  /** Labels, HUD and titles. */
  text: string;
  /** Lights: lit windows and other glows in the picture views (night city, comets). */
  lights: string;
  font: FontId;
  /** Line thickness multiplier. */
  lineWidth: number;
  colorBy: ColorBy;
  /** Named palette for coloured lines (see PALETTES), used when colorSeed is 0. */
  palette: string;
  /** Rolled palette (the 🎲 next to the colours): non-zero overrides `palette`. */
  colorSeed: number;
  /** 0..1 glow around lines. */
  glow: number;
  /** Faint octave lines with note names. */
  grid: boolean;
  /** Dots emit an expanding ring when they land on a note (and on pluck strikes). */
  ripples: boolean;
  hud: boolean;
  labels: boolean;
}

export const FONT_NAMES: Record<FontId, string> = {
  inter: 'Inter',
  'space-grotesk': 'Space Grotesk',
  'ibm-plex-sans': 'IBM Plex Sans',
  'ibm-plex-mono': 'IBM Plex Mono',
  'jetbrains-mono': 'JetBrains Mono',
  fraunces: 'Fraunces',
  playfair: 'Playfair Display',
  'pirata-one': 'Pirata One',
  cinzel: 'Cinzel',
  syne: 'Syne',
  'major-mono-display': 'Major Mono Display',
  vt323: 'VT323',
  'bebas-neue': 'Bebas Neue',
  'space-mono': 'Space Mono',
};

/**
 * Palettes for coloured lines, as colour stops from the bass (or first pitch class) to the top.
 * "rainbow" is the hue wheel; "duotone" and "mono" are built from the theme's own ink and accent.
 */
export const PALETTES: Record<string, string[]> = {
  rainbow: [],
  duotone: [],
  mono: [],
  ember: ['#3a0b08', '#8a1a0e', '#d4471c', '#ff9a3c', '#ffe1a1'],
  bruise: ['#2a1240', '#5a1f6e', '#9a2d75', '#d2577a', '#f4a37f'],
  tide: ['#0b3b52', '#11707f', '#2fa39a', '#86d8c3', '#e6fff7'],
  acid: ['#d4ff00', '#00ff9c', '#00c3ff', '#ff00e1'],
  'blood moon': ['#4a0008', '#8c0015', '#c8002a', '#ff3355', '#ffa3b1'],
  moss: ['#26381a', '#4d6b2a', '#87a447', '#c9d98f', '#f1f4d8'],
  ghost: ['#6b7080', '#a0a8b8', '#d3d9e4', '#ffffff'],
  oil: ['#2f1b69', '#1b6f8c', '#2fb39a', '#c8e04b', '#ff6b9a'],
  candy: ['#ff5fa2', '#ffb86b', '#fff36b', '#6bffb8', '#6bc7ff', '#b06bff'],
  rust: ['#3b2a20', '#7a3f22', '#b8642c', '#d9a05b', '#efd9a8'],
  frost: ['#1d2a6b', '#3456c7', '#6aa6ff', '#bfe3ff', '#ffffff'],
};

export const PALETTE_LABELS: Record<string, string> = {
  rainbow: 'Rainbow',
  duotone: 'Duotone (ink → accent)',
  mono: 'Mono (shades of ink)',
  ember: 'Ember',
  bruise: 'Bruise',
  tide: 'Tide',
  acid: 'Acid',
  'blood moon': 'Blood moon',
  moss: 'Moss',
  ghost: 'Ghost',
  oil: 'Oil slick',
  candy: 'Candy',
  rust: 'Rust',
  frost: 'Frost',
};

const base: Omit<Theme, 'preset' | 'background' | 'ink' | 'accent' | 'text'> = {
  background2: '#ffffff',
  gradient: false,
  lights: '#ffbe60',
  font: 'inter',
  lineWidth: 1,
  colorBy: 'none',
  palette: 'rainbow',
  colorSeed: 0,
  glow: 0,
  grid: false,
  ripples: true,
  hud: true,
  labels: true,
};

export const THEME_PRESETS: Record<string, Theme> = {
  paper: { ...base, preset: 'paper', background: '#fafbf9', ink: '#0b0b0b', accent: '#c8442b', text: '#1a1a1a' },
  sepia: { ...base, preset: 'sepia', background: '#f2e9d8', ink: '#2b2118', accent: '#a23e1c', text: '#3a2c20', font: 'fraunces' },
  midnight: { ...base, preset: 'midnight', background: '#0e1116', ink: '#e8e6e1', accent: '#f0a35e', text: '#c9c6bf' },
  neon: {
    ...base,
    preset: 'neon',
    background: '#07060d',
    background2: '#1a0b2e',
    gradient: true,
    ink: '#7cf8ff',
    accent: '#ff4fd8',
    text: '#b8f6ff',
    font: 'space-grotesk',
    colorBy: 'register',
    glow: 0.8,
  },
  blueprint: { ...base, preset: 'blueprint', background: '#123a6b', ink: '#e9f1ff', accent: '#ffd166', text: '#cfe0ff', font: 'ibm-plex-mono', grid: true, lineWidth: 0.8 },
  terminal: { ...base, preset: 'terminal', background: '#050a05', ink: '#3dff7a', accent: '#ffd23d', text: '#3dff7a', font: 'jetbrains-mono', glow: 0.45, lineWidth: 0.9 },
  chromatic: { ...base, preset: 'chromatic', background: '#fbfaf7', ink: '#111111', accent: '#111111', text: '#222222', colorBy: 'pitch', lineWidth: 1.25 },
  sunset: {
    ...base,
    preset: 'sunset',
    background: '#ffd7a8',
    background2: '#ff7096',
    gradient: true,
    ink: '#2d1b3d',
    accent: '#ffffff',
    text: '#2d1b3d',
    font: 'playfair',
  },
  hex: {
    ...base,
    preset: 'hex',
    background: '#050505',
    background2: '#1c0010',
    gradient: true,
    ink: '#cfcfcf',
    accent: '#c3002f',
    text: '#8f8f8f',
    font: 'ibm-plex-mono',
    glow: 0.3,
    lineWidth: 0.9,
  },
  vigil: {
    ...base,
    preset: 'vigil',
    background: '#08070a',
    background2: '#1d0b14',
    gradient: true,
    ink: '#e9dccb',
    accent: '#b3002d',
    text: '#a8998a',
    font: 'pirata-one',
    glow: 0.25,
  },
  cathode: { ...base, preset: 'cathode', background: '#070b07', ink: '#9cff57', accent: '#ff3d7f', text: '#7fd94a', font: 'vt323', glow: 0.6, lineWidth: 1.1 },
  ossuary: { ...base, preset: 'ossuary', background: '#ece6da', ink: '#1c1814', accent: '#6b0f1a', text: '#2b241e', font: 'cinzel', lineWidth: 0.85 },
  tidepool: {
    ...base,
    preset: 'tidepool',
    background: '#031017',
    background2: '#06303a',
    gradient: true,
    ink: '#bff6ff',
    accent: '#ffcf5a',
    text: '#9fdbe6',
    font: 'syne',
    colorBy: 'voice',
    palette: 'tide',
    glow: 0.35,
  },
  bubblegum: {
    ...base,
    preset: 'bubblegum',
    background: '#ffe3f1',
    ink: '#3b1f5c',
    accent: '#ff2e88',
    text: '#3b1f5c',
    font: 'major-mono-display',
    colorBy: 'voice',
    palette: 'candy',
    lineWidth: 1.3,
  },
  eclipse: {
    ...base,
    preset: 'eclipse',
    background: '#000000',
    ink: '#f5f5f5',
    accent: '#ff9f1c',
    text: '#bdbdbd',
    font: 'bebas-neue',
    colorBy: 'register',
    palette: 'ember',
    glow: 0.5,
  },
  ultraviolet: {
    ...base,
    preset: 'ultraviolet',
    background: '#0b0221',
    background2: '#2b0a4a',
    gradient: true,
    ink: '#e7d9ff',
    accent: '#39ff14',
    text: '#c9b5ff',
    font: 'space-mono',
    colorBy: 'pitch',
    palette: 'oil',
    glow: 0.7,
  },
  moth: { ...base, preset: 'moth', background: '#191714', ink: '#cbbf9f', accent: '#e0b74f', text: '#a59a80', font: 'fraunces', lineWidth: 0.8 },
  static: { ...base, preset: 'static', background: '#f4f4f0', ink: '#000000', accent: '#0047ff', text: '#111111', font: 'space-mono', grid: true, lineWidth: 0.7 },
  bruise: {
    ...base,
    preset: 'bruise',
    background: '#12091c',
    ink: '#f0d9e8',
    accent: '#ff5c8a',
    text: '#c7a9bd',
    font: 'syne',
    colorBy: 'voice',
    palette: 'bruise',
    glow: 0.4,
  },
  hollow: { ...base, preset: 'hollow', background: '#050505', ink: '#6e6e6e', accent: '#ffffff', text: '#7a7a7a', font: 'major-mono-display', lineWidth: 0.8 },
  frostbite: {
    ...base,
    preset: 'frostbite',
    background: '#060a1a',
    ink: '#dfeaff',
    accent: '#ff4f4f',
    text: '#9fb3df',
    font: 'cinzel',
    colorBy: 'register',
    palette: 'frost',
    glow: 0.45,
  },
};

/** A random theme: background (mostly dark), contrasting ink, an accent, a font, maybe a palette and gradient. */
export function randomTheme(r: () => number): Theme {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const hex = (h: number, s: number, l: number) => {
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(255 * c)
        .toString(16)
        .padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  const dark = r() < 0.72;
  const hue = r() * 360;
  const bgSat = 10 + r() * 45;
  const background = dark ? hex(hue, bgSat, 2 + r() * 7) : hex(hue, bgSat * 0.8, 88 + r() * 8);
  const gradient = r() < 0.45;
  const background2 = dark ? hex((hue + (r() - 0.5) * 80 + 360) % 360, bgSat + 15, 8 + r() * 10) : hex((hue + 30) % 360, bgSat, 78 + r() * 10);
  const inkHue = r() < 0.5 ? hue : (hue + 180) % 360;
  const ink = dark ? hex(inkHue, 10 + r() * 50, 78 + r() * 18) : hex(inkHue, 20 + r() * 50, 6 + r() * 14);
  const accent = hex((hue + 120 + r() * 120) % 360, 70 + r() * 30, dark ? 55 + r() * 10 : 42 + r() * 10);
  const text = dark ? hex(inkHue, 10 + r() * 20, 60 + r() * 20) : hex(inkHue, 10 + r() * 20, 12 + r() * 14);
  const colorBy = pick(['none', 'none', 'voice', 'pitch', 'register'] as const);
  const named = Object.keys(PALETTES).filter((k) => k !== 'rainbow');
  return {
    ...base,
    preset: 'custom',
    background,
    background2,
    gradient,
    ink,
    accent,
    text,
    // Derived (no extra random draw, so word songs keep every other choice): warm, bright, near the theme's hue.
    lights: hex((hue + 40) % 360, 90, dark ? 66 : 52),
    font: pick(Object.keys(FONT_NAMES) as FontId[]),
    colorBy,
    palette: pick(named),
    colorSeed: colorBy !== 'none' && r() < 0.35 ? 1 + Math.floor(r() * 0x7ffffffe) : 0,
    glow: dark && r() < 0.6 ? Math.round(r() * 8) / 10 : 0,
    lineWidth: Math.round((0.7 + r() * 0.7) * 20) / 20,
    grid: r() < 0.2,
  };
}

export const THEME_LABELS: Record<string, string> = {
  paper: 'Paper',
  sepia: 'Sepia',
  midnight: 'Midnight',
  neon: 'Neon',
  blueprint: 'Blueprint',
  terminal: 'Terminal',
  chromatic: 'Chromatic',
  sunset: 'Sunset',
  hex: 'Hex',
  vigil: 'Vigil',
  cathode: 'Cathode',
  ossuary: 'Ossuary',
  tidepool: 'Tidepool',
  bubblegum: 'Bubblegum',
  eclipse: 'Eclipse',
  ultraviolet: 'Ultraviolet',
  moth: 'Moth',
  static: 'Static',
  bruise: 'Bruise',
  hollow: 'Hollow',
  frostbite: 'Frostbite',
};
