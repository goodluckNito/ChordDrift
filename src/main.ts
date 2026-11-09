import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/700.css';
import './style.css';
import { LivePlayer, encodeWav, renderOffline } from './audio/synth';
import {
  DEFAULT_CONFIG,
  KEY_NAMES,
  formatSeed,
  generateScore,
  noteName,
  randomSeed,
  type ChordDriftConfig,
  type DeepPartial,
  type Score,
} from './engine';
import { frameCount, renderFrame } from './render/renderer';

const fontsReady = (async () => {
  try {
    await Promise.all(['400', '500', '700'].map((w) => document.fonts.load(`${w} 32px Inter`)));
  } catch {
    /* fall back to system fonts */
  }
})();

// ---------------------------------------------------------------------------
// Headless API used by scripts/export.ts (deterministic frame-by-frame export).
// ---------------------------------------------------------------------------
let exportScore: Score | null = null;
let exportCanvas: HTMLCanvasElement | null = null;

const api = {
  ready: fontsReady,
  load(partial: DeepPartial<ChordDriftConfig>) {
    exportScore = generateScore(partial);
    const { width, height, fps } = exportScore.config.video;
    exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    return {
      frames: frameCount(exportScore),
      fps,
      width,
      height,
      duration: exportScore.timeline.end,
      seed: exportScore.seedLabel,
      key: exportScore.keyName,
      chords: exportScore.chords.map((c) => c.name),
    };
  },
  frame(n: number, type: 'image/png' | 'image/jpeg' = 'image/png', quality = 0.95): string {
    if (!exportScore || !exportCanvas) throw new Error('call load() first');
    const ctx = exportCanvas.getContext('2d')!;
    renderFrame(ctx, exportScore, n / exportScore.config.video.fps, { frame: n });
    return exportCanvas.toDataURL(type, quality).split(',')[1];
  },
  async wav(): Promise<string> {
    if (!exportScore) throw new Error('call load() first');
    const bytes = new Uint8Array(encodeWav(await renderOffline(exportScore)));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  },
};
(window as unknown as { chordDrift: typeof api }).chordDrift = api;

const isExport = new URLSearchParams(location.search).has('export');
if (!isExport) startApp();

// ---------------------------------------------------------------------------
// Interactive player
// ---------------------------------------------------------------------------
function startApp() {
  const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
  const form = $<HTMLFormElement>('#controls');
  const canvas = $<HTMLCanvasElement>('#view');
  const ctx = canvas.getContext('2d')!;
  const playBtn = $<HTMLButtonElement>('#play');
  const scrub = $<HTMLInputElement>('#scrub');
  const clock = $<HTMLSpanElement>('#clock');
  const status = $<HTMLParagraphElement>('#status');
  const list = $<HTMLOListElement>('#score-list');
  const field = <T extends HTMLInputElement | HTMLSelectElement>(name: string) => form.elements.namedItem(name) as T;

  const keySelect = field<HTMLSelectElement>('key');
  keySelect.innerHTML = `<option value="auto">Auto (seeded)</option>` + KEY_NAMES.map((k) => `<option>${k}</option>`).join('');

  const player = new LivePlayer();
  let score: Score;
  let pausedAt = 0;
  let recording: { recorder: MediaRecorder; canvas: HTMLCanvasElement } | null = null;

  // ---- Config <-> form <-> URL ----------------------------------------------
  const HASH_FIELDS = ['seed', 'mode', 'key', 'driftProbability', 'smoothness', 'chordMin', 'chordMax', 'voices', 'easing', 'hold', 'glide', 'stagger', 'bloom', 'wave', 'reverb', 'detuneCents', 'series', 'episode', 'title'];

  function formValues(c: ChordDriftConfig): Record<string, string | number> {
    return {
      seed: typeof c.seed === 'number' ? formatSeed(c.seed) : c.seed,
      mode: c.mode,
      key: c.key,
      driftProbability: c.driftProbability,
      smoothness: c.smoothness,
      chordMin: c.chordCount[0],
      chordMax: c.chordCount[1],
      voices: c.voices,
      easing: c.motion.easing,
      hold: c.timing.hold,
      glide: c.timing.glide,
      stagger: c.timing.stagger,
      bloom: c.timing.bloom,
      wave: c.audio.wave,
      reverb: c.audio.reverb,
      detuneCents: c.audio.detuneCents,
      series: c.series,
      episode: c.episode,
      title: c.title,
    };
  }

  function readForm(): DeepPartial<ChordDriftConfig> {
    const v = (n: string) => field(n).value;
    const num = (n: string) => Number(v(n));
    return {
      seed: v('seed').trim() || DEFAULT_CONFIG.seed,
      mode: v('mode') as ChordDriftConfig['mode'],
      key: v('key'),
      driftProbability: num('driftProbability'),
      smoothness: num('smoothness'),
      chordCount: [num('chordMin') || 1, num('chordMax') || 1],
      voices: num('voices') || DEFAULT_CONFIG.voices,
      motion: { easing: v('easing') as ChordDriftConfig['motion']['easing'] },
      timing: { hold: num('hold'), glide: num('glide'), stagger: num('stagger'), bloom: num('bloom') },
      audio: { wave: v('wave') as ChordDriftConfig['audio']['wave'], reverb: num('reverb'), detuneCents: num('detuneCents') },
      series: v('series'),
      episode: num('episode'),
      title: v('title'),
    };
  }

  function writeForm(values: Record<string, string | number>) {
    for (const [k, val] of Object.entries(values)) {
      const el = field(k);
      if (el) el.value = String(val);
    }
    syncOutputs();
  }

  function syncOutputs() {
    for (const out of form.querySelectorAll('output')) {
      const input = out.parentElement!.querySelector('input')!;
      out.textContent = input.value;
    }
    const drift = form.querySelector<HTMLElement>('[data-show="drift"]')!;
    drift.hidden = field('mode').value !== 'drift';
  }

  function saveHash() {
    const params = new URLSearchParams();
    const defaults = formValues(DEFAULT_CONFIG);
    for (const k of HASH_FIELDS) {
      const val = field(k).value;
      if (String(defaults[k]) !== val) params.set(k, val);
    }
    history.replaceState(null, '', params.size ? `#${params}` : location.pathname + location.search);
  }

  function loadHash() {
    const values = formValues(DEFAULT_CONFIG);
    const params = new URLSearchParams(location.hash.slice(1));
    for (const k of HASH_FIELDS) if (params.has(k)) values[k] = params.get(k)!;
    writeForm(values);
  }

  // ---- Score ----------------------------------------------------------------
  function rebuild(keepTime: boolean) {
    const wasPlaying = player.playing;
    const t = keepTime ? currentTime() : 0;
    if (wasPlaying) player.pause();
    try {
      score = generateScore(readForm());
      status.textContent = '';
    } catch (e) {
      status.textContent = String((e as Error).message ?? e);
      return;
    }
    pausedAt = Math.min(t, score.timeline.end);
    scrub.max = String(score.timeline.end);
    renderList();
    saveHash();
    if (wasPlaying) void player.play(score, pausedAt);
  }

  function renderList() {
    const s = score;
    $('#score-meta').textContent = `· ${s.config.mode}, key of ${s.keyName}, ${s.chords.length} chords`;
    const rows = [
      `<li data-t="0"><span class="mono muted">0:00.0</span><span class="name">unison</span><span class="muted">${noteName(s.startNote, s.keyPc)}</span></li>`,
      ...s.chords.map(
        (c) =>
          `<li data-t="${c.t}"><span class="mono muted">${fmt(c.t, 1)}</span><span class="name">${c.name}</span><span class="muted">${c.roman}${c.origin !== 'diatonic' && c.origin !== 'cadence' ? ' · ' + c.origin : ''}</span><span class="notes mono muted">${c.notes.map((n) => noteName(n, c.keyPc)).join(' ')}</span></li>`,
      ),
      `<li data-t="${s.timeline.arrivalStart}"><span class="mono muted">${fmt(s.timeline.arrivalStart, 1)}</span><span class="name">arrival</span><span class="muted">→ ${noteName(s.endNote, s.finalKeyPc)}</span></li>`,
    ];
    list.innerHTML = rows.join('');
  }

  const fmt = (t: number, digits = 2) => {
    const m = Math.floor(t / 60);
    return `${m}:${(t - m * 60).toFixed(digits).padStart(digits + 3, '0')}`;
  };

  // ---- Transport ------------------------------------------------------------
  const currentTime = () => (player.playing ? player.time() : pausedAt);

  async function play() {
    if (pausedAt >= score.timeline.end - 0.01) pausedAt = 0;
    await player.play(score, pausedAt);
    playBtn.textContent = '❚❚';
    playBtn.setAttribute('aria-label', 'Pause');
  }
  function pause() {
    pausedAt = player.pause();
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-label', 'Play');
  }
  function seek(t: number) {
    pausedAt = Math.max(0, Math.min(score.timeline.end, t));
    if (player.playing) void player.play(score, pausedAt);
  }

  playBtn.addEventListener('click', () => (player.playing ? pause() : void play()));
  $('#restart').addEventListener('click', () => seek(0));
  scrub.addEventListener('input', () => seek(Number(scrub.value)));
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest('li');
    if (li) seek(Number(li.dataset.t) + 0.001);
  });

  // ---- Form events ----------------------------------------------------------
  let debounce = 0;
  form.addEventListener('input', (e) => {
    syncOutputs();
    const name = (e.target as HTMLInputElement).name;
    const structural = !['series', 'episode', 'title'].includes(name);
    clearTimeout(debounce);
    debounce = window.setTimeout(() => rebuild(!structural || name !== 'seed'), 180);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  $('#dice').addEventListener('click', () => {
    field('seed').value = formatSeed(randomSeed());
    rebuild(false);
  });

  // ---- Exports ----------------------------------------------------------------
  const download = (blob: Blob, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };
  const baseName = () => `chord-drift-${score.seedLabel}`;

  $<HTMLButtonElement>('#wav').addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    status.textContent = 'Rendering audio…';
    try {
      const buf = await renderOffline(score);
      download(new Blob([encodeWav(buf)], { type: 'audio/wav' }), `${baseName()}.wav`);
      status.textContent = `Saved ${baseName()}.wav (${buf.duration.toFixed(1)} s)`;
    } catch (err) {
      status.textContent = `Audio export failed: ${(err as Error).message}`;
    } finally {
      btn.disabled = false;
    }
  });

  $('#png').addEventListener('click', () => {
    const c = document.createElement('canvas');
    c.width = score.config.video.width;
    c.height = score.config.video.height;
    const t = currentTime();
    renderFrame(c.getContext('2d')!, score, t);
    c.toBlob((b) => b && download(b, `${baseName()}-${String(Math.round(t * score.config.video.fps)).padStart(5, '0')}.png`), 'image/png');
  });

  $('#json').addEventListener('click', async () => {
    const json = JSON.stringify({ ...score.config, seed: score.seedLabel }, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      status.textContent = 'Config copied — use it with npm run export -- --config file.json';
    } catch {
      download(new Blob([json], { type: 'application/json' }), `${baseName()}.json`);
    }
  });

  const recordBtn = $<HTMLButtonElement>('#record');
  recordBtn.addEventListener('click', async () => {
    if (recording) {
      recording.recorder.stop();
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      status.textContent = 'This browser cannot record video; use npm run export instead.';
      return;
    }
    const rc = document.createElement('canvas');
    rc.width = score.config.video.width;
    rc.height = score.config.video.height;
    const stream = rc.captureStream(score.config.video.fps);
    for (const tr of player.recordStream(score).getAudioTracks()) stream.addTrack(tr);
    const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
    recorder.onstop = () => {
      const type = recorder.mimeType || 'video/webm';
      download(new Blob(chunks, { type }), `${baseName()}.${type.includes('mp4') ? 'mp4' : 'webm'}`);
      recording = null;
      recordBtn.textContent = 'Record video';
      status.textContent = 'Recording saved. For frame-exact 60 fps video use npm run export.';
      pause();
    };
    recording = { recorder, canvas: rc };
    recordBtn.textContent = 'Stop recording';
    status.textContent = 'Recording in real time…';
    pausedAt = 0;
    recorder.start(250);
    await play();
  });

  // ---- Keyboard -----------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (player.playing) pause();
      else void play();
    } else if (e.key === 'r' || e.key === 'R') {
      $<HTMLButtonElement>('#dice').click();
    } else if (e.key === 'ArrowLeft') seek(currentTime() - 2);
    else if (e.key === 'ArrowRight') seek(currentTime() + 2);
  });

  // ---- Render loop -----------------------------------------------------------------
  function resizeCanvas() {
    const { width: vw, height: vh } = score.config.video;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const h = Math.round(Math.min(rect.height || 640, (rect.width || 360) * (vh / vw)) * dpr);
    const w = Math.round((h * vw) / vh);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  let lastListIndex = -2;
  function tick() {
    let t = currentTime();
    if (player.playing && t >= score.timeline.end) {
      if (recording) recording.recorder.stop();
      else pause();
      pausedAt = score.timeline.end;
      t = pausedAt;
    }
    resizeCanvas();
    renderFrame(ctx, score, t);
    if (recording) renderFrame(recording.canvas.getContext('2d')!, score, t);
    if (document.activeElement !== scrub) scrub.value = String(t);
    clock.textContent = `${fmt(t)} / ${fmt(score.timeline.end)}`;

    let idx = -1;
    score.chords.forEach((c, i) => c.t <= t && (idx = i));
    const arrival = t >= score.timeline.arrivalStart;
    const li = arrival ? list.children.length - 1 : idx + 1;
    if (li !== lastListIndex) {
      [...list.children].forEach((el, i) => el.classList.toggle('current', i === li));
      lastListIndex = li;
    }
    requestAnimationFrame(tick);
  }

  loadHash();
  rebuild(false);
  void fontsReady.then(() => requestAnimationFrame(tick));
}
