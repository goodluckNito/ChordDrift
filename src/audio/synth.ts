import { pitchAt } from '../engine/motion';
import { stream } from '../engine/rng';
import type { Score } from '../engine/score';
import { midiToHz } from '../engine/theory';

/**
 * Audio: one oscillator per voice whose frequency follows pitchAt(v, t) — the
 * same function that draws the picture. Each voice's eased pitch curve is
 * sampled at a control rate and handed to setValueCurveAtTime, so glides are
 * exact S-curves in pitch space (not linear ramps in Hz).
 */

const CONTROL_RATE = 250; // Hz; linear interpolation between points at this rate is inaudible

export interface Master {
  input: AudioNode;
  output: AudioNode;
}

/** Long, dark synthetic reverb: decaying stereo noise with a closing low-pass. */
export function makeImpulse(ctx: BaseAudioContext, seed: number, seconds = 3.4): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const rng = stream(seed, `reverb-${ch}`);
    const data = buf.getChannelData(ch);
    const preDelay = Math.floor(sr * 0.018);
    let lp = 0;
    for (let i = preDelay; i < len; i++) {
      const x = (i - preDelay) / (len - preDelay);
      const decay = Math.pow(10, (-60 * x * 1.0) / 20); // -60 dB over the tail
      const cutoff = 0.5 * Math.pow(1 - x, 2) + 0.03; // one-pole coefficient: bright → dark
      lp += cutoff * (rng() * 2 - 1 - lp);
      data[i] = lp * decay;
    }
  }
  return buf;
}

export function createMaster(ctx: BaseAudioContext, score: Score, destination: AudioNode): Master {
  const a = score.config.audio;
  const input = ctx.createGain();
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = a.lowpass;
  lowpass.Q.value = 0.5;

  const dry = ctx.createGain();
  dry.gain.value = 1 - a.reverb * 0.5;
  const wet = ctx.createGain();
  wet.gain.value = a.reverb * 1.4;
  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx, score.seed);

  // The limiter matters most at unison, where all voices add up in phase.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;

  const out = ctx.createGain();
  out.gain.value = a.gain;

  input.connect(lowpass);
  lowpass.connect(dry).connect(limiter);
  lowpass.connect(convolver).connect(wet).connect(limiter);
  limiter.connect(out).connect(destination);
  return { input, output: out };
}

export interface Voices {
  stop(): void;
}

/**
 * Schedule every voice. `when` is the context time at which score time `offset`
 * should sound, so playback can start mid-piece.
 */
export function scheduleVoices(ctx: BaseAudioContext, score: Score, master: Master, when: number, offset: number): Voices {
  const cfg = score.config;
  const a = cfg.audio;
  const V = cfg.voices;
  const musicEnd = score.timeline.musicEnd;
  if (offset >= musicEnd) return { stop() {} };

  const n = Math.max(2, Math.ceil((musicEnd - offset) * CONTROL_RATE) + 1);
  const duration = (n - 1) / CONTROL_RATE;
  const fadeOutStart = musicEnd - cfg.timing.outro * 0.7;
  const fadeOutLen = Math.max(0.05, musicEnd - fadeOutStart);
  const baseGain = 1.25 / V;

  const oscs: OscillatorNode[] = [];
  for (let v = 0; v < V; v++) {
    const freq = new Float32Array(n);
    const gain = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = offset + i / CONTROL_RATE;
      const f = midiToHz(pitchAt(score, v, t));
      freq[i] = f;
      let env = 1;
      env *= Math.min(1, t / 0.05); // 50 ms fade-in at the very start
      env *= Math.min(1, (t - offset) / 0.03 + (offset === 0 ? 1 : 0)); // de-click when starting mid-piece
      if (t > fadeOutStart) env *= 0.5 * (1 + Math.cos((Math.PI * Math.min(1, (t - fadeOutStart) / fadeOutLen))));
      gain[i] = baseGain * Math.pow(f / 220, -a.tilt) * Math.max(0, env);
    }

    const osc = ctx.createOscillator();
    osc.type = a.wave;
    osc.detune.value = score.detune[v];
    osc.frequency.value = freq[0];
    osc.frequency.setValueCurveAtTime(freq, when, duration);

    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueCurveAtTime(gain, when, duration);

    const pan = ctx.createStereoPanner();
    pan.pan.value = score.pan[v];

    osc.connect(g).connect(pan).connect(master.input);
    osc.start(when);
    osc.stop(when + duration + 0.02);
    oscs.push(osc);
  }
  return {
    stop() {
      for (const o of oscs) {
        try {
          o.stop();
          o.disconnect();
        } catch {
          /* already stopped */
        }
      }
    },
  };
}

/** Render the whole piece (reverb tail included) to an AudioBuffer. */
export async function renderOffline(score: Score, sampleRate = 48000): Promise<AudioBuffer> {
  const length = Math.ceil(score.timeline.end * sampleRate);
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const master = createMaster(ctx, score, ctx.destination);
  scheduleVoices(ctx, score, master, 0, 0);
  return ctx.startRendering();
}

/** Encode an AudioBuffer as a 16-bit PCM WAV file. */
export function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = 44 + frames * channels * 2;
  const out = new ArrayBuffer(bytes);
  const view = new DataView(out);
  const writeStr = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  writeStr(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, frames * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return out;
}

/**
 * Live playback with a clock the renderer can follow. Rebuilds the voices on
 * every play/seek; the master chain (and its reverb) is kept.
 */
export class LivePlayer {
  ctx: AudioContext | null = null;
  private master: Master | null = null;
  private masterScore: Score | null = null;
  private voices: Voices | null = null;
  private startedAt = 0;
  private startOffset = 0;
  private recordTap: MediaStreamAudioDestinationNode | null = null;
  playing = false;

  private ensure(score: Score): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: 'playback' });
    if (!this.master || this.masterScore !== score) {
      this.master?.output.disconnect();
      this.master = createMaster(this.ctx, score, this.ctx.destination);
      if (this.recordTap) this.master.output.connect(this.recordTap);
      this.masterScore = score;
    }
    return this.ctx;
  }

  async play(score: Score, offset: number): Promise<void> {
    const ctx = this.ensure(score);
    if (ctx.state === 'suspended') await ctx.resume();
    this.voices?.stop();
    const when = ctx.currentTime + 0.06;
    this.voices = scheduleVoices(ctx, score, this.master!, when, offset);
    this.startedAt = when;
    this.startOffset = offset;
    this.playing = true;
  }

  pause(): number {
    const t = this.time();
    this.voices?.stop();
    this.voices = null;
    this.playing = false;
    this.startOffset = t;
    return t;
  }

  /** Current score time. */
  time(): number {
    if (!this.playing || !this.ctx) return this.startOffset;
    return this.startOffset + Math.max(0, this.ctx.currentTime - this.startedAt);
  }

  /** An audio MediaStream of the master output, for MediaRecorder. */
  recordStream(score: Score): MediaStream {
    const ctx = this.ensure(score);
    if (!this.recordTap) {
      this.recordTap = ctx.createMediaStreamDestination();
      this.master!.output.connect(this.recordTap);
    }
    return this.recordTap.stream;
  }
}
