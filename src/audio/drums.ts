/**
 * Synthesized drum kits (no samples: deterministic, offline-renderable, no
 * licensing). Each hit builds a few short-lived nodes.
 */
import type { DrumHit, KitId } from '../engine/drums';

interface KitDef {
  kick: { f0: number; f1: number; pitchDecay: number; decay: number; drive: number; click: number };
  snare: { tone: number; toneDecay: number; noiseFreq: number; noiseQ: number; noiseDecay: number; toneMix: number; clap: boolean; drive: number };
  hat: { freq: number; decay: number; openDecay: number; metal: boolean };
  crash: { freq: number; decay: number };
  ride: { freq: number; decay: number; bell: number };
}

export const KITS: Record<KitId, KitDef> = {
  '808': {
    kick: { f0: 150, f1: 44, pitchDecay: 0.05, decay: 1.0, drive: 0.1, click: 0.15 },
    snare: { tone: 190, toneDecay: 0.09, noiseFreq: 1900, noiseQ: 0.7, noiseDecay: 0.17, toneMix: 0.45, clap: false, drive: 0 },
    hat: { freq: 8200, decay: 0.045, openDecay: 0.32, metal: true },
    crash: { freq: 5200, decay: 1.6 },
    ride: { freq: 3300, decay: 0.9, bell: 0.5 },
  },
  witch: {
    kick: { f0: 115, f1: 37, pitchDecay: 0.09, decay: 1.5, drive: 0.75, click: 0.05 },
    snare: { tone: 160, toneDecay: 0.06, noiseFreq: 1250, noiseQ: 1.1, noiseDecay: 0.32, toneMix: 0.25, clap: true, drive: 0.3 },
    hat: { freq: 9200, decay: 0.03, openDecay: 0.25, metal: false },
    crash: { freq: 3600, decay: 2.6 },
    ride: { freq: 3400, decay: 1.7, bell: 0.12 },
  },
  acoustic: {
    kick: { f0: 95, f1: 52, pitchDecay: 0.03, decay: 0.38, drive: 0, click: 0.45 },
    snare: { tone: 225, toneDecay: 0.07, noiseFreq: 2600, noiseQ: 0.6, noiseDecay: 0.22, toneMix: 0.4, clap: false, drive: 0 },
    hat: { freq: 10500, decay: 0.06, openDecay: 0.4, metal: false },
    crash: { freq: 6000, decay: 1.9 },
    ride: { freq: 4200, decay: 1.4, bell: 0.7 },
  },
  industrial: {
    kick: { f0: 170, f1: 48, pitchDecay: 0.04, decay: 0.55, drive: 1, click: 0.3 },
    snare: { tone: 140, toneDecay: 0.05, noiseFreq: 800, noiseQ: 2.2, noiseDecay: 0.28, toneMix: 0.2, clap: false, drive: 0.9 },
    hat: { freq: 6200, decay: 0.05, openDecay: 0.3, metal: true },
    crash: { freq: 2400, decay: 1.4 },
    ride: { freq: 2600, decay: 0.8, bell: 0.8 },
  },
  jungle: {
    // Tight and punchy: a short kick with snap, a crisp, cracking breakbeat snare, bright short hats.
    kick: { f0: 165, f1: 54, pitchDecay: 0.028, decay: 0.3, drive: 0.3, click: 0.4 },
    snare: { tone: 215, toneDecay: 0.075, noiseFreq: 3300, noiseQ: 0.5, noiseDecay: 0.15, toneMix: 0.5, clap: false, drive: 0.4 },
    hat: { freq: 7600, decay: 0.032, openDecay: 0.2, metal: false },
    crash: { freq: 4700, decay: 1.7 },
    ride: { freq: 4400, decay: 1.1, bell: 0.35 },
  },
};

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const d = b.getChannelData(0);
    let x = 2463534242;
    for (let i = 0; i < d.length; i++) {
      // xorshift: deterministic noise
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      d[i] = ((x >>> 0) / 4294967296) * 2 - 1;
    }
    noiseCache.set(ctx, b);
  }
  return b;
}

function shaper(ctx: BaseAudioContext, amount: number): WaveShaperNode {
  const ws = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  const k = 1 + amount * 12;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  ws.curve = curve;
  return ws;
}

function env(ctx: BaseAudioContext, when: number, peak: number, decay: number, attack = 0.001, rev = false): GainNode {
  const g = ctx.createGain();
  if (rev) {
    // Played backwards: the tail swells up into the attack, which lands on `when`.
    g.gain.setValueAtTime(Math.max(1e-4, peak * 1e-3), when - decay);
    g.gain.exponentialRampToValueAtTime(Math.max(1e-4, peak), when);
    g.gain.linearRampToValueAtTime(0, when + 0.004);
    return g;
  }
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(peak, when + attack);
  g.gain.exponentialRampToValueAtTime(Math.max(1e-4, peak * 1e-3), when + attack + decay);
  return g;
}

function noise(ctx: BaseAudioContext, when: number, dur: number): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.start(when, (when * 7.31) % 1.5);
  src.stop(when + dur);
  return src;
}

/** Six detuned squares: the classic metallic cymbal source. */
function metal(ctx: BaseAudioContext, when: number, dur: number, base: number): AudioNode {
  const sum = ctx.createGain();
  sum.gain.value = 0.18;
  for (const r of [1, 1.342, 1.2312, 1.6532, 1.9523, 2.1523]) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = base * r;
    o.connect(sum);
    o.start(when);
    o.stop(when + dur);
  }
  return sum;
}

/**
 * Play one hit into `out` (and `send`, for reverb) at context time `when`.
 * hit.rate < 1 plays it slowed (lower, longer: tape stop); hit.rev plays it backwards,
 * ending on its attack at `when`.
 */
/** `trim` scales the finished hit (after any drive), so it changes loudness without changing the sound. */
export function playHit(ctx: BaseAudioContext, kitId: KitId, hit: DrumHit, level: number, out: AudioNode, send: AudioNode | null, when: number, trim = 1) {
  const kit = KITS[kitId];
  const vel = hit.vel * level;
  if (vel <= 0) return;
  const r = Math.max(0.15, Math.min(1, hit.rate ?? 1));
  const rev = Boolean(hit.rev);
  const slow = (d: number) => d / Math.max(0.35, r);
  // A source that sounds for `dur`: starts at `when`, or `dur` earlier when reversed.
  const startOf = (dur: number) => (rev ? when - dur : when);
  const E = (at: number, peak: number, decay: number, attack = 0.001) => env(ctx, rev ? when : at, peak, decay, attack, rev);
  const dest = ctx.createGain();
  dest.gain.value = trim;
  dest.connect(out);
  if (send) dest.connect(send);

  if (hit.voice === 'kick') {
    const k = kit.kick;
    const decay = slow(k.decay);
    const o = ctx.createOscillator();
    o.type = 'sine';
    const t0 = startOf(decay);
    if (rev) {
      o.frequency.setValueAtTime(k.f1 * r, t0);
      o.frequency.setValueAtTime(k.f1 * r, when - slow(k.pitchDecay));
      o.frequency.exponentialRampToValueAtTime(k.f0 * r, when);
    } else {
      o.frequency.setValueAtTime(k.f0 * r, when);
      o.frequency.exponentialRampToValueAtTime(k.f1 * r, when + slow(k.pitchDecay));
    }
    const g = E(when, vel, decay, 0.002);
    let node: AudioNode = o.connect(g);
    if (k.drive > 0) node = node.connect(shaper(ctx, k.drive));
    node.connect(dest);
    o.start(t0);
    o.stop(rev ? when + 0.01 : when + decay + 0.05);
    if (k.click > 0) {
      const n = noise(ctx, startOf(0.02), 0.03);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500 * r;
      n.connect(hp).connect(E(when, vel * k.click, 0.012)).connect(dest);
    }
  } else if (hit.voice === 'snare') {
    const s = kit.snare;
    const toneDecay = slow(s.toneDecay);
    const noiseDecay = slow(s.noiseDecay);
    const body = ctx.createOscillator();
    body.type = 'triangle';
    const b0 = startOf(toneDecay);
    body.frequency.setValueAtTime(s.tone * (rev ? 1 : 1.4) * r, b0);
    body.frequency.exponentialRampToValueAtTime(s.tone * (rev ? 1.4 : 1) * r, rev ? when : when + 0.03);
    body.connect(E(when, vel * s.toneMix, toneDecay)).connect(dest);
    body.start(b0);
    body.stop(rev ? when + 0.01 : when + toneDecay + 0.05);
    const bursts = s.clap && !rev ? [0, 0.011, 0.023] : [0];
    for (const off of bursts) {
      const last = off === bursts[bursts.length - 1];
      const n = noise(ctx, startOf(noiseDecay) + off, noiseDecay + 0.1);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = s.noiseFreq * r;
      bp.Q.value = s.noiseQ;
      let node: AudioNode = n.connect(bp).connect(E(when + off, vel * (1 - s.toneMix * 0.5), last ? noiseDecay : 0.012));
      if (s.drive > 0) node = node.connect(shaper(ctx, s.drive));
      node.connect(dest);
    }
  } else if (hit.voice === 'hat') {
    const h = kit.hat;
    const decay = slow(hit.open ? h.openDecay : h.decay);
    const t0 = startOf(decay);
    const src: AudioNode = h.metal ? metal(ctx, t0, decay + 0.05, 320 * r) : noise(ctx, t0, decay + 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = Math.max(2000, h.freq * r);
    src.connect(hp).connect(E(when, vel * 0.7, decay)).connect(dest);
  } else if (hit.voice === 'crash') {
    const c = kit.crash;
    const decay = slow(c.decay);
    const n = noise(ctx, startOf(decay), decay + 0.1);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = c.freq * r;
    n.connect(hp).connect(E(when, vel * 0.55, decay, 0.003)).connect(dest);
    const m = metal(ctx, startOf(decay * 0.6), decay * 0.6, 410 * r);
    const hp2 = ctx.createBiquadFilter();
    hp2.type = 'highpass';
    hp2.frequency.value = c.freq * 0.8 * r;
    m.connect(hp2).connect(E(when, vel * 0.25, decay * 0.5)).connect(dest);
  } else if (hit.voice === 'ride') {
    // Shimmer (metallic partials, high-passed so they read as cymbal, not buzz), a noise wash,
    // a short stick ping, and an optional bell made of inharmonic partials rather than one sine.
    const rd = kit.ride;
    const decay = slow(rd.decay);
    const m = metal(ctx, startOf(decay), decay + 0.05, (rd.freq / 7) * r);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = rd.freq * r;
    hp.Q.value = 0.5;
    m.connect(hp).connect(E(when, vel * 0.32, decay, 0.002)).connect(dest);
    const wash = noise(ctx, startOf(decay), decay + 0.05);
    const hp2 = ctx.createBiquadFilter();
    hp2.type = 'highpass';
    hp2.frequency.value = Math.max(5500, rd.freq * 1.6) * r;
    wash.connect(hp2).connect(E(when, vel * 0.2, decay * 0.8, 0.002)).connect(dest);
    const ping = noise(ctx, startOf(0.03), 0.04);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rd.freq * 1.5 * r;
    bp.Q.value = 1.2;
    ping.connect(bp).connect(E(when, vel * 0.35, 0.018)).connect(dest);
    if (rd.bell > 0) {
      for (const [ratio, amp] of [[1, 1], [2.76, 0.5], [5.4, 0.25]] as const) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = rd.freq * 0.22 * ratio * r;
        o.connect(E(when, vel * 0.06 * rd.bell * amp, decay * 0.35)).connect(dest);
        const t0 = startOf(decay * 0.35);
        o.start(t0);
        o.stop(rev ? when + 0.01 : when + decay * 0.4);
      }
    }
  }
}
