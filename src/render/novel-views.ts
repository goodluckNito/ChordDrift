/**
 * Less usual pictures of the music, each moving with the voices and pushed around by the drums:
 *
 *   Ink marbling  notes drop rings of coloured ink on water; every chord change drags a comb
 *                 through the surface, feathering everything already there; kicks tap the water.
 *   Murmuration   a flock of birds per voice, at a height set by its pitch; close notes merge into
 *                 one flock, glides pull flocks across the sky, drum hits startle them.
 *
 * Pure functions of (score, t) like every other view (marbling caches its work, but replays it
 * exactly when time jumps backwards).
 */
import { drumHits, levelAt, pitchAt } from '../engine/motion';
import type { Score } from '../engine/score';
import { mod12 } from '../engine/theory';
import { alpha, drumPulse, skyRange, type ViewArea, type ViewStyle } from './harmony-views';

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
