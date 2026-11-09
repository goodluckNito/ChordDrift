// Musical health check over many seeds: movement per change, repeats, variety, and generation speed.
//   npm run stats                 all modes × complexities
//   npm run stats -- drift 5      one mode / complexity
import { generateScore, type ChordDriftConfig } from '../src/engine';

const modes = (process.argv[2] ? [process.argv[2]] : ['scale', 'drift', 'voiceled']) as ChordDriftConfig['mode'][];
const levels = process.argv[3] ? [Number(process.argv[3])] : [1, 2, 3, 4, 5];
const N = 60;
const pcs = (c: { root: number; intervals: number[] }) => [...new Set(c.intervals.map((i) => (c.root + i) % 12))].sort((a, b) => a - b).join(',');

console.log('mode      cx  moved/13  samePCs%  recent%  distinct%  topHeld%  ms/chord');
for (const mode of modes) {
  for (const complexity of levels) {
    let changes = 0, moved = 0, samePcs = 0, recent = 0, topHeld = 0, distinct = 0, total = 0, chords = 0;
    const t0 = performance.now();
    for (let seed = 1; seed <= N; seed++) {
      const s = generateScore({ seed, mode, complexity, endless: true });
      s.extend(80);
      chords += s.chords.length;
      const keys = s.chords.map((c) => `${c.root}|${pcs(c)}`);
      distinct += new Set(keys).size;
      total += keys.length;
      for (let k = 1; k < s.chords.length; k++) {
        const a = s.chords[k - 1], b = s.chords[k];
        changes++;
        moved += b.notes.filter((n, i) => n !== a.notes[i]).length;
        if (pcs(a) === pcs(b)) samePcs++;
        if (keys.slice(Math.max(0, k - 4), k).includes(keys[k])) recent++;
        if (a.notes.at(-1) === b.notes.at(-1)) topHeld++;
      }
    }
    const ms = (performance.now() - t0) / chords;
    const pct = (x: number, of: number) => ((100 * x) / of).toFixed(0).padStart(7);
    console.log(`${mode.padEnd(9)} ${complexity}   ${(moved / changes).toFixed(2).padStart(6)}  ${pct(samePcs, changes)}  ${pct(recent, changes)}  ${pct(distinct, total).padStart(8)}  ${pct(topHeld, changes).padStart(7)}  ${ms.toFixed(1).padStart(7)}`);
  }
}
