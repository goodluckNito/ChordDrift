import { melodyAt, pitchAt, swellAt } from '../engine/motion';
import type { Wave } from '../engine/config';
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

/** Rough loudness compensation: saw and square carry far more energy than a sine. */
export const WAVE_GAIN: Record<Wave, number> = { sine: 1, triangle: 0.95, sawtooth: 0.75, square: 0.6 };

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
  // Wetter settings get a longer tail (kept moderate: long convolutions cost CPU on phones).
  convolver.buffer = makeImpulse(ctx, score.seed, 2.8 + 2.4 * Math.max(0, a.reverb - 0.3));

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

/**
 * Some browsers (notably on phones) reject value curves that sit very close to
 * each other. Once that happens we stop using curves altogether and schedule a
 * handful of linear ramps per chunk instead. Ramps continue from whatever value
 * the parameter already has, so there are never jumps.
 */
let curvesUnsupported = false;
const RAMPS_PER_CHUNK = 10;

function setCurve(param: AudioParam, curve: Float32Array, at: number, dur: number) {
  if (!curvesUnsupported) {
    try {
      param.setValueCurveAtTime(curve, at, dur);
      return;
    } catch {
      curvesUnsupported = true;
    }
  }
  try {
    const last = curve.length - 1;
    for (let k = 1; k <= RAMPS_PER_CHUNK; k++) {
      param.linearRampToValueAtTime(curve[Math.round((k / RAMPS_PER_CHUNK) * last)], at + (dur * k) / RAMPS_PER_CHUNK);
    }
  } catch {
    /* skip this chunk only */
  }
}

/** Length of each scheduled automation chunk (s). */
const CHUNK = 0.5;

/**
 * The oscillator bank. Frequency and gain automation is scheduled in short
 * consecutive chunks, each a value curve sampled from pitchAt — so the same
 * code serves a finite piece, an endless one (scheduled just ahead of the
 * playhead), and offline export (all chunks scheduled up front).
 */
export class VoiceBank {
  private oscs: OscillatorNode[] = [];
  private gains: GainNode[] = [];
  private lead: { osc: OscillatorNode; gain: GainNode } | null = null;
  private nextChunk = 0;
  private stopped = false;

  /**
   * @param when   context time at which score time `offset` sounds
   * @param endAt  score time at which the voices fade to silence (musicEnd, or an export length)
   */
  constructor(
    private ctx: BaseAudioContext,
    private score: Score,
    master: Master,
    private when: number,
    private offset: number,
    private endAt: number,
  ) {
    const a = score.config.audio;
    for (let v = 0; v < score.config.voices; v++) {
      const osc = ctx.createOscillator();
      osc.type = a.wave;
      osc.detune.value = score.detune[v];
      osc.frequency.value = midiToHz(pitchAt(score, v, offset));
      const g = ctx.createGain();
      g.gain.value = 0;
      const pan = ctx.createStereoPanner();
      pan.pan.value = score.pan[v];
      osc.connect(g).connect(pan).connect(master.input);
      osc.start(when);
      this.oscs.push(osc);
      this.gains.push(g);
    }
    if (score.config.melody.enabled) {
      const osc = ctx.createOscillator();
      osc.type = score.config.melody.wave;
      osc.frequency.value = midiToHz(melodyAt(score, offset)?.p ?? score.startNote);
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g).connect(master.input);
      osc.start(when);
      this.oscs.push(osc);
      this.lead = { osc, gain: g };
    }
    if (Number.isFinite(endAt)) {
      const stopAt = when + Math.max(0, endAt - offset) + 0.05;
      for (const o of this.oscs) o.stop(stopAt);
    }
  }

  /** Score time up to which automation has been scheduled. */
  get scheduledUntil(): number {
    return this.offset + this.nextChunk * CHUNK;
  }

  /** Schedule chunks until score time `until` is covered. */
  scheduleUntil(until: number): void {
    if (this.stopped) return;
    const cfg = this.score.config;
    const V = cfg.voices;
    const sr = this.ctx.sampleRate;
    const fadeLen = Math.max(0.05, Math.min(cfg.timing.outro * 0.7, 1.5));
    const fadeOutStart = this.endAt - fadeLen;
    const baseGain = (1.25 / V) * WAVE_GAIN[cfg.audio.wave];
    const leadGain = 0.55 * cfg.melody.level * WAVE_GAIN[cfg.melody.wave];
    const n = Math.round(CHUNK * CONTROL_RATE) + 1;
    const live = !(this.ctx instanceof OfflineAudioContext);
    while (this.scheduledUntil < Math.min(until, this.endAt)) {
      // If the page stalled (slow phone, app switch, background tab) and we fell
      // behind the audio clock, skip the chunks that are already in the past
      // rather than scheduling them late — late curves overlap and get rejected,
      // which used to freeze every voice on one chord.
      if (live) {
        const behind = this.ctx.currentTime + 0.03 - (this.when + this.nextChunk * CHUNK);
        if (behind > 0) {
          this.nextChunk += Math.ceil(behind / CHUNK);
          continue;
        }
      }
      const t0 = this.scheduledUntil;
      this.score.extend(t0 + CHUNK);
      const at = this.when + this.nextChunk * CHUNK;
      // Curves must not touch: leave two render quanta (~5 ms) between them. Each
      // curve still ends on the value due at the next chunk's start, so the
      // tiny gap just holds that value — no step in pitch.
      const dur = CHUNK - Math.max(256 / sr, 0.004);
      for (let v = 0; v < V; v++) {
        const freq = new Float32Array(n);
        const gain = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const t = t0 + (i / (n - 1)) * CHUNK;
          const f = midiToHz(pitchAt(this.score, v, t));
          freq[i] = f;
          let env = Math.min(1, t / 0.05); // 50 ms fade-in at the very start
          if (this.offset > 0) env *= Math.min(1, (t - this.offset) / 0.03); // de-click when starting mid-piece
          if (t > fadeOutStart) env *= 0.5 * (1 + Math.cos(Math.PI * Math.min(1, (t - fadeOutStart) / fadeLen)));
          gain[i] = baseGain * Math.pow(f / 220, -cfg.audio.tilt) * Math.max(0, env) * swellAt(this.score, v, t);
        }
        setCurve(this.oscs[v].frequency, freq, at, dur);
        setCurve(this.gains[v].gain, gain, at, dur);
      }
      if (this.lead) {
        const freq = new Float32Array(n);
        const gain = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const t = t0 + (i / (n - 1)) * CHUNK;
          const m = melodyAt(this.score, t);
          const f = midiToHz(m?.p ?? this.score.startNote);
          freq[i] = f;
          let env = 1;
          if (this.offset > 0) env *= Math.min(1, (t - this.offset) / 0.03);
          if (t > fadeOutStart) env *= 0.5 * (1 + Math.cos(Math.PI * Math.min(1, (t - fadeOutStart) / fadeLen)));
          gain[i] = leadGain * (m?.g ?? 0) * Math.pow(f / 440, -cfg.audio.tilt) * Math.max(0, env) * swellAt(this.score, -1, t);
        }
        setCurve(this.lead.osc.frequency, freq, at, dur);
        setCurve(this.lead.gain.gain, gain, at, dur);
      }
      this.nextChunk++;
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.ctx.currentTime;
    const gains = this.lead ? [...this.gains, this.lead.gain] : this.gains;
    for (let v = 0; v < this.oscs.length; v++) {
      try {
        // Quick fade to avoid a click, then stop.
        gains[v].gain.cancelScheduledValues(now);
        gains[v].gain.setTargetAtTime(0, now, 0.015);
        this.oscs[v].stop(now + 0.1);
      } catch {
        /* already stopped */
      }
    }
  }
}

/** Render the piece (or the first `duration` seconds of an endless one) to an AudioBuffer. */
export async function renderOffline(score: Score, duration = score.timeline.end, sampleRate = 48000): Promise<AudioBuffer> {
  if (!Number.isFinite(duration)) throw new Error('Endless pieces need an explicit duration to render.');
  const length = Math.ceil(duration * sampleRate);
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const master = createMaster(ctx, score, ctx.destination);
  // Finite pieces fade at musicEnd; endless renders fade out a little before the cut, leaving room for the reverb.
  const endAt = Number.isFinite(score.timeline.musicEnd) ? score.timeline.musicEnd : Math.max(1, duration - 2.5);
  score.extend(duration);
  const bank = new VoiceBank(ctx, score, master, 0, 0, endAt);
  bank.scheduleUntil(endAt);
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
 * Live playback with a clock the renderer can follow. A light scheduler keeps
 * automation a couple of seconds ahead of the playhead, which is what lets
 * endless pieces play forever.
 */
export class LivePlayer {
  ctx: AudioContext | null = null;
  private master: Master | null = null;
  private masterScore: Score | null = null;
  private bank: VoiceBank | null = null;
  private timer = 0;
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
    this.stopBank();
    const when = ctx.currentTime + 0.08;
    this.bank = new VoiceBank(ctx, score, this.master!, when, offset, score.timeline.musicEnd);
    const bank = this.bank;
    // Hidden tabs only get timer ticks about once a second (or less), so schedule further ahead there.
    const pump = () => bank.scheduleUntil(this.time() + (document.hidden ? 12 : 3));
    pump();
    this.timer = window.setInterval(pump, 200);
    this.onVisibility = pump;
    document.addEventListener('visibilitychange', pump);
    this.startedAt = when;
    this.startOffset = offset;
    this.playing = true;
  }

  private onVisibility: (() => void) | null = null;

  private stopBank() {
    clearInterval(this.timer);
    if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility);
    this.onVisibility = null;
    this.bank?.stop();
    this.bank = null;
  }

  pause(): number {
    const t = this.time();
    this.stopBank();
    this.playing = false;
    this.startOffset = t;
    return t;
  }

  /** Current score time. */
  time(): number {
    if (!this.playing || !this.ctx) return this.startOffset;
    return this.startOffset + Math.max(0, this.ctx.currentTime - this.startedAt);
  }

  /** Play a chord voicing once, for auditioning palette chords. */
  async audition(score: Score, notes: number[], seconds = 1.8): Promise<void> {
    const ctx = this.ensure(score);
    if (ctx.state === 'suspended') await ctx.resume();
    const now = ctx.currentTime + 0.02;
    const a = score.config.audio;
    notes.forEach((n, v) => {
      const f = midiToHz(n);
      const osc = ctx.createOscillator();
      osc.type = a.wave;
      osc.frequency.value = f;
      osc.detune.value = score.detune[v % score.detune.length] ?? 0;
      const g = ctx.createGain();
      const peak = (1.1 / notes.length) * Math.pow(f / 220, -a.tilt) * WAVE_GAIN[a.wave];
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak, now + 0.08);
      g.gain.setTargetAtTime(0, now + seconds * 0.6, seconds * 0.15);
      const pan = ctx.createStereoPanner();
      pan.pan.value = score.pan[v % score.pan.length] ?? 0;
      osc.connect(g).connect(pan).connect(this.master!.input);
      osc.start(now);
      osc.stop(now + seconds + 0.5);
    });
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
