import { chordLabelAt, frequencyStats, melodyAt, pitchAt, smootherstep } from '../engine/motion';
import type { Score } from '../engine/score';
import { midiToHz } from '../engine/theory';

/**
 * Pitch-versus-time plot with a moving camera. Everything is a pure function of
 * (score, t), so any frame can be rendered in any order — which is what makes
 * deterministic video export (t = frame / fps) possible.
 *
 * Layout fractions were measured from reference frames at 1080×1920 and scale
 * with the canvas size.
 */

export const THEME = {
  background: '#fafbf9',
  ink: '#0b0b0b',
  text: '#1a1a1a',
  muted: '#3a3a3a',
  font: "Inter, 'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', sans-serif",
};

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

interface Extent {
  lo: number;
  hi: number;
}

function instantExtent(score: Score, t: number): Extent {
  let lo = Infinity;
  let hi = -Infinity;
  for (let v = 0; v < score.config.voices; v++) {
    const p = pitchAt(score, v, t);
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
  ctx: CanvasRenderingContext2D,
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

function traceMelody(
  ctx: CanvasRenderingContext2D,
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

export interface RenderOptions {
  /** Override the frame number shown in the HUD (defaults to round(t × fps)). */
  frame?: number;
}

export function renderFrame(ctx: CanvasRenderingContext2D, score: Score, t: number, opts: RenderOptions = {}): void {
  const { width: W, height: H } = ctx.canvas;
  const cfg = score.config;
  const V = cfg.voices;
  const tl = score.timeline;
  const u = H / 1920; // type scale unit

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = THEME.background;
  ctx.fillRect(0, 0, W, H);

  // ---- Camera ------------------------------------------------------------
  // z: 0 while playing, eases to 1 for the final whole-piece view.
  const z = Number.isFinite(tl.zoomStart) ? smootherstep((t - tl.zoomStart) / Math.max(1e-6, tl.zoomEnd - tl.zoomStart)) : 0;
  const nowX = cfg.video.nowPosition * W;
  const H_s = cfg.video.historySeconds;
  const viewEnd = tl.zoomEnd; // final view spans [0, viewEnd]
  const tNow = Math.min(t, viewEnd);

  // Time -> x is linear, defined by two anchors that interpolate with z.
  const tA = lerp(t - H_s, 0, z);
  const xA = lerp(0, LAYOUT.finalLeft * W, z);
  const tB = lerp(t, viewEnd, z);
  const xB = lerp(nowX, LAYOUT.finalRight * W, z);
  const xOf = (time: number) => xA + ((time - tA) / (tB - tA)) * (xB - xA);
  const timeAtX = (x: number) => tA + ((x - xA) / (xB - xA)) * (tB - tA);

  // Pitch -> y, also two anchors.
  const cam = z < 1 ? cameraExtent(score, t) : { lo: 0, hi: 1 };
  const [pLo, pHi] = score.pitchRange;
  const fullPad = Math.max(0.5, (pHi - pLo) * 0.02);
  const loP = lerp(cam.lo, pLo - fullPad, z);
  const hiP = lerp(cam.hi, pHi + fullPad, z);
  const yLo = lerp(LAYOUT.bandBottom, LAYOUT.finalBottom, z) * H;
  const yHi = lerp(LAYOUT.bandTop, LAYOUT.finalTop, z) * H;
  const yOf = (p: number) => yLo + ((p - loP) / (hiP - loP)) * (yHi - yLo);

  // ---- Lines -------------------------------------------------------------
  const tFrom = lerp(timeAtX(-4), 0, z);
  const tTo = tNow;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, LAYOUT.clipTop * H, W, (LAYOUT.clipBottom - LAYOUT.clipTop) * H);
  ctx.clip();
  ctx.strokeStyle = THEME.ink;
  ctx.lineWidth = 3.2 * u;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (tTo > tFrom) {
    // Lines are drawn from the score's glides: flat stretches are single
    // segments and only the curves are sampled, which keeps frames cheap on phones.
    const curveStep = 2.5 * u;
    ctx.beginPath();
    for (let v = 0; v < V; v++) traceVoice(ctx, score, v, tFrom, tTo, xOf, yOf, curveStep);
    ctx.stroke();

    // Melody: a separate line in the accent colour, broken during rests.
    if (score.melody.length) {
      ctx.strokeStyle = cfg.video.melodyColor;
      ctx.lineWidth = 3.6 * u;
      ctx.beginPath();
      traceMelody(ctx, score, tFrom, tTo, xOf, yOf, curveStep);
      ctx.stroke();
    }
  }

  // ---- Playhead dots + labels ---------------------------------------------
  const pitches = Array.from({ length: V }, (_, v) => pitchAt(score, v, tNow));
  const freqs = Array.from({ length: V }, (_, v) => midiToHz(pitchAt(score, v, t)));
  const dotX = xOf(tNow);
  ctx.fillStyle = THEME.ink;
  const dotYs = new Set<number>();
  for (const p of pitches) {
    const y = Math.round(yOf(p) * 2) / 2;
    if (dotYs.has(y)) continue;
    dotYs.add(y);
    ctx.beginPath();
    ctx.arc(dotX, y, 7 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  const lead = score.melody.length ? melodyAt(score, tNow) : null;
  const leadOn = lead && lead.g > 0.05 && tNow < tl.arrivalStart;
  if (leadOn) {
    ctx.fillStyle = cfg.video.melodyColor;
    ctx.beginPath();
    ctx.arc(dotX, yOf(lead!.p), 7 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const labelAlpha = 1 - smootherstep(z * 2);
  if (labelAlpha > 0.001) {
    // One label per distinct value (a unison shows a single label).
    const byText = new Map<string, number>();
    for (const p of pitches) {
      const text = `${midiToHz(p).toFixed(2)} Hz`;
      const y = yOf(p);
      byText.set(text, byText.has(text) ? (byText.get(text)! + y) / 2 : y);
    }
    const labels = [...byText].map(([text, y]) => ({ text, y, ly: y, color: THEME.text }));
    if (leadOn) {
      const text = `${midiToHz(lead!.p).toFixed(2)} Hz`;
      const y = yOf(lead!.p);
      const same = labels.find((l) => l.text === text);
      if (same) same.color = cfg.video.melodyColor;
      else labels.push({ text, y, ly: y, color: cfg.video.melodyColor });
    }
    labels.sort((a, b) => a.y - b.y);
    // Min-gap pass: push labels apart vertically; dots stay where they are.
    const gap = 25 * u;
    for (let i = 1; i < labels.length; i++) labels[i].ly = Math.max(labels[i].ly, labels[i - 1].ly + gap);
    // Re-centre the pushed group around the original positions.
    const drift = labels.reduce((s, l) => s + (l.ly - l.y), 0) / Math.max(1, labels.length);
    for (const l of labels) l.ly -= drift;
    for (let i = labels.length - 2; i >= 0; i--) labels[i].ly = Math.min(labels[i].ly, labels[i + 1].ly - gap);

    ctx.globalAlpha = labelAlpha;
    ctx.font = `400 ${19 * u}px ${THEME.font}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const l of labels) {
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, dotX + 33 * u, l.ly);
    }
    ctx.globalAlpha = 1;
  }

  // ---- Title -------------------------------------------------------------
  ctx.fillStyle = THEME.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let titleSize = 64 * u;
  ctx.font = `700 ${titleSize}px ${THEME.font}`;
  const maxTitle = W * 0.86;
  const tw = ctx.measureText(cfg.series).width;
  if (tw > maxTitle) {
    titleSize *= maxTitle / tw;
    ctx.font = `700 ${titleSize}px ${THEME.font}`;
  }
  ctx.fillText(cfg.series, W / 2, LAYOUT.titleY * H);
  const subtitle = [cfg.episode ? `#${cfg.episode}` : '', cfg.title].filter(Boolean).join(' · ');
  if (subtitle) {
    ctx.fillStyle = THEME.muted;
    ctx.font = `500 ${29 * u}px ${THEME.font}`;
    ctx.fillText(subtitle, W / 2, LAYOUT.subtitleY * H);
  }

  // ---- HUD ---------------------------------------------------------------
  const frame = opts.frame ?? Math.round(t * cfg.video.fps);
  const { sum, spread } = frequencyStats(freqs);
  const hudSize = 19 * u;
  ctx.font = `400 ${hudSize}px ${THEME.font}`;
  ctx.fillStyle = THEME.text;
  ctx.textBaseline = 'middle';
  const rowY = (i: number) => (LAYOUT.hudTop + LAYOUT.hudLine * i) * H;
  const left: [string, string][] = [
    ['f(n) = 440·2^((n−69)/12)', ''],
    ['voices', String(V)],
    ['t', formatClock(t)],
    ['frame', String(frame).padStart(5, '0')],
  ];
  left.forEach(([k, val], i) => {
    ctx.textAlign = 'left';
    ctx.fillText(k, LAYOUT.hudLeft * W, rowY(i));
    if (val) ctx.fillText(val, LAYOUT.hudValue * W, rowY(i));
  });
  const right: [string, string][] = [
    ['chord', chordLabelAt(score, t)],
    ['Σf', `${sum.toFixed(1)} Hz`],
    ['f↑/f↓', spread.toFixed(4)],
    ['seed', score.seedLabel],
  ];
  const rx = LAYOUT.hudRight * W;
  right.forEach(([k, val], i) => {
    ctx.textAlign = 'right';
    ctx.fillText(val, rx, rowY(i));
    const vw = ctx.measureText(val).width;
    ctx.fillText(k, rx - vw - 12 * u, rowY(i));
  });

  ctx.restore();
}

/** Frame count for a video of the whole piece. */
export const frameCount = (score: Score, duration = score.timeline.end) => Math.ceil(duration * score.config.video.fps) + 1;
