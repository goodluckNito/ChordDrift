import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
/** Project save/load: browser library (localStorage), JSON files, and share links. */
import { DEFAULT_CONFIG, resolveConfig, songFromText, type ChordDriftConfig, type DeepPartial, type SongMood } from './engine';

export interface Project {
  app: 'chord-drift';
  version: 1;
  name: string;
  savedAt: string;
  config: ChordDriftConfig;
}

const STORE_KEY = 'chord-drift.projects';

function readStore(): Record<string, Project> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeStore(data: Record<string, Project>) {
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

export function makeProject(name: string, config: ChordDriftConfig): Project {
  return { app: 'chord-drift', version: 1, name, savedAt: new Date().toISOString(), config: structuredClone(config) };
}

export function listProjects(): Project[] {
  return Object.values(readStore()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function saveProject(name: string, config: ChordDriftConfig): void {
  const data = readStore();
  data[name] = makeProject(name, config);
  writeStore(data);
}

export function deleteProject(name: string): void {
  try {
    const data = readStore();
    delete data[name];
    writeStore(data);
  } catch {
    /* storage unavailable */
  }
}

export function exportProject(name: string, config: ChordDriftConfig): string {
  return JSON.stringify(makeProject(name, config), null, 2);
}

/** Accepts a saved project file or a bare config object. */
export function parseProject(text: string): Project {
  const data = JSON.parse(text);
  if (data && data.app === 'chord-drift' && data.config) return { ...data, config: resolveConfig(data.config) };
  if (data && typeof data === 'object' && ('seed' in data || 'progression' in data || 'scale' in data)) {
    return makeProject(String(data.title ?? 'Imported'), resolveConfig(data));
  }
  throw new Error('not a Chord Drift project');
}

/** Only the fields that differ from the defaults, so share links stay short. */
export function configDiff(config: ChordDriftConfig, base: unknown = DEFAULT_CONFIG): DeepPartial<ChordDriftConfig> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    const b = (base as Record<string, unknown>)[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const d = configDiff(v as ChordDriftConfig, b ?? {});
      if (Object.keys(d).length) out[k] = d;
    } else if (JSON.stringify(v) !== JSON.stringify(b)) out[k] = v;
  }
  return out as DeepPartial<ChordDriftConfig>;
}

/** Older links (c=…) are plain base64url JSON. */
const fromBase64Url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

/**
 * Short names for config keys in links (fixed, so old links keep working; unknown keys pass
 * through unchanged). Numbers are rounded to 4 decimals.
 */
const SHORT: Record<string, string> = {
  seed: 's', key: 'k', scale: 'sc', mode: 'm', complexity: 'cx', style: 'st', progression: 'p', endless: 'e', loop: 'l',
  driftProbability: 'dp', chordCount: 'cc', smoothness: 'sm', resolution: 'rs', startNote: 'sn', endNote: 'en', voices: 'v',
  timing: 'ti', voicing: 'vo', motion: 'mo', rhythm: 'r', melody: 'me', audio: 'a', theme: 'th', drums: 'd', video: 'vi', song: 'so', chop: 'ch',
  enabled: 'on', pattern: 'pa', form: 'f', tempo: 't', chords: 'c', pluck: 'pl', density: 'de', level: 'lv', register: 'rg', glide: 'gl',
  wave: 'w', detuneCents: 'dt', reverb: 'rv', lowpass: 'lp', width: 'wd', height: 'ht', swell: 'sw', swellDepth: 'sd', attack: 'at', decay: 'dc',
  sustain: 'su', warmth: 'wm', bass: 'bs', sub: 'sb', tilt: 'tl', gain: 'gn', envelope: 'ev', transition: 'tr', easing: 'ez', inversion: 'iv',
  background: 'bg', background2: 'bg2', gradient: 'gr', ink: 'i', accent: 'ac', text: 'tx', lights: 'li', font: 'fo', lineWidth: 'lw', colorBy: 'cb',
  palette: 'pt', colorSeed: 'cs', preset: 'pr', glow: 'gw', grid: 'gd', ripples: 'rp', hud: 'hu', labels: 'lb', kit: 'kt', kick: 'kk',
  snare: 'sr', hat: 'h', crash: 'cr', ride: 'rd', levels: 'lvs', double: 'db', duck: 'dk', depth: 'dh', release: 'rl', view: 'vw', spiral: 'sp',
  zoom: 'z', centerLabel: 'cl', fps: 'fp', hold: 'ho', bloom: 'bl', intro: 'in', arrival: 'ar', outro: 'ou', stagger: 'sg',
  swellIn: 'si', holdJitter: 'hj', finalHold: 'fh', zoomTime: 'zt', historySeconds: 'hs', nowPosition: 'np',
};
const LONG = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k]));

function pack(x: unknown): unknown {
  if (typeof x === 'number') return Math.round(x * 1e4) / 1e4;
  if (Array.isArray(x)) return x.map(pack);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [SHORT[k] ?? k, pack(v)]));
  return x;
}
function unpack(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(unpack);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [LONG[k] ?? k, unpack(v)]));
  return x;
}

function merge(base: unknown, over: unknown): unknown {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out: Record<string, unknown> = { ...((base && typeof base === 'object' ? base : {}) as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) out[k] = merge(out[k], v);
  return out;
}

/** The words of a seed made from words (not a hex or decimal number), or null. */
function seedWords(seed: string | number): string | null {
  if (typeof seed !== 'string') return null;
  const s = seed.trim();
  return s && !/^0x[0-9a-f]{1,8}$/i.test(s) && !/^\d{1,10}$/.test(s) ? s : null;
}

/** The song those words make, in the given output format (what "Make" produces). */
function wordsBase(words: string, video: { width: number; height: number; fps: number }, mood: SongMood): ChordDriftConfig {
  const patch = songFromText(words, mood);
  return resolveConfig({ ...patch, video: { ...(patch.video ?? {}), width: video.width, height: video.height, fps: video.fps } } as DeepPartial<ChordDriftConfig>);
}

/**
 * Share code for the URL hash, whichever is shorter: the settings that differ from the defaults
 * (y=…, short keys, compressed), or — when the seed is words — the words plus whatever differs
 * from the song those words make (t=words&d=…, or just t=words).
 */
export function encodeShare(config: ChordDriftConfig): string {
  const diff = configDiff(config);
  const plain = Object.keys(diff).length ? 'y=' + compressToEncodedURIComponent(JSON.stringify(pack(diff))) : '';
  const words = seedWords(config.seed);
  if (!words) return plain;
  let best = plain;
  for (const mood of ['pure', 'chill', 'adventurous'] as SongMood[]) {
    const d = configDiff(config, wordsBase(words, config.video, mood));
    const viaWords = encodeTextShare(words, mood) + (Object.keys(d).length ? '&d=' + compressToEncodedURIComponent(JSON.stringify(pack(d))) : '');
    if (!best || viaWords.length < best.length) best = viaWords;
  }
  return best;
}

/** The words of a word-song share code (w=… chill, t=… adventurous), or null. */
export function shareText(hash: string): string | null {
  if (!shareMood(hash)) return null;
  try {
    const end = hash.indexOf('&');
    return decodeURIComponent(hash.slice(2, end >= 0 ? end : undefined).replace(/\+/g, ' ')).trim() || null;
  } catch {
    return null;
  }
}

/** The mood of a word-song share code. */
export function shareMood(hash: string): SongMood | null {
  return hash.startsWith('p=') ? 'pure' : hash.startsWith('w=') ? 'chill' : hash.startsWith('t=') ? 'adventurous' : null;
}

/** Share code for a song made from words: p= just chords, w= chill, t= adventurous. */
export function encodeTextShare(text: string, mood: SongMood = 'adventurous'): string {
  return (mood === 'pure' ? 'p=' : mood === 'chill' ? 'w=' : 't=') + encodeURIComponent(text.trim()).replace(/%20/g, '+');
}

export function decodeShare(hash: string): DeepPartial<ChordDriftConfig> | null {
  // Compressed (z=…): read raw, since its alphabet includes '+'.
  if (hash.startsWith('z=')) {
    try {
      const json = decompressFromEncodedURIComponent(hash.slice(2));
      return json ? JSON.parse(json) : null;
    } catch {
      return null;
    }
  }
  // Short keys, compressed (y=…).
  if (hash.startsWith('y=')) {
    try {
      const json = decompressFromEncodedURIComponent(hash.slice(2));
      return json ? (unpack(JSON.parse(json)) as DeepPartial<ChordDriftConfig>) : null;
    } catch {
      return null;
    }
  }
  // A song from words (w=… chill, t=… adventurous), plus any changes to it (&d=…).
  if (shareMood(hash)) {
    const text = shareText(hash);
    if (!text) return null;
    const amp = hash.indexOf('&d=');
    let changes: unknown = {};
    if (amp >= 0) {
      try {
        changes = unpack(JSON.parse(decompressFromEncodedURIComponent(hash.slice(amp + 3)) ?? '{}'));
      } catch {
        changes = {};
      }
    }
    return merge(songFromText(text, shareMood(hash) ?? 'adventurous'), changes) as DeepPartial<ChordDriftConfig>;
  }
  const params = new URLSearchParams(hash);
  const c = params.get('c');
  if (c) {
    try {
      return JSON.parse(fromBase64Url(c));
    } catch {
      return null;
    }
  }
  // Older style: #seed=0x...
  const seed = params.get('seed');
  return seed ? { seed } : null;
}
