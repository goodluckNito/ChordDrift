# Chord Drift

A seeded tool for exploring chord progressions as voice-led glides. Thirteen sine voices start on one note, bloom into a chord, drift through a progression where each voice moves as little as possible, then rise together to a single note. The picture is each voice's pitch over time; the sound is the same function, so they never drift apart.

Pick a key and scale (35 of them, from Dorian to hirajoshi to octatonic), write chords in a key-agnostic language or let a generator choose, hear them, freeze them to text, tweak, save the project. Or switch on **endless** and let it wander forever.

## Quick start

```bash
npm install
npm run dev          # open the player at http://localhost:5173
```

Space plays/pauses, ← → seek, R rolls a new seed, M mutes, F toggles fullscreen. Next to restart is **Loop**, which cycles off → loop (the piece returns to its opening unison and starts again) → loop with a new seed (blue, with a dice: every pass rolls a fresh progression, handed over seamlessly at the unison; the key is pinned so every pass starts on the same note) → off. Then a button that fills the window (good on desktops: the preview uses the whole stage and text stays readable) and **Fullscreen**. Above the transport, **zoom** (− / slider / +, or scroll over the picture; click the percentage to reset) spreads the picture out around the playhead (or the centre in the spiral and 3D views) while lines, dots and labels keep their size. Zoom is saved with the song and used in exports. Under the transport there's a volume slider, remembered per device and never saved into projects or exports, and a stereo level meter: RMS bars, peak-hold ticks and a clip light.

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

**Styles (genres).** Instead of walking chord to chord, a style plans the piece in 4-chord phrases. Most phrases are *written by the style*: it has a weighted chord vocabulary, preferred root motions (falling thirds, fifths, half-step drops…), phrase endings (half, deceptive, plagal) and occasional spark chords from outside the usual palette, so phrases vary from piece to piece. The phrases in the table are only references, used now and then; loops come back but usually with a chord changed. Each phrase ends on a cadence, key changes happen between phrases using approaches suited to the style, and the piece closes on the style's strongest resolution. Voicing rules change with the style too. Complexity is kept within each style's range, and the chord count sets the number of phrases.

| Style | Phrases | Key changes | Ending |
| --- | --- | --- | --- |
| Classical | I–IV–V–I, I–vi–ii–V… | to the dominant or relative key via V7, then home | ii–V7–I (Picardy in minor) |
| Jazz | ii–V–I, turnarounds, tritone subs | by ii–V to keys a step or a third away | ii–V7alt–Imaj9 or backdoor |
| Pop | repeating 4-chord loops | a final-chorus lift up a half or whole step | IV–V–I |
| Cinematic | i–♭VI–♭III–♭VII, mediants | sudden chromatic-mediant jumps | ♭VI–♭VII–I |
| Gospel | I–III7–vi–IV, IV–iv–I, passing dim7 | lifts by half and whole steps | IV–iv–I "amen" |
| Impressionist | parallel maj7/maj9 planing | drifts by steps and thirds | ♭VII–Imaj7#11 (voices slide together) |
| Witch house | dark minor phrases that fall by thirds and drop ♭6→5, phrygian ♭II, the odd chromatic-mediant spark; loops recur with a chord changed | rare | ♭VI–V–i |
| Occult (phrygian) | phrygian i–♭II, tritone-apart minor triads, minor-third cycles | lurches down a half step, by a tritone or a minor third (always minor) | phrygian ♭II–i, with a droning top voice |

**Swapping chords.** Every chord in the score list has a ⇄ button with alternatives from the piece's key, best first: chords that lead into the next one (its dominant, a sus dominant, the tritone sub, its ii, a diminished passing chord), the resolution when the chord before is a dominant, substitutes that share most of its notes, other colours on the same root, borrowed iv, ♭VI and ♭VII (when they really are borrowed), and the mode's own colours: a chord with notes from outside the mode (like a harmonic-minor V7♭9 in Phrygian) gets an in-mode version on the same root, and each mode offers its signature chords (Phrygian ♭II and ♭vii, Dorian IV7, Lydian II, Mixolydian ♭VII, the Aeolian ♭VI…), plus the mode's tonic colour when swapping the tonic. Each says why it's there; ▶ previews it, and picking one writes the chords into Progression with the swap (the key is pinned, so nothing else changes). *Undo last swap* puts it back. (Not offered for endless pieces or song mode.)

The score list marks every key change (e.g. `V7 (→ G major)`) and shows how long each chord lasts: bars and beats on a beat grid (a chord rhythm or song mode), seconds otherwise. Styles also run endlessly, closing a phrase with a cadence every four phrases and drifting home now and then.

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

**Resolution pull.** Key & harmony → *Resolution pull* (default 0.35) leans the generator toward strong resolutions: a dominant (7, 9, 13, or a 7sus4 / 9sus4) resolving down a fifth, falling-fifth chains (ii–V–I), and chords that set up the tonic. It also keeps the tonic's dominant and, after any dominant, its resolution among the candidates. It's exponential, so it holds its own against high smoothness, which otherwise picks whatever moves the voices least. It works with styles too, leaning their generated phrases the same way (a style keeps its own character and cadences). At 0 only smoothness and the generator (or the style) decide.

**Passing chords.** Key & harmony → *Passing chords* (default 0.25) is the chance that two chords whose roots are a whole step apart get a chromatic chord between them, taking the second half of the first chord's length: a diminished 7th when the bass climbs (A → A♯dim7 → B), a dominant 7th when it falls (G♯ → G7 → F♯). Written progressions are left exactly as written.

**Scales and styles.** A style works from your key's tonic. The scale decides whether its phrases are major or minor and colours plain numerals, but the style's own moves (♭VI, ♭II, borrowed and altered chords) step outside the scale when they need to; Occult is always minor.

**Inversion chance.** Key & harmony → *Inversion chance* is per chord: a chord that rolls it puts its 3rd, 5th (or 7th) in the bass instead of its root (C/E, C/G), and the voices are led to it as smoothly as to any other chord, so the bass line moves by step more often instead of leaping. It uses its own random stream, so turning it up changes nothing else about the piece.

**Song mode.** Turn on *Song* to build a piece from parts that collapse and resolve into each other. Write the form in a small notation, or pick a preset. The default is `A8 | B!8 > C!8 | A4 | B!8+1`:

- `A B C`: parts (names are letters). A name that comes back plays the same chords again.
- `A4`, `B16`: length in bars (default 8). Chords change on the chord rhythm (restarting at each part), or once a bar without one. A chord that would run past the end of the part is cut at its last bar line.
- `B!8`: a full part. The sub bass opens up and the drums play. Parts without `!` are soft: no drums, the sub almost gone, a little quieter. Turning Song on also turns the Drums on.
- `B!8[kh]`, `A8[h]`: pick the drums for a part: k(ick), s(nare), h(at), c(rash), r(ide); `[]` means none. Without brackets, full parts get every drum and soft parts none. Drum patterns (and the chop) restart at the start of every part, so 2- and 4-bar grooves and crashes line up with the part.
- `B8{E,dorian}`, `C!8{jazz}`: set a part's key, scale and/or style (in any order, comma-separated). The same part in another key (or `+N`) plays the same chords transposed, so `A8 > A8{D}` lifts it into D; in another scale or style it becomes a variation with its own chords, so `A8 | A8{minor}` is A's darker twin.
- `up4{climb}`: a climb. The bass walks up from the tonic to the dominant, one step per chord (1–2–3–4–5, with a chromatic ♯4 diminished chord before the 5 when there's room, like A → A♯ → B in E), each step harmonised by a chord that has it as root, 3rd or 5th. It ends on V, so whatever follows resolves it.
- `R2{release}`: a release. One long suspended dominant (V7sus4, or V9sus4 with colourful chords) held for the whole part; the part before it ends on a pre-dominant (IV, ii, vi) and the part after opens on its tonic.
- `A8+2`, `B!4-3`: move a part up or down that many semitones. A repeat is transposed, so `B!8+1` at the end is the B part again, a half step up.
- `A | B`: collapse. Every voice converges on the next part's tonic (or, about a third of the time and always after a climb or release, high on its dominant, so the unison is the last tension before the part blooms home on its tonic), holds briefly (about 2–3 s: one bar, or half a bar at slow tempos), then blooms out into the next part. `A > B` resolves straight through.

Each distinct part has its own seeded generator, so parts sound different but stay in the key unless shifted. Without a style or written progression, each part also gets an ending that makes its join mean something: before a collapse it leaves tension hanging (♭VI–V, IV–V, ii–V, IV–iv) for the unison to resolve; before `>` into another key it plays that key's ii–V7 and the next part opens on its tonic; in the same key it ends on a light half cadence; and the last part closes with a lift or a tear: ♭VI–♭VII–I, the minor plagal IV–iv–I, the climbing IV–V–vi–♭VII–I, the backdoor iv–♭VII–I, ii–V–I or the ♭II slide IV–♭II–I (minor keys may end on a Picardy major). A part repeats its body, but its ending follows what comes next. The **Long arc** preset strings these together into a long-form piece: theme, chorus, a soft memory, the chorus again, a climb into a high unison on the dominant, a bright full part, a held sus-dominant release, the chorus once more and a quiet ending. Song mode replaces Endless; Loop still works.

**Chop.** A step pattern (one character per 16th, looping) that plays the chords back through a time and volume controller, in the spirit of beat-repeat and tape effects: `x` play, `.` cut, `-` half volume, `<` reverse (a run of them plays that stretch backwards), `=` repeat (a run of n replays the n steps before it), `~` tape stop (slows to a stop, pitch falling with it), `?` random: the seed decides each bar (usually play, sometimes a cut, half, reverse, repeat or tape stop; neighbouring `?`s that land on the same move join into one run). Since the sound is a pure function of time, these are exact, and short fades at every jump keep them click-free. Pick what it chops: **drums** (the default: cut and half steps mute or soften hits, repeats replay the steps before, reverses play the stretch backwards with every hit reversed so it swells into its attack, tape stops push hits later, lower and longer), **chords + sub** (the lines thin out on cut steps) and/or the **melody**. The sidechain follows the chopped drums. In song mode it plays in full parts and restarts with each part.

**MIDI.** *Download MIDI* writes the piece as a Standard MIDI File: a Chords track with one block chord per change (re-struck on every pluck strike), the Melody, and the Drums on General MIDI channel 10. It also carries the tempo and the chord names as markers. The bloom is a pickup, so the beat grid lines up with the bars in a DAW. Endless pieces export the first 32 chords. *Import MIDI* (Project) reads any .mid and builds a piece that follows it:
- **The tune** is the highest part that plays mostly one note at a time (or one named like a melody: soprano, lead, vocal, melody…). It comes in as a *written melody* and plays exactly as written, over the chords.
- **The chords** come from the other parts, at the harmonic rhythm the music actually moves at: it tries chords every beat, every two beats and every bar, and keeps the one that explains the notes best without changing more than it needs to. The bass note is kept as a slash chord (*Em7/D*), so inversions and pedal points survive. Beats with no chord extend the one before; a closing unison or fade doesn't stretch the last chord.
- **The sound** comes from the instruments (their General MIDI programs). A harp, piano, guitar or mallet accompaniment plucks, striking on its own rhythm (eighths at the busiest, so arpeggios don't turn into tremolo). Strings, choirs, brass and reeds swell between chords, pads and leads glide, and reverb and wave are set to suit. The melody's wave and portamento follow its instrument: a choir or flute sings in sine, strings in triangle, brass in saw.
- **Tempo, key and drums** come along too. Drums on channel 10 become step patterns that repeat every 1, 2 or 4 bars.

The status line says what it heard and chose (e.g. "chords from ARPA (Harp) → plucked, harp-like · melody from SOPRANO (Strings 2) → triangle lead"), and everything stays editable in Sound, Melody and Progression.

**Chord timing by default.** The default chord rhythm is `?`: each chord gets a random length decided by the seed, a whole note (35%), half (50%) or quarter (15%), at 54 bpm, so changes land on the beat with varied, unhurried lengths. `?` works inside any chord rhythm too (`w ? h ?`). Clear the rhythm for free timing in seconds (Hold, default 3.5 s, and Glide).

**Melody.** Turn on a randomized lead line, drawn in red above the chords. The **Solo** style (default) sings long lines, modelled on the solos in the reference pieces: one long note per chord landing on its colour tones (3rd, 9th, 7th, ♯11), moving by step in arched phrases, with slow glides; now and then an approach note or a quick turn leads into the next chord, and it breathes between phrases. **Free** is the busier original: It lands on chord tones on strong beats and whenever the harmony changes, and steps through the scale in between, skipping notes that clash a semitone above a chord tone. It moves with some momentum, leaps occasionally, and joins the final unison. You can give it a rhythm in the notation above, or leave that empty for a random rhythm at the chosen density. It can play throughout or only between chord changes. Register, wave, level and portamento are adjustable.

**Drums.** Drums are synthesized, so exports stay deterministic and there are no sample licences to worry about. They start when the bloom lands.
- **Kits:** Witch (dark, distorted, long kick, reverby clap), 808, Acoustic, Industrial and Jungle (tight punchy kick, crisp cracking breakbeat snare, bright short hats). Rides are a high-passed metallic shimmer, a noise wash and a stick ping, with an optional bell of inharmonic partials.
- **Double time:** patterns play twice as fast (each character a 32nd note). The *Jungle break* and *Jungle roller* patterns are written for it: at around 80–90 bpm with double time they run at jungle speed over slow chords.
- **Patterns:** one row per drum (kick, snare, hat, crash, ride) on a 16th-note grid: `x` hit, `X` accent, `.` rest, `o` open hat, `r` hat roll. Rows loop independently. Presets: Witch house (half-time), Trap (half-time), Four on the floor, Boom bap, Breakbeat, Ride groove and Sparse.
- **Ghost notes:** `g` is a quiet hit (about a third of full level), for the ghosted snares of breaks.
- **Balanced automatically:** every hit of every kit was measured (loudness-meter weighting: its whole energy, and its "punch", the first 250 ms that sets how loud one hit sounds). Each drum is trimmed so a kit's balance comes from the drum levels rather than from how it happens to be synthesized (the acoustic kick used to be 11 dB weaker than the others with its crash louder than its kick; the 808 and industrial hats were nearly silent). Then the drum bus is set from the song's own pattern: its hits' energy predicts how loud the drums will be, and the bus puts them a fixed distance under the chords. A busy breakbeat and a lone kick on the one sit at the same level, and the Drums level moves them from there. The trim comes after a kit's drive, so distorted kicks keep their character.
- **Sidechain:** the sidechain eases off when hits pile up (fast breaks, double time), so it doesn't hold the chords down constantly.
- **Random steps:** a `?` in any drum row is decided by the seed each bar: a rest, a ghost note, a hit or an accent, and on snare and hats sometimes a roll or an open hat. The same seed always plays the same fills.
- **Mix:** a level per drum, a drum bus level, and a reverb send (optionally snare only).
- **Sidechain:** duck the chords under the kick and/or snare, with depth and release. The lines dip with it.

**Sound.** Choose sine, triangle, saw or square for the chords, and separately for the melody. Saw and square are level-matched, and the Brightness control sets the master low-pass.

**Chord changes.** By default the voices *glide* to the next chord. Switch Timing → Chord changes to **Release & swell in** and each chord instead fades out underneath the next one swelling in, with separate swell-in and release times. Audio uses two alternating sets of voices so chords overlap. In the picture, line *thickness* shows level, like hairpin dynamics: a new chord's notes grow out of a point while the old ones taper away, and the playhead dots grow and shrink with them. The opening bloom and the final arrival still glide.

**Glide feel and strikes.** With gliding changes, **Glide feel → Varied** gives every glide its own shape and speed: some start lazily and land fast, some leap off and settle, some sail a little past the note and settle back, so the voices stop moving in lockstep. **Strikes** is the chance that a moving voice re-strikes its new note instead of gliding: it releases, jumps and re-attacks (staggered across the voices, like a strum), and now and then scoops into the note from a semitone off. Both come from their own random stream, so they never change the chords or their timing, and both show in the picture (the lines jump, scoop and overshoot; struck notes ring). Songs from words pick them too.

**Swells (ambient).** Volume swells, with a depth control:
- *Swell into each chord:* each change dips, then the new chord blooms in.
- *Moving voices re-swell:* only the voices that move fade and come back, like re-bowed strings.
- *Slow breathing:* slow overlapping waves, independent of the chords.

Line thickness and dot size follow the level over time, in the video as well. **Ambient** sets slow breathing swells (independent of the chords), a soft triangle tone and deep reverb, with gliding chord changes.

**Pluck.** Timing → Chord changes → **Pluck** makes chords strike and ring out:
- **Strummed changes:** every voice jumps to its new note right on the strike, with no slide, so the hit is on the new chord. With a strike pattern and free timing, each change waits for the next strike, so it lands on the pulse instead of cutting into a ringing note.
- **Punch:** each strike opens a filter that closes as it rings (bright hit, darker tail), and a makeup gain tied to the sustain keeps plucks as loud as held chords, so low sustain means harder hits, not a quieter mix.
- **Strike pattern:** Rhythm → Strike pattern re-strikes the *current* chord at the tempo, with presets (quarters, eighths, sixteenths, tresillo, triplets, offbeats, gallop) or your own pattern in the rhythm notation, where rests skip a strike. Chords still change on their own, slower timing, so you get a fast pulse over an unhurried progression.
- **Levels:** voices add up like independent sources, so each is scaled by 1/√(voices) rather than 1/voices, and voices that share a note back off by 1/√(how many share it), so unisons don't spike. Chords come out about 6–7 dB louder than before at any voice count, and the sub, drums and melody are balanced against them: drums are set from measured hit loudness and the song's pattern (see Drums), and a melody at its default level sits about 5 LU under the chords.
- **Speaker:** Sound → *Speaker* voices playback for the device: phones and small speakers get no sub (they can't play it, and trying makes them crackle), a gentler top and a little more headroom (no compression); Auto picks that on phones. It's a per-device setting, never saved into songs, and recordings and exports are unaffected.
- **Fullness:** the default **Warm** wave is a soft, saw-like tone (strong 2nd and 3rd harmonics, rolling off above), matched to the reference videos. **Sub bass** adds a sine an octave under the lowest voice (default 0.4, sitting just under the chords). It runs dry (no reverb) and ducks under the kick (and the snare, if the chords duck under it), so it doesn't flatten the chords. And **Bass** is a low shelf (default +2 dB) that pushes the low end like an EQ. **Warmth** saturates the mix gently (off by default, for a clean sound). **Stereo width** sets both the voice panning and how wide the reverb tail is. The default is nearly mono, so the sound stays solid and centred.
- **Envelope:** attack, decay and sustain (Sound) shape each strike, and the lines show every hit. The sound presets (**Ambient**, **Pluck**, **Dark**) change the sound (envelope, swells, reverb and tone) and how chords change: Pluck switches chord changes to Pluck, Ambient back to Glide. They never touch rhythm, harmony or theme. **Default sound** resets just the sound.

**Themes.** Presets: Paper, Sepia, Midnight, Neon, Blueprint, Terminal, Chromatic, Sunset, Hex, Vigil, Cathode, Ossuary, Tidepool, Bubblegum, Eclipse, Ultraviolet, Moth, Static, Bruise, Hollow and Frostbite. The 🎲 next to the preset rolls a whole new theme (colours, font, palette, glow), keeping how the lines are coloured (so harmony colouring, say, survives a reroll). You can also choose your own:
- **Colours:** background (optionally a gradient), lines, melody and text.
- **Font:** fourteen to choose from (from Inter and Plex to Cinzel, Pirata One, Syne, Bebas Neue, Space Mono, Major Mono Display and VT323), loaded only when picked.
- **Line colouring:** one colour, per voice, per note (around the circle of fifths), by height, or by **Harmony**: colour that follows the key, so intervals read as colour relations without every chord becoming a rainbow. The key's notes are one family of neighbouring hues around the theme's accent (each step round the circle of fifths from the tonic shifts the hue a little, so a fifth is a close shade and a tonic chord a tight family); notes outside the key jump to the complementary hue so they stand out; higher notes are lighter. It follows modulations. The other modes go through a palette: Rainbow, Ember, Bruise, Tide, Acid, Blood moon, Moss, Ghost, Oil slick, Candy, Rust, Frost, or Duotone and Mono built from the theme's own ink and accent. 🎲 rolls a palette (a dark-to-bright ramp in one hue family, a duotone, or a split scheme); it's saved with the theme.
- **Extras:** line width, glow, a grid (octave lines with note names, plus faint bar lines when there's a beat grid, restarting with each song part), and switches for the Hz labels and HUD.

Themes are saved in projects and share links and used in video exports. **My theme:**
- *Save as my theme* keeps a look on this device.
- *Use my theme* shows every song in it, including shared links; the song keeps its own theme.
- *Apply my theme to this song* copies your look into the song, so links and exports carry it. **Reset all settings** returns everything to defaults but keeps the seed.

**Finding settings.** The box at the top of the settings filters them as you type (labels, tooltips and setting names; press / to jump to it, Esc to clear), the chips under it jump to each section, and clicking a section's title folds it away (remembered on this device). The seed sits at the top of Key & harmony: its 🎲 rolls new chords and, with *New seeds also roll drums, melody & rhythm* ticked (the default), a new arrangement to go with them: drums and melody on or off, a drum beat, the chord-change rhythm and the strike pattern (kit, sound and tempo stay; Loop + new seed rolls one each pass too), while the 🎲 by the words at the top makes a whole new song.

**Formats.** Theme → Format sets the frame. **Auto** (the default) picks landscape on wide screens and portrait on tall ones, and switches when you rotate or resize. You can also fix it to Portrait 9:16, Landscape 16:9, Square, Portrait 4:5 or Landscape 4K. The layout adapts: text scales with the frame, and wide frames show more history. Exports and recordings use this size.

**Harmony view.** One view draws the chords as a structure rather than lines over time (links with retired views open it):
- **Constellation:** the voiced chord as stars (angle is the note, distance from the centre is register), joined from bass to top with their intervals labelled. The last few chords linger as smaller, fainter ghosts, so inversions, spreads and colour changes are easy to see.

**Night city.** Theme → View → Night city: twelve towers, one per note name (C to B, left to right), one floor per octave, two windows a floor. A sounding note lights one of its floor's windows (each building has its habits), with a room behind it, furnished in silhouette: a bedroom (a bed with someone asleep, a bedside or floor lamp, a dresser or wardrobe), a bathroom (a bath or shower, a toilet, a mirror), an office (a desk with a glowing screen, a desk lamp, a chair or bookshelf), a living room (a sofa with a flickering TV, a lamp, a piano, a fireplace or a plant, sometimes a cat or dog pottering about) or a kitchen (fridge, stove or counter, a pendant light), each with its own shade of light; in some rooms someone wanders about. Lamp shades glow and screens flicker. The window light is the theme's **Lights** colour (Theme → colours), a fifth colour for lit windows and glows. The last few chords' windows fade out slowly, so the recent harmony glows. A voice that moves flies as a comet over the rooftops from its old window to the new one, which lights as it lands. Kicks light up the sky and ripple the water, snares flash the antennas, hats twinkle the stars. Two looks (City look): **Neon**, with the skyline mirrored and rippling in the water, and **Blueprint**, an isometric line drawing.

**Odd views.** Two pictures you wouldn't usually draw music as, each moving with the voices and pushed around by the drums:
- **Ink in water** (the *marbling* view): a small fluid simulation of coloured ink in water filling the frame. Every voice is a nozzle along the bottom, placed by pitch (low notes on the left, high on the right, kept in from the walls); while a note sounds it keeps pouring ink upwards (the ink comes out over the same spot as the jet that pushes it, so what flows is what you see), harder the louder it is, so held notes build up plumes and big chords flood the water, and a glide slides its nozzle across. The ink is coloured by harmony (see *Line colouring*): the key's notes pour one family of rich neighbouring hues, out-of-key notes pour the contrasting hue, so a chromatic chord visibly bleeds a new colour into the water and a modulation shifts the whole family. The flow keeps curling on its own; the ink stays put in the water and only fades slowly (over about fifteen seconds), so what the voices poured stays visible. Kicks push the water outward from the bottom; snares spin up a whirlpool. It runs on the GPU (WebGL2: velocity on a coarse grid, ink on a fine one, shaded with a soft light from its own thickness) and falls back to a CPU version where WebGL2 can't render floats. It steps at a fixed rate from the start of the piece (with snapshots, so jumping back is quick), so exports match playback, and it's drawn in screen space (zoom leaves it alone). The frame's edges are solid walls, so ink pools and swirls back instead of leaving.
- **Tornado:** a big tornado filling the frame: a storm cloud wheeling across the top (lit up by snares, like lightning inside), the funnel dropping from it to a plain with low hills, rain curtains off to the sides, and a skirt of dust thrown up where it touches down. The funnel always keeps a tornado's shape (a rope at the ground flaring into the cloud), with streaks of condensation wrapping round it as it turns; debris spirals slowly up it. Each voice is a band of brighter, denser debris at its pitch's height, and much of that debris is the note's own letter (C, E♭, G…) tumbling round the funnel, so the chord can be read off the tornado without labels getting in the way. Bands take their colour from *Line colouring*: per voice or per note if chosen, otherwise harmony colours. When a voice changes note, the new note is drawn up out of the ground to its height while the note it left is pulled up the funnel into the storm cloud, fading as it goes, so each chord change sweeps the old chord into the sky. Its foot wanders and the body bends; kicks widen it and spin it faster, snares fling debris out, hats make it sparkle. (Murmuration links open it.)

**3D spectrograph view.** Theme → View → 3D spectrograph draws a square slab of raked lines in an isometric (orthographic) view. It rocks ±54° around the front view over a minute, on its vertical axis; a full spin would pass through end-on views where the lines hide their own height. The base edges are drawn, so wave heights read against a floor line. Each line is one moment, newest at the front edge, with pitch running across it. Silence is flat floor; each voice raises a hump (height by loudness, saturating so a unison crests rather than walls up), and held notes become ridges running back through time. Nearer lines hide the ones behind them, like a zen garden.

**Ripples.** When a voice lands on a new note (or is struck), its dot swells and sends out a fading ring. Toggle it in Theme.

**Spiral view.** Theme → View → Spiral wraps pitch around a spiral: one turn per octave with C at the top, so octaves line up and the current chord shows as a shape, named in the middle. **Spiral motion** has three settings:
- *Orbit* (default): circling **and zooming in**. It's a logarithmic spiral: the present sits on its pitch ring, upcoming notes spiral out of the centre toward it, the past expands past you, and rings are born in the centre on every beat and grow outward. *Orbit (drain)* is the same idea with the past sinking into the centre instead. One meaning per dimension: Rotation is time: one turn per bar with a chord rhythm, otherwise every 8 s. Distance from the centre is pitch, with octave rings like staff lines, and the past drifts inward. The present rides a rotating hand with the chord stacked along it. History becomes a spiral galaxy where each interval change is a step in an arm (smooth for a glide), so with a rhythm the changes line up into a mandala.
- *Fly through* (default): depth is time, and you travel forward through it. Upcoming chords start small at the vanishing point and rush toward you; passed notes fly out past the edges. Held notes become slowly twisting helices, glides swing into their new intervals as they approach, and rings at every second and every chord change make the motion felt.
- *Note clock*: the angle is the note (C at the top, octaves aligned), and the past shrinks and rotates toward the centre.

With release-and-swell changes, chords grow in and fade out on the spiral too. The arrival collapses everything into one point.

**Titles.** The header, episode number and name are empty by default, and only what you fill in is drawn. If you set only a name, it takes the header's place.

**Songs from words.** Type anything in the box at the top of the panel ("rain on a tin roof at 3am") and press Make: the words seed a whole song, not just the chords (scale, style, generator, rhythm, drums, sound, theme and view), and the same words always make the same song. 🎲 next to it randomizes everything by making a song from two random words. **Keep** locks the visualizer: *The view* keeps your current view (its look, zoom and how its lines are coloured) while each song still brings its own colours; *The view and its colours* keeps the theme too. Pick what to make (remembered per device): **Just chords** is the original idea, a nice chord progression and nothing else (chill harmony, no drums, melody, chop or song parts, free glides on a clean tone, timeline view; links as `#p=words`). **Chill** (the default) keeps full arrangements on familiar ground: mostly major and minor (now and then dorian or mixolydian), simpler chords, friendly styles (pop, classical, cinematic, gospel), key-locked harmony with a firm pull home, softer waves and fewer inversions, which halves the abrasive chords (♯11, ♭5, augmented, altered…). **Adventurous** opens up every scale, style and generator. Chill songs link as `#w=words`, adventurous ones as `#t=words`. The link for such a song is just the words (`#t=rain+on+a+tin+roof+at+3am`); if you change things, the link becomes the words plus only what you changed (`#t=midnight+motel&d=…`), which stays short.

**Projects.** Save to the browser's project list, export or import `.chorddrift.json` files, or copy a share link: the URL holds every setting that differs from the defaults with short key names, compressed (`#y=…`; older `#z=…` and `#c=…` links still open), so a link always reopens the exact piece.

## Video and audio export

The player can download a WAV or MIDI, save a PNG frame, or record a real-time video. *Record video* always starts from the beginning and stops by itself: at the end of the piece, after exactly one pass of a loop, or after the length you set for endless pieces. Pick a quality (24 / 12 / 6 / 3 Mbps) or a target file size, which is turned into a bitrate for the length. Browsers can only record at a bitrate; for constant-quality (CRF) or frame-exact 60 fps video, use the CLI. It renders each frame headlessly (t = frame / 60), renders the audio offline from the same score, and muxes both with ffmpeg:

```bash
npm run export -- --seed 0xF5E68707 --key C                  # → out/chord-drift-0xF5E68707.mp4
npm run export -- --config my-piece.chorddrift.json          # a saved project or copied config
npm run export -- --seed 42 --scale 0.5                      # quick 540×960 draft
npm run export -- --seed 42 --frames out/frames              # PNG sequence + audio.wav
npm run export -- --seed 42 --crf 22                         # constant quality (default 16; higher = smaller)
npm run export -- --seed 42 --size 25                        # aim for a 25 MB file
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
- **`src/audio/synth.ts`** runs one oscillator per voice with seeded detune and pan. Pitch and gain curves are sampled from `pitchAt` (and `swellAt`) and scheduled in short value-curve chunks, the same path for live, endless and offline playback. If the page stalls, the scheduler skips the chunks that fell behind instead of getting stuck. On browsers that reject closely spaced curves, it switches to smooth linear ramps. A sub oscillator doubles the bass voice an octave down. The master chain is a low-pass, a gentle tanh saturator (Warmth), a generated convolution reverb whose stereo spread follows Stereo width, and a soft clipper for peak safety: perfectly linear below −3 dBFS and only rounding off the rare peaks above, with levels staged so that's seldom reached. (A compressor-style limiter rode the gain constantly, which audibly distorted pure tones.)

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

## Credits

The furniture, people and pets in the night city's windows are from [Material Design Icons](https://pictogrammers.com/library/mdi/) by Pictogrammers, used under the Apache License 2.0 (see `LICENSES/MDI.txt`).
