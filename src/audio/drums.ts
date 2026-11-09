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
    ride: { freq: 2800, decay: 1.2, bell: 0.3 },
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
    ride: { freq: 2200, decay: 0.8, bell: 0.9 },
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

function env(ctx: BaseAudioContext, when: number, peak: number, decay: number, attack = 0.001): GainNode {
  const g = ctx.createGain();
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

/** Play one hit into `out` (and `send`, for reverb) at context time `when`. */
export function playHit(ctx: BaseAudioContext, kitId: KitId, hit: DrumHit, level: number, out: AudioNode, send: AudioNode | null, when: number) {
  const kit = KITS[kitId];
  const vel = hit.vel * level;
  if (vel <= 0) return;
  const dest = ctx.createGain();
  dest.connect(out);
  if (send) dest.connect(send);

  if (hit.voice === 'kick') {
    const k = kit.kick;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(k.f0, when);
    o.frequency.exponentialRampToValueAtTime(k.f1, when + k.pitchDecay);
    const g = env(ctx, when, vel, k.decay, 0.002);
    let node: AudioNode = o.connect(g);
    if (k.drive > 0) node = node.connect(shaper(ctx, k.drive));
    node.connect(dest);
    o.start(when);
    o.stop(when + k.decay + 0.05);
    if (k.click > 0) {
      const n = noise(ctx, when, 0.02);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500;
      n.connect(hp).connect(env(ctx, when, vel * k.click, 0.012)).connect(dest);
    }
  } else if (hit.voice === 'snare') {
    const s = kit.snare;
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(s.tone * 1.4, when);
    body.frequency.exponentialRampToValueAtTime(s.tone, when + 0.03);
    body.connect(env(ctx, when, vel * s.toneMix, s.toneDecay)).connect(dest);
    body.start(when);
    body.stop(when + s.toneDecay + 0.05);
    const bursts = s.clap ? [0, 0.011, 0.023] : [0];
    for (const off of bursts) {
      const last = off === bursts[bursts.length - 1];
      const n = noise(ctx, when + off, s.noiseDecay + 0.1);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = s.noiseFreq;
      bp.Q.value = s.noiseQ;
      let node: AudioNode = n.connect(bp).connect(env(ctx, when + off, vel * (1 - s.toneMix * 0.5), last ? s.noiseDecay : 0.012));
      if (s.drive > 0) node = node.connect(shaper(ctx, s.drive));
      node.connect(dest);
    }
  } else if (hit.voice === 'hat') {
    const h = kit.hat;
    const decay = hit.open ? h.openDecay : h.decay;
    const src: AudioNode = h.metal ? metal(ctx, when, decay + 0.05, 320) : noise(ctx, when, decay + 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = h.freq;
    src.connect(hp).connect(env(ctx, when, vel * 0.7, decay)).connect(dest);
  } else if (hit.voice === 'crash') {
    const c = kit.crash;
    const n = noise(ctx, when, c.decay + 0.1);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = c.freq;
    n.connect(hp).connect(env(ctx, when, vel * 0.55, c.decay, 0.003)).connect(dest);
    const m = metal(ctx, when, c.decay * 0.6, 410);
    const hp2 = ctx.createBiquadFilter();
    hp2.type = 'highpass';
    hp2.frequency.value = c.freq * 0.8;
    m.connect(hp2).connect(env(ctx, when, vel * 0.25, c.decay * 0.5)).connect(dest);
  } else if (hit.voice === 'ride') {
    const r = kit.ride;
    const m = metal(ctx, when, r.decay + 0.05, r.freq / 8);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = r.freq;
    bp.Q.value = 1.4;
    m.connect(bp).connect(env(ctx, when, vel * 0.5, r.decay)).connect(dest);
    if (r.bell > 0) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = r.freq * 0.62;
      o.connect(env(ctx, when, vel * 0.18 * r.bell, r.decay * 0.6)).connect(dest);
      o.start(when);
      o.stop(when + r.decay);
    }
  }
}
