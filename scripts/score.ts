/**
 * Print the score for one or more seeds.
 *   npm run score -- 0xF5E68707 12345 --mode drift --key C --scale dorian --complexity 4
 *   npm run score -- 1 --progression "I vi ? IV"
 */
import { generateScore, midiToHz, spellChordNote, spellNote, type ChordDriftConfig, type DeepPartial } from '../src/engine';

const args = process.argv.slice(2);
const seeds: string[] = [];
const patch: DeepPartial<ChordDriftConfig> = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--mode') patch.mode = args[++i] as ChordDriftConfig['mode'];
  else if (a === '--key') patch.key = args[++i];
  else if (a === '--scale') patch.scale = args[++i];
  else if (a === '--complexity') patch.complexity = Number(args[++i]);
  else if (a === '--progression') patch.progression = args[++i];
  else if (a === '--style') patch.style = args[++i] as ChordDriftConfig['style'];
  else if (a === '--drift') patch.driftProbability = Number(args[++i]);
  else if (a === '--voices') patch.voices = Number(args[++i]);
  else seeds.push(a);
}
if (!seeds.length) seeds.push('0xF5E68707');

for (const seed of seeds) {
  const s = generateScore({ ...patch, seed });
  console.log(`\nseed ${s.seedLabel} · ${s.config.mode} · ${s.keyName} ${s.scaleName} · complexity ${s.config.complexity} · ${s.chords.length} chords · ${s.timeline.end.toFixed(2)} s`);
  for (const e of s.errors) console.log(`  ! ${e}`);
  console.log(`  ${'0.00'.padStart(6)}s  ${'unison'.padEnd(12)} ${''.padEnd(14)} all on ${spellNote(s.startNote, s.keyPc, s.config.scale)} (${midiToHz(s.startNote).toFixed(2)} Hz)`);
  let prev = new Array(s.config.voices).fill(s.startNote);
  for (const c of s.chords) {
    const moved = c.notes.filter((n, i) => n !== prev[i]).length;
    const notes = c.notes.map((n) => spellChordNote(n, c)).join(' ');
    console.log(`  ${c.t.toFixed(2).padStart(6)}s  ${c.name.padEnd(12)} ${c.roman.padEnd(14)} ${c.origin.padEnd(8)} ${String(moved).padStart(2)} moved  ${notes}`);
    prev = c.notes;
  }
  console.log(`  ${s.timeline.arrivalStart.toFixed(2).padStart(6)}s  → ${spellNote(s.endNote, s.finalKeyPc, s.config.scale)} (${midiToHz(s.endNote).toFixed(2)} Hz)`);
}
