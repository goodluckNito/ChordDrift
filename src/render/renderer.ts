import type { ChordDriftConfig } from '../engine/config';
import { chordIndexAt, chordLabelAt, frequencyStats, hasDynamics, layerAt, levelAt, melodyAt, pitchAt, smootherstep, soundingPitches, strikeTimesBetween, voiceHits, widthFactor } from '../engine/motion';
import type { Score } from '../engine/score';
import { PALETTES, type ColorBy, type Theme } from '../engine/themes';
import { midiToHz, mod12 } from '../engine/theory';
import { fontStack } from './fonts';
import { mulberry32 } from '../engine/rng';
import { drawChladni, drawConstellation, type ViewArea, type ViewStyle } from './harmony-views';
import { drawFerro, drawMarbling, drawMurmuration, drawPendulums, drawTransit } from './novel-views';

/**
 * Pitch-versus-time plot with a moving camera. Everything is a pure function of
 * (score, t), so any frame can be rendered in any order — which is what makes
 * deterministic video export (t = frame / fps) possible.
 *
 * Layout fractions were measured from reference frames at 1080×1920 and scale
 * with the canvas size.
 */

/** Resolved drawing style for a frame, from the config's theme. */
interface Style {
  ink: string;
  accent: string;
  text: string;
  muted: string;
  font: string;
  lw: number;
  colorBy: ColorBy;
  glow: number;
  dark: boolean;
  /** Line palette as colour stops, or null for the rainbow wheel. */
  stops: [number, number, number][] | null;
}


/**
 * Colour stops for the line palette, or null for the hue wheel (rainbow). A rolled palette
 * (colorSeed) is one of: a dark-to-bright ramp in one hue family, a duotone, or a split scheme.
 */
function paletteStops(th: Theme): [number, number, number][] | null {
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

/** The colour at f (0..1) along the palette's stops. */
function stopColor(stops: [number, number, number][], f: number): string {
  if (stops.length === 1) return `rgb(${stops[0].map(Math.round).join(',')})`;
  const x = Math.max(0, Math.min(1, f)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const k = x - i;
  const c = stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * k));
  return `rgb(${c.join(',')})`;
}

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const luminance = (hex: string) => {
  const [r, g, b] = rgbOf(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};
const withAlpha = (hex: string, a: number) => `rgba(${rgbOf(hex).join(',')},${a})`;
/** Any of the colours themes produce (hex, rgb(), hsl()) with an alpha. */
const colorAlpha = (c: string, a: number) =>
  c.startsWith('#') ? withAlpha(c, a) : c.startsWith('rgb(') ? c.replace(/^rgb\(([^)]+)\)$/, `rgba($1,${a})`) : c.startsWith('hsl(') ? c.replace(/\)$/, ` / ${a})`) : c;

function styleOf(cfg: ChordDriftConfig): Style {
  const th = cfg.theme;
  return {
    ink: th.ink,
    accent: th.accent,
    text: th.text,
    muted: withAlpha(th.text, 0.78),
    font: fontStack(th.font),
    lw: th.lineWidth,
    colorBy: th.colorBy,
    glow: th.glow,
    dark: luminance(th.background) < 0.45,
    stops: paletteStops(th),
  };
}

/** The colour behind everything (for the page around the canvas). */
export function themeBackground(cfg: ChordDriftConfig): string {
  return cfg.theme.background;
}

const hsl = (h: number, st: Style) => `hsl(${((h % 360) + 360) % 360} 72% ${st.dark ? 66 : 44}%)`;
/** A colour per pitch class, ordered around the circle of fifths so related notes have related colours. */
const pitchColor = (p: number, st: Style) => {
  const step = mod12(Math.round(p) * 7);
  return st.stops ? stopColor(st.stops, step / 11) : hsl(step * 30, st);
};
/** A colour per voice, bass to top across the palette. */
const voiceColor = (v: number, V: number, st: Style) => (st.stops ? stopColor(st.stops, v / Math.max(1, V - 1)) : hsl(270 - (270 * v) / Math.max(1, V - 1), st));
/** Register colour at a height fraction 0 (bottom) … 1 (top). */
const registerColor = (f: number, st: Style) => (st.stops ? stopColor(st.stops, f) : hsl(260 - 250 * Math.max(0, Math.min(1, f)), st));

const LAYOUT = {
  titleY: 0.092,
  subtitleY: 0.116,
  /** Vertical band the current chord is framed into while playing. */
  bandTop: 0.282,
  bandBottom: 0.751,
  /** Band for the final zoomed-out view of the whole piece. */
  finalTop: 0.198,
  finalBottom: 0.785,
  finalLeft: 0.067,
  finalRight: 0.935,
  hudTop: 0.896,
  hudLine: 0.0188,
  hudLeft: 0.036,
  hudValue: 0.13,
  hudRight: 0.962,
  /** Lines are clipped to this vertical region so they never run under the text. */
  clipTop: 0.15,
  clipBottom: 0.875,
  /** Smallest pitch span the camera will frame, in semitones (keeps unison from zooming in forever). */
  minSpan: 12,
  /** How far back the camera smooths its framing (s). */
  cameraLag: 1.4,
};

/**
 * Pixel layout for a frame of any shape. Sizes scale with the frame's area
 * (so a 16:9 frame gets the same type size as a 9:16 one), and `textScale`
 * enlarges text for small on-screen previews. For 1080×1920 this reproduces
 * the original portrait layout exactly.
 */
interface FrameLayout {
  u: number;
  tu: number;
  titleY: number;
  subtitleY: number;
  clipTop: number;
  clipBottom: number;
  bandTop: number;
  bandBottom: number;
  finalTop: number;
  finalBottom: number;
  finalLeft: number;
  finalRight: number;
  hudRow: (i: number) => number;
  hudLeft: number;
  hudValue: number;
  hudRight: number;
  /** Seconds of history shown in the timeline (wider frames show more). */
  history: number;
}

function layoutFor(W: number, H: number, cfg: ChordDriftConfig, textScale: number): FrameLayout {
  const u = Math.sqrt((W * H) / (1080 * 1920));
  const tu = u * textScale;
  const hasTitle = Boolean(cfg.series.trim() || cfg.title.trim() || cfg.episode);
  const titleY = Math.max(LAYOUT.titleY * H, 84 * tu);
  const subtitleY = titleY + 46 * tu;
  const hudLine = 36 * tu;
  const hudBottom = Math.min(H - 50 * tu, (LAYOUT.hudTop + 3 * LAYOUT.hudLine) * H);
  const hudRow = (i: number) => hudBottom - (3 - i) * hudLine;
  const hudTop = hudRow(0) - 14 * tu;
  const clipTop = hasTitle ? Math.max(LAYOUT.clipTop * H, subtitleY + 26 * tu) : 0.06 * H;
  const clipBottom = cfg.theme.hud ? Math.min(LAYOUT.clipBottom * H, hudTop - 12 * tu) : 0.95 * H;
  const bandTop = Math.max(LAYOUT.bandTop * H, clipTop + 0.07 * H);
  const bandBottom = Math.max(bandTop + 0.2 * H, Math.min(LAYOUT.bandBottom * H, clipBottom - 0.06 * H));
  const aspect = W / H / (1080 / 1920);
  return {
    u,
    tu,
    titleY,
    subtitleY,
    clipTop,
    clipBottom,
    bandTop,
    bandBottom,
    finalTop: Math.max(LAYOUT.finalTop * H, clipTop + 10 * u),
    finalBottom: Math.min(LAYOUT.finalBottom * H, clipBottom - 10 * u),
    finalLeft: LAYOUT.finalLeft * W,
    finalRight: LAYOUT.finalRight * W,
    hudRow,
    hudLeft: LAYOUT.hudLeft * W,
    hudValue: LAYOUT.hudLeft * W + 101 * tu,
    hudRight: W - (1 - LAYOUT.hudRight) * W,
    history: cfg.video.historySeconds * Math.min(2.2, Math.max(1, Math.pow(aspect, 0.7))),
  };
}

interface Extent {
  lo: number;
  hi: number;
}

function instantExtent(score: Score, t: number): Extent {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of soundingPitches(score, t)) {
    if (p < lo) lo = p;
    if (p > hi) hi = p;
  }
  // Keep the melody in frame too (its register, so rests don't make the camera jump).
  if (score.melody.length && t >= score.gridStart) {
    const m = melodyAt(score, t);
    if (m) {
      hi = Math.max(hi, m.p);
      lo = Math.min(lo, m.p);
    }
  }
  return { lo, hi };
}

/**
 * Camera framing at time t: an exponentially weighted average of the voices'
 * extent over the last cameraLag seconds. A pure function of t (no state), so
 * scrubbing and exporting give identical frames.
 */
export function cameraExtent(score: Score, t: number): Extent {
  const samples = 28;
  let lo = 0;
  let hi = 0;
  let wsum = 0;
  for (let i = 0; i < samples; i++) {
    const age = (i / (samples - 1)) * LAYOUT.cameraLag;
    const w = Math.exp(-age / (LAYOUT.cameraLag * 0.35));
    const e = instantExtent(score, t - age);
    lo += e.lo * w;
    hi += e.hi * w;
    wsum += w;
  }
  lo /= wsum;
  hi /= wsum;
  // The smoothed frame lags; never let a voice that's here now (or arriving in the next half second)
  // fall outside it, or it slides off the band and gets cut at the edge.
  for (const ahead of [0, 0.25, 0.5]) {
    const e = instantExtent(score, t + ahead);
    if (Number.isFinite(e.lo)) lo = Math.min(lo, e.lo);
    if (Number.isFinite(e.hi)) hi = Math.max(hi, e.hi);
  }
  const span = Math.max(hi - lo, LAYOUT.minSpan);
  const mid = (lo + hi) / 2;
  return { lo: mid - span / 2, hi: mid + span / 2 };
}

/** Linear interpolation that tolerates an infinite target when x is 0 (endless pieces never zoom out). */
const lerp = (a: number, b: number, x: number) => (x <= 0 ? a : x >= 1 ? b : a + (b - a) * x);

function formatClock(t: number): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

/** Index of the first item whose [t, t + d) ends after `t`. Items are sorted and non-overlapping. */
function firstEndingAfter<T>(items: T[], t: number, start: (x: T) => number, dur: (x: T) => number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (start(items[mid]) + dur(items[mid]) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function traceVoice(
  ctx: CanvasPath,
  score: Score,
  v: number,
  tFrom: number,
  tTo: number,
  xOf: (t: number) => number,
  yOf: (p: number) => number,
  step: number,
) {
  const moves = score.moves[v];
  ctx.moveTo(xOf(tFrom), yOf(pitchAt(score, v, tFrom)));
  for (let i = firstEndingAfter(moves, tFrom, (m) => m.t0, (m) => m.d); i < moves.length && moves[i].t0 < tTo; i++) {
    const m = moves[i];
    const a = Math.max(m.t0, tFrom);
    const b = Math.min(m.t0 + m.d, tTo);
    ctx.lineTo(xOf(a), yOf(pitchAt(score, v, a)));
    const k = Math.max(4, Math.min(96, Math.ceil(Math.abs(xOf(b) - xOf(a)) / step)));
    for (let j = 1; j <= k; j++) {
      const t = a + ((b - a) * j) / k;
      ctx.lineTo(xOf(t), yOf(pitchAt(score, v, t)));
    }
  }
  ctx.lineTo(xOf(tTo), yOf(pitchAt(score, v, tTo)));
}

interface RibbonPoint {
  x: number;
  y: number;
  /** Half thickness at this point. */
  h: number;
}

/** Centre lines of ribbons, per fill path: the glow strokes these (far cheaper than stroking the outlines). */
const ribbonLines = new WeakMap<object, Path2D>();

/** Add a variable-width stroke to the current path (filled later, so overlaps merge). */
function ribbon(ctx: CanvasPath, pts: RibbonPoint[]) {
  const n = pts.length;
  if (n < 2) return;
  const line = ribbonLines.get(ctx);
  if (line) {
    // Glow only where the ribbon is thick (the recent, near part); faded tails don't need it
    // and glowing them paints a lot of pixels.
    let maxH = 0;
    for (const p of pts) maxH = Math.max(maxH, p.h);
    const min = maxH * 0.45;
    let pen = false;
    for (const p of pts) {
      if (p.h < min) pen = false;
      else if (!pen) {
        line.moveTo(p.x, p.y);
        pen = true;
      } else line.lineTo(p.x, p.y);
    }
  }
  const top: [number, number][] = [];
  const bot: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const p = pts[i];
    top.push([p.x + nx * p.h, p.y + ny * p.h]);
    bot.push([p.x - nx * p.h, p.y - ny * p.h]);
  }
  ctx.moveTo(top[0][0], top[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(top[i][0], top[i][1]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
  ctx.closePath();
  // Round the ends so full-width ends look like the normal strokes.
  for (const p of [pts[0], pts[n - 1]]) {
    if (p.h < 0.3) continue;
    ctx.moveTo(p.x + p.h, p.y);
    ctx.arc(p.x, p.y, p.h, 0, Math.PI * 2);
  }
}

/** Sample a voice's path over [a, b] at roughly `step` px, with a thickness function. */
function samplePath(
  score: Score,
  v: number,
  a: number,
  b: number,
  xOf: (t: number) => number,
  yOf: (p: number) => number,
  step: number,
  half: (t: number) => number,
  pitch: (t: number) => number = (t) => pitchAt(score, v, t),
  extra: number[] = [],
): RibbonPoint[] {
  const n = Math.max(2, Math.min(600, Math.ceil(Math.abs(xOf(b) - xOf(a)) / step)));
  const pts: RibbonPoint[] = [];
  const at = (t: number): RibbonPoint => ({ x: xOf(t), y: yOf(pitch(t)), h: half(t) });
  // Uniform samples plus any extra times (e.g. exactly at each pluck strike, so peaks aren't missed).
  const times: number[] = [];
  for (let i = 1; i <= n; i++) times.push(a + ((b - a) * i) / n);
  if (extra.length) {
    for (const e of extra) if (e > a && e < b) times.push(e);
    times.sort((x, y) => x - y);
  }
  let prevT = a;
  let prev = at(a);
  pts.push(prev);
  for (const t of times) {
    const cur = at(t);
    // Steep glides (the arrival in the zoomed-out view) need extra points, or
    // the ribbon's corners spike where the curve turns.
    const extra = Math.min(64, Math.floor(Math.abs(cur.y - prev.y) / step));
    for (let j = 1; j <= extra; j++) pts.push(at(prevT + ((t - prevT) * j) / (extra + 1)));
    pts.push(cur);
    prev = cur;
    prevT = t;
  }
  return pts;
}

/**
 * Release-&-swell transitions: each chord is drawn as its own set of lines
 * whose *thickness* follows its level — a new chord grows out of a point while
 * the previous one tapers away underneath, like hairpin dynamics. The bloom and
 * the arrival keep their glides.
 */
function traceCrossfades(
  score: Score,
  tFrom: number,
  tTo: number,
  xOf: (t: number) => number,
  yOf: (p: number) => number,
  u: number,
  paint: Painter,
) {
  const chords = score.chords;
  const V = score.config.voices;
  const half = 1.6 * u * paint.style.lw;
  // Before the bloom everything is the opening unison.
  if (chords.length === 0 || tFrom < chords[0].t) {
    const end = Math.min(tTo, chords[0]?.t ?? tTo);
    if (end > tFrom) {
      for (let v = 0; v < V; v++) ribbon(paint.fill(v, score.startNote), samplePath(score, v, tFrom, end, xOf, yOf, 8 * u, () => half));
    }
  }
  const first = Math.max(0, chordIndexAt(score, tFrom) - 1);
  for (let k = first; k < chords.length && chords[k].t < tTo; k++) {
    const c = chords[k];
    const L = (k % 2) as 0 | 1;
    const next = chords[k + 1];
    const last = k === chords.length - 1;
    const a = Math.max(c.t, tFrom);
    // Draw until fully released (or up to now for the newest chord).
    let b = tTo;
    if (next) {
      let end = next.t;
      while (end < tTo && layerAt(score, L, 0, end).g > 0.004) end += 0.04;
      b = Math.min(tTo, end);
    }
    if (b <= a) continue;
    const glides = k === 0 || (last && b > score.timeline.arrivalStart);
    for (let v = 0; v < V; v++) {
      const level = (t: number) => half * layerAt(score, L, v, t).g * widthFactor(score, v, t);
      const pitch = glides ? (t: number) => layerAt(score, L, v, t).p : () => c.notes[v];
      ribbon(paint.fill(v, c.notes[v]), samplePath(score, v, a, b, xOf, yOf, glides ? 3 * u : 5 * u, level, pitch));
    }
  }
}

/**
 * Collects paths by colour so each colour is drawn once (cheap), then paints
 * them with the theme's glow. Strokes are plain lines; fills are ribbons.
 */
class Painter {
  private strokes = new Map<string | CanvasGradient, Path2D>();
  private fills = new Map<string | CanvasGradient, Path2D>();
  private register: CanvasGradient | null = null;

  constructor(
    private ctx: CanvasRenderingContext2D,
    readonly style: Style,
    private V: number,
    private yTop: number,
    private yBottom: number,
  ) {}

  /** Colour for voice v at pitch p under the theme's colouring rule. */
  colorFor(v: number, p: number): string | CanvasGradient {
    const st = this.style;
    switch (st.colorBy) {
      case 'voice':
        return voiceColor(v, this.V, st);
      case 'pitch':
        return pitchColor(p, st);
      case 'register':
        if (!this.register) {
          const g = this.ctx.createLinearGradient(0, this.yBottom, 0, this.yTop);
          for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, registerColor(i / 6, st));
          this.register = g;
        }
        return this.register;
      default:
        return st.ink;
    }
  }

  /** Solid colour for a dot at height y (gradients can't colour single dots meaningfully). */
  dotColor(v: number, p: number, y: number): string {
    const c = this.colorFor(v, p);
    if (typeof c === 'string') return c;
    return registerColor((this.yBottom - y) / (this.yBottom - this.yTop), this.style);
  }

  stroke(v: number, p: number, color = this.colorFor(v, p)): Path2D {
    let path = this.strokes.get(color);
    if (!path) this.strokes.set(color, (path = new Path2D()));
    return path;
  }

  fill(v: number, p: number, color = this.colorFor(v, p)): Path2D {
    let path = this.fills.get(color);
    if (!path) {
      this.fills.set(color, (path = new Path2D()));
      if (this.style.glow > 0) ribbonLines.set(path, new Path2D());
    }
    return path;
  }

  /** Paint everything collected; `opacity` dims the whole batch (older spiral turns). */
  paint(lineWidth: number, opacity = 1) {
    const ctx = this.ctx;
    const glow = this.style.glow;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (glow > 0) {
      // Glow: wide, faint copies underneath.
      // A struggling preview keeps only the narrow pass (the wide one paints the most pixels).
      const passes: (readonly [number, number])[] = lite ? [[lineWidth * 3, 0.2]] : [[lineWidth * 6, 0.07], [lineWidth * 3, 0.16]];
      for (const [width, alpha] of passes) {
        ctx.globalAlpha = alpha * glow * opacity;
        ctx.lineWidth = width;
        for (const [color, path] of this.strokes) {
          ctx.strokeStyle = color;
          ctx.stroke(path);
        }
        for (const [color, path] of this.fills) {
          const line = ribbonLines.get(path);
          if (!line) continue;
          ctx.strokeStyle = color;
          ctx.stroke(line);
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = opacity;
    ctx.lineWidth = lineWidth;
    for (const [color, path] of this.strokes) {
      ctx.strokeStyle = color;
      ctx.stroke(path);
    }
    for (const [color, path] of this.fills) {
      ctx.fillStyle = color;
      ctx.fill(path);
    }
    ctx.globalAlpha = 1;
    this.strokes.clear();
    this.fills.clear();
  }
}

const RIPPLE_LIFE = 0.9;

/** 0..1: how much a dot is still swollen from landing on a note (a quick pop, ~0.4 s). */
function hitPop(score: Score, v: number, t: number): number {
  let pop = 0;
  for (const h of voiceHits(score, v, t - 0.4, t)) {
    if (h.strike) continue;
    const x = (t - h.t) / 0.4;
    pop = Math.max(pop, (1 - x) * (1 - x));
  }
  return pop;
}

/**
 * Expanding rings from a dot when its voice lands on a note (or is struck).
 * `pos(v)` gives the dot's current position, or null to skip that voice.
 */
function drawRipples(
  ctx: CanvasRenderingContext2D,
  score: Score,
  t: number,
  pos: (v: number) => { x: number; y: number; color: string } | null,
  radius: number,
  u: number,
) {
  if (!score.config.theme.ripples) return;
  ctx.save();
  ctx.lineWidth = Math.max(1, 1.8 * u);
  for (let v = 0; v < score.config.voices; v++) {
    const hits = voiceHits(score, v, t - RIPPLE_LIFE, t);
    if (!hits.length) continue;
    const at = pos(v);
    if (!at) continue;
    ctx.strokeStyle = at.color;
    // Strikes repeat fast; keep only the latest one so rings don't pile up.
    let lastStrike = -Infinity;
    for (const h of hits) if (h.strike) lastStrike = Math.max(lastStrike, h.t);
    for (const h of hits) {
      if (h.strike && h.t !== lastStrike) continue;
      const age = (t - h.t) / RIPPLE_LIFE;
      if (age < 0 || age > 1) continue;
      const grow = 1 - Math.pow(1 - age, 3); // ease out
      ctx.globalAlpha = (h.strike ? 0.35 : 0.6) * Math.pow(1 - age, 1.4);
      ctx.beginPath();
      ctx.arc(at.x, at.y, radius * (1 + grow * (h.strike ? 2.2 : 4.5)), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Sample times around each pluck strike in [a, b]: just before, at the peak, and as it decays. */
function strikeSamples(score: Score, a: number, b: number): number[] {
  const atk = score.config.audio.attack;
  const out: number[] = [];
  for (const s of strikeTimesBetween(score, a, b)) out.push(s - 0.0005, s + atk, s + atk + 0.03, s + atk + 0.09);
  return out;
}

/** Split a voice's path in [a, b] into held stretches and glides (for pitch colouring). */
function voiceSegments(score: Score, v: number, a: number, b: number): { a: number; b: number; p0: number; p1: number }[] {
  const out: { a: number; b: number; p0: number; p1: number }[] = [];
  const moves = score.moves[v];
  let t = a;
  for (let i = firstEndingAfter(moves, a, (m) => m.t0, (m) => m.d); i < moves.length && moves[i].t0 < b; i++) {
    const m = moves[i];
    const s = Math.max(m.t0, a);
    const e = Math.min(m.t0 + m.d, b);
    if (s > t) out.push({ a: t, b: s, p0: pitchAt(score, v, t), p1: pitchAt(score, v, t) });
    out.push({ a: s, b: e, p0: m.p0, p1: m.p1 });
    t = e;
  }
  if (b > t) out.push({ a: t, b, p0: pitchAt(score, v, t), p1: pitchAt(score, v, t) });
  return out;
}

function traceMelody(
  ctx: CanvasPath,
  score: Score,
  tFrom: number,
  tTo: number,
  xOf: (t: number) => number,
  yOf: (p: number) => number,
  step: number,
) {
  const notes = score.melody;
  const glideDefault = score.config.melody.glide;
  let pen = false;
  for (let i = firstEndingAfter(notes, tFrom, (n) => n.t, (n) => n.d); i < notes.length && notes[i].t < tTo; i++) {
    const n = notes[i];
    if (n.p === null) {
      pen = false;
      continue;
    }
    const prev = notes[i - 1];
    const legato = Boolean(prev && prev.p !== null && prev.t + prev.d >= n.t - 1e-6);
    const a = Math.max(n.t, tFrom);
    const b = Math.min(n.t + n.d, tTo) - 1e-6;
    const glideEnd = n.t + Math.min(n.glide ?? glideDefault, n.d * (n.glide ? 1 : 0.5));
    const pa = melodyAt(score, a)!.p;
    if (pen && legato) ctx.lineTo(xOf(a), yOf(pa));
    else ctx.moveTo(xOf(a), yOf(pa));
    if (a < glideEnd) {
      const g = Math.min(glideEnd, b);
      const k = Math.max(3, Math.min(48, Math.ceil(Math.abs(xOf(g) - xOf(a)) / step)));
      for (let j = 1; j <= k; j++) {
        const t = a + ((g - a) * j) / k;
        ctx.lineTo(xOf(t), yOf(melodyAt(score, t)!.p));
      }
    }
    ctx.lineTo(xOf(b), yOf(melodyAt(score, b)!.p));
    pen = true;
  }
}

/**
 * Spiral view. Pitch is wrapped around a spiral — one turn per octave (C at
 * the top), low pitches near the centre — so octaves line up and chord shapes
 * read like a clock diagram. Each voice leaves a trail that shrinks and rotates
 * as it ages, so held notes curl inward as logarithmic spirals and glides sweep
 * along the pitch spiral. The arrival collapses everything into one point.
 */
function drawSpiral(ctx: CanvasRenderingContext2D, score: Score, t: number, st: Style, lay: FrameLayout) {
  const u = lay.u;
  const tu = lay.tu;
  const { width: W, height: H } = ctx.canvas;
  const cfg = score.config;
  const th = cfg.theme;
  const V = cfg.voices;
  const cx = W / 2;
  const cy = (lay.bandTop + lay.bandBottom) / 2;
  const zoomIn = false; // the fly-through lives in drawTunnel
  // Zoom mode also pushes the camera in slowly over the piece (endless: a gentle, bounded drift).
  const tl = score.timeline;
  const progress = Number.isFinite(tl.arrivalEnd) ? Math.max(0, Math.min(1, t / tl.arrivalEnd)) : 1 - Math.exp(-t / 90);
  const push = zoomIn ? 1 + 0.22 * smootherstep(progress) : 1;
  const R = Math.min(W * 0.46, (lay.bandBottom - lay.bandTop) / 2 + 0.06 * H) * push;
  const cam = cameraExtent(score, t);
  const mid = (cam.lo + cam.hi) / 2;
  const span = Math.max(24, cam.hi - cam.lo + 4);
  const lo = mid - span / 2;
  const radiusOf = (p: number) => R * (0.16 + 0.84 * Math.max(0, Math.min(1.08, (p - lo) / span)));
  const angleOf = (p: number) => (p / 12) * Math.PI * 2 - Math.PI / 2 - (0 / 12) * Math.PI * 2;
  // Trails wind inward for several turns, each ring about half the size of the one outside it,
  // so the past reads as concentric rings closing in on the centre.
  const shrinkT = cfg.video.historySeconds * 1.8; // e-folding time of the shrink
  const history = shrinkT * 3.4; // down to ~3% of full size
  const turnT = cfg.rhythm.chords.trim() ? 8 * score.beat : 6; // one turn per two bars (or 6 s)
  const twist = (Math.PI * 2 * shrinkT) / turnT; // radians of rotation per shrinkT of age
  /**
   * Where a note heard `age` seconds ago is drawn. Inward: it shrinks toward the
   * centre. Zoom: it grows outward (as if we were flying into the spiral) and
   * tapers away, so the newest notes sit on the spiral and the past rushes past.
   */
  const at = (p: number, age: number) => {
    const grow = zoomIn ? Math.exp(age / (shrinkT * 0.75)) : Math.exp(-age / shrinkT);
    const fade = zoomIn ? Math.max(0, 1 - age / history) : grow;
    const r = radiusOf(p) * grow;
    const a = angleOf(p) + (age / shrinkT) * twist * (zoomIn ? -0.7 : 1);
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, s: zoomIn ? fade * Math.min(2.2, grow) : grow };
  };

  ctx.save();
  // No clip: trails run under the title and HUD (text gets a halo instead).

  // Guides: the pitch spiral itself and the twelve pitch-class spokes with names.
  ctx.save();
  ctx.strokeStyle = withAlpha(th.text, 0.1);
  ctx.lineWidth = Math.max(1, 1.2 * u);
  ctx.beginPath();
  for (let p = lo; p <= lo + span; p += 0.25) {
    const r = radiusOf(p);
    const a = angleOf(p);
    if (p === lo) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.stroke();
  ctx.fillStyle = withAlpha(th.text, 0.5);
  ctx.font = `500 ${17 * tu}px ${st.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  for (let pc = 0; pc < 12; pc++) {
    const a = angleOf(pc);
    ctx.fillText(names[pc], cx + Math.cos(a) * (R + 26 * tu), cy + Math.sin(a) * (R + 26 * tu));
  }
  ctx.restore();

  // Trails.
  const painter = new Painter(ctx, st, V, cy - R, cy + R);
  const half = 1.7 * u * st.lw;
  const crossfade = cfg.motion.transition === 'swell';
  const pitchFor = (v: number, time: number) => (crossfade ? soundingPitches(score, time)[v] : pitchAt(score, v, time));
  const samples = 110; // points per turn at full size
  /**
   * Sample a trail from oldest to newest. Fast pitch changes are subdivided so
   * curves stay curves; silent stretches (melody rests) break the trail.
   */
  const trail = (sample: (time: number) => { p: number; g: number }, width: number): RibbonPoint[][] => {
    const runs: RibbonPoint[][] = [];
    let run: RibbonPoint[] = [];
    let lastP = NaN;
    const push = (age: number) => {
      const { p, g } = sample(t - age);
      // Silence, or a jump (crossfaded chords change pitch instantly), starts a new run.
      if (g < 0.02 || Math.abs(p - lastP) > 1) {
        if (run.length > 1) runs.push(run);
        run = [];
      }
      lastP = p;
      if (g < 0.02) return;
      const q = at(p, age);
      run.push({ x: q.x, y: q.y, h: width * q.s * g });
    };
    // Fewer points on the small inner rings, more on the big outer ones.
    const ages: number[] = [];
    for (let age = history; age > 1e-6; age -= turnT / (24 + samples * Math.min(1, Math.exp(-age / shrinkT)))) ages.push(age);
    ages.push(0);
    for (const ts of strikeSamples(score, t - history, t)) if (ts <= t) ages.push(t - ts);
    ages.sort((x, y) => y - x);
    let prevAge = history;
    let prevP = sample(t - history).p;
    push(history);
    for (const age of ages) {
      const p = sample(t - age).p;
      const extra = Math.min(40, Math.floor(Math.abs(p - prevP) / 0.35));
      for (let j = 1; j <= extra; j++) push(prevAge + ((age - prevAge) * j) / (extra + 1));
      push(age);
      prevAge = age;
      prevP = p;
    }
    if (run.length > 1) runs.push(run);
    return runs;
  };
  for (let v = 0; v < V; v++) {
    if (crossfade) {
      // Each crossfading layer separately, at its own level: chords grow in and fade out.
      for (const L of [0, 1] as const) {
        const runs = trail((time) => {
          const st2 = layerAt(score, L, v, time);
          return { p: st2.p, g: st2.g * widthFactor(score, v, time) };
        }, half);
        for (const r of runs) ribbon(painter.fill(v, layerAt(score, L, v, t).p), r);
      }
    } else {
      const runs = trail((time) => ({ p: pitchFor(v, time), g: widthFactor(score, v, time) }), half);
      for (const r of runs) ribbon(painter.fill(v, pitchFor(v, t)), r);
    }
  }
  painter.paint(3.2 * u * st.lw);

  if (score.melody.length) {
    const runs = trail((time) => melodyAt(score, time) ?? { p: 0, g: 0 }, half * 1.1);
    for (const r of runs) ribbon(painter.fill(-1, 0, st.accent), r);
    painter.paint(3.2 * u * st.lw);
  }

  // The current chord as a shape (its notes joined in pitch order) and dots.
  // With crossfades, both layers are drawn at their levels, so nothing pops in.
  ctx.save();
  const dotR = 7 * u * Math.max(0.7, Math.min(1.8, st.lw));
  const layers: { pitches: number[]; g: number }[] = crossfade
    ? ([0, 1] as const).map((L) => ({ pitches: Array.from({ length: V }, (_, v) => layerAt(score, L, v, t).p), g: layerAt(score, L, 0, t).g }))
    : [{ pitches: soundingPitches(score, t), g: 1 }];
  for (const layer of layers) {
    if (layer.g < 0.01) continue;
    const pos = layer.pitches.map((p) => at(p, 0));
    ctx.globalAlpha = layer.g;
    ctx.strokeStyle = withAlpha(th.ink, 0.28);
    ctx.lineWidth = Math.max(1, 1.4 * u);
    ctx.beginPath();
    pos.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
    ctx.globalAlpha = 1;
    layer.pitches.forEach((p, v) => {
      ctx.fillStyle = painter.dotColor(v, p, pos[v].y);
      ctx.beginPath();
      ctx.arc(pos[v].x, pos[v].y, dotR * layer.g * Math.min(1.6, 0.45 + 0.55 * widthFactor(score, v, t)), 0, Math.PI * 2);
      ctx.fill();
    });
  }
  const lead = score.melody.length ? melodyAt(score, t) : null;
  if (lead && lead.g > 0.05) {
    const q = at(lead.p, 0);
    ctx.fillStyle = st.accent;
    ctx.beginPath();
    ctx.arc(q.x, q.y, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
  // Chord name in the middle.
  if (th.labels && cfg.video.centerLabel) {
    ctx.fillStyle = st.text;
    ctx.font = `700 ${34 * tu}px ${st.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8 * tu;
    ctx.strokeStyle = withAlpha(th.background, 0.85);
    ctx.strokeText(chordLabelAt(score, t), cx, cy);
    ctx.fillText(chordLabelAt(score, t), cx, cy);
  }
  ctx.restore();
  ctx.restore(); // plot clip
}

/**
 * Waterfall: a rotating 3D spectrograph. Each moment is a spectrum slice —
 * peaks at the voices' pitches, their height set by how loud each voice is —
 * and slices recede into depth over time, back-to-front with hidden lines
 * removed (like a mountain range). The camera sways slowly around the volume.
 */
function drawWaterfall(ctx: CanvasRenderingContext2D, score: Score, t: number, st: Style, lay: FrameLayout) {
  const { width: W } = ctx.canvas;
  const cfg = score.config;
  const V = cfg.voices;
  const u = lay.u;
  const crossfade = cfg.motion.transition === 'swell';

  // A square slab of raked lines, seen isometrically and turning slowly on its vertical
  // axis. Each line is one moment (the newest at the front edge of the slab); across it
  // runs pitch. Silence is flat floor; each voice raises a narrow ridge that runs back
  // through time, and nearer lines hide the ones behind them.
  const cam = cameraExtent(score, t);
  const mid = (cam.lo + cam.hi) / 2;
  const span = Math.max(30, cam.hi - cam.lo + 10);
  const lo = mid - span / 2;
  const hi = mid + span / 2;
  const DEPTH = Math.max(6, cfg.video.historySeconds * 1.6); // seconds of history
  const SLICES = 64;
  const POINTS = 180;
  const sigma = 0.8; // rolling humps (semitones)

  // Orthographic, fixed elevation (about 32°). The slab rocks ±54° around the front view (newest
  // line nearest) over a minute, rather than spinning: seen end-on the lines would hide their height.
  const yaw = Math.PI + 0.95 * Math.sin((t / 60) * Math.PI * 2);
  const elev = 0.56;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosE = Math.cos(elev);
  const sinE = Math.sin(elev);
  const bandH = lay.bandBottom - lay.bandTop;
  // The footprint's diagonal (2√2 world units) must fit the width; its depth plus the ridges the band.
  const k = Math.min((W * 0.86) / (2 * Math.SQRT2), bandH / (2 * Math.SQRT2 * sinE + 0.9 * cosE));
  const cx = W / 2;
  const cy = (lay.bandTop + lay.bandBottom) / 2 + 0.12 * k;
  // World: x ∈ [-1, 1] pitch, z ∈ [-1, 1] time (front = now), y up.
  const project = (x: number, y: number, z: number) => {
    const xr = x * cosY - z * sinY;
    const zr = x * sinY + z * cosY;
    return { x: cx + xr * k, y: cy - (y * cosE - zr * sinE) * k, depth: zr * cosE + y * sinE };
  };

  // Spectrum of one moment: a hump per voice (and the melody), heights by level.
  const spectrum = (tau: number): Float32Array => {
    const out = new Float32Array(POINTS + 1);
    const add = (p: number, amp: number) => {
      if (amp <= 0.003) return;
      const center = ((p - lo) / (hi - lo)) * POINTS;
      const reach = (3 * sigma * POINTS) / (hi - lo);
      for (let i = Math.max(0, Math.floor(center - reach)); i <= Math.min(POINTS, Math.ceil(center + reach)); i++) {
        const d = ((i - center) / POINTS) * (hi - lo);
        out[i] += amp * Math.exp(-(d * d) / (2 * sigma * sigma));
      }
    };
    for (let v = 0; v < V; v++) {
      const level = levelAt(score, v, tau);
      if (crossfade)
        for (const L of [0, 1] as const) {
          const sl = layerAt(score, L, v, tau);
          add(sl.p, sl.g * level);
        }
      else add(pitchAt(score, v, tau), level);
    }
    const m = score.melody.length ? melodyAt(score, tau) : null;
    if (m && m.g > 0) add(m.p, m.g);
    return out;
  };

  // Draw back to front: each line is filled down to the floor with the background, then stroked.
  // (Larger depth is nearer the viewer: lower on screen.)
  const slices = Array.from({ length: SLICES + 1 }, (_, i) => {
    const z = (i / SLICES) * 2 - 1;
    return { i, z, depth: project(0, 0, z).depth };
  }).sort((p, q) => p.depth - q.depth);
  ctx.save();
  ctx.lineJoin = 'round';
  // The slab's base: the two far edges go under the surface, the two near edges over it,
  // so wave heights read against a floor line.
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, z]) => project(x, 0, z));
  const edges = [0, 1, 2, 3].map((e) => ({ a: corners[e], b: corners[(e + 1) % 4], depth: (corners[e].depth + corners[(e + 1) % 4].depth) / 2 }));
  edges.sort((p, q) => p.depth - q.depth);
  const baseLine = (list: typeof edges) => {
    ctx.strokeStyle = withAlpha(st.ink, 0.55);
    ctx.lineWidth = Math.max(1, 1.2 * u * st.lw);
    ctx.beginPath();
    for (const e of list) {
      ctx.moveTo(e.a.x, e.a.y);
      ctx.lineTo(e.b.x, e.b.y);
    }
    ctx.stroke();
  };
  baseLine(edges.slice(0, 2));
  const heightScale = 0.3;
  const bg = cfg.theme.background;
  const style = st.colorBy === 'none' ? st.ink : null;
  for (const { i, z } of slices) {
    const tau = t - (i / SLICES) * DEPTH;
    const values = tau < 0 ? new Float32Array(POINTS + 1) : spectrum(tau);
    const line = new Path2D();
    const fill = new Path2D();
    for (let j = 0; j <= POINTS; j++) {
      const x = (j / POINTS) * 2 - 1;
      // Heights saturate, so stacked voices (a unison) rise to a crest instead of a wall.
      const q = project(x, (1 - Math.exp(-values[j] / 1.3)) * heightScale * 1.6, z);
      if (j === 0) {
        line.moveTo(q.x, q.y);
        fill.moveTo(q.x, q.y);
      } else {
        line.lineTo(q.x, q.y);
        fill.lineTo(q.x, q.y);
      }
    }
    const b1 = project(1, 0, z);
    const b0 = project(-1, 0, z);
    fill.lineTo(b1.x, b1.y);
    fill.lineTo(b0.x, b0.y);
    fill.closePath();
    ctx.fillStyle = bg;
    ctx.fill(fill);
    ctx.lineWidth = Math.max(1, (i === 0 ? 2 : 1.25) * u * st.lw);
    if (style) ctx.strokeStyle = style;
    else {
      const g = ctx.createLinearGradient(b0.x, b0.y, b1.x + 0.01, b1.y);
      for (let c = 0; c <= 8; c++) g.addColorStop(c / 8, st.colorBy === 'pitch' ? pitchColor(lo + ((hi - lo) * c) / 8, st) : registerColor(c / 8, st));
      ctx.strokeStyle = g;
    }
    ctx.stroke(line);
  }
  baseLine(edges.slice(2));
  ctx.restore();
}

/**
 * Orbit: one meaning per dimension. Rotation is time (one turn per bar with a
 * chord rhythm, otherwise every 8 s); distance from the centre is pitch, with
 * octave rings like staff lines; the past drifts inward. The present rides a
 * rotating hand, the chord stacked along it, and history becomes a spiral
 * galaxy where every interval change is a step in an arm (smooth for a glide)
 * that rotates around and sinks toward the centre.
 */
function drawOrbit(ctx: CanvasRenderingContext2D, score: Score, t: number, st: Style, lay: FrameLayout) {
  const { width: W, height: H } = ctx.canvas;
  const cfg = score.config;
  const th = cfg.theme;
  const V = cfg.voices;
  const u = lay.u;
  const tu = lay.tu;
  const cx = W / 2;
  const cy = (lay.bandTop + lay.bandBottom) / 2;
  const R = Math.min(W * 0.45, (lay.bandBottom - lay.bandTop) / 2 + 0.07 * H);

  // One revolution per bar (4 beats) when there's a chord rhythm, so changes on
  // the beat land at the same angles; otherwise a slow, steady 8 s per turn.
  const barTurn = cfg.rhythm.chords.trim() ? 4 * score.beat : 8;
  // Zooming needs a looser spiral (fewer turns per e-fold) or the arms wind into a blur.
  const period = cfg.video.spiral === 'orbit' ? Math.max(8, 2 * barTurn) : barTurn;
  const omega = (2 * Math.PI) / period;
  const angleAt = (tau: number) => -Math.PI / 2 + omega * tau;

  // Pitch → distance from the centre (camera-smoothed so the chord fills the disc).
  const cam = cameraExtent(score, t);
  const mid = (cam.lo + cam.hi) / 2;
  const span = Math.max(18, cam.hi - cam.lo + 3);
  const lo = mid - span / 2;
  const radial = (p: number) => R * (0.2 + 0.8 * Math.max(-0.1, Math.min(1.1, (p - lo) / span)));
  /**
   * zoom: a logarithmic spiral — scale grows exponentially with age, so the
   * future spirals out of the centre to meet its pitch ring at the present and
   * the past keeps expanding past you (on a log spiral, zooming in and rotating
   * are the same motion, so the two reinforce each other).
   * drain: the past shrinks into the centre instead.
   */
  const zoom = cfg.video.spiral === 'orbit';
  // Sized by turns: each ring is a fixed ratio bigger than the next (1.5× zooming, 1.45× draining),
  // so several turns stack up as concentric rings instead of one short arc.
  const sink = period / Math.log(zoom ? 1.5 : 1.45); // e-folding time
  // Three turns of history at most (13 voices × many turns was a wall of rings), and two of future.
  const memory = zoom ? sink * Math.log(1.8) : 2 * period; // how far back trails go
  // The future spirals in inside the present ring and interleaves with it, so only a short glimpse.
  const ahead = zoom ? Math.min(60, 0.75 * period) : 0; // how far ahead (zoom only)
  /**
   * The trail fades like a comet: brightness falls smoothly with age (to KEEP after one turn),
   * so the newest stretch reads clearly and older turns recede instead of stacking up at full
   * strength. Each whole turn is a batch painted at its starting opacity, with a conic gradient
   * around the centre carrying the fade within the turn (turns meet at the hand, so it's seamless).
   * Zooming, the future fades the same way ahead of the hand. Ages < 0 are the future.
   */
  const KEEP = 0.1;
  /** Ahead, it fades faster: the future is a hint of what's coming, not a second set of rings. */
  const KEEP_AHEAD = 0.08;
  const TURNS = Math.max(1, Math.ceil(Math.max(memory, ahead) / period));
  const turnOf = (age: number) => {
    const n = Math.min(TURNS - 1, Math.floor(Math.abs(age) / period));
    return age >= 0 ? n : -(n + 1);
  };
  const scaleAt = (age: number) => (zoom ? Math.exp(age / sink) : Math.exp(-age / sink));
  const at = (p: number, age: number) => {
    const s = scaleAt(age);
    const r = radial(p) * s;
    const a = angleAt(t - age);
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, s };
  };

  ctx.save();
  // Octave rings (like staff lines) with names on the upward axis, and the hand.
  ctx.strokeStyle = withAlpha(th.text, 0.1);
  ctx.fillStyle = withAlpha(th.text, 0.45);
  ctx.lineWidth = Math.max(1, 1.1 * u);
  ctx.font = `500 ${15 * tu}px ${st.font}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let n = Math.ceil(lo / 12) * 12; n <= lo + span; n += 12) {
    const r = radial(n);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(`C${n / 12 - 1}`, cx + 6 * tu, cy - r - 8 * tu);
  }
  const handA = angleAt(t);
  ctx.strokeStyle = withAlpha(th.text, 0.16);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(handA) * R * 1.15, cy + Math.sin(handA) * R * 1.15);
  ctx.stroke();
  if (zoom) {
    // Rings born in the centre on every beat (every second without a rhythm) that grow outward as you travel.
    // The trails already form concentric rings, so these mark bars (every 2 s without a rhythm).
    const step = cfg.rhythm.chords.trim() || score.strikes ? 4 * score.beat : 2;
    // Batched by brightness: a handful of strokes instead of one per ring.
    const BUCKETS = 4;
    const rings = Array.from({ length: BUCKETS }, () => new Path2D());
    for (let k = Math.floor((t - memory) / step); k * step < t + ahead; k++) {
      const age = t - k * step;
      const s = scaleAt(age);
      // Rings bigger than the frame are invisible but still cost a full trace on CPU canvases.
      if (s < 0.12 || s > 3.4 || R * 1.05 * s > Math.hypot(W, H) / 2) continue;
      const fade = Math.min(1, s * 2.5) * Math.min(1, (3.4 - s) / 1.2);
      const b = Math.min(BUCKETS - 1, Math.floor(fade * BUCKETS));
      rings[b].moveTo(cx + R * 1.05 * s, cy);
      rings[b].arc(cx, cy, R * 1.05 * s, 0, Math.PI * 2);
    }
    rings.forEach((path, b) => {
      ctx.strokeStyle = withAlpha(th.text, 0.08 * ((b + 0.5) / BUCKETS));
      ctx.stroke(path);
    });
  }

  // Trails: sampled from oldest to newest; quick pitch moves get extra points so
  // interval steps stay crisp curves; silences and instant jumps break the line.
  const painter = new Painter(ctx, st, V, cy - R, cy + R);
  const half = 1.8 * u * st.lw;
  const crossfade = cfg.motion.transition === 'swell';
  const samples = 120; // points per turn at full size
  const trail = (sample: (tau: number) => { p: number; g: number }, width: number): { pts: RibbonPoint[]; turn: number }[] => {
    const runs: { pts: RibbonPoint[]; turn: number }[] = [];
    let run: RibbonPoint[] = [];
    let runTurn = 0;
    let lastP = NaN;
    const push = (age: number) => {
      const { p, g } = sample(t - age);
      const turn = turnOf(age);
      if (g < 0.02 || Math.abs(p - lastP) > 1) {
        if (run.length > 1) runs.push({ pts: run, turn: runTurn });
        run = [];
      } else if (turn !== runTurn && run.length) {
        // Crossing into another turn: start a new run there, sharing the point so there's no gap.
        const last = run[run.length - 1];
        if (run.length > 1) runs.push({ pts: run, turn: runTurn });
        run = [last];
      }
      runTurn = turn;
      lastP = p;
      if (g < 0.02) return;
      const q = at(p, age);
      // Near = thick, far (centre) = thin; the past thins out as it leaves.
      const fade = zoom ? (age > 0 ? Math.max(0, 1 - age / memory) : 1) : 1;
      run.push({ x: q.x, y: q.y, h: width * (zoom ? Math.min(1.5, 0.15 + 0.85 * q.s) : 0.25 + 0.75 * q.s) * g * fade });
    };
    // Points per turn follow the ring's size: dense out where it's big, sparse in the small inner rings.
    const ages: number[] = [];
    const stepAt = (age: number) => period / (24 + samples * Math.min(1, scaleAt(age)));
    for (let age = memory; age > 1e-6; age -= stepAt(age)) ages.push(age);
    ages.push(0);
    // Zoom also draws the future, spiralling out of the centre toward the present.
    if (zoom) for (let age = -stepAt(0); age > -ahead; age -= stepAt(age)) ages.push(age);
    for (const ts of strikeSamples(score, t - memory, t + ahead)) ages.push(t - ts);
    ages.sort((x, y) => y - x);
    let prevAge = memory;
    let prevP = sample(t - memory).p;
    push(memory);
    for (const age of ages) {
      const p = sample(t - age).p;
      const extra = Math.min(40, Math.floor(Math.abs(p - prevP) / 0.3));
      for (let j = 1; j <= extra; j++) push(prevAge + ((age - prevAge) * j) / (extra + 1));
      push(age);
      prevAge = age;
      prevP = p;
    }
    if (run.length > 1) runs.push({ pts: run, turn: runTurn });
    return runs;
  };
  // One painter per turn (past and future), each painted at its own opacity.
  const past = Array.from({ length: TURNS }, () => new Painter(ctx, st, V, cy - R, cy + R));
  const future = Array.from({ length: TURNS }, () => new Painter(ctx, st, V, cy - R, cy + R));
  const handAngle = angleAt(t);
  const fades = new Map<string, CanvasGradient>();
  /** The colour with the within-turn fade: a conic gradient from the hand round (oldest → newest, or nearest → furthest ahead). */
  const faded = (color: string | CanvasGradient, ahead: boolean): string | CanvasGradient => {
    if (typeof color !== 'string' || typeof ctx.createConicGradient !== 'function') return color;
    const key = `${ahead ? '>' : '<'}${color}`;
    let g = fades.get(key);
    if (!g) {
      g = ctx.createConicGradient(handAngle, cx, cy);
      for (let i = 0; i <= 8; i++) {
        const f = i / 8;
        g.addColorStop(f, colorAlpha(color, ahead ? Math.pow(KEEP_AHEAD, f) : Math.pow(KEEP, 1 - f)));
      }
      fades.set(key, g);
    }
    return g;
  };
  const add = (turn: number, v: number, p: number, pts: RibbonPoint[], color?: string) => {
    const ahead = turn < 0;
    const painter = ahead ? future[-turn - 1] : past[turn];
    ribbon(painter.fill(v, p, faded(color ?? painter.colorFor(v, p), ahead)), pts);
  };
  for (let v = 0; v < V; v++) {
    if (crossfade) {
      for (const L of [0, 1] as const) {
        const runs = trail((tau) => {
          const sl = layerAt(score, L, v, tau);
          return { p: sl.p, g: sl.g * widthFactor(score, v, tau) };
        }, half);
        for (const r of runs) add(r.turn, v, layerAt(score, L, v, t).p, r.pts);
      }
    } else {
      const runs = trail((tau) => ({ p: pitchAt(score, v, tau), g: widthFactor(score, v, tau) }), half);
      for (const r of runs) add(r.turn, v, pitchAt(score, v, t), r.pts);
    }
  }
  if (score.melody.length) {
    const runs = trail((tau) => melodyAt(score, tau) ?? { p: 0, g: 0 }, half * 1.1);
    for (const r of runs) add(r.turn, -1, 0, r.pts, st.accent);
  }
  for (let n = TURNS - 1; n >= 0; n--) {
    future[n].paint(3.2 * u * st.lw, Math.pow(KEEP_AHEAD, n));
    past[n].paint(3.2 * u * st.lw, Math.pow(KEEP, n));
  }

  // The present: dots along the hand.
  const dotR = 7 * u * Math.max(0.7, Math.min(1.8, st.lw));
  const layers: { pitches: number[]; g: number }[] = crossfade
    ? ([0, 1] as const).map((L) => ({ pitches: Array.from({ length: V }, (_, v) => layerAt(score, L, v, t).p), g: layerAt(score, L, 0, t).g }))
    : [{ pitches: soundingPitches(score, t), g: 1 }];
  for (const layer of layers) {
    if (layer.g < 0.01) continue;
    layer.pitches.forEach((p, v) => {
      const q = at(p, 0);
      ctx.fillStyle = painter.dotColor(v, p, q.y);
      ctx.beginPath();
      ctx.arc(q.x, q.y, dotR * layer.g * Math.min(1.6, 0.45 + 0.55 * widthFactor(score, v, t)), 0, Math.PI * 2);
      ctx.fill();
    });
  }
  const lead = score.melody.length ? melodyAt(score, t) : null;
  if (lead && lead.g > 0.05) {
    const q = at(lead.p, 0);
    ctx.fillStyle = st.accent;
    ctx.beginPath();
    ctx.arc(q.x, q.y, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
  // Chord name in the eye of the spiral.
  if (th.labels && cfg.video.centerLabel) {
    ctx.fillStyle = st.text;
    ctx.font = `700 ${34 * tu}px ${st.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8 * tu;
    ctx.strokeStyle = withAlpha(th.background, 0.85);
    ctx.strokeText(chordLabelAt(score, t), cx, cy);
    ctx.fillText(chordLabelAt(score, t), cx, cy);
  }
  ctx.restore();
}

/**
 * Fly-through: depth is time. Every note sits in 3D at the moment it sounds, on
 * a pitch spiral (angle = pitch class, radius = height), and the camera moves
 * forward through time. Upcoming chords start small at the vanishing point and
 * rush toward you; the present is at full size; passed notes fly out past the
 * edges. Held notes become slowly twisting helices, glides swing a line into
 * its new interval as it approaches, and rings at every second and at chord
 * changes keep the forward motion palpable.
 */
function drawTunnel(ctx: CanvasRenderingContext2D, score: Score, t: number, st: Style, lay: FrameLayout) {
  const { width: W } = ctx.canvas;
  const cfg = score.config;
  const th = cfg.theme;
  const V = cfg.voices;
  const u = lay.u;
  const tu = lay.tu;
  const cx = W / 2;
  const cy = (lay.bandTop + lay.bandBottom) / 2;
  const R = Math.min(W * 0.42, (lay.bandBottom - lay.bandTop) / 2 + 0.04 * ctx.canvas.height);

  // Perspective: scale at time offset Δ = τ − t. 1 now, → 0 far ahead, large just behind.
  const Z = 2.4; // seconds of "depth" per unit distance — lower is faster travel
  const AHEAD = 12;
  const BEHIND = -0.62 * Z;
  const scaleAt = (d: number) => 1 / (1 + d / Z);
  const roll = (2 * Math.PI) / 26; // the tunnel twists slowly as you travel

  const cam = cameraExtent(score, t);
  const mid = (cam.lo + cam.hi) / 2;
  const span = Math.max(24, cam.hi - cam.lo + 4);
  const lo = mid - span / 2;
  const radial = (p: number) => R * (0.22 + 0.78 * Math.max(-0.15, Math.min(1.2, (p - lo) / span)));
  const angleOf = (p: number, tau: number) => (p / 12) * Math.PI * 2 - Math.PI / 2 + roll * (tau - t) * 0.6;
  const project = (p: number, tau: number) => {
    const s = scaleAt(tau - t);
    const r = radial(p) * s;
    const a = angleOf(p, tau);
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, s };
  };

  ctx.save();
  // No clip: lines run under the title and HUD (text gets a halo instead).

  // Rails: the twelve pitch classes converging on the vanishing point.
  ctx.strokeStyle = withAlpha(th.text, 0.07);
  ctx.lineWidth = Math.max(1, 1.1 * u);
  ctx.beginPath();
  for (let pc = 0; pc < 12; pc++) {
    for (let i = 0; i <= 24; i++) {
      const d = BEHIND + ((AHEAD - BEHIND) * i) / 24;
      const s = scaleAt(d);
      const a = (pc / 12) * Math.PI * 2 - Math.PI / 2 + roll * d * 0.6;
      const x = cx + Math.cos(a) * R * 1.05 * s;
      const y = cy + Math.sin(a) * R * 1.05 * s;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // Rings: every second (faint) and at each chord change (stronger), passing by.
  const ring = (d: number, alpha: number) => {
    const s = scaleAt(d);
    if (s <= 0 || s > 4) return;
    ctx.strokeStyle = withAlpha(th.text, alpha * Math.min(1, s * 1.4) * Math.min(1, (AHEAD - d) / 3));
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.05 * s, 0, Math.PI * 2);
    ctx.stroke();
  };
  for (let n = Math.ceil(t + BEHIND); n < t + AHEAD; n++) ring(n - t, 0.06);
  for (const c of score.chords) {
    const d = c.t - t;
    if (d > BEHIND && d < AHEAD) ring(d, 0.22);
  }

  // Voices: lines through time, thick when near, thin far away.
  const painter = new Painter(ctx, st, V, cy - R, cy + R);
  const half = 1.9 * u * st.lw;
  const crossfade = cfg.motion.transition === 'swell';
  // Sample uniformly in perspective scale, so points are dense where the screen moves fast.
  const sMin = scaleAt(AHEAD);
  const sMax = scaleAt(BEHIND);
  const N = 170;
  const offsets: number[] = [];
  for (let i = 0; i <= N; i++) {
    const s = sMin + ((sMax - sMin) * i) / N;
    offsets.push(Z * (1 / s - 1));
  }
  for (const ts of strikeSamples(score, t + BEHIND, t + AHEAD)) offsets.push(ts - t);
  offsets.sort((x, y) => y - x);
  const lineRuns = (sample: (tau: number) => { p: number; g: number }, width: number): RibbonPoint[][] => {
    const runs: RibbonPoint[][] = [];
    let run: RibbonPoint[] = [];
    let lastP = NaN;
    const push = (d: number) => {
      const tau = t + d;
      const { p, g } = sample(tau);
      if (g < 0.02 || Math.abs(p - lastP) > 1) {
        if (run.length > 1) runs.push(run);
        run = [];
      }
      lastP = p;
      if (g < 0.02) return;
      const q = project(p, tau);
      const fadeFar = Math.min(1, (AHEAD - d) / 4);
      run.push({ x: q.x, y: q.y, h: width * Math.min(3, q.s) * g * fadeFar });
    };
    let prevD = offsets[0];
    let prevP = sample(t + prevD).p;
    push(prevD);
    for (let i = 1; i < offsets.length; i++) {
      const d = offsets[i];
      const p = sample(t + d).p;
      const extra = Math.min(40, Math.floor(Math.abs(p - prevP) / 0.35));
      for (let j = 1; j <= extra; j++) push(prevD + ((d - prevD) * j) / (extra + 1));
      push(d);
      prevD = d;
      prevP = p;
    }
    if (run.length > 1) runs.push(run);
    return runs;
  };
  for (let v = 0; v < V; v++) {
    if (crossfade) {
      for (const L of [0, 1] as const) {
        const runs = lineRuns((tau) => {
          const sl = layerAt(score, L, v, tau);
          return { p: sl.p, g: sl.g * widthFactor(score, v, tau) };
        }, half);
        for (const r of runs) ribbon(painter.fill(v, layerAt(score, L, v, t).p), r);
      }
    } else {
      const runs = lineRuns((tau) => ({ p: pitchAt(score, v, tau), g: widthFactor(score, v, tau) }), half);
      for (const r of runs) ribbon(painter.fill(v, pitchAt(score, v, t)), r);
    }
  }
  painter.paint(3.2 * u * st.lw);
  if (score.melody.length) {
    const runs = lineRuns((tau) => melodyAt(score, tau) ?? { p: 0, g: 0 }, half * 1.1);
    for (const r of runs) ribbon(painter.fill(-1, 0, st.accent), r);
    painter.paint(3.2 * u * st.lw);
  }

  // The present: the chord's shape and dots at full size.
  const dotR = 7 * u * Math.max(0.7, Math.min(1.8, st.lw));
  const layers: { pitches: number[]; g: number }[] = crossfade
    ? ([0, 1] as const).map((L) => ({ pitches: Array.from({ length: V }, (_, v) => layerAt(score, L, v, t).p), g: layerAt(score, L, 0, t).g }))
    : [{ pitches: soundingPitches(score, t), g: 1 }];
  for (const layer of layers) {
    if (layer.g < 0.01) continue;
    const pos = layer.pitches.map((p) => project(p, t));
    ctx.globalAlpha = layer.g;
    ctx.strokeStyle = withAlpha(th.ink, 0.3);
    ctx.lineWidth = Math.max(1, 1.4 * u);
    ctx.beginPath();
    pos.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
    ctx.globalAlpha = 1;
    layer.pitches.forEach((p, v) => {
      ctx.fillStyle = painter.dotColor(v, p, pos[v].y);
      ctx.beginPath();
      ctx.arc(pos[v].x, pos[v].y, dotR * layer.g * Math.min(1.6, 0.45 + 0.55 * widthFactor(score, v, t)), 0, Math.PI * 2);
      ctx.fill();
    });
  }
  const lead = score.melody.length ? melodyAt(score, t) : null;
  if (lead && lead.g > 0.05) {
    const q = project(lead.p, t);
    ctx.fillStyle = st.accent;
    ctx.beginPath();
    ctx.arc(q.x, q.y, dotR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Note names around the present ring, and the chord name at the vanishing point.
  ctx.fillStyle = withAlpha(th.text, 0.5);
  ctx.font = `500 ${17 * tu}px ${st.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  for (let pc = 0; pc < 12; pc++) {
    const a = angleOf(pc, t);
    ctx.fillText(names[pc], cx + Math.cos(a) * (R * 1.05 + 24 * tu), cy + Math.sin(a) * (R * 1.05 + 24 * tu));
  }
  if (th.labels && cfg.video.centerLabel) {
    ctx.fillStyle = st.text;
    ctx.font = `700 ${34 * tu}px ${st.font}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8 * tu;
    ctx.strokeStyle = withAlpha(th.background, 0.85);
    ctx.strokeText(chordLabelAt(score, t), cx, cy);
    ctx.fillText(chordLabelAt(score, t), cx, cy);
  }
  ctx.restore();
}

export interface RenderOptions {
  /** Override the frame number shown in the HUD (defaults to round(t × fps)). */
  frame?: number;
  /** Enlarge text (labels, HUD, titles) — used so small previews stay readable. Exports use 1. */
  textScale?: number;
  /** Cheaper drawing for a struggling live preview (lighter glow). Exports never set it. */
  lite?: boolean;
}

/** Set per frame from RenderOptions.lite. */
let lite = false;

export function renderFrame(ctx: CanvasRenderingContext2D, score: Score, t: number, opts: RenderOptions = {}): void {
  lite = opts.lite ?? false;
  const { width: W, height: H } = ctx.canvas;
  const cfg = score.config;
  const V = cfg.voices;
  const tl = score.timeline;
  const baseLay = layoutFor(W, H, cfg, opts.textScale ?? 1);
  let lay = baseLay;
  let u = lay.u; // size unit (lines, dots)
  let tu = lay.tu; // text unit

  const st = styleOf(cfg);
  const th = cfg.theme;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (th.gradient) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, th.background);
    bg.addColorStop(1, th.background2);
    ctx.fillStyle = bg;
  } else ctx.fillStyle = th.background;
  ctx.fillRect(0, 0, W, H);

  // Zoom scales the picture (not the titles and HUD) around the playhead, or the centre in the other views.
  const zoom = cfg.video.zoom;
  ctx.save();
  if (zoom !== 1) {
    // The timeline keeps its lines inside the band in screen space, so zoomed lines never run over the text.
    if (cfg.video.view === 'timeline') {
      ctx.beginPath();
      ctx.rect(0, baseLay.clipTop, W, baseLay.clipBottom - baseLay.clipTop);
      ctx.clip();
    }
    const zx = cfg.video.view === 'timeline' ? cfg.video.nowPosition * W : W / 2;
    const zy = (lay.bandTop + lay.bandBottom) / 2;
    ctx.translate(zx, zy);
    ctx.scale(zoom, zoom);
    ctx.translate(-zx, -zy);
    // A camera zoom: positions spread out, but lines, dots and labels keep their size on screen.
    lay = { ...baseLay, u: baseLay.u / zoom, tu: baseLay.tu / zoom };
    u = lay.u;
    tu = lay.tu;
  }

  const freqs = soundingPitches(score, t).map(midiToHz);
  const harmonyView = ['chladni', 'constellation', 'transit', 'marbling', 'ferro', 'murmur', 'pendulum'].includes(cfg.video.view);
  if (harmonyView) {
    const vs: ViewStyle = {
      ink: st.ink,
      accent: st.accent,
      text: th.text,
      font: st.font,
      lw: st.lw,
      pcColor: (pc) => (st.colorBy === 'none' ? st.ink : pitchColor(pc, st)),
      voiceColor: (v) => voiceColor(v, cfg.voices, st),
      background: th.background,
    };
    const area: ViewArea = {
      cx: W / 2,
      cy: (lay.bandTop + lay.bandBottom) / 2,
      R: Math.min(W * 0.44, (lay.bandBottom - lay.bandTop) / 2 + 0.06 * H),
      u,
      tu,
      width: W,
      top: lay.bandTop,
      bottom: lay.bandBottom,
    };
    const view = cfg.video.view;
    if (view === 'chladni') drawChladni(ctx, score, t, vs, area, lite);
    else if (view === 'transit') drawTransit(ctx, score, t, vs, area);
    else if (view === 'marbling') drawMarbling(ctx, score, t, vs, area);
    else if (view === 'ferro') drawFerro(ctx, score, t, vs, area);
    else if (view === 'murmur') drawMurmuration(ctx, score, t, vs, area, lite);
    else if (view === 'pendulum') drawPendulums(ctx, score, t, vs, area);
    else drawConstellation(ctx, score, t, vs, area);
  } else if (cfg.video.view === 'waterfall') drawWaterfall(ctx, score, t, st, lay);
  else if (cfg.video.view === 'spiral') {
    if (cfg.video.spiral === 'fly') drawTunnel(ctx, score, t, st, lay);
    else if (cfg.video.spiral === 'orbit' || cfg.video.spiral === 'drain') drawOrbit(ctx, score, t, st, lay);
    else drawSpiral(ctx, score, t, st, lay);
  }
  else {
    // ---- Camera ------------------------------------------------------------
    // z: 0 while playing, eases to 1 for the final whole-piece view.
    const z = Number.isFinite(tl.zoomStart) ? smootherstep((t - tl.zoomStart) / Math.max(1e-6, tl.zoomEnd - tl.zoomStart)) : 0;
    const nowX = cfg.video.nowPosition * W;
    const H_s = lay.history;
    const viewEnd = tl.zoomEnd; // final view spans [0, viewEnd]
    const tNow = Math.min(t, viewEnd);

    // Time -> x is linear, defined by two anchors that interpolate with z.
    const tA = lerp(t - H_s, 0, z);
    const xA = lerp(0, lay.finalLeft, z);
    const tB = lerp(t, viewEnd, z);
    const xB = lerp(nowX, lay.finalRight, z);
    const xOf = (time: number) => xA + ((time - tA) / (tB - tA)) * (xB - xA);
    const timeAtX = (x: number) => tA + ((x - xA) / (xB - xA)) * (tB - tA);

    // Pitch -> y, also two anchors.
    const cam = z < 1 ? cameraExtent(score, t) : { lo: 0, hi: 1 };
    const [pLo, pHi] = score.pitchRange;
    const fullPad = Math.max(0.5, (pHi - pLo) * 0.02);
    const loP = lerp(cam.lo, pLo - fullPad, z);
    const hiP = lerp(cam.hi, pHi + fullPad, z);
    const yLo = lerp(lay.bandBottom, lay.finalBottom, z);
    const yHi = lerp(lay.bandTop, lay.finalTop, z);
    const yOf = (p: number) => yLo + ((p - loP) / (hiP - loP)) * (yHi - yLo);

    // ---- Lines -------------------------------------------------------------
    // When zoomed out, the visible left edge is further left than the canvas edge.
    const leftEdge = zoom < 1 ? cfg.video.nowPosition * W * (1 - 1 / zoom) - 4 : -4;
    const tFrom = lerp(timeAtX(leftEdge), 0, z);
    const tTo = tNow;
    ctx.save();
    // (Zoomed, the band is already clipped in screen space, before the zoom.)
    if (zoom === 1) {
      ctx.beginPath();
      ctx.rect(0, lay.clipTop, W, lay.clipBottom - lay.clipTop);
      ctx.clip();
    }

    if (th.grid) {
      // Octave lines at every C in view, with note names.
      ctx.strokeStyle = withAlpha(th.text, 0.14);
      ctx.fillStyle = withAlpha(th.text, 0.45);
      ctx.lineWidth = Math.max(1, 1.2 * u);
      ctx.font = `400 ${15 * tu}px ${st.font}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      const lo = Math.min(loP, hiP);
      const hi = Math.max(loP, hiP);
      for (let n = Math.ceil(lo / 12) * 12; n <= hi; n += 12) {
        const y = Math.round(yOf(n)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        ctx.fillText(`C${n / 12 - 1}`, 12 * u, y - 3 * tu);
      }
      // Bar lines when there's a beat grid (a chord rhythm, a strike pattern, drums or a song), so
      // chord changes can be read against the bars; song parts restart the count.
      const gridded = cfg.rhythm.chords.trim() !== '' || score.strikes || score.drums || score.sections.length > 0;
      if (gridded && z < 1) {
        const bar = 4 * score.beat;
        const starts = score.sections.length ? score.sections.map((x) => Math.max(x.t, score.gridStart)) : [score.gridStart];
        ctx.strokeStyle = withAlpha(th.text, 0.1);
        ctx.beginPath();
        starts.forEach((a, i) => {
          const b = Math.min(starts[i + 1] ?? Infinity, tl.arrivalStart, tTo);
          for (let k = Math.max(0, Math.ceil((tFrom - a) / bar)); a + k * bar <= b; k++) {
            const x = Math.round(xOf(a + k * bar)) + 0.5;
            ctx.moveTo(x, lay.clipTop);
            ctx.lineTo(x, lay.clipBottom);
          }
        });
        ctx.stroke();
      }
    }

    const painter = new Painter(ctx, st, V, yHi, yLo);
    const baseWidth = 3.2 * u * st.lw;
    if (tTo > tFrom) {
      // Lines are drawn from the score's glides: flat stretches are single
      // segments and only the curves are sampled, which keeps frames cheap on phones.
      const curveStep = 2.5 * u;
      if (cfg.motion.transition === 'swell') {
        traceCrossfades(score, tFrom, tTo, xOf, yOf, u, painter);
      } else if (!hasDynamics(score) || z >= 1) {
        for (let v = 0; v < V; v++) {
          if (st.colorBy === 'pitch') {
            // Each held note in its own colour; glides blend between the two.
            for (const seg of voiceSegments(score, v, tFrom, tTo)) {
              let color: string | CanvasGradient = pitchColor(seg.p0, st);
              if (seg.p0 !== seg.p1) {
                const g = ctx.createLinearGradient(xOf(seg.a), 0, Math.max(xOf(seg.b), xOf(seg.a) + 1), 0);
                g.addColorStop(0, pitchColor(seg.p0, st));
                g.addColorStop(1, pitchColor(seg.p1, st));
                color = g;
              }
              traceVoice(painter.stroke(v, seg.p0, color), score, v, seg.a, seg.b, xOf, yOf, curveStep);
            }
          } else traceVoice(painter.stroke(v, pitchAt(score, v, tTo)), score, v, tFrom, tTo, xOf, yOf, curveStep);
        }
      } else {
        // With swells or plucks, line thickness follows each voice's level over
        // time — the history reads like hairpins, plucks like little strikes.
        const half = 1.6 * u * st.lw;
        for (let v = 0; v < V; v++) {
          const segs = st.colorBy === 'pitch' ? voiceSegments(score, v, tFrom, tTo) : [{ a: tFrom, b: tTo, p0: pitchAt(score, v, tTo), p1: 0 }];
          for (const seg of segs) {
            const pts = samplePath(score, v, seg.a, seg.b, xOf, yOf, 3 * u, (t) => half * widthFactor(score, v, t), undefined, strikeSamples(score, seg.a, seg.b));
            ribbon(painter.fill(v, seg.p0), pts);
          }
        }
      }
      painter.paint(baseWidth);

      // Melody: a separate line in the accent colour, broken during rests.
      if (score.melody.length) {
        const path = painter.stroke(-1, 0, st.accent);
        traceMelody(path, score, tFrom, tTo, xOf, yOf, curveStep);
        painter.paint(baseWidth * 1.12);
      }
    }

    // ---- Playhead dots + labels ---------------------------------------------
    const pitches = soundingPitches(score, tNow);
    const dotX = xOf(tNow);
    const dynamic = hasDynamics(score) && z < 1;
    const dotR = 7 * u * Math.max(0.7, Math.min(1.8, st.lw));
    if (cfg.motion.transition === 'swell') {
      // A dot for each sounding layer, sized and faded by its level.
      for (const L of [0, 1] as const) {
        const g = layerAt(score, L, 0, tNow).g;
        if (g < 0.04) continue;
        const seen = new Set<number>();
        for (let v = 0; v < V; v++) {
          const p = layerAt(score, L, v, tNow).p;
          const y = Math.round(yOf(p) * 2) / 2;
          if (seen.has(y)) continue;
          seen.add(y);
          ctx.fillStyle = painter.dotColor(v, p, y);
          ctx.beginPath();
          ctx.arc(dotX, y, dotR * g, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      const dotYs = new Set<number>();
      pitches.forEach((p, v) => {
        const y = Math.round(yOf(p) * 2) / 2;
        if (dotYs.has(y)) return;
        dotYs.add(y);
        const r = (dynamic ? dotR * Math.min(1.6, 0.45 + 0.55 * widthFactor(score, v, tNow)) : dotR) * (z < 1 && th.ripples ? 1 + 0.9 * hitPop(score, v, tNow) : 1);
        ctx.fillStyle = painter.dotColor(v, p, y);
        ctx.beginPath();
        ctx.arc(dotX, y, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    if (z < 1) {
      drawRipples(ctx, score, tNow, (v) => {
        const p = pitches[v];
        if (p === undefined) return null;
        const y = yOf(p);
        return { x: dotX, y, color: painter.dotColor(v, p, y) };
      }, dotR, u);
    }
    const lead = score.melody.length ? melodyAt(score, tNow) : null;
    const leadOn = lead && lead.g > 0.05 && tNow < tl.arrivalStart;
    if (leadOn) {
      ctx.fillStyle = st.accent;
      ctx.beginPath();
      ctx.arc(dotX, yOf(lead!.p), dotR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const labelAlpha = 1 - smootherstep(z * 2);
    if (labelAlpha > 0.001 && th.labels) {
      // One label per distinct value (a unison shows a single label).
      const byText = new Map<string, number>();
      for (const p of pitches) {
        const text = `${midiToHz(p).toFixed(2)} Hz`;
        const y = yOf(p);
        byText.set(text, byText.has(text) ? (byText.get(text)! + y) / 2 : y);
      }
      const labels = [...byText].map(([text, y]) => ({ text, y, ly: y, color: st.text }));
      if (leadOn) {
        const text = `${midiToHz(lead!.p).toFixed(2)} Hz`;
        const y = yOf(lead!.p);
        const same = labels.find((l) => l.text === text);
        if (same) same.color = st.accent;
        else labels.push({ text, y, ly: y, color: st.accent });
      }
      labels.sort((a, b) => a.y - b.y);
      // Min-gap pass: push labels apart vertically; dots stay where they are.
      const gap = 25 * tu;
      for (let i = 1; i < labels.length; i++) labels[i].ly = Math.max(labels[i].ly, labels[i - 1].ly + gap);
      // Re-centre the pushed group around the original positions.
      const drift = labels.reduce((s, l) => s + (l.ly - l.y), 0) / Math.max(1, labels.length);
      for (const l of labels) l.ly -= drift;
      for (let i = labels.length - 2; i >= 0; i--) labels[i].ly = Math.min(labels[i].ly, labels[i + 1].ly - gap);

      ctx.globalAlpha = labelAlpha;
      ctx.font = `400 ${19 * tu}px ${st.font}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const l of labels) {
        ctx.fillStyle = l.color;
        ctx.fillText(l.text, dotX + 14 * u + 19 * tu, l.ly);
      }
      ctx.globalAlpha = 1;
    }


  }

  ctx.restore(); // end of zoom
  lay = baseLay;
  u = lay.u;
  tu = lay.tu;

  // In the spiral views lines run behind the text, so text gets a thin halo in the background colour.
  const halo = cfg.video.view !== 'timeline' || zoom !== 1;
  const say = (text: string, x: number, y: number) => {
    if (halo) {
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 6 * tu;
      ctx.strokeStyle = withAlpha(th.background, 0.85);
      ctx.strokeText(text, x, y);
      ctx.restore();
    }
    ctx.fillText(text, x, y);
  };

  // ---- Title (only what's defined) -----------------------------------------
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const header = cfg.series.trim();
  const subtitle = [cfg.episode ? `#${cfg.episode}` : '', cfg.title.trim()].filter(Boolean).join(' · ');
  // With no header, the subtitle (if any) takes the header's place.
  const big = header || subtitle;
  const small = header ? subtitle : '';
  if (big) {
    ctx.fillStyle = st.text;
    let titleSize = 64 * tu;
    ctx.font = `700 ${titleSize}px ${st.font}`;
    const maxTitle = W * 0.86;
    const tw = ctx.measureText(big).width;
    if (tw > maxTitle) {
      titleSize *= maxTitle / tw;
      ctx.font = `700 ${titleSize}px ${st.font}`;
    }
    say(big, W / 2, lay.titleY);
  }
  if (small) {
    ctx.fillStyle = st.muted;
    ctx.font = `500 ${29 * tu}px ${st.font}`;
    say(small, W / 2, lay.subtitleY);
  }

  // ---- HUD ---------------------------------------------------------------
  const frame = opts.frame ?? Math.round(t * cfg.video.fps);
  const { sum, spread } = frequencyStats(freqs);
  const hudSize = 19 * tu;
  if (!th.hud) {
    ctx.restore();
    return;
  }
  ctx.font = `400 ${hudSize}px ${st.font}`;
  ctx.fillStyle = st.text;
  ctx.textBaseline = 'middle';
  const rowY = lay.hudRow;
  const left: [string, string][] = [
    ['f(n) = 440·2^((n−69)/12)', ''],
    ['voices', String(V)],
    ['t', formatClock(t)],
    ['frame', String(frame).padStart(5, '0')],
  ];
  left.forEach(([k, val], i) => {
    ctx.textAlign = 'left';
    say(k, lay.hudLeft, rowY(i));
    if (val) say(val, lay.hudValue, rowY(i));
  });
  const right: [string, string][] = [
    ['chord', chordLabelAt(score, t)],
    ['Σf', `${sum.toFixed(1)} Hz`],
    ['f↑/f↓', spread.toFixed(4)],
    ['seed', score.seedLabel],
  ];
  const rx = lay.hudRight;
  right.forEach(([k, val], i) => {
    ctx.textAlign = 'right';
    say(val, rx, rowY(i));
    const vw = ctx.measureText(val).width;
    say(k, rx - vw - 12 * tu, rowY(i));
  });

  ctx.restore();
}

/** Frame count for a video of the whole piece. */
export const frameCount = (score: Score, duration = score.timeline.end) => Math.ceil(duration * score.config.video.fps) + 1;
