import { describe, expect, it } from 'vitest';
import { resolveConfig, songFromText } from '../src/engine';

describe('views', () => {
  it('accepts the new views and opens retired ones in the nearest', () => {
    for (const v of ['marbling', 'murmur', 'chladni', 'constellation'] as const) expect(resolveConfig({ video: { view: v } }).video.view).toBe(v);
    expect(resolveConfig({ video: { view: 'tonnetz' as never } }).video.view).toBe('chladni');
    for (const old of ['fifths', 'compass', 'scope']) expect(resolveConfig({ video: { view: old as never } }).video.view).toBe('constellation');
    for (const old of ['transit', 'ferro', 'pendulum']) expect(resolveConfig({ video: { view: old as never } }).video.view).toBe('constellation');
  });
  it('word songs keep their music when the view changes', () => {
    const a = songFromText('distant harbor');
    expect(a.scale).toBe('hirajoshi');
    expect(a.rhythm?.tempo).toBe(70);
  });
});
