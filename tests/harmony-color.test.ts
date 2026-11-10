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
    for (const p of [60, 62, 64, 65, 67, 69, 71]) expect(dist(harmonyHsl(p, k)[0], anchor)).toBeLessThanOrEqual(6 * 16);
    expect(dist(harmonyHsl(61, k)[0], anchor)).toBeGreaterThan(120); // C♯ in C major
    expect(dist(harmonyHsl(67, k)[0], anchor)).toBe(16); // a fifth is a close shade
    expect(harmonyHsl(84, k)[2]).toBeGreaterThan(harmonyHsl(40, k)[2]); // higher is lighter
  });
});
