## Backlog

* [x] CLI: `audio mar/hare-krishna-1.mp3 normalize podcast -p` displays "processing" instead of normalizing
* [x] CLI: `audio mar/hare-krishna-1.mp3 normalize podcast -p` sound clicks at the beginning (during decoding), decoding shows "processing" instead of decoding, then sound clicks after decode during processing


## Next

* [x] structural ops streaming
* [x] processor plugin contract more conventional
* [ ] playback speed

* [ ] Wavearea integration
* [ ] Audio ponyfill — separate `audio-ponyfill` package (#68)
* [ ] Minimal duration guard on save — some players can't reproduce 1-sample wav (#27)
* [x] Crossfade / transitions convenience — `a.crossfade(b, duration)` or similar (#63)
* [ ] Playground — drag-n-drop files + code editor, probe audiotool-style (#53, #58)
* [x] BPM detection — autocorrelation on energy envelope, `audio.stat('bpm')` + `a.bpm()` query
* [x] Pitch detection — YIN notes, NNLS chroma chords, Krumhansl-Schmuckler key (`stat('notes'/'chords'/'key')`)
* [x] Show BPM/pitch/key in CLI info line (when detected)
* [ ] Common processing scripts (vocal warmup etc)


## Sox parity

- [ ] **compressor** — dynamic range compression / expansion / limiting (SoX `compand`)
- [ ] **reverb** — freeverb reverberation
- [ ] **noise** — noise reduction via spectral profiling (SoX `noisered`)
- [ ] **echo** — echo / delay effect
- [x] **resample** — explicit sample rate conversion
- [x] **dither** — dithering for bit-depth reduction
- [ ] **chorus** — chorus modulation
- [ ] **flanger** — flanging
- [ ] **phaser** — phaser effect
- [x] **vocals** — vocal isolation / removal (SoX `oops`, out-of-phase stereo)
- [x] **allpass** — all-pass filter
- [x] **earwax** — headphone crossfeed

## FFmpeg parity

### Dynamics
- [ ] **compressor** — acompressor: threshold, ratio, knee, attack, release, makeup gain
- [ ] **limiter** — alimiter: lookahead brickwall limiter, true-peak ceiling
- [ ] **gate** — agate: noise gate, threshold, hold, attack, release
- [ ] **compand** — compand: multi-point transfer curve compressor/expander
- [ ] **dynaudnorm** — dynaudnorm: frame-by-frame dynamic normalization
- [ ] **softclip** — asoftclip: tanh/atan/cubic waveshaping

### Effects
- [ ] **echo** — aecho: configurable delay lines with decay
- [ ] **reverb** — freeverb: Schroeder reverb (comb + allpass cascade)
- [ ] **chorus** — chorus: multiple modulated delay lines
- [ ] **flanger** — flanger: short modulated delay with feedback
- [ ] **phaser** — aphaser: cascaded allpass with LFO modulation
- [ ] **tremolo** — tremolo: periodic amplitude modulation (LFO)
- [ ] **vibrato** — vibrato: periodic pitch modulation (LFO)
- [ ] **exciter** — aexciter: harmonic synthesis for presence/air
- [ ] **crusher** — acrusher: bit-depth + sample-rate reduction (lo-fi)

### Spatial
- [ ] **stereotools** — stereotools: width, mid/side balance, phase flip, swap L/R
- [ ] **stereowiden** — stereowiden: Haas-style comb widening
- [ ] **extrastereo** — extrastereo: exaggerate stereo separation
- [ ] **bs2b** — bs2b: Bauer stereo-to-binaural crossfeed
- [ ] **surround** — surround: upmix stereo to 5.1

### Noise / Restoration
- [ ] **denoise** — afftdn: FFT spectral noise reduction (profile + suppress)
- [ ] **declick** — adeclick: click/crackle removal via interpolation
- [ ] **declip** — adeclip: reconstruct clipped samples (autoregressive)
- [ ] **deesser** — deesser: sibilance reduction (frequency-triggered compression)

### EQ / Filtering
- [ ] **firequalizer** — firequalizer: FIR convolution EQ with arbitrary response curve
- [ ] **crossover** — acrossover: Linkwitz-Riley multiband split
- [ ] **tiltshelf** — tiltshelf: tilt EQ (boost low / cut high or vice versa)
- [ ] **superequalizer** — superequalizer: 18-band graphic EQ

### Analysis / Metering
- [ ] **spectralstats** — aspectralstats: centroid, spread, flatness, rolloff, flux, slope, crest
- [ ] **drmeter** — drmeter: dynamic range (crest factor DR value)
- [ ] **replaygain** — replaygain: compute ReplayGain values

### Mixing / Routing
- [ ] **channelsplit** — channelsplit: split multi-channel to separate mono outputs
- [ ] **adelay** — adelay: per-channel delay in ms
- [ ] **multiply** — amultiply: ring modulation (multiply two signals)

### Time
- [ ] **aloop** — aloop: loop a segment N times (≈ repeat, but segment-level)
- [ ] **freqshift** — afreqshift: single-sideband frequency shift
- [ ] **silenceremove** — silenceremove: strip silence from start/end/throughout

### Signal Processing
- [ ] **afftfilt** — afftfilt: arbitrary FFT-domain expression filter
- [ ] **derivative** — aderivative: compute signal derivative
- [ ] **integral** — aintegral: compute signal integral

### Audacity parity

**Have:** amplify (gain), normalize, loudness normalization (normalize), fade in/out, crossfade, change pitch (pitch), change tempo (stretch), change speed (speed), reverse, repeat, high-pass, low-pass, notch, noise reduction (→ denoise), click removal (→ declick), clip fix (→ declip), echo, reverb, phaser, tremolo, compressor, limiter, noise gate (→ gate), truncate silence (→ silenceremove), invert, plot spectrum (spectrum), beat finder (beats/onsets), find clipping (clipping stat), contrast/RMS (rms/loudness stats)

#### Effects — missing
- [ ] **distortion** — waveshaping distortion (multiple curve types: hard clip, soft clip, tube, fuzz)
- [ ] **wahwah** — auto-wah: swept bandpass with LFO (like phaser but frequency-selective)
- [ ] **vocoder** — channel vocoder: modulator/carrier synthesis
- [ ] **paulstretch** — extreme time-stretch (10x–1000x) for ambient/drone textures
- [ ] **sliding-stretch** — continuous tempo+pitch change over selection (start→end rate/semitones)
- [ ] **auto-duck** — sidechain ducker: reduce track volume when control track is active (podcast/voiceover)
- [ ] **adjustable-fade** — non-linear fade with mid-point control, partial fade within selection

#### Spectral editing
- [ ] **spectral-delete** — delete a time×frequency rectangle from spectrogram
- [ ] **spectral-eq** — parametric EQ on a spectral selection (band cut/boost in time×freq region)
- [ ] **spectral-shelves** — shelving filter on spectral selection
- [ ] **spectral-multi** — auto-detect notch/HP/LP from spectral selection shape

#### Generators
- [ ] **tone** — generate sine/square/sawtooth/triangle waveform at given freq+duration
- [ ] **noise-gen** — generate white/pink/brown noise
- [ ] **chirp** — generate frequency sweep (start freq → end freq, linear/log)
- [ ] **dtmf** — generate DTMF telephone tones from digit sequence
- [ ] **pluck** — Karplus-Strong plucked string synthesis
- [ ] **risset-drum** — Risset drum synthesis (inharmonic partials + frequency glide)
- [ ] **rhythm-track** — metronome/click track generator at given BPM

#### Analyzers
- [ ] **contrast** — speech contrast: foreground vs background RMS difference (WCAG accessibility)
- [ ] **label-sounds** — auto-label distinct sounds/silences as regions

## Tier 2

* [x] pitch
* [x] stretch
* [ ] gate
* [ ] compress
* [ ] reverb
* [ ] delay
* [ ] declick
* [ ] denoise
* [ ] shrink-silence

## Tier 3: Delighting

* [ ] spectral-edit
* [ ] stem-separate
* [ ] pitch-correct
* [ ] audio-transient-shaper

### MIREX parity

**Have:** tempo estimation (bpm), beat tracking (beats), onset detection (onsets), melody/pitch extraction (notes — YIN), chord estimation (chords — NNLS + Viterbi), key detection (key — Krumhansl-Schmuckler), MFCC (cepstrum), spectrum

#### Core MIR (active MIREX tasks)
- [ ] **structure** — structural segmentation: verse/chorus/bridge/intro/outro boundaries (HMM + self-similarity matrix)
- [ ] **transcribe** — polyphonic transcription: audio → MIDI note events (onset, offset, pitch, velocity)
- [ ] **downbeat** — downbeat estimation: locate bar-level "1" within beat grid
- [ ] **coversong** — cover song identification: recognize same composition across performances

#### Analysis (classic MIREX tasks)
- [ ] **melody** — continuous melody F0 contour (frame-level Hz, not discrete notes)
- [ ] **multif0** — multiple F0 estimation: all simultaneous pitches per frame (polyphonic)
- [ ] **genre** — audio genre classification (feature vector + classifier)
- [ ] **mood** — mood/emotion classification (valence-arousal or categorical)
- [ ] **tags** — semantic audio tagging (multi-label: genre, instrument, mood descriptors)
- [ ] **fingerprint** — audio fingerprinting: compact hash for exact-match identification
- [ ] **similarity** — audio similarity: distance metric between recordings
- [ ] **drums** — drum transcription: detect kick/snare/hihat onset + class
- [ ] **lyrics-align** — lyrics-to-audio alignment: word/line-level timestamps

#### Source Separation
- [ ] **separate** — stem separation: vocals/drums/bass/other (U-Net / Open-Unmix style)

#### Spectral Features (building blocks)
- [ ] **spectralstats** — spectral centroid, spread, flatness, rolloff, flux, slope, crest
- [ ] **chromagram** — chroma features (12-bin pitch class energy, CQT or STFT based)
- [ ] **tonnetz** — tonal centroid features (6-dim harmonic space from chroma)
- [ ] **tempogram** — tempo over time (local tempo estimation via autocorrelation)


## [ ] Benchmarks

## [ ] Testing – test and fix anything not working

* [ ] All fns must be tested in cases:
  * [x] streams: stream() output matches read() for all major ops
  * [x] combination of multiple ops, especially structural ones
  * [ ] should work both in CLI player, CLI processing and API
  * [x] paged transitions - op can be applied to a page that's not yet available
  * [ ] there must be readme, CLI help, GERUNDS

**Basic correctness** (input → expected output):
* [x] dither — TPDF: 8-bit quantization levels, 16-bit signal integrity, SNR (93 dB / 45 dB), noise floor uniformity
* [x] earwax — crossfeed L→R, mono passthrough, custom cutoff/level
* [x] vocals — center isolate (mid), center remove (side), mono passthrough
* [x] resample — sinc ↑↓, linear, same-rate noop, pitch preserved, stereo, numtaps, round-trip energy (0.0% loss), anti-alias (15kHz attenuated at 22050 Nyquist)
* [x] pitch — +12 octave up, -12 octave down, 0 noop
* [x] stretch — 2x, 0.5x, 1.5x, stability across blocks, stereo, streaming match, combos (crop, reverse, speed, pitch, gain, trim, chain)
* [x] pan — center identity, full left/right, half, mono noop, range
* [x] speed — 2x halves duration + pitch shift, 0.5x doubles, -1 reverse, 0 throws, stereo
* [x] crossfade — equal-power RMS constant ±1 dB, linear curve, stereo, asymmetric, concat sugar, per-transition durations, stream match, no NaN

**Filter accuracy** (SoX sinusoid-fitting method + W3C WPT thresholds):
* [x] allpass — flat magnitude across 100/500/1k/5k/10kHz (< ±1 dB), stereo independent, energy preserved
* [x] highpass — frequency response: 100Hz=-40dB, 500Hz=-12dB, 2kHz=-0.3dB, 5kHz=-0dB; stereo independent; DC attenuation
* [x] lowpass — frequency response: 100Hz=-0dB, 500Hz=-0.3dB, 2kHz=-12dB, 5kHz attenuated
* [x] bandpass — passes center 1kHz, rejects 100Hz
* [x] notch — removes target 1kHz
* [x] eq — parametric +12dB boost at target
* [x] lowshelf — +12dB boost below 500Hz
* [x] highshelf — +12dB boost above 2kHz
* [x] filter state — persists across streaming blocks (stream≡read verified)
* [x] filter warm-up — seek read matches full render slice
* [x] filter(fn) — custom filter function
* [ ] filter automation — parameter changes mid-stream, no zipper artifacts
* [ ] bandpass/notch/eq/lowshelf/highshelf — frequency response with dB thresholds (only basic pass/reject tested, no response curve)

**Stream ≡ read** (stream() output matches read() output):
* [x] gain, fade, reverse, crop, remove, insert, repeat, pad, speed, highpass, lowpass, crossfade
* [x] earwax, vocals (isolate + remove), pan (static + ranged), speed (2x + 0.5x)
* [ ] bandpass, notch, eq, lowshelf, highshelf, allpass — no stream≡read
* [ ] mix, remix — no stream≡read
* [ ] pitch — no stream≡read (vocoder state across blocks)
* [ ] dither — no stream≡read (TPDF random; need statistical equivalence test)
* [ ] clip, split — no stream≡read

**Op composition chains** (chained multi-op stream ≡ read):
* [x] highpass + gain + trim
* [x] vocals + lowpass + normalize
* [x] reverse + gain + fade
* [x] crop + speed + pan (stereo)
* [x] earwax + highpass + gain
* [x] pad + repeat + gain
* [x] stretch + crop, crop + stretch, stretch + reverse, stretch + speed, stretch + pitch, stretch + gain, stretch + trim
* [ ] mix + normalize + fade
* [ ] remix + filter + dither (full mastering chain)

**Live-decode** (push-based source with op applied during streaming):
* [x] gain, highpass, crop, remove, repeat, pad, speed, reverse, insert, trim+normalize
* [ ] earwax, vocals, pan, dither, pitch, stretch, fade — untested on push-based source
* [ ] normalize, remix, mix — untested on push-based source

**Page-boundary stress** (small PAGE_SIZE/BLOCK_SIZE):
* [x] gain across pages, trim block resolution, reverse across blocks, filter state across blocks, fade across pages, crop+gain across pages, concurrent decode+stream, evicted pages restored
* [ ] earwax, vocals, pan, dither, pitch, mix, remix — no page-boundary tests

**Analysis** (mir_eval / MIREX canonical thresholds):
* [x] bpm — click track at 120 BPM, ±10% tolerance; shorthand, range, minBpm/maxBpm, silence=0
* [x] beats — Float64Array, ascending timestamps, silence empty
* [x] onsets — Float64Array, timestamps; silence empty
* [x] notes (YIN) — A4 440Hz detection, tone sequence, silence empty
* [x] chords (NNLS) — C major triad, chord change, silence empty
* [x] key — C major I-IV-V-I, silence N
* [x] spectrum — mel-binned FFT, peak at 440Hz, range query
* [x] cepstrum — 13 MFCC coefficients, C0 non-zero
* [x] silence — region detection, no silence, all silent, minDuration filter, range query
* [x] clipping — detection with timestamps, clean audio, bins mode
* [ ] bpm — multi-tempo (60/80/140/180), ±8% MIREX threshold (only 120 tested)
* [ ] beats — position accuracy within 70ms of ground truth (only count/ordering tested, not timing precision)
* [ ] onsets — 50ms window precision (only presence tested, not timing accuracy)

**CLI execution** (not just parseArgs/help — actual file processing):
* [x] gain, normalize, trim, reverse, remix, highpass, filter+mp3, split, batch glob, macro
* [ ] stretch, pitch, dither, earwax, vocals, allpass, resample, speed, pan, lowpass, eq — no CLI execution test
* [ ] crop, remove, repeat, insert, crossfade, pad, mix — no CLI execution test

**Effects** (when implemented — FFmpeg FATE-style: synthetic input + stored reference):
* [ ] compressor — sine at known dBFS, step input; verify gain reduction, attack/release 10%→90%
* [ ] reverb — impulse → exponential decay; verify RT60 within 10%
* [ ] echo — impulse → verify delay time and decay ratio
* [ ] chorus/flanger/phaser — sine input, verify modulation depth/rate via spectral analysis

**Infrastructure**:
* [x] Synthetic signal generators — tone(freq, dur, sr), energyAt (Goertzel), rms, snr, mid (edge trim)
* [ ] Sweep / noise / impulse generators — not yet factored out as reusable
* [ ] Reference checksum approach (FFmpeg FATE-style) for bit-exact reproducibility of effects
* [ ] Benchmarks — perf baselines for decode, encode, resample, stretch, analysis
* [ ] Encode round-trip accuracy — MP3/OGG encode→decode SNR measurement (only WAV tested)

## Improvements

* [ ] No worker thread for CPU-heavy DSP — stretch, pitch, spectrum all run main thread with cooperative yield. Large files produce jank
* [ ] No OfflineAudioContext fallback for browser decode — relies entirely on audio-decode, limiting codec support in browsers


## Ideas

* [ ] webworker mode - any meaning, no?
* [ ] zzfx op
* [ ] text overlays/labels/metadata?


## Archive

**Bugs**
* [x] `adjustLimit` missing `repeat` — streaming decode miscalculates safe boundary for repeat ops (plan.js:346)
* [x] `dither` falsely marked `pointwise: true` — derivePointwise probes min/max edge values, but dither adds random noise so bounds are incorrect (fn/dither.js:26)
* [x] seek prefetch fire-and-forget async — IIFE in `fn.seek` has no error handler, cache.read failures silently swallowed (core.js:403)

**Design**
* [x] `resample` breaks edit chain — rewritten as plan-based virtual op with `sr` callback pattern, anti-alias lowpass for downsampling
* [x] `audio.from(instance)` shares mutable pages array by reference — shallow-copies: `[...source.pages]`
* [x] `speed`/`stretch` silence segment rate — fixed: `s[4] === null ? undefined : (s[3] || 1) * rate`
* [x] `crossfade` resolve relies on exact op ordering — added `Math.max(0, ...)` guards, imports CURVES from fade.js
* [x] `buildPlan` cache doesn't account for ref mutations — added `refVersion` sum of external ref versions

**Cleanup**
* [x] `rMean` duplicated — stat.js now imports from loudness.js
* [x] `CURVES` duplicated — crossfade.js now imports from fade.js
* [x] `linearResample` duplicated — absorbed by resample rewrite (plan.js resample used directly)
* [x] `walkPages` LRU touch per channel — fixed: per-page guard with `_last` check

**Naming**
* [x] `stats.rms` stores mean-square not RMS — split into `stats.ms` (block field, stores mean-square) + `stat('rms')` (query-only, returns true RMS via sqrt)

**Missing (expected)**
* [x] No `'error'` event on decode failure — added `emit(a, 'error', e)` in decode catch

* [x] Uniform codec wrappers — `@audio/decode-mp3`, `decode-flac`, `decode-opus`, `decode-vorbis`, `decode-qoa`
* [x] There's an issue with player spectrum. When we pause playback, it keeps animating as if there's inertia. Can we please freeze spectrum or maybe just 1 frame if we hit stop? Also it keeps animating if we seek in paused mode.
* [x] Figure out .stream contract across packages: either we can call it stream, or have a factory.

## Issues to close (resolved by v2.0–2.3)

* [x] Close with comment "Resolved in v2.0": #22, #42, #43, #44, #45, #48, #50, #52, #55, #56, #62, #64, #66, #67
* [x] Close as not-applicable: #69 (wrong repo — Zoom complaint)
Remaining open after triage: #27, #53, #57, #58, #63, #68

### v2.3 Engine redo — streams-first

Per-page execution for all ops. Instant playback/editing/analysis regardless of file size or edit depth.

**Core (Phase 1)**
* [x] `render(a)` simplified — calls `readPlan(buildPlan(a))`, no manual edit iteration
* [x] `buildPlan()` always succeeds — `_fn` → pipeline, resolve from source stats, unknown → throw
* [x] Four op types: structural (segment map), sample-level (per-page), stat-conditioned (`.resolve()`), windowed (overlap-add)
* [x] Filter state warm-up on seek — render from `max(0, seekSample - PAGE_SIZE)`, discard warm-up, keep state
* [x] Windowed ops cross-page — `op.overlap = N`, tail carried forward, trimmed after processing
* [x] `trim` has `.resolve()` — scans source stats → emits `crop`
* [x] Two-tier stats — `srcStats` (immutable) vs `stats` (post-edit), dirty tracking via `statsV`

**API cleanup (Phase 2)**
* [x] Options-only ranges — `op(value..., {at, duration, channel}?)`
* [x] Consolidate `.filter(type, ...params)` — unified dispatch table
* [x] Unified stat query — `await a.stat(name, opts?)`, async, kills legacy methods
* [x] `a.read/write` — symmetric PCM pair with channel option
* [x] `a.encode(format?, {at, duration}?)` — encoded bytes
* [x] Playback with options-only ranges — `a.play/pause/stop`, `currentTime`, `volume`, `loop`
* [x] `a.clone()` — independent edit history
* [x] Unify event pattern — `on*` property everywhere

**Features (Phase 3)**
* [x] Entry points: `audio()`, `audio.open()`, `audio.from()`, `audio.record()`, `audio.version`
* [x] Universal source adapter — `pageAccumulator` with `push(chData, sampleRate)`
* [x] Plugin auto-discovery, macro system, batch CLI, per-op help
* [x] Pan, pad, spectrum, cepstrum (integrated with CLI)
* [x] Automation — `a.gain(t => ...)`, `a.pan(t => ...)`, function args per-sample, toJSON omits
* [x] 220 tests (168 lib + 52 CLI, 545 assertions)

### v2.2 Plugin architecture

* [x] Plugin architecture — `audio.fn`, `audio.hook`, `audio.run`, `audio.use()`
* [x] All fn/ modules as `(audio) => {}` plugins
* [x] History extracted — replaces `audio.run`, wraps read/stream/query
* [x] Stats pluggable — `audio.stat(name, factory)`, decode loop iterates registered stats
* [x] Clipping + DC offset stats added
* [x] Filters: highpass, lowpass, bandpass, notch, shelving, parametric EQ

### v2.1 Refactoring

* [x] Internal props consolidated into `a._`
* [x] Function naming unified
* [x] Decode pipeline simplified
* [x] Size guard on render (>500M samples → streaming)
* [x] `audio.index()` → `audio.stat()`, `a.index` → `a.stats`
* [x] Stats extracted to individual files in fn/
* [x] `a.stat()` broken into `a.db()`, `a.rms()`, `a.loudness()`, `a.peaks()`

### v2.0

* [x] Core: decode, pages, index, render, playback
* [x] All tier-1 ops: gain, fade, trim, normalize, crop, remove, insert, repeat, reverse, mix, write, remix
* [x] CLI: positional ops, range syntax, pipe, playback, spectrum
* [x] Non-destructive editing, undo, serialization
* [x] OPFS paging, streaming render, plan-based pipeline
* [x] 144 tests (lib + CLI)

### CLI polish

* [x] Spinner: percentage for processing, plain for loading
* [x] Time format: M:SS / H:MM:SS
* [x] Dropped RMS from display (redundant with LUFS)
* [x] Removed `--stat` flag (stats shown when no ops/output/play)
* [x] Loop indicator on transport line (↻ / space)
* [x] Clipping + DC warnings in info line
