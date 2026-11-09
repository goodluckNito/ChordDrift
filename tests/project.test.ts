import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/engine';
import { configDiff, decodeShare, encodeShare, exportProject, parseProject } from '../src/project';

describe('projects and share links', () => {
  it('round-trips a config through a share link', () => {
    const cfg = resolveConfig({ seed: '0xABCDEF01', scale: 'hirajoshi', progression: 'i9 ? bVII{0 4 7 14}', endless: true, timing: { hold: 3.1 } });
    const code = encodeShare(cfg);
    expect(resolveConfig(decodeShare(code)!)).toEqual(cfg);
  });
  it('keeps links short by storing only differences from the defaults', () => {
    expect(encodeShare(resolveConfig())).toBe('');
    expect(configDiff(resolveConfig({ timing: { hold: 3 } }))).toEqual({ timing: { hold: 3 } });
  });
  it('reads exported project files and bare configs', () => {
    const cfg = resolveConfig({ title: 'Test', mode: 'voiceled' });
    expect(parseProject(exportProject('Test', cfg)).config).toEqual(cfg);
    expect(parseProject(JSON.stringify({ seed: 5, scale: 'dorian' })).config.scale).toBe('dorian');
    expect(() => parseProject('{"hello":1}')).toThrow();
  });
  it('accepts legacy mode names', () => {
    expect(resolveConfig({ mode: 'diatonic' as never }).mode).toBe('scale');
    expect(resolveConfig({ mode: 'chromatic' as never }).mode).toBe('voiceled');
  });
});

describe('themes', () => {
  it('ships valid presets and keeps old melody colours', async () => {
    const { THEME_PRESETS } = await import('../src/engine');
    for (const [id, th] of Object.entries(THEME_PRESETS)) expect(resolveConfig({ theme: th }).theme, id).toEqual(th);
    expect(resolveConfig({ video: { melodyColor: '#123456' } } as never).theme.accent).toBe('#123456');
    expect(resolveConfig({ theme: { ink: 'not-a-colour', colorBy: 'nope' as never } }).theme.ink).toBe(THEME_PRESETS.paper.ink);
  });
});

describe('sound presets', () => {
  it('only change sound settings (envelope, swells, reverb, tone) and how chords change', async () => {
    const { AMBIENT_PRESET, PLUCK_PRESET, DARK_PRESET } = await import('../src/engine');
    for (const p of [AMBIENT_PRESET, PLUCK_PRESET, DARK_PRESET]) {
      for (const k of Object.keys(p)) expect(['audio', 'motion']).toContain(k);
      if (p.motion) expect(Object.keys(p.motion)).toEqual(['transition']);
    }
  });
});

describe('short links and songs from words', () => {
  it('makes the same song from the same words, and different songs from different words', async () => {
    const { songFromText } = await import('../src/engine');
    expect(resolveConfig(songFromText('rain on a tin roof'))).toEqual(resolveConfig(songFromText('  rain on a tin roof ')));
    expect(resolveConfig(songFromText('rain on a tin roof'))).not.toEqual(resolveConfig(songFromText('velvet harbor')));
  });

  it('round-trips word links and compressed links, and compresses well', async () => {
    const { encodeTextShare, shareText } = await import('../src/project');
    const code = encodeTextShare('rain on a tin roof');
    expect(code).toBe('t=rain+on+a+tin+roof');
    expect(shareText(code)).toBe('rain on a tin roof');
    const { songFromText } = await import('../src/engine');
    expect(resolveConfig(decodeShare(code)!)).toEqual(resolveConfig(songFromText('rain on a tin roof')));
    const cfg = resolveConfig(songFromText('velvet harbor'));
    const z = encodeShare(cfg);
    expect(z.startsWith('z=')).toBe(true);
    expect(resolveConfig(decodeShare(z)!)).toEqual(cfg);
    const plain = btoa(JSON.stringify(configDiff(cfg))).length;
    expect(z.length).toBeLessThan(plain * 0.75);
  });
});
