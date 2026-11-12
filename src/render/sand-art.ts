/**
 * Sand art: the round liquid sand picture on its stand, simulated, bubbles and all.
 *
 * Like the toy: a round glass, clear liquid, and one mass of fine coloured sand. Mountains of layered
 * sand rest on a row of soft air bubbles across the glass; the bubbles press against each other
 * and pull back together like foam, and where they part, sand runs through in a thin stream and
 * builds a range of dunes in the bowl below, on a bed of sand lying flat, laid in nested bands.
 *
 * The notes pour the sand: each note sounding runs a stream at its pitch's place across the glass
 * (low notes at the left, high at the right, over the range the piece actually plays; a glide
 * slides its stream along), as hard as it sounds (how many voices are on it, how loud, with a
 * surge just after a voice moves to it), with its name under the foam. Only the few strongest
 * pour at once, so the notes the piece dwells on (its tonic, its fifth) build the big
 * dunes and passing notes small ones. The ridge on top starts out shaped like the piece's notes,
 * so the sand is waiting where each will pour; wet sand creeps along the foam toward the nearest
 * stream. Each chord pours its own colour (the palette's two by turns, a streak of white at each
 * change), so the dunes are laid in bands, a band per chord. Every chord change jostles the row;
 * a snare pops a bubble at a stream (it re-forms a moment later), letting a rush through; kicks jiggle the foam and send
 * small avalanches down the slopes below (crashes, bigger ones). Sand piles at its natural 45°.
 * The flow is paced so the top empties as the piece ends, however long it is (a loop, within one
 * pass). Endless pieces turn the glass over when the top runs out.
 *
 * A falling-sand automaton on a square grid (cells outside the circle are glass) with the bubbles as
 * soft discs, stepped at a fixed rate from the start of the piece (with snapshots, so jumping back
 * is quick), so exports match playback. Drawn smooth with a fine grain texture, in the picture's own
 * coordinates (zoom works).
 */
import { chordIndexAt, drumHits, levelAt, voiceNotesAt } from '../engine/motion';
import type { Score } from '../engine/score';
import { harmonyKeyAt, harmonyRgb } from './harmony-color';
import { chordAt, nameOf, type ViewArea, type ViewStyle } from './harmony-views';

const DT = 1 / 60;
const SNAP_EVERY = 2; // s between snapshots
const MAX_SNAPS = 60;
const WALL = 1; // glass (outside the circle) or the bubble row (not sand)
const FLIP_STEPS = 100; // the glass turning over (endless pieces)
const CYCLE = 80; // s for the top to empty between turns, in endless pieces

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
  /** The two sand colours. */
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
  /** The piece's pitch range: low notes pour at the left of the glass, high ones at the right. */
  lo: number;
  hi: number;
  /** This step's streams: column, strength and the note (MIDI). */
  press: { x: number; f: number; p: number }[];
  /** Sand on top when the glass was last filled (or turned over); -1 until counted. */
  startAbove: number;
  flips: boolean;
  flipAt: number;
  cycleStart: number;
  snaps: { step: number; cells: Uint32Array; bx: Float32Array; bv: Float32Array; bpop: Float32Array; push: number; gate: number; above: number; lastChord: number; flipAt: number; cycleStart: number; startAbove: number }[];
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

/** The toy's sand: two contrasting colours from the palette (the key's tonic's and its third's). */
function sandColours(score: Score): [number, number, number][] {
  const key = harmonyKeyAt(score, score.gridStart, isDark(score));
  const tone = (p: number) => harmonyRgb(p, key).map((x) => (x * 0.9 + 0.06) * 255) as [number, number, number];
  return [tone(60 + key.tonic), tone(64 + key.tonic)];
}

/** What comes through: the chord's colour (the two by turns), a streak of white at each change, a fleck of gold. */
function pouredGrain(score: Score, cols: [number, number, number][], time: number, j: number, j2: number): number {
  const k = Math.max(0, chordIndexAt(score, time));
  const since = time - (score.chords[k]?.t ?? 0);
  const c = j2 > 0.985 ? GOLD : since < 0.3 && k > 0 ? WHITE : j2 < 0.1 ? WHITE : cols[k % 2];
  const v = 0.86 + 0.26 * j;
  return pack(c[0] * v, c[1] * v, c[2] * v);
}

/** Where a note pours: across the glass by pitch, kept clear of the curving sides. */
const xOf = (s: Sand, p: number) => s.n * (0.15 + (0.7 * Math.max(0, Math.min(1, (p - s.lo) / (s.hi - s.lo)))));

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
  // Against the glass at each end of the row, trapped foam: sand never runs down the edge.
  const [left, right] = rowEnds(n, shelf);
  const m = bx.length;
  if (m) {
    const l = Math.ceil(bx[0]);
    const r = Math.floor(bx[m - 1]);
    for (let y = shelf - 1; y <= shelf + 2; y++) {
      for (let x = Math.max(0, Math.floor(left) - 3); x <= l; x++) air[y * n + x] = 1;
      for (let x = r; x <= Math.min(n - 1, Math.ceil(right) + 3); x++) air[y * n + x] = 1;
    }
  }
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
  // (A loop plays one pass over and over, so its sand runs out within the pass like a finished
  // piece's; only an endless piece turns the glass over.)
  const flips = !score.loop && !Number.isFinite(score.timeline.arrivalStart);
  const s: Sand = {
    n, cells, inside, air: new Uint8Array(n * n), step: 0, key, shelf, cols: sandColours(score),
    bx: Float32Array.from(xs), br: Float32Array.from(rs), bv: new Float32Array(xs.length), bpop: new Float32Array(xs.length),
    push: 0.15, gate: 0.4, above: 0, lastChord: -1, lo: 48, hi: 72, press: [], startAbove: -1,
    flips, flipAt: -1, cycleStart: 0, snaps: [],
  };
  rasterBubbles(s);
  // The ridge: sharp peaks of layered sand resting on the bubbles, kept inside the glass.
  // As much sand as the piece's length can pour in thin trickles (a short piece gets a smaller ridge).
  const tl = score.timeline;
  const seconds = flips ? CYCLE : Math.max(10, tl.end - score.gridStart);
  const amount = Math.max(0.5, Math.min(1, 0.4 + seconds / 150));
  const room = (shelf - 2) * amount;
  // The ridge is shaped like the piece's notes: a mountain over each pitch, as big as how much it
  // sounds (voices on it, for how long), so the sand is there when each note comes to pour.
  const chords = score.chords.filter((c) => c.t < score.gridStart + seconds);
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of chords) for (const q of c.notes) (lo = Math.min(lo, q)), (hi = Math.max(hi, q));
  if (!Number.isFinite(lo)) (lo = 48), (hi = 72);
  if (hi - lo < 12) {
    const mid = (lo + hi) / 2;
    (lo = mid - 6), (hi = mid + 6);
  }
  s.lo = lo;
  s.hi = hi;
  // (Sampled from the streams themselves: the glass's width spans the notes that actually pour,
  // and the sand waits exactly where they will.)
  const w = new Float32Array(n);
  const last = Math.min(score.gridStart + seconds, chords.at(-1) ? chords.at(-1)!.t + 4 : score.gridStart);
  const sampled: { p: number; f: number }[] = [];
  for (let t = score.gridStart + 0.25; t < last; t += 0.5) for (const st of pressAt(score, s, t)) sampled.push({ p: st.p, f: st.f });
  if (sampled.length) {
    sampled.sort((a, b) => a.p - b.p);
    const total = sampled.reduce((a, b) => a + b.f, 0);
    const at = (q: number) => {
      let acc = 0;
      for (const x of sampled) if ((acc += x.f) >= q * total) return x.p;
      return sampled.at(-1)!.p;
    };
    s.lo = at(0.03) - 2;
    s.hi = at(0.97) + 2;
    if (s.hi - s.lo < 12) {
      const mid = (s.lo + s.hi) / 2;
      (s.lo = mid - 6), (s.hi = mid + 6);
    }
  }
  for (let t = score.gridStart + 0.25; t < last; t += 0.5) {
    for (const st of pressAt(score, s, t)) {
      for (let x = Math.max(0, st.x - Math.round(0.12 * n)); x <= Math.min(n - 1, st.x + Math.round(0.12 * n)); x++) w[x] += st.f * Math.exp(-(((x - st.x) / (0.04 * n)) ** 2));
    }
  }
  let wmax = 0;
  for (let x = 0; x < n; x++) wmax = Math.max(wmax, w[x]);
  const floor = room * 0.05;
  const prof = new Float32Array(n);
  for (let x = 0; x < n; x++) prof[x] = floor + (room - floor) * Math.sqrt(w[x] / (wmax || 1));
  // (No steeper than sand stands, 45°: a cell up for every cell across.)
  for (let x = 1; x < n; x++) prof[x] = Math.min(prof[x], prof[x - 1] + 1);
  for (let x = n - 2; x >= 0; x--) prof[x] = Math.min(prof[x], prof[x + 1] + 1);
  for (let x = 0; x < n; x++) {
    const hgt = prof[x];
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
  // A bed of sand already lying flat in the bottom of the glass, in level bands.
  const bed = n * 0.07;
  for (let x = 0; x < n; x++) {
    const top = bed + Math.sin(x * 0.04 + 0.7) * 1.8 + Math.sin(x * 0.11 + 2) * 0.8;
    for (let d = 0; d < top; d++) {
      const y = n - 1 - d;
      const i = y * n + x;
      if (!inside[i]) continue;
      const depth = d + Math.sin(x * 0.07) * 1.5;
      const c = hash(x, y, 7) > 0.985 ? GOLD : depth % 5 < 1 || hash(x, y, 9) < 0.1 ? WHITE : s.cols[Math.floor(depth / 5) % 2];
      const v = 0.86 + 0.26 * hash(x, y, 8);
      cells[i] = pack(c[0] * v, c[1] * v, c[2] * v);
    }
  }
  for (let i = 0; i < shelf * n; i++) if (cells[i] > WALL) s.above++;
  return s;
}

/** Seconds since voice v last moved to a new note (Infinity before its first move). */
function sinceMove(score: Score, v: number, t: number): { age: number; idx: number } {
  const ms = score.moves[v];
  let l = 0;
  let h = ms.length - 1;
  let idx = -1;
  while (l <= h) {
    const mid = (l + h) >> 1;
    if (ms[mid].t0 <= t) (idx = mid), (l = mid + 1);
    else h = mid - 1;
  }
  if (score.config.motion.transition === 'swell') {
    // (Release-&-swell changes don't glide: the chord changes are the moves.)
    const k = chordIndexAt(score, t);
    return k >= 1 ? { age: t - score.chords[k].t, idx: k * 31 + v } : { age: Infinity, idx: -1 };
  }
  return idx >= 0 ? { age: t - ms[idx].t0, idx } : { age: Infinity, idx: -1 };
}

/**
 * The streams at t: the notes sounding, each pouring at its pitch's place across the glass (low
 * at the left, high at the right; a glide slides its stream along), as hard as it sounds (voices
 * on it, how loud, with a surge just after a voice moves to it), in its own colour. Only the few
 * strongest pour at once, so the most-sounded notes build the big dunes and passing notes small ones.
 */
function pressAt(score: Score, s: Sand, t: number): Sand['press'] {
  if (t < score.gridStart) return [];
  const groups: { p: number; f: number; pf: number }[] = [];
  for (let v = 0; v < score.config.voices; v++) {
    const lvl = levelAt(score, v, t);
    if (lvl < 0.02) continue;
    const { age } = sinceMove(score, v, t);
    const surge = 1 + 1.2 * Math.exp(-age / 1.6);
    for (const nt of voiceNotesAt(score, v, t)) {
      const f = lvl * nt.g * surge;
      // (Voices on the same note, octaves apart counting as different notes, pour as one stream.)
      const g = groups.find((q) => Math.abs(q.p - nt.p) < 0.5);
      if (g) {
        g.f += f;
        if (f > g.pf) (g.p = nt.p), (g.pf = f);
      } else groups.push({ p: nt.p, f, pf: f });
    }
  }
  if (!groups.length) return [];
  groups.sort((a, b) => b.f - a.f);
  const top = groups[0].f;
  return groups
    .filter((g, i) => i < 4 && g.f >= 0.25 * top)
    .map((g) => ({ x: Math.round(xOf(s, g.p)), f: 0.25 + (0.55 * g.f) / top, p: g.p }));
}

/** The foam: bubbles pushed apart by the voices, pulled back together, jostled by the drums. */
function stepBubbles(s: Sand, score: Score, time: number) {
  const { bx, br, bv, bpop, n, shelf } = s;
  const m = bx.length;
  const step = s.step;
  const eff = (i: number) => br[i] * (1 - Math.min(1, bpop[i] / 1.4));
  const F = new Float32Array(m);
  s.press = pressAt(score, s, time);
  for (const c of s.press) {
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
      // (At a stream, letting a rush through.)
      const h = Math.round(hit.t * 1000);
      const at = s.press[Math.floor(hash(h, 2, 3) * s.press.length)];
      const target = at ? at.x + (hash(h, 1, 3) - 0.5) * 6 : (0.2 + 0.6 * hash(h, 1, 3)) * (n - 1);
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
      // Foam only stretches so far: neighbours part by a couple of grains at most.
      const over = bx[i + 1] - bx[i] - eff(i) - eff(i + 1) - 2.2;
      if (over > 0) {
        bx[i] += over / 2;
        bx[i + 1] -= over / 2;
      }
    }
    bx[0] = Math.max(bx[0], left + br[0] * 0.7);
    bx[m - 1] = Math.min(bx[m - 1], right - br[m - 1] * 0.7);
  }
  rasterBubbles(s);
}

function stepSand(s: Sand, score: Score, time: number) {
  const { n, cells, shelf } = s;
  const step = s.step;
  if (s.flipAt >= 0) {
    // Turning over: when it's done the sand is upside down, and the bubbles hold it again.
    if (step - s.flipAt >= FLIP_STEPS) {
      // (Turned half round: top to bottom and left to right, as the glass is drawn turning.)
      cells.reverse();
      s.flipAt = -1;
      s.cycleStart = time;
      s.startAbove = -1;
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
    if (s.startAbove < 0) s.startAbove = above;
    // (Turn over once the top has run out, the last grains caught between bubbles aside.)
    if (s.flips && time - s.cycleStart > 10 && (above < Math.max(30, 0.08 * s.startAbove) || time - s.cycleStart > CYCLE * 1.6)) s.flipAt = step;
  }
  stepBubbles(s, score, time);
  const air = s.air;
  // The top drains toward the streams (funnels open over them), and sand only gets through at a
  // stream: gaps the drums shake open elsewhere close again before anything falls.
  // Sand gets through only at a stream (gaps the drums shake open elsewhere close again before
  // anything falls), in that stream's colour. The top drains toward the streams: funnels open over
  // them, and wet sand creeps along the foam toward the nearest (from further off when running behind).
  const near = new Uint8Array(n);
  const open = new Int8Array(n).fill(-1);
  const toward = new Int8Array(n);
  const reach = Math.round(n * (s.gate > 0.95 ? 0.35 : 0.22));
  const dist = new Float32Array(n).fill(Infinity);
  s.press.forEach((p, j) => {
    for (let d = -26; d <= 26; d++) if (p.x + d >= 0 && p.x + d < n) near[p.x + d] = 1;
    for (let d = -4; d <= 4; d++) if (p.x + d >= 0 && p.x + d < n && (open[p.x + d] < 0 || Math.abs(d) < Math.abs(p.x + d - s.press[open[p.x + d]].x))) open[p.x + d] = j;
    for (let x = Math.max(0, p.x - reach); x <= Math.min(n - 1, p.x + reach); x++) {
      if (Math.abs(p.x - x) < dist[x]) {
        dist[x] = Math.abs(p.x - x);
        toward[x] = dist[x] > 2 ? Math.sign(p.x - x) : 0;
      }
    }
  });
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
        if (!cells[below] && !air[below] && (y !== shelf - 1 || (open[x] >= 0 && hash(x, step, 55 + sub) < s.gate))) {
          cells[below] = y === shelf - 1 ? pouredGrain(score, s.cols, time, hash(x, step, 51), hash(x, step, 52)) : c;
          cells[i] = 0;
          continue;
        }
        // (Packed sand above the bubbles slides freely near a gap, sluggishly elsewhere.)
        if (up && !near[x] && !toward[x] && hash(x, y, step * 2 + sub) > 0.15) continue;
        const first = hash(x, y, step * 2 + sub + 1) < 0.5 ? -1 : 1;
        let moved = false;
        for (const d of [first, -first]) {
          if (!cells[below + d] && !cells[i + d] && !air[below + d] && (y !== shelf - 1 || (open[x] >= 0 && hash(x, step, 57 + sub) < s.gate))) {
            cells[below + d] = y === shelf - 1 ? pouredGrain(score, s.cols, time, hash(x, step, 53), hash(x, step, 54)) : c;
            cells[i] = 0;
            moved = true;
            break;
          }
        }
        // Creeping: a resting grain on top edges a cell toward the stream.
        const d = toward[x];
        // (Only against the sweep, so a grain moves once a pass; the sweep turns each pass.)
        if (!moved && up && d && (ltr ? d < 0 : d > 0) && !cells[i + d] && !air[i + d] && hash(x, y, step * 3 + sub) < 0.14) {
          cells[i + d] = c;
          cells[i] = 0;
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
    sim.startAbove = from.startAbove;
    rasterBubbles(sim);
  }
  const limit = sim.step + 600;
  while (sim.step < target && sim.step < limit) {
    stepSand(sim, score, sim.step * DT);
    if (sim.step % Math.round(SNAP_EVERY / DT) === 0 && !sim.snaps.some((x) => x.step === sim.step)) {
      if (sim.snaps.length >= MAX_SNAPS) sim.snaps.splice(1, 1);
      sim.snaps.push({ step: sim.step, cells: sim.cells.slice(), bx: sim.bx.slice(), bv: sim.bv.slice(), bpop: sim.bpop.slice(), push: sim.push, gate: sim.gate, above: sim.above, lastChord: sim.lastChord, flipAt: sim.flipAt, cycleStart: sim.cycleStart, startAbove: sim.startAbove });
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
  // Turning over (endless pieces).
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
  // Falling grains trail a short blur (so a stream reads as a thread as thick as what's falling).
  for (let y = sim.shelf + 3; y < N - 1; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const c = cells[i];
      if (c <= WALL || cells[i + N] !== 0) continue;
      const rgb = c & 0xffffff;
      if (!cells[i - N]) px[i - N] = (rgb | (150 << 24)) >>> 0;
      if (!cells[i - N] && !cells[i - 2 * N]) px[i - 2 * N] = (rgb | (70 << 24)) >>> 0;
    }
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
    soap(bx, by, r, i);
  }
  // Each stream's note, named under the foam where it pours.
  if (score.config.theme.labels && sim.flipAt < 0) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const fs = Math.max(9, cell * 6.5);
    ctx.font = `600 ${fs}px ${st.font}`;
    const k = chordAt(score, t).c;
    const shown: number[] = [];
    for (const p of sim.press) {
      const lx = x0 + (p.x + 0.5) * cell;
      if (shown.some((q) => Math.abs(q - lx) < fs * 1.6)) continue;
      shown.push(lx);
      ctx.fillStyle = css(rgbOf(st.text), Math.min(0.9, 0.3 + 0.6 * p.f));
      ctx.fillText(nameOf(score, ((Math.round(p.p) % 12) + 12) % 12, k), lx, y0 + (sim.shelf + 8) * cell);
    }
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
