/**
 * Less usual pictures of the music, each moving with the voices and pushed around by the drums:
 *
 *   Ink marbling  a round tray with the notes round the rim; every voice is a pen of its own ink,
 *                 combing it along its path whenever it moves; old ink dissolves.
 *   Murmuration   one flock led by the voices: a ribbon of birds strung through them, stretching,
 *                 bunching and turning with the chord.
 *
 * Pure functions of (score, t) like every other view (marbling caches its work, but replays it
 * exactly when time jumps backwards).
 */
import { drumHits, levelAt, pitchAt } from '../engine/motion';
import type { Score } from '../engine/score';
import { mod12 } from '../engine/theory';
import { alpha, chordAt, drumPulse, nameOf, skyRange, type ViewArea, type ViewStyle } from './harmony-views';

/** A stable pseudo-random number in [0, 1) from a few integers. */
function hash(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x01000193);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  }
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Ink marbling
// ---------------------------------------------------------------------------

/**
 * A round tray of water with the twelve notes around its rim like a clock; distance from the
 * middle is register (low near the centre, high near the rim). Every voice is a pen with its own
 * ink. When a voice moves, its pen is dragged from the old note to the new one, combing the ink
 * along that path (the marbling transform for a stroke: points beside the path are carried along
 * it, more the closer they are), and it drops a little fresh ink where it lands. Held chords let
 * the ink settle; old ink slowly dissolves, so the tray shows the last half minute or so. Kicks
 * tap the middle of the water, snares tap near it.
 */
interface MarbleEvent {
  t: number;
  d: number;
  kind: 'drop' | 'drag' | 'tap';
  x: number;
  y: number;
  /** drag: the end of the stroke. */
  x1: number;
  y1: number;
  r: number;
  z: number;
  color: string;
}
interface Ink {
  xs: number[];
  ys: number[];
  color: string;
  born: number;
}
interface Marble {
  events: MarbleEvent[];
  /** Moves turned into events so far, per voice; and drum time covered. */
  movesDone: number[];
  started: boolean;
  drumsUntil: number;
  inks: Ink[];
  applied: number;
  colorKey: string;
}
const marbles = new WeakMap<Score, Marble>();
const LAMBDA = 0.09;
const INK_LIFE = 22;
const MAX_INKS = 70;

/** A note's place in the tray: angle by note name (C at the top), distance by register. */
function trayPos(score: Score, p: number) {
  const { lo, span } = skyRange(score);
  const ang = -Math.PI / 2 + (Math.PI * 2 * p) / 12;
  const r = 0.18 + 0.72 * Math.max(0, Math.min(1, (p - lo) / span));
  return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
}

function applyEvent(ink: Ink, e: MarbleEvent, f: number) {
  const { xs, ys } = ink;
  if (e.kind === 'drop' || e.kind === 'tap') {
    const r2 = e.r * e.r * f;
    for (let i = 0; i < xs.length; i++) {
      const dx = xs[i] - e.x;
      const dy = ys[i] - e.y;
      const s = Math.sqrt(1 + r2 / (dx * dx + dy * dy + 1e-9));
      xs[i] = e.x + dx * s;
      ys[i] = e.y + dy * s;
    }
    return;
  }
  // A stroke from (x, y) towards (x1, y1), drawn as far as f: points beside it are carried along.
  const ex = e.x + (e.x1 - e.x) * f;
  const ey = e.y + (e.y1 - e.y) * f;
  const lx = ex - e.x;
  const ly = ey - e.y;
  const len = Math.hypot(lx, ly);
  if (len < 1e-4) return;
  const mx = lx / len;
  const my = ly / len;
  for (let i = 0; i < xs.length; i++) {
    const px = xs[i] - e.x;
    const py = ys[i] - e.y;
    const along = px * mx + py * my;
    const across = Math.abs(-px * my + py * mx);
    // Only beside the stretch the pen has covered (softly past its ends).
    const s = along / len;
    const win = s < 0 ? Math.max(0, 1 + s * 4) : s > 1 ? Math.max(0, 1 - (s - 1) * 4) : 1;
    if (win <= 0) continue;
    const k = ((e.z * len * LAMBDA) / (across + LAMBDA)) * win;
    xs[i] += k * mx;
    ys[i] += k * my;
  }
}

/** Keep feathered outlines smooth: split edges that have been stretched long (up to a cap). */
function refine(ink: Ink) {
  const { xs, ys } = ink;
  if (xs.length > 600) return;
  const nx: number[] = [];
  const ny: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const j = (i + 1) % xs.length;
    nx.push(xs[i]);
    ny.push(ys[i]);
    const dx = xs[j] - xs[i];
    const dy = ys[j] - ys[i];
    const n = Math.min(4, Math.floor(Math.hypot(dx, dy) / 0.035));
    for (let k = 1; k <= n; k++) {
      nx.push(xs[i] + (dx * k) / (n + 1));
      ny.push(ys[i] + (dy * k) / (n + 1));
    }
  }
  ink.xs = nx;
  ink.ys = ny;
}

function circleInk(x: number, y: number, r: number, color: string, born: number): Ink {
  const n = 64;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(x + Math.cos((i / n) * Math.PI * 2) * r);
    ys.push(y + Math.sin((i / n) * Math.PI * 2) * r);
  }
  return { xs, ys, color, born };
}

/** Turn voice moves (and drum hits) up to time `until` into events. */
function buildMarble(m: Marble, score: Score, st: ViewStyle, until: number) {
  const fresh: MarbleEvent[] = [];
  const V = score.config.voices;
  if (!m.started && score.chords.length) {
    m.started = true;
    // The opening: every voice drops its ink at its first note.
    score.chords[0].notes.forEach((n, v) => {
      const p = trayPos(score, n);
      fresh.push({ t: score.chords[0].t + v * 0.05, d: 0.8, kind: 'drop', x: p.x, y: p.y, x1: 0, y1: 0, r: 0.16, z: 0, color: st.voiceColor(v) });
    });
  }
  for (let v = 0; v < V; v++) {
    const moves = score.moves[v];
    while (m.movesDone[v] < moves.length && moves[m.movesDone[v]].t0 <= until) {
      const mv = moves[m.movesDone[v]++];
      if (Math.abs(mv.p1 - mv.p0) < 0.5) continue;
      const a0 = trayPos(score, mv.p0);
      const a1 = trayPos(score, mv.p1);
      const d = Math.max(0.35, mv.d);
      fresh.push({ t: mv.t0, d, kind: 'drag', x: a0.x, y: a0.y, x1: a1.x, y1: a1.y, r: 0, z: 0.9, color: '' });
      fresh.push({ t: mv.t0 + d * 0.7, d: 0.5, kind: 'drop', x: a1.x, y: a1.y, x1: 0, y1: 0, r: 0.07, z: 0, color: st.voiceColor(v) });
    }
  }
  if (until > m.drumsUntil) {
    for (const h of drumHits(score, Math.max(0, m.drumsUntil), until)) {
      if (h.voice !== 'kick' && h.voice !== 'snare') continue;
      const i = Math.round(h.t * 1000);
      const kick = h.voice === 'kick';
      fresh.push({
        t: h.t,
        d: 0.18,
        kind: 'tap',
        x: kick ? 0 : (hash(i, 2) - 0.5) * 0.9,
        y: kick ? 0 : (hash(i, 4) - 0.5) * 0.9,
        x1: 0,
        y1: 0,
        r: (kick ? 0.045 : 0.03) * h.vel,
        z: 0,
        color: '',
      });
    }
    m.drumsUntil = until;
  }
  if (fresh.length) {
    const tail = m.events.splice(m.applied).concat(fresh).sort((x, y) => x.t - y.t);
    m.events.push(...tail);
  }
}

export function drawMarbling(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea) {
  const colorKey = `${st.voiceColor(0)}${st.voiceColor(5)}${st.background}`;
  let m = marbles.get(score);
  if (!m || m.colorKey !== colorKey) {
    m = { events: [], movesDone: new Array(score.config.voices).fill(0), started: false, drumsUntil: 0, inks: [], applied: 0, colorKey };
    marbles.set(score, m);
  }
  buildMarble(m, score, st, t + 2);
  const last = m.applied > 0 ? m.events[m.applied - 1] : null;
  if (last && t < last.t + last.d) {
    m.inks = [];
    m.applied = 0;
  }
  while (m.applied < m.events.length) {
    const e = m.events[m.applied];
    if (e.t + e.d > t) break;
    for (const ink of m.inks) applyEvent(ink, e, 1);
    if (e.kind === 'drop') m.inks.push(circleInk(e.x, e.y, e.r, e.color, e.t));
    if (e.kind === 'drag') for (const ink of m.inks) refine(ink);
    m.applied++;
    m.inks = m.inks.filter((ink) => e.t - ink.born < INK_LIFE && ink.xs.some((x, i) => x * x + ink.ys[i] * ink.ys[i] < 1.6));
    if (m.inks.length > MAX_INKS) m.inks.splice(0, m.inks.length - MAX_INKS);
  }
  const live = m.events.slice(m.applied).filter((e) => e.t <= t);
  let inks = m.inks;
  if (live.length) {
    inks = m.inks.map((ink) => ({ ...ink, xs: ink.xs.slice(), ys: ink.ys.slice() }));
    for (const e of live) {
      const f = Math.max(0, Math.min(1, (t - e.t) / e.d));
      const ease = f * f * (3 - 2 * f);
      for (const ink of inks) applyEvent(ink, e, ease);
      if (e.kind === 'drop') inks.push(circleInk(e.x, e.y, e.r * Math.sqrt(ease), e.color, e.t));
    }
  }

  const { cx, cy, u, tu } = a;
  const S = a.R * 0.92;
  ctx.save();
  // The tray.
  ctx.fillStyle = alpha(st.ink, 0.04);
  ctx.beginPath();
  ctx.arc(cx, cy, S, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  for (const ink of inks) {
    // Old ink dissolves into the water.
    const age = t - ink.born;
    const fade = Math.max(0, Math.min(1, (INK_LIFE - age) / 8));
    if (fade <= 0) continue;
    ctx.beginPath();
    for (let i = 0; i < ink.xs.length; i++) {
      const x = cx + ink.xs[i] * S;
      const y = cy + ink.ys[i] * S;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = alpha(ink.color, 0.85 * fade);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = alpha(st.text, 0.3);
  ctx.lineWidth = Math.max(1, 1.5 * u);
  ctx.beginPath();
  ctx.arc(cx, cy, S, 0, Math.PI * 2);
  ctx.stroke();
  // The notes round the rim.
  ctx.font = `600 ${15 * tu}px ${st.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const now = chordAt(score, t);
  for (let pc = 0; pc < 12; pc++) {
    const ang = -Math.PI / 2 + (Math.PI * 2 * pc) / 12;
    ctx.strokeStyle = alpha(st.text, 0.35);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * S, cy + Math.sin(ang) * S);
    ctx.lineTo(cx + Math.cos(ang) * (S + 8 * u), cy + Math.sin(ang) * (S + 8 * u));
    ctx.stroke();
    ctx.fillStyle = alpha(st.text, 0.55);
    ctx.fillText(nameOf(score, pc, now.c), cx + Math.cos(ang) * (S + 24 * tu), cy + Math.sin(ang) * (S + 24 * tu));
  }
  // The pens: where each voice is now.
  for (let v = 0; v < score.config.voices; v++) {
    const p = trayPos(score, pitchAt(score, v, t));
    const x = cx + p.x * S;
    const y = cy + p.y * S;
    ctx.fillStyle = st.background;
    ctx.strokeStyle = st.voiceColor(v);
    ctx.lineWidth = Math.max(1.5, 2.2 * u);
    ctx.beginPath();
    ctx.arc(x, y, 5 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Murmuration
// ---------------------------------------------------------------------------

/**
 * One flock, led by the voices. The leaders sit at their notes' heights, strung across the sky in
 * order from the bass up, and the flock is a ribbon of birds through them: it stretches between the
 * lowest and highest voices, bunches where voices cluster (the same number of birds between each
 * pair of neighbours, so close voices make dense knots), and draws into one ball on a unison. The
 * leaders follow their notes slowly, with weight, and birds trail behind them, so a chord change
 * is a sweeping turn of the whole flock. Kicks make it pulse; snares send a ripple along it.
 */
export function drawMurmuration(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea, lite = false) {
  const { u } = a;
  const W = a.width;
  const top = a.top + 40 * u;
  const bottom = a.bottom - 60 * u;
  const { lo, span } = skyRange(score);
  const V = score.config.voices;
  const drum = drumPulse(score, t);
  const BIRDS = lite ? 600 : 1500;
  // A leader's height follows its note with weight: an average of where the note was over the
  // last couple of seconds, recent moments counting most.
  const smoothP = (v: number, time: number) => {
    let s = 0;
    let w = 0;
    for (let i = 0; i < 10; i++) {
      const age = i * 0.18;
      const k = Math.exp(-age / 0.55);
      s += pitchAt(score, v, time - age) * k;
      w += k;
    }
    return s / w;
  };
  // How wide the chord is (smoothed too): a wide chord strings the flock across the sky, a unison
  // draws it into one ball.
  const width = (time: number) => {
    let s = 0;
    for (let i = 0; i < 6; i++) {
      const ps = Array.from({ length: V }, (_, v) => pitchAt(score, v, time - i * 0.25));
      s += Math.max(...ps) - Math.min(...ps);
    }
    return Math.min(1, s / 6 / 24);
  };
  const leader = (v: number, time: number, spread: number) => {
    const p = smoothP(v, time);
    const f = V > 1 ? v / (V - 1) - 0.5 : 0;
    // Strung across the sky from the bass up, the string itself slowly swaying.
    const x = W / 2 + W * 0.62 * spread * f + W * 0.12 * Math.sin(0.11 * time + f * 2.4) + W * 0.05 * Math.sin(0.23 * time - f * 4);
    const y = bottom - ((p - lo) / span) * (bottom - top);
    return { x, y };
  };
  // Leaders at a few lags, so trailing birds follow where the flock was.
  const LAGS = 6;
  const lagStep = 0.12;
  const leaders = Array.from({ length: LAGS }, (_, j) => {
    const spread = width(t - j * lagStep);
    return Array.from({ length: V }, (_, v) => leader(v, t - j * lagStep, spread));
  });
  const pulse = 1 + 0.5 * drum.kick;
  const rippleAge = drum.snare > 0.02 ? Math.max(0, t - drum.snareAt) : -1;

  ctx.save();
  ctx.strokeStyle = alpha(st.ink, 0.7);
  ctx.lineWidth = Math.max(1, 1.3 * u);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let b = 0; b < BIRDS; b++) {
    // A place along the ribbon (between two neighbouring voices) and across it.
    const along = hash(b, 1) * (V - 1);
    const i0 = Math.min(V - 2, Math.floor(along));
    const f = along - i0;
    const lag = Math.min(LAGS - 1.001, hash(b, 2) * hash(b, 3) * (LAGS - 1));
    const j0 = Math.floor(lag);
    const lf = lag - j0;
    const at = (j: number) => {
      const L = leaders[j];
      const p0 = L[Math.max(0, i0)];
      const p1 = L[Math.min(V - 1, i0 + 1)];
      return { x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f, dx: p1.x - p0.x, dy: p1.y - p0.y };
    };
    const A = at(j0);
    const B = at(j0 + 1);
    const x0 = A.x + (B.x - A.x) * lf;
    const y0 = A.y + (B.y - A.y) * lf;
    // Across the ribbon: thick in the middle, thinning to the edges; waves of density run along it.
    const len = Math.hypot(A.dx, A.dy);
    const nx = len > 1e-3 ? -A.dy / len : 0;
    const ny = len > 1e-3 ? A.dx / len : 1;
    const g = (hash(b, 4) + hash(b, 5) + hash(b, 6)) / 1.5 - 1;
    // Along the ribbon too, so knots and the ball have body (and a unison isn't a line).
    const g2 = (hash(b, 7) + hash(b, 8) + hash(b, 9)) / 1.5 - 1;
    const wave = Math.sin(along * 2.2 - t * 1.4) * 0.5 + 0.5;
    const ripple = rippleAge >= 0 ? Math.exp(-(((along / (V - 1)) - rippleAge * 1.5) ** 2) * 30) * drum.snare : 0;
    const thick = W * (0.03 + 0.03 * wave + 0.04 * ripple) * pulse;
    // A little wander of each bird, so the flock shimmers.
    const wx = Math.sin(t * 1.7 + b * 1.3) * 3 * u;
    const wy = Math.cos(t * 1.3 + b * 2.1) * 3 * u;
    const x = x0 + nx * g * thick + ny * g2 * thick * 0.8 + wx;
    const y = y0 + ny * g * thick * 0.75 - nx * g2 * thick * 0.6 + wy;
    const hd = Math.atan2(A.dy, A.dx) + 0.6 * Math.sin(b + t);
    const l = 2 * u;
    ctx.moveTo(x - Math.cos(hd) * l, y - Math.sin(hd) * l);
    ctx.lineTo(x + Math.cos(hd) * l, y + Math.sin(hd) * l);
  }
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Night city
// ---------------------------------------------------------------------------

/**
 * Twelve towers, one per note name (C to B, left to right), one floor per octave. A sounding note
 * is a lit window; the last few chords' windows fade out slowly, so the recent harmony glows.
 * A voice that moves rides out as a light: along a skybridge at its old floor to the new note's
 * tower, then up or down its lift, and the window lights as it arrives. Kicks light up the sky,
 * snares flash the antennas. Two looks: neon (lit windows, reflections in the water) and
 * blueprint (isometric line drawing).
 */
type Cell = { pc: number; oct: number };
const cellOf = (p: number): Cell => {
  const r = Math.round(p);
  return { pc: mod12(r), oct: Math.floor(r / 12) - 1 };
};

interface CityLights {
  /** Brightness per window, keyed pc + 12·octave. */
  lit: Map<number, number>;
  cars: { from: Cell; to: Cell; f: number; v: number }[];
}

function cityLights(score: Score, t: number): CityLights {
  const lit = new Map<number, number>();
  const light = (c: Cell, b: number) => {
    const k = c.pc + 12 * c.oct;
    lit.set(k, Math.max(lit.get(k) ?? 0, b));
  };
  const chords = score.chords;
  let k = 0;
  while (k + 1 < chords.length && chords[k + 1].t <= t) k++;
  // Recent chords, fading over a few seconds after they ended.
  for (let j = Math.max(0, k - 8); j < k; j++) {
    const end = chords[j + 1].t;
    const fade = 0.32 * Math.exp(-Math.max(0, t - end) / 2.5);
    if (fade < 0.02) continue;
    for (const n of chords[j].notes) light(cellOf(n), fade);
  }
  const cars: CityLights['cars'] = [];
  for (let v = 0; v < score.config.voices; v++) {
    const level = 0.35 + 0.65 * levelAt(score, v, t);
    const mv = score.moves[v].find((m) => m.t0 <= t && t < m.t0 + m.d && Math.round(m.p0) !== Math.round(m.p1));
    if (mv) {
      const f = Math.max(0, Math.min(1, (pitchAt(score, v, t) - mv.p0) / (mv.p1 - mv.p0)));
      const from = cellOf(mv.p0);
      const to = cellOf(mv.p1);
      cars.push({ from, to, f, v });
      light(from, level * (1 - f) * 0.8);
      if (f > 0.85) light(to, level * (f - 0.85) / 0.15);
    } else light(cellOf(pitchAt(score, v, t)), level);
  }
  return { lit, cars };
}

/** Where a car is along its route: along the skybridge first, then the lift. */
function carPos(from: { x: number; y: number }, to: { x: number; y: number }, f: number) {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const d = (dx + dy) * f;
  if (d <= dx) return { x: from.x + Math.sign(to.x - from.x) * d, y: from.y };
  return { x: to.x, y: from.y + Math.sign(to.y - from.y) * (d - dx) };
}

export function drawCity(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea) {
  if (score.config.video.city === 'blueprint') drawBlueprintCity(ctx, score, t, st, a);
  else drawNeonCity(ctx, score, t, st, a);
}

function octRange(score: Score) {
  const { lo, span } = skyRange(score);
  const o0 = Math.floor((lo + 2) / 12) - 1;
  const o1 = Math.max(o0 + 2, Math.floor((lo + span - 2) / 12) - 1);
  return { o0, o1, floors: o1 - o0 + 1 };
}

function drawNeonCity(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea) {
  const { u } = a;
  const W = a.width;
  const H = ctx.canvas.height;
  const drum = drumPulse(score, t);
  const { o0, floors } = octRange(score);
  const margin = W * 0.05;
  const tw = (W - 2 * margin) / 12;
  const ground = a.top + (a.bottom - a.top) * 0.74;
  const floorH = Math.min(tw * 1.1, (ground - a.top - 40 * u) / (floors + 2.6));
  const extra = (pc: number) => Math.round(hash(pc, 7) * 2.4);
  const towerX = (pc: number) => margin + pc * tw;
  const win = (c: Cell) => ({ x: towerX(c.pc) + tw / 2, y: ground - (c.oct - o0 + 0.5) * floorH });
  const { lit, cars } = cityLights(score, t);
  const dark = luminanceOf(st.background) < 0.45;
  const body = dark ? 'rgba(8,10,24,0.92)' : alpha(st.ink, 0.88);
  const amber = (b: number) => `rgba(255,190,90,${b})`;

  ctx.save();
  // Sky glow over the city, breathing with the kick.
  const glow = ctx.createLinearGradient(0, a.top, 0, ground);
  glow.addColorStop(0, 'rgba(0,0,0,0)');
  glow.addColorStop(1, dark ? `rgba(90,70,160,${0.18 + 0.25 * drum.kick})` : `rgba(255,170,90,${0.12 + 0.2 * drum.kick})`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, a.top, W, ground - a.top);
  if (dark) {
    for (let i = 0; i < 80; i++) {
      const tw2 = 0.15 + 0.45 * hash(i, 3) * (0.7 + 0.3 * Math.sin(t * 1.3 + i) + 0.4 * drum.hat);
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0, tw2)})`;
      ctx.fillRect(hash(i, 1) * W, a.top + hash(i, 2) * (ground - a.top) * 0.55, 1.4 * u, 1.4 * u);
    }
  }
  const city = (reflection: boolean) => {
    for (let pc = 0; pc < 12; pc++) {
      const x = towerX(pc) + tw * 0.08;
      const w = tw * 0.84;
      const n = floors + extra(pc);
      const top = ground - n * floorH;
      ctx.fillStyle = body;
      ctx.fillRect(x, top, w, ground - top);
      ctx.strokeStyle = dark ? 'rgba(120,140,255,0.16)' : alpha(st.background, 0.15);
      ctx.lineWidth = Math.max(1, u);
      ctx.strokeRect(x + 0.5, top + 0.5, w - 1, ground - top);
      if (!reflection) {
        // Antennas, flashing with the snare.
        const ah = (14 + 18 * hash(pc, 1)) * u;
        ctx.strokeStyle = dark ? 'rgba(160,170,255,0.3)' : alpha(st.ink, 0.5);
        ctx.beginPath();
        ctx.moveTo(x + w / 2, top);
        ctx.lineTo(x + w / 2, top - ah);
        ctx.stroke();
        ctx.fillStyle = `rgba(255,77,109,${0.35 + 0.65 * Math.max(drum.snare, (Math.sin(t * 2 + pc) + 1) / 4)})`;
        ctx.beginPath();
        ctx.arc(x + w / 2, top - ah, 2.2 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let f = 0; f < n; f++) {
        const y = ground - (f + 0.5) * floorH;
        const b = lit.get(pc + 12 * (o0 + f)) ?? 0;
        const wx = x + w * 0.22;
        const ww = w * 0.56;
        const wh = floorH * 0.42;
        ctx.fillStyle = dark ? 'rgba(70,80,140,0.18)' : alpha(st.background, 0.12);
        ctx.fillRect(wx, y - wh / 2, ww, wh);
        if (b > 0.01) {
          if (!reflection) {
            ctx.save();
            ctx.shadowColor = '#ffb347';
            ctx.shadowBlur = 24 * u * b;
            ctx.fillStyle = amber(b);
            ctx.fillRect(wx, y - wh / 2, ww, wh);
            ctx.restore();
          } else {
            ctx.fillStyle = amber(b);
            ctx.fillRect(wx, y - wh / 2, ww, wh);
          }
        }
      }
    }
    // Moving voices: a light along the skybridge, then the lift.
    for (const car of cars) {
      const p0 = win(car.from);
      const p1 = win(car.to);
      const bridgeY = p0.y + floorH * 0.32;
      const q0 = { x: p0.x, y: bridgeY };
      const q1 = { x: p1.x, y: p1.y + floorH * 0.32 };
      ctx.strokeStyle = amber(0.3);
      ctx.lineWidth = Math.max(1.5, 2 * u);
      ctx.beginPath();
      ctx.moveTo(q0.x, q0.y);
      ctx.lineTo(q1.x, q0.y);
      ctx.lineTo(q1.x, q1.y);
      ctx.stroke();
      const c = carPos(q0, q1, car.f);
      ctx.save();
      if (!reflection) {
        ctx.shadowColor = '#ffd27a';
        ctx.shadowBlur = 26 * u;
      }
      ctx.fillStyle = '#ffe2a8';
      ctx.fillRect(c.x - 8 * u, c.y - 5 * u, 16 * u, 10 * u);
      ctx.restore();
    }
  };
  city(false);
  // The reflection in the water, then the water itself.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, ground + 6 * u, W, H - ground);
  ctx.clip();
  ctx.translate(0, 2 * ground + 6 * u);
  ctx.scale(1, -1);
  ctx.globalAlpha = 0.26;
  city(true);
  ctx.restore();
  const water = ctx.createLinearGradient(0, ground + 6 * u, 0, a.bottom + 40 * u);
  water.addColorStop(0, alpha(st.background, 0.15));
  water.addColorStop(1, alpha(st.background, 0.96));
  ctx.fillStyle = water;
  ctx.fillRect(0, ground + 6 * u, W, a.bottom + 40 * u - ground);
  // Ripples catching the light (and the kick).
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = amber(0.05 + 0.08 * drum.kick);
    const y = ground + 14 * u + hash(i, 7) * (a.bottom - ground);
    ctx.fillRect(((hash(i, 5) * W + t * 12 * (0.5 + hash(i, 9))) % (W + 60)) - 30, y, (24 + 40 * hash(i, 4)) * u, Math.max(1, u));
  }
  ctx.restore();
}

function drawBlueprintCity(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea) {
  const { u } = a;
  const W = a.width;
  const drum = drumPulse(score, t);
  const { o0, floors } = octRange(score);
  const extra = (pc: number) => Math.round(hash(pc, 7) * 2);
  const { lit, cars } = cityLights(score, t);
  const cell = W / 21;
  const FH = Math.min(cell * 1.7, (a.bottom - a.top - cell * 6) / (floors + 2.5));
  const baseY = a.bottom - cell * 3.2;
  const iso = (x: number, y: number, z: number) => ({ x: W / 2 + (x - y) * 0.866 * cell, y: baseY + (x + y) * 0.5 * cell - z });
  const gxOf = (pc: number) => pc * 1.25 - 7;
  const gyOf = (pc: number) => -pc * 0.15;
  const line = st.text;
  const glowC = st.accent;

  ctx.save();
  // The drawing grid, brightening with the kick.
  ctx.strokeStyle = alpha(line, 0.045 + 0.05 * drum.kick);
  ctx.lineWidth = Math.max(1, u * 0.8);
  ctx.beginPath();
  for (let x = 0; x < W; x += cell * 0.8) {
    ctx.moveTo(x, a.top);
    ctx.lineTo(x, a.bottom);
  }
  for (let y = a.top; y < a.bottom; y += cell * 0.8) {
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();
  const quad = (pts: { x: number; y: number }[]) => {
    ctx.beginPath();
    pts.forEach((q, j) => (j ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
  };
  const winQuad = (pc: number, f: number) => {
    const gx = gxOf(pc);
    const gy = gyOf(pc) + 1;
    const z0 = f * FH + FH * 0.27;
    const z1 = f * FH + FH * 0.73;
    return [iso(gx + 0.25, gy, z0), iso(gx + 0.75, gy, z0), iso(gx + 0.75, gy, z1), iso(gx + 0.25, gy, z1)];
  };
  const edge = alpha(line, 0.5 + 0.3 * drum.snare);
  for (let pc = 0; pc < 12; pc++) {
    const gx = gxOf(pc);
    const gy = gyOf(pc);
    const n = floors + extra(pc);
    const h = n * FH;
    const p = (dx: number, dy: number, z: number) => iso(gx + dx, gy + dy, z);
    const faces = [
      [p(0, 1, 0), p(1, 1, 0), p(1, 1, h), p(0, 1, h)],
      [p(1, 0, 0), p(1, 1, 0), p(1, 1, h), p(1, 0, h)],
      [p(0, 0, h), p(1, 0, h), p(1, 1, h), p(0, 1, h)],
    ];
    faces.forEach((f, i) => {
      quad(f);
      ctx.fillStyle = alpha(st.background, 0.85);
      ctx.fill();
      ctx.fillStyle = alpha(line, [0.03, 0.06, 0.09][i]);
      ctx.fill();
      ctx.strokeStyle = edge;
      ctx.lineWidth = Math.max(1, u);
      ctx.stroke();
    });
    for (let f = 0; f < n; f++) {
      const q0 = iso(gx, gy + 1, f * FH);
      const q1 = iso(gx + 1, gy + 1, f * FH);
      ctx.strokeStyle = alpha(line, 0.15);
      ctx.beginPath();
      ctx.moveTo(q0.x, q0.y);
      ctx.lineTo(q1.x, q1.y);
      ctx.stroke();
      const b = lit.get(pc + 12 * (o0 + f)) ?? 0;
      quad(winQuad(pc, f));
      if (b > 0.01) {
        ctx.save();
        ctx.shadowColor = glowC;
        ctx.shadowBlur = 16 * u * b;
        ctx.fillStyle = alpha(glowC, b);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.strokeStyle = alpha(line, 0.22);
        ctx.stroke();
      }
    }
  }
  // Moving voices: a dashed route along the front of the towers, with a bright car.
  for (const car of cars) {
    const centre = (c: Cell) => {
      const w = winQuad(c.pc, c.oct - o0);
      return { x: (w[0].x + w[2].x) / 2, y: (w[0].y + w[2].y) / 2 };
    };
    const p0 = centre(car.from);
    const p1 = centre(car.to);
    ctx.setLineDash([6 * u, 5 * u]);
    ctx.strokeStyle = alpha(glowC, 0.8);
    ctx.lineWidth = Math.max(1, 1.4 * u);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const m = { x: p0.x + (p1.x - p0.x) * car.f, y: p0.y + (p1.y - p0.y) * car.f };
    ctx.save();
    ctx.shadowColor = st.background === '#ffffff' ? glowC : '#ffffff';
    ctx.shadowBlur = 14 * u;
    ctx.fillStyle = st.ink;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 4.5 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** 0 (black) … 1 (white) for a hex colour; mid-grey for anything else. */
function luminanceOf(c: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(c)) return 0.5;
  const n = parseInt(c.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

// ---------------------------------------------------------------------------
// Kaleidoscope
// ---------------------------------------------------------------------------

/**
 * Each voice is a coloured shard: its angle within the wedge is its note, its distance from the
 * middle its register, its colour the note's. The shards are mirrored round into a mandala whose
 * symmetry is the number of different notes in the chord: a unison is a single mirrored pair, a
 * triad 3-fold, a 9th chord 5-fold. A chord change re-folds the pattern (crossfading from the
 * old symmetry to the new); glides slide shards across. The whole thing turns slowly; kicks
 * breathe it outward.
 */
export function drawKaleidoscope(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea) {
  const { cx, cy, u } = a;
  const R = a.R * 0.92;
  const drum = drumPulse(score, t);
  const { lo, span } = skyRange(score);
  const now = chordAt(score, t);
  const dark = luminanceOf(st.background) < 0.45;
  const foldOf = (c: Score['chords'][number] | null) => (c ? new Set(c.notes.map((n) => mod12(Math.round(n)))).size : 1);
  const V = score.config.voices;
  const shards = Array.from({ length: V }, (_, v) => {
    const p = pitchAt(score, v, t);
    return { p, level: levelAt(score, v, t), v };
  });
  const spin = 0.04 * t;
  const breathe = 1 + 0.06 * drum.kick;
  const pattern = (fold: number, opacity: number) => {
    if (opacity < 0.01) return;
    const wedge = Math.PI / Math.max(1, fold);
    for (let k = 0; k < 2 * Math.max(1, fold); k++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(spin + k * wedge);
      if (k % 2) ctx.scale(1, -1);
      for (const s of shards) {
        if (s.level < 0.02) continue;
        const pc = ((s.p % 12) + 12) % 12;
        const ang = (pc / 12) * wedge * 0.94 + wedge * 0.03;
        const r = R * (0.12 + 0.78 * Math.max(0, Math.min(1, (s.p - lo) / span))) * breathe;
        const x = Math.cos(ang) * r;
        const y = Math.sin(ang) * r;
        const size = R * (0.05 + 0.05 * s.level) * (0.8 + 0.4 * hash(s.v, 3));
        const rot = s.p * 0.9 + s.v;
        ctx.fillStyle = alpha(st.pcColor(mod12(Math.round(s.p))), (dark ? 0.3 : 0.5) * opacity);
        ctx.strokeStyle = alpha(dark ? '#ffffff' : st.ink, 0.22 * opacity);
        ctx.lineWidth = Math.max(1, 0.8 * u);
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const q = rot + (i * Math.PI * 2) / 3 + (i === 1 ? 0.5 : 0);
          const rr = size * (i === 2 ? 1.25 : 1);
          if (i) ctx.lineTo(x + Math.cos(q) * rr, y + Math.sin(q) * rr);
          else ctx.moveTo(x + Math.cos(q) * rr, y + Math.sin(q) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  };
  ctx.save();
  // The tube: a dark disc, the pattern glowing inside it, and a rim.
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  bg.addColorStop(0, dark ? alpha('#ffffff', 0.05) : alpha(st.ink, 0.04));
  bg.addColorStop(1, dark ? 'rgba(0,0,0,0.35)' : alpha(st.ink, 0.1));
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.save();
  ctx.clip();
  if (dark) ctx.globalCompositeOperation = 'lighter';
  const fNow = foldOf(now.c);
  const fPrev = foldOf(now.prev);
  if (fPrev !== fNow && now.x < 1) {
    pattern(fPrev, 1 - now.x);
    pattern(fNow, now.x);
  } else pattern(fNow, 1);
  ctx.restore();
  ctx.strokeStyle = alpha(st.text, 0.3);
  ctx.lineWidth = Math.max(2, 3 * u);
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Lava lamp
// ---------------------------------------------------------------------------

/**
 * The classic lamp: a chrome cone base, a tapered glass bottle, a little cone cap, coloured
 * liquid lit from below. Each note sounding is a blob of wax at its pitch's height (low at the
 * bottom); voices on the same note fuse into one bigger blob. Blobs follow their notes slowly,
 * with weight, stretching tall as they rise or sink, and melt together when they meet; a molten
 * pool always sits at the bottom. Kicks flare the bulb and wobble the wax.
 */
interface LavaBuffer {
  w: number;
  h: number;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  img: ImageData;
}
let lava: LavaBuffer | null = null;
function lavaBuffer(w: number, h: number): LavaBuffer {
  if (lava && lava.w === w && lava.h === h) return lava;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const c = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  lava = { w, h, canvas, ctx: c, img: c.createImageData(w, h) };
  return lava;
}

export function drawLavaLamp(ctx: CanvasRenderingContext2D, score: Score, t: number, _st: ViewStyle, a: ViewArea, lite = false) {
  const { cx, u } = a;
  const drum = drumPulse(score, t);
  const { lo, span } = skyRange(score);
  const V = score.config.voices;
  // Proportions of the classic lamp.
  const total = (a.bottom - a.top) * 0.96;
  const top = a.top + (a.bottom - a.top - total) / 2;
  const capH = total * 0.13;
  const glassH = total * 0.6;
  const baseH = total - capH - glassH;
  const gTop = top + capH;
  const gBot = gTop + glassH;
  const wMax = Math.min(a.width * 0.22, total * 0.19);
  /** Glass half-width at height fraction f (0 bottom, 1 top): a little swell low down, tapering up. */
  const glassHW = (f: number) => {
    const swell = f < 0.28 ? 0.84 + 0.16 * Math.sin((f / 0.28) * (Math.PI / 2)) : 1 - 0.56 * ((f - 0.28) / 0.72) ** 1.15;
    return wMax * swell;
  };
  const yOf = (f: number) => gBot - f * glassH;

  // Blobs: one per note sounding (voices on it fuse), at its height, following with weight.
  const smoothP = (v: number, time: number) => {
    let s = 0;
    let w = 0;
    for (let i = 0; i < 9; i++) {
      const age = i * 0.2;
      const k = Math.exp(-age / 0.6);
      s += pitchAt(score, v, time - age) * k;
      w += k;
    }
    return s / w;
  };
  const groups = new Map<number, { p: number; pPrev: number; n: number; level: number }>();
  for (let v = 0; v < V; v++) {
    const p = smoothP(v, t);
    const key = Math.round(p * 2);
    const g = groups.get(key) ?? { p: 0, pPrev: 0, n: 0, level: 0 };
    g.p += p;
    g.pPrev += smoothP(v, t - 0.15);
    g.n++;
    g.level = Math.max(g.level, levelAt(score, v, t));
    groups.set(key, g);
  }
  const blobs = [...groups.values()].sort((x, y) => x.p - y.p).map((g, i) => {
    const p = g.p / g.n;
    const vel = (p - g.pPrev / g.n) / 0.15; // semitones per second
    const f = 0.1 + 0.78 * Math.max(0, Math.min(1, (p - lo) / span));
    const r = wMax * (0.12 + 0.05 * Math.sqrt(g.n)) * (0.75 + 0.25 * g.level) * (1 + 0.08 * drum.kick * Math.sin(t * 25 + i));
    const sy = 1 + Math.min(1.3, Math.abs(vel) * 0.12);
    const room = glassHW(f) - r * 0.8;
    // Neighbouring notes sit on alternate sides, so blobs spread across the glass.
    const x = cx + Math.max(-room, Math.min(room, glassHW(f) * 0.5 * Math.sin(i * 2.4 + 0.13 * t + 0.4 * Math.sin(0.07 * t + i))));
    return { x, y: yOf(f), r, sx: 1 / Math.sqrt(sy), sy };
  });
  // The molten pool at the bottom.
  blobs.push({ x: cx, y: gBot + wMax * 0.1, r: wMax * 0.36, sx: 1.9, sy: 0.5 });

  // Render the wax and liquid into a buffer covering the glass.
  const scale = lite ? 0.35 : 0.55;
  const bw = Math.max(40, Math.round(wMax * 2 * scale));
  const bh = Math.max(80, Math.round(glassH * scale));
  const buf = lavaBuffer(bw, bh);
  const data = buf.img.data;
  const flare = 1 + 0.35 * drum.kick;
  for (let j = 0; j < bh; j++) {
    const y = gTop + (j / (bh - 1)) * glassH;
    const f = (gBot - y) / glassH;
    const hw = glassHW(f);
    // The liquid: lit from the bulb below, deep violet higher up.
    const lift = Math.pow(Math.max(0, f), 0.8);
    const lr = (150 - 90 * lift) * flare;
    const lg = (40 - 15 * lift) * flare;
    const lb = (120 + 20 * lift) * flare;
    for (let i = 0; i < bw; i++) {
      const x = cx - wMax + (i / (bw - 1)) * wMax * 2;
      const o = (j * bw + i) * 4;
      if (Math.abs(x - cx) > hw) {
        data[o + 3] = 0;
        continue;
      }
      let field = 0;
      for (const b of blobs) {
        const dx = (x - b.x) / b.sx;
        const dy = (y - b.y) / b.sy;
        field += (b.r * b.r) / (dx * dx + dy * dy + 1);
      }
      // Edge darkening of the glass (it's a curved bottle).
      const edge = 1 - 0.45 * Math.pow(Math.abs(x - cx) / hw, 3);
      if (field > 1) {
        // Wax: hot and bright inside, deeper at the skin.
        const k = Math.min(1, (field - 1) * 0.9);
        data[o] = Math.min(255, (235 + 20 * k) * edge * flare);
        data[o + 1] = Math.min(255, (70 + 120 * k) * edge * flare);
        data[o + 2] = Math.min(255, (40 + 40 * k) * edge);
        data[o + 3] = 255;
      } else {
        const glow = Math.max(0, field - 0.55) * 1.6; // the wax lights the liquid around it
        data[o] = Math.min(255, (lr + 90 * glow) * edge);
        data[o + 1] = Math.min(255, (lg + 40 * glow) * edge);
        data[o + 2] = Math.min(255, (lb + 10 * glow) * edge);
        data[o + 3] = 255;
      }
    }
  }
  buf.ctx.putImageData(buf.img, 0, 0);

  ctx.save();
  // Light the lamp throws around it.
  const halo = ctx.createRadialGradient(cx, gBot, 0, cx, gBot, wMax * 4);
  halo.addColorStop(0, `rgba(255,120,80,${0.16 * flare})`);
  halo.addColorStop(1, 'rgba(255,120,80,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(cx - wMax * 4, gBot - wMax * 4, wMax * 8, wMax * 8);
  // The glass contents.
  const glass = new Path2D();
  for (let k = 0; k <= 40; k++) {
    const f = k / 40;
    const p = { x: cx - glassHW(f), y: yOf(f) };
    if (k) glass.lineTo(p.x, p.y);
    else glass.moveTo(p.x, p.y);
  }
  for (let k = 40; k >= 0; k--) glass.lineTo(cx + glassHW(k / 40), yOf(k / 40));
  glass.closePath();
  ctx.save();
  ctx.clip(glass);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(buf.canvas as CanvasImageSource, cx - wMax, gTop, wMax * 2, glassH);
  // Glass highlights: a long streak on the left, a thin one on the right.
  const streak = ctx.createLinearGradient(cx - wMax, 0, cx + wMax, 0);
  streak.addColorStop(0.12, 'rgba(255,255,255,0)');
  streak.addColorStop(0.2, 'rgba(255,255,255,0.28)');
  streak.addColorStop(0.27, 'rgba(255,255,255,0)');
  streak.addColorStop(0.8, 'rgba(255,255,255,0)');
  streak.addColorStop(0.84, 'rgba(255,255,255,0.12)');
  streak.addColorStop(0.88, 'rgba(255,255,255,0)');
  ctx.fillStyle = streak;
  ctx.fillRect(cx - wMax, gTop, wMax * 2, glassH);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = Math.max(1, 1.2 * u);
  ctx.stroke(glass);
  // Chrome: the cap and the base, brushed metal with a bright vertical highlight.
  const chrome = (x0: number, x1: number) => {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, '#3a3a40');
    g.addColorStop(0.22, '#c9cbd2');
    g.addColorStop(0.32, '#f4f5f8');
    g.addColorStop(0.45, '#8c8f98');
    g.addColorStop(0.75, '#5a5c63');
    g.addColorStop(1, '#2c2c31');
    return g;
  };
  const capTopW = glassHW(1) * 0.55;
  ctx.fillStyle = chrome(cx - glassHW(1), cx + glassHW(1));
  ctx.beginPath();
  ctx.moveTo(cx - glassHW(1) * 1.04, gTop);
  ctx.lineTo(cx + glassHW(1) * 1.04, gTop);
  ctx.lineTo(cx + capTopW, top);
  ctx.lineTo(cx - capTopW, top);
  ctx.closePath();
  ctx.fill();
  const bTopW = glassHW(0) * 1.04;
  const bBotW = wMax * 1.55;
  ctx.fillStyle = chrome(cx - bBotW, cx + bBotW);
  ctx.beginPath();
  ctx.moveTo(cx - bTopW, gBot);
  ctx.lineTo(cx + bTopW, gBot);
  ctx.lineTo(cx + bBotW, gBot + baseH);
  ctx.lineTo(cx - bBotW, gBot + baseH);
  ctx.closePath();
  ctx.fill();
  // A lip where the glass meets the base.
  ctx.fillStyle = chrome(cx - bTopW, cx + bTopW);
  ctx.fillRect(cx - bTopW * 1.04, gBot - 3 * u, bTopW * 2.08, 6 * u);
  ctx.restore();
}
