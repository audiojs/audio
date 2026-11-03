# Assets

What the playground loads beside its own modules. `npm run serve` builds them and serves the repository; the playground
is at `/playground/`.

- `audio.js`, `wav.js`, `mp3.js`, `flac.js`, `aiff.js`, and `ogg.js` are generated from this checkout and its installed encoders.
  Refresh them with `node .site-build.js` after changing the library.
- Encoders load only when their format is exported. MP3 and Ogg include their WASM payloads; FLAC uses the bundled libflacjs encoder.
  Encoder licenses are in `LICENSE-encode-*.txt`, `LICENSE-libflacjs.txt`, and `LICENSE-wasm-media-encoders.txt`.
- `window-function.js` and `periodic-function.js` bundle the installed window-function 3.0.3 and periodic-function 2.1.2 (both MIT)
  for `logo/logo.js`, which draws the logo: one sine cycle through a Hann window, filled with a gradient rectangle bent
  to the waveform. `logo/motion.js` makes it answer the hand, in the playground's bar and on audio.js.org's home: it stirs
  when hovered near its middle, turns under a drag and spins on, and a tap changes its waveform. Their lab, any signal
  through any window, is audio.js.org/lab/logo/ (audiojs/audiojs.github.io). `node .site-build.js` refreshes the bundles too.
- `sprae.js` is the standalone Sprae 13.9.4 ES module, `dist/sprae.js` from the npm package.
  Its MIT license is included as `LICENSE-sprae.txt`.
- `tokens.css` holds the colors, type, spacing and motion shared by the playground, audio.js.org and the logo's lab; `logo.svg` is the static mark and tab icon.
- `codemirror.js` bundles the installed CodeMirror 6 and Lezer packages (MIT) the editor's code pane needs: state, view, commands,
  the JavaScript language, completion, lint, search. Licenses are at the end of the file. `node .site-build.js` refreshes it.
- `gl-waveform.js` and `gl-spectrogram.js` are the installed gl-waveform 5 and gl-spectrogram 2 (both MIT), the WebGL2 waveform
  and spectrogram (FFT and reassignment on the GPU) the editor draws with, each one module. `node .site-build.js` copies them.
- The playground's engine is built into `playground/dist/`, which git ignores: `worker.js` and a chunk per plugin and codec, loaded on first use.
  `node .site-build.js` builds it; the playground must be built before it is served.
- `geist.woff2` is the Geist variable Latin font, with its OFL license included.
- `wavefont.woff2` is the variable Wavefont from the local Wavefont 3.6.0 project;
  its SIL Open Font License is included as `OFL-wavefont.txt`.
- The five samples are generated in `playground/samples.js`: a few seconds each of sparse, distinct strikes that read in the waveform, stereo at 44.1 kHz and about −16 LUFS. chime (an airport chime pair, C4–E4–G4–C5 rising, a pause, then falling, on vibraphone bars with their upper modes and a mallet's click), handpan (a slow phrase in D Kurd, each note tuned to its octave and twelfth with the steel's untuned modes above, the ding ringing along), birdsong (two phrases of gliding, warbling whistles between 1.9 and 2.9 kHz, each ending in a twitter falling from 7 kHz), rhodes (the Just the Two of Us chords, Dbmaj9, C7♭9♭13, Fm9, Ebm9, Ab13 and home to Dbmaj9, the voices stepping down and each long chord struck again after the second beat, on an FM electric piano with the suitcase's tremolo and a tape's wobble) and monitor (a patient monitor's beep near 1 kHz at 72 beats a minute). A Freeverb hall places each. No recording is fetched or uploaded.
