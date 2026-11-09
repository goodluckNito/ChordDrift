# Chord Drift

A seeded tool for exploring chord progressions as voice-led glides. Thirteen sine voices start on one note, bloom into a chord, drift through a progression where each voice moves as little as possible, then rise together to a single note. The picture is each voice's pitch over time; the sound is the same function, so they never drift apart.

Pick a key and scale (35 of them, from Dorian to hirajoshi to octatonic), write chords in a key-agnostic language or let a generator choose, hear them, freeze them to text, tweak, save the project. Or switch on **endless** and let it wander forever.

## Quick start

```bash
npm install
npm run dev          # open the player at http://localhost:5173
```

Space plays/pauses, ← → seek, R rolls a new seed, M mutes, F toggles fullscreen. Next to restart are **Loop** (the piece returns to its opening unison and starts again), a button that fills the window (good on desktops: the preview uses the whole stage and text stays readable) and **Fullscreen**. Above the transport, **zoom** (− / slider / +, or scroll over the picture; click the percentage to reset) spreads the picture out around the playhead (or the centre in the spiral and 3D views) while lines, dots and labels keep their size. Zoom is saved with the song and used in exports. Under the transport there's a volume slider, remembered per device and never saved into projects or exports, and a stereo level meter: RMS bars, peak-hold ticks and a clip light.

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
| Witch house | one minor loop, i–♭III–♭VI–V and relatives (falling thirds, ♭6→5), repeated almost unchanged, m7/m9 colour (built from a reference track) | rare | ♭VI–V–i |
| Occult (phrygian) | phrygian i–♭II, tritone-apart minor triads, minor-third cycles | lurches down a half step, by a tritone or a minor third (always minor) | phrygian ♭II–i, with a droning top voice |

The score list marks every key change (e.g. `V7 (→ G major)`). Styles also run endlessly, closing a phrase with a cadence every four phrases and drifting home now and then.

**Loop and ending.** *Ending* chooses where the piece resolves: up to the tonic (two octaves or one), the middle tonic, **down to the tonic below**, or **back to the starting unison**. *Loop* always comes home: after an ending above or below, every voice glides back to the starting unison, then the piece wraps seamlessly, with no zoom-out or fade. WAV and video exports of a loop are exactly one pass, and the WAV carries the reverb tail around to its start, so it loops cleanly in a DAW.

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

**Inversion chance.** Key & harmony → *Inversion chance* voices some chords as inversions: the lowest voice (or two) jumps up an octave over the others, so the trails cross and twist, and the next chord untwists them. The chord is labelled with its new bass (C/E). It uses its own random stream, so turning it up changes nothing else about the piece.

**Song mode.** Turn on *Song* to build a piece from parts that collapse and resolve into each other. Write the form in a small notation, or pick a preset. The default is `A8 | B!8 > C!8 | A4 | B!8+1`:

- `A B C`: parts (names are letters). A name that comes back plays the same chords again.
- `A4`, `B16`: length in bars (default 8). Chords change on the chord rhythm (restarting at each part), or once a bar without one. A chord that would run past the end of the part is cut at its last bar line.
- `B!8`: a full part. The sub bass opens up and the drums play. Parts without `!` are soft: no drums, the sub almost gone, a little quieter. Turning Song on also turns the Drums on.
- `B!8[kh]`, `A8[h]`: pick the drums for a part: k(ick), s(nare), h(at), c(rash), r(ide); `[]` means none. Without brackets, full parts get every drum and soft parts none. Drum patterns (and the chop) restart at the start of every part, so 2- and 4-bar grooves and crashes line up with the part.
- `A8+2`, `B!4-3`: move a part up or down that many semitones. A repeat is transposed, so `B!8+1` at the end is the B part again, a half step up.
- `A | B`: collapse. Every voice converges on the next part's tonic, holds for a bar or two, then blooms out into the next part. `A > B` resolves straight through.

Each distinct part has its own seeded generator, so parts sound different but stay in the key unless shifted. Song mode replaces Endless; Loop still works.

**Chop.** A step pattern (one character per 16th, looping) that plays the chords back through a time and volume controller, in the spirit of beat-repeat and tape effects: `x` play, `.` cut, `-` half volume, `<` reverse (a run of them plays that stretch backwards), `=` repeat (a run of n replays the n steps before it), `~` tape stop (slows to a stop, pitch falling with it). Since the sound is a pure function of time, these are exact, and short fades at every jump keep them click-free. Pick what it chops: **drums** (the default: cut and half steps mute or soften hits, repeats replay the steps before, reverses play the stretch backwards with every hit reversed so it swells into its attack, tape stops push hits later, lower and longer), **chords + sub** (the lines thin out on cut steps) and/or the **melody**. The sidechain follows the chopped drums. In song mode it plays in full parts and restarts with each part.

**MIDI.** *Download MIDI* writes the piece as a Standard MIDI File: a Chords track with one block chord per change (re-struck on every pluck strike), the Melody, and the Drums on General MIDI channel 10. It also carries the tempo and the chord names as markers. The bloom is a pickup, so the beat grid lines up with the bars in a DAW. Endless pieces export the first 32 chords. *Import MIDI* (Project) reads any .mid. It hears a chord on every beat (pitch classes weighted by duration, bass weighted up), folds passing and colour changes into their neighbours, and writes the result as a progression with a matching chord rhythm, tempo and key. Drums on channel 10 become step patterns that repeat every 1, 2 or 4 bars.

**Melody.** Turn on a randomized lead line, drawn in red above the chords. It lands on chord tones on strong beats and whenever the harmony changes, and steps through the scale in between, skipping notes that clash a semitone above a chord tone. It moves with some momentum, leaps occasionally, and joins the final unison. You can give it a rhythm in the notation above, or leave that empty for a random rhythm at the chosen density. It can play throughout or only between chord changes. Register, wave, level and portamento are adjustable.

**Drums.** Drums are synthesized, so exports stay deterministic and there are no sample licences to worry about. They start when the bloom lands.
- **Kits:** Witch (dark, distorted, long kick, reverby clap), 808, Acoustic, Industrial and Jungle (tight punchy kick, crisp cracking breakbeat snare, bright short hats). Rides are a high-passed metallic shimmer, a noise wash and a stick ping, with an optional bell of inharmonic partials.
- **Double time:** patterns play twice as fast (each character a 32nd note). The *Jungle break* and *Jungle roller* patterns are written for it: at around 80–90 bpm with double time they run at jungle speed over slow chords.
- **Patterns:** one row per drum (kick, snare, hat, crash, ride) on a 16th-note grid: `x` hit, `X` accent, `.` rest, `o` open hat, `r` hat roll. Rows loop independently. Presets: Witch house (half-time), Trap (half-time), Four on the floor, Boom bap, Breakbeat, Ride groove and Sparse.
- **Random steps:** a `?` in any drum row is decided by the seed each bar: a rest, a ghost note, a hit or an accent, and on snare and hats sometimes a roll or an open hat. The same seed always plays the same fills.
- **Mix:** a level per drum, a drum bus level, and a reverb send (optionally snare only).
- **Sidechain:** duck the chords under the kick and/or snare, with depth and release. The lines dip with it.

**Sound.** Choose sine, triangle, saw or square for the chords, and separately for the melody. Saw and square are level-matched, and the Brightness control sets the master low-pass.

**Chord changes.** By default the voices *glide* to the next chord. Switch Timing → Chord changes to **Release & swell in** and each chord instead fades out underneath the next one swelling in, with separate swell-in and release times. Audio uses two alternating sets of voices so chords overlap. In the picture, line *thickness* shows level, like hairpin dynamics: a new chord's notes grow out of a point while the old ones taper away, and the playhead dots grow and shrink with them. The opening bloom and the final arrival still glide.

**Swells (ambient).** Volume swells, with a depth control:
- *Swell into each chord:* each change dips, then the new chord blooms in.
- *Moving voices re-swell:* only the voices that move fade and come back, like re-bowed strings.
- *Slow breathing:* slow overlapping waves, independent of the chords.

Line thickness and dot size follow the level over time, in the video as well. **Ambient** sets soft swells into each chord, a dark triangle tone and deep reverb. Pair it with Release & swell in for crossfading chords.

**Pluck.** Timing → Chord changes → **Pluck** makes chords strike and ring out:
- **Strummed changes:** every voice jumps to its new note right on the strike, with no slide, so the hit is on the new chord.
- **Punch:** each strike opens a filter that closes as it rings (bright hit, darker tail), and a makeup gain tied to the sustain keeps plucks as loud as held chords, so low sustain means harder hits, not a quieter mix.
- **Strike pattern:** Rhythm → Strike pattern re-strikes the *current* chord at the tempo, with presets (quarters, eighths, sixteenths, tresillo, triplets, offbeats, gallop) or your own pattern in the rhythm notation, where rests skip a strike. Chords still change on their own, slower timing, so you get a fast pulse over an unhurried progression.
- **Fullness:** the default **Warm** wave is a soft, saw-like tone (strong 2nd and 3rd harmonics, rolling off above), matched to the reference videos. **Sub bass** adds a sine an octave under the lowest voice. It runs dry (no reverb) and ducks under the kick (and the snare, if the chords duck under it), so it doesn't flatten the chords. And **Bass** is a low shelf (default +4 dB) that pushes the low end like an EQ. **Warmth** saturates the mix gently. **Stereo width** sets both the voice panning and how wide the reverb tail is. The default is nearly mono, so the sound stays solid and centred.
- **Envelope:** attack, decay and sustain (Sound) shape each strike, and the lines show every hit. The sound presets (**Ambient**, **Pluck**, **Dark**) change the sound (envelope, swells, reverb and tone) and how chords change: Pluck switches chord changes to Pluck, Ambient to Release & swell in. They never touch rhythm, harmony or theme. **Default sound** resets just the sound.

**Themes.** Presets: Paper, Sepia, Midnight, Neon, Blueprint, Terminal, Chromatic, Sunset, Hex, Vigil, Cathode, Ossuary, Tidepool, Bubblegum, Eclipse, Ultraviolet, Moth, Static, Bruise, Hollow and Frostbite. The 🎲 next to the preset rolls a whole new theme (colours, font, palette, glow). You can also choose your own:
- **Colours:** background (optionally a gradient), lines, melody and text.
- **Font:** fourteen to choose from (from Inter and Plex to Cinzel, Pirata One, Syne, Bebas Neue, Space Mono, Major Mono Display and VT323), loaded only when picked.
- **Line colouring:** one colour, per voice, per note (around the circle of fifths) or by height, through a palette: Rainbow, Ember, Bruise, Tide, Acid, Blood moon, Moss, Ghost, Oil slick, Candy, Rust, Frost, or Duotone and Mono built from the theme's own ink and accent. 🎲 rolls a palette (a dark-to-bright ramp in one hue family, a duotone, or a split scheme); it's saved with the theme.
- **Extras:** line width, glow, an octave grid with note names, and switches for the Hz labels and HUD.

Themes are saved in projects and share links and used in video exports. **My theme:**
- *Save as my theme* keeps a look on this device.
- *Use my theme* shows every song in it, including shared links; the song keeps its own theme.
- *Apply my theme to this song* copies your look into the song, so links and exports carry it. **Reset all settings** returns everything to defaults but keeps the seed.

**Formats.** Theme → Format sets the frame. **Auto** (the default) picks landscape on wide screens and portrait on tall ones, and switches when you rotate or resize. You can also fix it to Portrait 9:16, Landscape 16:9, Square, Portrait 4:5 or Landscape 4K. The layout adapts: text scales with the frame, and wide frames show more history. Exports and recordings use this size.

**3D spectrograph view.** Theme → View → 3D spectrograph draws a square slab of raked lines in an isometric (orthographic) view. It rocks ±54° around the front view over a minute, on its vertical axis; a full spin would pass through end-on views where the lines hide their own height. The base edges are drawn, so wave heights read against a floor line. Each line is one moment, newest at the front edge, with pitch running across it. Silence is flat floor; each voice raises a hump (height by loudness, saturating so a unison crests rather than walls up), and held notes become ridges running back through time. Nearer lines hide the ones behind them, like a zen garden.

**Ripples.** When a voice lands on a new note (or is struck), its dot swells and sends out a fading ring. Toggle it in Theme.

**Spiral view.** Theme → View → Spiral wraps pitch around a spiral: one turn per octave with C at the top, so octaves line up and the current chord shows as a shape, named in the middle. **Spiral motion** has three settings:
- *Orbit* (default): circling **and zooming in**. It's a logarithmic spiral: the present sits on its pitch ring, upcoming notes spiral out of the centre toward it, the past expands past you, and rings are born in the centre on every beat and grow outward. *Orbit (drain)* is the same idea with the past sinking into the centre instead. One meaning per dimension: Rotation is time: one turn per bar with a chord rhythm, otherwise every 8 s. Distance from the centre is pitch, with octave rings like staff lines, and the past drifts inward. The present rides a rotating hand with the chord stacked along it. History becomes a spiral galaxy where each interval change is a step in an arm (smooth for a glide), so with a rhythm the changes line up into a mandala.
- *Fly through* (default): depth is time, and you travel forward through it. Upcoming chords start small at the vanishing point and rush toward you; passed notes fly out past the edges. Held notes become slowly twisting helices, glides swing into their new intervals as they approach, and rings at every second and every chord change make the motion felt.
- *Note clock*: the angle is the note (C at the top, octaves aligned), and the past shrinks and rotates toward the centre.

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
- **`src/audio/synth.ts`** runs one oscillator per voice with seeded detune and pan. Pitch and gain curves are sampled from `pitchAt` (and `swellAt`) and scheduled in short value-curve chunks, the same path for live, endless and offline playback. If the page stalls, the scheduler skips the chunks that fell behind instead of getting stuck. On browsers that reject closely spaced curves, it switches to smooth linear ramps. A sub oscillator doubles the bass voice an octave down. The master chain is a low-pass, a gentle tanh saturator (Warmth), a generated convolution reverb whose stereo spread follows Stereo width, and a limiter.

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
  "audio": { "wave": "warm", "detuneCents": 3, "reverb": 0.35, "lowpass": 10000, "width": 0.12, "sub": 0.5, "warmth": 0.35, "swell": "off", "swellDepth": 0.65 },
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
