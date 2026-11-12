/**
 * In-browser video export that doesn't depend on playback: every frame is drawn off-screen at
 * t = frame / fps, handed to the WebCodecs encoder, and muxed into an MP4 with audio rendered
 * offline from the same score. It takes as long as it takes, so a slow device gives a smooth
 * video, only later, instead of a choppy one.
 */
import { Muxer, StreamTarget } from 'mp4-muxer';

export interface VideoJob {
  width: number;
  height: number;
  fps: number;
  frames: number;
  /** Target video bitrate in bits per second (variable bitrate). */
  bitrate: number;
  audio: AudioBuffer;
  /** Draw frame n and return the canvas holding it. */
  draw: (n: number) => HTMLCanvasElement | OffscreenCanvas;
  onProgress?: (done: number, total: number) => void;
  cancelled?: () => boolean;
}

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
  }
}

/** Whether this browser has the encoders an offline export needs (audio is checked when picking a codec). */
export const canExportVideo = () =>
  typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined';

type VideoCodec = 'avc' | 'hevc' | 'vp9' | 'av1';

/** The first video codec this device can encode at this size: H.264 first (plays everywhere). */
async function pickVideo(width: number, height: number, fps: number, bitrate: number): Promise<{ codec: VideoCodec; config: VideoEncoderConfig } | null> {
  const tries: [VideoCodec, string][] = [
    ['avc', 'avc1.640033'], // High 5.1
    ['avc', 'avc1.4d0033'], // Main 5.1
    ['avc', 'avc1.42e033'], // Baseline 5.1
    ['avc', 'avc1.64002a'], // High 4.2
    ['avc', 'avc1.42e02a'],
    ['hevc', 'hvc1.1.6.L153.B0'],
    ['vp9', 'vp09.00.51.08'],
    ['av1', 'av01.0.12M.08'],
  ];
  for (const [codec, string] of tries) {
    const config: VideoEncoderConfig = {
      codec: string,
      width,
      height,
      bitrate,
      framerate: fps,
      bitrateMode: 'variable',
      latencyMode: 'quality',
      ...(codec === 'avc' ? { avc: { format: 'avc' as const } } : {}),
    };
    try {
      const r = await VideoEncoder.isConfigSupported(config);
      if (r.supported) return { codec, config: r.config ?? config };
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/** AAC if the device has it (plays everywhere), otherwise Opus. */
export async function pickAudio(sampleRate: number, channels: number): Promise<{ codec: 'aac' | 'opus'; config: AudioEncoderConfig } | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  const tries: ['aac' | 'opus', AudioEncoderConfig][] = [
    ['aac', { codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate: 192_000 }],
    ['opus', { codec: 'opus', sampleRate, numberOfChannels: channels, bitrate: 160_000 }],
  ];
  for (const [codec, config] of tries) {
    try {
      const r = await AudioEncoder.isConfigSupported(config);
      if (r.supported) return { codec, config: r.config ?? config };
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/** Hand control back to the page briefly (not throttled like setTimeout in a background tab). */
const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const yieldToPage = () =>
  new Promise<void>((resolve) => {
    if (!channel) return void setTimeout(resolve, 0);
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });

/**
 * Collects what the muxer writes. Nearly everything is appended; the few writes that go back
 * (box sizes patched at the end) land inside a piece already kept and are copied into it.
 * Pieces stay separate until the final Blob, so a long video never needs one huge buffer.
 */
class Pieces {
  parts: { pos: number; data: Uint8Array }[] = [];
  end = 0;
  write(data: Uint8Array, pos: number) {
    if (pos >= this.end) {
      this.parts.push({ pos, data: data.slice() });
      this.end = pos + data.length;
      return;
    }
    let off = 0;
    for (const p of this.parts) {
      const a = Math.max(pos + off, p.pos);
      const b = Math.min(pos + data.length, p.pos + p.data.length);
      if (a < b) p.data.set(data.subarray(a - pos, b - pos), a - p.pos);
    }
    if (pos + data.length > this.end) {
      off = this.end - pos;
      this.parts.push({ pos: this.end, data: data.slice(off) });
      this.end = pos + data.length;
    }
  }
  blob(type: string) {
    return new Blob(this.parts.map((p) => p.data as BlobPart), { type });
  }
}

export async function exportVideo(job: VideoJob): Promise<{ blob: Blob; codec: string; audioCodec: string }> {
  const { width, height, fps, frames, audio } = job;
  const video = await pickVideo(width, height, fps, job.bitrate);
  if (!video) throw new Error(`this device can't encode ${width}×${height} video`);
  const aud = await pickAudio(audio.sampleRate, audio.numberOfChannels);
  if (!aud) throw new Error("this device can't encode audio");

  const out = new Pieces();
  const muxer = new Muxer({
    target: new StreamTarget({ onData: (data, pos) => out.write(data, pos) }),
    video: { codec: video.codec, width, height, frameRate: fps },
    audio: { codec: aud.codec, numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate },
    fastStart: false,
    firstTimestampBehavior: 'offset',
  });
  let failure: Error | null = null;
  const fail = (e: DOMException) => (failure ??= e);

  // Audio first: it's quick, and the muxer interleaves it with the video as frames arrive.
  const ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: fail });
  ae.configure(aud.config);
  const ch = audio.numberOfChannels;
  const sr = audio.sampleRate;
  const block = 4800;
  const chans = Array.from({ length: ch }, (_, c) => audio.getChannelData(c));
  for (let off = 0; off < audio.length; off += block) {
    const n = Math.min(block, audio.length - off);
    const data = new Float32Array(n * ch);
    for (let c = 0; c < ch; c++) data.set(chans[c].subarray(off, off + n), c * n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round((off / sr) * 1e6), data });
    ae.encode(ad);
    ad.close();
  }
  await ae.flush();
  ae.close();

  const ve = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: fail });
  ve.configure(video.config);
  const keyEvery = Math.max(1, Math.round(fps * 2));
  let lastYield = performance.now();
  try {
    for (let i = 0; i < frames; i++) {
      if (failure) throw failure;
      if (job.cancelled?.()) throw new ExportCancelled();
      const src = job.draw(i);
      const frame = new VideoFrame(src, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      ve.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      // Don't run ahead of the encoder (frames waiting in its queue are full-size images).
      while (ve.encodeQueueSize > 4 && !failure) await yieldToPage();
      if (performance.now() - lastYield > 40) {
        job.onProgress?.(i + 1, frames);
        await yieldToPage();
        lastYield = performance.now();
      }
    }
    await ve.flush();
    if (failure) throw failure;
  } finally {
    if (ve.state !== 'closed') ve.close();
  }
  muxer.finalize();
  job.onProgress?.(frames, frames);
  return { blob: out.blob('video/mp4'), codec: video.config.codec, audioCodec: aud.config.codec };
}
