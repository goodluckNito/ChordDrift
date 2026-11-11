/**
 * Sand art: the liquid sand picture (two panes of glass, coloured sand, liquid and trapped air).
 *
 * In the toy, sand rests on a row of air bubbles trapped under it; the bubbles are the holes it
 * runs through, and they sit still. Here they're the notes:
 *
 * - The reservoir along the top holds the score: the chords to come stacked as strata of sand in
 *   their notes' colours, the chord playing now at the bottom, scrolling down as the song plays.
 * - A row of air bubbles sits along its floor, one per semitone across the piece's range. When a
 *   note sounds, the bubble at its pitch swells open and sand in its colour runs through it,
 *   thicker the louder the note; when the note stops, the bubble settles back and the stream stops.
 * - The sand piles into a landscape: held notes build peaks, chord changes lay new strata. A
 *   finished piece's whole song fits in the frame (the flow is scaled to its length); at the end the
 *   last of the reservoir falls as an even curtain, capping the landscape in the tonic's colour.
 *   Endless and looping pieces drain the oldest sand away at the bottom instead.
 * - Kicks jolt the frame (small avalanches on steep slopes); snares make every open bubble gulp.
 *
 * A falling-sand automaton, stepped at a fixed rate from the start of the piece (with snapshots, so
 * jumping back is quick): exports match playback. Drawn in screen space (zoom leaves it alone).
 */
import { chordIndexAt, drumHits, levelAt, voiceNotesAt } from '../engine/motion';
import type { Score } from '../engine/score';
import { mod12 } from '../engine/theory';
import { harmonyKeyAt, harmonyRgb } from './harmony-color';
import { skyRange, type ViewArea, type ViewStyle } from './harmony-views';

const DT = 1 / 60;
const SNAP_EVERY = 2; // s between snapshots
const MAX_SNAPS = 60;
const RESERVOIR_SECONDS = 16; // how much of the score to come the reservoir shows
const CURTAIN = 4; // s the final curtain of sand takes to fall

interface Sand {
  w: number;
  h: number;
  /** Grains as packed ImageData pixels (0 = liquid). */
  cells: Uint32Array;
  step: number;
  key: string;
  /** Row the sand leaves the reservoir from. */
  shelf: number;
  /** How freely the bubbles let sand through (scaled so a finished piece's sand fits the frame). */
  flow: number;
  /** Endless and looping pieces drain the oldest sand away at the bottom. */
  drain: boolean;
  snaps: { step: number; cells: Uint32Array }[];
}
const sims = new WeakMap<Score, Sand>();

function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const isDark = (score: Score) => {
  const bg = score.config.theme.background;
  const n = /^#[0-9a-f]{6}$/i.test(bg) ? parseInt(bg.slice(1), 16) : 0;
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 < 0.45;
};

/** A note's sand colour (its harmony colour with a little warm sand tone), 0..255. */
function sandRgb(p: number, score: Score, time: number): [number, number, number] {
  const [r, g, b] = harmonyRgb(p, harmonyKeyAt(score, time, isDark(score)));
  return [(r * 0.8 + 0.17) * 255, (g * 0.8 + 0.152) * 255, (b * 0.8 + 0.12) * 255];
}

/** One grain of a note's colour, each a little lighter or darker. */
function grain(p: number, score: Score, time: number, j: number): number {
  const [r, g, b] = sandRgb(p, score, time);
  const k = 0.78 + 0.36 * j;
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x * k)));
  return ((255 << 24) | (c(b) << 16) | (c(g) << 8) | c(r)) >>> 0;
}

function makeSim(score: Score, w: number, h: number, key: string): Sand {
  const shelf = Math.round(h * 0.17);
  const tl = score.timeline;
  const drain = score.loop || !Number.isFinite(tl.arrivalStart);
  // Fit the whole piece: about half the chamber's cells' worth of sand over its length (each voice
  // at a typical level lets through about a grain a step).
  const seconds = drain ? 60 : Math.max(15, tl.arrivalStart - score.gridStart);
  const flow = Math.max(0.05, Math.min(1, ((h - shelf) * w * 0.5) / (seconds * 60 * score.config.voices * 0.6)));
  return { w, h, cells: new Uint32Array(w * h), step: 0, key, shelf, flow, drain, snaps: [] };
}

/** The bubbles along the reservoir's floor: one per semitone across the piece's range (12–40). */
function bubbleSlots(score: Score): { n: number; lo: number; span: number } {
  const { lo, span } = skyRange(score);
  return { n: Math.max(12, Math.min(40, Math.round(span) + 1)), lo, span };
}
/** How open each bubble is at t (0 = settled, 1 = a note at full level runs through it), and its note. */
function openBubbles(score: Score, t: number): { open: Float32Array; pitch: Float32Array } {
  const { n, lo, span } = bubbleSlots(score);
  const open = new Float32Array(n);
  const pitch = new Float32Array(n);
  if (t < score.gridStart) return { open, pitch }; // (the opening unison doesn't pour)
  for (let v = 0; v < score.config.voices; v++) {
    for (const nt of voiceNotesAt(score, v, t)) {
      const level = levelAt(score, v, t) * nt.g;
      if (level < 0.04) continue;
      const j = Math.max(0, Math.min(n - 1, Math.round(((nt.p - lo) / span) * (n - 1))));
      if (level > open[j]) {
        open[j] = level;
        pitch[j] = nt.p;
      }
    }
  }
  return { open, pitch };
}

function stepSand(s: Sand, score: Score, time: number) {
  const { w, h, cells, shelf } = s;
  const n = s.step;
  const tl = score.timeline;
  const ending = time >= tl.arrivalStart && !s.drain;
  // Sand runs through the open bubbles, thicker the louder the note (not during the ending, when
  // every voice gathers on one note). A snare makes every open bubble gulp.
  if (!ending) {
    const { open, pitch } = openBubbles(score, time);
    const N = open.length;
    let gulp = 1;
    for (const hit of drumHits(score, time - 0.12, time + 1e-6)) if (hit.voice === 'snare' || hit.voice === 'crash') gulp = 1.8;
    for (let j = 0; j < N; j++) {
      if (open[j] <= 0) continue;
      const x0 = (0.05 + (0.9 * j) / (N - 1)) * (w - 1);
      const chance = s.flow * (0.25 + 0.75 * open[j]) * gulp;
      for (let k = 0; k < 2; k++) {
        if (hash(n, j * 5 + k, 25) >= chance) continue;
        const x = Math.max(0, Math.min(w - 1, Math.round(x0 + (hash(n, j, k + 26) - 0.5) * (1 + 2 * open[j]))));
        const i = (shelf + 1 + k) * w + x;
        if (!cells[i]) cells[i] = grain(pitch[j], score, time, hash(n, x, k + 27));
      }
    }
  }
  // The ending: the last of the reservoir falls as an even curtain across the whole width.
  if (ending && time < tl.arrivalStart + CURTAIN) {
    const nt = voiceNotesAt(score, 0, time)[0];
    const p = nt ? nt.p : score.startNote;
    for (let x = 0; x < w; x++) {
      const i = (shelf + 1) * w + x;
      if (!cells[i] && hash(n, x, 29) < 0.14) cells[i] = grain(p, score, time, hash(n, x, 28));
    }
  }

  // Falling: two cells a step at most; straight down if it can, else sliding off diagonally, and
  // half the time two cells sideways (wet sand runs a little), so dunes settle at a gentle slope.
  // Bottom-up, alternating direction, so nothing moves twice.
  for (let sub = 0; sub < 2; sub++) {
    const ltr = (n + sub) % 2 === 0;
    for (let y = h - 2; y > shelf; y--) {
      const row = y * w;
      for (let k = 0; k < w; k++) {
        const x = ltr ? k : w - 1 - k;
        const i = row + x;
        const c = cells[i];
        if (!c) continue;
        const below = i + w;
        if (!cells[below]) {
          cells[below] = c;
          cells[i] = 0;
          continue;
        }
        const first = hash(x, y, n * 2 + sub) < 0.5 ? -1 : 1;
        let moved = false;
        for (const d of [first, -first]) {
          const nx = x + d;
          if (nx < 0 || nx >= w) continue;
          if (!cells[below + d] && !cells[i + d]) {
            cells[below + d] = c;
            cells[i] = 0;
            moved = true;
            break;
          }
        }
        if (!moved && hash(x, y, n * 3 + sub + 7) < 0.5) {
          const d = first;
          const nx = x + 2 * d;
          if (nx >= 0 && nx < w && !cells[i + d] && !cells[i + 2 * d] && !cells[below + 2 * d]) {
            cells[below + 2 * d] = c;
            cells[i] = 0;
          }
        }
      }
    }
  }
  // Kicks jolt the frame: grains at the tops of steep slopes tumble down to a lower neighbour.
  for (const hit of drumHits(score, time, time + DT)) {
    if (hit.voice !== 'kick') continue;
    const tops = new Int32Array(w);
    for (let x = 0; x < w; x++) {
      let y = shelf + 1;
      while (y < h && !cells[y * w + x]) y++;
      tops[x] = y;
    }
    for (let x = 0; x < w; x++) {
      if (hash(x, n, 5) > 0.6 * hit.vel) continue;
      const y = tops[x];
      if (y >= h) continue;
      const d = hash(x, n, 6) < 0.5 ? -1 : 1;
      const nx = x + d;
      if (nx < 0 || nx >= w || tops[nx] - y < 2) continue;
      cells[(tops[nx] - 1) * w + nx] = cells[y * w + x];
      cells[y * w + x] = 0;
      tops[nx]--;
      tops[x]++;
    }
  }
  // Endless and looping pieces: when the pile grows tall, everything sinks a row (the oldest sand
  // drains away at the bottom). Solid pile three grains wide, so a falling stream doesn't count.
  if (s.drain && n % 6 === 0) {
    const limit = shelf + Math.round((h - shelf) * 0.4);
    let tall = false;
    for (let x = 1; x < w - 1 && !tall; x += 2) {
      const i = limit * w + x;
      if (cells[i - 1] && cells[i] && cells[i + 1] && cells[i + w] && cells[i + 2 * w]) tall = true;
    }
    if (tall) {
      cells.copyWithin((shelf + 2) * w, (shelf + 1) * w, (h - 1) * w);
      cells.fill(0, (shelf + 1) * w, (shelf + 2) * w);
    }
  }
  s.step++;
}

let speckle: { w: number; h: number; canvas: HTMLCanvasElement | OffscreenCanvas } | null = null;
function makeSpeckle(w: number, h: number) {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const c = canvas.getContext('2d') as CanvasRenderingContext2D;
  const img = c.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const j = hash(i, 9, 99);
    const v = j < 0.5 ? 0 : 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = Math.round(Math.abs(j - 0.5) * 2 * 70);
  }
  c.putImageData(img, 0, 0);
  return { w, h, canvas };
}

let image: { w: number; h: number; canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D; img: ImageData; px: Uint32Array } | null = null;

const rgbOf = (hex: string): [number, number, number] => {
  const n = /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0x808080;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const css = (c: number[], a = 1) => `rgba(${c.map((x) => Math.round(Math.max(0, Math.min(255, x)))).join(',')},${a})`;

export function drawSand(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, _a: ViewArea, lite = false) {
  const Wc = ctx.canvas.width;
  const Hc = ctx.canvas.height;
  const shape = (Math.round((Hc / Wc) * 20) / 20).toFixed(2);
  let s = sims.get(score);
  if (!s || !s.key.startsWith(shape + '/')) {
    const w = lite ? 160 : 240;
    const h = Math.max(60, Math.round(w * +shape));
    s = makeSim(score, w, h, `${shape}/${w}x${h}`);
    sims.set(score, s);
  }
  const sim = s;
  const { w, h } = sim;
  // Step to t (restoring a snapshot when time jumps back; a long jump is caught up over frames).
  const target = Math.max(0, Math.floor(t / DT));
  if (target < sim.step) {
    const snap = [...sim.snaps].reverse().find((x) => x.step <= target);
    if (snap) {
      sim.cells.set(snap.cells);
      sim.step = snap.step;
    } else {
      sim.cells.fill(0);
      sim.step = 0;
    }
  }
  const limit = sim.step + 600;
  while (sim.step < target && sim.step < limit) {
    stepSand(sim, score, sim.step * DT);
    if (sim.step % Math.round(SNAP_EVERY / DT) === 0 && !sim.snaps.some((x) => x.step === sim.step)) {
      if (sim.snaps.length >= MAX_SNAPS) sim.snaps.splice(1, 1);
      sim.snaps.push({ step: sim.step, cells: sim.cells.slice() });
    }
  }

  const dark = isDark(score);
  const bg = rgbOf(st.background);
  const acc = rgbOf(st.accent);
  const ch = Hc / h;
  const shelfY = (sim.shelf + 1) * ch;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // The liquid: the background, tinted toward the accent, lit from above.
  const tint = (k: number) => bg.map((c, i) => c + (acc[i] - c) * k);
  const liquid = ctx.createLinearGradient(0, 0, 0, Hc);
  liquid.addColorStop(0, css(tint(dark ? 0.16 : 0.1).map((c) => c * (dark ? 1.15 : 1))));
  liquid.addColorStop(1, css(tint(dark ? 0.06 : 0.04).map((c) => c * (dark ? 0.85 : 0.97))));
  ctx.fillStyle = liquid;
  ctx.fillRect(0, 0, Wc, Hc);

  // The reservoir: the score to come as strata of sand, the chord playing now at the bottom,
  // each chord's layer as thick as it lasts, banded in its notes' colours, scrolling down.
  const chords = score.chords;
  const tl = score.timeline;
  const end = sim.drain ? Infinity : tl.arrivalStart + CURTAIN;
  const yAt = (time: number) => shelfY - ((time - t) / RESERVOIR_SECONDS) * shelfY;
  const k0 = Math.max(0, chordIndexAt(score, t));
  let strataTop = shelfY;
  for (let k = k0; k < chords.length; k++) {
    const c = chords[k];
    const a = Math.max(t, c.t);
    const b = Math.min(end, chords[k + 1]?.t ?? end);
    if (a >= t + RESERVOIR_SECONDS || a >= end) break;
    if (b <= a) continue;
    const y0 = yAt(a);
    const y1 = yAt(Math.min(b, t + RESERVOIR_SECONDS));
    // Its notes' colours (up to three, low to high), muted a little: the reservoir is the store.
    const pcs: number[] = [];
    for (const p of c.notes) if (!pcs.some((q) => mod12(q) === mod12(p))) pcs.push(p);
    const cols = pcs.slice(0, 3).map((p) => sandRgb(p, score, c.t).map((x, i) => x * 0.8 + bg[i] * 0.2));
    const bands = cols.length;
    ctx.fillStyle = css(cols[bands - 1]);
    ctx.fillRect(0, y1 - ch, Wc, y0 - y1 + ch);
    strataTop = Math.min(strataTop, y1 - ch);
    for (let j = 0; j < bands; j++) {
      const ya = y0 + ((y1 - y0) * j) / bands;
      const yb = y0 + ((y1 - y0) * (j + 1)) / bands;
      ctx.fillStyle = css(cols[j]);
      ctx.beginPath();
      ctx.moveTo(0, ya + 1);
      for (let x = 0; x <= 20; x++) ctx.lineTo((x / 20) * Wc, yb + Math.sin(x * 0.8 + k * 2.1 + j * 1.3) * ch * 0.9);
      ctx.lineTo(Wc, ya + 1);
      ctx.closePath();
      ctx.fill();
    }
  }
  // Sand grain over the strata (a fixed speckle at the grid's scale, like the grains below).
  if (!speckle || speckle.w !== w || speckle.h !== sim.shelf + 1) speckle = makeSpeckle(w, sim.shelf + 1);
  ctx.imageSmoothingEnabled = false;
  if (strataTop < shelfY) {
    // (Only over the sand that's there: the reservoir empties as the piece ends.)
    const sy = Math.max(0, Math.floor((strataTop / shelfY) * speckle.h));
    ctx.drawImage(speckle.canvas as CanvasImageSource, 0, sy, speckle.w, speckle.h - sy, 0, (sy / speckle.h) * shelfY, Wc, shelfY - (sy / speckle.h) * shelfY);
  }
  ctx.imageSmoothingEnabled = true;
  // The reservoir's floor, with the holes the bubbles have broken (while their sand runs).
  ctx.fillStyle = css(bg.map((c) => c * (dark ? 0.55 : 0.8)));
  ctx.fillRect(0, shelfY - ch * 0.5, Wc, ch * 0.8);

  // The grains, one pixel per cell, lit from above (a grain with liquid over it catches the light).
  if (!image || image.w !== w || image.h !== h) {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const c2 = canvas.getContext('2d') as CanvasRenderingContext2D;
    const img = c2.createImageData(w, h);
    image = { w, h, canvas, ctx: c2, img, px: new Uint32Array(img.data.buffer) };
  }
  const px = image.px;
  const cells = sim.cells;
  for (let i = 0; i < w * h; i++) {
    const c = cells[i];
    if (!c) {
      px[i] = 0;
      continue;
    }
    if (i >= w && !cells[i - w]) {
      const r = Math.min(255, (c & 255) * 1.18 + 10);
      const g = Math.min(255, ((c >> 8) & 255) * 1.18 + 10);
      const b = Math.min(255, ((c >> 16) & 255) * 1.18 + 10);
      px[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
    } else px[i] = c;
  }
  image.ctx.putImageData(image.img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image.canvas as CanvasImageSource, 0, 0, Wc, Hc);
  ctx.imageSmoothingEnabled = true;

  // The bubbles along the reservoir's floor: settled ones small and clear, open ones swollen,
  // rimmed in their note's colour, with sand running through.
  {
    const { open, pitch } = openBubbles(score, t);
    const N = open.length;
    const r0 = Math.min(Wc / N, Hc * 0.04) * 0.32;
    for (let j = 0; j < N; j++) {
      const x = (0.05 + (0.9 * j) / (N - 1)) * Wc;
      const o = open[j];
      const r = r0 * (1 + 0.7 * o) * (1 + 0.04 * Math.sin(t * 3 + j));
      const y = shelfY + r * 0.55;
      ctx.fillStyle = `rgba(255,255,255,${dark ? 0.07 + 0.08 * o : 0.22 + 0.15 * o})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      if (o > 0) {
        const [cr, cg, cb] = sandRgb(pitch[j], score, t);
        ctx.strokeStyle = `rgba(${Math.round(cr)},${Math.round(cg)},${Math.round(cb)},${(0.4 + 0.5 * o).toFixed(3)})`;
      } else ctx.strokeStyle = `rgba(255,255,255,${dark ? 0.18 : 0.45})`;
      ctx.lineWidth = Math.max(1, r * 0.14);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(x - r * 0.35, y - r * 0.3, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The glass: a soft sheen down one side and a thin frame.
  const sheen = ctx.createLinearGradient(0, 0, Wc, 0);
  sheen.addColorStop(0.04, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.07, `rgba(255,255,255,${dark ? 0.07 : 0.16})`);
  sheen.addColorStop(0.12, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.9, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.93, `rgba(255,255,255,${dark ? 0.04 : 0.1})`);
  sheen.addColorStop(0.95, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, Wc, Hc);
  ctx.strokeStyle = css(bg.map((c) => c * (dark ? 0.45 : 0.6)), 0.9);
  ctx.lineWidth = Math.max(4, Wc * 0.012);
  ctx.strokeRect(0, 0, Wc, Hc);
  ctx.restore();
}
