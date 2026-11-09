import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/700.css';
import './style.css';
import { LivePlayer, encodeWav, renderOffline } from './audio/synth';
import {
  AMBIENT_PRESET,
  DARK_PRESET,
  PLUCK_PRESET,
  THEME_LABELS,
  THEME_PRESETS,
  PALETTES,
  PALETTE_LABELS,
  randomTheme,
  DEFAULT_CONFIG,
  KEY_NAMES,
  RHYTHM_PRESETS,
  DRUM_PRESETS,
  STRIKE_PRESETS,
  SCALES,
  SONG_PRESETS,
  CHOP_PRESETS,
  STYLES,
  chordIndexAt,
  chordToToken,
  formatSeed,
  generateScore,
  midiToConfig,
  readMidi,
  writeMidi,
  pitchesAt,
  randomSeed,
  resolveConfig,
  scaleChords,
  spellChordNote,
  spellNote,
  typicalSize,
  voiceChord,
  voicingRules,
  type ChordDriftConfig,
  type DeepPartial,
  type Theme,
  type Score,
} from './engine';
import { ensureFont } from './render/fonts';
import { frameCount, renderFrame, themeBackground } from './render/renderer';
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
  async load(partial: DeepPartial<ChordDriftConfig>, duration?: number) {
    exportScore = generateScore(partial);
    await ensureFont(exportScore.config.theme.font);
    exportDuration = exportScore.endless ? duration ?? 60 : duration ?? exportScore.timeline.end;
    exportScore.extend(exportDuration);
    const { width, height, fps } = exportScore.config.video;
    exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    return {
      // A loop exports exactly one pass (the last frame is just before the wrap) so it repeats cleanly.
      frames: exportScore.loop ? Math.round(exportDuration * fps) : frameCount(exportScore, exportDuration),
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
  /** Average render time (ms) for frames spread over the piece, without encoding (for tuning). */
  bench(frames = 60, from = 0, to = exportDuration): number {
    if (!exportScore || !exportCanvas) throw new Error('call load() first');
    const ctx = exportCanvas.getContext('2d')!;
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) renderFrame(ctx, exportScore, from + ((to - from) * (i + 0.5)) / frames, { frame: i });
    ctx.getImageData(0, 0, 1, 1); // wait for the GPU to finish
    return (performance.now() - t0) / frames;
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

const COMPLEXITY_NAMES = ['', 'triads', 'sevenths', 'ninths & elevenths', 'richer + some colour', 'altered & secondary dominants'];

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}
function setPath(obj: unknown, path: string, value: unknown) {
  const keys = path.split('.');
  let o = obj as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
}

const LOOP_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DICE_SVG =
  '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.5" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.5" fill="currentColor"/></svg>';

function startApp() {
  let loopReroll = false;
  let pendingPass: { next: Score; nextState: ChordDriftConfig } | null = null;
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

  const presetSelect = $<HTMLSelectElement>('#rhythm-preset');
  presetSelect.innerHTML = RHYTHM_PRESETS.map((_, i) => `<option value="${i}"></option>`).join('') + '<option value="custom">Custom</option>';
  RHYTHM_PRESETS.forEach((p, i) => (presetSelect.options[i].textContent = p.name));
  presetSelect.addEventListener('change', () => {
    const preset = RHYTHM_PRESETS[Number(presetSelect.value)];
    if (!preset) return;
    state.rhythm.chords = preset.chords;
    writeForm();
    rebuild(true);
  });

  const styleSelect = $<HTMLSelectElement>('#style');
  styleSelect.innerHTML =
    '<option value="none">None — use the generator below</option>' + Object.entries(STYLES).map(([id, st]) => `<option value="${id}">${st.name}</option>`).join('');

  const themeSelect = $<HTMLSelectElement>('#theme-preset');
  themeSelect.innerHTML = Object.keys(THEME_PRESETS).map((id) => `<option value="${id}">${THEME_LABELS[id] ?? id}</option>`).join('') + '<option value="custom">Custom</option>';
  themeSelect.addEventListener('change', () => {
    const preset = THEME_PRESETS[themeSelect.value];
    if (!preset) return;
    if (useMine) {
      myTheme = structuredClone(preset);
      saveMyTheme();
    } else state.theme = structuredClone(preset);
    writeForm();
    rebuild(true);
  });

  const paletteSelect = $<HTMLSelectElement>('#palette-select');
  paletteSelect.innerHTML = Object.keys(PALETTES).map((id) => `<option value="${id}">${PALETTE_LABELS[id] ?? id}</option>`).join('') + '<option value="rolled" disabled>Rolled 🎲</option>';
  $('#random-theme').addEventListener('click', () => {
    const th = randomTheme(Math.random);
    if (useMine) {
      myTheme = th;
      saveMyTheme();
    } else state.theme = th;
    writeForm();
    rebuild(true);
  });

  const useMineBox = $<HTMLInputElement>('#use-my-theme');
  const themeNote = $<HTMLParagraphElement>('#theme-note');
  const syncThemeUi = () => {
    useMineBox.checked = useMine;
    themeNote.textContent = useMine
      ? "Showing your theme. Edits here change your theme; the song keeps its own (share links and saved projects carry the song's)."
      : myTheme
        ? "Showing this song's theme. Tick \"Use my theme\" to see every song in yours."
        : 'Share links and projects carry the song\'s theme. Save a look as your theme to use it everywhere.';
  };
  useMineBox.addEventListener('change', () => {
    useMine = useMineBox.checked;
    if (useMine && !myTheme) {
      myTheme = structuredClone(state.theme);
      saveMyTheme();
    }
    store.set('chord-drift.useMyTheme', useMine ? '1' : '0');
    syncThemeUi();
    writeForm();
    rebuild(true);
  });
  $('#reroll-colors').addEventListener('click', () => {
    const th = useMine && myTheme ? myTheme : state.theme;
    th.colorSeed = 1 + Math.floor(Math.random() * 0x7ffffffe);
    if (th.colorBy === 'none') th.colorBy = 'voice';
    th.preset = 'custom';
    if (useMine && myTheme) {
      myTheme = { ...myTheme };
      saveMyTheme();
    }
    writeForm();
    rebuild(true);
  });
  $('#save-my-theme').addEventListener('click', () => {
    myTheme = structuredClone(displayTheme());
    saveMyTheme();
    syncThemeUi();
    setStatus('Saved as your theme. Tick "Use my theme" to see every song in it.');
  });
  $('#apply-my-theme').addEventListener('click', () => {
    if (!myTheme) {
      setStatus('Save a theme first.');
      return;
    }
    state.theme = structuredClone(myTheme);
    writeForm();
    rebuild(true);
    setStatus('Your theme is now part of this song (share links and exports carry it).');
  });

  const store = {
    get: (k: string) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k: string, v: string) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* ignore */
      }
    },
  };
  // Output format (the exported frame size).
  const FORMATS: Record<string, [number, number]> = {
    portrait: [1080, 1920],
    landscape: [1920, 1080],
    square: [1080, 1080],
    portrait45: [1080, 1350],
    landscape4k: [3840, 2160],
  };
  const formatSelect = $<HTMLSelectElement>('#format');
  // Auto: landscape on wide screens, portrait on tall ones (a per-device preference, on by default).
  let autoFormat = store.get('chord-drift.formatAuto') !== '0';
  const autoDims = (): [number, number] => (window.innerWidth > window.innerHeight * 1.05 ? FORMATS.landscape : FORMATS.portrait);
  const applyAutoFormat = () => {
    if (!autoFormat) return false;
    const [w, h] = autoDims();
    if (state.video.width === w && state.video.height === h) return false;
    state.video.width = w;
    state.video.height = h;
    // The frame size doesn't change the music, so no regeneration: just reframe.
    if (score) {
      score.config.video.width = w;
      score.config.video.height = h;
      viewCache = null;
    }
    return true;
  };
  formatSelect.addEventListener('change', () => {
    autoFormat = formatSelect.value === 'auto';
    store.set('chord-drift.formatAuto', autoFormat ? '1' : '0');
    if (autoFormat) applyAutoFormat();
    else {
      const f = FORMATS[formatSelect.value];
      if (!f) return;
      [state.video.width, state.video.height] = f;
    }
    writeForm();
    rebuild(true);
  });
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (applyAutoFormat()) {
        syncVisibility();
        saveHash();
      }
    }, 200);
  });

  // Fill window ("desktop mode"): the preview uses the whole stage. A per-device preference.
  let fill = false;
  try {
    fill = localStorage.getItem('chord-drift.fill') === '1';
  } catch {
    /* ignore */
  }
  const fillBtn = $<HTMLButtonElement>('#fill');
  const applyFill = () => {
    fillBtn.setAttribute('aria-pressed', String(fill));
    document.querySelector('.app')!.classList.toggle('filled', fill);
  };
  fillBtn.addEventListener('click', () => {
    fill = !fill;
    applyFill();
    try {
      localStorage.setItem('chord-drift.fill', fill ? '1' : '0');
    } catch {
      /* ignore */
    }
    setStatus(fill ? 'Filling the window. Exports and recordings still use the Format setting.' : 'Showing the export format.');
  });
  applyFill();

  const drumSelect = $<HTMLSelectElement>('#drum-preset');
  drumSelect.innerHTML = DRUM_PRESETS.map((_, i) => `<option value="${i}"></option>`).join('') + '<option value="custom">Custom</option>';
  DRUM_PRESETS.forEach((p, i) => (drumSelect.options[i].textContent = p.name));
  drumSelect.addEventListener('change', () => {
    const preset = DRUM_PRESETS[Number(drumSelect.value)];
    if (!preset) return;
    for (const v of ['kick', 'snare', 'hat', 'crash', 'ride'] as const) state.drums[v] = preset[v];
    writeForm();
    rebuild(true);
  });

  const songSelect = $<HTMLSelectElement>('#song-preset');
  songSelect.innerHTML = SONG_PRESETS.map((_, i) => `<option value="${i}"></option>`).join('') + '<option value="custom">Custom</option>';
  SONG_PRESETS.forEach((p, i) => (songSelect.options[i].textContent = `${p.name} · ${p.form}`));
  songSelect.addEventListener('change', () => {
    const preset = SONG_PRESETS[Number(songSelect.value)];
    if (!preset) return;
    state.song.form = preset.form;
    writeForm();
    rebuild(true);
  });

  const chopSelect = $<HTMLSelectElement>('#chop-preset');
  chopSelect.innerHTML = CHOP_PRESETS.map((_, i) => `<option value="${i}"></option>`).join('') + '<option value="custom">Custom</option>';
  CHOP_PRESETS.forEach((p, i) => (chopSelect.options[i].textContent = `${p.name} · ${p.pattern}`));
  chopSelect.addEventListener('change', () => {
    const preset = CHOP_PRESETS[Number(chopSelect.value)];
    if (!preset) return;
    state.chop.pattern = preset.pattern;
    writeForm();
    rebuild(true);
  });

  const strikeSelect = $<HTMLSelectElement>('#strike-preset');
  strikeSelect.innerHTML = STRIKE_PRESETS.map((_, i) => `<option value="${i}"></option>`).join('') + '<option value="custom">Custom</option>';
  STRIKE_PRESETS.forEach((p, i) => (strikeSelect.options[i].textContent = p.name + (p.pattern ? `  (${p.pattern})` : '')));
  strikeSelect.addEventListener('change', () => {
    const preset = STRIKE_PRESETS[Number(strikeSelect.value)];
    if (!preset) return;
    state.rhythm.pluck = preset.pattern;
    writeForm();
    rebuild(true);
  });

  const player = new LivePlayer();
  let state: ChordDriftConfig = resolveConfig();
  let score: Score;
  let pausedAt = 0;
  let recording: { recorder: MediaRecorder; canvas: HTMLCanvasElement } | null = null;

  const setStatus = (msg: string) => (status.textContent = msg);

  // "My theme": a personal look (this device) that can override each song's theme.
  let myTheme: Theme | null = null;
  try {
    const raw = store.get('chord-drift.myTheme');
    if (raw) myTheme = resolveConfig({ theme: JSON.parse(raw) }).theme;
  } catch {
    myTheme = null;
  }
  let useMine = store.get('chord-drift.useMyTheme') === '1' && myTheme !== null;
  const saveMyTheme = () => myTheme && store.set('chord-drift.myTheme', JSON.stringify(myTheme));
  /** The theme on screen: yours when "Use my theme" is on, otherwise the song's. */
  const displayTheme = (): Theme => (useMine && myTheme ? myTheme : state.theme);
  let viewCache: { score: Score; theme: Theme; view: Score } | null = null;
  /** The score as drawn (with your theme swapped in when that's on). */
  const viewScore = (): Score => {
    const theme = displayTheme();
    if (theme === state.theme && !useMine) return score;
    if (!viewCache || viewCache.score !== score || viewCache.theme !== theme) {
      viewCache = { score, theme, view: { ...score, config: { ...score.config, theme } } };
    }
    return viewCache.view;
  };

  // ---- State <-> form ----------------------------------------------------------
  function writeForm() {
    const shown = { ...state, theme: displayTheme() };
    for (const el of fields) {
      const v = getPath(shown, el.dataset.path!);
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
    if (path.startsWith('theme.') && useMine && myTheme) {
      setPath({ theme: myTheme }, path, value);
      myTheme.preset = 'custom';
      myTheme = { ...myTheme }; // new identity so the view cache refreshes
      saveMyTheme();
      return;
    }
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
    const styled = state.style !== 'none' && !written;
    for (const el of form.querySelectorAll<HTMLElement>('[data-nostyle]')) if (styled) el.hidden = true;
    const def = state.style !== 'none' ? STYLES[state.style] : null;
    $('#style-note').textContent = def
      ? written
        ? 'Your written progression takes priority over the style.'
        : `${def.description} Complexity is kept within ${def.complexity[0]}–${def.complexity[1]} for this style; chord count sets the number of phrases.`
      : 'Pick a style for planned phrases, cadences and key changes, or leave it on None for free generation.';
    for (const el of form.querySelectorAll<HTMLElement>('[data-melody]')) el.hidden = !state.melody.enabled;
    for (const el of form.querySelectorAll<HTMLElement>('[data-drums]')) el.hidden = !state.drums.enabled;
    for (const el of form.querySelectorAll<HTMLElement>('[data-song]')) el.hidden = !state.song.enabled;
    if (!state.loop) loopReroll = false;
    const loopEl = $('#loop-btn');
    const mode = !state.loop ? 'off' : loopReroll ? 'reroll' : 'loop';
    if (loopEl.dataset.mode !== mode) {
      loopEl.dataset.mode = mode;
      loopEl.setAttribute('aria-pressed', String(state.loop));
      loopEl.innerHTML = mode === 'reroll' ? DICE_SVG : LOOP_SVG;
      loopEl.title = mode === 'off' ? 'Loop' : mode === 'loop' ? 'Looping — click for a new seed every pass' : 'Looping with a new seed every pass — click to stop looping';
    }
    $<HTMLInputElement>('#zoom').value = String(Math.log(state.video.zoom));
    $('#zoom-reset').textContent = `${Math.round(state.video.zoom * 100)}%`;
    for (const el of form.querySelectorAll<HTMLElement>('[data-chop]')) el.hidden = !state.chop.enabled;
    const chopIdx = CHOP_PRESETS.findIndex((p) => p.pattern === state.chop.pattern.trim());
    chopSelect.value = chopIdx >= 0 ? String(chopIdx) : 'custom';
    for (const el of form.querySelectorAll<HTMLElement>('[data-nodrums]')) if (state.drums.enabled) el.hidden = true;
    const songIdx = SONG_PRESETS.findIndex((p) => p.form === state.song.form.trim());
    songSelect.value = songIdx >= 0 ? String(songIdx) : 'custom';
    const dp = DRUM_PRESETS.findIndex((p) => (['kick', 'snare', 'hat', 'crash', 'ride'] as const).every((v) => p[v] === state.drums[v]));
    drumSelect.value = dp >= 0 ? String(dp) : 'custom';
    for (const el of form.querySelectorAll<HTMLElement>('[data-swell]')) el.hidden = state.audio.swell === 'off';
    for (const el of form.querySelectorAll<HTMLElement>('[data-transition]')) el.hidden = !el.dataset.transition!.split(' ').includes(state.motion.transition);
    for (const el of form.querySelectorAll<HTMLElement>('[data-env]')) el.hidden = state.motion.transition !== 'pluck';
    const strikeIdx = STRIKE_PRESETS.findIndex((p) => p.pattern === state.rhythm.pluck.trim());
    strikeSelect.value = strikeIdx >= 0 ? String(strikeIdx) : 'custom';
    for (const el of form.querySelectorAll<HTMLElement>('[data-gradient]')) el.hidden = !displayTheme().gradient;
    for (const el of form.querySelectorAll<HTMLElement>('[data-palette]')) el.hidden = displayTheme().colorBy === 'none';
    if (displayTheme().colorSeed) $<HTMLSelectElement>('#palette-select').value = 'rolled';
    for (const el of form.querySelectorAll<HTMLElement>('[data-spiral]')) el.hidden = state.video.view !== 'spiral';
    const dt = displayTheme();
    themeSelect.value = dt.preset in THEME_PRESETS ? dt.preset : 'custom';
    const fmt = Object.entries(FORMATS).find(([, [w, h]]) => w === state.video.width && h === state.video.height);
    formatSelect.value = autoFormat ? 'auto' : fmt ? fmt[0] : 'custom';
    for (const el of form.querySelectorAll<HTMLElement>('[data-free]')) el.hidden = state.rhythm.chords.trim().length > 0;
    const presetIdx = RHYTHM_PRESETS.findIndex((p) => p.chords === state.rhythm.chords.trim());
    presetSelect.value = presetIdx >= 0 ? String(presetIdx) : 'custom';
    for (const el of form.querySelectorAll<HTMLElement>('[data-hide]')) {
      const conds = el.dataset.hide!.split(' ');
      el.hidden = (conds.includes('endless') && state.endless && !state.song.enabled) || (conds.includes('written') && written) || (conds.includes('loopon') && state.loop) || (conds.includes('song') && state.song.enabled);
    }
    for (const el of form.querySelectorAll<HTMLElement>('[data-loopnote]')) if (!state.loop || (state.endless && !state.song.enabled)) el.hidden = true;
  }

  // ---- Score ------------------------------------------------------------------
  function rebuild(keepTime: boolean) {
    pendingPass = null;
    void ensureFont(displayTheme().font);
    canvas.style.background = themeBackground({ ...state, theme: displayTheme() });
    const wasPlaying = player.playing;
    const t = keepTime ? currentTime() : 0;
    if (wasPlaying) player.pause();
    try {
      score = generateScore(state);
    } catch (e) {
      setStatus(String((e as Error).message ?? e));
      return;
    }
    const errs = (prefix: string | null) =>
      score.errors
        .filter((e) => (prefix ? e.startsWith(prefix) : !/^((chord|melody) rhythm|strike pattern|song form|chop): /.test(e)))
        .map((e) => (prefix ? e.slice(prefix.length) : e))
        .join(' · ');
    $('#prog-errors').textContent = errs(null);
    $('#rhythm-errors').textContent = errs('chord rhythm: ');
    $('#melody-errors').textContent = errs('melody rhythm: ');
    $('#strike-errors').textContent = errs('strike pattern: ');
    $('#song-errors').textContent = errs('song form: ');
    $('#chop-errors').textContent = errs('chop: ');
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
    $('#score-meta').textContent = `· ${s.keyName} ${s.scaleName}${s.endless ? ', endless' : s.sections.length ? `, ${s.sections.length} parts` : `, ${s.chords.length} chords`}`;
    if (renderedRows === 0) list.append(row(0, 'unison', spellNote(s.startNote, s.keyPc, s.config.scale)));
    for (let i = Math.max(0, renderedRows - 1); i < s.chords.length; i++) {
      const c = s.chords[i];
      const sec = s.sections.find((x) => Math.abs(x.t - c.t) < 1e-9);
      if (sec) {
        const li = row(c.t, `§ ${sec.label}${sec.full ? '!' : ''}`, [sec.full ? 'full' : 'soft', sec.shift ? `${sec.shift > 0 ? '+' : ''}${sec.shift}` : ''].filter(Boolean).join(' · '));
        li.classList.add('section');
        list.append(li);
      }
      const origin = c.origin === 'scale' || c.origin === 'cadence' || c.origin === 'written' ? '' : ` · ${c.origin}`;
      list.append(row(c.t, c.name, c.roman + origin, (c.unison ? c.notes.slice(0, 1) : c.notes).map((n) => spellChordNote(n, c)).join(' ')));
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
  const applyPatch = (p: DeepPartial<ChordDriftConfig>, message: string) => {
    const merged = structuredClone(state) as unknown as Record<string, Record<string, unknown>>;
    for (const [k, v] of Object.entries(p)) {
      merged[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...merged[k], ...(v as Record<string, unknown>) } : (v as unknown as Record<string, unknown>);
    }
    state = resolveConfig(merged as DeepPartial<ChordDriftConfig>);
    writeForm();
    rebuild(true);
    setStatus(message);
  };
  $('#pluck').addEventListener('click', () =>
    applyPatch(PLUCK_PRESET, 'Pluck: chords change on a strike with a fast attack and quick decay. Pick a strike pattern under Timing to re-strike them.'),
  );
  $('#dark').addEventListener('click', () =>
    applyPatch(DARK_PRESET, 'Dark: detuned saws through a low filter, deep reverb, slow breathing. Try it with the Witch house style and Hex theme.'),
  );
  $('#reset-all').addEventListener('click', () => {
    if (!confirm('Reset every setting to its default? (The seed is kept.)')) return;
    const seed = state.seed;
    loadConfig({ seed });
    setStatus('All settings back to defaults (same seed).');
  });
  $('#ambient').addEventListener('click', () =>
    applyPatch(AMBIENT_PRESET, 'Ambient: each chord releases as the next swells in underneath, with a dark triangle tone and deep reverb.'),
  );
  $('#sound-reset').addEventListener('click', () => {
    state = resolveConfig({ ...state, audio: structuredClone(DEFAULT_CONFIG.audio) } as DeepPartial<ChordDriftConfig>);
    writeForm();
    rebuild(true);
    setStatus('Sound back to defaults (nothing else changed).');
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
    applyAutoFormat();
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
  /** Score time now (wraps around when the piece loops). */
  const currentTime = () => {
    const t = player.playing ? player.time() : pausedAt;
    return score && score.loop && t >= score.timeline.end ? t % score.timeline.end : t;
  };

  async function play() {
    if (Number.isFinite(score.timeline.end) && pausedAt >= score.timeline.end - 0.01) pausedAt = score.loop ? pausedAt % score.timeline.end : 0;
    await player.play(score, pausedAt);
    playBtn.textContent = '❚❚';
    playBtn.setAttribute('aria-label', 'Pause');
  }
  function pause() {
    pausedAt = player.pause();
    if (score.loop) pausedAt %= score.timeline.end;
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

  // ---- Zoom, loop, fullscreen -------------------------------------------------
  // Zoom is a view setting (saved with the song, used by exports) that doesn't need a rebuild.
  const zoomInput = $<HTMLInputElement>('#zoom');
  const zoomLabel = $<HTMLButtonElement>('#zoom-reset');
  let zoomSave = 0;
  const setZoom = (z: number) => {
    z = Math.max(0.4, Math.min(4, z));
    state.video.zoom = z;
    score.config.video.zoom = z;
    zoomInput.value = String(Math.log(z));
    zoomLabel.textContent = `${Math.round(z * 100)}%`;
    clearTimeout(zoomSave);
    zoomSave = window.setTimeout(saveHash, 300);
  };
  zoomInput.addEventListener('input', () => setZoom(Math.exp(Number(zoomInput.value))));
  $('#zoom-in').addEventListener('click', () => setZoom(state.video.zoom * 1.2));
  $('#zoom-out').addEventListener('click', () => setZoom(state.video.zoom / 1.2));
  zoomLabel.addEventListener('click', () => setZoom(1));
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      setZoom(state.video.zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
    },
    { passive: false },
  );
  // Loop button: off → loop → loop with a new seed every pass → off.
  const loopBtn = $<HTMLButtonElement>('#loop-btn');
  loopBtn.addEventListener('click', () => {
    if (!state.loop) {
      state.loop = true;
      state.endless = false;
      loopReroll = false;
      writeForm();
      rebuild(true);
      setStatus('Looping: the piece returns to its opening unison and starts again.');
    } else if (!loopReroll) {
      loopReroll = true;
      // Pin the key, so every new seed starts and ends on the same unison and the join stays seamless.
      if (state.key === 'auto') {
        state.key = KEY_NAMES[score.keyPc];
        writeForm();
        saveHash();
      }
      syncVisibility();
      setStatus(`Loop + new seed: each pass rolls a fresh progression in ${score.keyName}, joined at the unison.`);
    } else {
      loopReroll = false;
      pendingPass = null;
      state.loop = false;
      writeForm();
      rebuild(true);
      setStatus('Loop off.');
    }
  });
  const stageEl = $<HTMLElement>('.stage');
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageEl.requestFullscreen?.().catch(() => setStatus('Fullscreen isn\'t available here.'));
  };
  $('#fullscreen').addEventListener('click', toggleFullscreen);
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'f' || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    toggleFullscreen();
  });
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
    // Picking a named palette replaces a rolled one.
    if (el.dataset.path === 'theme.palette') {
      const th = useMine && myTheme ? myTheme : state.theme;
      th.colorSeed = 0;
    }
    // Full song parts are built around the drums: switching Song on brings them in.
    if (el.dataset.path === 'song.enabled' && state.song.enabled && !state.drums.enabled) {
      state.drums.enabled = true;
      writeForm();
    }
    if (el.dataset.path.startsWith('theme.') && !useMine) state.theme.preset = 'custom';
    syncVisibility();
    const path = el.dataset.path;
    clearTimeout(debounce);
    const delay =
      path === 'progression' || path === 'song.form' || path === 'chop.pattern' || path.endsWith('rhythm') || path === 'rhythm.chords' || /^drums\.(kick|snare|hat|crash|ride)$/.test(path)
        ? 450
        : path.startsWith('theme.')
          ? 30
          : 160;
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

  $('#midi').addEventListener('click', () => {
    try {
      const m = writeMidi(generateScore(state), score.endless ? Math.max(60, currentTime()) : undefined);
      download(new Blob([m.bytes as BlobPart], { type: 'audio/midi' }), `${baseName()}.mid`);
      setStatus(`Saved ${baseName()}.mid: ${m.chords} chords, ${m.duration.toFixed(0)} s.`);
    } catch (err) {
      setStatus(`MIDI export failed: ${(err as Error).message}`);
    }
  });
  $('#midi-import').addEventListener('click', () => $<HTMLInputElement>('#midi-file').click());
  $<HTMLInputElement>('#midi-file').addEventListener('change', async (e) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const imp = midiToConfig(readMidi(await file.arrayBuffer()));
      const title = file.name.replace(/\.(mid|midi|rmi)$/i, '');
      loadConfig({ ...state, ...imp.patch, rhythm: { ...state.rhythm, ...imp.patch.rhythm }, drums: { ...state.drums, ...(imp.patch.drums ?? {}) }, title: state.title || title } as never);
      setStatus(`Imported ${imp.chords.length} chords from ${file.name} · ${imp.key} · ${imp.tempo} bpm${imp.drums ? ' · drums' : ''}.`);
    } catch (err) {
      setStatus(`Couldn't read that MIDI file: ${(err as Error).message}`);
    }
  });

  $('#png').addEventListener('click', () => {
    const c = document.createElement('canvas');
    c.width = score.config.video.width;
    c.height = score.config.video.height;
    const t = currentTime();
    renderFrame(c.getContext('2d')!, viewScore(), t);
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

  // ---- Volume & level meter ------------------------------------------------------
  // Listening volume is a per-device preference (not part of the piece or project).
  const volumeInput = $<HTMLInputElement>('#volume');
  const levelsBox = $<HTMLDivElement>('.levels');
  let volume = 0.9;
  let muted = false;
  try {
    const saved = localStorage.getItem('chord-drift.volume');
    if (saved !== null && Number.isFinite(Number(saved))) volume = Math.max(0, Math.min(1, Number(saved)));
  } catch {
    /* storage unavailable */
  }
  const applyVolume = () => {
    player.setVolume(muted ? 0 : volume);
    volumeInput.value = String(volume);
    levelsBox.classList.toggle('muted', muted || volume === 0);
    $('#mute').setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    $('#mute-waves').style.opacity = muted || volume === 0 ? '0.15' : '1';
  };
  volumeInput.addEventListener('input', () => {
    volume = Number(volumeInput.value);
    muted = false;
    applyVolume();
    try {
      localStorage.setItem('chord-drift.volume', String(volume));
    } catch {
      /* ignore */
    }
  });
  const toggleMute = () => {
    muted = !muted;
    applyVolume();
  };
  $('#mute').addEventListener('click', toggleMute);
  applyVolume();

  const meterRows = [...document.querySelectorAll<HTMLElement>('.meter-row')];
  const meterEl = $<HTMLDivElement>('.meter');
  const clipEl = $<HTMLSpanElement>('#clip');
  const METER_FLOOR = -48;
  const pos = (db: number) => Math.max(0, Math.min(1, (db - METER_FLOOR) / -METER_FLOOR));
  const shown = [METER_FLOOR, METER_FLOOR];
  const peaks = [{ db: -Infinity, at: 0 }, { db: -Infinity, at: 0 }];
  let clipUntil = 0;
  let lastMeterAt = performance.now();
  function updateMeter(now: number) {
    const dt = Math.min(0.1, (now - lastMeterAt) / 1000);
    lastMeterAt = now;
    const lv = player.levels();
    lv.forEach((l, ch) => {
      // RMS bar: rises instantly, falls at 24 dB/s, like a classic meter.
      const target = Math.max(METER_FLOOR, l.rms);
      shown[ch] = target > shown[ch] ? target : Math.max(target, shown[ch] - 24 * dt);
      // Peak tick: holds for a second, then falls at 18 dB/s.
      const pk = peaks[ch];
      if (l.peak >= pk.db || now - pk.at > 1000) {
        if (l.peak >= pk.db) {
          pk.db = l.peak;
          pk.at = now;
        } else pk.db = Math.max(l.peak, pk.db - 18 * dt);
      }
      if (l.peak > -0.3) clipUntil = now + 1500;
      const row = meterRows[ch];
      (row.children[0] as HTMLElement).style.width = `calc(${(1 - pos(shown[ch])) * 100}% + 1px)`;
      const tick = row.children[1] as HTMLElement;
      tick.style.left = `calc(${pos(pk.db) * 100}% - 2px)`;
      tick.style.opacity = pk.db > METER_FLOOR ? '0.8' : '0';
    });
    clipEl.classList.toggle('on', now < clipUntil);
    meterEl.setAttribute('aria-valuenow', String(Math.round(Math.max(...shown))));
  }

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
    } else if (e.key === 'm' || e.key === 'M') toggleMute();
    else if (e.key === 'ArrowLeft') seek(currentTime() - 2);
    else if (e.key === 'ArrowRight') seek(currentTime() + 2);
  });

  // ---- Render loop -----------------------------------------------------------------
  // Adaptive preview resolution: slow devices drop pixel density until frames
  // keep up, then creep back. (Exports always render at full size.)
  let quality = 1;
  let frameEma = 16;
  let lastFrameAt = 0;
  let framesSinceAdjust = 0;
  function adaptQuality(now: number) {
    if (lastFrameAt && player.playing) {
      frameEma = frameEma * 0.92 + Math.min(100, now - lastFrameAt) * 0.08;
      if (++framesSinceAdjust > 60) {
        if (frameEma > 24 && quality > 0.3) {
          quality = Math.max(0.3, quality - 0.15);
          framesSinceAdjust = 0;
        } else if (frameEma < 15 && quality < 1 && framesSinceAdjust > 240) {
          quality = Math.min(1, quality + 0.1);
          framesSinceAdjust = 0;
        }
      }
    }
    lastFrameAt = now;
  }

  const frameEl = $<HTMLDivElement>('.frame');
  let textScale = 1;
  function resizeCanvas() {
    const { width: vw, height: vh } = score.config.video;
    const box = frameEl.getBoundingClientRect();
    const availW = Math.max(120, box.width);
    const availH = Math.max(160, box.height);
    // Fit the export format into the stage, or (Fill mode) take the whole stage.
    let cssW: number;
    let cssH: number;
    if (fill) {
      cssW = availW;
      cssH = availH;
    } else {
      const k = Math.min(availW / vw, availH / vh);
      cssW = vw * k;
      cssH = vh * k;
    }
    const wantW = `${Math.floor(cssW)}px`;
    const wantH = `${Math.floor(cssH)}px`;
    if (canvas.style.width !== wantW) canvas.style.width = wantW;
    if (canvas.style.height !== wantH) canvas.style.height = wantH;
    // Slow browsers can drop below one canvas pixel per CSS pixel (down to half) to keep the frame rate.
    const dpr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, 2) * quality);
    const w = Math.round(Math.floor(cssW) * dpr);
    const h = Math.round(Math.floor(cssH) * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    // Keep preview text at least ~12.5 CSS px (the HUD is 19 units at full size).
    const u = Math.sqrt((w * h) / (1080 * 1920));
    textScale = Math.max(1, Math.min(2.6, (12.5 * dpr) / (19 * u)));
  }

  let lastHighlight = -2;
  let lastDom = 0;
  function tick() {
    // Loop + new seed: just before the loop wraps, build the next seed's piece and hand the audio over
    // to it exactly on the boundary; once it has taken over, the picture and controls follow.
    if (loopReroll && player.playing && score.loop && !pendingPass) {
      const raw = player.time();
      const L = score.timeline.end;
      const boundary = (Math.floor(raw / L + 1e-9) + 1) * L;
      if (boundary - raw < 1.2) {
        const nextState = { ...state, seed: formatSeed(randomSeed()) };
        try {
          const next = generateScore(nextState);
          if (next.loop && next.startNote === score.startNote && player.chain(next, boundary)) pendingPass = { next, nextState };
        } catch {
          /* keep looping the current seed */
        }
      }
    }
    if (pendingPass && player.takeSwitch()) {
      state = pendingPass.nextState;
      score = pendingPass.next;
      pendingPass = null;
      pausedAt = 0;
      keySelect.options[0].textContent = state.key === 'auto' ? `Auto (${score.keyName})` : 'Auto (seeded)';
      renderedRows = 0;
      list.innerHTML = '';
      renderList();
      writeForm();
      saveHash();
      setStatus(`New seed ${score.seedLabel}: ${score.chords.map((c) => c.name).join(' → ')}`);
    }
    let t = currentTime();
    const end = score.timeline.end;
    if (player.playing && Number.isFinite(end) && t >= end && !score.loop) {
      if (recording) recording.recorder.stop();
      else pause();
      pausedAt = end;
      t = end;
    }
    score.extend(t);
    if (score.endless && score.chords.length + 1 > renderedRows) renderList();
    adaptQuality(performance.now());
    updateMeter(performance.now());
    resizeCanvas();
    renderFrame(ctx, viewScore(), t, { textScale, lite: quality < 0.85 });
    if (recording) renderFrame(recording.canvas.getContext('2d')!, viewScore(), t);
    // DOM updates are throttled; layout work every frame adds up on phones.
    const nowMs = performance.now();
    if (nowMs - lastDom > 100 || !player.playing) {
      lastDom = nowMs;
      const scrubMax = Number.isFinite(end) ? end : Math.max(30, t + 10, score.chords.at(-1)?.t ?? 0);
      scrub.max = String(scrubMax);
      if (document.activeElement !== scrub) scrub.value = String(t);
      clock.textContent = `${fmt(t)} / ${Number.isFinite(end) ? fmt(end) : '∞'}`;
    }

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
  applyAutoFormat();
  syncThemeUi();
  writeForm();
  refreshProjects();
  rebuild(false);
  void fontsReady.then(() => requestAnimationFrame(tick));
}

// Boot last, so every module-level constant above is initialised.
if (!new URLSearchParams(location.search).has('export')) startApp();
