/**
 * Mix balance: how loud each drum is within its kit, and how loud the drums are as a whole
 * against the chords, from measurements rather than by ear per song.
 *
 * Each synthesized hit was rendered once (at a typical playing level) through a K-weighting filter (the
 * loudness-meter curve) to measure:
 *   energy  the whole hit, which is how a pattern's hits add up to the drums' loudness;
 *   punch   its first 250 ms, which is roughly how loud one hit sounds (short sounds are
 *           heard by their energy over about that long).
 * The kits turned out wildly uneven: the acoustic kick 11 dB weaker than the others with its
 * crash louder than its kick, the 808 and industrial hats nearly 40 dB under their kicks. So:
 *
 * 1. Every drum is trimmed to the same punch relative to its kit's kick (and every kick to the
 *    same punch), so a kit's balance comes from the drum levels, not from how it was synthesized.
 * 2. The drum bus is set from the song's actual pattern: the trimmed hits' energy over time
 *    predicts the drums' loudness, and the bus brings that to a fixed distance under the chords.
 *    A busy breakbeat and a lone kick on the one sit at the same level; the Drums level slider
 *    moves it from there.
 *
 * Re-measure with chordDrift.hitEnergy(kit, voice, open) in the browser console after changing a kit.
 */
import type { DrumHit, DrumVoice, KitId } from '../engine/drums';
import { drumHits, drumSpan, partSpans } from '../engine/motion';
import type { Score } from '../engine/score';

type HitKind = DrumVoice | 'open';

/** [energy, punch] per hit, measured at a typical playing level (0.7) and scaled to full level (K-weighted; see above). */
const HITS: Record<KitId, Record<HitKind, [number, number]>> = {
  '808': { kick: [0.1596, 0.6026], snare: [0.001251, 0.005005], hat: [1.778e-5, 7.11e-5], open: [0.000112, 0.0004481], crash: [0.02938, 0.104], ride: [0.002102, 0.008323] },
  witch: { kick: [0.7675, 1.852], snare: [0.0151, 0.0604], hat: [0.0008642, 0.003457], open: [0.006838, 0.02735], crash: [0.04858, 0.1432], ride: [0.003874, 0.01417] },
  acoustic: { kick: [0.01866, 0.07465], snare: [0.001997, 0.007989], hat: [0.001554, 0.006216], open: [0.01018, 0.04071], crash: [0.03403, 0.1141], ride: [0.003209, 0.0122] },
  industrial: { kick: [0.4009, 1.562], snare: [0.01528, 0.06113], hat: [2.87e-5, 0.0001148], open: [0.000159, 0.0006359], crash: [0.02681, 0.09824], ride: [0.001914, 0.007614] },
  jungle: { kick: [0.1057, 0.4229], snare: [0.03071, 0.1228], hat: [0.0009562, 0.003825], open: [0.005808, 0.02323], crash: [0.03149, 0.1095], ride: [0.002464, 0.009634] },
};

/**
 * Target punch per drum in dB, before the drum levels. With the default levels (kick 0.9,
 * snare 0.75, hat 0.4, crash 0.45, ride 0.4) a kit lands at about: kick 0, snare −1.5,
 * closed hat −13, open hat −10, crash −8, ride −11, like a mixed kit.
 */
const TARGET: Record<HitKind, number> = { kick: -3, snare: -3, hat: -9, open: -6, crash: -5, ride: -7 };

const db = (x: number) => 10 * Math.log10(x);
const kindOf = (h: Pick<DrumHit, 'voice' | 'open'>): HitKind => (h.voice === 'hat' && h.open ? 'open' : h.voice);

/** Amplitude trim for one drum of a kit, bringing its punch to the target (within ±30 dB). */
export function drumTrim(kit: KitId, h: Pick<DrumHit, 'voice' | 'open'>): number {
  const k = kindOf(h);
  const d = Math.max(-30, Math.min(30, TARGET[k] - db(HITS[kit][k][1])));
  return Math.pow(10, d / 20);
}

/**
 * Where the drums sit (ungated K-weighted loudness of the drum bus, LUFS-style) at the
 * reference drum level: about 3.5 LU under a typical chord bed (around −15 LUFS).
 */
// (Measured over eight word songs, −21 put the drums 0.6–4.9 LU under the chords, about 2.5 on
// average; −22 centres them about 3.5 under.)
const DRUM_TARGET = -22;
/** The drum level the target corresponds to; the slider scales from here. */
export const DRUM_REF_LEVEL = 0.65;

const busCache = new WeakMap<Score, { n: number; gain: number }>();

/**
 * Drum bus gain for this piece: the pattern's predicted loudness brought to the target, scaled
 * by the Drums level. Predicted from up to a minute of hits wherever the drums play.
 */
export function drumBusGain(score: Score): number {
  const d = score.config.drums;
  const level = d.level / DRUM_REF_LEVEL;
  const hit = busCache.get(score);
  if (hit && hit.n === score.chords.length) return hit.gain * level;
  const [s0, s1] = drumSpan(score);
  const a = s0;
  const b = Math.min(Number.isFinite(s1) ? s1 : s0 + 60, s0 + 60);
  // Time the drums actually play: in song mode only full parts (and parts given drums).
  const spans = score.sections.length ? partSpans(score).filter((sp) => (sp.drums ? sp.drums.length > 0 : sp.full)) : [{ a, b }];
  let W = 0;
  for (const sp of spans) W += Math.max(0, Math.min(b, sp.b) - Math.max(a, sp.a));
  let E = 0;
  if (W > 0.5) {
    for (const h of drumHits(score, a, b)) {
      if (!spans.some((sp) => h.t >= sp.a && h.t < sp.b)) continue;
      const k = kindOf(h);
      const amp = h.vel * d.levels[h.voice] * drumTrim(d.kit, h);
      E += HITS[d.kit][k][0] * amp * amp * (h.rate && h.rate < 1 ? 1 / Math.max(0.35, h.rate) : 1);
    }
  }
  // Predicted loudness of the bus at gain 1, brought to the target, but never moved more than
  // ±12 dB (a lone crash shouldn't be pumped up to a groove's level).
  const predicted = E > 0 ? -0.691 + db(E / W) : DRUM_TARGET;
  const g = Math.pow(10, Math.max(-12, Math.min(12, DRUM_TARGET - predicted)) / 20);
  busCache.set(score, { n: score.chords.length, gain: g });
  return g * level;
}
