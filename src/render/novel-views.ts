/**
 * Four less usual pictures of the music, each moving with the voices and pushed around by the drums:
 *
 *   Transit map   every voice is a metro line; lines bend only at 45° and 90°, chord changes are
 *                 stations named after the chord, voices sharing a note meet at interchanges, and
 *                 the melody is the river. The map scrolls like the timeline.
 *   Ink marbling  notes drop rings of coloured ink on water; every chord change drags a comb
 *                 through the surface, feathering everything already there; kicks tap the water.
 *   Ferrofluid    a glossy blob; every voice is a magnet at its note's angle, pulling a spike
 *                 (longer for higher, louder notes); kicks make it bristle.
 *   Murmuration   a flock of birds per voice, at a height set by its pitch; close notes merge into
 *                 one flock, glides pull flocks across the sky, drum hits startle them.
 *
 * Pure functions of (score, t) like every other view (marbling caches its work, but replays it
 * exactly when time jumps backwards).
 */
import { drumHits, levelAt, melodyAt, pitchAt, soundingPitches } from '../engine/motion';
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
// Transit map
// ---------------------------------------------------------------------------

export function drawTransit(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea) {
  const { u, tu } = a;
  const W = a.width;
  const pad = 26 * u;
  const top = a.top + pad + 30 * tu; // room for station names
  const bottom = a.bottom - pad;
  const { lo, span } = skyRange(score);
  const Y = (p: number) => bottom - ((p - lo) / span) * (bottom - top);
  const pps = W / 15; // pixels per second
  const nowX = W * 0.64;
  const X = (time: number) => nowX + (time - t) * pps;
  const tA = t - nowX / pps - 2;
  const tB = t + (W - nowX) / pps + 2;
  const V = score.config.voices;
  const drum = drumPulse(score, t);
  const gap = 6.5 * u * st.lw; // spacing of parallel lines sharing a note
  const lineW = 4.2 * u * st.lw * (1 + 0.25 * drum.kick);
  const chords = score.chords;
  if (!chords.length) return;
  let k0 = 0;
  while (k0 + 1 < chords.length && chords[k0 + 1].t < tA) k0++;
  let k1 = k0;
  while (k1 + 1 < chords.length && chords[k1].t < tB) k1++;

  // Where each line runs after chord k: its note's height, offset beside the other lines on that note.
  const ys = new Map<number, number[]>();
  const yAfter = (k: number) => {
    let y = ys.get(k);
    if (y) return y;
    const notes = chords[k].notes;
    const groups = new Map<number, number[]>();
    notes.forEach((n, v) => {
      const key = Math.round(n * 100);
      const g = groups.get(key) ?? [];
      g.push(v);
      groups.set(key, g);
    });
    y = new Array<number>(V);
    for (const g of groups.values()) g.forEach((v, i) => (y![v] = Y(notes[v]) + (i - (g.length - 1) / 2) * gap));
    ys.set(k, y);
    return y;
  };

  ctx.save();
  // The river: the melody, wide and soft behind everything.
  if (score.melody.length) {
    ctx.strokeStyle = alpha(st.accent, 0.3);
    ctx.lineWidth = 18 * u;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    for (let time = tA; time <= Math.min(t, tB); time += 0.05) {
      const m = melodyAt(score, time);
      if (!m || m.g < 0.05) {
        pen = false;
        continue;
      }
      const x = X(time);
      const y = Y(m.p);
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      pen = true;
    }
    ctx.stroke();
  }

  // Each line: holds run flat, changes cut across at 45°, corners rounded like a printed map.
  const corner = 9 * u;
  const route = (v: number): { x: number; y: number }[] => {
    const pts: { x: number; y: number }[] = [];
    for (let k = k0; k <= k1; k++) {
      const yk = yAfter(k)[v];
      if (k === k0) pts.push({ x: X(chords[k].t) - 2 * pps, y: yk });
      const next = chords[k + 1];
      if (!next) {
        pts.push({ x: X(Math.max(tB, chords[k].t + 1)), y: yk });
        break;
      }
      const yn = yAfter(k + 1)[v];
      if (Math.abs(yn - yk) < 0.5) continue;
      const mid = X((next.t + next.settled) / 2);
      // Room for the diagonal: half of each neighbouring hold at most.
      const before = (next.t - chords[k].settled) * pps;
      const after = ((chords[k + 2]?.t ?? next.t + 4) - next.settled) * pps;
      const half = Math.min(Math.abs(yn - yk) / 2, 0.45 * Math.max(4, before), 0.45 * Math.max(4, after));
      pts.push({ x: mid - half, y: yk }, { x: mid + half, y: yn });
    }
    return pts;
  };
  const trace = (pts: { x: number; y: number }[]) => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) ctx.arcTo(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, corner);
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  };
  const routes = Array.from({ length: V }, (_, v) => route(v));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Built (the past) solid with a casing, so crossings show a gap; planned (the future) dashed and faint.
  for (const [clipA, clipB, built] of [
    [0, nowX, true],
    [nowX, W, false],
  ] as const) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(clipA, 0, clipB - clipA, ctx.canvas.height);
    ctx.clip();
    for (let v = 0; v < V; v++) {
      if (routes[v].length < 2) continue;
      if (built) {
        ctx.strokeStyle = st.background;
        ctx.lineWidth = lineW + 4 * u;
        trace(routes[v]);
        ctx.stroke();
      }
      ctx.strokeStyle = built ? st.voiceColor(v) : alpha(st.voiceColor(v), 0.28);
      ctx.lineWidth = built ? lineW : lineW * 0.55;
      ctx.setLineDash(built ? [] : [6 * u, 7 * u]);
      trace(routes[v]);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.setLineDash([]);

  // Stations: where lines arrive at a new note, after each change; lines sharing the note make an interchange.
  ctx.font = `600 ${19 * tu}px ${st.font}`;
  ctx.textBaseline = 'middle';
  for (let k = Math.max(1, k0); k <= k1; k++) {
    const c = chords[k];
    const x = X(c.settled) + 12 * u;
    if (x < -40 || x > W + 40) continue;
    const prev = chords[k - 1].notes;
    const y = yAfter(k);
    const groups = new Map<number, number[]>();
    c.notes.forEach((n, v) => {
      const key = Math.round(n * 100);
      const g = groups.get(key) ?? [];
      g.push(v);
      groups.set(key, g);
    });
    const future = x > nowX;
    const ring = (4.6 + 2.5 * (Math.abs(t - c.t) < 0.4 ? drum.snare : 0)) * u * Math.max(0.8, st.lw);
    let topY = Infinity;
    for (const g of groups.values()) {
      if (!g.some((v) => Math.abs(c.notes[v] - prev[v]) > 0.01) && !c.unison) continue;
      const ya = Math.min(...g.map((v) => y[v]));
      const yb = Math.max(...g.map((v) => y[v]));
      topY = Math.min(topY, ya);
      ctx.fillStyle = st.background;
      ctx.strokeStyle = future ? alpha(st.ink, 0.35) : st.ink;
      ctx.lineWidth = Math.max(1.5, 2.2 * u);
      ctx.beginPath();
      if (g.length === 1) ctx.arc(x, ya, ring, 0, Math.PI * 2);
      else ctx.roundRect(x - ring, ya - ring, ring * 2, yb - ya + ring * 2, ring);
      ctx.fill();
      ctx.stroke();
    }
    if (Number.isFinite(topY) && c.name && !c.unison) {
      // The station's name, slanted like a map label.
      ctx.save();
      ctx.translate(x + 4 * u, topY - 12 * u);
      ctx.rotate(-Math.PI / 4.5);
      ctx.fillStyle = alpha(st.text, future ? 0.35 : 0.9);
      ctx.textAlign = 'left';
      ctx.fillText(c.name, 0, 0);
      ctx.restore();
    }
  }

  // Trains: where each line is now.
  const now = soundingPitches(score, t);
  const groupsNow = new Map<number, number[]>();
  now.forEach((p, v) => {
    const key = Math.round(p * 4);
    const g = groupsNow.get(key) ?? [];
    g.push(v);
    groupsNow.set(key, g);
  });
  for (const g of groupsNow.values()) {
    g.forEach((v, i) => {
      const y = Y(now[v]) + (i - (g.length - 1) / 2) * gap;
      const w = (20 + 6 * drum.kick) * u;
      const h = 8 * u * Math.max(0.8, st.lw);
      ctx.fillStyle = st.voiceColor(v);
      ctx.strokeStyle = st.background;
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.roundRect(nowX - w / 2, y - h / 2, w, h, h / 2);
      ctx.fill();
      ctx.stroke();
    });
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Ink marbling
// ---------------------------------------------------------------------------

/**
 * Mathematical marbling (after Jaffer): an ink drop of radius r at C pushes every point outward,
 * P → C + (P − C)·√(1 + r²/|P − C|²), and a comb tine drawn along direction M through B drags
 * points beside it, P → P + z·λ/(d + λ)·M (d = distance from the line). Both keep the area of the
 * ink, so the patterns feather without smearing. Coordinates are in units of the view's radius.
 */
interface MarbleEvent {
  t: number;
  d: number;
  kind: 'drop' | 'tine' | 'tap';
  x: number;
  y: number;
  r: number;
  mx: number;
  my: number;
  z: number;
  color: string;
}
interface Ink {
  xs: number[];
  ys: number[];
  color: string;
}
interface Marble {
  events: MarbleEvent[];
  /** Chords and drum time turned into events so far. */
  chordsDone: number;
  drumsUntil: number;
  inks: Ink[];
  /** Events applied for good (those that finished, in order). */
  applied: number;
  colorKey: string;
}
const marbles = new WeakMap<Score, Marble>();
const LAMBDA = 0.1;
const MAX_INKS = 140;

function applyEvent(ink: Ink, e: MarbleEvent, f: number) {
  const { xs, ys } = ink;
  if (e.kind === 'drop' || e.kind === 'tap') {
    const r2 = e.r * e.r * f;
    for (let i = 0; i < xs.length; i++) {
      const dx = xs[i] - e.x;
      const dy = ys[i] - e.y;
      const d2 = dx * dx + dy * dy + 1e-9;
      const s = Math.sqrt(1 + r2 / d2);
      xs[i] = e.x + dx * s;
      ys[i] = e.y + dy * s;
    }
  } else {
    const z = e.z * f;
    for (let i = 0; i < xs.length; i++) {
      const d = Math.abs((xs[i] - e.x) * -e.my + (ys[i] - e.y) * e.mx);
      const s = (z * LAMBDA) / (d + LAMBDA);
      xs[i] += s * e.mx;
      ys[i] += s * e.my;
    }
  }
}

/** Keep feathered outlines smooth: split edges that have been stretched long (up to a cap). */
function refine(ink: Ink) {
  const { xs, ys } = ink;
  if (xs.length > 1400) return;
  const nx: number[] = [];
  const ny: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const j = (i + 1) % xs.length;
    nx.push(xs[i]);
    ny.push(ys[i]);
    const dx = xs[j] - xs[i];
    const dy = ys[j] - ys[i];
    const n = Math.min(6, Math.floor(Math.hypot(dx, dy) / 0.025));
    for (let k = 1; k <= n; k++) {
      nx.push(xs[i] + (dx * k) / (n + 1));
      ny.push(ys[i] + (dy * k) / (n + 1));
    }
  }
  ink.xs = nx;
  ink.ys = ny;
}

function circleInk(x: number, y: number, r: number, color: string): Ink {
  const n = 72;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(x + Math.cos((i / n) * Math.PI * 2) * r);
    ys.push(y + Math.sin((i / n) * Math.PI * 2) * r);
  }
  return { xs, ys, color };
}

/** Turn chords (and drum hits) up to time `until` into marbling events. */
function buildMarble(m: Marble, score: Score, st: ViewStyle, until: number) {
  const fresh: MarbleEvent[] = [];
  const chords = score.chords;
  while (m.chordsDone < chords.length && chords[m.chordsDone].t <= until) {
    const k = m.chordsDone++;
    const c = chords[k];
    const prev = k > 0 ? chords[k - 1] : null;
    if (!prev || c.unison) {
      // The opening (and every collapse): one big drop of the note in the middle.
      fresh.push({ t: c.t, d: 0.9, kind: 'drop', x: 0, y: 0, r: prev ? 0.26 : 0.3, mx: 0, my: 0, z: 0, color: st.pcColor(mod12(c.notes[0])) });
      continue;
    }
    // New notes drop their ink around the middle: angle by the note (in fifths order), so related
    // notes land near each other; a few at most per chord.
    const had = new Set(prev.notes.map((n) => mod12(Math.round(n))));
    const fresh_pcs = [...new Set(c.notes.map((n) => mod12(Math.round(n))))].filter((pc) => !had.has(pc));
    const pcs = (fresh_pcs.length ? fresh_pcs : [mod12(c.root)]).slice(0, 4);
    pcs.forEach((pc, i) => {
      // Around the whole surface (the note picks the side, the seed scatters it), so the sheet fills evenly.
      const ang = -Math.PI / 2 + (mod12(pc * 7) / 12) * Math.PI * 2 + (hash(k, i, 9) - 0.5) * 2.2;
      const rad = 0.15 + 0.55 * hash(k, i, 3);
      fresh.push({
        t: c.t + i * 0.14,
        d: 0.55,
        kind: 'drop',
        x: Math.cos(ang) * rad,
        y: Math.sin(ang) * rad,
        r: 0.13 + 0.1 * hash(k, i, 5),
        mx: 0,
        my: 0,
        z: 0,
        color: st.pcColor(pc),
      });
    });
    // Then the comb: a tine across the surface, direction by the root, pulled harder the further the voices moved.
    const moved = c.notes.reduce((s, n, v) => s + Math.abs(n - (prev.notes[v] ?? n)), 0) / c.notes.length;
    const ang = (mod12(c.root) / 12) * Math.PI * 2 + (k % 2 ? Math.PI : 0);
    const off = (hash(k, 7) - 0.5) * 0.6;
    const gapT = Math.max(0.5, Math.min(2.5, ((chords[k + 1]?.t ?? c.t + 3) - c.t) * 0.45));
    // A comb of three tines, alternate ones pulling the other way, for the classic feathered stroke.
    for (let j = -1; j <= 1; j++) {
      const o = off + j * 0.42;
      fresh.push({
        t: c.t + 0.45 + (j + 1) * 0.04,
        d: Math.min(1.2, gapT),
        kind: 'tine',
        x: -Math.sin(ang) * o,
        y: Math.cos(ang) * o,
        r: 0,
        mx: Math.cos(ang) * (j === 0 ? -1 : 1),
        my: Math.sin(ang) * (j === 0 ? -1 : 1),
        z: Math.min(0.8, 0.22 + 0.1 * moved),
        color: '',
      });
    }
  }
  // Drum taps: a kick nudges the middle of the water, a snare a spot near it.
  const d0 = m.drumsUntil;
  const d1 = until;
  if (d1 > d0) {
    for (const h of drumHits(score, d0, d1)) {
      if (h.voice !== 'kick' && h.voice !== 'snare') continue;
      const i = Math.round(h.t * 1000);
      const kick = h.voice === 'kick';
      fresh.push({
        t: h.t,
        d: 0.18,
        kind: 'tap',
        x: kick ? (hash(i, 1) - 0.5) * 0.1 : (hash(i, 2) - 0.5) * 1.2,
        y: kick ? (hash(i, 3) - 0.5) * 0.1 : (hash(i, 4) - 0.5) * 1.2,
        r: (kick ? 0.05 : 0.035) * h.vel,
        mx: 0,
        my: 0,
        z: 0,
        color: '',
      });
    }
    m.drumsUntil = d1;
  }
  if (fresh.length) {
    // New events are all later than anything applied; keep the unapplied tail sorted.
    const tail = m.events.splice(m.applied).concat(fresh).sort((x, y) => x.t - y.t);
    m.events.push(...tail);
  }
}

export function drawMarbling(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea) {
  const colorKey = `${st.pcColor(0)}${st.pcColor(7)}${st.background}`;
  let m = marbles.get(score);
  if (!m || m.colorKey !== colorKey) {
    m = { events: [], chordsDone: 0, drumsUntil: -1, inks: [], applied: 0, colorKey };
    marbles.set(score, m);
  }
  buildMarble(m, score, st, t + 2);
  // Time went backwards past finished work: replay from the start (deterministic).
  const last = m.applied > 0 ? m.events[m.applied - 1] : null;
  if (last && t < last.t + last.d) {
    m.inks = [];
    m.applied = 0;
  }
  // Apply, for good, every event that has finished.
  while (m.applied < m.events.length) {
    const e = m.events[m.applied];
    if (e.t + e.d > t) break;
    for (const ink of m.inks) applyEvent(ink, e, 1);
    if (e.kind === 'drop') m.inks.push(circleInk(e.x, e.y, e.r, e.color));
    if (e.kind !== 'tap') for (const ink of m.inks) refine(ink);
    m.applied++;
    // Ink pushed far off the surface is gone.
    if (m.inks.length > MAX_INKS) m.inks.splice(0, m.inks.length - MAX_INKS);
    m.inks = m.inks.filter((ink) => ink.xs.some((x, i) => Math.abs(x) < 2.6 && Math.abs(ink.ys[i]) < 2.6));
  }
  // Events under way: applied in part, to copies.
  const live = m.events.slice(m.applied).filter((e) => e.t <= t);
  let inks = m.inks;
  if (live.length) {
    inks = m.inks.map((ink) => ({ xs: ink.xs.slice(), ys: ink.ys.slice(), color: ink.color }));
    for (const e of live) {
      const f = Math.max(0, Math.min(1, (t - e.t) / e.d));
      const ease = f * f * (3 - 2 * f);
      for (const ink of inks) applyEvent(ink, e, ease);
      if (e.kind === 'drop') inks.push(circleInk(e.x, e.y, e.r * Math.sqrt(ease), e.color));
    }
  }

  const S = a.R * 1.05;
  ctx.save();
  // The tray of water.
  const left = 0;
  const right = a.width;
  ctx.beginPath();
  ctx.rect(left, a.top, right - left, a.bottom - a.top);
  ctx.clip();
  for (const ink of inks) {
    ctx.beginPath();
    for (let i = 0; i < ink.xs.length; i++) {
      const x = a.cx + ink.xs[i] * S;
      const y = a.cy + ink.ys[i] * S;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = alpha(ink.color, 0.92);
    ctx.fill();
    ctx.strokeStyle = alpha(st.ink, 0.12);
    ctx.lineWidth = Math.max(1, 0.8 * a.u);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Ferrofluid
// ---------------------------------------------------------------------------

export function drawFerro(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea) {
  const { cx, cy, u, tu } = a;
  const R = a.R * 0.9;
  const r0 = R * 0.3;
  const drum = drumPulse(score, t);
  const { lo, span } = skyRange(score);
  const pitches = soundingPitches(score, t);
  const magnets = pitches.map((p, v) => ({
    ang: -Math.PI / 2 + (Math.PI * 2 * p) / 12,
    // Higher notes pull harder (longer spikes), louder ones too.
    pull: (0.35 + 0.65 * Math.max(0, Math.min(1, (p - lo) / span))) * levelAt(score, v, t),
  }));
  const N = 720;
  const sigma = 0.075;
  const reach = R - r0;
  const radius = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const th = -Math.PI / 2 + (i / N) * Math.PI * 2;
    let s = 0;
    for (const m of magnets) {
      let d = th - m.ang;
      d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
      const x = d / sigma;
      // A sharp cone with two smaller spikes beside it, like the hedgehog of a real ferrofluid.
      s += m.pull * (1 / (1 + x * x * 1.6)) ** 2;
      s += 0.38 * m.pull * (1 / (1 + (Math.abs(x) - 2.6) ** 2 * 3)) ** 2;
    }
    // Kicks make the whole surface bristle with fine spikes; snares make it shiver.
    const bristle = drum.kick * 0.22 * Math.max(0, Math.cos(th * 36 + t * 0.7)) ** 6;
    const shiver = drum.snare * 0.035 * Math.sin(th * 90 + t * 40);
    const wobble = 0.03 * Math.sin(th * 3 + t * 0.9) + 0.02 * Math.sin(th * 5 - t * 1.3);
    // Spikes saturate (a unison makes one tall spike, not one off the screen).
    const lift = Math.tanh(s * (1 + 0.5 * drum.kick) * 0.55);
    radius[i] = r0 * (1 + wobble + shiver) + reach * (lift + bristle);
  }

  ctx.save();
  // Faint marks for the twelve notes, where the magnets sit.
  ctx.font = `500 ${14 * tu}px ${st.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const now = chordAt(score, t);
  for (let pc = 0; pc < 12; pc++) {
    const ang = -Math.PI / 2 + (Math.PI * 2 * pc) / 12;
    ctx.fillStyle = alpha(st.text, 0.28);
    ctx.fillText(nameOf(score, pc, now.c), cx + Math.cos(ang) * (R + 26 * tu), cy + Math.sin(ang) * (R + 26 * tu));
  }
  // A soft shadow under the blob.
  ctx.fillStyle = alpha(st.ink, 0.08);
  ctx.beginPath();
  ctx.ellipse(cx, cy + r0 * 1.25, r0 * 1.3, r0 * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  // The fluid: glossy, dark (or liquid-metal on dark themes).
  const path = new Path2D();
  for (let i = 0; i < N; i++) {
    const th = -Math.PI / 2 + (i / N) * Math.PI * 2;
    const x = cx + Math.cos(th) * radius[i];
    const y = cy + Math.sin(th) * radius[i];
    if (i) path.lineTo(x, y);
    else path.moveTo(x, y);
  }
  path.closePath();
  const body = ctx.createRadialGradient(cx - r0 * 0.35, cy - r0 * 0.4, r0 * 0.1, cx, cy, R);
  body.addColorStop(0, alpha(st.ink, 0.75));
  body.addColorStop(0.35, st.ink);
  body.addColorStop(1, st.ink);
  ctx.fillStyle = body;
  ctx.fill(path);
  // Gloss: a highlight across the upper left of the body and a rim light along the edge.
  ctx.save();
  ctx.clip(path);
  const shine = ctx.createRadialGradient(cx - r0 * 0.45, cy - r0 * 0.5, 0, cx - r0 * 0.45, cy - r0 * 0.5, r0 * 0.9);
  shine.addColorStop(0, alpha(st.background, 0.55 + 0.2 * drum.hat));
  shine.addColorStop(1, alpha(st.background, 0));
  ctx.fillStyle = shine;
  ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  ctx.restore();
  ctx.strokeStyle = alpha(st.background, 0.25);
  ctx.lineWidth = Math.max(1, 1.2 * u);
  ctx.stroke(path);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Murmuration
// ---------------------------------------------------------------------------

export function drawMurmuration(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea, lite = false) {
  const { u } = a;
  const W = a.width;
  const top = a.top + 30 * u;
  const bottom = a.bottom - 50 * u;
  const { lo, span } = skyRange(score);
  const V = score.config.voices;
  const drum = drumPulse(score, t);
  const BIRDS = lite ? 45 : 100;
  const flockR = Math.min(W, bottom - top) * 0.11;
  // A flock's place in the sky: height by pitch, and across by pitch too, on a period that isn't an
  // octave (so octaves don't stack into columns). Same note, same place: voices on one note fly as one.
  const centre = (p: number, time: number) => ({
    x: W / 2 + W * 0.3 * Math.sin(p * 0.83 + 0.04 * time) + W * 0.08 * Math.sin(p * 2.13 - 0.03 * time),
    y: bottom - ((p - lo) / span) * (bottom - top),
  });
  const startle = Math.min(1, drum.kick * 0.7 + drum.snare);

  ctx.save();
  // The horizon.
  ctx.strokeStyle = alpha(st.text, 0.18);
  ctx.lineWidth = Math.max(1, u);
  ctx.beginPath();
  ctx.moveTo(0, a.bottom - 18 * u);
  ctx.lineTo(W, a.bottom - 18 * u);
  ctx.stroke();
  ctx.lineCap = 'round';
  for (let v = 0; v < V; v++) {
    const level = levelAt(score, v, t);
    if (level < 0.03) continue;
    ctx.strokeStyle = alpha(st.voiceColor(v), 0.45 + 0.5 * level);
    ctx.lineWidth = Math.max(1.2, 2 * u * st.lw);
    ctx.beginPath();
    // The flock's own axis turns slowly; density waves run along it.
    const axis = 0.25 * Math.sin(0.13 * t + v * 1.3) + 0.15 * Math.sin(0.31 * t - v);
    const ca = Math.cos(axis);
    const sa = Math.sin(axis);
    for (let b = 0; b < BIRDS; b++) {
      // A home in the flock, thick in the middle and thinning out to the edges.
      const hx = (hash(v, b, 1) + hash(v, b, 5) + hash(v, b, 6)) / 1.5 - 1;
      const hy = (hash(v, b, 2) + hash(v, b, 7)) - 1;
      // Each bird follows a little behind, so a glide streams the flock out into a ribbon.
      const lag = 0.04 + 0.45 * hash(v, b, 3);
      const p = pitchAt(score, v, t - lag);
      const c = centre(p, t - lag);
      // Density waves: birds bunch and spread along the flock as a wave passes through.
      const wave = 0.22 * Math.sin(hx * 4.5 - t * 1.8 + v);
      const along = (hx + wave) * 2.1;
      const across = hy * 0.55 * (1 - 0.35 * hx * hx) + 0.15 * Math.sin(hx * 3 + t * 1.1 + v);
      // Startled: each bird bolts outward for a moment.
      const bolt = 1 + 1.4 * startle * hash(v, b, 4);
      const x = c.x + (along * ca - across * sa) * flockR * bolt;
      const y = c.y + (along * sa + across * ca) * flockR * 0.6 * bolt;
      // A bird is a short tick, heading roughly along the flock.
      const hd = axis + 0.5 * Math.sin(hy * 5 + t * 2 + b);
      const len = 3.8 * u;
      ctx.moveTo(x - Math.cos(hd) * len, y - Math.sin(hd) * len);
      ctx.lineTo(x + Math.cos(hd) * len, y + Math.sin(hd) * len);
    }
    ctx.stroke();
  }
  ctx.restore();
}
