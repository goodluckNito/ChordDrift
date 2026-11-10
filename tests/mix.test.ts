import { describe, expect, it } from 'vitest';
import { generateScore } from '../src/engine';
import { DRUM_REF_LEVEL, drumBusGain, drumTrim } from '../src/audio/mix';

const dB = (x: number) => 20 * Math.log10(x);
const drums = (extra: Record<string, unknown>) =>
  generateScore({ seed: 3, rhythm: { tempo: 90 }, drums: { enabled: true, kick: 'x...x...', snare: '....x...', hat: 'x.x.x.x.', crash: '', ride: '', ...extra } });

describe('drum balance', () => {
  it('trims quiet drums up and loud ones down', () => {
    expect(dB(drumTrim('acoustic', { voice: 'kick' }))).toBeGreaterThan(6); // the weak acoustic kick
    expect(dB(drumTrim('witch', { voice: 'kick' }))).toBeLessThan(-3); // the huge witch kick
    expect(dB(drumTrim('808', { voice: 'hat' }))).toBeGreaterThan(20); // the near-silent 808 hat
    expect(drumTrim('808', { voice: 'hat', open: true })).not.toBe(drumTrim('808', { voice: 'hat' }));
  });

  it('turns busy patterns down and sparse ones up, so the drums sit at one level', () => {
    const busy = drumBusGain(drums({ kick: 'x.x.x.x.', snare: '..x...x.', hat: 'xxxxxxxx' }));
    const sparse = drumBusGain(drums({ kick: 'x...............', snare: '', hat: '' }));
    expect(dB(sparse) - dB(busy)).toBeGreaterThan(3);
  });

  it('compensates for the kit, and the level slider scales from the reference', () => {
    const a = drumBusGain(drums({ kit: 'acoustic' }));
    const w = drumBusGain(drums({ kit: 'witch' }));
    expect(Math.abs(dB(a) - dB(w))).toBeLessThan(12);
    const ref = drumBusGain(drums({ level: DRUM_REF_LEVEL }));
    const half = drumBusGain(drums({ level: DRUM_REF_LEVEL / 2 }));
    expect(dB(ref) - dB(half)).toBeCloseTo(6.02, 1);
  });
});
