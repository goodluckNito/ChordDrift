/**
 * Less usual pictures of the music, each moving with the voices and pushed around by the drums:
 *
 *   Tornado       a vortex in a bottle; each voice a band of glitter swirling at its pitch's height.
 *
 * Pure functions of (score, t) like every other view (marbling caches its work, but replays it
 * exactly when time jumps backwards).
 */
import { levelAt, pitchAt } from '../engine/motion';
import type { Score } from '../engine/score';
import { mod12 } from '../engine/theory';
import { alpha, chordAt, drumPulse, skyRange, type ViewArea, type ViewStyle } from './harmony-views';

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
// Tornado in a bottle
// ---------------------------------------------------------------------------

/**
 * The toy: a clear bottle with a vortex spinning down its middle, narrow at the bottom and wide at
 * the top. Every voice is a band of glitter swirling round the funnel at its pitch's height
 * (seen in perspective: particles at the front bright and large, at the back dim), spinning faster
 * where the funnel is narrow. So the chord is the column's profile: a wide voicing a tall, gappy
 * column, a close one a dense knot, a unison a single swirling ring. Bands follow their notes with
 * weight and glitter trails behind, streaming between heights on a glide. Kicks surge the spin,
 * snares fling the glitter outward, hats make it sparkle.
 */
export function drawTornado(ctx: CanvasRenderingContext2D, score: Score, t: number, st: ViewStyle, a: ViewArea, lite = false) {
  const { cx, u } = a;
  const drum = drumPulse(score, t);
  const { lo, span } = skyRange(score);
  const V = score.config.voices;
  // The bottle.
  const H = (a.bottom - a.top) * 0.92;
  const top = a.top + (a.bottom - a.top - H) / 2;
  const bot = top + H;
  const halfW = Math.min(a.width * 0.3, H * 0.28);
  const tilt = 0.24; // how much we look down on the swirl
  const inside0 = top + halfW * tilt + 16 * u;
  const inside1 = bot - halfW * tilt - 10 * u;
  /** Funnel radius at height fraction f (0 bottom … 1 top). */
  const funnel = (f: number) => halfW * (0.1 + 0.78 * Math.pow(Math.max(0, f), 0.75));
  const yOf = (f: number) => inside1 - f * (inside1 - inside0);
  // A band's height follows its note with weight.
  const smoothF = (v: number, time: number) => {
    let s = 0;
    let w = 0;
    for (let i = 0; i < 9; i++) {
      const age = i * 0.15;
      const k = Math.exp(-age / 0.45);
      s += pitchAt(score, v, time - age) * k;
      w += k;
    }
    return Math.max(0.03, Math.min(0.97, 0.06 + 0.9 * ((s / w - lo) / span)));
  };
  const PER = lite ? 45 : 110;
  const LAGS = 5;
  const lagStep = 0.1;
  const fAt = Array.from({ length: LAGS }, (_, j) => Array.from({ length: V }, (_, v) => smoothF(v, t - j * lagStep)));
  const spinBoost = 1 + 0.9 * drum.kick;
  const fling = 1 + 0.6 * drum.snare;

  ctx.save();
  // Back of the glass and the liquid's tint.
  const liquid = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0);
  liquid.addColorStop(0, alpha(st.ink, 0.05));
  liquid.addColorStop(0.5, alpha(st.ink, 0.015));
  liquid.addColorStop(1, alpha(st.ink, 0.06));
  ctx.fillStyle = liquid;
  ctx.fillRect(cx - halfW, top + halfW * tilt, halfW * 2, H - 2 * halfW * tilt);
  ctx.strokeStyle = alpha(st.text, 0.18);
  ctx.lineWidth = Math.max(1, 1.2 * u);
  ctx.beginPath();
  ctx.ellipse(cx, bot - halfW * tilt, halfW, halfW * tilt, 0, Math.PI, Math.PI * 2);
  ctx.stroke();
  // The funnel itself: faint spiralling threads round the core.
  ctx.strokeStyle = alpha(st.text, 0.12);
  for (let k = 0; k < 5; k++) {
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const f = i / 80;
      const r = funnel(f) * 0.55;
      const th = f * 14 + t * 2.2 * spinBoost + (k / 5) * Math.PI * 2;
      const x = cx + Math.cos(th) * r;
      const y = yOf(f) + Math.sin(th) * r * tilt;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  // Glitter: back half first (behind the funnel), then the front.
  const draw = (front: boolean) => {
    for (let v = 0; v < V; v++) {
      const level = levelAt(score, v, t);
      if (level < 0.03) continue;
      ctx.fillStyle = st.voiceColor(v);
      for (let b = 0; b < PER; b++) {
        const lag = Math.min(LAGS - 1.001, hash(v, b, 1) * hash(v, b, 2) * (LAGS - 1));
        const j0 = Math.floor(lag);
        const lf = lag - j0;
        // Height within the band: thick in the middle, thinning out.
        const spread = ((hash(v, b, 3) + hash(v, b, 4) + hash(v, b, 5)) / 1.5 - 1) * 0.035;
        const f = fAt[j0][v] + (fAt[j0 + 1][v] - fAt[j0][v]) * lf + spread;
        const rr = funnel(f) * (0.62 + 0.5 * hash(v, b, 6)) * (1 + 0.35 * drum.snare * hash(v, b, 7)) * fling;
        // Faster near the narrow bottom (angular speed grows as the radius shrinks).
        const omega = ((1.4 * halfW) / Math.max(rr, halfW * 0.08)) * 0.55 * spinBoost;
        const th = hash(v, b, 8) * Math.PI * 2 + t * omega;
        const depth = Math.sin(th);
        if (depth >= 0 !== front) continue;
        const x = cx + Math.cos(th) * rr;
        const y = yOf(f) + depth * rr * tilt;
        // Glitter catches the light as it turns toward you; hats make it all flash.
        const sparkle = Math.max(0, Math.cos(th * 3 + b)) ** 8 + drum.hat * hash(v, b, Math.floor(t * 10));
        const size = (front ? 2.4 : 1.6) * u * (0.7 + 0.6 * hash(v, b, 9)) * (0.6 + 0.4 * level);
        ctx.globalAlpha = Math.min(1, (front ? 0.85 : 0.35) * (0.5 + 0.5 * level) + 0.6 * sparkle);
        ctx.fillRect(x - size, y - size * 0.6, size * 2, size * 1.2);
      }
    }
    ctx.globalAlpha = 1;
  };
  draw(false);
  // The vortex core: a thin bright line down the middle where the air is pulled through.
  const core = ctx.createLinearGradient(0, inside0, 0, inside1);
  core.addColorStop(0, alpha(st.text, 0.04));
  core.addColorStop(1, alpha(st.text, 0.3));
  ctx.strokeStyle = core;
  ctx.lineWidth = Math.max(1, 2 * u);
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const f = i / 40;
    const x = cx + Math.sin(f * 9 - t * 3) * funnel(f) * 0.08;
    if (i) ctx.lineTo(x, yOf(f));
    else ctx.moveTo(x, yOf(f));
  }
  ctx.stroke();
  draw(true);
  // Front of the glass: edges, cap and highlights.
  ctx.strokeStyle = alpha(st.text, 0.35);
  ctx.lineWidth = Math.max(1.5, 2 * u);
  ctx.beginPath();
  ctx.moveTo(cx - halfW, top + halfW * tilt);
  ctx.lineTo(cx - halfW, bot - halfW * tilt);
  ctx.moveTo(cx + halfW, top + halfW * tilt);
  ctx.lineTo(cx + halfW, bot - halfW * tilt);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, top + halfW * tilt, halfW, halfW * tilt, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, bot - halfW * tilt, halfW, halfW * tilt, 0, 0, Math.PI);
  ctx.stroke();
  const shine = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0);
  shine.addColorStop(0.06, 'rgba(255,255,255,0)');
  shine.addColorStop(0.12, 'rgba(255,255,255,0.16)');
  shine.addColorStop(0.18, 'rgba(255,255,255,0)');
  shine.addColorStop(0.86, 'rgba(255,255,255,0)');
  shine.addColorStop(0.9, 'rgba(255,255,255,0.08)');
  shine.addColorStop(0.94, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.fillRect(cx - halfW, top + halfW * tilt, halfW * 2, H - 2 * halfW * tilt);
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

/** The rooms behind lit windows, each with its own light. */
const ROOMS = ['bedroom', 'bathroom', 'office', 'living', 'kitchen'] as const;
type Room = (typeof ROOMS)[number];
/** How each room's light differs from the theme's lights colour: [brightness, extra blue]. */
const ROOM_LIGHT: Record<Room, [number, number]> = { bedroom: [0.72, 0], bathroom: [1, 0.35], office: [0.9, 0.2], living: [0.85, 0], kitchen: [1.05, 0.05] };

/**
 * Silhouettes of a room inside a lit window (x, y, w, h): a bedroom (bed, nightstand lamp,
 * picture), a bathroom (tub, shower curtain, mirror), an office (desk, glowing monitor, someone
 * working), a living room (sofa, TV glow, floor lamp, someone watching) or a kitchen (counter,
 * cupboards, fridge, pendant lamp). `glow` is the screen colour for monitors and TVs.
 */
function drawRoom(c: CanvasRenderingContext2D, room: Room, x: number, y: number, w: number, h: number, t: number, seed: number) {
  const ink = 'rgba(34,16,8,0.86)';
  const X = (f: number) => x + f * w;
  const Y = (f: number) => y + f * h;
  const flip = seed % 2 === 1; // mirror half the rooms so neighbours differ
  c.save();
  if (flip) {
    c.translate(x * 2 + w, 0);
    c.scale(-1, 1);
  }
  c.fillStyle = ink;
  c.beginPath();
  switch (room) {
    case 'bedroom':
      c.rect(X(0.08), Y(0.72), w * 0.62, h * 0.18); // bed
      c.rect(X(0.08), Y(0.55), w * 0.06, h * 0.4); // headboard
      c.ellipse(X(0.22), Y(0.69), w * 0.08, h * 0.05, 0, 0, Math.PI * 2); // pillow
      c.rect(X(0.76), Y(0.74), w * 0.14, h * 0.26); // nightstand
      c.rect(X(0.82), Y(0.56), w * 0.025, h * 0.18); // lamp stem
      c.rect(X(0.34), Y(0.18), w * 0.24, h * 0.18); // picture frame
      c.fill();
      // the lamp shade, lit
      c.fillStyle = 'rgba(255,240,200,0.9)';
      c.beginPath();
      c.moveTo(X(0.76), Y(0.56));
      c.lineTo(X(0.93), Y(0.56));
      c.lineTo(X(0.89), Y(0.44));
      c.lineTo(X(0.8), Y(0.44));
      c.fill();
      break;
    case 'bathroom':
      c.roundRect(X(0.1), Y(0.7), w * 0.56, h * 0.18, h * 0.06); // tub
      c.rect(X(0.14), Y(0.88), w * 0.04, h * 0.08);
      c.rect(X(0.58), Y(0.88), w * 0.04, h * 0.08);
      c.rect(X(0.08), Y(0.12), w * 0.6, h * 0.025); // curtain rail
      c.moveTo(X(0.08), Y(0.14));
      c.lineTo(X(0.26), Y(0.14));
      c.quadraticCurveTo(X(0.2), Y(0.45), X(0.24), Y(0.7));
      c.lineTo(X(0.08), Y(0.7));
      c.rect(X(0.78), Y(0.62), w * 0.14, h * 0.38); // sink cabinet
      c.fill();
      c.fillStyle = 'rgba(220,240,255,0.55)'; // mirror
      c.fillRect(X(0.77), Y(0.24), w * 0.16, h * 0.26);
      break;
    case 'office': {
      c.rect(X(0.1), Y(0.66), w * 0.75, h * 0.05); // desk
      c.rect(X(0.14), Y(0.71), w * 0.04, h * 0.29);
      c.rect(X(0.77), Y(0.71), w * 0.04, h * 0.29);
      c.rect(X(0.42), Y(0.58), w * 0.04, h * 0.08); // monitor stand
      c.arc(X(0.62), Y(0.46), Math.min(w, h) * 0.1, 0, Math.PI * 2); // someone working
      c.roundRect(X(0.5), Y(0.56), w * 0.25, h * 0.3, w * 0.08);
      c.rect(X(0.06), Y(0.1), w * 0.3, h * 0.03); // shelf
      c.rect(X(0.08), Y(0.02), w * 0.05, h * 0.08);
      c.rect(X(0.15), Y(0.04), w * 0.04, h * 0.06);
      c.fill();
      // the monitor's glow, flickering a little
      const f = 0.75 + 0.25 * Math.sin(t * 3.1 + seed);
      c.fillStyle = `rgba(150,200,255,${0.85 * f})`;
      c.fillRect(X(0.28), Y(0.38), w * 0.32, h * 0.2);
      break;
    }
    case 'living': {
      c.roundRect(X(0.06), Y(0.7), w * 0.5, h * 0.2, h * 0.05); // sofa
      c.roundRect(X(0.04), Y(0.62), w * 0.08, h * 0.32, h * 0.03);
      c.roundRect(X(0.5), Y(0.62), w * 0.08, h * 0.32, h * 0.03);
      c.arc(X(0.3), Y(0.6), Math.min(w, h) * 0.09, 0, Math.PI * 2); // someone watching
      c.rect(X(0.68), Y(0.78), w * 0.26, h * 0.22); // TV stand
      c.rect(X(0.92), Y(0.3), w * 0.025, h * 0.6); // floor lamp
      c.fill();
      const f = 0.6 + 0.4 * Math.abs(Math.sin(t * 2.3 + seed * 1.7));
      c.fillStyle = `rgba(140,180,255,${0.9 * f})`; // TV
      c.fillRect(X(0.66), Y(0.5), w * 0.3, h * 0.24);
      c.fillStyle = 'rgba(255,235,190,0.85)';
      c.beginPath();
      c.arc(X(0.93), Y(0.28), Math.min(w, h) * 0.07, Math.PI, 0);
      c.fill();
      break;
    }
    default: {
      // kitchen
      c.rect(X(0.0), Y(0.68), w * 0.7, h * 0.32); // counter
      c.rect(X(0.0), Y(0.08), w * 0.7, h * 0.22); // cupboards
      c.rect(X(0.76), Y(0.2), w * 0.2, h * 0.8); // fridge
      c.rect(X(0.36), Y(0.0), w * 0.015, h * 0.36); // pendant cord
      c.rect(X(0.2), Y(0.6), w * 0.08, h * 0.08); // a pot
      c.fill();
      c.fillStyle = 'rgba(255,245,215,0.9)';
      c.beginPath();
      c.arc(X(0.365), Y(0.4), Math.min(w, h) * 0.07, Math.PI, 0);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.18)'; // cupboard door lines
      c.fillRect(X(0.23), Y(0.1), w * 0.01, h * 0.18);
      c.fillRect(X(0.46), Y(0.1), w * 0.01, h * 0.18);
    }
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
