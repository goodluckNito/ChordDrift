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

export type StyleId = 'none' | 'classical' | 'jazz' | 'pop' | 'cinematic' | 'gospel' | 'impressionist';
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
}

export const STYLES: Record<Exclude<StyleId, 'none'>, StyleDef> = {
  classical: {
    name: 'Classical',
    description: 'Functional phrases with cadences; visits the dominant or relative key through its V7, then returns home for a ii–V7–I.',
    complexity: [1, 2],
    phrases: {
      major: ['I IV V I', 'I vi ii V', 'I ii V I', 'I IV I V', 'vi ii V I', 'I V vi IV', 'IV V iii vi', 'I iii IV V'],
      minor: ['i iv V i', 'i VI iv V', 'i iio V i', 'i iv i V', 'VI iv V i', 'i v VI III'],
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
};

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
    const items = this.items(this.pickTemplate(), 'scale');
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
