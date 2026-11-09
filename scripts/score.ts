/**
 * Print the score for one or more seeds.
 *   npm run score -- 0xF5E68707 12345 --mode drift --key C
 */
import { generateScore, midiToHz, noteName, type ChordDriftConfig, type DeepPartial } from '../src/engine';

const args = process.argv.slice(2);
const seeds: string[] = [];
const patch: DeepPartial<ChordDriftConfig> = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--mode') patch.mode = args[++i] as ChordDriftConfig['mode'];
  else if (a === '--key') patch.key = args[++i];
  else if (a === '--drift') patch.driftProbability = Number(args[++i]);
  else if (a === '--voices') patch.voices = Number(args[++i]);
  else seeds.push(a);
}
if (!seeds.length) seeds.push('0xF5E68707');

for (const seed of seeds) {
  const s = generateScore({ ...patch, seed });
  const kn = s.keyPc;
  console.log(`\nseed ${s.seedLabel} · ${s.config.mode} · key ${s.keyName} · ${s.chords.length} chords · ${s.timeline.end.toFixed(2)} s`);
  console.log(`  ${'0.00'.padStart(6)}s  ${'unison'.padEnd(9)} ${''.padEnd(16)} all on ${noteName(s.startNote, kn)} (${midiToHz(s.startNote).toFixed(2)} Hz)`);
  let prev = new Array(s.config.voices).fill(s.startNote);
  for (const c of s.chords) {
    const moved = c.notes.filter((n, i) => n !== prev[i]).length;
    const notes = c.notes.map((n) => noteName(n, c.keyPc)).join(' ');
    console.log(`  ${c.t.toFixed(2).padStart(6)}s  ${c.name.padEnd(9)} ${c.roman.padEnd(10)} ${c.origin.padEnd(9)} ${String(moved).padStart(2)} moved  ${notes}`);
    prev = c.notes;
  }
  console.log(`  ${s.timeline.arrivalStart.toFixed(2).padStart(6)}s  → ${noteName(s.endNote, s.finalKeyPc)} (${midiToHz(s.endNote).toFixed(2)} Hz)`);
}
