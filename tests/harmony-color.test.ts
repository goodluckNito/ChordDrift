import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/engine';
import { harmonyHsl, harmonyKey } from '../src/render/harmony-color';

describe('harmony colours', () => {
  it('is a colour-lines option', () => {
    expect(resolveConfig({ theme: { colorBy: 'harmony' } } as never).theme.colorBy).toBe('harmony');
  });
  it('keeps the key in one hue family and sends outside notes across the wheel', () => {
    const k = harmonyKey(0, 'major', '#3399ff', '#ffffff', true);
    const dist = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    const anchor = harmonyHsl(60, k)[0];
    for (const p of [60, 62, 64, 65, 67, 69, 71]) expect(dist(harmonyHsl(p, k)[0], anchor)).toBeLessThanOrEqual(6 * k.step + 1e-6);
    expect(dist(harmonyHsl(61, k)[0], anchor)).toBeGreaterThan(60); // C♯ in C major jumps away
    expect(dist(harmonyHsl(67, k)[0], anchor)).toBeCloseTo(k.step, 6); // a fifth is a close shade
    expect(harmonyHsl(84, k)[2]).toBeGreaterThan(harmonyHsl(40, k)[2]); // higher is lighter
  });
  it('varies with the theme, and is stable for a theme', () => {
    const a = harmonyKey(0, 'major', '#3399ff', '#ffffff', true, '#101010');
    const b = harmonyKey(0, 'major', '#ff5533', '#ffffff', true, '#f0f0f0');
    expect(harmonyKey(0, 'major', '#3399ff', '#ffffff', true, '#101010')).toEqual(a);
    expect([a.step, a.out, a.sat]).not.toEqual([b.step, b.out, b.sat]);
  });
});
