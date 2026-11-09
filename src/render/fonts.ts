/**
 * Fonts for the canvas. Inter ships with the app; the others are loaded on
 * demand (only Latin, 400 + 700), so choosing a theme font costs ~50 kB once.
 */
import { FONT_NAMES, type FontId } from '../engine/themes';

const loaders: Record<FontId, () => Promise<unknown>> = {
  inter: async () => {},
  'space-grotesk': () => Promise.all([import('@fontsource/space-grotesk/latin-400.css'), import('@fontsource/space-grotesk/latin-700.css')]),
  'ibm-plex-sans': () => Promise.all([import('@fontsource/ibm-plex-sans/latin-400.css'), import('@fontsource/ibm-plex-sans/latin-700.css')]),
  'ibm-plex-mono': () => Promise.all([import('@fontsource/ibm-plex-mono/latin-400.css'), import('@fontsource/ibm-plex-mono/latin-700.css')]),
  'jetbrains-mono': () => Promise.all([import('@fontsource/jetbrains-mono/latin-400.css'), import('@fontsource/jetbrains-mono/latin-700.css')]),
  fraunces: () => Promise.all([import('@fontsource/fraunces/latin-400.css'), import('@fontsource/fraunces/latin-700.css')]),
  playfair: () => Promise.all([import('@fontsource/playfair-display/latin-400.css'), import('@fontsource/playfair-display/latin-700.css')]),
  // Single-weight faces: the bold is synthesized.
  'pirata-one': () => import('@fontsource/pirata-one/latin-400.css'),
  cinzel: () => Promise.all([import('@fontsource/cinzel/latin-400.css'), import('@fontsource/cinzel/latin-700.css')]),
  syne: () => Promise.all([import('@fontsource/syne/latin-400.css'), import('@fontsource/syne/latin-700.css')]),
  'major-mono-display': () => import('@fontsource/major-mono-display/latin-400.css'),
  vt323: () => import('@fontsource/vt323/latin-400.css'),
  'bebas-neue': () => import('@fontsource/bebas-neue/latin-400.css'),
  'space-mono': () => Promise.all([import('@fontsource/space-mono/latin-400.css'), import('@fontsource/space-mono/latin-700.css')]),
};

const ready = new Map<FontId, Promise<void>>();

/** Load a font family (once) and wait until the canvas can use it. */
export function ensureFont(id: FontId): Promise<void> {
  if (!ready.has(id)) {
    const family = FONT_NAMES[id] ?? 'Inter';
    ready.set(
      id,
      (async () => {
        try {
          await (loaders[id] ?? loaders.inter)();
          await Promise.all(['400', '700'].map((w) => document.fonts.load(`${w} 32px "${family}"`)));
        } catch {
          /* fall back to system fonts */
        }
      })(),
    );
  }
  return ready.get(id)!;
}

export function fontStack(id: FontId): string {
  const family = FONT_NAMES[id] ?? 'Inter';
  const mono = id.includes('mono');
  return `"${family}", ${mono ? "ui-monospace, 'DejaVu Sans Mono', monospace" : "Inter, 'Helvetica Neue', Arial, sans-serif"}`;
}
