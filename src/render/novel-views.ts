/**
 * Less usual pictures of the music, each moving with the voices and pushed around by the drums:
 *
 *   Tornado       a tornado filling the frame; each voice a band of debris swirling at its pitch's height.
 *
 * Pure functions of (score, t) like every other view (marbling caches its work, but replays it
 * exactly when time jumps backwards).
 */
import { drumHits, levelAt, pitchAt, soundingPitches, voiceNotesAt } from '../engine/motion';
import type { Score } from '../engine/score';
import { mod12 } from '../engine/theory';
import { SILHOUETTES } from './silhouettes';
import { alpha, chordAt, drumPulse, nameOf, skyRange, type ViewArea, type ViewStyle } from './harmony-views';

/** A colour (#rrggbb, rgb() or hsl()) with its saturation scaled by s (0 = grey, 1 = as given). */
function saturate(color: string, s: number): string {
  let r = 128;
  let g = 128;
  let b = 128;
  let m: RegExpMatchArray | null;
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const n = parseInt(color.slice(1), 16);
    (r = (n >> 16) & 255), (g = (n >> 8) & 255), (b = n & 255);
  } else if ((m = color.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/))) {
    (r = +m[1]), (g = +m[2]), (b = +m[3]);
  } else if ((m = color.match(/hsla?\(\s*([\d.]+)(?:deg)?[ ,]+([\d.]+)%[ ,]+([\d.]+)%/))) {
    const h = +m[1];
    const sl = +m[2] / 100;
    const l = +m[3] / 100;
    const f = (k: number) => {
      const q = (k + h / 30) % 12;
      return 255 * (l - sl * Math.min(l, 1 - l) * Math.max(-1, Math.min(q - 3, 9 - q, 1)));
    };
    (r = f(0)), (g = f(8)), (b = f(4));
  } else return color;
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  const k = Math.max(0, Math.min(1, s));
  const c = (x: number) => Math.round(grey + (x - grey) * k);
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

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
// Tornado
// ---------------------------------------------------------------------------

/**
 * A tornado filling the frame: a rotating storm cloud across the top, the funnel dropping from it
 * to the ground, a skirt of debris where it touches down. The funnel always keeps a tornado's shape
 * (a rope at the ground flaring into the cloud); debris spirals slowly up it. Each voice is a band
 * of brighter, denser debris at its pitch's height, much of it the note's own letter tumbling round,
 * coloured like the note. A new note is drawn up out of the ground; the note it replaced is pulled
 * up into the cloud as it fades (see the bands below). The funnel bends and its foot wanders; kicks widen it and turn it
 * faster, snares light the cloud and fling debris out, hats make it sparkle.
 */
export function drawTornado(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea, lite = false) {
  const { cx, u } = a;
  const W = a.width;
  const Hf = a.height ?? a.bottom + a.top;
  // Drum pulses with a softened attack (averaged over the last ~0.15 s), so hits ease in instead of jerking.
  const drum = { kick: 0, snare: 0, hat: drumPulse(score, t).hat };
  for (let k = 0; k < 6; k++) {
    const p = drumPulse(score, t - k * 0.03);
    drum.kick += p.kick / 6;
    drum.snare += p.snare / 6;
  }
  // Each kick gives the swirl an extra turn, eased over a third of a second. (Added to the angle,
  // never multiplied into the spin speed: speed × time jumps whenever the speed changes.)
  let turn = 0;
  if (score.drums) for (const h of drumHits(score, 0, t)) if (h.voice === 'kick') turn += 1.3 * h.vel * (1 - Math.exp(-(t - h.t) / 0.35));
  const { lo, span } = skyRange(score);
  const V = score.config.voices;
  const cloudY = Hf * 0.14; // the cloud base, where the funnel spreads into the storm
  const ground = Hf * 0.83;
  const halfW = Math.min(W * 0.5, Hf * 0.42);
  const yOf = (f: number) => ground - f * (ground - cloudY);
  const heightOf = (p: number) => Math.max(0.04, Math.min(0.94, 0.06 + 0.88 * ((p - lo) / span)));
  // With release-&-swell changes the voices don't glide (each chord swells in on its own layer), so
  // a voice's note changes are read from the chords instead of its moves.
  const swellMode = score.config.motion.transition === 'swell';
  const kNow = chordAt(score, t).k;
  type Change = { t0: number; p0: number; p1: number };
  /**
   * A voice's note changes around t: the latest (and how many came before it, i), and the next.
   * Gliding, those are its moves; with release-&-swell changes, the chords where its note differs.
   */
  const changesOf = (v: number): { last: Change | null; i: number; next: Change | null } => {
    const ms = score.moves[v];
    let l = 0;
    let h = ms.length - 1;
    let idx = -1;
    while (l <= h) {
      const mid = (l + h) >> 1;
      if (ms[mid].t0 <= t) (idx = mid), (l = mid + 1);
      else h = mid - 1;
    }
    if (!swellMode || kNow < 1) return { last: idx >= 0 ? ms[idx] : null, i: idx, next: ms[idx + 1] ?? (swellMode ? chordChange(1, v) : null) };
    let i = ms.length - 1;
    let last: Change | null = ms[i] ?? null;
    const ch = score.chords;
    for (let j = 1; j < ch.length; j++) {
      if (Math.round(ch[j].notes[v]) === Math.round(ch[j - 1].notes[v])) continue;
      const c = { t0: ch[j].t, p0: ch[j - 1].notes[v], p1: ch[j].notes[v] };
      if (j > kNow) return { last, i, next: c };
      i++;
      last = c;
    }
    return { last, i, next: null };
  };
  const chordChange = (j: number, v: number): Change | null => {
    const ch = score.chords;
    for (; j < ch.length; j++) if (Math.round(ch[j].notes[v]) !== Math.round(ch[j - 1].notes[v])) return { t0: ch[j].t, p0: ch[j - 1].notes[v], p1: ch[j].notes[v] };
    return null;
  };
  const now = chordAt(score, t);
  const RISE = 1.4; // s for a new note to be swirled up from the ground to its height
  const LEAVE = 2.6; // s for the note it left to be ejected up into the sky
  const LEAD = 1.6; // s before a note change that the next note starts forming in the dust at the foot
  interface Band {
    f: number;
    amp: number;
    alpha: number;
    name: string;
    color: string;
    /** 0 = down in the dust skirt at the foot, 1 = up on the funnel at its height. */
    rise: number;
    /** How far out it's being flung (ejected notes spread out as they leave). */
    fling: number;
  }
  /**
   * Each voice is a band of debris at its note's height. A moment before the voice changes note,
   * the dust at the foot starts turning into the next note; when it changes, that note is swirled
   * up into the funnel to its height, and the note it left is ejected up and out into the sky.
   * Notes are in full colour while they sound and greyed while waiting, ringing off or leaving.
   */
  const bands = Array.from({ length: V }, (_, v) => {
    const { last: m, i, next: n } = changesOf(v);
    const level = levelAt(score, v, t);
    const amp = level * (v === 0 ? 0.3 : 0.55);
    const target = m ? m.p1 : swellMode ? soundingPitches(score, t)[v] : pitchAt(score, v, t);
    const age = m ? t - m.t0 : Infinity;
    const x = Math.min(1, age / RISE);
    const rise = 1 - (1 - x) ** 3;
    const cur: Band = {
      f: 0.01 + (heightOf(target) - 0.01) * rise * rise,
      amp,
      // Fainter and greyer as it rings off; full colour while it sounds.
      alpha: 0.45 + 0.55 * level,
      name: nameOf(score, mod12(Math.round(target)), now.c),
      color: saturate(st.noteColor(target, v), 0.15 + 0.85 * level),
      rise,
      fling: 1,
    };
    let gone: Band | null = null;
    if (m && age < LEAVE) {
      // The whole band it was rides on up the funnel and is flung out into the sky, greying as it goes.
      const y = age / LEAVE;
      const f0 = heightOf(m.p0);
      gone = {
        f: f0 + (1.25 - f0) * Math.pow(y, 1.4),
        amp: Math.max(amp, 0.25),
        alpha: (1 - y) ** 1.2,
        name: nameOf(score, mod12(Math.round(m.p0)), now.c),
        color: saturate(st.noteColor(m.p0, v), 0.85 * (1 - y) + 0.12 * y),
        rise: 1,
        fling: 1 + 1.8 * y * y,
      };
    }
    let next: Band | null = null;
    if (n && n.t0 - t < LEAD) {
      const w = 1 - (n.t0 - t) / LEAD;
      next = {
        f: 0.012,
        amp: 0.3,
        alpha: w * w * (3 - 2 * w),
        name: nameOf(score, mod12(Math.round(n.p1)), now.c),
        color: saturate(st.noteColor(n.p1, v), 0.15),
        rise: 0,
        fling: 1,
      };
    }
    return { cur, gone, next, i, v };
  });
  const bulges = bands.map((b) => ({ f: b.cur.f, amp: b.cur.amp, v: b.v }));
  const W0 = 0.05;
  /** The funnel's radius at height f: a rope at the ground flaring into the cloud; voices ripple it slightly. */
  const radiusAt = (f: number) => {
    let swell = 0;
    for (const b of bulges) swell += b.amp * Math.exp(-(((f - b.f) / W0) ** 2));
    const ff = Math.max(0, Math.min(1, f));
    const flare = Math.max(0, (ff - 0.82) / 0.18) ** 2;
    const base = halfW * (0.035 + 0.5 * Math.pow(ff, 1.8) + 0.45 * flare);
    return base * (1 + 0.07 * drum.kick) * (1 + 0.08 * Math.tanh(swell));
  };
  const tintAt = (f: number) => {
    let bw = 0;
    for (const b of bulges) bw = Math.max(bw, b.amp * Math.exp(-(((f - b.f) / (W0 * 1.4)) ** 2)));
    return Math.min(1, bw * 1.6);
  };
  // The foot wanders along the ground; the body bends and sways, more toward the bottom (the rope).
  const footX = cx + W * 0.07 * Math.sin(t * 0.11) + W * 0.03 * Math.sin(t * 0.29 + 1);
  const axis = (f: number) => {
    const sway = (0.6 * Math.sin(f * 3.2 + t * 0.6) + 0.3 * Math.sin(f * 7 - t * 1.1)) * (1 - 0.6 * f);
    return footX + (cx - footX) * Math.pow(f, 0.7) + W * 0.05 * sway;
  };
  /** The funnel's resting shape (radius / halfW at height f), for spin speeds: no drums, no voices. */
  const restFrac = (f: number) => {
    const ff = Math.max(0, Math.min(1, f));
    return 0.035 + 0.5 * Math.pow(ff, 1.8) + 0.45 * Math.max(0, (ff - 0.82) / 0.18) ** 2;
  };
  // Spin: faster where the funnel is thin. Debris rising at a steady rate through it has turned by
  // the integral of the spin over the heights it has passed (a table of that integral, G).
  const GN = 128;
  const G = new Float32Array(GN + 1);
  for (let i = 1; i <= GN; i++) G[i] = G[i - 1] + 0.42 / Math.max(0.06, restFrac((i - 0.5) / GN)) / GN;
  const Gat = (f: number) => {
    const x = Math.max(0, Math.min(1, f)) * GN;
    const i = Math.min(GN - 1, Math.floor(x));
    return G[i] + (G[i + 1] - G[i]) * (x - i);
  };
  const flash = drum.snare;

  ctx.save();
  // The sky darkens up into the storm; the ground is a faint plain with a horizon.
  const sky = ctx.createLinearGradient(0, 0, 0, cloudY + Hf * 0.2);
  sky.addColorStop(0, alpha(st.ink, 0.24 + 0.12 * flash));
  sky.addColorStop(0.35, alpha(st.ink, 0.14 + 0.08 * flash));
  sky.addColorStop(0.6, alpha(st.ink, 0.04 + 0.04 * flash));
  sky.addColorStop(1, alpha(st.ink, 0));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, cloudY + Hf * 0.2);
  const land = ctx.createLinearGradient(0, ground, 0, Hf);
  land.addColorStop(0, alpha(st.ink, 0.07));
  land.addColorStop(1, alpha(st.ink, 0.02));
  ctx.fillStyle = land;
  ctx.fillRect(0, ground, W, Hf - ground);
  ctx.strokeStyle = alpha(st.ink, 0.18);
  ctx.lineWidth = Math.max(1, u);
  ctx.beginPath();
  ctx.moveTo(0, ground);
  ctx.lineTo(W, ground);
  ctx.stroke();

  // Far off: low hills along the horizon, and grey rain curtains hanging from the storm's edges.
  ctx.fillStyle = alpha(st.ink, 0.07);
  ctx.beginPath();
  ctx.moveTo(0, ground);
  for (let i = 0; i <= 48; i++) {
    const x = (i / 48) * W;
    const h = Hf * (0.012 + 0.02 * hash(i, 51) + 0.012 * Math.sin(i * 0.7));
    ctx.lineTo(x, ground - h);
  }
  ctx.lineTo(W, ground);
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < 7; i++) {
    const side = i % 2 ? 1 : -1;
    const x0 = cx + side * W * (0.28 + 0.2 * hash(i, 52));
    const w = W * (0.05 + 0.08 * hash(i, 53));
    const lean = W * 0.04 * Math.sin(t * 0.1 + i);
    // Soft at the sides (a horizontal gradient), fading out toward the ground in slices.
    const g = ctx.createLinearGradient(x0 - w / 2, 0, x0 + w / 2, 0);
    g.addColorStop(0, alpha(st.ink, 0));
    g.addColorStop(0.5, alpha(st.ink, 0.07));
    g.addColorStop(1, alpha(st.ink, 0));
    ctx.fillStyle = g;
    const y0 = cloudY - Hf * 0.04;
    const slices = 8;
    for (let k = 0; k < slices; k++) {
      const a0 = k / slices;
      const a1 = (k + 1) / slices;
      ctx.globalAlpha = 1 - (a0 + a1) / 2;
      ctx.beginPath();
      ctx.moveTo(x0 - w / 2 + lean * a0, y0 + (ground - y0) * a0);
      ctx.lineTo(x0 + w / 2 + lean * a0, y0 + (ground - y0) * a0);
      ctx.lineTo(x0 + w / 2 + lean * a1, y0 + (ground - y0) * a1);
      ctx.lineTo(x0 - w / 2 + lean * a1, y0 + (ground - y0) * a1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // The storm cloud: a ragged base of small billows wheeling round above the funnel (seen from
  // below, so the near side of the wheel hangs lower), thickest where the funnel joins it; a snare
  // lights it up like lightning inside.
  const deck = lite ? 60 : 150;
  const billow = (front: boolean) => {
    for (let i = 0; i < deck; i++) {
      const phi = hash(i, 21) * Math.PI * 2 + t * (0.05 + 0.04 * hash(i, 22));
      const depth = Math.sin(phi);
      if (depth >= 0 !== front) continue;
      const rr = W * (0.05 + 0.7 * hash(i, 23) ** 1.3);
      const x = cx + Math.cos(phi) * rr;
      const near = 1 - rr / (W * 0.75); // billows near the funnel hang lowest
      const y = cloudY - Hf * (0.005 + 0.07 * hash(i, 24)) + depth * Hf * 0.03 + near * Hf * 0.03;
      const r = Math.max(W, Hf * 0.6) * (0.025 + 0.045 * hash(i, 25));
      const g = ctx.createRadialGradient(x, y - r * 0.25, r * 0.1, x, y, r);
      const k = (front ? 0.16 : 0.1) + 0.12 * flash * hash(i, 26);
      g.addColorStop(0, alpha(st.ink, k * 1.25));
      g.addColorStop(0.5, alpha(st.ink, k * 0.6));
      g.addColorStop(1, alpha(st.ink, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  };
  billow(false);

  // The funnel's body: a translucent silhouette, with condensation striations wrapping round its
  // front as it turns, so the rotation reads even where there's little debris.
  const steps = 70;
  const body = new Path2D();
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    if (i) body.lineTo(axis(f) - radiusAt(f), yOf(f));
    else body.moveTo(axis(f) - radiusAt(f), yOf(f));
  }
  for (let i = steps; i >= 0; i--) body.lineTo(axis(i / steps) + radiusAt(i / steps), yOf(i / steps));
  body.closePath();
  const fill = ctx.createLinearGradient(0, cloudY, 0, ground);
  fill.addColorStop(0, alpha(st.ink, 0));
  fill.addColorStop(0.12, alpha(st.ink, 0.1));
  fill.addColorStop(0.7, alpha(st.ink, 0.1));
  fill.addColorStop(1, alpha(st.ink, 0.05));
  ctx.fillStyle = fill;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  ctx.lineWidth = Math.max(1, 1.1 * u);
  const strands = lite ? 10 : 18;
  for (let k = 0; k < strands; k++) {
    const th0 = (k / strands) * Math.PI * 2;
    ctx.strokeStyle = alpha(st.ink, 0.05 + 0.05 * hash(k, 31));
    ctx.beginPath();
    let on = false;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const th = th0 + f * 4.5 - t * 0.9 - turn * 0.5;
      if (Math.sin(th) < 0) {
        on = false;
        continue;
      }
      const x = axis(f) + Math.cos(th) * radiusAt(f);
      if (on) ctx.lineTo(x, yOf(f));
      else ctx.moveTo(x, yOf(f));
      on = true;
    }
    ctx.stroke();
  }
  ctx.restore();

  // Debris: back half, then the front. Dust fills the funnel; in each voice's band the debris is
  // the note itself, letters of its name swirling round, coloured like the note.
  const N = lite ? 1200 : 2700;
  const letterPx = 14 * a.tu;
  // The skirt where it touches down: dust thrown out round the foot, low and wide.
  const skirt = lite ? 160 : 420;
  const draw = (front: boolean) => {
    ctx.font = `700 ${letterPx}px ${st.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let b = 0; b < skirt; b++) {
      const life = (hash(b, 41) + t * (0.15 + 0.1 * hash(b, 42))) % 1;
      const rr0 = halfW * (0.05 + 0.32 * (0.5 + 0.5 * hash(b, 43)));
      const rr = rr0 * Math.sqrt(life) * (1 + 0.25 * drum.kick) + halfW * 0.05 * (1 - Math.sqrt(life));
      const th = hash(b, 44) * Math.PI * 2 + (t * 1.4) / (0.4 + (rr0 / halfW) * 3) + turn;
      const depth = Math.sin(th);
      if (depth >= 0 !== front) continue;
      const x = footX + Math.cos(th) * rr;
      const y = ground - Hf * 0.07 * Math.sin(Math.PI * life) * hash(b, 45) + depth * rr * 0.18;
      const size = (front ? 1.8 : 1.2) * u * (0.6 + 0.8 * hash(b, 46));
      ctx.fillStyle = st.ink;
      ctx.globalAlpha = (0.1 + 0.3 * (0.55 + 0.45 * depth)) * (1 - life);
      ctx.fillRect(x - size, y - size * 0.6, size * 2, size * 1.2);
    }
    for (let b = 0; b < N; b++) {
      // Half the debris spreads evenly up the funnel, rising slowly as it spins; the other half
      // gathers round the voices' heights.
      let f: number;
      let B: Band | null = null;
      let th: number;
      let rr: number;
      const inner = 0.55 + 0.5 * Math.sqrt(hash(b, 3)); // where across the funnel it rides
      if (b % 3 === 0) {
        const rate = 0.025 + 0.02 * hash(b, 2);
        const pos = hash(b, 1) + t * rate;
        f = pos % 1;
        // Turned by the spin at every height it has risen through (whole trips, plus this one).
        th = hash(b, 5) * Math.PI * 2 + (Math.floor(pos) * G[GN] + Gat(f) - Gat(hash(b, 1))) / rate / inner + turn;
        rr = radiusAt(f) * inner * (1 + 0.25 * drum.snare * hash(b, 4));
      } else {
        const vb = bands[Math.floor(hash(b, 8) * bands.length)];
        // A voice's debris: about a third goes with the note it's leaving, a third gathers as the
        // next note in the dust at the foot, the rest is the note sounding now.
        // Each voice's debris is three groups taking turns: the note sounding now, the one it left
        // (riding up and out), and the next one gathering at the foot. At each change the groups
        // rotate, so every particle carries on from where it was: nothing vanishes or jumps.
        const pool = Math.floor(hash(b, 13) * 3);
        const turnOf = (k: number) => ((k % 3) + 3) % 3;
        if (pool === turnOf(vb.i)) B = vb.cur;
        else if (vb.gone && pool === turnOf(vb.i - 1)) B = vb.gone;
        else if (vb.next && pool === turnOf(vb.i + 1)) B = vb.next;
        else continue;
        const g = (hash(b, 1) + hash(b, 9) + hash(b, 10)) / 1.5 - 1;
        const leaving = B === vb.gone;
        f = Math.max(0.005, Math.min(leaving ? 1.3 : 0.99, B.f + g * W0 * (1.4 + (leaving ? 1.8 * (B.fling - 1) : 0)) * (0.3 + 0.7 * B.rise) + 0.012 * Math.sin(t * 2 + b) * B.rise));
        // Down in the skirt it circles the foot; swirling up, it closes in onto the funnel.
        const skirtR = halfW * (0.07 + 0.25 * Math.sqrt(hash(b, 3)));
        const onFunnel = radiusAt(f) * inner * (1 + 0.25 * drum.snare * hash(b, 4)) * B.fling;
        // (It closes in faster than it climbs, so it spirals in onto the funnel instead of floating wide.)
        const closeIn = 1 - (1 - Math.min(1, B.rise * 2.2)) ** 2;
        rr = skirtR + (onFunnel - skirtR) * closeIn;
        th = hash(b, 5) * Math.PI * 2 + (t * 0.42) / (0.2 * inner) + turn;
      }
      const band = B ? 1 : -1;
      const depth = Math.sin(th);
      if (depth >= 0 !== front) continue;
      const x = axis(f) + Math.cos(th) * rr;
      const y = yOf(f) - (B ? (1 - B.rise) * Hf * 0.012 * (0.5 + 0.5 * Math.sin(t * 3 + b)) : 0);
      const sparkle = Math.max(0, Math.cos(th * 3 + b)) ** 8 + drum.hat * hash(b, Math.floor(t * 10));
      const near = 0.55 + 0.45 * depth; // the near side larger and brighter, the far side dim
      if (B && hash(b, 12) < 0.5) {
        ctx.fillStyle = B.color;
        ctx.globalAlpha = Math.min(1, 0.3 + 0.6 * near + 0.4 * sparkle) * B.alpha;
        const sc = 0.65 + 0.5 * near;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(sc * Math.max(0.3, Math.abs(Math.cos(th))), sc); // letters turn edge-on as they swing round
        ctx.fillText(B.name, 0, 0);
        ctx.restore();
      } else {
        const tint = band >= 0 ? 1 : tintAt(f);
        const size = (front ? 2 : 1.4) * u * (0.6 + 0.6 * hash(b, 6)) * (0.8 + 0.5 * tint);
        ctx.fillStyle = B ? B.color : st.ink;
        ctx.globalAlpha = Math.min(1, (0.12 + 0.45 * near) * (B ? 1 : 0.8) + 0.6 * sparkle) * (B ? B.alpha : 1);
        ctx.fillRect(x - size, y - size * 0.6, size * 2, size * 1.2);
      }
    }
    ctx.globalAlpha = 1;
  };
  draw(false);
  draw(true);
  billow(true); // the near side of the cloud hangs in front of the funnel's top
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
    } else for (const nt of voiceNotesAt(score, v, t)) light(cellOf(nt.p), level * nt.g);
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

/** The rooms behind lit windows, each with its own light. */
const ROOMS = ['bedroom', 'bathroom', 'office', 'living', 'kitchen'] as const;
type Room = (typeof ROOMS)[number];
/** How each room's light differs from the theme's lights colour: [brightness, extra blue]. */
const ROOM_LIGHT: Record<Room, [number, number]> = { bedroom: [0.72, 0], bathroom: [1, 0.35], office: [0.9, 0.2], living: [0.85, 0], kitchen: [1.05, 0.05] };

const silPaths = new Map<string, Path2D>();
const silPath = (n: string) => {
  let p = silPaths.get(n);
  if (!p) silPaths.set(n, (p = new Path2D(SILHOUETTES[n].d)));
  return p;
};
/** Where a silhouette was put: its icon grid's origin and scale, and its outline in the window. */
interface Placed {
  ox: number;
  oy: number;
  k: number;
  left: number;
  top: number;
  right: number;
}
/** Lit bands of lamp silhouettes (icon units, y0..y1): the shade glows, the stand stays dark. */
const LIT: Record<string, [number, number]> = { lamp: [2, 13], 'floor-lamp': [2, 9], 'floor-lamp-torchiere': [2, 8], lamps: [2, 12], 'ceiling-light': [11, 20] };
/** Screens (icon units x0, y0, x1, y1): a flickering glow behind the icon shows through its screen. */
const SCREEN: Record<string, [number, number, number, number]> = {
  television: [3, 5, 21, 16],
  'television-classic': [4, 9, 17, 19],
  monitor: [3, 4, 21, 15],
  'desktop-classic': [4, 4, 18, 12],
};

/**
 * A room seen through a lit window: two or three pieces of furniture standing on the floor (a few
 * have their own light: lamp shades glow, screens flicker), now and then a pet, and in some rooms
 * someone wandering about. Which pieces, and where, is the window's own habit (from its seed).
 */
function drawRoom(c: CanvasRenderingContext2D, room: Room, x: number, y: number, w: number, h: number, t: number, seed: number) {
  const ink = 'rgba(34,16,8,0.86)';
  const FLOOR = 0.97;
  const S = 1.2; // furniture scale: big enough to read in a small window
  const r = (i: number) => hash(seed, i, 77);
  const pick = <T,>(i: number, xs: readonly T[]) => xs[Math.floor(r(i) * xs.length)];
  const flip = seed % 2 === 1; // mirror half the rooms so neighbours differ
  c.save();
  if (flip) {
    c.translate(x * 2 + w, 0);
    c.scale(-1, 1);
  }
  /** Stand silhouette n centred at cx (fraction of the width), its bottom at `bottom`, `height` tall (fractions of the height). */
  const place = (n: string, cx: number, bottom: number, height: number, fill = ink, glow?: string): Placed => {
    const s = SILHOUETTES[n];
    const [x0, y0, x1, y1] = s.box;
    const k = (height * S * h) / (y1 - y0);
    const pw = (x1 - x0) * k;
    const left = x + cx * w - pw / 2;
    const top = y + bottom * h - (y1 - y0) * k;
    const P = { ox: left - x0 * k, oy: top - y0 * k, k, left, top, right: left + pw };
    c.save();
    c.translate(P.ox, P.oy);
    c.scale(k, k);
    const scr = SCREEN[n];
    if (scr && glow) {
      c.fillStyle = glow;
      c.fillRect(scr[0], scr[1], scr[2] - scr[0], scr[3] - scr[1]);
    }
    c.fillStyle = fill;
    c.fill(silPath(n));
    const band = LIT[n];
    if (band) {
      c.beginPath();
      c.rect(-1, band[0], 26, band[1] - band[0]);
      c.clip();
      c.fillStyle = 'rgba(255,238,196,0.95)';
      c.fill(silPath(n));
    }
    c.restore();
    return P;
  };
  const screenGlow = (rate: number) => `rgba(140,185,255,${(0.65 + 0.35 * Math.abs(Math.sin(t * rate + seed * 1.7))).toFixed(3)})`;
  /** A plain block (nightstand, TV cabinet) standing on the floor; returns its top (fraction). */
  const block = (cx: number, bw: number, bh: number) => {
    c.fillStyle = ink;
    c.fillRect(x + (cx - bw / 2) * w, y + (FLOOR - bh * S) * h, bw * w, bh * S * h + h * 0.03);
    return FLOOR - bh * S;
  };
  let walker = r(1) < 0.3;
  switch (room) {
    case 'bedroom': {
      place(pick(2, ['bed', 'bed-double', 'bed', 'bed-king']), 0.36, FLOOR, 0.3);
      if (r(3) < 0.2) place('teddy-bear', 0.2, FLOOR - 0.17 * S, 0.12);
      const side = pick(4, ['nightstand', 'dresser', 'wardrobe', 'floor-lamp'] as const);
      if (side === 'nightstand') place('lamp', 0.86, block(0.86, 0.18, 0.16), 0.2);
      else if (side === 'dresser') {
        place('dresser', 0.84, FLOOR, 0.3);
        if (r(5) < 0.5) place('lamp', 0.84, FLOOR - 0.29 * S, 0.16);
      } else if (side === 'wardrobe') place('wardrobe', 0.85, FLOOR, 0.6);
      else place('floor-lamp', 0.87, FLOOR, 0.62);
      break;
    }
    case 'bathroom': {
      if (r(2) < 0.6) place('bathtub', 0.36, FLOOR, 0.38);
      else place('shower', 0.3, FLOOR, 0.62);
      place(r(3) < 0.7 ? 'toilet' : 'washing-machine', 0.8, FLOOR, r(3) < 0.7 ? 0.3 : 0.36);
      if (r(4) < 0.6) place('mirror', 0.8, 0.44, 0.3, 'rgba(220,240,255,0.55)');
      walker = false;
      break;
    }
    case 'office': {
      const deskTop = FLOOR - 0.28 * S;
      place('desk', 0.38, FLOOR, 0.28);
      place(pick(2, ['monitor', 'desktop-classic']), 0.3, deskTop + 0.01, 0.2, ink, screenGlow(3.1));
      if (r(3) < 0.4) place('desk-lamp', 0.6, deskTop + 0.01, 0.18);
      if (r(4) < 0.55) place('chair-rolling', 0.72, FLOOR, 0.34);
      else place('bookshelf', 0.84, FLOOR, 0.5);
      break;
    }
    case 'living': {
      if (r(2) < 0.65) place('sofa', 0.32, FLOOR, 0.3);
      else place('sofa-single', 0.25, FLOOR, 0.3);
      const side = pick(3, ['tv', 'tv', 'floor-lamp', 'piano', 'fireplace', 'tree'] as const);
      if (side === 'tv') place(pick(4, ['television', 'television-classic']), 0.82, block(0.82, 0.28, 0.13), 0.24, ink, screenGlow(2.3));
      else if (side === 'floor-lamp') place(pick(4, ['floor-lamp', 'floor-lamp-torchiere']), 0.86, FLOOR, 0.62);
      else if (side === 'piano') place('piano', 0.8, FLOOR, 0.42);
      else if (side === 'fireplace') place('fireplace', 0.8, FLOOR, 0.42);
      else place('tree', 0.84, FLOOR, 0.42);
      if (r(5) < 0.4) {
        // A pet, pottering about a little.
        const cat = r(6) < 0.6;
        place(cat ? 'cat' : 'dog-side', 0.56 + 0.06 * Math.sin(t * 0.3 + seed), FLOOR, cat ? 0.16 : 0.2);
      } else if (r(5) < 0.55) place('guitar-acoustic', 0.62, FLOOR, 0.3);
      else if (r(5) < 0.7) place(pick(7, ['cactus', 'fishbowl']), 0.6, FLOOR, 0.18);
      break;
    }
    default: {
      // kitchen
      place('fridge', 0.84, FLOOR, 0.62);
      const left = pick(2, ['stove', 'countertop', 'table-chair'] as const);
      if (left === 'stove') {
        place('stove', 0.32, FLOOR, 0.36);
        if (r(3) < 0.6) place('pot-steam', 0.28, FLOOR - 0.35 * S, 0.14);
      } else if (left === 'countertop') {
        place('countertop', 0.32, FLOOR, 0.36);
        if (r(3) < 0.6) place('coffee-maker', 0.24, FLOOR - 0.33 * S, 0.16);
      } else place('table-chair', 0.32, FLOOR, 0.36);
      if (r(4) < 0.6) {
        c.fillStyle = ink;
        c.fillRect(x + 0.45 * w - 0.5, y, Math.max(1, w * 0.012), h * 0.1);
        place('ceiling-light', 0.45, 0.24, 0.14);
      }
    }
  }
  if (walker) {
    // Someone wandering about the room.
    const cx = 0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.12 + seed * 2.1));
    place(pick(8, ['human-male', 'human-female', 'human-handsdown', 'human-greeting', 'human-male', 'human-female']), cx, FLOOR, 0.58);
  }
  c.restore();
}

/** A room's light: the theme's lights colour, a little brighter, dimmer or bluer by room. */
function roomLight(lights: string, room: Room, b: number): string {
  const n = /^#[0-9a-f]{6}$/i.test(lights) ? parseInt(lights.slice(1), 16) : 0xffbe60;
  const [k, blue] = ROOM_LIGHT[room];
  const r = Math.min(255, ((n >> 16) & 255) * k * (1 - blue * 0.25));
  const g = Math.min(255, ((n >> 8) & 255) * k * (1 + blue * 0.1));
  const bl = Math.min(255, (n & 255) * k + blue * 160);
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(bl)},${b})`;
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

function drawNeonCity(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, band: ViewArea) {
  // The skyline may rise above the band the other views use, and the water reach below it, so a
  // tall frame isn't mostly empty sky.
  const bh = band.bottom - band.top;
  const a = { ...band, top: Math.max(band.top - bh * 0.45, band.top * 0.35), bottom: band.bottom + bh * 0.12 };
  const { u } = a;
  const W = a.width;
  const drum = drumPulse(score, t);
  const { o0, floors } = octRange(score);
  const margin = W * 0.05;
  const tw = (W - 2 * margin) / 12;
  const ground = a.top + (a.bottom - a.top) * 0.74;
  // Taller floors in tall frames, so the city fills a portrait screen (and the rooms are bigger).
  const floorH = Math.min(tw * 1.7, (ground - a.top - 40 * u) / (floors + 2.6));
  const extra = (pc: number) => Math.round(hash(pc, 7) * 2.4);
  const towerX = (pc: number) => margin + pc * tw;
  // Two windows a floor; a note lights one of them (which one is the building's habit).
  const side = (pc: number, oct: number) => (hash(pc, oct, 11) < 0.5 ? 0 : 1);
  const winRect = (pc: number, oct: number, s: number) => {
    const x = towerX(pc) + tw * 0.08;
    const w = tw * 0.84;
    const ww = w * 0.33;
    const wh = Math.min(floorH * 0.55, ww * 1.5);
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
  const amber = (b: number) => alpha(st.lights, b);
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
          const room = ROOMS[Math.floor(hash(pc, oct, 3) * ROOMS.length)];
          c.save();
          c.shadowColor = st.lights;
          c.shadowBlur = 18 * u * on;
          c.fillStyle = roomLight(st.lights, room, on);
          c.fillRect(r.x, r.y, r.w, r.h);
          c.restore();
          c.save();
          c.globalAlpha = Math.min(1, on * 1.2);
          c.beginPath();
          c.rect(r.x, r.y, r.w, r.h);
          c.clip();
          drawRoom(c, room, r.x, r.y, r.w, r.h, t, pc * 7 + oct);
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
    ctx.shadowColor = st.lights;
    ctx.shadowBlur = 22 * u;
    ctx.fillStyle = '#fff6e0';
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
  const glowC = st.lights;

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
