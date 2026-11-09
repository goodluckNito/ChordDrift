/** Visual themes for the canvas (and exported video). Pure data so configs can embed them. */

export type FontId = 'inter' | 'space-grotesk' | 'ibm-plex-sans' | 'ibm-plex-mono' | 'jetbrains-mono' | 'fraunces' | 'playfair';
/** none = one colour · voice = a hue per voice, bass to top · pitch = a hue per pitch class (circle of fifths) · register = gradient by height */
export type ColorBy = 'none' | 'voice' | 'pitch' | 'register';

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
  font: FontId;
  /** Line thickness multiplier. */
  lineWidth: number;
  colorBy: ColorBy;
  /** 0..1 glow around lines. */
  glow: number;
  /** Faint octave lines with note names. */
  grid: boolean;
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
};

const base: Omit<Theme, 'preset' | 'background' | 'ink' | 'accent' | 'text'> = {
  background2: '#ffffff',
  gradient: false,
  font: 'inter',
  lineWidth: 1,
  colorBy: 'none',
  glow: 0,
  grid: false,
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
};

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
};
