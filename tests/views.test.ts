import { describe, expect, it } from 'vitest';
import { resolveConfig, songFromText } from '../src/engine';

describe('views', () => {
  it('accepts the new views and opens retired ones in the nearest', () => {
    for (const v of ['marbling', 'tornado', 'city', 'constellation'] as const) expect(resolveConfig({ video: { view: v } }).video.view).toBe(v);
    for (const old of ['tonnetz', 'chladni', 'kaleido']) expect(resolveConfig({ video: { view: old as never } }).video.view).toBe('constellation');
    for (const old of ['fifths', 'compass', 'scope']) expect(resolveConfig({ video: { view: old as never } }).video.view).toBe('constellation');
    for (const old of ['transit', 'ferro', 'pendulum', 'lava']) expect(resolveConfig({ video: { view: old as never } }).video.view).toBe('constellation');
  });
  it('opens murmuration links in the tornado', () => {
    expect(resolveConfig({ video: { view: 'murmur' as never } }).video.view).toBe('tornado');
  });
  it('has two city looks', () => {
    expect(resolveConfig({ video: { view: 'city', city: 'blueprint' } }).video.city).toBe('blueprint');
    expect(resolveConfig({ video: { city: 'gotham' as never } }).video.city).toBe('neon');
  });
  it('word songs keep their music when the view changes', () => {
    const a = songFromText('distant harbor');
    expect(a.scale).toBe('hirajoshi');
    expect(a.rhythm?.tempo).toBe(70);
  });
});
