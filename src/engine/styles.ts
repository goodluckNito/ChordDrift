/**
 * Styles: structured, genre-flavoured progressions without writing them out.
 *
 * Instead of a chord-to-chord random walk, a style plans in 4-chord phrases:
 * phrase templates (written in the progression language, relative to the local
 * key), cadences at phrase ends, modulations between phrases with a
 * style-appropriate approach (V7, ii–V, pivot-free mediant jumps, a final
 * "truck driver" lift…), and a strong closing formula. Bare numerals in the
 * templates are coloured by the complexity setting (within the style's range).
 */
import { parseProgression, type ProgressionToken } from './progression-text';
import { weighted, type Rng } from './rng';
import { mod12, scaleSteps } from './theory';
import type { VoicingRules } from './voicing';

export type StyleId = 'none' | 'classical' | 'jazz' | 'pop' | 'cinematic' | 'gospel' | 'impressionist' | 'witchhouse' | 'occult';
type Mode = 'major' | 'minor';

interface Modulation {
  /** New tonic, in semitones above the current one. */
  semis: number;
  /** Key quality after the change; "same" keeps the current scale. */
  to?: Mode | 'same';
  /** Approach chords in the NEW key that replace the end of the previous phrase ('' = direct jump). */
  via: string;
  w: number;
  /** Only from keys of this quality. */
  from?: Mode;
}

export interface StyleDef {
  name: string;
  description: string;
  /** Complexity is clamped into this range. */
  complexity: [number, number];
  phrases: Record<Mode, string[]>;
  /** Closing formula; replaces the end of the last phrase. */
  final: Record<Mode, string[]>;
  modulations: Modulation[];
  /** Chance of a modulation at each phrase boundary. */
  modProb: number;
  /** Chance the next phrase repeats the previous template (loops). */
  repeatProb?: number;
  /** A last-section key change (pop's "truck driver"), with this probability. */
  finalLift?: { prob: number; options: Modulation[] };
  /** Come back to the home key for the final phrase. */
  returnHome: boolean;
  /** Approach used to return home. */
  returnVia: string;
  voicing?: Partial<VoicingRules>;
  /** Generative phrases (most phrases come from here; the templates above are references). */
  gen?: StyleGen;
}

/**
 * How a style writes its own phrases: a weighted chord vocabulary, preferred root motions
 * (semitones up from the previous root), phrase endings (half, deceptive, plagal…), occasional
 * "spark" chords from outside the usual palette, and how often a reference template is used.
 */
export interface StyleGen {
  vocab: Record<Mode, Record<string, number>>;
  motion: Record<number, number>;
  endings: Record<Mode, string[]>;
  sparks?: { prob: number; chords: Record<Mode, string[]> };
  templateProb: number;
}

export const STYLES: Record<Exclude<StyleId, 'none'>, StyleDef> = {
  classical: {
    name: 'Classical',
    description: 'Functional phrases with cadences; visits the dominant or relative key through its V7, then returns home for a ii–V7–I.',
    complexity: [1, 2],
    phrases: {
      major: ['I IV V I', 'I vi ii V', 'I ii V I', 'I IV I V', 'vi ii V I', 'I V vi IV', 'IV V iii vi', 'I iii IV V'],
      minor: ['i iv V i', 'i bVI iv V', 'i iio V i', 'i iv i V', 'bVI iv V i', 'i v bVI bIII'],
    },
    final: { major: ['ii V7 I', 'IV V7 I', 'vi ii V7 I'], minor: ['iv V7 i', 'iio V7 i', 'iv V7 I'] },
    modulations: [
      { semis: 7, to: 'same', via: 'V7', w: 3 },
      { semis: 9, to: 'minor', via: 'V7', w: 2, from: 'major' },
      { semis: 3, to: 'major', via: 'V7', w: 2, from: 'minor' },
      { semis: 5, to: 'same', via: 'V7', w: 1 },
    ],
    modProb: 0.6,
    returnHome: true,
    returnVia: 'V7',
  },
  jazz: {
    name: 'Jazz',
    description: 'ii–V–I chains, turnarounds and tritone subs; moves through keys a step or a third away by ii–V; ends on an altered dominant or a backdoor cadence.',
    complexity: [4, 5],
    phrases: {
      major: ['ii7 V7 Imaj7 VI7', 'Imaj7 vi7 ii7 V7', 'iii7 VI7 ii7 V7', 'Imaj7 IV7 iii7 VI7', 'ii7 bII7 Imaj7 VI7', 'IVmaj7 iv7 iii7 VI7'],
      minor: ['iim7b5 V7b9 im9 im9', 'im9 iv9 bVII13 bIIImaj7', 'bVImaj7 iim7b5 V7alt im9', 'im9 bVI7 iim7b5 V7b9'],
    },
    final: { major: ['ii9 V7alt Imaj9', 'iv9 bVII13 Imaj9', 'ii9 bII7 Imaj9'], minor: ['iim7b5 V7alt im9', 'iv9 V7b9 im9'] },
    modulations: [
      { semis: 2, via: 'ii7 V7', w: 2 },
      { semis: 10, via: 'ii7 V7', w: 2 },
      { semis: 3, via: 'ii7 V7', w: 1.5 },
      { semis: 8, via: 'ii7 V7', w: 1.5 },
      { semis: 5, via: 'ii7 V7', w: 1 },
    ],
    modProb: 0.55,
    returnHome: true,
    returnVia: 'ii7 V7',
    voicing: { pedalBonus: 0.5, movePenalty: 1.5 },
  },
  pop: {
    name: 'Pop',
    description: 'Four-chord loops that repeat like verses and choruses, often lifting up a half or whole step for the last chorus.',
    complexity: [1, 3],
    phrases: {
      major: ['I V vi IV', 'vi IV I V', 'I vi IV V', 'I IV vi V', 'IV I V vi', 'I V IV V'],
      minor: ['i bVI bIII bVII', 'i bVII bVI bVII', 'i iv bVI bVII', 'bVI bVII i i'],
    },
    final: { major: ['IV V I', 'vi IV V I'], minor: ['bVI bVII i', 'iv bVII i'] },
    modulations: [{ semis: 5, via: '', w: 1 }],
    modProb: 0.12,
    repeatProb: 0.65,
    finalLift: {
      prob: 0.7,
      options: [
        { semis: 1, via: '', w: 2 },
        { semis: 2, via: 'V7', w: 2 },
      ],
    },
    returnHome: false,
    returnVia: '',
  },
  cinematic: {
    name: 'Cinematic',
    description: 'Modal mixture and chromatic-mediant jumps to remote keys; ends with a ♭VI–♭VII–I that lands in major.',
    complexity: [2, 4],
    phrases: {
      major: ['I bVI bVII I', 'I III vi IV', 'I bIII IV I', 'vi IV I V', 'I bVII IV I'],
      minor: ['i bVI bIII bVII', 'i bVI iv V', 'i bIII bVII IV', 'i v bVI bIII', 'i bVI III V'],
    },
    final: { major: ['bVI bVII I'], minor: ['bVI bVII I', 'iv bVI bVII I'] },
    modulations: [
      { semis: 4, via: '', w: 2 },
      { semis: 8, via: '', w: 2 },
      { semis: 3, via: '', w: 1.5 },
      { semis: 9, via: '', w: 1.5 },
      { semis: 6, via: '', w: 0.4 },
    ],
    modProb: 0.65,
    returnHome: true,
    returnVia: '',
    voicing: { movePenalty: 1, bassWeight: 0.1, pedalBonus: 0.5 },
  },
  gospel: {
    name: 'Gospel',
    description: 'Secondary dominants, passing diminished chords and minor iv; keeps lifting up by half and whole steps; ends on an "amen" IV–iv–I.',
    complexity: [3, 5],
    phrases: {
      major: ['I III7 vi IV', 'IV iv I VI7', 'ii7 V7 I VI7', 'I I7 IV #ivo7', 'iii7 VI7 ii7 V7'],
      minor: ['i iv7 bVII7 bIIImaj7', 'iim7b5 V7 i i7', 'i bVI7 V7 i'],
    },
    final: { major: ['IV iv I', 'ii9 V13 I', 'IV #ivo7 I'], minor: ['iv bVI7 V7 i', 'iim7b5 V7b9 i'] },
    modulations: [
      { semis: 1, via: 'V7', w: 3 },
      { semis: 2, via: 'V7', w: 2 },
      { semis: 5, via: 'V7', w: 1 },
    ],
    modProb: 0.45,
    returnHome: false,
    returnVia: 'V7',
    voicing: { movePenalty: 1.5 },
  },
  impressionist: {
    name: 'Impressionist',
    description: 'Parallel maj7/maj9 chords sliding together (planing), Lydian colour, drifting by steps and thirds rather than cadencing.',
    complexity: [3, 5],
    phrases: {
      major: ['Imaj7 IImaj7 Imaj7 bVIImaj7', 'Imaj9 bIIImaj9 bVImaj9 IVmaj9', 'Imaj7#11 IImaj7 IIImaj7 #IVmaj7', 'Imaj9 vi9 IVmaj9 Imaj9', 'I6/9 bVII6/9 bVI6/9 bVII6/9'],
      minor: ['im9 bVIImaj9 bVImaj9 bVIImaj9', 'im9 IVmaj7#11 im9 bIIImaj7', 'im9 bIIImaj9 IVmaj9 im9'],
    },
    final: { major: ['bVIImaj9 Imaj7#11', 'IVmaj9 Imaj9'], minor: ['bVImaj9 bVIImaj9 im9'] },
    modulations: [
      { semis: 2, via: '', w: 2 },
      { semis: 4, via: '', w: 1.5 },
      { semis: 10, via: '', w: 1.5 },
      { semis: 8, via: '', w: 1 },
    ],
    modProb: 0.5,
    returnHome: true,
    returnVia: '',
    voicing: { strategy: 'parallel' },
  },
  witchhouse: {
    name: 'Witch house',
    description:
      'Dark minor phrases that fall by thirds and drop ♭6→5, with phrygian ♭II and the odd chromatic-mediant spark; loops come back often but keep changing a chord. Pair it with a slow tempo (half-time drums around 115–120 BPM), deep sub, dark tone and sidechain.',
    complexity: [2, 3],
    phrases: {
      // The reference (F minor): bass F–A♭–D♭–C = i–♭III–♭VI–V, falling thirds then the ♭6→5 half step.
      major: ['i bIII bVI V', 'i bVI bIII bVII', 'i bIII bVI bVI', 'i bVI iv V'],
      minor: ['i bIII bVI V', 'i bVI bIII bVII', 'i bIII bVI bVI', 'i bVI iv V'],
    },
    final: { major: ['bVI V i'], minor: ['bVI V i', 'iv V i'] },
    modulations: [
      { semis: 11, to: 'minor', via: '', w: 1 },
      { semis: 5, to: 'minor', via: '', w: 1 },
    ],
    modProb: 0.08,
    // Loops come back often, but usually with a chord changed.
    repeatProb: 0.6,
    returnHome: true,
    returnVia: '',
    voicing: { pedalBonus: 2.5, bassWeight: 0.2, movePenalty: 1.6 },
  },
  occult: {
    name: 'Occult (phrygian)',
    description:
      'Phrygian i–♭II sway, minor triads a tritone apart and minor-third cycles; lurches down a half step or by a tritone into other minor keys; ends on a phrygian ♭II–i. Always minor, with a droning top voice.',
    complexity: [1, 3],
    phrases: {
      // Deliberately minor even from a major key: the style is the darkness.
      major: ['i bII i bII', 'i bVII bVI V', 'i biii #iv vi', 'i #iv i #iv', 'i bvi iv bII', 'i bII bVII i', 'i iv bII V'],
      minor: ['i bII i bII', 'i bVII bVI V', 'i biii #iv vi', 'i #iv i #iv', 'i bvi iv bII', 'i bII bVII i', 'i iv bII V'],
    },
    final: { major: ['bII i', 'iv bII i', 'bvi bII i'], minor: ['bII i', 'iv bII i', 'bvi bII i'] },
    modulations: [
      { semis: 11, to: 'minor', via: '', w: 3 },
      { semis: 6, to: 'minor', via: '', w: 2 },
      { semis: 3, to: 'minor', via: '', w: 1.5 },
      { semis: 10, to: 'minor', via: '', w: 1 },
    ],
    modProb: 0.45,
    returnHome: true,
    returnVia: 'bII',
    voicing: { pedalBonus: 3, bassWeight: 0.1, movePenalty: 1.5 },
  },
};

const M = (major: Record<string, number>, minor: Record<string, number> = major) => ({ major, minor });
const E = (major: string[], minor: string[] = major) => ({ major, minor });

/** Generative vocabularies. The first entry of each is the tonic (openers favour it). */
const GEN: Record<Exclude<StyleId, 'none'>, StyleGen> = {
  classical: {
    vocab: M({ I: 5, IV: 3, V: 4, vi: 3, ii: 3, iii: 1, viio: 0.8 }, { i: 5, iv: 3, V: 4, bVI: 3, iio: 2, bIII: 2, bVII: 1, viio: 0.8 }),
    motion: { 5: 3, 7: 2, 9: 2.5, 8: 1.5, 2: 1.5, 3: 1, 10: 1, 4: 1, 1: 0.3, 11: 0.6, 6: 0.2 },
    endings: E(['V', 'IV V', 'ii V', 'V vi'], ['V', 'iv V', 'bVI V', 'V bVI']),
    sparks: { prob: 0.15, chords: E(['iv', 'bVI', 'III7', 'bVII'], ['bII', 'IV', 'I']) },
    templateProb: 0.3,
  },
  jazz: {
    vocab: M(
      { Imaj7: 4, ii7: 4, V7: 4, vi7: 3, iii7: 2, IVmaj7: 2, VI7: 2, II7: 1.5, bII7: 1, iv7: 1, bVII7: 1 },
      { im9: 4, iim7b5: 3, V7b9: 3, bVImaj7: 2, iv9: 2, bIIImaj7: 2, bVII13: 2, bII7: 1 },
    ),
    motion: { 5: 4, 7: 1, 11: 2, 9: 1.5, 2: 1, 3: 1, 6: 1, 10: 1, 8: 1, 4: 0.8, 1: 0.6 },
    endings: E(['ii7 V7', 'V7', 'bII7', 'iv7 bVII7'], ['iim7b5 V7b9', 'V7b9', 'bII7']),
    sparks: { prob: 0.25, chords: E(['bIIImaj7', 'bVImaj7', 'bVII7'], ['bII7', 'IV7']) },
    templateProb: 0.3,
  },
  pop: {
    vocab: M({ I: 5, V: 4, vi: 4, IV: 4, ii: 2, iii: 1, bVII: 1 }, { i: 5, bVI: 4, bIII: 4, bVII: 4, iv: 2, v: 1.5 }),
    motion: { 5: 2, 7: 2.5, 9: 2.5, 8: 2, 2: 1.5, 10: 1.5, 3: 1, 4: 1, 1: 0.2, 11: 0.6, 6: 0.1 },
    endings: E(['IV', 'V', 'IV V', 'vi V'], ['bVII', 'bVI bVII', 'iv']),
    sparks: { prob: 0.2, chords: E(['iv', 'bVI', 'bVII', 'II'], ['IV', 'V']) },
    templateProb: 0.35,
  },
  cinematic: {
    vocab: M({ I: 4, bVI: 3, IV: 3, iv: 2, bVII: 2, vi: 2, III: 1.5, bIII: 1 }, { i: 5, bVI: 4, bIII: 3, bVII: 3, iv: 3, V: 2, bII: 1, IV: 1 }),
    motion: { 8: 3, 4: 2.5, 3: 2, 9: 2, 5: 2, 7: 1.5, 10: 1.5, 2: 1, 1: 0.8, 11: 0.8, 6: 0.6 },
    endings: E(['bVI bVII', 'iv', 'IV iv', 'bVII'], ['bVI bVII', 'iv V', 'bVI V', 'bII']),
    sparks: { prob: 0.25, chords: E(['bIII', 'III', 'bVI'], ['IV', 'bII', 'I']) },
    templateProb: 0.3,
  },
  gospel: {
    vocab: M(
      { I: 4, IV: 4, ii7: 3, V7: 3, vi7: 3, iii7: 2, I7: 1.5, IVmaj7: 2, II7: 1.5, VI7: 1.5 },
      { i: 4, iv7: 3, bVImaj7: 2, V7: 3, bIII: 2, iio: 2 },
    ),
    motion: { 5: 3.5, 7: 1.5, 9: 2, 1: 1.5, 2: 1.5, 3: 1, 10: 1, 8: 1, 4: 1, 11: 1, 6: 0.6 },
    endings: E(['ii7 V7', 'iv', 'V7sus4 V7', 'IV I7'], ['iio V7', 'iv V7']),
    sparks: { prob: 0.3, chords: E(['III7', 'bVII9', 'iv6'], ['IV7', 'bII']) },
    templateProb: 0.3,
  },
  impressionist: {
    vocab: M(
      { Imaj7: 4, IVmaj7: 3, iii7: 2, vi9: 2, ii9: 2, bVIImaj7: 2, bVImaj7: 2, IImaj7: 1.5, V9sus4: 1.5, bIIImaj7: 1 },
      { im9: 4, ivm9: 2, bVImaj7: 3, bIIImaj7: 2, bVIImaj7: 2, IVmaj7: 1.5, iim9: 1 },
    ),
    motion: { 2: 2.5, 10: 2.5, 1: 1, 11: 1, 4: 2, 8: 2, 3: 1.5, 9: 1.5, 5: 1, 7: 1, 6: 1 },
    endings: E(['IVmaj7', 'bVIImaj7', 'V9sus4', 'IImaj7'], ['bVImaj7', 'IVmaj7', 'bVIImaj7']),
    sparks: { prob: 0.3, chords: E(['bIIImaj7', 'bVImaj7', 'IImaj7'], ['bIImaj7', 'IIImaj7']) },
    templateProb: 0.3,
  },
  witchhouse: {
    vocab: M({ i: 5, bVI: 4, bIII: 3, iv: 3, V: 2, v: 2, bVII: 2, bII: 1, iio: 0.6 }),
    // Falling thirds (8, 9), the ♭6→5 half-step drop (11), fourths and fifths.
    motion: { 8: 3, 9: 3, 11: 2.5, 5: 2, 7: 1.2, 1: 1, 4: 0.8, 3: 1.2, 2: 0.8, 10: 1, 6: 0.5 },
    endings: E(['V', 'bVI V', 'bII', 'iv V', 'bVI']),
    sparks: { prob: 0.25, chords: E(['bII', 'IV', 'III', 'bvi']) },
    templateProb: 0.25,
  },
  occult: {
    vocab: M({ i: 5, bII: 4, bvi: 2, iv: 2, bVII: 2, '#iv': 2, biii: 1.5, bVI: 2, V: 1.5 }),
    motion: { 1: 3, 11: 3, 6: 2.5, 3: 2, 9: 2, 8: 1.5, 4: 1, 5: 1.2, 7: 1, 2: 0.8, 10: 1 },
    endings: E(['bII', 'bII i', 'V', '#iv']),
    sparks: { prob: 0.25, chords: E(['bv', 'vi', 'III']) },
    templateProb: 0.3,
  },
};
for (const [id, g] of Object.entries(GEN)) STYLES[id as Exclude<StyleId, 'none'>].gen = g;

export const STYLE_IDS = ['none', ...Object.keys(STYLES)] as StyleId[];

export interface PlanItem {
  token: ProgressionToken;
  tonic: number;
  scale: string;
  /** 'modulation' marks approach chords; keyChange marks the first chord heard in a new key. */
  origin: 'scale' | 'modulation' | 'cadence';
  keyChange: boolean;
}

const modeOf = (scale: string): Mode => {
  const s = scaleSteps(scale);
  return s.includes(3) && !s.includes(4) ? 'minor' : 'major';
};

const tokens = (text: string) => parseProgression(text).tokens;

export class StylePlanner {
  private tonic: number;
  private scale: string;
  private lastTemplate: string | null = null;
  private lastText: string | null = null;
  private phrasesAway = 0;
  private phraseCount = 0;
  private pendingKeyChange = false;

  constructor(
    private style: StyleDef,
    private homeTonic: number,
    private homeScale: string,
    private rng: Rng,
  ) {
    this.tonic = homeTonic;
    this.scale = homeScale;
  }

  private get mode(): Mode {
    return modeOf(this.scale);
  }

  private pickTemplate(): string {
    const list = this.style.phrases[this.mode];
    if (this.lastTemplate && list.includes(this.lastTemplate) && this.rng() < (this.style.repeatProb ?? 0)) return this.lastTemplate;
    const options = list.filter((t) => t !== this.lastTemplate);
    const t = options[Math.floor(this.rng() * options.length)] ?? list[0];
    this.lastTemplate = t;
    return t;
  }

  /**
   * The next phrase's chords: a loop repeat (sometimes with one chord changed), a reference
   * template now and then, or a phrase generated from the style's vocabulary.
   */
  private phraseText(): string {
    const g = this.style.gen;
    if (!g) return this.pickTemplate();
    if (this.lastText && this.rng() < (this.style.repeatProb ?? 0)) {
      if (this.rng() < 0.5) return this.lastText;
      return (this.lastText = this.vary(this.lastText, g));
    }
    const text = this.rng() < g.templateProb ? this.pickTemplate() : this.generate(g);
    this.lastText = text;
    return text;
  }

  private rootOf(numeral: string): number {
    const t = tokens(numeral)[0];
    if (!t || t.kind !== 'chord') return 0;
    const r = t.root;
    return r.kind === 'roman' || r.kind === 'offset' ? r.semitones : r.kind === 'absolute' ? mod12(r.pc - this.tonic) : 0;
  }

  /** A weighted next chord after `prev`, favouring the style's root motions and avoiding repeats. */
  private nextChord(g: StyleGen, prev: string | null, used: string[], tonicBoost = 1): string {
    const vocab = g.vocab[this.mode];
    const names = Object.keys(vocab);
    const weights = names.map((n, i) => {
      let w = vocab[n] * (i === 0 ? tonicBoost : 1);
      if (prev !== null) {
        w *= g.motion[mod12(this.rootOf(n) - this.rootOf(prev))] ?? 0.3;
        if (n === prev) w *= 0.03;
      }
      if (used.includes(n)) w *= 0.45;
      return w;
    });
    return weighted(this.rng, names, weights);
  }

  private generate(g: StyleGen): string {
    // Open on the tonic most of the time (the first vocabulary entry), then walk, then end.
    const chords: string[] = [this.nextChord(g, null, [], this.rng() < 0.65 ? 4 : 1)];
    for (let i = 1; i < 4; i++) chords.push(this.nextChord(g, chords[i - 1], chords));
    const endings = g.endings[this.mode];
    const end = endings[Math.floor(this.rng() * endings.length)].split(/\s+/).filter(Boolean);
    chords.splice(4 - end.length, end.length, ...end);
    if (g.sparks && this.rng() < g.sparks.prob) {
      const list = g.sparks.chords[this.mode];
      chords[1 + Math.floor(this.rng() * 2)] = list[Math.floor(this.rng() * list.length)];
    }
    return chords.join(' ');
  }

  /** The same phrase with one inner chord changed, so loops breathe. */
  private vary(text: string, g: StyleGen): string {
    const chords = text.split(/\s+/);
    if (chords.length < 3) return text;
    const i = 1 + Math.floor(this.rng() * (chords.length - 2));
    chords[i] = this.nextChord(g, chords[i - 1], chords);
    return chords.join(' ');
  }

  private items(text: string, origin: PlanItem['origin']): PlanItem[] {
    return tokens(text).map((token) => ({ token, tonic: this.tonic, scale: this.scale, origin, keyChange: false }));
  }

  /** Change key; approach chords (in the new key) replace the end of `prev`. */
  private modulate(mod: Modulation, prev: PlanItem[]) {
    const to = mod.to ?? 'same';
    this.tonic = mod12(this.tonic + mod.semis);
    if (to === 'major') this.scale = 'major';
    else if (to === 'minor') this.scale = 'minor';
    this.lastTemplate = null;
    this.lastText = null;
    const via = mod.via ? this.items(mod.via, 'modulation') : [];
    if (via.length) {
      prev.splice(Math.max(0, prev.length - via.length), via.length, ...via);
      via[0].keyChange = true;
    } else this.pendingKeyChange = true;
  }

  private chooseModulation(options: Modulation[]): Modulation | null {
    const ok = options.filter((m) => !m.from || m.from === this.mode);
    return ok.length ? weighted(this.rng, ok, ok.map((m) => m.w)) : null;
  }

  private homeReturn(): Modulation {
    const homeMode = modeOf(this.homeScale);
    return { semis: mod12(this.homeTonic - this.tonic), to: homeMode, via: this.style.returnVia, w: 1 };
  }

  private phrase(final: boolean): PlanItem[] {
    const items = this.items(this.phraseText(), 'scale');
    if (final) {
      const formulas = this.style.final[this.mode];
      const close = this.items(formulas[Math.floor(this.rng() * formulas.length)], 'cadence');
      items.splice(Math.max(0, items.length - close.length), close.length, ...close);
    }
    if (this.pendingKeyChange && items.length) {
      items[0].keyChange = true;
      this.pendingKeyChange = false;
    }
    return items;
  }

  private atHome(): boolean {
    return this.tonic === this.homeTonic && this.scale === this.homeScale;
  }

  /** A whole finite piece of `phrases` phrases, ending on the style's closing formula. */
  planPiece(phrases: number): PlanItem[] {
    const out: PlanItem[] = [];
    for (let p = 0; p < phrases; p++) {
      const last = p === phrases - 1;
      if (p > 0) {
        let mod: Modulation | null = null;
        if (last && this.style.returnHome && !this.atHome()) mod = this.homeReturn();
        else if (last && this.style.finalLift && this.rng() < this.style.finalLift.prob) mod = this.chooseModulation(this.style.finalLift.options);
        else if (!last && this.rng() < this.style.modProb) mod = this.chooseModulation(this.style.modulations);
        if (mod && mod.semis % 12 !== 0) this.modulate(mod, out);
      }
      out.push(...this.phrase(last));
    }
    return out;
  }

  /** The next phrase of an endless piece: modulates now and then, drifts home, and resolves strongly every few phrases. */
  nextPhrase(prev: PlanItem[]): PlanItem[] {
    this.phraseCount++;
    if (this.phraseCount > 1) {
      let mod: Modulation | null = null;
      const homeward = !this.atHome() && this.style.returnHome && this.rng() < 0.2 + 0.15 * this.phrasesAway;
      if (homeward) mod = this.homeReturn();
      else if (this.rng() < this.style.modProb * 0.8) mod = this.chooseModulation(this.style.modulations);
      if (mod && mod.semis % 12 !== 0) this.modulate(mod, prev);
    }
    this.phrasesAway = this.atHome() ? 0 : this.phrasesAway + 1;
    // Every fourth phrase closes with the style's cadence formula, giving endless runs structure.
    return this.phrase(this.phraseCount % 4 === 0);
  }
}
