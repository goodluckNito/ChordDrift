# Chord Drift

A seeded tool for exploring chord progressions as voice-led glides. Thirteen sine voices start on one note, bloom into a chord, drift through a progression where each voice moves as little as possible, then rise together to a single note. The picture is each voice's pitch over time; the sound is the same function, so they never drift apart.

Pick a key and scale (35 of them, from Dorian to hirajoshi to octatonic), write chords in a key-agnostic language or let a generator choose, hear them, freeze them to text, tweak, save the project. Or switch on **endless** and let it wander forever.

## Quick start

```bash
npm install
npm run dev          # open the player at http://localhost:5173
```

Space plays/pauses, ← → seek, R rolls a new seed, M mutes. The ⛶ button fills the window, which suits desktops: the preview uses the whole stage, and text stays readable at any size. Under the transport there's a volume slider, remembered per device and never saved into projects or exports, and a stereo level meter: RMS bars, peak-hold ticks and a clip light.

**On your phone (same Wi-Fi):** run `npm run dev:lan` and open the `Network:` address it prints, e.g. `http://192.168.1.20:5173`. (`npm run dev --host` doesn't work because npm swallows the flag; the long form is `npm run dev -- --host`.) On Windows, allow Node.js through the firewall for **Private** networks the first time. If you dismissed that prompt, go to *Windows Security → Firewall → Allow an app* and tick Node.js under Private. Make sure your PC's network profile is Private, not Public. On iPhone, turn off the silent switch, because it mutes web audio.

## Hosting it on GitHub Pages

The repo includes a workflow (`.github/workflows/pages.yml`) that tests, builds and publishes the player on every push to `main`:

1. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
2. Push to `main`, or open **Actions → Deploy to GitHub Pages → Run workflow**.
3. The site appears at `https://<your-user>.github.io/<repo>/`. Share links (`#c=…`) work there too.

Pages on a private repo needs a paid GitHub plan; public repos are free.

## Exploring progressions

**Key & harmony**

| Control | What it does |
| --- | --- |
| Tonic + Scale | Any of 12 tonics × 35 scales: the church modes, harmonic/melodic minor modes, harmonic major, double harmonic, Hungarian, Neapolitan, Persian, enigmatic, pentatonics, hirajoshi, in-sen, iwato, blues, whole tone, Prometheus, augmented, octatonic, bebop. |
| Generator | **Key-locked** walks the scale's degrees. **+ borrowing** sometimes borrows from parallel modes, takes a chromatic mediant, or pivots to a neighbouring key. **Voice-led** allows any root and quality but strongly prefers the smoothest move. **Free** allows anything. |
| Complexity 1–5 | 1 is triads, 2 sevenths, 3 ninths and elevenths. 4 adds richer stacks with a little chromatic colour. 5 adds altered tensions (7♭9, 7alt, maj7♯5…) and secondary dominants that resolve to their target (V7/vi → vi). In a scale, chords are built by stacking every other scale note, so this works in *any* scale. Avoid notes (a minor 9th above a chord tone, like the 11th over a major 3rd) are dropped automatically. Generators avoid repeating recent chords and changes where almost nothing moves. |
| Smoothness | 0 is a pure random walk. Higher values prefer chords that share tones with the last one, so fewer voices move and the result is calmer. |
| Endless | Never arrive. Chords are generated on demand ahead of the playhead; a written progression loops, and each `?` is re-rolled every time round. |

**Styles (genres).** Instead of walking chord to chord, a style plans the piece in 4-chord phrases. Each phrase ends on a cadence, key changes happen between phrases using approaches suited to the style, and the piece closes on the style's strongest resolution. Voicing rules change with the style too. Complexity is kept within each style's range, and the chord count sets the number of phrases.

| Style | Phrases | Key changes | Ending |
| --- | --- | --- | --- |
| Classical | I–IV–V–I, I–vi–ii–V… | to the dominant or relative key via V7, then home | ii–V7–I (Picardy in minor) |
| Jazz | ii–V–I, turnarounds, tritone subs | by ii–V to keys a step or a third away | ii–V7alt–Imaj9 or backdoor |
| Pop | repeating 4-chord loops | a final-chorus lift up a half or whole step | IV–V–I |
| Cinematic | i–♭VI–♭III–♭VII, mediants | sudden chromatic-mediant jumps | ♭VI–♭VII–I |
| Gospel | I–III7–vi–IV, IV–iv–I, passing dim7 | lifts by half and whole steps | IV–iv–I "amen" |
| Impressionist | parallel maj7/maj9 planing | drifts by steps and thirds | ♭VII–Imaj7#11 (voices slide together) |
| Witch house (dark) | phrygian i–♭II, tritone-apart minor triads, lament bass, minor-third cycles | lurches down a half step, by a tritone or a minor third (always minor) | phrygian ♭II–i, with a droning top voice |

The score list marks every key change (e.g. `V7 (→ G major)`). Styles also run endlessly, closing a phrase with a cadence every four phrases and drifting home now and then.

**Writing chords.** The Progression box accepts any mix of:

```
Cmaj9 Am11 F#m7b5          absolute names ("C" alone is a C major triad)
I vi iii IV                 roman numerals from the tonic; bare = coloured automatically
Imaj9 vi11 bVII9 #ivø       numerals with qualities (lower case = minor: vi11 → m11)
1 6 3 4   4maj7   b7        scale degrees of the selected scale (any scale)
+9m11  +5                   semitones above the tonic
C{0 4 7 11 18}  +5{0 3 7}   any interval set from any root, fully key-agnostic
?                           let the generator choose this one
```

Separate chords with spaces, commas, `|`, `→` or `>`. Quality aliases like `Δ`, `ø`, `°` and `-7` work. Bare numerals and degrees are voiced from the scale at the current complexity, so `1 6 3 4` sounds right in Lydian, Phrygian dominant or hirajoshi alike.

- **Chords in this key** shows the chord on every degree of the current scale at the current complexity. Click one to hear it and append it to the progression.
- **Freeze chords to text** writes whatever is playing (generated or not) into the box as key-relative numerals. The text regenerates exactly the same chords, so you can generate, freeze, swap one chord for `?`, and keep exploring.

**Rhythm.** Set a tempo and a chord rhythm and the changes snap to a beat grid. Leave the rhythm empty for the default free timing. The same notation drives melodies:

```
w h q e s   (or 1 2 4 8 16 32)    whole … sixteenth
q.  h..                           dotted, double-dotted
et et et   ht   8t                triplets: three eighth-triplets fill one beat
h+e                               tie
rq  r8                            rest (in a chord rhythm it just holds the chord longer)
e*4   (q e e)*2                   repeat a note or group; patterns loop, | and , are ignored
```

For example, `q. e+h` is a Charleston, `q. q. q` a tresillo, and `ht ht ht` half-note triplets. Presets are in the Rhythm section.

**Melody.** Turn on a randomized lead line, drawn in red above the chords. It lands on chord tones on strong beats and whenever the harmony changes, and steps through the scale in between, skipping notes that clash a semitone above a chord tone. It moves with some momentum, leaps occasionally, and joins the final unison. You can give it a rhythm in the notation above, or leave that empty for a random rhythm at the chosen density. It can play throughout or only between chord changes. Register, wave, level and portamento are adjustable.

**Sound.** Choose sine, triangle, saw or square for the chords, and separately for the melody. Saw and square are level-matched, and the Brightness control sets the master low-pass.

**Chord changes.** By default the voices *glide* to the next chord. Switch Timing → Chord changes to **Release & swell in** and each chord instead fades out underneath the next one swelling in, with separate swell-in and release times. Audio uses two alternating sets of voices so chords overlap. In the picture, line *thickness* shows level, like hairpin dynamics: a new chord's notes grow out of a point while the old ones taper away, and the playhead dots grow and shrink with them. The opening bloom and the final arrival still glide.

**Swells (ambient).** Volume swells, with a depth control:
- *Swell into each chord:* each change dips, then the new chord blooms in.
- *Moving voices re-swell:* only the voices that move fade and come back, like re-bowed strings.
- *Slow breathing:* slow overlapping waves, independent of the chords.

Line thickness and dot size follow the level over time, in the video as well. **Ambient** sets soft swells into each chord, a dark triangle tone and deep reverb. Pair it with Release & swell in for crossfading chords.

**Articulation.** *Sustained* (default) holds each chord. *Pluck* re-strikes every chord change: a fast attack, then a decay to a low sustain level, so quick rhythms read as distinct hits. Glides happen *into* each strike: voices slide during the previous chord's quiet tail and land together on the change, so the hit is on the new chord and on the beat. Attack, decay and sustain are adjustable, and the lines show each strike. The sound presets (**Ambient**, **Pluck**, **Dark**) change only the sound: envelope, swells, reverb and tone. They never touch rhythm, timing, harmony or theme. **Default sound** resets just the sound.

**Themes.** Presets: Paper, Sepia, Midnight, Neon, Blueprint, Terminal, Chromatic, Sunset and Hex. You can also choose your own:
- **Colours:** background (optionally a gradient), lines, melody and text.
- **Font:** seven to choose from, loaded only when picked.
- **Line colouring:** one colour, per voice, per note (around the circle of fifths) or by height.
- **Extras:** line width, glow, an octave grid with note names, and switches for the Hz labels and HUD.

Themes are saved in projects and share links and used in video exports. **My theme:**
- *Save as my theme* keeps a look on this device.
- *Use my theme* shows every song in it, including shared links; the song keeps its own theme.
- *Apply my theme to this song* copies your look into the song, so links and exports carry it. **Reset all settings** returns everything to defaults but keeps the seed.

**Formats.** Theme → Format sets the frame. **Auto** (the default) picks landscape on wide screens and portrait on tall ones, and switches when you rotate or resize. You can also fix it to Portrait 9:16, Landscape 16:9, Square, Portrait 4:5 or Landscape 4K. The layout adapts: text scales with the frame, and wide frames show more history. Exports and recordings use this size.

**Spiral view.** Theme → View → Spiral wraps pitch around a spiral: one turn per octave with C at the top, so octaves line up and the current chord shows as a shape, named in the middle. **Spiral motion** has two settings:
- *Fly through* (default): depth is time, and you travel forward through it. Upcoming chords start small at the vanishing point and rush toward you; passed notes fly out past the edges. Held notes become slowly twisting helices, glides swing into their new intervals as they approach, and rings at every second and every chord change make the motion felt.
- *Curl inward*: the past shrinks and rotates toward the centre.

With release-and-swell changes, chords grow in and fade out on the spiral too. The arrival collapses everything into one point.

**Titles.** The header, episode number and name are empty by default, and only what you fill in is drawn. If you set only a name, it takes the header's place.

**Projects.** Save to the browser's project list, export or import `.chorddrift.json` files, or copy a share link: the URL holds the full config, so a link always reopens the exact piece.

## Video and audio export

The player can download a WAV, save a PNG frame, or record a real-time video. For frame-exact 60 fps video, use the CLI. It renders each frame headlessly (t = frame / 60), renders the audio offline from the same score, and muxes both with ffmpeg:

```bash
npm run export -- --seed 0xF5E68707 --key C                  # → out/chord-drift-0xF5E68707.mp4
npm run export -- --config my-piece.chorddrift.json          # a saved project or copied config
npm run export -- --seed 42 --scale 0.5                      # quick 540×960 draft
npm run export -- --seed 42 --frames out/frames              # PNG sequence + audio.wav
npm run export -- --help
```

This needs ffmpeg on your PATH and Playwright's Chromium (`npx playwright install chromium`). A 35-second 1080×1920 piece takes about a minute.

To print scores without rendering anything:

```bash
npm run score -- 0xF5E68707 7 --mode drift --key D --scale dorian --complexity 4
npm run score -- 1 --key C --progression "Imaj9 vi11 ? IVmaj7#11"
```

## How it works

```
seed ─┬─ key ───────────┐
      ├─ progression ───┼─► chords (root + intervals) ─► voicing search ─► moves per voice
      ├─ voicing ───────┘                                                    │
      ├─ timing / stagger ──────────────────────────────────────────────────┤
      └─ detune / pan                                       pitchAt(v, t) ◄──┘
                                                              │        │
                                                         Canvas 2D   Web Audio
```

- **`src/engine/`** holds the pure TypeScript engine, which runs in the browser and in Node.
  - `rng.ts`: mulberry32 with an independent stream per subsystem (`hash(seed, "voicing")`…), so changing the timing never changes which chords a seed picks.
  - `theory.ts`: the scale library, plus spelling that follows key signatures (E# in F# major, B♭ for a borrowed ♭VII in C).
  - `chords.ts`: the chord symbol table with aliases, naming chords from interval sets, stacking chords from scales with avoid-note rules, and complexity palettes.
  - `progression-text.ts`: the chord language parser and `chordToToken` (freeze).
  - `progression.ts`: the generators. Root motion is weighted by interval (falling fifths and thirds strongest), which works in any scale. A few candidates are drawn and scored by voice-leading cost, so smoothness is a real knob.
  - `voicing.ts`: the core. Bass = the root in MIDI 36–47; 12 upper voices are matched sorted-to-sorted (no crossings). A dynamic program finds the cheapest legal voicing exactly: every required tone present, no tight intervals below C3, at most three copies of a pitch class. Cost = semitones moved + a penalty per moving voice + 0.3 × bass motion − a bonus for holding the top voice (the pedal). Seeded noise on re-runs gives tie-breaking alternatives, and the rules relax step by step for sparse chords.
  - `score.ts`: builds the timeline (intro → bloom → changes → arrival) chord by chord. Endless pieces grow lazily and deterministically.
  - `motion.ts`: `pitchAt(v, t)`, a smootherstep (or cosine) S-curve in pitch space, not in Hz, plus `melodyAt(t)` for the lead (pitch and gain, legato glides, re-attacks).
  - `rhythm.ts`: the rhythm notation parser and presets.
  - `melody.ts`: the melody generator (rhythm cells or written rhythm, chord-tone and scale-step random walk).
  - `styles.ts`: the genre planner (phrase templates, cadences, modulations, closing formulas, per-style voicing).
  - `themes.ts`: theme presets (colours, fonts, line colouring, glow, grid).
- **`src/render/renderer.ts`** draws each frame as a pure function of (score, t): the pitch-vs-time plot, a camera that frames the current chord, label de-collision, the HUD (Σf, f↑/f↓, chord), and the final zoom-out to the whole piece.
- **`src/audio/synth.ts`** runs one oscillator per voice with seeded detune and pan. Pitch and gain curves are sampled from `pitchAt` (and `swellAt`) and scheduled in short value-curve chunks, the same path for live, endless and offline playback. If the page stalls, the scheduler skips the chunks that fell behind instead of getting stuck. On browsers that reject closely spaced curves, it switches to smooth linear ramps. The master chain is a low-pass, a generated convolution reverb, and a limiter.

## Configuration

Everything the UI sets is a plain config object (see `src/engine/config.ts` for the full, commented type). Copy it with **Copy config**, or save a project file:

```jsonc
{
  "seed": "0xF5E68707", "series": "", "episode": 0, "title": "",
  "voices": 13, "key": "auto", "scale": "major", "mode": "scale", "complexity": 3,
  "progression": "", "endless": false, "driftProbability": 0.25, "smoothness": 1,
  "chordCount": [8, 12], "startNote": "fifth", "endNote": "tonic+2oct",
  "timing": { "intro": 1, "bloom": 2.7, "hold": 2, "glide": 0.8, "stagger": 0.25, "arrival": 1.5, "outro": 1.2 },
  "rhythm": { "tempo": 76, "chords": "" },
  "melody": { "enabled": false, "rhythm": "", "density": 0.5, "register": "high", "fill": "continuous", "wave": "triangle" },
  "audio": { "wave": "sine", "detuneCents": 3, "reverb": 0.35, "lowpass": 7000, "swell": "off", "swellDepth": 0.65 },
  "video": { "width": 1080, "height": 1920, "fps": 60, "historySeconds": 5 }
}
```

## Development

```bash
npm test            # vitest: theory, chords, parser + freeze round-trip, voicing, rhythm, melody, determinism, endless, projects
npm run typecheck
npm run build       # static site in dist/ (relative paths, host anywhere)
npm run stats       # musical health check: voices moved per change, repeats, variety, pedal hold rate, generation speed
```
