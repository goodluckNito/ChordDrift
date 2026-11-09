import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
/** Project save/load: browser library (localStorage), JSON files, and share links. */
import { DEFAULT_CONFIG, resolveConfig, songFromText, type ChordDriftConfig, type DeepPartial } from './engine';

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

/** Share code for the URL hash: the settings that differ from the defaults, compressed (z=…). */
export function encodeShare(config: ChordDriftConfig): string {
  const diff = configDiff(config);
  return Object.keys(diff).length ? 'z=' + compressToEncodedURIComponent(JSON.stringify(diff)) : '';
}

/** The words of a t=… share code, or null. */
export function shareText(hash: string): string | null {
  if (!hash.startsWith('t=')) return null;
  try {
    return decodeURIComponent(hash.slice(2).replace(/\+/g, ' ')).trim() || null;
  } catch {
    return null;
  }
}

/** Share code for a song made from words. */
export function encodeTextShare(text: string): string {
  return 't=' + encodeURIComponent(text.trim()).replace(/%20/g, '+');
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
  // A song from words (t=…).
  if (hash.startsWith('t=')) {
    const text = shareText(hash);
    return text ? songFromText(text) : null;
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
