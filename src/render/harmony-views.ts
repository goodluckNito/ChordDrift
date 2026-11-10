/**
 * Harmony views: pictures of the chords as structures rather than lines over time.
 *
 *   Tonnetz        the triangular lattice of notes (fifths across, thirds on the diagonals);
 *                  the chord is a shape on it and the progression is a walk through it
 *   Circle of 5ths every chord change is an arc between roots on the circle of fifths;
 *                  repeated moves thicken into a web of the piece's habits
 *   Constellation  the voiced chord as stars (angle = note, distance = register), joined
 *                  bass to top with their intervals; recent chords linger as ghosts
 *
 * Pure functions of (score, t), like every other view.
 */
import { chordIndexAt, levelAt, smootherstep, soundingPitches } from '../engine/motion';
import type { Score, ScoreChord } from '../engine/score';
import { mod12, spellPc } from '../engine/theory';

export interface ViewStyle {
  ink: string;
  accent: string;
  text: string;
  font: string;
  lw: number;
  /** Colour for a pitch class (follows the theme's line colouring, or ink). */
  pcColor: (pc: number) => string;
}

export interface ViewArea {
  cx: number;
  cy: number;
  /** Radius of the usable area. */
  R: number;
  u: number;
  tu: number;
}

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const alpha = (color: string, a: number) => (color.startsWith('#') ? `rgba(${rgb(color).join(',')},${a})` : color.replace(/^rgb\(([^)]+)\)$/, `rgba($1,${a})`).replace(/^hsl\(([^)]+)\)$/, `hsla($1 / ${a})`));

/** The chord sounding at t and how far its change has progressed (0 → 1 over the glide). */
function chordAt(score: Score, t: number): { k: number; c: ScoreChord | null; prev: ScoreChord | null; x: number } {
  const k = chordIndexAt(score, t);
  if (k < 0) return { k, c: null, prev: null, x: 1 };
  const c = score.chords[k];
  const prev = k > 0 ? score.chords[k - 1] : null;
  const span = Math.max(0.05, c.settled - c.t);
  return { k, c, prev, x: smootherstep(Math.min(1, Math.max(0, (t - c.t) / span))) };
}

const pcsOf = (c: ScoreChord) => [...new Set(c.notes.map((n) => mod12(n)))];
const nameOf = (score: Score, pc: number, c?: ScoreChord | null) => spellPc(pc, c?.tonic ?? score.keyPc, c?.scale ?? score.config.scale);

// ---------------------------------------------------------------------------
// Tonnetz
// ---------------------------------------------------------------------------

/** Lattice: (i, j) holds pitch class 7i + 4j; i steps a fifth to the right, j a major third up-right. */
const latticePc = (i: number, j: number) => mod12(7 * i + 4 * j);
const latticeXY = (i: number, j: number) => ({ x: i + j / 2, y: (-j * Math.sqrt(3)) / 2 });

interface Placement {
  nodes: { i: number; j: number; pc: number }[];
  cx: number;
  cy: number;
}

const placementCache = new WeakMap<Score, Placement[]>();

/** Where each chord sits on the lattice: its root near the last chord, its other notes as close to the root as they come. */
function placements(score: Score, upto: number): Placement[] {
  let list = placementCache.get(score);
  if (!list) placementCache.set(score, (list = []));
  let at = list.length ? { x: list[list.length - 1].cx, y: list[list.length - 1].cy } : latticeXY(0, 0);
  const nearest = (pc: number, p: { x: number; y: number }) => {
    let best = { i: 0, j: 0, d: Infinity };
    const j0 = Math.round((-p.y * 2) / Math.sqrt(3));
    const i0 = Math.round(p.x - j0 / 2);
    for (let j = j0 - 4; j <= j0 + 4; j++) {
      for (let i = i0 - 7; i <= i0 + 7; i++) {
        if (latticePc(i, j) !== pc) continue;
        const q = latticeXY(i, j);
        const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
        if (d < best.d) best = { i, j, d };
      }
    }
    return best;
  };
  for (let k = list.length; k <= upto && k < score.chords.length; k++) {
    const c = score.chords[k];
    const root = nearest(mod12(c.root), at);
    const rootXY = latticeXY(root.i, root.j);
    const nodes = pcsOf(c).map((pc) => {
      const n = pc === mod12(c.root) ? root : nearest(pc, rootXY);
      return { i: n.i, j: n.j, pc };
    });
    const cx = nodes.reduce((a, n) => a + latticeXY(n.i, n.j).x, 0) / nodes.length;
    const cy = nodes.reduce((a, n) => a + latticeXY(n.i, n.j).y, 0) / nodes.length;
    list.push({ nodes, cx, cy });
    at = { x: cx, y: cy };
  }
  return list;
}

/** Convex hull (monotone chain) of a few points, for the chord's shape. */
function hull(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: typeof p = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: typeof p = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function drawTonnetz(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea) {
  const { u, tu } = a;
  const now = chordAt(score, t);
  const k = Math.max(0, now.k);
  const places = placements(score, k);
  const cur = places[k];
  const prev = k > 0 ? places[k - 1] : null;
  // Camera: glides from the last chord's centre to this one's during the change.
  const camX = cur ? (prev ? prev.cx + (cur.cx - prev.cx) * now.x : cur.cx) : 0;
  const camY = cur ? (prev ? prev.cy + (cur.cy - prev.cy) * now.x : cur.cy) : 0;
  const s = a.R / 2.6; // node spacing
  const P = (x: number, y: number) => ({ x: a.cx + (x - camX) * s, y: a.cy + (y - camY) * s });
  const node = (i: number, j: number) => {
    const q = latticeXY(i, j);
    return P(q.x, q.y);
  };

  ctx.save();
  // The lattice: faint triangles and every node's name.
  const span = Math.ceil((Math.max(ctx.canvas.width, ctx.canvas.height) / s) * 0.75) + 2;
  const jc = Math.round((-camY * 2) / Math.sqrt(3));
  const ic = Math.round(camX - jc / 2);
  ctx.strokeStyle = alpha(st.text, 0.12);
  ctx.lineWidth = Math.max(1, u);
  ctx.beginPath();
  for (let j = jc - span; j <= jc + span; j++) {
    for (let i = ic - span; i <= ic + span; i++) {
      const p0 = node(i, j);
      for (const [di, dj] of [
        [1, 0],
        [0, 1],
        [-1, 1],
      ]) {
        const p1 = node(i + di, j + dj);
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
      }
    }
  }
  ctx.stroke();
  ctx.font = `500 ${15 * tu}px ${st.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = alpha(st.text, 0.4);
  for (let j = jc - span; j <= jc + span; j++) {
    for (let i = ic - span; i <= ic + span; i++) {
      const p = node(i, j);
      if (p.x < -40 || p.y < -40 || p.x > ctx.canvas.width + 40 || p.y > ctx.canvas.height + 40) continue;
      ctx.fillText(nameOf(score, latticePc(i, j), now.c), p.x, p.y);
    }
  }

  // The walk: chord centres so far, fading into the past.
  const from = Math.max(0, k - 24);
  for (let n = from + 1; n <= k; n++) {
    const p0 = places[n - 1];
    const p1 = places[n];
    const end = n === k ? now.x : 1;
    const q0 = P(p0.cx, p0.cy);
    const q1 = P(p0.cx + (p1.cx - p0.cx) * end, p0.cy + (p1.cy - p0.cy) * end);
    ctx.strokeStyle = alpha(st.accent, 0.15 + 0.55 * ((n - from) / (k - from + 1)));
    ctx.lineWidth = Math.max(1, 2.2 * u * st.lw);
    ctx.beginPath();
    ctx.moveTo(q0.x, q0.y);
    ctx.lineTo(q1.x, q1.y);
    ctx.stroke();
  }

  // Chord shapes: the last one fading out, the current one filling in.
  const shape = (pl: Placement, fill: number, line: number, color: string) => {
    const pts = hull(pl.nodes.map((n) => node(n.i, n.j)));
    if (pts.length < 2) return;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = alpha(color, fill);
    ctx.fill();
    ctx.strokeStyle = alpha(color, line);
    ctx.lineWidth = Math.max(1, 2.4 * u * st.lw);
    ctx.lineJoin = 'round';
    ctx.stroke();
  };
  if (prev && now.x < 1) shape(prev, 0.16 * (1 - now.x), 0.7 * (1 - now.x), st.ink);
  if (cur && now.c && !now.c.unison) shape(cur, 0.18 * now.x, 0.9 * now.x, st.ink);

  // Sounding notes: a dot on each lit node, sized by how many voices play it and how loud.
  if (cur) {
    const counts = new Map<number, number>();
    soundingPitches(score, t).forEach((p, v) => counts.set(mod12(Math.round(p)), (counts.get(mod12(Math.round(p))) ?? 0) + 0.4 + 0.6 * levelAt(score, v, t)));
    const lit = [...cur.nodes];
    if (prev && now.x < 1) for (const n of prev.nodes) if (!lit.some((m) => m.pc === n.pc)) lit.push(n);
    for (const n of lit) {
      const w = counts.get(n.pc) ?? 0;
      if (w <= 0) continue;
      const p = node(n.i, n.j);
      const r = (7 + 4 * Math.min(3, w)) * u;
      ctx.fillStyle = st.pcColor(n.pc);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = alpha(st.text, 0.95);
      ctx.font = `700 ${15 * tu}px ${st.font}`;
      ctx.fillText(nameOf(score, n.pc, now.c), p.x, p.y + r + 13 * tu);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Circle of fifths
// ---------------------------------------------------------------------------

export function drawFifths(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea) {
  const { cx, cy, u, tu } = a;
  const R = a.R * 0.82;
  const now = chordAt(score, t);
  const k = now.k;
  const angle = (pc: number) => -Math.PI / 2 + (mod12(pc * 7) / 12) * Math.PI * 2;
  const at = (pc: number, r = R) => ({ x: cx + Math.cos(angle(pc)) * r, y: cy + Math.sin(angle(pc)) * r });

  ctx.save();
  // The circle, the twelve stations and the key's tonic.
  ctx.strokeStyle = alpha(st.text, 0.14);
  ctx.lineWidth = Math.max(1, 1.2 * u);
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  const tonic = now.c?.tonic ?? score.keyPc;
  ctx.font = `600 ${18 * tu}px ${st.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let pc = 0; pc < 12; pc++) {
    const p = at(pc);
    const q = at(pc, R + 30 * tu);
    ctx.fillStyle = alpha(st.text, pc === tonic ? 0.95 : 0.5);
    ctx.fillText(nameOf(score, pc, now.c), q.x, q.y);
    ctx.fillStyle = alpha(st.text, 0.35);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  const tp = at(tonic);
  ctx.strokeStyle = alpha(st.accent, 0.8);
  ctx.lineWidth = Math.max(1, 2 * u);
  ctx.beginPath();
  ctx.arc(tp.x, tp.y, 13 * u, 0, Math.PI * 2);
  ctx.stroke();

  // The web: every root-to-root move so far as an arc bowed toward the centre; repeats thicken.
  const moves = new Map<string, { a: number; b: number; n: number; last: number }>();
  for (let n = 1; n <= k; n++) {
    const ra = mod12(score.chords[n - 1].root);
    const rb = mod12(score.chords[n].root);
    if (ra === rb || score.chords[n].unison || score.chords[n - 1].unison) continue;
    const key = `${ra}>${rb}`;
    const m = moves.get(key) ?? { a: ra, b: rb, n: 0, last: 0 };
    m.n++;
    m.last = n;
    moves.set(key, m);
  }
  const arc = (ra: number, rb: number, frac = 1) => {
    const p0 = at(ra);
    const p1 = at(rb);
    // Close neighbours bow gently; far jumps cut deep toward the centre.
    const d = Math.min(mod12(mod12(rb * 7) - mod12(ra * 7)), mod12(mod12(ra * 7) - mod12(rb * 7)));
    const bow = 0.15 + 0.12 * d;
    const mx = (p0.x + p1.x) / 2 + (cx - (p0.x + p1.x) / 2) * bow;
    const my = (p0.y + p1.y) / 2 + (cy - (p0.y + p1.y) / 2) * bow;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    if (frac >= 1) ctx.quadraticCurveTo(mx, my, p1.x, p1.y);
    else {
      // Partial quadratic (de Casteljau) for the arc being drawn right now.
      const q = (s: number) => ({ x: (1 - s) ** 2 * p0.x + 2 * (1 - s) * s * mx + s * s * p1.x, y: (1 - s) ** 2 * p0.y + 2 * (1 - s) * s * my + s * s * p1.y });
      for (let i = 1; i <= 24; i++) {
        const p = q((i / 24) * frac);
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  for (const m of moves.values()) {
    if (m.last === k && now.x < 1 && m.n === 1) continue; // being drawn below
    const age = k - m.last;
    ctx.strokeStyle = alpha(st.pcColor(m.b), Math.max(0.12, 0.7 * Math.exp(-age / 10)));
    ctx.lineWidth = Math.max(1, (1.2 + 1.6 * Math.log2(1 + m.n)) * u * st.lw);
    arc(m.a, m.b);
  }
  if (now.c && now.prev && !now.c.unison && !now.prev.unison && mod12(now.c.root) !== mod12(now.prev.root)) {
    ctx.strokeStyle = st.accent;
    ctx.lineWidth = Math.max(1, 3 * u * st.lw);
    arc(mod12(now.prev.root), mod12(now.c.root), Math.max(0.02, now.x));
  }

  // The chord's shape inscribed in the circle (its notes joined in fifths order).
  if (now.c && !now.c.unison) {
    const pcs = pcsOf(now.c).sort((x, y) => mod12(x * 7) - mod12(y * 7));
    ctx.beginPath();
    pcs.forEach((pc, i) => {
      const p = at(pc, R * 0.97);
      if (i) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = alpha(st.ink, 0.08 + 0.08 * now.x);
    ctx.fill();
    ctx.strokeStyle = alpha(st.ink, 0.55 * now.x);
    ctx.lineWidth = Math.max(1, 1.6 * u * st.lw);
    ctx.stroke();
    for (const pc of pcs) {
      const p = at(pc);
      ctx.fillStyle = st.pcColor(pc);
      ctx.beginPath();
      ctx.arc(p.x, p.y, (pc === mod12(now.c.root) ? 11 : 7) * u, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Constellation
// ---------------------------------------------------------------------------

const skyCache = new WeakMap<Score, { lo: number; span: number; n: number }>();

/**
 * The sky's register range: the whole piece's, so stars never rescale as the music moves
 * (a moving camera range made every star lurch in or out). Grows only if an endless piece
 * wanders past it.
 */
function skyRange(score: Score): { lo: number; span: number } {
  const hit = skyCache.get(score);
  if (hit && hit.n === score.chords.length) return hit;
  let lo = Math.min(score.startNote, score.endNote);
  let hi = Math.max(score.startNote, score.endNote);
  for (const c of score.chords) for (const n of c.notes) (lo = Math.min(lo, n)), (hi = Math.max(hi, n));
  const span = Math.max(18, hi - lo + 4);
  const sky = { lo: (lo + hi) / 2 - span / 2, span, n: score.chords.length };
  skyCache.set(score, sky);
  return sky;
}

const INTERVALS = ['P8', 'm2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7'];

export function drawConstellation(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea) {
  const { cx, cy, u, tu } = a;
  const R = a.R * 0.9;
  const { lo, span } = skyRange(score);
  const star = (p: number, scale = 1) => {
    // Continuous in p, so a gliding note sweeps smoothly round from one spoke to the next.
    const ang = -Math.PI / 2 + (p / 12) * Math.PI * 2;
    const r = R * (0.12 + 0.88 * Math.max(0, Math.min(1.05, (p - lo) / span))) * scale;
    return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r };
  };
  ctx.save();
  // The sky: twelve faint spokes (one per note) and octave rings.
  ctx.strokeStyle = alpha(st.text, 0.09);
  ctx.lineWidth = Math.max(1, u);
  ctx.beginPath();
  for (let pc = 0; pc < 12; pc++) {
    const ang = -Math.PI / 2 + (pc / 12) * Math.PI * 2;
    ctx.moveTo(cx + Math.cos(ang) * R * 0.1, cy + Math.sin(ang) * R * 0.1);
    ctx.lineTo(cx + Math.cos(ang) * R * 1.02, cy + Math.sin(ang) * R * 1.02);
  }
  for (let n = Math.ceil(lo / 12) * 12; n <= lo + span; n += 12) {
    const r = R * (0.12 + (0.88 * (n - lo)) / span);
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.font = `500 ${15 * tu}px ${st.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = alpha(st.text, 0.45);
  const now = chordAt(score, t);
  for (let pc = 0; pc < 12; pc++) {
    const ang = -Math.PI / 2 + (pc / 12) * Math.PI * 2;
    ctx.fillText(nameOf(score, pc, now.c), cx + Math.cos(ang) * (R * 1.02 + 22 * tu), cy + Math.sin(ang) * (R * 1.02 + 22 * tu));
  }

  const figure = (pitches: number[], lineA: number, dotA: number, scale: number, labelA: number) => {
    const ps = [...pitches].sort((x, y) => x - y);
    const pts = ps.map((p) => star(p, scale));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 1; i < pts.length; i++) {
      ctx.strokeStyle = alpha(st.ink, lineA);
      ctx.lineWidth = Math.max(1, 1.6 * u * st.lw);
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      if (labelA > 0.01) {
        const iv = INTERVALS[mod12(Math.round(ps[i] - ps[i - 1]))];
        const mx = (pts[i - 1].x + pts[i].x) / 2;
        const my = (pts[i - 1].y + pts[i].y) / 2;
        ctx.fillStyle = alpha(st.text, 0.75 * lineA * labelA);
        ctx.font = `500 ${13 * tu}px ${st.font}`;
        ctx.fillText(Math.round(ps[i] - ps[i - 1]) === 0 ? 'U' : iv, mx, my - 9 * tu);
      }
    }
    pts.forEach((p, i) => {
      ctx.fillStyle = alpha(st.pcColor(mod12(Math.round(ps[i]))), dotA);
      ctx.beginPath();
      ctx.arc(p.x, p.y, (i === 0 ? 8 : 5.5) * u * Math.max(0.7, Math.min(1.8, st.lw)), 0, Math.PI * 2);
      ctx.fill();
    });
  };
  // Ghosts: the last few chords, smaller and fainter the older they are. Ages run continuously
  // through each change (a chord eases back into the ghosts as the next one arrives, and the
  // oldest fades out), so nothing pops.
  const k = now.k;
  const MAX = 4;
  for (let n = Math.max(0, k - MAX - 1); n < k; n++) {
    const c = score.chords[n];
    if (c.unison) continue;
    const age = k - n - 1 + now.x;
    if (age <= 0.001) continue;
    const fade = Math.max(0, Math.min(1, MAX + 1 - age)) * Math.min(1, age * 2);
    figure(c.notes, (0.22 / (1 + age * 0.8)) * fade, (0.3 / (1 + age * 0.8)) * fade, Math.pow(0.94, age), 0);
  }
  // The chord sounding now (gliding voices move between shapes). Interval labels fade out
  // while the voices glide (their values would flicker) and back in once the chord settles.
  const pitches = soundingPitches(score, t);
  const off = pitches.reduce((m, p) => Math.max(m, Math.abs(p - Math.round(p))), 0);
  const settle = 1 - Math.min(1, off * 5);
  figure(pitches, 0.85, 1, 1, settle * settle);
  ctx.restore();
}
