import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/700.css';
import './style.css';
import { LivePlayer, encodeWav, renderOffline } from './audio/synth';
import {
  KEY_NAMES,
  SCALES,
  chordIndexAt,
  chordToToken,
  formatSeed,
  generateScore,
  pitchesAt,
  randomSeed,
  resolveConfig,
  scaleChords,
  spellNote,
  typicalSize,
  voiceChord,
  voicingRules,
  type ChordDriftConfig,
  type DeepPartial,
  type Score,
} from './engine';
import { frameCount, renderFrame } from './render/renderer';
import { decodeShare, encodeShare, exportProject, listProjects, parseProject, saveProject, deleteProject } from './project';

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
let exportDuration = 0;

const api = {
  ready: fontsReady,
  /** Load a config. Endless pieces need a duration (default 60 s). */
  load(partial: DeepPartial<ChordDriftConfig>, duration?: number) {
    exportScore = generateScore(partial);
    exportDuration = exportScore.endless ? duration ?? 60 : duration ?? exportScore.timeline.end;
    exportScore.extend(exportDuration);
    const { width, height, fps } = exportScore.config.video;
    exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    return {
      frames: frameCount(exportScore, exportDuration),
      fps,
      width,
      height,
      duration: exportDuration,
      seed: exportScore.seedLabel,
      key: `${exportScore.keyName} ${exportScore.scaleName}`,
      chords: exportScore.chords.filter((c) => c.t < exportDuration).map((c) => c.name),
      errors: exportScore.errors,
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
    const bytes = new Uint8Array(encodeWav(await renderOffline(exportScore, exportDuration)));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  },
};
(window as unknown as { chordDrift: typeof api }).chordDrift = api;


// ---------------------------------------------------------------------------
// Interactive player
// ---------------------------------------------------------------------------
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const COMPLEXITY_NAMES = ['', 'triads', 'sevenths', 'ninths & elevenths', 'elevenths & thirteenths', '13ths & altered'];

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}
function setPath(obj: unknown, path: string, value: unknown) {
  const keys = path.split('.');
  let o = obj as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
}

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
  const fields = [...form.querySelectorAll<Field>('[data-path]')];

  // Populate selects.
  const keySelect = $<HTMLSelectElement>('#key');
  keySelect.innerHTML = `<option value="auto">Auto (seeded)</option>` + KEY_NAMES.map((k) => `<option>${k}</option>`).join('');
  const scaleSelect = $<HTMLSelectElement>('#scale');
  const families = new Map<string, string[]>();
  for (const [id, def] of Object.entries(SCALES)) families.set(def.family, [...(families.get(def.family) ?? []), id]);
  scaleSelect.innerHTML = [...families]
    .map(([fam, ids]) => `<optgroup label="${fam}">${ids.map((id) => `<option value="${id}">${SCALES[id].name}</option>`).join('')}</optgroup>`)
    .join('');

  const player = new LivePlayer();
  let state: ChordDriftConfig = resolveConfig();
  let score: Score;
  let pausedAt = 0;
  let recording: { recorder: MediaRecorder; canvas: HTMLCanvasElement } | null = null;

  const setStatus = (msg: string) => (status.textContent = msg);

  // ---- State <-> form ----------------------------------------------------------
  function writeForm() {
    for (const el of fields) {
      const v = getPath(state, el.dataset.path!);
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(v);
      else el.value = typeof v === 'number' && el.dataset.path === 'seed' ? formatSeed(v) : String(v ?? '');
    }
    syncVisibility();
  }

  function readField(el: Field) {
    const path = el.dataset.path!;
    let value: unknown;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') value = el.checked;
    else if (el instanceof HTMLInputElement && (el.type === 'number' || el.type === 'range')) value = Number(el.value);
    else value = el.value;
    setPath(state, path, value);
  }

  function syncVisibility() {
    for (const out of form.querySelectorAll('output:not([id])')) {
      const input = out.parentElement!.querySelector('input')!;
      out.textContent = input.value;
    }
    $('#complexity-label').textContent = `${state.complexity} · ${COMPLEXITY_NAMES[state.complexity]}`;
    const written = state.progression.trim().length > 0;
    for (const el of form.querySelectorAll<HTMLElement>('[data-show]')) el.hidden = state.mode !== el.dataset.show;
    for (const el of form.querySelectorAll<HTMLElement>('[data-hide]')) {
      const conds = el.dataset.hide!.split(' ');
      el.hidden = (conds.includes('endless') && state.endless) || (conds.includes('written') && written);
    }
  }

  // ---- Score ------------------------------------------------------------------
  function rebuild(keepTime: boolean) {
    const wasPlaying = player.playing;
    const t = keepTime ? currentTime() : 0;
    if (wasPlaying) player.pause();
    try {
      score = generateScore(state);
    } catch (e) {
      setStatus(String((e as Error).message ?? e));
      return;
    }
    $('#prog-errors').textContent = score.errors.join(' · ');
    pausedAt = Number.isFinite(score.timeline.end) ? Math.min(t, score.timeline.end) : t;
    score.extend(pausedAt);
    keySelect.options[0].textContent = state.key === 'auto' ? `Auto (${score.keyName})` : 'Auto (seeded)';
    renderedRows = 0;
    list.innerHTML = '';
    renderList();
    renderPalette();
    saveHash();
    if (wasPlaying) void player.play(score, pausedAt);
  }

  const fmt = (t: number, digits = 2) => {
    const m = Math.floor(t / 60);
    return `${m}:${(t - m * 60).toFixed(digits).padStart(digits + 3, '0')}`;
  };

  // Rows are appended incrementally so endless pieces stay cheap.
  let renderedRows = 0;
  const MAX_ROWS = 300;
  function row(t: number, name: string, meta: string, notes = '') {
    const li = document.createElement('li');
    li.dataset.t = String(t);
    li.innerHTML = `<span class="mono muted">${fmt(t, 1)}</span><span class="name"></span><span class="muted"></span>${notes ? '<span class="notes mono muted"></span>' : ''}`;
    li.children[1].textContent = name;
    li.children[2].textContent = meta;
    if (notes) li.children[3].textContent = notes;
    return li;
  }
  function renderList() {
    const s = score;
    $('#score-meta').textContent = `· ${s.keyName} ${s.scaleName}${s.endless ? ', endless' : `, ${s.chords.length} chords`}`;
    if (renderedRows === 0) list.append(row(0, 'unison', spellNote(s.startNote, s.keyPc, s.config.scale)));
    for (let i = Math.max(0, renderedRows - 1); i < s.chords.length; i++) {
      const c = s.chords[i];
      const origin = c.origin === 'scale' || c.origin === 'cadence' || c.origin === 'written' ? '' : ` · ${c.origin}`;
      list.append(row(c.t, c.name, c.roman + origin, c.notes.map((n) => spellNote(n, c.tonic, c.scale)).join(' ')));
    }
    renderedRows = s.chords.length + 1;
    if (!s.endless) {
      list.append(row(s.timeline.arrivalStart, 'arrival', `→ ${spellNote(s.endNote, s.finalKeyPc, s.config.scale)}`));
    }
    while (list.children.length > MAX_ROWS) list.firstElementChild!.remove();
  }

  // ---- Chord palette ------------------------------------------------------------
  function renderPalette() {
    const palette = $('#palette');
    const size = typicalSize(state.complexity);
    const chords = scaleChords(score.keyPc, state.scale, size);
    $('#palette-caption').textContent = `${score.keyName} ${SCALES[state.scale].name}, ${COMPLEXITY_NAMES[state.complexity]}. Click to hear and add it to the progression.`;
    palette.innerHTML = '';
    for (const c of chords) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.innerHTML = '<b></b><span></span>';
      b.children[0].textContent = c.roman;
      b.children[1].textContent = c.name;
      b.title = `Add ${chordToToken(c, score.keyPc)}`;
      b.addEventListener('click', () => {
        appendToken(chordToToken(c, score.keyPc));
        const ref = pitchesAt(score, currentTime()).map(Math.round);
        void player.audition(score, voiceChord(c, ref, voicingRules(score.config), null));
      });
      palette.append(b);
    }
    const w = document.createElement('button');
    w.type = 'button';
    w.className = 'chip wild';
    w.textContent = '?';
    w.title = 'Add a generated chord';
    w.addEventListener('click', () => appendToken('?'));
    palette.append(w);
  }

  function appendToken(token: string) {
    const ta = form.querySelector<HTMLTextAreaElement>('[data-path="progression"]')!;
    ta.value = (ta.value.trim() + ' ' + token).trim();
    readField(ta);
    syncVisibility();
    rebuild(true);
  }

  $('#freeze').addEventListener('click', () => {
    const upTo = score.endless ? score.chords.filter((c) => c.t <= Math.max(currentTime(), 1) + 0.01) : score.chords;
    const tokens = (upTo.length ? upTo : score.chords.slice(0, 8)).map((c) => chordToToken(c, score.keyPc));
    if (state.key === 'auto') state.key = score.keyName; // pin the key so the numerals mean the same chords
    state.progression = tokens.join(' ');
    writeForm();
    rebuild(true);
    setStatus(`Froze ${tokens.length} chords. Edit any of them, or replace some with "?".`);
  });
  $('#clear-prog').addEventListener('click', () => {
    state.progression = '';
    writeForm();
    rebuild(false);
  });

  // ---- URL / projects -----------------------------------------------------------
  function saveHash() {
    const code = encodeShare(state);
    history.replaceState(null, '', code ? `#${code}` : location.pathname + location.search);
  }

  function refreshProjects(select?: string) {
    const sel = $<HTMLSelectElement>('#project-list');
    const names = listProjects().map((p) => p.name);
    sel.innerHTML = names.length ? names.map(() => `<option></option>`).join('') : '<option value="">No saved projects</option>';
    names.forEach((n, i) => {
      sel.options[i].value = n;
      sel.options[i].textContent = n;
    });
    if (select) sel.value = select;
  }

  function loadConfig(cfg: DeepPartial<ChordDriftConfig>) {
    state = resolveConfig(cfg);
    writeForm();
    rebuild(false);
  }

  $('#project-save').addEventListener('click', () => {
    const suggested = [state.series, state.episode ? `#${state.episode}` : '', state.title].filter(Boolean).join(' ');
    const name = prompt('Project name', suggested);
    if (!name) return;
    try {
      saveProject(name, state);
      refreshProjects(name);
      setStatus(`Saved "${name}" in this browser.`);
    } catch (e) {
      setStatus(`Couldn't save: ${(e as Error).message}`);
    }
  });
  $('#project-load').addEventListener('click', () => {
    const name = $<HTMLSelectElement>('#project-list').value;
    const p = listProjects().find((x) => x.name === name);
    if (!p) return;
    loadConfig(p.config);
    setStatus(`Opened "${name}".`);
  });
  $('#project-delete').addEventListener('click', () => {
    const name = $<HTMLSelectElement>('#project-list').value;
    if (!name || !confirm(`Delete "${name}" from this browser?`)) return;
    deleteProject(name);
    refreshProjects();
  });
  $('#project-export').addEventListener('click', () => {
    const name = [state.title || 'chord-drift', formatSeedLabel()].join('-').replace(/[^\w#-]+/g, '-');
    download(new Blob([exportProject(state.title || 'Chord Drift', state)], { type: 'application/json' }), `${name}.chorddrift.json`);
  });
  $('#project-import').addEventListener('click', () => $<HTMLInputElement>('#project-file').click());
  $<HTMLInputElement>('#project-file').addEventListener('change', async (e) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const p = parseProject(await file.text());
      loadConfig(p.config);
      setStatus(`Imported "${p.name}".`);
    } catch (err) {
      setStatus(`Couldn't read that file: ${(err as Error).message}`);
    }
  });
  $('#share').addEventListener('click', async () => {
    saveHash();
    try {
      await navigator.clipboard.writeText(location.href);
      setStatus('Link copied — it opens this exact piece.');
    } catch {
      setStatus('Copy the address bar to share this piece.');
    }
  });

  const formatSeedLabel = () => score.seedLabel;

  // ---- Transport ------------------------------------------------------------
  const currentTime = () => (player.playing ? player.time() : pausedAt);

  async function play() {
    if (Number.isFinite(score.timeline.end) && pausedAt >= score.timeline.end - 0.01) pausedAt = 0;
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
    const end = Number.isFinite(score.timeline.end) ? score.timeline.end : Infinity;
    pausedAt = Math.max(0, Math.min(end, t));
    score.extend(pausedAt);
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
    const el = e.target as Field;
    if (!el.dataset.path) return;
    readField(el);
    syncVisibility();
    const path = el.dataset.path;
    clearTimeout(debounce);
    const delay = path === 'progression' ? 450 : 160;
    debounce = window.setTimeout(() => rebuild(path !== 'seed'), delay);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  $('#dice').addEventListener('click', () => {
    state.seed = formatSeed(randomSeed());
    writeForm();
    rebuild(false);
  });

  // ---- Exports ----------------------------------------------------------------
  function download(blob: Blob, name: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }
  const baseName = () => `chord-drift-${score.seedLabel}`;

  $<HTMLButtonElement>('#wav').addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    const duration = score.endless ? Math.max(30, currentTime()) : score.timeline.end;
    setStatus(score.endless ? `Rendering the first ${duration.toFixed(0)} s…` : 'Rendering audio…');
    try {
      const buf = await renderOffline(score, duration);
      download(new Blob([encodeWav(buf)], { type: 'audio/wav' }), `${baseName()}.wav`);
      setStatus(`Saved ${baseName()}.wav (${buf.duration.toFixed(1)} s)`);
    } catch (err) {
      setStatus(`Audio export failed: ${(err as Error).message}`);
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
    const json = JSON.stringify(state, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setStatus('Config copied — save it to a file and run: npm run export -- --config file.json');
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
      setStatus('This browser cannot record video; use npm run export instead.');
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
      setStatus('Recording saved. For frame-exact 60 fps video use npm run export.');
      pause();
    };
    recording = { recorder, canvas: rc };
    recordBtn.textContent = 'Stop recording';
    setStatus(score.endless ? 'Recording — press Stop recording when you have enough.' : 'Recording in real time…');
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

  let lastHighlight = -2;
  function tick() {
    let t = currentTime();
    const end = score.timeline.end;
    if (player.playing && Number.isFinite(end) && t >= end) {
      if (recording) recording.recorder.stop();
      else pause();
      pausedAt = end;
      t = end;
    }
    score.extend(t);
    if (score.endless && score.chords.length + 1 > renderedRows) renderList();
    resizeCanvas();
    renderFrame(ctx, score, t);
    if (recording) renderFrame(recording.canvas.getContext('2d')!, score, t);
    const scrubMax = Number.isFinite(end) ? end : Math.max(30, t + 10, score.chords.at(-1)?.t ?? 0);
    scrub.max = String(scrubMax);
    if (document.activeElement !== scrub) scrub.value = String(t);
    clock.textContent = `${fmt(t)} / ${Number.isFinite(end) ? fmt(end) : '∞'}`;

    // Highlight the current row (rows are keyed by start time).
    const idx = chordIndexAt(score, t);
    const target = !score.endless && t >= score.timeline.arrivalStart ? Infinity : idx < 0 ? 0 : score.chords[idx].t;
    if (target !== lastHighlight) {
      let current: Element | null = null;
      for (const li of list.children) {
        const lt = Number((li as HTMLElement).dataset.t);
        if (target === Infinity ? li === list.lastElementChild : lt <= target + 1e-6) current = li;
        li.classList.remove('current');
      }
      current?.classList.add('current');
      // Scroll inside the list only, never the whole panel (that would interrupt editing).
      if (current) {
        const li = current as HTMLElement;
        if (li.offsetTop < list.scrollTop || li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight) {
          list.scrollTop = li.offsetTop - list.clientHeight / 2;
        }
      }
      lastHighlight = target;
    }
    requestAnimationFrame(tick);
  }

  // ---- Boot ----------------------------------------------------------------------
  const shared = decodeShare(location.hash.slice(1));
  state = resolveConfig(shared ?? {});
  writeForm();
  refreshProjects();
  rebuild(false);
  void fontsReady.then(() => requestAnimationFrame(tick));
}

// Boot last, so every module-level constant above is initialised.
if (!new URLSearchParams(location.search).has('export')) startApp();
