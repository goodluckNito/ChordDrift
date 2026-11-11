/**
 * Sand art: the liquid sand picture (two panes of glass, coloured sand, liquid and air bubbles).
 *
 * Coloured sand rests in a reservoir along the top. Each sounding note opens a gap in it at its
 * pitch (low notes left, high right) and a stream of sand in its colour trickles down through the
 * liquid, faster the louder the note; glides sweep the stream sideways. The sand piles up into
 * mountains: held notes build peaks, the bass broad dunes, and every chord change lays a new
 * coloured stratum over the last, so the song becomes a landscape. Kicks jolt the frame and set off
 * small avalanches on the steep slopes; snares and crashes release bursts of air bubbles. When the
 * pile grows tall, the oldest sand slowly drains away at the bottom, so the landscape sinks as it
 * grows.
 *
 * A falling-sand automaton on a coarse grid, stepped at a fixed rate from the start of the piece
 * (with snapshots, so jumping back is quick): exports match playback, and it's drawn in screen
 * space (zoom leaves it alone).
 */
import { drumHits, levelAt, voiceNotesAt } from '../engine/motion';
import type { Score } from '../engine/score';
import { harmonyKeyAt, harmonyRgb } from './harmony-color';
import { skyRange, type ViewArea, type ViewStyle } from './harmony-views';

const DT = 1 / 60;
const SNAP_EVERY = 2; // s between snapshots
const MAX_SNAPS = 60;

interface Sand {
  w: number;
  h: number;
  /** Grains as packed ImageData pixels (0 = liquid). */
  cells: Uint32Array;
  step: number;
  key: string;
  /** Row the streams leave the reservoir from. */
  shelf: number;
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

/** A grain of a note's colour (the key's harmony colours), each a little lighter or darker. */
function grain(p: number, score: Score, time: number, j: number): number {
  const [r0, g0, b0] = harmonyRgb(p, harmonyKeyAt(score, time, isDark(score)));
  // Coloured sand rather than paint: a little of a warm sand tone mixed in.
  const r = r0 * 0.8 + 0.85 * 0.2;
  const g = g0 * 0.8 + 0.76 * 0.2;
  const b = b0 * 0.8 + 0.6 * 0.2;
  const k = 0.78 + 0.36 * j;
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255 * k)));
  return ((255 << 24) | (c(b) << 16) | (c(g) << 8) | c(r)) >>> 0;
}

function makeSim(w: number, h: number, key: string): Sand {
  return { w, h, cells: new Uint32Array(w * h), step: 0, key, shelf: Math.round(h * 0.14), snaps: [] };
}

function stepSand(s: Sand, score: Score, time: number) {
  const { w, h, cells, shelf } = s;
  const n = s.step;
  const V = score.config.voices;
  const { lo, span } = skyRange(score);
  // Streams: each sounding note pours from a gap in the reservoir at its pitch.
  for (let v = 0; v < V; v++) {
    for (const nt of voiceNotesAt(score, v, time)) {
      const level = levelAt(score, v, time) * nt.g;
      if (level < 0.04) continue;
      const fx = 0.05 + 0.9 * Math.max(0, Math.min(1, (nt.p - lo) / span));
      // The gap drifts slowly from side to side (the liquid sways), so streams lay down sloping
      // strata across the dunes instead of each building a wedge of its own colour.
      const sway = Math.sin(time * 0.21 + v * 1.9) * 0.035 + Math.sin(time * 0.57 + v * 0.7) * 0.012;
      const x = Math.max(0, Math.min(w - 1, Math.round((fx + sway) * (w - 1))));
      // Two rows, since grains fall two cells a step: a continuous stream, thicker when louder.
      for (let k = 0; k < 2; k++) {
        const i = (shelf + 1 + k) * w + x;
        if (!cells[i] && hash(n, v * 7 + k, 3) < 0.2 + 0.75 * level) cells[i] = grain(nt.p, score, time, hash(n, v, k + 11));
      }
    }
  }
  // Falling: two cells a step at most, straight down if it can, else sliding off diagonally (so
  // piles settle at the sand's angle of repose). Bottom-up, alternating direction, so nothing
  // moves twice and nothing drifts one way.
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
        // Wet sand runs a little further: half the time it can slip two cells sideways, so dunes
        // settle at a gentler slope and layers spread wide.
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
      if (hash(x, n, 5) > 0.7 * hit.vel) continue;
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
  // When the pile grows tall, the oldest sand drains away at the bottom: everything sinks a row.
  if (n % 6 === 0) {
    const limit = shelf + Math.round((h - shelf) * 0.38);
    // (Solid pile three grains wide, so a falling stream, one grain wide, doesn't count.)
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
    const w = lite ? 150 : 210;
    const h = Math.max(60, Math.round(w * +shape));
    s = makeSim(w, h, `${shape}/${w}x${h}`);
    sims.set(score, s);
  }
  const { w, h } = s;
  // Step to t (restoring a snapshot when time jumps back; a long jump is caught up over frames).
  const target = Math.max(0, Math.floor(t / DT));
  if (target < s.step) {
    const snap = [...s.snaps].reverse().find((x) => x.step <= target);
    if (snap) {
      s.cells.set(snap.cells);
      s.step = snap.step;
    } else {
      s.cells.fill(0);
      s.step = 0;
    }
  }
  const limit = s.step + 600;
  while (s.step < target && s.step < limit) {
    stepSand(s, score, s.step * DT);
    if (s.step % Math.round(SNAP_EVERY / DT) === 0 && !s.snaps.some((x) => x.step === s!.step)) {
      if (s.snaps.length >= MAX_SNAPS) s.snaps.splice(1, 1);
      s.snaps.push({ step: s.step, cells: s.cells.slice() });
    }
  }

  const dark = isDark(score);
  const bg = rgbOf(st.background);
  const acc = rgbOf(st.accent);
  const ch = Hc / h;
  const shelfY = (s.shelf + 1) * ch;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // The liquid: the background, tinted toward the accent, lit from above.
  const tint = (k: number) => bg.map((c, i) => c + (acc[i] - c) * k);
  const liquid = ctx.createLinearGradient(0, 0, 0, Hc);
  liquid.addColorStop(0, css(tint(dark ? 0.16 : 0.1).map((c) => c * (dark ? 1.15 : 1))));
  liquid.addColorStop(1, css(tint(dark ? 0.06 : 0.04).map((c) => c * (dark ? 0.85 : 0.97))));
  ctx.fillStyle = liquid;
  ctx.fillRect(0, 0, Wc, Hc);

  // The reservoir along the top: strata of the key's colours, gently wavy, resting on a shelf.
  const key = harmonyKeyAt(score, t, dark);
  const tonic = key.tonic;
  // (Muted toward the background: it's the store, the falling sand is the show.)
  const strata = [0, 7, 4, 9, 2, 5, 11].map((iv) => harmonyRgb(60 + tonic + iv, key).map((x, i) => x * 255 * 0.55 + bg[i] * 0.45));
  const bands = strata.length;
  for (let b = 0; b < bands; b++) {
    const y0 = (b / bands) * shelfY;
    const y1 = ((b + 1) / bands) * shelfY;
    ctx.fillStyle = css(strata[b].map((c) => c * 0.85));
    ctx.beginPath();
    ctx.moveTo(0, y1);
    for (let x = 0; x <= 24; x++) ctx.lineTo((x / 24) * Wc, y0 + Math.sin(x * 0.9 + b * 1.7) * ch * 1.2);
    ctx.lineTo(Wc, y1 + ch);
    ctx.lineTo(0, y1 + ch);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = css(bg.map((c) => c * (dark ? 0.6 : 0.82)));
  ctx.fillRect(0, shelfY - ch * 0.6, Wc, ch * 0.9);

  // The grains, one pixel per cell, lit from above (a grain with liquid over it catches the light).
  if (!image || image.w !== w || image.h !== h) {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const c2 = canvas.getContext('2d') as CanvasRenderingContext2D;
    const img = c2.createImageData(w, h);
    image = { w, h, canvas, ctx: c2, img, px: new Uint32Array(img.data.buffer) };
  }
  const px = image.px;
  const cells = s.cells;
  for (let i = 0; i < w * h; i++) {
    const c = cells[i];
    if (!c) {
      px[i] = 0;
      continue;
    }
    if (i >= w && !cells[i - w]) {
      // Surface grain: a touch lighter.
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

  // Air bubbles rising through the liquid: a steady few, and bursts on snares and crashes.
  const bubble = (x: number, y: number, r: number, a: number) => {
    ctx.strokeStyle = `rgba(255,255,255,${(0.35 * a).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, r * 0.18);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${(0.5 * a).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
  };
  const R = Math.max(2, Wc * 0.006);
  const travel = Hc - shelfY;
  for (let i = 0; i < (lite ? 8 : 14); i++) {
    const per = 7 + 5 * hash(i, 1, 9);
    const ph = ((t + hash(i, 2, 9) * per) % per) / per;
    const y = Hc - ph * travel;
    const x = (hash(i, 3, 9) + 0.02 * Math.sin(t * 2 + i)) * Wc;
    bubble(x, y, R * (0.6 + 0.8 * hash(i, 4, 9)), Math.min(1, ph * 6) * Math.min(1, (1 - ph) * 8));
  }
  if (score.drums) {
    for (const hit of drumHits(score, t - 4, t + 1e-6)) {
      if (hit.voice !== 'snare' && hit.voice !== 'crash') continue;
      const age = t - hit.t;
      const seed = Math.round(hit.t * 1000);
      const cx = (0.15 + 0.7 * hash(seed, 1, 8)) * Wc;
      for (let k = 0; k < 7; k++) {
        const speed = (0.18 + 0.12 * hash(seed, k, 2)) * travel;
        const y = Hc * 0.92 - age * speed;
        if (y < shelfY) continue;
        const x = cx + (hash(seed, k, 3) - 0.5) * Wc * 0.08 + Math.sin(age * 3 + k) * Wc * 0.01;
        bubble(x, y, R * (0.5 + 0.9 * hash(seed, k, 4)) * hit.vel, Math.min(1, age * 5) * Math.min(1, (y - shelfY) / (Hc * 0.05)));
      }
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
