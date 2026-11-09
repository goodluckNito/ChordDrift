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
    expect(encodeShare(cfg)).toBe('t=velvet+harbor');
    const other = resolveConfig({ ...cfg, seed: 1234 });
    const y = encodeShare(other);
    expect(y.startsWith('y=')).toBe(true);
    // Numbers are rounded to 4 decimals in links, so compare re-encoded links.
    expect(encodeShare(resolveConfig(decodeShare(y)!))).toBe(y);
    expect(resolveConfig(decodeShare(y)!).scale).toBe(other.scale);
    const plain = btoa(JSON.stringify(configDiff(other))).length;
    expect(y.length).toBeLessThan(plain * 0.6);
  });
});

describe('compact links', () => {
  it('encodes an edited word song as the words plus the change, and round-trips', async () => {
    const { songFromText } = await import('../src/engine');
    const base = resolveConfig(songFromText('midnight motel'));
    expect(encodeShare(base)).toBe('t=midnight+motel');
    const edited = resolveConfig({ ...base, voices: 5, audio: { ...base.audio, reverb: 0.2 } });
    const code = encodeShare(edited);
    expect(code.startsWith('t=midnight+motel&d=')).toBe(true);
    expect(code.length).toBeLessThan(70);
    expect(resolveConfig(decodeShare(code)!)).toEqual(edited);
  });

  it('uses short keys for other links and still opens old z= links', async () => {
    const cfg = resolveConfig({ seed: 99, scale: 'dorian', resolution: 0.7, theme: { preset: 'hex' }, drums: { enabled: true } });
    const code = encodeShare(cfg);
    expect(code.startsWith('y=')).toBe(true);
    expect(resolveConfig(decodeShare(code)!).scale).toBe('dorian');
    const { compressToEncodedURIComponent } = await import('lz-string');
    const old = 'z=' + compressToEncodedURIComponent(JSON.stringify(configDiff(cfg)));
    expect(resolveConfig(decodeShare(old)!)).toEqual(resolveConfig(decodeShare(code)!));
    expect(code.length).toBeLessThan(old.length);
  });
});

describe('song moods', () => {
  it('keeps chill songs on familiar ground, and leaves adventurous songs as they were', async () => {
    const { songFromText } = await import('../src/engine');
    for (const words of ['quiet harbor', 'neon chapel', 'salt meadow', 'feral comet', 'paper reef', 'lunar motel']) {
      const c = resolveConfig(songFromText(words, 'chill'));
      expect(['major', 'minor', 'dorian', 'mixolydian']).toContain(c.scale);
      expect(c.complexity).toBeLessThanOrEqual(4);
      expect(c.mode).not.toBe('voiceled');
      expect(['none', 'pop', 'classical', 'cinematic', 'gospel']).toContain(c.style);
    }
    const adv = resolveConfig(songFromText('rusted comet'));
    expect([adv.key, adv.scale, adv.style, adv.rhythm.tempo]).toEqual(['E', 'major', 'cinematic', 97]);
  });

  it('links chill songs as w= and round-trips them', async () => {
    const { songFromText } = await import('../src/engine');
    const { shareMood } = await import('../src/project');
    const c = resolveConfig(songFromText('quiet harbor', 'chill'));
    expect(encodeShare(c)).toBe('w=quiet+harbor');
    expect(shareMood('w=quiet+harbor')).toBe('chill');
    expect(resolveConfig(decodeShare('w=quiet+harbor')!)).toEqual(c);
  });
});

describe('just chords', () => {
  it('is a bare chord progression with chill harmony, linked as p=', async () => {
    const { songFromText } = await import('../src/engine');
    for (const words of ['quiet harbor', 'neon chapel', 'feral comet']) {
      const p = resolveConfig(songFromText(words, 'pure'));
      const c = resolveConfig(songFromText(words, 'chill'));
      expect([p.drums.enabled, p.melody.enabled, p.chop.enabled, p.song.enabled, p.loop]).toEqual([false, false, false, false, false]);
      expect(p.motion.transition).toBe('glide');
      expect(p.video.view).toBe('timeline');
      // Same harmony as the chill song from the same words.
      expect([p.key, p.scale, p.style, p.mode, p.complexity, p.voices]).toEqual([c.key, c.scale, c.style, c.mode, c.complexity, c.voices]);
    }
    expect(encodeShare(resolveConfig(songFromText('quiet harbor', 'pure')))).toBe('p=quiet+harbor');
  });
});
