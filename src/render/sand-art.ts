/**
 * Sand art: the round liquid sand picture on its stand, simulated, bubbles and all.
 *
 * Like the toy: a round glass, clear liquid, and one mass of fine coloured sand. A ridge of sharp
 * peaks rests on a row of soft air bubbles across the glass; the bubbles press against each other
 * and pull back together like foam, and wherever two part, sand trickles through the gap between
 * them and builds a new range of peaks in the bowl below, laid in wavy strata. Streams start, stop,
 * widen and wander as the foam shifts.
 *
 * The music moves the foam: each sounding voice (the bass to the left, the middle voice, the top
 * voice to the right) presses the bubbles apart at its pitch, so chord changes move where gaps open
 * and the peaks build; every chord change jostles the row; a snare pops a bubble (it re-forms a
 * moment later), letting a rush through; kicks jiggle the foam and send small avalanches down the
 * slopes below (crashes, bigger ones). Each chord pours its own colour (the key's two by turns, with
 * a streak of white at each change), so the range is layered a band per chord. How hard the voices
 * press is paced so the ridge empties as the piece ends, however long it is. Endless and looping
 * pieces turn the glass over when the top runs out.
 *
 * A falling-sand automaton on a square grid (cells outside the circle are glass) with the bubbles as
 * soft discs, stepped at a fixed rate from the start of the piece (with snapshots, so jumping back
 * is quick), so exports match playback. Drawn smooth with a fine grain texture, in the picture's own
 * coordinates (zoom works).
 */
import { chordIndexAt, drumHits, levelAt, voiceNotesAt } from '../engine/motion';
import { mulberry32 } from '../engine/rng';
import type { Score } from '../engine/score';
import { harmonyKeyAt, harmonyRgb } from './harmony-color';
import { skyRange, type ViewArea, type ViewStyle } from './harmony-views';

const DT = 1 / 60;
const SNAP_EVERY = 2; // s between snapshots
const MAX_SNAPS = 60;
const WALL = 1; // glass (outside the circle) or the bubble row (not sand)
const FLIP_STEPS = 100; // the glass turning over (endless and looping pieces)
const CYCLE = 80; // s for the top to empty between turns, in endless and looping pieces

interface Sand {
  n: number;
  cells: Uint32Array;
  /** Cells inside the glass. */
  inside: Uint8Array;
  /** Cells inside a bubble this step (sand can't enter). */
  air: Uint8Array;
  step: number;
  key: string;
  /** The bubble row's line (bubbles hang from it). */
  shelf: number;
  /** The two sand colours (for what pours through). */
  cols: [number, number, number][];
  /** The bubbles: centre x, radius, velocity, and pop (seconds until re-formed). */
  bx: Float32Array;
  br: Float32Array;
  bv: Float32Array;
  bpop: Float32Array;
  /** How hard the voices press the bubbles apart. */
  push: number;
  /** How freely sand slips through a gap (paced so the top empties on time). */
  gate: number;
  above: number;
  lastChord: number;
  flips: boolean;
  flipAt: number;
  cycleStart: number;
  snaps: { step: number; cells: Uint32Array; bx: Float32Array; bv: Float32Array; bpop: Float32Array; push: number; gate: number; above: number; lastChord: number; flipAt: number; cycleStart: number }[];
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
const WHITE: [number, number, number] = [246, 244, 238];
const GOLD: [number, number, number] = [226, 186, 98];

/** The toy's sand: two contrasting colours from the key (its tonic's and its third's). */
function sandColours(score: Score): [number, number, number][] {
  const key = harmonyKeyAt(score, score.gridStart, isDark(score));
  const tone = (p: number) => harmonyRgb(p, key).map((x) => (x * 0.9 + 0.06) * 255) as [number, number, number];
  return [tone(60 + key.tonic), tone(64 + key.tonic)];
}

/** What comes through: the chord's colour (the two by turns), a streak of white at each change, a fleck of gold. */
function pouredGrain(score: Score, cols: [number, number, number][], time: number, j: number, j2: number): number {
  const k = Math.max(0, chordIndexAt(score, time));
  const since = time - (score.chords[k]?.t ?? 0);
  const c = j2 > 0.985 ? GOLD : since < 0.35 && k > 0 ? WHITE : j2 < 0.12 ? WHITE : cols[k % 2];
  const v = 0.86 + 0.26 * j;
  return pack(c[0] * v, c[1] * v, c[2] * v);
}

/** Where the bubble row meets the glass, left and right (columns). */
function rowEnds(n: number, shelf: number): [number, number] {
  const R = n / 2 - 0.5;
  const half = Math.sqrt(Math.max(0, (R - 1) ** 2 - (shelf - R) ** 2));
  return [R - half, R + half];
}

/** Mark the cells inside the bubbles (a bubble hangs just below the line, its top a little above). */
function rasterBubbles(s: Sand) {
  const { n, air, bx, br, bpop, shelf } = s;
  air.fill(0);
  for (let i = 0; i < bx.length; i++) {
    const r = br[i] * (1 - Math.min(1, bpop[i] / 1.4));
    if (r < 0.6) continue;
    const cy = shelf + 0.35 * br[i];
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(n - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(bx[i] - r)); x <= Math.min(n - 1, Math.ceil(bx[i] + r)); x++) {
        if ((x - bx[i]) ** 2 + (y - cy) ** 2 <= r * r) air[y * n + x] = 1;
      }
    }
  }
}

function makeSim(score: Score, n: number, key: string): Sand {
  const cells = new Uint32Array(n * n);
  const inside = new Uint8Array(n * n);
  const R = n / 2 - 0.5;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if ((x - R) ** 2 + (y - R) ** 2 <= (R - 0.5) ** 2) inside[i] = 1;
      else cells[i] = WALL;
    }
  }
  const shelf = Math.round(n * 0.4);
  // The bubbles: a packed row of mixed sizes, a few big, pressed a little into each other.
  const [left, right] = rowEnds(n, shelf);
  const xs: number[] = [];
  const rs: number[] = [];
  for (let x = left, i = 0; ; i++) {
    const r = hash(i, score.seed, 71) < 0.13 ? 4.2 + 2.6 * hash(i, score.seed, 72) : 2 + 1.5 * hash(i, score.seed, 73);
    if (x + 2 * r > right) break;
    xs.push(x + r);
    rs.push(r);
    x += 2 * r - 0.4;
  }
  const flips = score.loop || !Number.isFinite(score.timeline.arrivalStart);
  const s: Sand = {
    n, cells, inside, air: new Uint8Array(n * n), step: 0, key, shelf, cols: sandColours(score),
    bx: Float32Array.from(xs), br: Float32Array.from(rs), bv: new Float32Array(xs.length), bpop: new Float32Array(xs.length),
    push: 0.15, gate: 0.4, above: 0, lastChord: -1, flips, flipAt: -1, cycleStart: 0, snaps: [],
  };
  rasterBubbles(s);
  // The ridge: sharp peaks of layered sand resting on the bubbles, kept inside the glass.
  const rnd = mulberry32(score.seed ^ 0x5a17);
  const room = shelf - 2;
  // (Sharp peaks at sand's natural 45° slope, so they stand: a cell up for every cell across.)
  const peaks = Array.from({ length: 3 + Math.floor(rnd() * 3) }, () => ({ x: (0.12 + 0.76 * rnd()) * n, top: room * (0.55 + 0.4 * rnd()) }));
  const floor = room * 0.22;
  for (let x = 0; x < n; x++) {
    let hgt = floor;
    for (const pk of peaks) hgt = Math.max(hgt, pk.top - Math.abs(x - pk.x) * (0.95 + 0.1 * hash(x, 3, 17)));
    const m = Math.max(0, Math.min(1, (hgt - floor) / Math.max(1, room - floor)));
    const want = Math.round(hgt);
    const wave = Math.sin(x * 0.05 + 1.3) * 3 + Math.sin(x * 0.13) * 1.5;
    // Resting on the bubbles: down to the first bubble (or the line, between them).
    let base = shelf;
    for (let y = shelf - 8; y <= shelf; y++) if (s.air[y * n + x]) {
      base = y;
      break;
    }
    for (let d = 1; d <= want; d++) {
      const y = base - d;
      const i = y * n + x;
      if (y < 0 || !inside[i]) break;
      // Strata: broad colour bands with thin white seams, bent up under the peaks, swirled a little.
      const depth = d * (0.55 + 0.45 * (1 - m)) + wave + Math.sin(d * 0.21 + x * 0.03) * 2;
      const band = Math.floor(depth / 7);
      const seam = depth % 7 < 1.2;
      const c = hash(x, y, 7) > 0.985 ? GOLD : seam || hash(x, y, 9) < 0.1 ? WHITE : s.cols[band % 2];
      const k = 0.86 + 0.26 * hash(x, y, 8);
      cells[i] = pack(c[0] * k, c[1] * k, c[2] * k);
    }
  }
  for (let i = 0; i < shelf * n; i++) if (cells[i] > WALL) s.above++;
  return s;
}

/** Where the voices press the bubbles apart at t (columns), with how hard: bass, top voice, middle voice. */
function pressAt(score: Score, s: Sand, t: number): { x: number; f: number }[] {
  if (t < score.gridStart) return [];
  const { lo, span } = skyRange(score);
  const V = score.config.voices;
  const { n, cells, shelf } = s;
  const out: { x: number; f: number }[] = [];
  // (Where there's still sand over the spot, or else the nearest place there is.)
  const hasSand = (x: number) => x > 1 && x < n - 2 && (cells[(shelf - 6) * n + x] > WALL || cells[(shelf - 3) * n + x] > WALL);
  const at = (v: number, a: number, b: number) => {
    const nt = voiceNotesAt(score, v, t).sort((x, y) => y.g - x.g)[0];
    if (!nt) return;
    const f = levelAt(score, v, t) * nt.g;
    if (f < 0.05) return;
    const want = Math.round((a + (b - a) * Math.max(0, Math.min(1, (nt.p - lo) / span))) * (n - 1));
    for (let d = 0; d < n; d++) {
      const x = hasSand(want - d) ? want - d : hasSand(want + d) ? want + d : -1;
      if (x >= 0) {
        out.push({ x, f });
        return;
      }
    }
  };
  at(0, 0.2, 0.55);
  if (V > 1) at(V - 1, 0.45, 0.8);
  if (V > 2) at(Math.floor(V / 2), 0.33, 0.67);
  return out;
}

/** The foam: bubbles pushed apart by the voices, pulled back together, jostled by the drums. */
function stepBubbles(s: Sand, score: Score, time: number) {
  const { bx, br, bv, bpop, n, shelf } = s;
  const m = bx.length;
  const step = s.step;
  const eff = (i: number) => br[i] * (1 - Math.min(1, bpop[i] / 1.4));
  const F = new Float32Array(m);
  for (const c of pressAt(score, s, time)) {
    for (let i = 0; i < m; i++) {
      const d = bx[i] - c.x;
      F[i] += s.push * c.f * Math.sign(d || 1) * Math.exp(-Math.abs(d) / 9);
    }
  }
  // Like foam, parted bubbles pull back together.
  for (let i = 0; i + 1 < m; i++) {
    const gap = bx[i + 1] - bx[i] - eff(i) - eff(i + 1);
    if (gap > 0) {
      F[i] += 0.025 * gap;
      F[i + 1] -= 0.025 * gap;
    }
  }
  // A chord change jostles the row; kicks jiggle it; a snare pops a bubble.
  const k = chordIndexAt(score, time);
  const jostle = k !== s.lastChord && s.lastChord >= 0 ? 0.5 : 0;
  s.lastChord = k;
  let jiggle = 0.015;
  for (const hit of drumHits(score, time, time + DT)) {
    if (hit.voice === 'kick') jiggle += 0.25 * hit.vel;
    if (hit.voice === 'snare') {
      const target = (0.2 + 0.6 * hash(Math.round(hit.t * 1000), 1, 3)) * (n - 1);
      let best = 0;
      for (let i = 1; i < m; i++) if (Math.abs(bx[i] - target) < Math.abs(bx[best] - target)) best = i;
      bpop[best] = 1.4;
    }
  }
  for (let i = 0; i < m; i++) {
    F[i] += (hash(i, step, 91) - 0.5) * (jiggle + jostle);
    bv[i] = (bv[i] + F[i]) * 0.8;
    bx[i] += bv[i];
    if (bpop[i] > 0) bpop[i] = Math.max(0, bpop[i] - DT);
  }
  // They press into each other a little, never through; the glass holds the row's ends.
  const [left, right] = rowEnds(n, shelf);
  for (let it = 0; it < 4; it++) {
    for (let i = 0; i + 1 < m; i++) {
      const need = eff(i) + eff(i + 1) - 0.5 - (bx[i + 1] - bx[i]);
      if (need > 0) {
        bx[i] -= need / 2;
        bx[i + 1] += need / 2;
      }
    }
    bx[0] = Math.max(bx[0], left + br[0] * 0.7);
    bx[m - 1] = Math.min(bx[m - 1], right - br[m - 1] * 0.7);
  }
  rasterBubbles(s);
}

/** Columns where two bubbles have parted (sand can get through), for drawing and for where sand slides in. */
function gapsOf(s: Sand): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < s.bx.length; i++) {
    const a = s.bx[i] + s.br[i] * (1 - Math.min(1, s.bpop[i] / 1.4));
    const b = s.bx[i + 1] - s.br[i + 1] * (1 - Math.min(1, s.bpop[i + 1] / 1.4));
    if (b - a >= 0.8) out.push(Math.round((a + b) / 2));
  }
  return out;
}

function stepSand(s: Sand, score: Score, time: number) {
  const { n, cells, shelf } = s;
  const step = s.step;
  if (s.flipAt >= 0) {
    // Turning over: when it's done the sand is upside down, and the bubbles hold it again.
    if (step - s.flipAt >= FLIP_STEPS) {
      for (let y = 0; y < Math.floor(n / 2); y++) {
        const a = cells.slice(y * n, y * n + n);
        cells.copyWithin(y * n, (n - 1 - y) * n, (n - y) * n);
        cells.set(a, (n - 1 - y) * n);
      }
      s.flipAt = -1;
      s.cycleStart = time;
    }
    s.step++;
    return;
  }
  // Pace: press the bubbles apart harder or softer, so the top empties on time.
  if (step % 20 === 0) {
    let above = 0;
    for (let i = 0; i < shelf * n; i++) if (cells[i] > WALL) above++;
    const left = s.flips ? Math.max(5, s.cycleStart + CYCLE - time) : Math.max(1, score.timeline.end - 1 - time);
    const want = above / (left * 60);
    const got = Math.max(0, s.above - above) / 20;
    // Slower than planned: bubbles part more and let sand through more freely; faster: less.
    if (time > score.gridStart + 1) {
      const adj = Math.max(0.75, Math.min(1.3, Math.pow((want + 0.02) / (got + 0.02), 0.4)));
      s.gate = Math.max(0.01, Math.min(1, s.gate * adj));
      s.push = Math.max(0.04, Math.min(1.2, s.push * Math.sqrt(adj)));
    }
    s.above = above;
    if (s.flips && above < 30 && time - s.cycleStart > 10) s.flipAt = step;
  }
  stepBubbles(s, score, time);
  const air = s.air;
  const near = new Uint8Array(n);
  for (const g of gapsOf(s)) for (let d = -20; d <= 20; d++) if (g + d >= 0 && g + d < n) near[g + d] = 1;
  // Falling: two cells a step at most, straight down if it can, else off diagonally (so piles stand
  // at the sand's natural angle, as peaks). Packed sand above the bubbles only slides near an open
  // gap, so funnels open over the gaps and the ridge's peaks stand. Bottom-up, alternating.
  for (let sub = 0; sub < 2; sub++) {
    const ltr = (step + sub) % 2 === 0;
    for (let y = n - 2; y >= 0; y--) {
      const row = y * n;
      const up = y < shelf;
      for (let k = 0; k < n; k++) {
        const x = ltr ? k : n - 1 - k;
        const i = row + x;
        const c = cells[i];
        if (c <= WALL) continue;
        const below = i + n;
        if (!cells[below] && !air[below] && (y !== shelf - 1 || hash(x, step, 55 + sub) < s.gate)) {
          cells[below] = y === shelf - 1 ? pouredGrain(score, s.cols, time, hash(x, step, 51), hash(x, step, 52)) : c;
          cells[i] = 0;
          continue;
        }
        // (Packed sand above the bubbles slides freely near a gap, sluggishly elsewhere.)
        if (up && !near[x] && hash(x, y, step * 2 + sub) > 0.15) continue;
        const first = hash(x, y, step * 2 + sub + 1) < 0.5 ? -1 : 1;
        for (const d of [first, -first]) {
          if (!cells[below + d] && !cells[i + d] && !air[below + d] && (y !== shelf - 1 || hash(x, step, 57 + sub) < s.gate)) {
            cells[below + d] = y === shelf - 1 ? pouredGrain(score, s.cols, time, hash(x, step, 53), hash(x, step, 54)) : c;
            cells[i] = 0;
            break;
          }
        }
      }
    }
  }
  // Kicks jolt the glass: grains at the tops of steep slopes below tumble down (crashes, more).
  for (const hit of drumHits(score, time, time + DT)) {
    if (hit.voice !== 'kick' && hit.voice !== 'crash') continue;
    const passes = Math.max(1, Math.round((hit.voice === 'crash' ? 5 : 2) * hit.vel));
    const tops = new Int32Array(n);
    for (let x = 0; x < n; x++) {
      let y = shelf + 1;
      while (y < n && !cells[y * n + x]) y++;
      tops[x] = y;
    }
    for (let pass = 0; pass < passes; pass++) {
      for (let x = 1; x < n - 1; x++) {
        const y = tops[x];
        if (y >= n || cells[y * n + x] <= WALL) continue;
        const d = hash(x, step + pass, 6) < 0.5 ? -1 : 1;
        for (const dd of [d, -d]) {
          const nx = x + dd;
          if (tops[nx] - y < 3 || cells[(tops[nx] - 1) * n + nx]) continue;
          cells[(tops[nx] - 1) * n + nx] = cells[y * n + x];
          cells[y * n + x] = 0;
          tops[nx]--;
          tops[x]++;
          break;
        }
      }
    }
  }
  s.step++;
}

// ---- Drawing -------------------------------------------------------------------------------

let grid: { n: number; canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D; img: ImageData; px: Uint32Array } | null = null;
let layer: { size: number; canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D } | null = null;
let grain: CanvasPattern | null = null;
let grainOwner: CanvasRenderingContext2D | null = null;
const offscreen = (w: number, h: number) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));

/** A fine grain texture (light and dark specks), tiled over the sand at screen resolution. */
function grainPattern(c: CanvasRenderingContext2D): CanvasPattern | null {
  if (grain && grainOwner === c) return grain;
  const tile = offscreen(128, 128);
  const t = tile.getContext('2d') as CanvasRenderingContext2D;
  const img = t.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) {
    const j = hash(i, 5, 77);
    const v = j < 0.5 ? 0 : 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = Math.round(Math.abs(j - 0.5) * 2 * 110);
  }
  t.putImageData(img, 0, 0);
  grain = c.createPattern(tile as CanvasImageSource, 'repeat');
  grainOwner = c;
  return grain;
}

const rgbOf = (hex: string): [number, number, number] => {
  const n = /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0x808080;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const css = (c: number[], a = 1) => `rgba(${c.map((x) => Math.round(Math.max(0, Math.min(255, x)))).join(',')},${a})`;

export function drawSand(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea, lite = false) {
  const Wc = a.width;
  const Hc = a.height ?? a.bottom + a.top;
  const N = lite ? 170 : 240;
  let s = sims.get(score);
  if (!s || s.n !== N) {
    s = makeSim(score, N, `${N}`);
    sims.set(score, s);
  }
  const sim = s;
  // Step to t (restoring a snapshot when time jumps back; a long jump is caught up over frames).
  const target = Math.max(0, Math.floor(t / DT));
  if (target < sim.step) {
    const snap = [...sim.snaps].reverse().find((x) => x.step <= target);
    const from = snap ?? { ...makeSim(score, N, sim.key), step: 0 };
    sim.cells.set(from.cells);
    sim.bx.set(from.bx);
    sim.bv.set(from.bv);
    sim.bpop.set(from.bpop);
    sim.step = from.step;
    sim.push = from.push;
    sim.gate = from.gate;
    sim.above = from.above;
    sim.lastChord = from.lastChord;
    sim.flipAt = from.flipAt;
    sim.cycleStart = from.cycleStart;
    rasterBubbles(sim);
  }
  const limit = sim.step + 600;
  while (sim.step < target && sim.step < limit) {
    stepSand(sim, score, sim.step * DT);
    if (sim.step % Math.round(SNAP_EVERY / DT) === 0 && !sim.snaps.some((x) => x.step === sim.step)) {
      if (sim.snaps.length >= MAX_SNAPS) sim.snaps.splice(1, 1);
      sim.snaps.push({ step: sim.step, cells: sim.cells.slice(), bx: sim.bx.slice(), bv: sim.bv.slice(), bpop: sim.bpop.slice(), push: sim.push, gate: sim.gate, above: sim.above, lastChord: sim.lastChord, flipAt: sim.flipAt, cycleStart: sim.cycleStart });
    }
  }

  const dark = isDark(score);
  const bg = rgbOf(st.background);
  // The glass: a circle as wide as fits, a little above centre, on a stand.
  const D = Math.min(Wc * 0.9, Hc * 0.66);
  const cx = Wc / 2;
  const cy = Hc * 0.46;
  const R = D / 2;
  const x0 = cx - R;
  const y0 = cy - R;
  const cell = D / N;
  ctx.save();
  // The stand.
  const standTop = cy + R * 0.82;
  const standGrad = ctx.createLinearGradient(0, standTop, 0, cy + R * 1.18);
  standGrad.addColorStop(0, '#2a2a2e');
  standGrad.addColorStop(1, '#0c0c0e');
  ctx.fillStyle = standGrad;
  ctx.beginPath();
  ctx.moveTo(cx - R * 0.62, standTop);
  ctx.lineTo(cx + R * 0.62, standTop);
  ctx.lineTo(cx + R * 0.8, cy + R * 1.18);
  ctx.lineTo(cx - R * 0.8, cy + R * 1.18);
  ctx.closePath();
  ctx.fill();
  // Turning over (endless and looping pieces).
  if (sim.flipAt >= 0) {
    const u = Math.min(1, (sim.step - sim.flipAt) / FLIP_STEPS);
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI * u * u * (3 - 2 * u));
    ctx.translate(-cx, -cy);
  }
  // The liquid: clear, catching a little light.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  const liquid = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.1, cx, cy, R * 1.05);
  const clear = dark ? bg.map((c) => c * 0.7 + 30) : bg.map((c) => c * 0.4 + 150);
  liquid.addColorStop(0, css(clear.map((c) => c + 22)));
  liquid.addColorStop(1, css(clear.map((c) => c - 10)));
  ctx.fillStyle = liquid;
  ctx.fillRect(x0, y0, D, D);

  // The sand: the grid, drawn smooth at screen resolution, with a fine grain over it.
  if (!grid || grid.n !== N) {
    const canvas = offscreen(N, N);
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    const img = g.createImageData(N, N);
    grid = { n: N, canvas, ctx: g, img, px: new Uint32Array(img.data.buffer) };
  }
  const px = grid.px;
  const cells = sim.cells;
  for (let i = 0; i < N * N; i++) {
    const c = cells[i];
    px[i] = c > WALL ? c : 0;
  }
  grid.ctx.putImageData(grid.img, 0, 0);
  const scale = Math.min(2.5, Math.max(1, Math.hypot(ctx.getTransform().a, ctx.getTransform().b)));
  const size = Math.min(1600, Math.round(D * scale));
  if (!layer || layer.size !== size) {
    const canvas = offscreen(size, size);
    layer = { size, canvas, ctx: canvas.getContext('2d') as CanvasRenderingContext2D };
  }
  const L = layer.ctx;
  L.globalCompositeOperation = 'source-over';
  L.clearRect(0, 0, size, size);
  L.imageSmoothingEnabled = true;
  L.imageSmoothingQuality = 'high';
  L.drawImage(grid.canvas as CanvasImageSource, 0, 0, size, size);
  const pat = grainPattern(L);
  if (pat) {
    L.globalCompositeOperation = 'source-atop';
    L.fillStyle = pat;
    L.fillRect(0, 0, size, size);
    L.globalCompositeOperation = 'source-over';
  }
  ctx.drawImage(layer.canvas as CanvasImageSource, x0, y0, D, D);

  // The bubbles, where the simulation has them, as soap foam: clear, with a darker edge, a thin
  // bright rim, an iridescent film arcing over the top, a window reflection and a glint below;
  // tiny bubbles crowd the crevices between them.
  const soap = (bx: number, by: number, r: number, k: number) => {
    const body = ctx.createRadialGradient(bx, by, r * 0.55, bx, by, r);
    body.addColorStop(0, 'rgba(0,0,0,0)');
    body.addColorStop(0.85, dark ? 'rgba(0,0,0,0.25)' : 'rgba(40,50,70,0.22)');
    body.addColorStop(1, 'rgba(255,255,255,0.55)');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
    if (r > 2.5) {
      // The film's colours, shifting a little from bubble to bubble.
      const film = ctx.createLinearGradient(bx - r, by - r, bx + r, by);
      const turn = hash(k, 2, 93);
      const hues = ['255,90,200', '255,210,90', '90,230,255', '150,110,255', '255,90,200'];
      for (let j = 0; j < 4; j++) film.addColorStop(j / 3, `rgba(${hues[(j + Math.floor(turn * 4)) % 4]},0.5)`);
      ctx.strokeStyle = film;
      ctx.lineWidth = Math.max(1, r * 0.2);
      ctx.beginPath();
      ctx.arc(bx, by, r * 0.78, Math.PI * (1.08 + 0.1 * turn), Math.PI * (1.85 + 0.08 * turn));
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = Math.max(0.5, r * 0.06);
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.stroke();
    // A window reflection up top, a glint along the bottom.
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(bx - r * 0.35, by - r * 0.45, r * 0.22, r * 0.11, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = Math.max(0.5, r * 0.08);
    ctx.beginPath();
    ctx.arc(bx, by, r * 0.86, Math.PI * 0.25, Math.PI * 0.75);
    ctx.stroke();
  };
  for (let i = 0; i < sim.bx.length; i++) {
    const r = sim.br[i] * (1 - Math.min(1, sim.bpop[i] / 1.4)) * cell;
    if (r < cell * 0.6) continue;
    const bx = x0 + (sim.bx[i] + 0.5) * cell;
    const by = y0 + (sim.shelf + 0.35 * sim.br[i] + 0.5) * cell;
    // Tiny bubbles round its lower half and in the crevices beside it (they travel with it).
    for (let j = 0; j < 7; j++) {
      const ang = Math.PI * (0.05 + 0.9 * hash(i, j, 94));
      const rr = r * (0.12 + 0.16 * hash(i, j, 95));
      const dist = r + rr * (0.6 + 0.8 * hash(i, j, 96));
      const sx = bx + Math.cos(ang + (j % 2 ? 0 : Math.PI * 0.5)) * dist * (j < 3 ? 1 : 0.9);
      const sy = by + Math.sin(ang) * dist * 0.7;
      if (rr > 0.8) soap(sx, sy, rr, i * 13 + j);
    }
    soap(bx, by, r, i);
  }
  // A soft shine across the glass.
  const shine = ctx.createLinearGradient(x0, y0, x0 + D, y0 + D);
  shine.addColorStop(0.15, 'rgba(255,255,255,0)');
  shine.addColorStop(0.25, `rgba(255,255,255,${dark ? 0.06 : 0.12})`);
  shine.addColorStop(0.35, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.fillRect(x0, y0, D, D);
  ctx.restore();
  // The frame: a thick dark ring with a sheen.
  ctx.lineWidth = Math.max(4, D * 0.045);
  const ring = ctx.createLinearGradient(x0, y0, x0 + D, y0 + D);
  ring.addColorStop(0, '#3a3a40');
  ring.addColorStop(0.5, '#141416');
  ring.addColorStop(1, '#26262a');
  ctx.strokeStyle = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, R + ctx.lineWidth / 2 - 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
