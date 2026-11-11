/**
 * Sand art: the round liquid sand picture on its stand, simulated.
 *
 * Like the toy: a round glass, clear liquid, and one mass of fine coloured sand. A ridge of sharp
 * peaks rests on a row of little air bubbles across the glass; sand runs down through gaps between
 * them in two or three thin streams and builds a new range of peaks in the bowl below, laid in
 * wavy strata. Nothing is recoloured on the way: what comes down is what drains from above.
 *
 * The music: the streams sit under the bass (low notes to the left), the middle voice and the top
 * voice (high notes to the right), so chord changes and glides move where the peaks build; each
 * chord pours its own colour (the key's two, by turns, with a streak of white at each change), so
 * the range below is layered a band per chord. Snares pop an extra gap open for a moment; kicks
 * jolt the glass and send small avalanches down the slopes (crashes, bigger ones). The flow is
 * paced so the ridge empties as the piece ends, however long it is. Endless and looping pieces turn
 * the glass over when the top runs out, like the toy.
 *
 * A falling-sand automaton on a square grid (cells outside the circle are glass), stepped at a
 * fixed rate from the start of the piece (with snapshots, so jumping back is quick), so exports
 * match playback. Drawn smooth with a fine grain texture, in the picture's own coordinates (zoom
 * works).
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
  step: number;
  key: string;
  /** The bubble row. */
  shelf: number;
  /** The two sand colours (for what pours through). */
  cols: [number, number, number][];
  /** Grains to let through per step (paced so the top empties on time), carried between steps. */
  rate: number;
  carry: number;
  flips: boolean;
  flipAt: number;
  cycleStart: number;
  snaps: { step: number; cells: Uint32Array; rate: number; carry: number; flipAt: number; cycleStart: number }[];
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
  for (let x = 0; x < n; x++) cells[shelf * n + x] = WALL;
  // The ridge: sharp peaks of layered sand resting on the bubbles, kept inside the glass.
  const rnd = mulberry32(score.seed ^ 0x5a17);
  const peaks = Array.from({ length: 3 + Math.floor(rnd() * 3) }, () => ({ x: 0.1 + 0.8 * rnd(), hgt: 0.55 + 0.45 * rnd(), wid: 0.1 + 0.16 * rnd() }));
  const cols = sandColours(score);
  const room = shelf - 2;
  for (let x = 0; x < n; x++) {
    let m = 0;
    for (const pk of peaks) m = Math.max(m, pk.hgt * Math.max(0, 1 - Math.abs(x / n - pk.x) / pk.wid) ** 1.1);
    const want = Math.round(room * (0.32 + 0.62 * m));
    const wave = Math.sin(x * 0.05 + 1.3) * 3 + Math.sin(x * 0.13) * 1.5;
    for (let d = 1; d <= want; d++) {
      const y = shelf - d;
      const i = y * n + x;
      if (!inside[i]) break;
      // Strata: broad colour bands with thin white seams, bent up under the peaks, swirled a little.
      const depth = d * (0.55 + 0.45 * (1 - m)) + wave + Math.sin(d * 0.21 + x * 0.03) * 2;
      const band = Math.floor(depth / 7);
      const seam = depth % 7 < 1.2;
      const c = hash(x, y, 7) > 0.985 ? GOLD : seam || hash(x, y, 9) < 0.1 ? WHITE : cols[band % 2];
      const k = 0.86 + 0.26 * hash(x, y, 8);
      cells[i] = pack(c[0] * k, c[1] * k, c[2] * k);
    }
  }
  const flips = score.loop || !Number.isFinite(score.timeline.arrivalStart);
  return { n, cells, inside, step: 0, key, shelf, cols, rate: 0.5, carry: 0, flips, flipAt: -1, cycleStart: 0, snaps: [] };
}

/** Where streams want to pour at t (in columns), most important first: bass, top voice, middle voice, snare pops. */
function wantedStreams(score: Score, s: Sand, t: number): number[] {
  const { lo, span } = skyRange(score);
  const V = score.config.voices;
  const n = s.n;
  const out: number[] = [];
  const at = (v: number, a: number, b: number) => {
    const nt = voiceNotesAt(score, v, t).sort((x, y) => y.g - x.g)[0];
    if (!nt || levelAt(score, v, t) * nt.g < 0.05) return;
    const u = Math.max(0, Math.min(1, (nt.p - lo) / span));
    out.push(Math.round((a + (b - a) * u) * (n - 1) + Math.sin(t * 0.29 + v) * 2));
  };
  at(0, 0.22, 0.55);
  if (V > 1) at(V - 1, 0.45, 0.78);
  if (V > 2) at(Math.floor(V / 2), 0.33, 0.67);
  if (score.drums) {
    for (const hit of drumHits(score, t - 0.5, t + 1e-6)) {
      if (hit.voice !== 'snare') continue;
      out.push(Math.round((0.25 + 0.5 * hash(Math.round(hit.t * 1000), 1, 3)) * (n - 1)));
    }
  }
  return out;
}

/** The gaps open this step: each wanted stream moves to the nearest spot with sand over it. */
function gapsAt(score: Score, s: Sand, t: number): number[] {
  if (t < score.gridStart || s.flipAt >= 0) return [];
  const { n, cells, shelf } = s;
  const hasSand = (x: number) => x > 1 && x < n - 2 && cells[(shelf - 1) * n + x] > WALL;
  const out: number[] = [];
  for (const want of wantedStreams(score, s, t)) {
    for (let d = 0; d < n; d++) {
      const x = hasSand(want - d) ? want - d : hasSand(want + d) ? want + d : -1;
      if (x >= 0) {
        if (!out.some((o) => Math.abs(o - x) < 3)) out.push(x);
        break;
      }
    }
  }
  return out;
}

function stepSand(s: Sand, score: Score, time: number) {
  const { n, cells, inside, shelf } = s;
  const step = s.step;
  if (s.flipAt >= 0) {
    // Turning over: when it's done the sand is upside down, and the bubbles hold it again.
    if (step - s.flipAt >= FLIP_STEPS) {
      for (let y = 0; y < Math.floor(n / 2); y++) {
        const a = cells.slice(y * n, y * n + n);
        cells.copyWithin(y * n, (n - 1 - y) * n, (n - y) * n);
        cells.set(a, (n - 1 - y) * n);
      }
      for (let x = 0; x < n; x++) {
        for (const y of [shelf, n - 1 - shelf]) if (inside[y * n + x] && cells[y * n + x] === WALL) cells[y * n + x] = 0;
        cells[shelf * n + x] = WALL;
      }
      s.flipAt = -1;
      s.cycleStart = time;
    }
    s.step++;
    return;
  }
  // Pace: let through what empties the top on time (recounted now and then).
  if (step % 20 === 0) {
    let above = 0;
    for (let i = 0; i < shelf * n; i++) if (cells[i] > WALL) above++;
    const left = s.flips ? Math.max(5, s.cycleStart + CYCLE - time) : Math.max(1, score.timeline.end - 1 - time);
    s.rate = time < score.gridStart ? 0 : above / (left * 60);
    if (s.flips && above < 30 && time - s.cycleStart > 10) s.flipAt = step;
  }
  // Open the gaps: the streams share the flow as thin trickles (each passes about two grains a
  // step while open, so each opens just often enough).
  for (let x = 0; x < n; x++) if (!cells[shelf * n + x] && inside[shelf * n + x]) cells[shelf * n + x] = WALL;
  const gaps = gapsAt(score, s, time);
  const near = new Uint8Array(n);
  const chance = gaps.length ? Math.min(1, s.rate / (2 * gaps.length)) : 0;
  for (let g = 0; g < gaps.length; g++) {
    const x = gaps[g];
    for (let d = -14; d <= 14; d++) if (x + d >= 0 && x + d < n) near[x + d] = 1;
    if (hash(step, x, 41 + g) < chance) cells[shelf * n + x] = 0;
  }
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
        if (!cells[below]) {
          cells[below] = y === shelf - 1 ? pouredGrain(score, s.cols, time, hash(x, step, 51), hash(x, step, 52)) : c;
          cells[i] = 0;
          continue;
        }
        if (up && (!near[x] || hash(x, y, step * 2 + sub) > 0.6)) continue;
        const first = hash(x, y, step * 2 + sub + 1) < 0.5 ? -1 : 1;
        for (const d of [first, -first]) {
          if (!cells[below + d] && !cells[i + d]) {
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
    sim.step = from.step;
    sim.rate = from.rate;
    sim.carry = from.carry;
    sim.flipAt = from.flipAt;
    sim.cycleStart = from.cycleStart;
  }
  const limit = sim.step + 600;
  while (sim.step < target && sim.step < limit) {
    stepSand(sim, score, sim.step * DT);
    if (sim.step % Math.round(SNAP_EVERY / DT) === 0 && !sim.snaps.some((x) => x.step === sim.step)) {
      if (sim.snaps.length >= MAX_SNAPS) sim.snaps.splice(1, 1);
      sim.snaps.push({ step: sim.step, cells: sim.cells.slice(), rate: sim.rate, carry: sim.carry, flipAt: sim.flipAt, cycleStart: sim.cycleStart });
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

  // The bubbles: a row of little glossy beads, shoulder to shoulder, the sand resting on them;
  // gaps where the streams run.
  const gaps = gapsAt(score, sim, t);
  const shelfY = y0 + (sim.shelf + 0.5) * cell;
  const rb = D * 0.0105;
  for (let i = 0, bx = x0 + rb; bx < x0 + D - rb; i++) {
    const r = rb * (hash(i, 3, 81) < 0.12 ? 1.5 + 0.5 * hash(i, 4, 81) : 0.8 + 0.35 * hash(i, 5, 81));
    const col = (bx - x0) / cell;
    if ((bx - cx) ** 2 < (R - r * 2) ** 2 && !gaps.some((g) => Math.abs(g + 0.5 - col) < r / cell + 0.8)) {
      const by = shelfY + r * 0.75;
      // A clear bead of air: bright rim and highlight, faintly milky inside, a soft shadow edge.
      const g = ctx.createRadialGradient(bx - r * 0.3, by - r * 0.35, r * 0.05, bx, by, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.3, 'rgba(255,255,255,0.75)');
      g.addColorStop(0.75, 'rgba(240,244,250,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0.95)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = Math.max(0.5, r * 0.08);
      ctx.stroke();
    }
    bx += r * 1.85;
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
