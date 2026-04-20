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
* [ ] CLI `audio split --cue album.cue` — split lossless by cue sheet into N tracks (stolen from mcxiaoke/audio-cli.js)

## Architecture

### Plugin auto-import (`audio.use(...names)`)
- [ ] Built-in registry maps names → subpath imports (mirrors `audio-decode` codec pattern)
- [ ] `audio.use('reverb', 'bpm', 'stretch.wsola')` → dynamic `import()` + register
- [ ] `audio.use(await import('@audio/pitch-yin'))` — bring-your-own still works
- [ ] Core always-bundled set: gain, trim, crop, filter, normalize, fade, mix, reverse, pan, repeat, remix
- [ ] CLI auto-resolves unknown op name → `audio.use(name)` before dispatch
- [ ] Three plugin flavors formalized: **op** (`a.foo()`), **stat** (`a.stat('foo')`), **codec** (decode/encode)
- [ ] MIR → ship as plugins under `@audio/stat-*`, not core

### `audio-module` — unified module convention
- [ ] Problem: 3 sibling conventions today — `audio-effect` (`fn(data, params)` + param-obj state), `pitch-shift` (`makePitchShift(batch, stream)` factory), `dynamics-processor` (polymorphic `fn(data, opts)` + `{write, flush}` stream). None drop into AudioWorklet/VST/`audio` plan without ad-hoc glue.
- [ ] Define contract in `audio-module`: `{name, channels, latency, tail, params:{name:{min,max,default,unit,smoothing}}, create(sr, ch, init) → {process(in,out,n), set(k,v,smooth), reset(), serialize?(), restore?()}}` — mirrors `AudioWorkletProcessor` (narrowest target; others are wider)
- [ ] Ship adapters: `toBatch`, `toStream`, `toWorklet`, `toAudioNode`, `toOp` (for `audio` plan system) — hosts don't care what the module author wrote
- [ ] Flagship pilot module: compressor or delay (simple, stateful, common) — verify runs as batch + stream + AudioWorklet + `audio` op with zero per-host glue
- [ ] Migrate siblings one-by-one: `audio-effect`, `pitch-shift`, `time-stretch`, `dynamics-processor`, `audio-filter`, `noise-reduction` — keep old exports as back-compat shims during transition
- [ ] `audio.use(module)` accepts raw audio-module instances — no name registry needed for BYO plugins
- [ ] Introspectable params → auto CLI help, automation API, UI generation — all free
- [ ] Uniform test harness: feed PCM, assert output, across all libs
- [ ] Native targets (VST3/AU/CLAP/LV2) — separate roadmap; contract must *allow* WASM+iPlug/JUCE wrapper but don't build until one flagship plugin justifies it
- [ ] Risk: 3 existing conventions each evolved for a reason (zero-alloc, ergonomics, overlap-add). Contract must cover all three ergonomics via adapters or migration stalls.

### `@audio/*` namespace migration
- [ ] Scope owned on npm; `@audio/decode-*` already live — extend pattern to ops/algos
- [ ] Meta-package pattern (babel/radix/tanstack): keep `pitch-shift`/`time-stretch`/`audio-effect` as thin meta-packages that reexport `@audio/pitch-*` / `@audio/stretch-*` / `@audio/fx-*`
- [ ] Shared primitives deduped: `@audio/stft`, `@audio/window`, `@audio/biquad`
- [ ] `peerDependencies: {audio: "^2"}` on all subpackages to prevent duplicate cores
- [ ] Pilot with one sibling lib before mass conversion (candidate: `pitch-shift` → `@audio/pitch-yin` + `@audio/pitch-wsola`)
- [ ] Registry in `audio` README — without it, subpackages are invisible

## Tier 2

* [x] stretch
* [ ] pitch
  * [ ] pitch-correct
* [ ] noise-reduction
  * [ ] gate
  * [ ] declick
  * [ ] denoise
* [ ] shrink-silence
  * [ ] compress

* [ ] Modulation: pitch, stretch, repeat, filter, pan, reverb and other params should be adjustable by function


### Effects

Wire `audio-effect` into `audio` as ops (one op per effect, shared param-object streaming style):

- [ ] **reverb** — Schroeder comb + allpass
- [ ] **delay** / **echo** — feedback delay line
- [ ] **multitap**, **ping-pong** — stereo delay variants
- [ ] **chorus**, **flanger**, **phaser**
- [ ] **tremolo**, **vibrato**
- [ ] **wahwah**, **auto-wah**
- [ ] **ring-mod**, **frequency-shifter** — SSB shift via Hilbert
- [ ] **distortion** (soft/hard/tanh/foldback), **exciter**, **bitcrusher**
- [ ] **stereo-widener**, **haas**, **panner**, **auto-panner**
- [ ] **transient-shaper**, **slew-limiter**, **noise-shaping**

Cross-package ops (pull from sibling libs, not audio-effect):
- [ ] **compressor**, **limiter**, **gate**, **expander**, **deesser**, **ducker** (auto-duck), **compand**, **softclip** → `dynamics-processor`
- [ ] **pitch-shift**, **vocoder**, **formant-shift** → `pitch-shift`
- [ ] **paulstretch**, **sliding-stretch** (continuous tempo+pitch envelope over selection) → `time-stretch` (sliding-stretch needs new API)
- [ ] **adjustable-fade** (non-linear, mid-point, partial selection) — `audio` utility, not an effect

Gaps vs sox/audacity/ffmpeg/tone.js after audit:
- Missing from `audio-effect` — **none** (exciter, freq-shifter, auto-panner added 2026-04)
- Not planned (noise reduction, click/declip) → handled in `~/projects/noise-reduction`

## Tier 3: Delighting

* [ ] spectral-edit
* [ ] stem-separate
* [ ] audio-transient-shaper

## AI integrations

_Full release after core ops (compressor, denoise, gate, reverb) are implemented — the more ops exist, the more powerful AI integration becomes. See [.work/mcp.md](mcp.md) for full exploration._

### Stats (prerequisites)
* [x] `crest` stat — dynamic range (peak/RMS ratio in dB), query-only from existing peak+ms stats
* [x] `centroid` stat — spectral brightness (Hz), weighted avg of FFT bins, PCM computed
* [x] `flatness` stat — spectral flatness 0..1 (0=tonal, 1=noise), geometric/arithmetic mean of FFT
* [x] `correlation` stat — inter-channel stereo correlation -1..+1, block-level L*R, Pearson query

### MCP server
* [ ] MCP server (`bin/mcp.js`) — tools: load, info, analyze, edit, save, undo, read, play
* [ ] Stateful session (hold audio instances by id)
* [ ] JSON-RPC over stdio, `@modelcontextprotocol/sdk`

### Skills (AI judgment layer — .md knowledge files)
* [ ] `audio-master` skill — mastering decision tree by target (podcast/broadcast/music/voice/youtube/audiobook)
* [ ] `audio-clean` skill — detect + fix: silence, DC, clipping, hum, noise
* [ ] `audio-analyze` skill — human-readable reports from metrics, file comparison

## Sox parity

- [ ] **noise** — noise reduction via spectral profiling (SoX `noisered`)
- [ ] **compressor** — dynamic range compression / expansion / limiting (SoX `compand`)
- [x] **resample** — explicit sample rate conversion
- [x] **dither** — dithering for bit-depth reduction
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

## Audacity parity

* [ ] noise gate
* [ ] truncate silence

### Spectral editing
- [ ] **spectral-delete** — delete a time×frequency rectangle from spectrogram
- [ ] **spectral-eq** — parametric EQ on a spectral selection (band cut/boost in time×freq region)
- [ ] **spectral-shelves** — shelving filter on spectral selection
- [ ] **spectral-multi** — auto-detect notch/HP/LP from spectral selection shape

### Generators
- [ ] **tone** — generate sine/square/sawtooth/triangle waveform at given freq+duration
- [ ] **noise-gen** — generate white/pink/brown noise
- [ ] **chirp** — generate frequency sweep (start freq → end freq, linear/log)
- [ ] **dtmf** — generate DTMF telephone tones from digit sequence
- [ ] **pluck** — Karplus-Strong plucked string synthesis
- [ ] **risset-drum** — Risset drum synthesis (inharmonic partials + frequency glide)
- [ ] **rhythm-track** — metronome/click track generator at given BPM

### Analyzers
- [ ] **contrast** — speech contrast: foreground vs background RMS difference (WCAG accessibility)
- [ ] **label-sounds** — auto-label distinct sounds/silences as regions

## Tone.js parity

### Synthesis primitives
- [ ] **oscillator** — sine/square/saw/triangle source with detune, pulse-width, partials (richer than `from(fn)`)
- [ ] **envelope** — ADSR / AHDSR envelope generator, applicable to gain or filter cutoff
- [ ] **lfo** — low-frequency oscillator component for parameter modulation
- [ ] **synth-voice** — Synth/FMSynth/AMSynth/MonoSynth: oscillator + envelope + filter voice
- [ ] **drum-synth** — MembraneSynth (kick), MetalSynth (cymbal), NoiseSynth (snare/hat) percussion synthesis
- [ ] **pluck-synth** — Karplus-Strong plucked string (also in Audacity list)
- [ ] **poly** — polyphonic voice allocator: wrap any synth voice with N-voice polyphony

### Mid/Side & channel utilities
- [ ] **midside** — encode/decode L/R ↔ M/S for mid/side processing
- [ ] **channel-strip** — gain + pan + mute + solo + send composite

### Analysis (real-time meters) — mostly already supported

Building blocks present: `a.block` updates per playback chunk (fn/play.js:63), `for await (let chunk of a.stream({at,duration}))` pulls PCM frames, `a.on('data', ({delta,offset}))` pushes block-level stats (min/max/rms/dc) during decode, `melSpectrum()` exported (fn/spectrum.js), `a.stat('rms'|'db')` snapshot queries. CLI already does live FFT visualization this way (bin/cli.js:419).

## MIREX parity

**Have:** tempo estimation (bpm), beat tracking (beats), onset detection (onsets), melody/pitch extraction (notes — YIN), chord estimation (chords — NNLS + Viterbi), key detection (key — Krumhansl-Schmuckler), MFCC (cepstrum), spectrum

### Core MIR (active MIREX tasks)
- [ ] **structure** — structural segmentation: verse/chorus/bridge/intro/outro boundaries (HMM + self-similarity matrix)
- [ ] **transcribe** — polyphonic transcription: audio → MIDI note events (onset, offset, pitch, velocity)
- [ ] **downbeat** — downbeat estimation: locate bar-level "1" within beat grid
- [ ] **coversong** — cover song identification: recognize same composition across performances

### Analysis (classic MIREX tasks)
- [ ] **melody** — continuous melody F0 contour (frame-level Hz, not discrete notes)
- [ ] **multif0** — multiple F0 estimation: all simultaneous pitches per frame (polyphonic)
- [ ] **genre** — audio genre classification (feature vector + classifier)
- [ ] **mood** — mood/emotion classification (valence-arousal or categorical)
- [ ] **tags** — semantic audio tagging (multi-label: genre, instrument, mood descriptors)
- [ ] **fingerprint** — audio fingerprinting: compact hash for exact-match identification
- [ ] **similarity** — audio similarity: distance metric between recordings
- [ ] **drums** — drum transcription: detect kick/snare/hihat onset + class
- [ ] **lyrics-align** — lyrics-to-audio alignment: word/line-level timestamps

### Source Separation
- [ ] **separate** — stem separation: vocals/drums/bass/other (U-Net / Open-Unmix style)

### Spectral Features (building blocks)
- [ ] **spectralstats** — spectral centroid, spread, flatness, rolloff, flux, slope, crest
- [ ] **chromagram** — chroma features (12-bin pitch class energy, CQT or STFT based)
- [ ] **tonnetz** — tonal centroid features (6-dim harmonic space from chroma)
- [ ] **tempogram** — tempo over time (local tempo estimation via autocorrelation)


## [ ] Benchmarks

- [x] Comparison table — `docs/comparison.md` (top 7 in-depth + methods naming reference + ~30 alternatives)
- [ ] Performance benchmarks — fill in perf numbers in `docs/comparison.md` (decode MB/s, normalize, FFT, resample, stretch — vs FFmpeg/SoX/librosa/Pedalboard on the same input)

## [ ] Testing – test and fix anything not working

* [ ] All fns must be tested in cases:
  * [x] streams: stream() output matches read() for all major ops
  * [x] combination of multiple ops, especially structural ones
  * [ ] should work both in CLI player, CLI processing and API
  * [x] paged transitions - op can be applied to a page that's not yet available
  * [ ] there must be readme, CLI help, GERUNDS

* [ ] Modulation: pitch, stretch, repeat, filter, pan, reverb and other params should be adjustable by function

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
* [x] bandpass — dB curve: 100Hz<-10dB (flank), 1kHz>-3dB (pass), 10kHz<-10dB (flank)
* [x] notch — dB curve: 200Hz/5kHz flanks flat (±2dB), 1kHz center<-10dB
* [x] eq — dB curve: 100Hz/10kHz flat (±2dB), 1kHz center +12dB (±2dB)
* [x] lowshelf — 100Hz boosted (>+9dB), 5kHz flat (±2dB)
* [x] highshelf — 200Hz flat (±2dB), 8kHz boosted (>+9dB)
* [x] filter state — persists across streaming blocks (stream≡read verified)
* [x] filter warm-up — seek read matches full render slice
* [x] filter(fn) — custom filter function
* [x] cascaded filters — sequential lowpasses build cumulative response (independent state per op)
* [ ] filter automation — parameter changes mid-stream, no zipper artifacts (no automation API yet)

**Stream ≡ read** (stream() output matches read() output):
* [x] gain, fade, reverse, crop, remove, insert, repeat, pad, speed, highpass, lowpass, crossfade
* [x] earwax, vocals (isolate + remove), pan (static + ranged), speed (2x + 0.5x)
* [x] bandpass, notch, eq, lowshelf, highshelf, allpass
* [x] mix (with audio source), remix (mono→stereo, stereo swap, stereo→mono)
* [x] clip with gain (shared-page scoped edit)
* [ ] pitch — no stream≡read (vocoder state across blocks)
* [ ] dither — no stream≡read (TPDF random; need statistical equivalence test)
* [ ] split — returns array of instances (tested via underlying crop)

**Op composition chains** (chained multi-op stream ≡ read):
* [x] highpass + gain + trim
* [x] vocals + lowpass + normalize
* [x] reverse + gain + fade
* [x] crop + speed + pan (stereo)
* [x] earwax + highpass + gain
* [x] pad + repeat + gain
* [x] stretch + crop, crop + stretch, stretch + reverse, stretch + speed, stretch + pitch, stretch + gain, stretch + trim
* [x] mix + normalize + fade
* [x] filter + gain + dither (mastering chain — read verified)
* [~] remix + filter + processOp — exposes library bug (channel-count change mid-chain breaks output[c]); see Bugs

**Live-decode** (push-based source with op applied during streaming):
* [x] gain, highpass, crop, remove, repeat, pad, speed, reverse, insert, trim+normalize
* [x] earwax, vocals, pan, fade (via push-based audio(null, {channels: 2}))
* [x] gain+fade chain on push source
* [x] remix (mono→stereo after stop on push source)
* [~] normalize — not triggered on push-based sources (needs full stats; requires design review)
* [ ] dither, pitch, stretch — untested on push-based source
* [ ] mix — untested on push-based source (requires source audio mid-stream)

**Page-boundary stress** (small PAGE_SIZE/BLOCK_SIZE):
* [x] gain across pages, trim block resolution, reverse across blocks, filter state across blocks, fade across pages, crop+gain across pages, concurrent decode+stream, evicted pages restored
* [x] earwax, vocals, pan, mix, remix — verified stream≡read at PAGE_SIZE=128, BLOCK_SIZE=32
* [ ] dither, pitch — no page-boundary tests (random / vocoder state make stream≡read inapplicable)

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
* [x] bpm — multi-tempo (60/80/140/180), ±8% MIREX threshold
* [x] beats — position accuracy within 70ms of ground truth (MIREX beat-tracking window)
* [x] onsets — 50ms window precision (onset detection window)

**CLI execution** (not just parseArgs/help — actual file processing):
* [x] gain, normalize, trim, reverse, remix, highpass, filter+mp3, split, batch glob, macro
* [x] stretch, pitch, dither, earwax, vocals, allpass, speed, pan, lowpass, eq
* [x] crop, remove, repeat
* [ ] insert, crossfade, pad (only CLI parseArgs tested, not execution), mix, resample — no CLI execution test

**Effects** (when implemented — FFmpeg FATE-style: synthetic input + stored reference):
* [ ] compressor — sine at known dBFS, step input; verify gain reduction, attack/release 10%→90%
* [ ] reverb — impulse → exponential decay; verify RT60 within 10%
* [ ] echo — impulse → verify delay time and decay ratio
* [ ] chorus/flanger/phaser — sine input, verify modulation depth/rate via spectral analysis

**Infrastructure**:
* [x] Synthetic signal generators — tone(freq, dur, sr), energyAt (Goertzel), rms, snr, mid (edge trim), clickTrack, multiTone
* [x] Encode round-trip accuracy — WAV near-lossless (>60 dB SNR); MP3 energy preserved ±15%, 1 kHz peak dominance verified
* [x] assertStreamRead helper — reusable stream≡read checker
* [ ] Sweep / noise / impulse generators — not yet factored out as reusable
* [ ] Reference checksum approach (FFmpeg FATE-style) for bit-exact reproducibility of effects
* [ ] Benchmarks — perf baselines for decode, encode, resample, stretch, analysis

## Improvements

* [ ] No worker thread for CPU-heavy DSP — stretch, pitch, spectrum all run main thread with cooperative yield. Large files produce jank
* [ ] No OfflineAudioContext fallback for browser decode — relies entirely on audio-decode, limiting codec support in browsers


## Ideas

* [ ] webworker mode - any meaning, no?
* [ ] zzfx op
* [ ] text overlays/labels/metadata?


## Bugs (open)

* [ ] `remix(n)` chained with subsequent process ops throws "Cannot set properties of undefined" — occurs e.g. `a.remix(1).highpass(200).gain(-3)` on stereo. Output buffer for new channel count not properly allocated when >1 process op follows a ch-changing remix (test/index.js had to skip this chain).


## Archive

### Move codec meta to audio-decode / audio-encode
- [x] Problem: `audio/fn/meta.js` holds WAV/MP3/FLAC parsers + writers (~650 lines of codec-specific byte layout). Belongs next to the format readers/writers, not in the engine.
- [x] Parsers → `audio-decode/packages/decode-{wav,mp3,flac}/meta.js` exporting `parseMeta(bytes)` → `{meta, sampleRate, markers, regions}`. Re-exported from `audio-decode/meta` umbrella.
- [x] Writers → `audio-encode/packages/encode-{wav,mp3,flac}/meta.js` exporting `writeMeta(bytes, {meta, markers, regions})`. Re-exported from `encode-audio/meta` umbrella.
- [x] Constants (INFO_MAP, ID3_MAP, VORBIS_MAP) live with their codec — no cross-package shared mapping.
- [x] `audio/fn/meta.js` slimmed to ~150 lines: `pic()` URL helper, `ensureMeta` lazy-parse hook, `Object.defineProperties(audio.fn, {meta, markers, regions})`, projection functions.
- [x] Post-move: `audio/fn/save.js` no longer buffers-then-splices for meta formats — meta-embedding moved into `encode-audio` umbrella (single code path in save). Sub-encoders stay pure PCM→bytes; umbrella's `reg()` intercepts `meta`/`markers`/`regions` opts and applies `writeMeta` on flush.
- [x] Coordinated release: audio-decode (minor, additive), audio-encode (minor, additive), audio (patch, internal refactor).

### Metadata & markers
- [x] `a.meta` — normalized tags read on decode: `{title, artist, album, year, bpm, key, comment, pictures, ...}`
- [x] `a.meta.raw` — format-specific untouched (ID3v2 frames, Vorbis comments, iXML, bext, MP4 atoms)
- [x] `a.markers` — `[{time, label}]`, structural (crop shifts, reverse flips); WAV cue, MP3 CHAP, FLAC CUESHEET
- [x] `a.regions` — `[{at, duration, label}]`; WAV cue+playlist, MP3 CHAP ranges
- [x] Encode round-trip preserves meta+markers where target format supports it
- [x] Scope v1: WAV (bext/iXML/cue) + MP3 (ID3v2) + FLAC (Vorbis+CUESHEET); defer M4A/Opus
- [x] Do NOT overload `stat()` — meta is provenance-tagged container data, stats are derived measurements

### Meter

- [x] **peak stat** — `a.stat('peak')` → `max(|min|, |max|)`, derived via query from existing min/max block arrays. Audio-convention level (dBFS, clipping), not peak-to-peak.
- [x] **'meter' event** during playback — listener-gated, zero cost when no subscribers. Symmetric with decode's `'data'` event but distinct name (avoids overloading "data").
- [x] **polymorphic 3rd arg** to `on()` — `a.on('meter', cb, arg)`:
  - omitted → `{delta, offset}`, all block stats (same shape as decode 'data')
  - string → single stat, scalar avg: `a.on('meter', cb, 'rms')`
  - array → object keyed by name: `a.on('meter', cb, ['rms','peak'])`
  - object → full config: `{type, channel, bins, smoothing, hold}`
- [x] **streaming opts** — `smoothing` (τ seconds, one-pole EMA) and `hold` (τ seconds, peak-hold decay). State per-listener, coefficient computed once per block.
- [x] **channel semantics** — mirror `a.stat()`: omitted = scalar avg across channels, `channel:n` = scalar for that channel, `channel:[0,1]` = per-channel array.
- [x] **CLI rework** — replace manual `melSpectrum` + `prev[b]*0.85` decay at bin/cli.js:419 with `a.on('meter', cb, {type:'spectrum', bins, smoothing})`.

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

**Consistency audit fixes**
* [x] Custom filter contract — forward all ctx params (`at`, `duration`, `channel`) to custom fn; flatten object-type `freq`
* [x] Unify analysis surface — `fn.stat()` requires registry registration; method-backed stats (spectrum, cepstrum, silence, notes, chords, key) self-register via `audio.stat(name, {})`
* [x] Resolve-stage private state — `srcStats` getter on instance (`a.srcStats`) replaces direct `a._.srcStats` access in plan.js
* [x] Lazy mic import — `core.js` dynamically imports `audio-mic` inside `fn.record()` instead of static top-level import
* [x] CLI registry-driven help — `showUsage`/`showOpHelp` read from `audio.op()` descriptors; HELP metadata injected into registry; fallback for non-op methods (clip)
* [x] Freeze internal state bag — `a._` created via `Object.defineProperty` with `writable:false, enumerable:false, configurable:false`

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
