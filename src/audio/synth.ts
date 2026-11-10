import { articulationAt, chopAt, drumHits, duckAt, duckEnvelope, energyAt, layerAt, melodyAt, pitchAt, swellAt } from '../engine/motion';
import { playHit } from './drums';
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
export const WAVE_GAIN: Record<Wave, number> = { warm: 0.62, sine: 1, triangle: 0.95, sawtooth: 0.75, square: 0.6 };

/**
 * "Warm": a harmonic-rich wave matched to the reference recordings — 2nd
 * harmonic about −5 dB and 3rd about −7 dB under the fundamental, then a smooth
 * roll-off (fuller than a sine, softer than a saw).
 */
const warmCache = new WeakMap<BaseAudioContext, PeriodicWave>();
function warmWave(ctx: BaseAudioContext): PeriodicWave {
  let w = warmCache.get(ctx);
  if (!w) {
    const amps = [0, 1, 0.56, 0.45, 0.3, 0.22, 0.15, 0.11, 0.075, 0.05, 0.035, 0.024, 0.016];
    const real = new Float32Array(amps.length);
    const imag = Float32Array.from(amps);
    w = ctx.createPeriodicWave(real, imag);
    warmCache.set(ctx, w);
  }
  return w;
}

/** Set an oscillator's waveform (the built-in types, or the custom warm wave). */
function setWave(ctx: BaseAudioContext, osc: OscillatorNode, wave: Wave) {
  if (wave === 'warm') osc.setPeriodicWave(warmWave(ctx));
  else osc.type = wave;
}

export interface Master {
  input: AudioNode;
  output: AudioNode;
  /** Straight into the limiter (no tone filter): drums. */
  direct: AudioNode;
  /** Into the reverb only. */
  reverbSend: AudioNode;
}

/**
 * Long, dark synthetic reverb: decaying noise with a closing low-pass. `spread` (0..1) is how much each
 * channel's noise is its own rather than shared. Low spread keeps the tail centred and solid, like the
 * near-mono reverb of the reference videos; 1 is fully decorrelated, wide stereo.
 */
export function makeImpulse(ctx: BaseAudioContext, seed: number, seconds = 3.4, spread = 1): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const own = Math.sqrt(Math.min(1, Math.max(0, spread)));
  const shared = Math.sqrt(1 - own * own);
  const common = stream(seed, 'reverb-shared');
  const rngs = [stream(seed, 'reverb-0'), stream(seed, 'reverb-1')];
  const data = [buf.getChannelData(0), buf.getChannelData(1)];
  const preDelay = Math.floor(sr * 0.018);
  const lp = [0, 0];
  for (let i = preDelay; i < len; i++) {
    const x = (i - preDelay) / (len - preDelay);
    const decay = Math.pow(10, (-60 * x * 1.0) / 20); // -60 dB over the tail
    const cutoff = 0.5 * Math.pow(1 - x, 2) + 0.03; // one-pole coefficient: bright → dark
    const c = common() * 2 - 1;
    for (let ch = 0; ch < 2; ch++) {
      lp[ch] += cutoff * (shared * c + own * (rngs[ch]() * 2 - 1) - lp[ch]);
      data[ch][i] = lp[ch] * decay;
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
  wet.gain.value = a.reverb * 1.15;
  const convolver = ctx.createConvolver();
  // Wetter settings get a longer tail (kept moderate: long convolutions cost CPU on phones).
  convolver.buffer = makeImpulse(ctx, score.seed, 2.8 + 2.4 * Math.max(0, a.reverb - 0.3), Math.min(1, 0.04 + a.width * 0.8));

  // The limiter matters most at unison, where all voices add up in phase. For
  // sustained chords it rides gently; for plucks it must only catch peaks and
  // let go fast, or it flattens every strike and pumps between them (which
  // smears the attacks and makes the pulse feel loose).
  const pluck = score.config.motion.transition === 'pluck';
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = pluck ? -3 : -6;
  limiter.knee.value = pluck ? 2 : 6;
  limiter.ratio.value = pluck ? 20 : 12;
  limiter.attack.value = pluck ? 0.001 : 0.003;
  limiter.release.value = pluck ? 0.05 : 0.25;

  const out = ctx.createGain();
  out.gain.value = a.gain;
  // Headroom for strikes going into the faster limiter.
  // Into the limiter with some headroom, so it catches peaks instead of riding the whole mix
  // (with a big sub, constant gain reduction flattened the chords in the loud parts).
  input.gain.value = pluck ? 0.8 : 0.85;

  // Warmth: gentle tanh saturation (gain-compensated) before the reverb split.
  let tone: AudioNode = lowpass;
  if (a.warmth > 0) {
    const drive = 1 + a.warmth * 3;
    const ws = ctx.createWaveShaper();
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
    }
    ws.curve = curve;
    ws.oversample = '2x';
    const pre = ctx.createGain();
    pre.gain.value = 0.9;
    lowpass.connect(pre).connect(ws);
    tone = ws;
  }
  // Bass: a low shelf under the voices and sub (the drums bypass it), like pushing the low end on an EQ.
  if (a.bass) {
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'lowshelf';
    shelf.frequency.value = 110;
    shelf.gain.value = a.bass;
    input.connect(shelf).connect(lowpass);
  } else input.connect(lowpass);
  tone.connect(dry).connect(limiter);
  tone.connect(convolver).connect(wet).connect(limiter);
  limiter.connect(out).connect(destination);
  const direct = ctx.createGain();
  direct.connect(limiter);
  const reverbSend = ctx.createGain();
  reverbSend.gain.value = 1.4;
  reverbSend.connect(convolver);
  return { input, output: out, direct, reverbSend };
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

/** Pluck strikes share one envelope, scheduled at a high rate so every attack is identical. */
const ARTIC_RATE = 2000;

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
  private leadChop: GainNode | null = null;
  /** Sub-bass: a sine an octave under the bass voice (one per layer). */
  private subs: { osc: OscillatorNode; gain: GainNode; layer: 0 | 1 }[] = [];
  /** The sub runs dry to the limiter, so it gets its own copies of the pluck and chop gates. */
  private subArt: GainNode | null = null;
  private subChop: GainNode | null = null;
  /** Everything this bank plays goes through here, so stop() can silence it for sure. */
  private bus: GainNode;
  /** Pluck mode: the shared strike envelope for the chord voices, and its tone (bright on the hit, darker as it rings). */
  private art: GainNode | null = null;
  private pluckTone: BiquadFilterNode | null = null;
  /** Pluck mode: makeup gain so low sustain gives louder strikes, not a quieter mix. */
  private makeup = 1;
  /** Chop: the step gate for the chord voices (its time remap is applied to the voice curves). */
  private chop: GainNode | null = null;
  /** Sidechain: ducks the chord voices under the kick/snare. */
  private duck: GainNode | null = null;
  /** Drums: bus (into the limiter) and reverb send, under this bank so stop() silences them. */
  private drumBus: GainNode | null = null;
  private drumSend: GainNode | null = null;
  /** 1 voice set for glides; 2 alternating sets for release-&-swell transitions. */
  private layers: number;
  /** Loop length (s) when the piece loops, else 0: score time wraps, sound continues. */
  private loopLen: number;
  private drumGate: GainNode | null = null;
  private drySubs: GainNode[] = [];
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
    this.loopLen = score.loop ? score.timeline.end : 0;
    this.bus = ctx.createGain();
    this.bus.connect(master.input);
    let chordOut: AudioNode = this.bus;
    const d = score.config.drums;
    if (score.drums && (d.duck.kick || d.duck.snare) && d.duck.depth > 0) {
      this.duck = ctx.createGain();
      this.duck.gain.value = duckAt(score, offset);
      this.duck.connect(chordOut);
      chordOut = this.duck;
    }
    if (score.chop && score.config.chop.chords) {
      this.chop = ctx.createGain();
      this.chop.gain.value = chopAt(score, offset).level;
      this.chop.connect(chordOut);
      chordOut = this.chop;
    }
    if (score.config.motion.transition === 'pluck') {
      // Average level of a strike's envelope is roughly s + (1 − s)·0.35; make that up so plucks hit hard.
      this.makeup = Math.min(3.2, Math.max(1, 1 / (a.sustain + (1 - a.sustain) * 0.35)));
      this.pluckTone = ctx.createBiquadFilter();
      this.pluckTone.type = 'lowpass';
      this.pluckTone.Q.value = 0.8;
      this.pluckTone.frequency.value = this.pluckCutoff(articulationAt(score, offset));
      this.pluckTone.connect(chordOut);
      this.art = ctx.createGain();
      this.art.gain.value = articulationAt(score, offset) * this.makeup;
      this.art.connect(this.pluckTone);
      chordOut = this.art;
    }
    const voiceOut = chordOut;
    if (score.drums) {
      // Drums skip the chords' tone filter but share the limiter and reverb; the bank's bus gates them.
      this.drumBus = ctx.createGain();
      // Drums sit under the chords (they used to match the whole chord mix, which buried it on small speakers).
      this.drumBus.gain.value = d.level;
      const gate = ctx.createGain();
      this.drumBus.connect(gate).connect(master.direct);
      this.drumSend = ctx.createGain();
      this.drumSend.gain.value = d.reverb * 0.6;
      this.drumSend.connect(master.reverbSend);
      this.drumGate = gate;
    }
    this.layers = score.config.motion.transition === 'swell' ? 2 : 1;
    for (let L = 0; L < this.layers; L++) {
      for (let v = 0; v < score.config.voices; v++) {
        const osc = ctx.createOscillator();
        setWave(ctx, osc, a.wave);
        // The second layer is detuned the other way, which keeps crossfades shimmering rather than phasing.
        osc.detune.value = L === 0 ? score.detune[v] : -score.detune[v];
        osc.frequency.value = midiToHz(this.layers === 2 ? layerAt(score, L as 0 | 1, v, offset).p : pitchAt(score, v, offset));
        const g = ctx.createGain();
        g.gain.value = 0;
        const pan = ctx.createStereoPanner();
        pan.pan.value = score.pan[v];
        osc.connect(g).connect(pan).connect(voiceOut);
        osc.start(when);
        this.oscs.push(osc);
        this.gains.push(g);
      }
    }
    if (a.sub > 0) {
      // Dry (no reverb, no tone filter): reverb on a sub is mud, and it kept the limiter clamped.
      const subBus = ctx.createGain();
      subBus.connect(master.direct);
      this.drySubs.push(subBus);
      let subOut: AudioNode = subBus;
      if (score.chop && score.config.chop.chords) {
        this.subChop = ctx.createGain();
        this.subChop.gain.value = chopAt(score, offset).level;
        this.subChop.connect(subOut);
        subOut = this.subChop;
      }
      if (score.config.motion.transition === 'pluck') {
        this.subArt = ctx.createGain();
        this.subArt.gain.value = articulationAt(score, offset);
        this.subArt.connect(subOut);
        subOut = this.subArt;
      }
      for (let L = 0; L < this.layers; L++) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        const p0 = this.layers === 2 ? layerAt(score, L as 0 | 1, 0, offset).p : pitchAt(score, 0, offset);
        osc.frequency.value = midiToHz(p0 - 12);
        const g = ctx.createGain();
        g.gain.value = 0;
        osc.connect(g).connect(subOut);
        osc.start(when);
        this.oscs.push(osc);
        this.subs.push({ osc, gain: g, layer: L as 0 | 1 });
      }
    }
    if (score.config.melody.enabled) {
      const osc = ctx.createOscillator();
      setWave(ctx, osc, score.config.melody.wave);
      osc.frequency.value = midiToHz(melodyAt(score, offset)?.p ?? score.startNote);
      const g = ctx.createGain();
      g.gain.value = 0;
      let leadOut: AudioNode = this.bus;
      if (score.chop && score.config.chop.melody) {
        this.leadChop = ctx.createGain();
        this.leadChop.gain.value = chopAt(score, offset, 'melody').level;
        this.leadChop.connect(this.bus);
        leadOut = this.leadChop;
      }
      osc.connect(g).connect(leadOut);
      osc.start(when);
      this.oscs.push(osc);
      this.lead = { osc, gain: g };
    }
    if (Number.isFinite(endAt)) {
      const stopAt = when + Math.max(0, endAt - offset) + 0.05;
      for (const o of this.oscs) o.stop(stopAt);
    }
  }

  /** Pluck tone: the filter opens fully on the strike and closes toward ~800 Hz as it decays. */
  private pluckCutoff(level: number): number {
    const top = Math.max(1500, this.score.config.audio.lowpass);
    return 800 * Math.pow(top / 800, Math.max(0, Math.min(1, level)));
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
    // Voices add up like independent sources (√V), not like one coherent wave (V): sizing every voice
    // for the worst case — the unison, all voices on one note — made ordinary chords ~7 dB too quiet.
    // Voices sharing a note now back off by 1/√(how many share it), so unisons don't spike either.
    const baseGain = (0.75 / Math.sqrt(V)) * WAVE_GAIN[cfg.audio.wave];
    const leadGain = 0.7 * cfg.melody.level * WAVE_GAIN[cfg.melody.wave];
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
      const wrap = (t: number) => (this.loopLen ? ((t % this.loopLen) + this.loopLen) % this.loopLen : t);
      // Pitches (and layer levels) of every voice first, so each voice can see who shares its note.
      const P = Array.from({ length: V * this.layers }, () => new Float32Array(n));
      const G = Array.from({ length: V * this.layers }, () => new Float32Array(n).fill(1));
      const chops = Array.from({ length: n }, (_, i) => chopAt(this.score, wrap(t0 + (i / (n - 1)) * CHUNK)));
      for (let idx = 0; idx < V * this.layers; idx++) {
        const v = idx % V;
        const L = (idx >= V ? 1 : 0) as 0 | 1;
        for (let i = 0; i < n; i++) {
          if (this.layers === 2) {
            const st = layerAt(this.score, L, v, chops[i].s);
            P[idx][i] = st.p;
            G[idx][i] = st.g;
          } else P[idx][i] = pitchAt(this.score, v, chops[i].s);
        }
      }
      for (let idx = 0; idx < V * this.layers; idx++) {
        const v = idx % V;
        const L = (idx >= V ? 1 : 0) as 0 | 1;
        const freq = new Float32Array(n);
        const gain = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const raw = t0 + (i / (n - 1)) * CHUNK;
          const tt = wrap(raw);
          // Chop remaps time (reverse, repeat, tape stop); the rate bends the pitch for tape stops.
          const ch = chops[i];
          const t = ch.s;
          const f = midiToHz(P[idx][i]) * ch.rate;
          const layerGain = G[idx][i];
          // How many voices (in this layer, weighted by level) share this note right now.
          let share = 0;
          for (let w = L * V; w < (L + 1) * V; w++) if (Math.abs(P[w][i] - P[idx][i]) < 0.35) share += G[w][i];
          const together = 1 / Math.sqrt(Math.max(1, share));
          freq[i] = f;
          let env = Math.min(1, raw / 0.05); // 50 ms fade-in at the very start
          if (this.offset > 0) env *= Math.min(1, (raw - this.offset) / 0.03); // de-click when starting mid-piece
          if (raw > fadeOutStart) env *= 0.5 * (1 + Math.cos(Math.PI * Math.min(1, (raw - fadeOutStart) / fadeLen)));
          // Song mode: soft parts sit lower, so the full parts lift.
          const lift = this.score.energy.length ? 0.68 + 0.32 * energyAt(this.score, tt) : 1;
          gain[i] = baseGain * together * Math.pow(f / 220, -cfg.audio.tilt) * Math.max(0, env) * swellAt(this.score, v, t) * layerGain * lift;
        }
        setCurve(this.oscs[idx].frequency, freq, at, dur);
        setCurve(this.gains[idx].gain, gain, at, dur);
      }
      for (const sub of this.subs) {
        const freq = new Float32Array(n);
        const gain = new Float32Array(n);
        // The Bass shelf no longer touches the sub (it runs dry), so it scales the sub directly.
        // A fixed level (the Sub slider means the same at any voice count).
        const subGain = cfg.audio.sub * 0.3 * Math.pow(10, cfg.audio.bass / 20);
        const d = cfg.drums;
        for (let i = 0; i < n; i++) {
          const raw = t0 + (i / (n - 1)) * CHUNK;
          const tt = wrap(raw);
          const ch = chopAt(this.score, tt);
          const t = ch.s;
          let p: number;
          let g = 1;
          if (this.layers === 2) {
            const st = layerAt(this.score, sub.layer, 0, t);
            p = st.p;
            g = st.g;
          } else p = pitchAt(this.score, 0, t);
          freq[i] = midiToHz(p - 12) * ch.rate;
          let env = Math.min(1, raw / 0.05);
          if (this.offset > 0) env *= Math.min(1, (raw - this.offset) / 0.03);
          if (raw > fadeOutStart) env *= 0.5 * (1 + Math.cos(Math.PI * Math.min(1, (raw - fadeOutStart) / fadeLen)));
          // In song mode the sub is what makes a full part hit: nearly gone in soft parts, opened up in full ones.
          const energy = this.score.energy.length ? 0.1 + 1.5 * energyAt(this.score, tt) : 1;
          // The sub gets out of the kick's way (and the snare's, if the chords duck under it).
          const duck = this.score.drums ? 1 - 0.85 * duckEnvelope(this.score, tt, true, d.duck.snare, Math.max(0.12, d.duck.release)) : 1;
          gain[i] = subGain * g * Math.max(0, env) * swellAt(this.score, 0, t) * energy * duck;
        }
        setCurve(sub.osc.frequency, freq, at, dur);
        setCurve(sub.gain.gain, gain, at, dur);
      }
      if (this.duck) {
        const m = Math.round(CHUNK * ARTIC_RATE) + 1;
        const curve = new Float32Array(m);
        for (let i = 0; i < m; i++) curve[i] = duckAt(this.score, wrap(t0 + (i / (m - 1)) * CHUNK));
        setCurve(this.duck.gain, curve, at, dur);
      }
      if (this.drumBus) {
        // Drum hits in this chunk (score time may wrap when looping).
        const cfgD = this.score.config.drums;
        const live = !(this.ctx instanceof OfflineAudioContext);
        const segs: [number, number, number][] = []; // [scoreFrom, scoreTo, rawOffset]
        if (this.loopLen) {
          const a0 = wrap(t0);
          const a1 = a0 + CHUNK;
          if (a1 <= this.loopLen) segs.push([a0, a1, t0 - a0]);
          else {
            segs.push([a0, this.loopLen, t0 - a0]);
            segs.push([0, a1 - this.loopLen, t0 - a0 + this.loopLen]);
          }
        } else segs.push([t0, t0 + CHUNK, 0]);
        for (const [a, b, rawOff] of segs) {
          for (const h of drumHits(this.score, a, b)) {
            const when = this.when + (h.t + rawOff - this.offset);
            if (live && when < this.ctx.currentTime + 0.005) continue;
            const send = cfgD.reverb > 0 && (!cfgD.reverbSnareOnly || h.voice === 'snare') ? this.drumSend : null;
            playHit(this.ctx, cfgD.kit, h, cfgD.levels[h.voice], this.drumBus, send, when);
          }
        }
      }
      if (this.art) {
        const m = Math.round(CHUNK * ARTIC_RATE) + 1;
        const curve = new Float32Array(m);
        const tone = new Float32Array(m);
        for (let i = 0; i < m; i++) {
          const level = articulationAt(this.score, chopAt(this.score, wrap(t0 + (i / (m - 1)) * CHUNK)).s);
          curve[i] = level * this.makeup;
          tone[i] = this.pluckCutoff(level);
        }
        setCurve(this.art.gain, curve, at, dur);
        if (this.pluckTone) setCurve(this.pluckTone.frequency, tone, at, dur);
        if (this.subArt) setCurve(this.subArt.gain, curve, at, dur);
      }
      if (this.chop) {
        const m = Math.round(CHUNK * ARTIC_RATE) + 1;
        const curve = new Float32Array(m);
        for (let i = 0; i < m; i++) curve[i] = chopAt(this.score, wrap(t0 + (i / (m - 1)) * CHUNK)).level;
        setCurve(this.chop.gain, curve, at, dur);
        if (this.subChop) setCurve(this.subChop.gain, curve, at, dur);
      }
      if (this.leadChop) {
        const m = Math.round(CHUNK * ARTIC_RATE) + 1;
        const curve = new Float32Array(m);
        for (let i = 0; i < m; i++) curve[i] = chopAt(this.score, wrap(t0 + (i / (m - 1)) * CHUNK), 'melody').level;
        setCurve(this.leadChop.gain, curve, at, dur);
      }
      if (this.lead) {
        const freq = new Float32Array(n);
        const gain = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const raw = t0 + (i / (n - 1)) * CHUNK;
          const ch = chopAt(this.score, wrap(raw), 'melody');
          const t = ch.s;
          const m = melodyAt(this.score, t);
          const f = midiToHz(m?.p ?? this.score.startNote) * ch.rate;
          freq[i] = f;
          let env = 1;
          if (this.offset > 0) env *= Math.min(1, (raw - this.offset) / 0.03);
          if (raw > fadeOutStart) env *= 0.5 * (1 + Math.cos(Math.PI * Math.min(1, (raw - fadeOutStart) / fadeLen)));
          gain[i] = leadGain * (m?.g ?? 0) * Math.pow(f / 440, -cfg.audio.tilt) * Math.max(0, env) * swellAt(this.score, -1, t);
        }
        setCurve(this.lead.osc.frequency, freq, at, dur);
        setCurve(this.lead.gain.gain, gain, at, dur);
      }
      this.nextChunk++;
    }
  }

  /** Fade the bank out, now or at context time `at` (a seamless hand-over to another bank). */
  stop(at?: number, fade = 0.04): void {
    if (this.stopped) return;
    this.stopped = true;
    const now = Math.max(this.ctx.currentTime, at ?? 0);
    // Fade the whole bank and then disconnect it. Cancelling per-voice automation
    // isn't reliable everywhere (Firefox can keep an in-progress curve going, and
    // may reject a second stop()), but a disconnected bus is always silent.
    for (const g of [this.bus, this.drumGate, this.drumSend, ...this.drySubs]) {
      if (!g) continue;
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + fade);
      } catch {
        /* ignore */
      }
    }
    for (const o of this.oscs) {
      try {
        o.stop(now + fade + 0.02);
      } catch {
        /* already stopped or stop already scheduled */
      }
    }
    setTimeout(() => {
      for (const n of [this.bus, this.drumGate, this.drumSend, ...this.drySubs]) {
        try {
          n?.disconnect();
        } catch {
          /* ignore */
        }
      }
    }, (now - this.ctx.currentTime + fade) * 1000 + 50);
  }
}

/** Render the piece (or the first `duration` seconds of an endless one) to an AudioBuffer. */
export async function renderOffline(score: Score, duration = score.timeline.end, sampleRate = 48000): Promise<AudioBuffer> {
  if (!Number.isFinite(duration)) throw new Error('Endless pieces need an explicit duration to render.');
  if (score.loop) {
    // A seamless loop: render two passes and keep the second, so the reverb
    // tail from the end is already sounding at the start.
    const L = score.timeline.end;
    const frames = Math.round(L * sampleRate);
    const ctx = new OfflineAudioContext(2, frames * 2, sampleRate);
    const master = createMaster(ctx, score, ctx.destination);
    const bank = new VoiceBank(ctx, score, master, 0, 0, Number.POSITIVE_INFINITY);
    bank.scheduleUntil(2 * L + 1);
    const both = await ctx.startRendering();
    const out = new AudioBuffer({ numberOfChannels: 2, length: frames, sampleRate });
    for (let ch = 0; ch < 2; ch++) out.copyToChannel(both.getChannelData(ch).subarray(frames, frames * 2), ch);
    return out;
  }
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
  private suspendTimer = 0;
  /** Listening volume (not part of the piece: exports and recordings ignore it). */
  private volumeNode: GainNode | null = null;
  private volume = 1;
  private analysers: AnalyserNode[] = [];
  private meterBuf: Float32Array<ArrayBuffer> | null = null;
  playing = false;

  /** Output stage that outlives individual master chains: volume → speakers, with level taps. */
  /** Small-speaker voicing (phones): cut the low end they can't play, tame the top, keep headroom. */
  private smallSpeaker = false;
  private speakerNodes: { hp: BiquadFilterNode; low: BiquadFilterNode; high: BiquadFilterNode; comp: DynamicsCompressorNode; trim: GainNode } | null = null;

  setSmallSpeaker(on: boolean) {
    this.smallSpeaker = on;
    this.applySpeaker();
  }

  private applySpeaker() {
    const n = this.speakerNodes;
    if (!n) return;
    const on = this.smallSpeaker;
    // A phone speaker can't reproduce much below ~150 Hz; asking it to just makes it crackle.
    n.hp.frequency.value = on ? 140 : 10;
    n.low.gain.value = on ? -3 : 0; // the boxy 200–300 Hz region
    n.high.gain.value = on ? -2.5 : 0; // harshness up top
    n.comp.threshold.value = on ? -14 : 0;
    n.comp.ratio.value = on ? 3 : 1;
    n.trim.gain.value = on ? 0.85 : 1;
  }

  private outputStage(ctx: AudioContext): GainNode {
    if (!this.volumeNode) {
      this.volumeNode = ctx.createGain();
      this.volumeNode.gain.value = this.volume;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.Q.value = 0.7;
      const low = ctx.createBiquadFilter();
      low.type = 'peaking';
      low.frequency.value = 250;
      low.Q.value = 1;
      const high = ctx.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = 7000;
      const comp = ctx.createDynamicsCompressor();
      comp.knee.value = 8;
      comp.attack.value = 0.005;
      comp.release.value = 0.2;
      const trim = ctx.createGain();
      this.volumeNode.connect(hp).connect(low).connect(high).connect(comp).connect(trim).connect(ctx.destination);
      this.speakerNodes = { hp, low, high, comp, trim };
      this.applySpeaker();
      const split = ctx.createChannelSplitter(2);
      trim.connect(split);
      this.analysers = [0, 1].map((ch) => {
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        split.connect(an, ch);
        return an;
      });
      this.meterBuf = new Float32Array(1024);
    }
    return this.volumeNode;
  }

  /** Set listening volume, 0..1 (perceptual: squared to gain). */
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v)) ** 2;
    if (this.volumeNode && this.ctx) this.volumeNode.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  /** Current output level per channel: peak and RMS in dBFS (−Infinity when silent or stopped). */
  levels(): { peak: number; rms: number }[] {
    if (!this.ctx || !this.meterBuf || this.ctx.state !== 'running') return [{ peak: -Infinity, rms: -Infinity }, { peak: -Infinity, rms: -Infinity }];
    const buf = this.meterBuf;
    return this.analysers.map((an) => {
      an.getFloatTimeDomainData(buf);
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const a = Math.abs(buf[i]);
        if (a > peak) peak = a;
        sum += buf[i] * buf[i];
      }
      const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
      return { peak: db(peak), rms: db(Math.sqrt(sum / buf.length)) };
    });
  }

  private ensure(score: Score): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: 'playback' });
    if (!this.master || this.masterScore !== score) {
      this.master?.output.disconnect();
      this.master = createMaster(this.ctx, score, this.outputStage(this.ctx));
      if (this.recordTap) this.master.output.connect(this.recordTap);
      this.masterScore = score;
    }
    return this.ctx;
  }

  /** Context time at which a hand-over to the next bank takes effect (see chain), or null. */
  private pendingStart: number | null = null;
  private switched = false;

  /**
   * Continue seamlessly into another score at the context time of `rawTime` (a loop boundary of the
   * current playback): the new score starts from 0 there, through the same master chain, while the
   * current bank fades out over 50 ms. time() keeps the old clock until then.
   */
  chain(score: Score, rawTime: number): boolean {
    if (!this.ctx || !this.master || !this.playing) return false;
    const at = this.startedAt + (rawTime - this.startOffset);
    if (at < this.ctx.currentTime + 0.05) return false;
    clearInterval(this.timer);
    if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility);
    this.bank?.stop(at, 0.05);
    const ctx = this.ctx;
    const bank = new VoiceBank(ctx, score, this.master, at, 0, score.timeline.musicEnd);
    this.bank = bank;
    this.pendingStart = at;
    const pump = () => bank.scheduleUntil(Math.max(0, ctx.currentTime - at) + (document.hidden ? 12 : 3));
    pump();
    this.timer = window.setInterval(pump, 200);
    this.onVisibility = pump;
    document.addEventListener('visibilitychange', pump);
    return true;
  }

  /** True once after a chained score has taken over. */
  takeSwitch(): boolean {
    this.time();
    const s = this.switched;
    this.switched = false;
    return s;
  }

  async play(score: Score, offset: number): Promise<void> {
    clearTimeout(this.suspendTimer);
    this.pendingStart = null;
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
    this.pendingStart = null;
    this.stopBank();
    this.playing = false;
    this.startOffset = t;
    // Pause means quiet: fade out the reverb tail too, drop that master chain
    // (the next play starts with a fresh one), and suspend audio processing to
    // save battery. Recording keeps its tap on whichever master is current.
    const ctx = this.ctx;
    const master = this.master;
    if (ctx && master && !this.recordTap) {
      const out = master.output as GainNode;
      try {
        out.gain.cancelScheduledValues(ctx.currentTime);
        out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
        out.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
      } catch {
        /* ignore */
      }
      this.master = null;
      this.masterScore = null;
      setTimeout(() => {
        try {
          out.disconnect();
        } catch {
          /* ignore */
        }
      }, 160);
      this.suspendTimer = window.setTimeout(() => {
        if (!this.playing && ctx.state === 'running') void ctx.suspend();
      }, 220);
    }
    return t;
  }

  /** Current score time. */
  time(): number {
    if (!this.playing || !this.ctx) return this.startOffset;
    if (this.pendingStart !== null && this.ctx.currentTime >= this.pendingStart) {
      this.startedAt = this.pendingStart;
      this.startOffset = 0;
      this.pendingStart = null;
      this.switched = true;
    }
    return this.startOffset + Math.max(0, this.ctx.currentTime - this.startedAt);
  }

  /** Play a chord voicing once, for auditioning palette chords. */
  async audition(score: Score, notes: number[], seconds = 1.8): Promise<void> {
    clearTimeout(this.suspendTimer);
    const ctx = this.ensure(score);
    if (ctx.state === 'suspended') await ctx.resume();
    const now = ctx.currentTime + 0.02;
    const a = score.config.audio;
    notes.forEach((n, v) => {
      const f = midiToHz(n);
      const osc = ctx.createOscillator();
      setWave(ctx, osc, a.wave);
      osc.frequency.value = f;
      osc.detune.value = score.detune[v % score.detune.length] ?? 0;
      const g = ctx.createGain();
      const peak = (0.7 / Math.sqrt(notes.length)) * Math.pow(f / 220, -a.tilt) * WAVE_GAIN[a.wave];
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
