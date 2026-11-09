// Quick musical health check over many seeds: how many voices move per change,
// how often the top voice holds, how long pieces run.
import { generateScore, type ChordDriftConfig } from '../src/engine';
const mode = (process.argv[2] ?? 'scale') as ChordDriftConfig['mode'];
let changes = 0, moved = 0, topHeld = 0, dur = 0, maxMoved = 0;
const N = 200;
const t0 = Date.now();
for (let s = 1; s <= N; s++) {
  const sc = generateScore({ seed: s, mode });
  dur += sc.timeline.arrivalEnd;
  for (let k = 1; k < sc.chords.length; k++) {
    const a = sc.chords[k - 1].notes, b = sc.chords[k].notes;
    const m = b.filter((n, i) => n !== a[i]).length;
    changes++; moved += m; maxMoved = Math.max(maxMoved, m);
    if (a[a.length - 1] === b[b.length - 1]) topHeld++;
  }
}
console.log(`${mode}: avg moved ${(moved / changes).toFixed(2)}/13, max ${maxMoved}, top held ${(100 * topHeld / changes).toFixed(0)}%, avg music ${(dur / N).toFixed(1)} s, ${((Date.now() - t0) / N).toFixed(0)} ms/score`);
