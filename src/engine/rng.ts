/**
 * Deterministic randomness. Every subsystem gets its own stream derived from
 * (seed, label), so changing e.g. the stagger code never changes which chords
 * a seed picks.
 */
export type Rng = () => number;

/** mulberry32: tiny, fast, good enough for music. Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit hash of (seed, label): FNV-1a over the bytes, then a murmur3 finalizer. */
export function hashSeed(seed: number, label: string): number {
  let h = 0x811c9dc5;
  const mix = (byte: number) => {
    h ^= byte & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  for (let i = 0; i < 4; i++) mix(seed >>> (i * 8));
  for (let i = 0; i < label.length; i++) {
    const c = label.charCodeAt(i);
    mix(c);
    mix(c >>> 8);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function stream(seed: number, label: string): Rng {
  return mulberry32(hashSeed(seed, label));
}

/** Accepts "0xF5E68707", "4125525767", 4125525767, or any other string (hashed). */
export function parseSeed(input: string | number): number {
  if (typeof input === 'number') return input >>> 0;
  const s = input.trim();
  if (/^0x[0-9a-f]{1,8}$/i.test(s)) return parseInt(s.slice(2), 16) >>> 0;
  if (/^\d{1,10}$/.test(s) && Number(s) <= 0xffffffff) return Number(s) >>> 0;
  return hashSeed(0, s);
}

export function formatSeed(seed: number): string {
  return '0x' + (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export function randomSeed(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

export const uniform = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();

/** Integer in [lo, hi], inclusive. */
export const randInt = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

export function weighted<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return pick(rng, items);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}
