/**
 * Sand art: the liquid sand picture (glass, coloured sand, liquid and trapped air), simulated.
 *
 * Like the toy, there's one mass of sand and it only goes down: a layered mountain (two colours
 * from the key, streaked with white, flecked with gold) rests on a band of foam across the middle
 * of the glass. Sand falls only through holes in the foam: the mountain above drains into craters
 * over each hole, and the same sand builds a new landscape below. Nothing is recoloured; the
 * colours change because different strata drain through.
 *
 * The music moves the holes. One stream follows the bass (low notes to the left) and one the top
 * voice (high notes to the right), so chord changes and glides shift where they pour and carve
 * peaks; louder notes pour faster. A snare pops a bubble open for a moment (an extra short
 * stream). Kicks jolt the frame and set off avalanches down the slopes below (crashes, bigger).
 * The flow is paced so the mountain empties as the piece ends (whatever its length), when the foam
 * gives way and the last of it falls as a curtain. Endless and looping pieces flip the glass over
 * when the top runs out, like turning the toy.
 *
 * A falling-sand automaton on one grid, stepped at a fixed rate from the start of the piece (with
 * snapshots, so jumping back is quick): exports match playback. Drawn in the picture's own
 * coordinates, so zoom works.
 */
import { chordIndexAt, drumHits, levelAt, voiceNotesAt } from '../engine/motion';
import { mulberry32 } from '../engine/rng';
import type { Score } from '../engine/score';
import { harmonyKeyAt, harmonyRgb } from './harmony-color';
import { skyRange, type ViewArea, type ViewStyle } from './harmony-views';

const DT = 1 / 60;
const SNAP_EVERY = 2; // s between snapshots
const MAX_SNAPS = 60;
const WALL = 1; // a cell of the foam band (not sand)
const FLIP_STEPS = 90; // the glass turning over (endless and looping pieces)
const CYCLE = 75; // s for the mountain to empty, between flips, in endless and looping pieces

interface Sand {
  w: number;
  h: number;
  /** 0 = liquid, WALL = foam, else a grain (packed ImageData pixel). */
  cells: Uint32Array;
  step: number;
  key: string;
  /** The foam band's row. */
  shelf: number;
  /** Throughput of an open hole (paced so the mountain empties on time). */
  pace: number;
  /** The two sand colours and white (for what pours through). */
  cols: [number, number, number][];
  /** Endless and looping pieces flip the glass when the top runs out. */
  flips: boolean;
  /** Step a flip began (-1: none under way), and when the current cycle began (s). */
  flipAt: number;
  cycleStart: number;
  snaps: { step: number; cells: Uint32Array; pace: number; flipAt: number; cycleStart: number }[];
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

const pack = (r: number, g: number, b: number) => {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  return ((255 << 24) | (c(b) << 16) | (c(g) << 8) | c(r)) >>> 0;
};

/** The toy's sand: two contrasting colours from the key (its tonic's and its third's, four fifths apart), with white between. */
function sandColours(score: Score): [number, number, number][] {
  const key = harmonyKeyAt(score, score.gridStart, isDark(score));
  const tone = (p: number) => harmonyRgb(p, key).map((x) => (x * 0.85 + 0.12) * 255) as [number, number, number];
  return [tone(60 + key.tonic), [244, 241, 232], tone(64 + key.tonic), [244, 241, 232]];
}

/**
 * The sand that comes through the foam is layered by the music: each chord pours its own colour
 * (the two colours by turns), with a thin streak of white at each change and a fleck of gold now
 * and then, so the landscape below is laid down in strata, a band per chord.
 */
function pouredGrain(score: Score, cols: [number, number, number][], time: number, j: number, j2: number): number {
  const k = Math.max(0, chordIndexAt(score, time));
  const since = time - (score.chords[k]?.t ?? 0);
  let c: [number, number, number];
  if (j2 > 0.985) c = [232, 192, 104];
  else if (since < 0.28 && k > 0) c = [244, 241, 232];
  else c = cols[(k % 2) * 2];
  const v = 0.84 + 0.3 * j;
  return pack(c[0] * v, c[1] * v, c[2] * v);
}

function makeSim(score: Score, w: number, h: number, key: string): Sand {
  const shelf = Math.floor((h - 1) / 2);
  const cells = new Uint32Array(w * h);
  for (let x = 0; x < w; x++) cells[shelf * w + x] = WALL;
  // The mountain: a few sharp-topped peaks over a base layer, laid in wavy strata.
  const rnd = mulberry32(score.seed ^ 0x5a17);
  const peaks = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => ({ x: 0.12 + 0.76 * rnd(), hgt: 0.6 + 0.4 * rnd(), wid: 0.18 + 0.2 * rnd() }));
  const cols = sandColours(score);
  const gold: [number, number, number] = [232, 192, 104];
  const top = shelf * 0.82;
  const strata: number[] = [];
  for (let y = 0, i = 0; y < shelf * 2; i++) {
    const thick = i % 2 ? 1 + Math.floor(rnd() * 3) : 4 + Math.floor(rnd() * 9);
    for (let k = 0; k < thick; k++) strata.push(i);
    y += thick;
  }
  for (let x = 0; x < w; x++) {
    let m = 0;
    for (const pk of peaks) m = Math.max(m, pk.hgt * Math.max(0, 1 - Math.abs(x / w - pk.x) / pk.wid) ** 1.2);
    const height = Math.round(top * (0.28 + 0.72 * m));
    const wave = Math.sin(x * 0.045 + 1.3) * 3 + Math.sin(x * 0.11) * 1.5;
    for (let d = 1; d <= height; d++) {
      const y = shelf - d;
      // Strata bend up under the peaks (the layers were laid as the mountain grew).
      const depth = Math.max(0, Math.round(d * (0.6 + 0.4 * (1 - m)) + wave));
      const s = strata[Math.min(strata.length - 1, depth)] ?? 0;
      const c = hash(x, y, 7) > 0.985 ? gold : cols[s % cols.length];
      const k = 0.84 + 0.3 * hash(x, y, 8);
      cells[y * w + x] = pack(c[0] * k, c[1] * k, c[2] * k);
    }
  }
  const flips = score.loop || !Number.isFinite(score.timeline.arrivalStart);
  return { w, h, cells, step: 0, key, shelf, pace: 0.6, cols, flips, flipAt: -1, cycleStart: 0, snaps: [] };
}

/** The holes open at t: the bass's and the top voice's streams, snare pops, or the foam giving way at the end. */
function holesAt(score: Score, s: Sand, t: number): { x: number; f: number }[] {
  if (t < score.gridStart) return [];
  const tl = score.timeline;
  if (!s.flips && t >= tl.arrivalStart) {
    // The end: the foam gives way all along, and the rest falls as a curtain.
    const out: { x: number; f: number }[] = [];
    for (let x = 2; x < s.w - 2; x += 5) out.push({ x, f: 1 });
    return out;
  }
  const { lo, span } = skyRange(score);
  const V = score.config.voices;
  const out: { x: number; f: number }[] = [];
  const stream = (v: number, side: number) => {
    const nt = voiceNotesAt(score, v, t).sort((a, b) => b.g - a.g)[0];
    if (!nt) return;
    const f = levelAt(score, v, t) * nt.g;
    if (f < 0.05) return;
    const u = Math.max(0, Math.min(1, (nt.p - lo) / span));
    // The bass pours over the left part of the glass, the top voice over the right, wandering a
    // little as the foam shifts.
    const fx = side < 0 ? 0.08 + 0.5 * u : 0.42 + 0.5 * u;
    out.push({ x: Math.round(fx * (s.w - 1) + Math.sin(t * 0.31 + side) * 2.5), f });
  };
  stream(0, -1);
  if (V > 1) stream(V - 1, 1);
  if (score.drums) {
    for (const hit of drumHits(score, t - 0.6, t + 1e-6)) {
      if (hit.voice !== 'snare') continue;
      const seed = Math.round(hit.t * 1000);
      out.push({ x: Math.round((0.1 + 0.8 * hash(seed, 1, 3)) * (s.w - 1)), f: 0.8 * hit.vel });
    }
  }
  return out;
}

function stepSand(s: Sand, score: Score, time: number) {
  const { w, h, cells, shelf } = s;
  const n = s.step;
  // A flip under way: the glass turns over, then the sand is upside down (and falls onto the foam).
  if (s.flipAt >= 0) {
    if (n - s.flipAt >= FLIP_STEPS) {
      for (let y = 0; y < Math.floor(h / 2); y++) {
        const a = cells.slice(y * w, y * w + w);
        cells.copyWithin(y * w, (h - 1 - y) * w, (h - y) * w);
        cells.set(a, (h - 1 - y) * w);
      }
      for (let x = 0; x < w; x++) cells[shelf * w + x] = WALL;
      s.flipAt = -1;
      s.cycleStart = time;
    }
    s.step++;
    return;
  }
  // Pace the flow so the mountain empties on time: recount what's left now and then.
  if (n % 30 === 0) {
    let above = 0;
    for (let i = 0; i < shelf * w; i++) if (cells[i] > WALL) above++;
    const tl = score.timeline;
    const left = s.flips ? Math.max(4, s.cycleStart + CYCLE - time) : Math.max(2, tl.arrivalStart - time);
    s.pace = Math.max(0.04, Math.min(1, above / (left * 60 * 1.6)));
    if (s.flips && above < 40 && time - s.cycleStart > 8) s.flipAt = n;
  }
  // The foam: closed everywhere except the holes open this step.
  for (let x = 0; x < w; x++) if (!cells[shelf * w + x]) cells[shelf * w + x] = WALL;
  for (const hole of holesAt(score, s, time)) {
    const open = Math.min(1, s.pace * (0.35 + 0.65 * hole.f));
    if (hash(n, hole.x, 41) >= open) continue;
    for (let d = 0; d < (hole.f > 0.6 ? 2 : 1); d++) {
      const x = hole.x + d;
      if (x >= 0 && x < w && cells[shelf * w + x] === WALL) cells[shelf * w + x] = 0;
    }
  }
  // Falling: two cells a step at most; straight down if it can, else off diagonally. Above the foam
  // the sand is packed, so it only slips now and then (craters open over the holes, peaks stand);
  // below, wet sand runs a little further, so the landscape settles into slopes.
  for (let sub = 0; sub < 2; sub++) {
    const ltr = (n + sub) % 2 === 0;
    for (let y = h - 2; y >= 0; y--) {
      const row = y * w;
      const up = y < shelf;
      for (let k = 0; k < w; k++) {
        const x = ltr ? k : w - 1 - k;
        const i = row + x;
        const c = cells[i];
        if (c <= WALL) continue;
        const below = i + w;
        if (!cells[below]) {
          // Through a hole in the foam: it comes out as the music's layer (see pouredGrain).
          cells[below] = y === shelf - 1 ? pouredGrain(score, s.cols, time, hash(x, n, 51), hash(x, n, 52)) : c;
          cells[i] = 0;
          continue;
        }
        if (up && hash(x, y, n * 2 + sub) > 0.22) continue;
        const first = hash(x, y, n * 2 + sub + 1) < 0.5 ? -1 : 1;
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
        if (!moved && !up && hash(x, y, n * 3 + sub + 7) < 0.5) {
          const nx = x + 2 * first;
          if (nx >= 0 && nx < w && !cells[i + first] && !cells[i + 2 * first] && !cells[below + 2 * first]) {
            cells[below + 2 * first] = c;
            cells[i] = 0;
          }
        }
      }
    }
  }
  // Kicks jolt the frame: avalanches down the slopes below (crashes shake harder).
  for (const hit of drumHits(score, time, time + DT)) {
    if (hit.voice !== 'kick' && hit.voice !== 'crash') continue;
    const passes = Math.max(1, Math.round((hit.voice === 'crash' ? 6 : 3) * hit.vel));
    const tops = new Int32Array(w);
    for (let x = 0; x < w; x++) {
      let y = shelf + 1;
      while (y < h && !cells[y * w + x]) y++;
      tops[x] = y;
    }
    for (let pass = 0; pass < passes; pass++) {
      for (let x = 0; x < w; x++) {
        const y = tops[x];
        if (y >= h) continue;
        const d = hash(x, n + pass, 6) < 0.5 ? -1 : 1;
        for (const dd of [d, -d]) {
          const nx = x + dd;
          if (nx < 0 || nx >= w || tops[nx] - y < 2) continue;
          cells[(tops[nx] - 1) * w + nx] = cells[y * w + x];
          cells[y * w + x] = 0;
          tops[nx]--;
          tops[x]++;
          break;
        }
      }
    }
  }
  s.step++;
}

let image: { w: number; h: number; canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D; img: ImageData; px: Uint32Array } | null = null;
const foamCache = new WeakMap<Sand, { x: number; y: number; r: number }[]>();

const rgbOf = (hex: string): [number, number, number] => {
  const n = /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0x808080;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const css = (c: number[], a = 1) => `rgba(${c.map((x) => Math.round(Math.max(0, Math.min(255, x)))).join(',')},${a})`;

export function drawSand(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea, lite = false) {
  const Wc = a.width;
  const Hc = a.height ?? a.bottom + a.top;
  const shape = (Math.round((Hc / Wc) * 20) / 20).toFixed(2);
  let s = sims.get(score);
  if (!s || !s.key.startsWith(shape + '/')) {
    const w = lite ? 150 : 220;
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
    const from = snap ?? { ...makeSim(score, w, h, sim.key), step: 0 };
    sim.cells.set(from.cells);
    sim.step = from.step;
    sim.pace = from.pace;
    sim.flipAt = from.flipAt;
    sim.cycleStart = from.cycleStart;
  }
  const limit = sim.step + 600;
  while (sim.step < target && sim.step < limit) {
    stepSand(sim, score, sim.step * DT);
    if (sim.step % Math.round(SNAP_EVERY / DT) === 0 && !sim.snaps.some((x) => x.step === sim.step)) {
      if (sim.snaps.length >= MAX_SNAPS) sim.snaps.splice(1, 1);
      sim.snaps.push({ step: sim.step, cells: sim.cells.slice(), pace: sim.pace, flipAt: sim.flipAt, cycleStart: sim.cycleStart });
    }
  }

  const dark = isDark(score);
  const bg = rgbOf(st.background);
  const acc = rgbOf(st.accent);
  const cs = Wc / w;
  const ch = Hc / h;
  ctx.save();
  // The liquid: the background, tinted toward the accent, lit from above.
  const tint = (k: number) => bg.map((c, i) => c + (acc[i] - c) * k);
  const liquid = ctx.createLinearGradient(0, 0, 0, Hc);
  liquid.addColorStop(0, css(tint(dark ? 0.14 : 0.08).map((c) => c * (dark ? 1.15 : 1))));
  liquid.addColorStop(1, css(tint(dark ? 0.05 : 0.03).map((c) => c * (dark ? 0.85 : 0.97))));
  ctx.fillStyle = liquid;
  ctx.fillRect(0, 0, Wc, Hc);
  // Turning over (endless and looping pieces).
  if (sim.flipAt >= 0) {
    const u = Math.min(1, (sim.step - sim.flipAt) / FLIP_STEPS);
    const e = u * u * (3 - 2 * u);
    ctx.translate(Wc / 2, Hc / 2);
    ctx.rotate(Math.PI * e);
    ctx.translate(-Wc / 2, -Hc / 2);
  }

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
    if (c <= WALL) {
      px[i] = 0;
      continue;
    }
    if (i >= w && cells[i - w] <= WALL) {
      const r = Math.min(255, (c & 255) * 1.15 + 12);
      const g = Math.min(255, ((c >> 8) & 255) * 1.15 + 12);
      const b = Math.min(255, ((c >> 16) & 255) * 1.15 + 12);
      px[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
    } else px[i] = c;
  }
  image.ctx.putImageData(image.img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image.canvas as CanvasImageSource, 0, 0, Wc, Hc);
  ctx.imageSmoothingEnabled = true;

  // The foam: a band of bubbles of all sizes, a couple deep and uneven, under the mountain; open
  // holes are gaps where the sand runs through.
  let foam = foamCache.get(sim);
  if (!foam) {
    foam = [];
    for (let row = 0; row < 3; row++) {
      for (let x = hash(row, 1, 5) * 2, i = 0; x < w; i++) {
        const big = hash(i, row, 61) < (row === 0 ? 0.1 : 0.04);
        const r = big ? 1.3 + 2.3 * hash(i, row, 62) : 0.35 + 0.6 * hash(i, row, 63);
        if (hash(i, row, 64) < 0.75 - row * 0.28) foam.push({ x: x + r, y: sim.shelf + 0.5 + row * 0.9 + hash(i, row, 65) * 0.8 + r * 0.6, r });
        x += 2 * r * (0.9 + 0.3 * hash(i, row, 66));
      }
    }
    foamCache.set(sim, foam);
  }
  const gaps = sim.flipAt >= 0 ? [] : holesAt(score, sim, t).map((hh) => hh.x);
  for (const b of foam) {
    if (gaps.some((g) => Math.abs(g - b.x) < b.r + 1.2)) continue;
    const x = b.x * cs;
    const y = b.y * ch;
    const r = b.r * cs * (1 + 0.04 * Math.sin(t * 1.7 + b.x * 3));
    ctx.fillStyle = `rgba(255,255,255,${dark ? 0.1 : 0.32})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${dark ? 0.42 : 0.8})`;
    ctx.lineWidth = Math.max(0.6, r * 0.18);
    ctx.stroke();
    if (r > 2.2) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(x - r * 0.35, y - r * 0.32, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The glass: a soft sheen down each side.
  const sheen = ctx.createLinearGradient(0, 0, Wc, 0);
  sheen.addColorStop(0.04, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.07, `rgba(255,255,255,${dark ? 0.06 : 0.14})`);
  sheen.addColorStop(0.12, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.9, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.93, `rgba(255,255,255,${dark ? 0.04 : 0.09})`);
  sheen.addColorStop(0.95, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, Wc, Hc);
  ctx.restore();
}
