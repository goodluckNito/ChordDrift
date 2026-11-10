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
 * One flock that takes the shape of the chord. Around an invisible clock of the twelve notes,
 * every voice leads from its note's angle (a little further out the higher it is), and the birds
 * stream round the polygon the chord's notes make, gathering in knots at each note. So each kind of
 * chord has its own figure in any key: a major triad one triangle, a minor triad its mirror image,
 * a 7th chord a four-sided shape, a unison one ball; changing the root turns the figure. The
 * leaders follow their notes slowly, with weight, and the birds trail behind, so a chord change is
 * the whole flock wheeling into the next shape. Kicks make it pulse, snares send a ripple round it.
 */
export function drawMurmuration(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea, lite = false) {
  const { cx, cy, u, tu } = a;
  const W = a.width;
  const Rr = Math.min(W * 0.36, (a.bottom - a.top) * 0.38);
  const { lo, span } = skyRange(score);
  const V = score.config.voices;
  const drum = drumPulse(score, t);
  const BIRDS = lite ? 700 : 1600;
  // A leader follows its note with weight: an average of where the note was over the last
  // couple of seconds, recent moments counting most.
  const smoothP = (v: number, time: number) => {
    let s = 0;
    let w = 0;
    for (let i = 0; i < 10; i++) {
      const age = i * 0.16;
      const k = Math.exp(-age / 0.5);
      s += pitchAt(score, v, time - age) * k;
      w += k;
    }
    return s / w;
  };
  // The figure at a moment: the distinct notes' places round the clock, in order of angle.
  const figure = (time: number) => {
    const pts: { x: number; y: number; ang: number; n: number }[] = [];
    for (let v = 0; v < V; v++) {
      if (levelAt(score, v, time) < 0.03) continue;
      const p = smoothP(v, time);
      const ang = -Math.PI / 2 + (Math.PI * 2 * p) / 12;
      const r = Rr * (0.72 + 0.4 * Math.max(0, Math.min(1, (p - lo) / span)));
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      const near = pts.find((q) => Math.hypot(q.x - x, q.y - y) < Rr * 0.06);
      if (near) near.n++;
      else pts.push({ x, y, ang: ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), n: 1 });
    }
    pts.sort((p, q) => p.ang - q.ang);
    // Perimeter, for spacing birds evenly round it.
    const seg: number[] = [];
    let per = 0;
    for (let i = 0; i < pts.length; i++) {
      const b = pts[(i + 1) % pts.length];
      const d = pts.length > 1 ? Math.hypot(b.x - pts[i].x, b.y - pts[i].y) : 0;
      seg.push(d);
      per += d;
    }
    return { pts, seg, per };
  };
  const LAGS = 6;
  const lagStep = 0.12;
  const figs = Array.from({ length: LAGS }, (_, j) => figure(t - j * lagStep));
  const pulse = 1 + 0.45 * drum.kick;
  const rippleAge = drum.snare > 0.02 ? Math.max(0, t - drum.snareAt) : -1;

  ctx.save();
  // The clock, barely there: twelve ticks and the note names, to read the figure by.
  ctx.fillStyle = alpha(st.text, 0.22);
  ctx.font = `500 ${13 * tu}px ${st.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const now = chordAt(score, t);
  for (let pc = 0; pc < 12; pc++) {
    const ang = -Math.PI / 2 + (Math.PI * 2 * pc) / 12;
    ctx.fillText(nameOf(score, pc, now.c), cx + Math.cos(ang) * Rr * 1.36, cy + Math.sin(ang) * Rr * 1.36);
  }
  ctx.strokeStyle = alpha(st.ink, 0.7);
  ctx.lineWidth = Math.max(1, 1.3 * u);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let b = 0; b < BIRDS; b++) {
    const lag = Math.min(LAGS - 1.001, hash(b, 2) * hash(b, 3) * (LAGS - 1));
    const j0 = Math.floor(lag);
    const lf = lag - j0;
    // Most birds stream round the outline (circling slowly); the rest gather at the notes.
    const knot = hash(b, 1) < 0.4;
    const flow = (hash(b, 4) + t * 0.035 * (0.7 + 0.6 * hash(b, 5))) % 1;
    const place = (fig: ReturnType<typeof figure>) => {
      const { pts, seg, per } = fig;
      if (!pts.length) return { x: cx, y: cy, dx: 1, dy: 0 };
      if (knot || per < Rr * 0.05) {
        const q = pts[Math.floor(hash(b, 6) * pts.length)];
        return { x: q.x, y: q.y, dx: 1, dy: 0 };
      }
      let d = flow * per;
      let i = 0;
      while (i < seg.length - 1 && d > seg[i]) d -= seg[i++];
      const A = pts[i];
      const B = pts[(i + 1) % pts.length];
      const f = seg[i] > 0 ? d / seg[i] : 0;
      return { x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f, dx: B.x - A.x, dy: B.y - A.y };
    };
    const P = place(figs[j0]);
    const Qp = place(figs[j0 + 1]);
    const x0 = P.x + (Qp.x - P.x) * lf;
    const y0 = P.y + (Qp.y - P.y) * lf;
    const len = Math.hypot(P.dx, P.dy) || 1;
    const nx = -P.dy / len;
    const ny = P.dx / len;
    const g = (hash(b, 7) + hash(b, 8) + hash(b, 9)) / 1.5 - 1;
    const g2 = (hash(b, 10) + hash(b, 11)) - 1;
    const wave = 0.5 + 0.5 * Math.sin(flow * Math.PI * 8 - t * 1.6);
    const ripple = rippleAge >= 0 ? Math.exp(-((flow - ((rippleAge * 0.8) % 1)) ** 2) * 60) * drum.snare : 0;
    const thick = Rr * (knot ? 0.1 : 0.045 + 0.04 * wave + 0.06 * ripple) * pulse;
    const x = x0 + (knot ? Math.cos(b) * g : nx * g) * thick + (knot ? 0 : (P.dx / len) * g2 * thick * 0.6) + Math.sin(t * 1.7 + b * 1.3) * 2.5 * u;
    const y = y0 + (knot ? Math.sin(b * 1.7) * g : ny * g) * thick + (knot ? 0 : (P.dy / len) * g2 * thick * 0.6) + Math.cos(t * 1.3 + b * 2.1) * 2.5 * u;
    const hd = Math.atan2(P.dy, P.dx) + 0.6 * Math.sin(b + t);
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
 * A voice that moves flies as a comet over the rooftops from its old window to the new one, which
 * lights as it lands. Lit windows show a little life inside (a lamp, a plant, a cat). Kicks light up the sky,
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

/** A little silhouette inside a lit window: someone's lamp, plant, cat, sofa… (picked per window). */
function furniture(c: CanvasRenderingContext2D, kind: number, x: number, y: number, w: number, h: number) {
  c.fillStyle = 'rgba(40,18,8,0.82)';
  c.beginPath();
  switch (kind % 7) {
    case 0: // floor lamp
      c.rect(x + w * 0.72, y + h * 0.35, w * 0.05, h * 0.65);
      c.moveTo(x + w * 0.62, y + h * 0.38);
      c.lineTo(x + w * 0.87, y + h * 0.38);
      c.lineTo(x + w * 0.81, y + h * 0.18);
      c.lineTo(x + w * 0.68, y + h * 0.18);
      break;
    case 1: // potted plant
      c.rect(x + w * 0.18, y + h * 0.72, w * 0.2, h * 0.28);
      c.ellipse(x + w * 0.22, y + h * 0.55, w * 0.07, h * 0.18, -0.5, 0, Math.PI * 2);
      c.ellipse(x + w * 0.34, y + h * 0.52, w * 0.07, h * 0.2, 0.5, 0, Math.PI * 2);
      c.ellipse(x + w * 0.28, y + h * 0.45, w * 0.05, h * 0.2, 0, 0, Math.PI * 2);
      break;
    case 2: // someone at the window
      c.arc(x + w * 0.5, y + h * 0.45, Math.min(w, h) * 0.13, 0, Math.PI * 2);
      c.roundRect(x + w * 0.3, y + h * 0.62, w * 0.4, h * 0.4, w * 0.15);
      break;
    case 3: // sofa
      c.roundRect(x + w * 0.1, y + h * 0.66, w * 0.8, h * 0.34, w * 0.05);
      c.roundRect(x + w * 0.06, y + h * 0.58, w * 0.12, h * 0.42, w * 0.04);
      c.roundRect(x + w * 0.82, y + h * 0.58, w * 0.12, h * 0.42, w * 0.04);
      break;
    case 4: // cat on the sill
      c.ellipse(x + w * 0.6, y + h * 0.9, w * 0.17, h * 0.1, 0, 0, Math.PI * 2);
      c.arc(x + w * 0.42, y + h * 0.8, Math.min(w, h) * 0.08, 0, Math.PI * 2);
      c.moveTo(x + w * 0.36, y + h * 0.76);
      c.lineTo(x + w * 0.38, y + h * 0.66);
      c.lineTo(x + w * 0.42, y + h * 0.74);
      c.lineTo(x + w * 0.46, y + h * 0.66);
      c.lineTo(x + w * 0.48, y + h * 0.76);
      break;
    case 5: // bookshelf
      c.rect(x + w * 0.62, y + h * 0.15, w * 0.3, h * 0.85);
      break;
    default: // curtains half drawn
      c.moveTo(x, y);
      c.lineTo(x + w * 0.22, y);
      c.quadraticCurveTo(x + w * 0.12, y + h * 0.6, x + w * 0.2, y + h);
      c.lineTo(x, y + h);
      c.moveTo(x + w, y);
      c.lineTo(x + w * 0.8, y);
      c.quadraticCurveTo(x + w * 0.9, y + h * 0.6, x + w * 0.82, y + h);
      c.lineTo(x + w, y + h);
  }
  c.fill();
  if (kind % 7 === 5) {
    // books on the shelf
    c.fillStyle = 'rgba(255,200,120,0.35)';
    for (let i = 0; i < 3; i++) c.fillRect(x + w * 0.64, y + h * (0.28 + i * 0.24), w * 0.26, h * 0.04);
  }
}

let cityBuf: { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D } | null = null;
function cityCanvas(w: number, h: number) {
  if (!cityBuf || cityBuf.canvas.width !== w || cityBuf.canvas.height !== h) {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    cityBuf = { canvas, ctx: canvas.getContext('2d') as unknown as CanvasRenderingContext2D };
  }
  cityBuf.ctx.setTransform(1, 0, 0, 1, 0, 0);
  cityBuf.ctx.clearRect(0, 0, w, h);
  return cityBuf;
}

function drawNeonCity(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea) {
  const { u } = a;
  const W = a.width;
  const drum = drumPulse(score, t);
  const { o0, floors } = octRange(score);
  const margin = W * 0.05;
  const tw = (W - 2 * margin) / 12;
  const ground = a.top + (a.bottom - a.top) * 0.7;
  const floorH = Math.min(tw * 0.95, (ground - a.top - 40 * u) / (floors + 2.6));
  const extra = (pc: number) => Math.round(hash(pc, 7) * 2.4);
  const towerX = (pc: number) => margin + pc * tw;
  // Two windows a floor; a note lights one of them (which one is the building's habit).
  const side = (pc: number, oct: number) => (hash(pc, oct, 11) < 0.5 ? 0 : 1);
  const winRect = (pc: number, oct: number, s: number) => {
    const x = towerX(pc) + tw * 0.08;
    const w = tw * 0.84;
    const ww = w * 0.27;
    const wh = floorH * 0.42;
    const y = ground - (oct - o0 + 0.5) * floorH;
    return { x: x + w * (s ? 0.6 : 0.13), y: y - wh / 2, w: ww, h: wh };
  };
  const winCentre = (c: Cell) => {
    const r = winRect(c.pc, c.oct, side(c.pc, c.oct));
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };
  const { lit, cars } = cityLights(score, t);
  const dark = luminanceOf(st.background) < 0.45;
  const body = dark ? '#0a0c1c' : alpha(st.ink, 0.9);
  const amber = (b: number) => `rgba(255,190,96,${b})`;
  const H = ctx.canvas.height;
  // The skyline is drawn once into a buffer, then onto the frame and, rippled, into the water.
  const buf = cityCanvas(ctx.canvas.width, H);
  const c = buf.ctx;
  c.setTransform(ctx.getTransform());

  ctx.save();
  // Sky glow over the city, breathing with the kick; stars on dark themes.
  const glow = ctx.createLinearGradient(0, a.top, 0, ground);
  glow.addColorStop(0, 'rgba(0,0,0,0)');
  glow.addColorStop(1, dark ? `rgba(110,70,170,${0.2 + 0.25 * drum.kick})` : `rgba(255,170,90,${0.14 + 0.2 * drum.kick})`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, a.top, W, ground - a.top);
  if (dark) {
    for (let i = 0; i < 90; i++) {
      const b = 0.15 + 0.45 * hash(i, 3) * (0.7 + 0.3 * Math.sin(t * 1.3 + i) + 0.4 * drum.hat);
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0, b)})`;
      ctx.fillRect(hash(i, 1) * W, a.top + hash(i, 2) * (ground - a.top) * 0.55, 1.4 * u, 1.4 * u);
    }
  }
  for (let pc = 0; pc < 12; pc++) {
    const x = towerX(pc) + tw * 0.08;
    const w = tw * 0.84;
    const n = floors + extra(pc);
    const top = ground - n * floorH;
    c.fillStyle = body;
    c.fillRect(x, top, w, ground - top);
    // A ledge between floors and a rim light down one edge.
    c.fillStyle = dark ? 'rgba(130,150,255,0.07)' : alpha(st.background, 0.08);
    for (let f = 1; f < n; f++) c.fillRect(x, ground - f * floorH - 1 * u, w, 2 * u);
    c.fillStyle = dark ? 'rgba(150,170,255,0.18)' : alpha(st.background, 0.2);
    c.fillRect(x + w - 2 * u, top, 2 * u, ground - top);
    // Roof: an antenna with a light that flashes on the snare, or a water tank.
    if (hash(pc, 5) < 0.6) {
      const ah = (14 + 18 * hash(pc, 1)) * u;
      c.strokeStyle = dark ? 'rgba(160,170,255,0.35)' : alpha(st.ink, 0.55);
      c.lineWidth = Math.max(1, u);
      c.beginPath();
      c.moveTo(x + w / 2, top);
      c.lineTo(x + w / 2, top - ah);
      c.stroke();
      c.fillStyle = `rgba(255,77,109,${0.35 + 0.65 * Math.max(drum.snare, (Math.sin(t * 2 + pc) + 1) / 4)})`;
      c.beginPath();
      c.arc(x + w / 2, top - ah, 2.2 * u, 0, Math.PI * 2);
      c.fill();
    } else {
      c.fillStyle = body;
      c.fillRect(x + w * 0.25, top - 10 * u, w * 0.3, 10 * u);
      c.fillRect(x + w * 0.28, top - 14 * u, w * 0.24, 4 * u);
    }
    for (let f = 0; f < n; f++) {
      const oct = o0 + f;
      for (const s of [0, 1]) {
        const r = winRect(pc, oct, s);
        const on = s === side(pc, oct) ? lit.get(pc + 12 * oct) ?? 0 : 0;
        c.fillStyle = dark ? 'rgba(70,80,140,0.2)' : alpha(st.background, 0.12);
        c.fillRect(r.x, r.y, r.w, r.h);
        if (on > 0.01) {
          c.save();
          c.shadowColor = '#ffb347';
          c.shadowBlur = 18 * u * on;
          c.fillStyle = amber(on);
          c.fillRect(r.x, r.y, r.w, r.h);
          c.restore();
          c.save();
          c.globalAlpha = Math.min(1, on * 1.2);
          c.beginPath();
          c.rect(r.x, r.y, r.w, r.h);
          c.clip();
          furniture(c, Math.floor(hash(pc, oct, 3) * 7), r.x, r.y, r.w, r.h);
          c.restore();
        }
      }
    }
  }
  // The street.
  c.fillStyle = body;
  c.fillRect(0, ground - 2 * u, W, 4 * u);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(buf.canvas as CanvasImageSource, 0, 0);
  ctx.restore();

  // The water: the skyline mirrored, each strip rippled sideways (more the nearer you look),
  // fading and tinted with depth; the kick sends a stronger ripple through.
  const m = ctx.getTransform();
  const groundPx = m.d * ground + m.f;
  const bottomPx = Math.min(H, m.d * (a.bottom + 30 * u) + m.f);
  const waterH = bottomPx - groundPx;
  if (waterH > 4) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const step = 2;
    for (let y = 0; y < waterH; y += step) {
      const depth = y / waterH;
      const src = groundPx - y - step;
      if (src < 0) break;
      const dx = (Math.sin(y * 0.09 + t * 1.6) * 2 + Math.sin(y * 0.031 - t * 0.9) * 3) * (0.4 + 2.2 * depth) * (1 + 1.5 * drum.kick) * m.a;
      ctx.globalAlpha = 0.6 * (1 - depth) ** 1.2;
      ctx.drawImage(buf.canvas as CanvasImageSource, 0, src, ctx.canvas.width, step, dx, groundPx + y, ctx.canvas.width, step);
    }
    ctx.globalAlpha = 1;
    const tint = ctx.createLinearGradient(0, groundPx, 0, bottomPx);
    tint.addColorStop(0, alpha(st.background, 0.12));
    tint.addColorStop(1, alpha(st.background, 0.92));
    ctx.fillStyle = tint;
    ctx.fillRect(0, groundPx, ctx.canvas.width, waterH);
    ctx.restore();
  }

  // Moving voices: a comet arcing over the rooftops from the old window to the new one, its tail
  // fading behind it; the new window lights as it lands.
  for (const car of cars) {
    const p0 = winCentre(car.from);
    const p1 = winCentre(car.to);
    const lift = Math.abs(p1.x - p0.x) * 0.3 + Math.abs(p1.y - p0.y) * 0.2 + 30 * u;
    const ctrl = { x: (p0.x + p1.x) / 2, y: Math.min(p0.y, p1.y) - lift };
    const at = (s: number) => ({
      x: (1 - s) ** 2 * p0.x + 2 * (1 - s) * s * ctrl.x + s * s * p1.x,
      y: (1 - s) ** 2 * p0.y + 2 * (1 - s) * s * ctrl.y + s * s * p1.y,
    });
    const f = car.f;
    const tail = 0.4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const s0 = Math.max(0, f - tail + (tail * i) / 16);
      const s1 = Math.max(0, f - tail + (tail * (i + 1)) / 16);
      if (s1 <= 0) continue;
      const q0 = at(s0);
      const q1 = at(s1);
      ctx.strokeStyle = amber(0.08 + 0.6 * (i / 16) ** 2);
      ctx.lineWidth = Math.max(1, (1 + 4 * (i / 16)) * u);
      ctx.beginPath();
      ctx.moveTo(q0.x, q0.y);
      ctx.lineTo(q1.x, q1.y);
      ctx.stroke();
    }
    const h = at(f);
    ctx.save();
    ctx.shadowColor = '#ffd27a';
    ctx.shadowBlur = 22 * u;
    ctx.fillStyle = '#fff0cc';
    ctx.beginPath();
    ctx.arc(h.x, h.y, 4.5 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
  // Sized to fit the band both ways: the street runs diagonally across, towers rise from it.
  const band = a.bottom - a.top;
  const cell = Math.min(W / 21, band / 11);
  const baseY = a.bottom - cell * 4.2;
  const FH = Math.max(cell * 0.6, (baseY - cell * 3.6 - a.top - 20 * u) / (floors + 2));
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
 * A real kaleidoscope: a chamber of backlit glass (faceted shards and glossy beads in jewel
 * colours, blended like light through glass), mirrored round into the full circle and seen
 * through an eyepiece. Every voice is a jewel: its note sets its colour and its angle in the
 * chamber, its register how far out it sits, its level its size; voices on one note pile up into
 * a cluster. The mirrors fold once per different note in the chord (at least three), so chord
 * changes re-fold the pattern (crossfading); glides slide jewels across, the whole thing turns
 * slowly. Kicks flash it, snares shake the glass, hats sparkle.
 */
let chamber: { q: number; canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D } | null = null;
function chamberCanvas(q: number) {
  if (!chamber || chamber.q !== q) {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(q, q) : Object.assign(document.createElement('canvas'), { width: q, height: q });
    chamber = { q, canvas, ctx: canvas.getContext('2d') as unknown as CanvasRenderingContext2D };
  }
  chamber.ctx.setTransform(1, 0, 0, 1, 0, 0);
  chamber.ctx.clearRect(0, 0, q, q);
  return chamber;
}
/** Jewel colour for a note: around the circle of fifths, fully saturated. */
const jewel = (pc: number, l = 56, a = 1) => `hsla(${(mod12(pc * 7) * 30 + 15) % 360}, 92%, ${l}%, ${a})`;

export function drawKaleidoscope(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea, lite = false) {
  const { cx, cy, u } = a;
  const R = a.R * 0.92;
  const drum = drumPulse(score, t);
  const { lo, span } = skyRange(score);
  const now = chordAt(score, t);
  const foldOf = (c: Score['chords'][number] | null) => Math.max(3, Math.min(9, c ? new Set(c.notes.map((n) => mod12(Math.round(n)))).size : 3));
  const V = score.config.voices;
  const Q = lite ? 300 : 520;
  const half = Q / 2;
  const spin = 0.035 * t;

  // Paint the chamber once per fold count: jewels laid out in polar coordinates round its centre.
  const paintChamber = (fold: number) => {
    const ch = chamberCanvas(Q);
    const c = ch.ctx;
    const wedge = Math.PI / fold;
    c.translate(half, half);
    // Backlight.
    const back = c.createRadialGradient(0, 0, 0, 0, 0, half);
    back.addColorStop(0, `rgba(40,30,60,${0.9 + 0.1 * drum.kick})`);
    back.addColorStop(1, 'rgba(6,4,12,1)');
    c.fillStyle = back;
    c.fillRect(-half, -half, Q, Q);
    c.globalCompositeOperation = 'screen';
    for (let v = 0; v < V; v++) {
      const p = pitchAt(score, v, t);
      const level = levelAt(score, v, t);
      if (level < 0.03) continue;
      const pc = ((p % 12) + 12) % 12;
      const reg = Math.max(0, Math.min(1, (p - lo) / span));
      // Angle in the wedge by note (a little either side spills over the mirror, as glass does).
      const shake = drum.snare * 0.04 * Math.sin(t * 60 + v * 7);
      const ang = -0.05 + (pc / 12) * (wedge + 0.1) + shake + 0.08 * Math.sin(0.2 * t + v);
      const r = half * (0.1 + 0.82 * reg) + hash(v, 2) * half * 0.06;
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      const size = half * (0.07 + 0.07 * level) * (0.8 + 0.4 * hash(v, 3));
      const col = mod12(Math.round(p));
      // A faceted shard: an irregular polygon with a light-to-deep gradient and a bright edge.
      const sides = 4 + Math.floor(hash(v, 4) * 3);
      const rot = p * 0.7 + v + 0.15 * t;
      c.beginPath();
      for (let i = 0; i < sides; i++) {
        const q = rot + (i / sides) * Math.PI * 2;
        const rr = size * (0.55 + 0.6 * hash(v, i, 5));
        if (i) c.lineTo(x + Math.cos(q) * rr, y + Math.sin(q) * rr);
        else c.moveTo(x + Math.cos(q) * rr, y + Math.sin(q) * rr);
      }
      c.closePath();
      const g = c.createLinearGradient(x - size, y - size, x + size, y + size);
      g.addColorStop(0, jewel(col, 78, 0.95));
      g.addColorStop(0.5, jewel(col, 52, 0.85));
      g.addColorStop(1, jewel(col, 30, 0.8));
      c.fillStyle = g;
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.45)';
      c.lineWidth = Math.max(1, Q / 400);
      c.stroke();
      // A glossy bead beside it, in a neighbouring shade.
      const bx = x + Math.cos(rot * 1.7) * size * 1.1;
      const by = y + Math.sin(rot * 1.7) * size * 1.1;
      const br = size * (0.28 + 0.2 * hash(v, 6));
      const bg = c.createRadialGradient(bx - br * 0.35, by - br * 0.35, br * 0.05, bx, by, br);
      bg.addColorStop(0, 'rgba(255,255,255,0.95)');
      bg.addColorStop(0.3, jewel(col + 1, 62, 0.9));
      bg.addColorStop(1, jewel(col + 1, 28, 0.6));
      c.fillStyle = bg;
      c.beginPath();
      c.arc(bx, by, br, 0, Math.PI * 2);
      c.fill();
    }
    // Hats: sparkles in the glass.
    if (drum.hat > 0.05) {
      c.fillStyle = `rgba(255,255,255,${0.8 * drum.hat})`;
      for (let i = 0; i < 14; i++) {
        const ang = hash(i, 9, Math.floor(t * 8)) * wedge;
        const r = hash(i, 10, Math.floor(t * 8)) * half * 0.9;
        c.fillRect(Math.cos(ang) * r, Math.sin(ang) * r, Q / 260, Q / 260);
      }
    }
    c.globalCompositeOperation = 'source-over';
    return ch.canvas;
  };
  // Mirror the chamber's wedge round the circle.
  const mirror = (fold: number, opacity: number) => {
    if (opacity < 0.01) return;
    const img = paintChamber(fold);
    const wedge = Math.PI / fold;
    const zoom = 1 + 0.04 * drum.kick;
    ctx.globalAlpha = opacity;
    for (let k = 0; k < 2 * fold; k++) {
      ctx.save();
      ctx.translate(cx, cy);
      // Odd wedges are mirror images: turned one wedge further, then flipped back across their edge.
      ctx.rotate(spin + (k % 2 ? k + 1 : k) * wedge);
      if (k % 2) ctx.scale(1, -1);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R * 1.02, -0.002, wedge + 0.002);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img as CanvasImageSource, -R * zoom, -R * zoom, 2 * R * zoom, 2 * R * zoom);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  };

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = '#05030a';
  ctx.fill();
  ctx.save();
  ctx.clip();
  const fNow = foldOf(now.c);
  const fPrev = foldOf(now.prev);
  if (fPrev !== fNow && now.x < 1) {
    mirror(fPrev, 1);
    mirror(fNow, now.x);
  } else mirror(fNow, 1);
  // The kick's flash, and the eyepiece: a vignette and a dark rim.
  if (drum.kick > 0.02) {
    ctx.fillStyle = `rgba(255,255,255,${0.08 * drum.kick})`;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  }
  const vig = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = vig;
  ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  ctx.restore();
  ctx.strokeStyle = alpha(st.ink, 0.85);
  ctx.lineWidth = Math.max(4, 10 * u);
  ctx.beginPath();
  ctx.arc(cx, cy, R + 4 * u, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
