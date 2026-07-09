## Release (v2.3 — ecosystem edition)

Ship state: engine hosts @audio contract atoms natively (params/automation, tail incl.
param-dependent, latency compensation, streaming:false whole-render, sidechain key bus);
`audio.atoms` registry 49 names; scope adopted wholesale (9 legacy deps gone);
atom terminology throughout (audio-module → atom rename absorbed).

* [x] publish wave: 21 @audio/effect (1.1.0) + 11 @audio/denoise (0.1.1) atom releases — registry resolves fully — 2026-07
* [x] README registry section (Ecosystem atoms) — 2026-07
* [x] CI green: suites import published /atom artifacts as devDeps; skip cleanly where unresolvable — 2026-07
* [x] release notes — https://github.com/audiojs/audio/releases/tag/v2.3.0
* [x] released: npm audio@2.3.0 + GitHub release — 2026-07
* [x] worker packaging: 3 files (worker/worker-host/worker-worklet) → 1 self-hosting `worker.js` (scope-detects, dynamic engine import, worklet inlined as blob); `./worker-host` kept as compat alias — 2026-07
* [x] README: Ecosystem-modules + Worker-engine sections relocated out of Recipes/Create flow into condensed API › Atoms/Worker (before Plugins); 17 recipes collapsed into 6 thematic blocks (Clean up/Compose/Analyze/Record & generate/Automate/Stream & persist) matching CLI section density — 2026-07
* [x] released: npm audio@2.3.1 + GitHub release — https://github.com/audiojs/audio/releases/tag/v2.3.1 — 2026-07

## Release (v2.4 — registry completion)

Ship state: `audio.atoms` 49 → 60 names (spatial ×7, shift ×4); engine hosts
channel-changing atoms (contract §channels {inputs, outputs} → op `ch` hook,
plan-level width plumbing through streamPlan/renderBlock — surround 2→5.1 verified
incl. 6ch WAV save via CLI); CLI atom `--help` fixed (module→atom rename leftover
read `desc.module`, broke help synthesis for every atom).

* [x] spatial manifests ×7 + shift manifests ×4 — atoms + package exports + 1.1.0 bumps, family suites green (spatial 4, shift 50) — 2026-07
* [x] audio: registry entries, devDeps ^1.1.0, test/atom-spatial.js (7) + test/atom-shift.js (8) wired into index.js loader — full run green: engine 563, fixes, CLI 137, browser 468 — 2026-07
* [x] publish wave: 7 @audio/spatial-* + @audio/shift{,-pvoc,-formant,-paulstretch} @ 1.1.0 — published, symlinks swapped for npm artifacts (`npm i`), atom suites re-verified against published tarballs (spatial 8, shift 8) — 2026-07
* [ ] audio release (minor — new registry names + ch-changing hosting): version bump + GitHub release + npm publish `audio`

## Release (v2.5 — registry waves A–D)

Ship state: `audio.atoms` 62 → **123 names** (61 new: 31 effect-class + 10 generators/adsr + 20 stat atoms);
**stat-atom flavor shipped** — `{ stat: name, compute(channels, {sampleRate, ...opts}) }` registers via the same
`use()`/registry, host reads (ranged) PCM and hands it over, instance-valued options (similarity `ref`) pre-render;
engine hosts **whole-render tails** (streaming:false atoms declare `tail` → plan pads the materialized input so
reverbs ring out) and **generator atoms** (`inputs: []`, host-negotiated outputs — `audio(5).noise()` renders over
the timeline). Tests: atom-{reverb,dynamics,filter,eq,color,synth,stats}.js (58 new) — engine 621, fixes 19, CLI 138.

* [x] Wave A — 31 effect-class atoms: reverb ×5, dynamics ×5 (incl. fet/opto/varimu/vca color comps), filter ×11, eq ×4, saturate ×4, amp ×2, defeedback — 2026-07
* [x] Wave B — 11 generators: osc (finally devDep'd + tested), noise, chirp, pluck, risset, rhythm, sfx, kick/cymbal/snare, adsr — closes Audacity Generators + most Tone.js synthesis rows — 2026-07
* [x] Wave C — stat-atom convention + 20 stat atoms: loudness ×4 (truepeak/lra/replaygain/dr), spectral ×6 (rolloff/spread/slope/flux/contrast/ltas), mir ×10 (structure/tempogram/melody/downbeat/fingerprint/drums/multif0/transcribe/similarity/coversong) — closes MIREX Analysis + FFmpeg Analysis/Metering at the audio level — 2026-07
* [x] Wave D — direct-import families documented (README "Beyond the registry"): convolution IR, eq-fir curves, eq-crossover designer, tune-midi, denoise-repair, synth-dtmf/wavetable, voice/poly (await event hosting), measure/sinusoidal/voice substrates — 2026-07
* [x] publish wave: 59 packages published across 11 family repos; audio devDeps swapped to artifacts, suite re-verified against published tarballs (engine 621) — 2026-07
* [ ] audio release (minor: registry 123, stat flavor, whole-tail + generator hosting)

## Perf — save/encode streaming JIT fix (2026-07)

Root cause found while benchmarking: `save()`/`encode()` drove the DSP through a per-1024-sample-block async loop (`for await a.stream()` + `await enc()` + `setTimeout` throttle). The fine-grained async suspension kept V8 from tiering up the FFT hot loop (pitch/stretch/denoise) — baseline JIT for the whole file, ~10× slower on a one-shot CLI. `read()` was always fast (sync `streamPlan` generator).

* [x] Fix: `encodeStream` decoded-source fast path — drive the synchronous `streamPlan` generator in `ENCODE_BATCH` (1<<20 sample) bursts, cross an `await` only for I/O between bursts. Continuous state (one pass, no seam re-warm) → output bit-identical to `read()` (verified maxdiff 3.99e-5 = 16-bit LSB). Live/pushable sources keep the per-block path. `loadRefs` exported from plan.js. — [fn/save.js](../fn/save.js)
* [x] Result: cold save 240s pitch 34.75s → 4.01s (8.7×); CLI 10-min pitch 95s → 15.2s (6×), stretch 73s → 8.7s (8×). Now ~1.5–2.6× SoX/librosa (was ~15×). Regression test added (test/index.js: encode ≡ read full + ranged, pins no-seam-rewarm). Full suite green (engine 566, fixes 19, CLI 138).
* [x] Re-benched + rewrote docs/comparison.md § Performance with corrected numbers + the "why it moved 6–9×" note
* [ ] jz/WASM lane (Tier 2, deferred) — for the streaming/realtime/worklet case Tier 1 can't help (can't batch): compile hot kernels (FFT/`fourier-transform`, biquad, phase vocoder) to WASM via `@audio/atom` build → per-atom `dist/*.wasm` + `./wasm` export, host prefers it in `useAtom`. jz compiles `fourier-transform` as-is (40KB, 563ms; beats native clang on jz's fft bench). ~1.4× over warm JS — secondary to Tier 1 for batch, primary for realtime.

## Next

* [ ] playback speed
* [ ] Wavearea integration — audio/worker P1–P3 shipped; wavearea already migrated (engine-per-file, waveform via stat, edits/undo, own player); remaining: adopt facade.play() P3 path or keep own player
* [ ] Audio ponyfill — separate `audio-ponyfill` package (#68)
* [ ] Minimal duration guard on save — some players can't reproduce 1-sample wav (#27)
* [ ] Playground — drag-n-drop files + code editor, probe audiotool-style (#53, #58)
* [ ] Common processing scripts (vocal warmup etc)
* [ ] CLI `audio split --cue album.cue` — split lossless by cue sheet into N tracks (stolen from mcxiaoke/audio-cli.js)

## v3 naming candidates (breaking — collect, don't drip)

* [ ] `clip()` vs `stat('clipping')` — same root, unrelated meanings (excerpt vs distortion). Candidate: rename method to `excerpt()`/`view()` in v3; README disambiguates for now.

## Architecture

### Plugin auto-import (`audio.use(...names)`)
- [x] Built-in registry — `audio.atoms` maps name → `@audio/<pkg>/atom` specifier (audio.js); grows with the published set — 2026-07
- [x] `audio.use('freeverb')` → dynamic `import()` + registers every atom-shaped export; returns promise for string loads, sync for direct — 2026-07
- [x] `audio.use(module)` — bring-your-own contract factory still works (own-`params` detection)
- [x] Core always-bundled set unchanged: gain, trim, crop, filter, normalize, fade, mix, reverse, pan, repeat, remix
- [x] CLI auto-resolves registry op names before parse; uninstalled → `npm i @audio/…` guidance — 2026-07
- [~] Three plugin flavors formalized: **op** ✔ (contract atoms), **stat** ✔ ({ stat, compute } atoms, 2026-07 — 20 shipped), **codec** (decode/encode) convention still open
- [x] MIR → shipped as stat atoms under `@audio/mir-*` /stat exports (not core, not a new namespace) — 2026-07

### `atom` — unified module convention
- [x] Contract designed — [.work/atom.md](atom.md): jz-subset process discipline (same source runs as JS, compiles to WASM, differential CI), adapters toOp/toBatch/toStream/toWorklet, compressor pilot, migration order
- [ ] Problem: 3 sibling conventions today — `audio-effect` (`fn(data, params)` + param-obj state), `pitch-shift` (`makePitchShift(batch, stream)` factory), `dynamics-processor` (polymorphic `fn(data, opts)` + `{write, flush}` stream). None drop into AudioWorklet/VST/`audio` plan without ad-hoc glue.
- [ ] Define contract in `atom`: `{name, channels, latency, tail, params:{name:{min,max,default,unit,smoothing}}, create(sr, ch, init) → {process(in,out,n), set(k,v,smooth), reset(), serialize?(), restore?()}}` — mirrors `AudioWorkletProcessor` (narrowest target; others are wider)
- [~] Ship adapters: `toBatch` ✔, `toStream` ✔, `toWam` ✔; `toWorklet`/`toAudioNode` remain. No `toOp` by design — `audio` hosts contract modules natively in core.js `useAtom` (integration-verified in test/atom-ops.js); the contract is a convention, adapters are only for targets needing machinery
- [x] Flagship pilot: compressor verified as batch + stream + WAM + `audio` op with zero per-host glue (+7 more manifests across conventions; differential vs native <1e-6) — 2026-07
- [~] Sibling migration superseded by the `@audio/*` rewrite: audio-effect/time-stretch/audio-filter deprecated pointing at scope equivalents; remaining: deprecate `dynamics-processor`, `noise-reduction` (+ `pitch-shift` deprecation message is empty) → `@audio/dynamics`, `@audio/denoise`, `@audio/shift`
- [x] `audio.use(module)` accepts raw contract modules (own-`params` detection → toOp; declared tail composes trailing pad) — 2026-07
- [x] Introspectable params: `audio.op(name).atom.params` carries full metadata; CLI `<op> --help` synthesizes usage + param table (min..max unit, defaults) from it — 2026-07
- [ ] Uniform test harness: feed PCM, assert output, across all libs
- [ ] Native targets (VST3/AU/CLAP/LV2) — separate roadmap; contract must *allow* WASM+iPlug/JUCE wrapper but don't build until one flagship plugin justifies it
- [ ] Risk: 3 existing conventions each evolved for a reason (zero-alloc, ergonomics, overlap-add). Contract must cover all three ergonomics via adapters or migration stalls.

### `@audio/*` namespace migration
- [x] Scope owned on npm — ~274 packages published across 36 umbrellas — 2026-07
- [x] `audio` adopted the scope wholesale (14304f1): decode/encode/mic/speaker, filter+eq, weighting, stretch (pvocLock first-class), beat, pitch/mir/note, vocals, window; 9 legacy deps dropped. Kept local with reasons: spectrum a-weighting (needs magnitude-response fn upstream), resample sinc (plug-in interpolator needs random access `(src, tOff, n, rate, phase)` — polyphase's forward-only rate-pair stream doesn't fit), crossfeed mix (spatial-crossfeed hardcodes Q=0.5)
- [x] Shared primitives deduped: `@audio/stft`, `@audio/window`, `@audio/biquad` published — 2026-07
- [x] ~~`peerDependencies: {audio: "^2"}` on all subpackages to prevent duplicate cores~~ — stale: predates the atom pivot; no `@audio/*` package imports `audio` (verified across all package.json 2026-07), import direction is engine→atom only, so no duplicate-core risk exists. Family cores (shift-core etc.) dedupe via normal semver.
- [x] Publish hygiene: driver hard-fails `file:`/`link:` specs (vocals 1.0.1 leak class)
- [x] Registry in `audio` README — Ecosystem atoms section — 2026-07

## Tier 2

* [x] stretch — 2.0.1 adopted: stretch-core dissolved upstream (phase locking → `@audio/spectral-pvoc`), fractional-anaHop NaN fix internal — fn/stretch.js explicit-round workaround dropped — 2026-07
* [x] pitch
  * [x] pitch-correct — `tune` registry atom (`@audio/tune-snap/atom` 1.1.0, streaming:false whole-render): scale enum ×11 + root/a4/tolerance/strength, per-channel YIN→segment→snap→PSOLA; test/atom-tune.js (4); `@audio/tune-midi` direct-import only (guide-note list isn't a scalar param) — 2026-07
* [x] noise-reduction — 11 `@audio/denoise-*` registry modules (specsub/wiener/omlsa auto-profile with measured STFT latency; declick/declip/decrackle/debreath via whole-render; gate/dehum/deplosive/dewind/dereverb causal) — 2026-07. `repair` needs region args (not scalarizable); denoise-gate direct-import only (name collision with dynamics gate)
* [ ] shrink-silence
  * [ ] compress

* [ ] Modulation: pitch, stretch, repeat, filter, pan, reverb and other params should be adjustable by function — process-op params (gain/pan/filter/dither/…) done via engine automation; state-bound params (stretch/pitch factor — vocoder init) and structural params (repeat times) still open. Checked 2026-07 vs stretch 2.0.1: pvoc-lock `factor` is still scalar upstream (hops derived once at construction) — no ratioFn to adopt; shift-side ratioFn exists and is already live in the vocoder/formant atoms.


### Effects

- [x] **@audio/effect family — 21 registry modules** (chorus, flanger, phaser, tremolo, vibrato, autowah, wah, bitcrusher, distortion, exciter, ringmod, freqshift, multitap, pingpong, slew, noiseshaper, lofi, graindelay, stutter, subbass, sbr) + delay pilot + reverb (freeverb). Feedback delays declare param-dependent tails (RT60 from live feedback); freqshift declares Hilbert latency — 2026-07
- [x] **dynamics family — 10 registry modules** (compressor, limiter, gate, expander, deesser, ducker w/ sidechain key, compand, softclip, leveler=dynaudnorm via whole-render, transient-shaper) — 2026-07
- [x] **spatial atoms — 7 registry modules** (widener, haas, panner, autopan, midside, microshift, surround) — microshift kernel refactored to export persistent `shifter` heads; surround declares 2→6 via CONTRACT §channels, hosted through new engine ch-plumbing (useAtom `ch` hook, plan.ch, renderBlock width) — 2026-07
- [x] **shift atoms — 4 registry modules** (pitch-shift umbrella w/ method enum + auto-select, vocoder, formant-shift, paulstretch) — vocoder/formant-shift stream via FIFO with measured latency 2048 = 1×frame (tone-burst envelope xcorr, blocks 128–4096, + sample-count deficit); pitch-shift/paulstretch whole-render (streaming:false); semitones live via fn-ratio (defeats identity shortcut, engine automation works) — 2026-07
- [x] **Wave A — 31 registry atoms across 7 families** (2026-07): reverb ×5 (schroeder, plate/dattorro, fdn, spring, shimmer — whole-render ones ring out via new engine tail-pad for streaming:false ops), dynamics ×5 (fet/opto/varimu/vca color comps + multiband=mcompand), filter ×11 (moog, korg35, diode, oberheim, resonator, spectral-tilt, variable, comb, dcblocker, emphasis+deemphasis), eq ×4 (geq 10-band ISO, tilt, baxandall, dyneq), saturate ×4 (tape, transistor, waveshaper, multisat), amp ×2 (amp, cabinet), defeedback ×1. Registry 61→92. Direct-import-only (array args): reverb-convolution (IR), eq-fir (curve), eq-crossover (SOS designer), per-band multiband/dyneq/multisat forms. Tests: atom-{reverb,dynamics,filter,eq,color}.js (32) — engine 602 green.
- [ ] **paulstretch time-stretch** — `@audio/stretch-paulstretch` (length-changing) stays batch API per CONTRACT (equal frames in/out); pitch-domain paulstretch shipped as atom above; **sliding-stretch** (continuous tempo+pitch envelope) still needs API
- [ ] **adjustable-fade** (non-linear, mid-point, partial selection) — `audio` utility, not an effect
- Kernel defects flagged by manifest verification (upstream fixes pending): chorus/phaser live-resize NaN (mitigated via restart flags), freqshift dry/wet comb at mix<1, multitap per-call allocation

## Tier 3: Delighting

* [ ] spectral-edit
* [ ] stem-separate
* [ ] audio-transient-shaper

## AI integrations

_Gate met 2026-07 — compressor, denoise, gate, reverb (and ~40 more) ship as registry modules. MCP server is unblocked. See [.work/mcp.md](mcp.md) for full exploration._

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

## Parity baseline

Coverage matrix across FFmpeg / SoX / librosa / Pedalboard / MIREX with test evidence: [.work/baseline.md](baseline.md) — drive parity work from it. Per-target checklists below feed it.

## Sox parity

- [x] **noise** — spectral noise reduction: `specsub`/`wiener`/`omlsa` registry modules (auto-profiling) — 2026-07
- [x] **compressor** — compression / expansion / limiting: `compressor`/`expander`/`limiter`/`compand` registry modules — 2026-07
- [x] **resample** — explicit sample rate conversion
- [x] **dither** — dithering for bit-depth reduction
- [x] **vocals** — vocal isolation / removal (SoX `oops`, out-of-phase stereo)
- [x] **allpass** — all-pass filter
- [x] **earwax** — headphone crossfeed

## FFmpeg parity

### Dynamics — all via @audio/dynamics registry modules, 2026-07
- [x] **compressor** — acompressor: threshold, ratio, knee, attack, release, makeup gain
- [x] **limiter** — alimiter: lookahead brickwall (declared latency → engine delay compensation)
- [x] **gate** — agate: noise gate, threshold, hold, attack, release
- [x] **compand** — compand: transfer curve (output levels as params; input breakpoints fixed)
- [x] **dynaudnorm** — `leveler` (streaming:false — engine whole-render hosting pending)
- [x] **softclip** — asoftclip: tanh/atan/cubic/sin/hard waveshaping


### Spatial
- [ ] **stereotools** — stereotools: width, mid/side balance, phase flip, swap L/R
- [ ] **stereowiden** — stereowiden: Haas-style comb widening
- [ ] **extrastereo** — extrastereo: exaggerate stereo separation
- [ ] **bs2b** — bs2b: Bauer stereo-to-binaural crossfeed
- [ ] **surround** — surround: upmix stereo to 5.1

### Noise / Restoration — all via @audio/denoise registry modules, 2026-07
- [x] **denoise** — afftdn-class: `specsub`/`wiener`/`omlsa` (auto-profile, declared STFT latency)
- [x] **declick** — AR interpolation (whole-render)
- [x] **declip** — autoregressive reconstruction (whole-render)
- [x] **deesser** — sibilance-keyed broadband compression
- beyond parity: dehum, dereverb, deplosive, dewind, decrackle, debreath

### EQ / Filtering
- [~] **firequalizer** — `@audio/eq-fir` kernel; direct-import only (arbitrary response curve isn't a scalar param)
- [~] **crossover** — `@audio/eq-crossover` is an SOS designer (feeds multiband/multisat); a band-splitting op needs "N× input channels" which neither contract nor op `ch` hook expresses — deferred
- [x] **tiltshelf** — `tilt` registry atom (`@audio/eq-tilt`) — 2026-07
- [x] **superequalizer** — `geq` registry atom (`@audio/eq-graphic`, 10-band ISO 266) — 2026-07

### Analysis / Metering
- [x] **spectralstats** — centroid/flatness core stats + `rolloff`/`spread`/`flux`/`slope`/`contrast`/`ltas` stat atoms (frame-averaged via own STFT) — 2026-07
- [x] **drmeter** — `dr` stat atom (`@audio/loudness-dr`) — 2026-07
- [x] **replaygain** — `replaygain` stat atom (`@audio/loudness-replaygain`, RG2 {gain, lufs}) — 2026-07

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

### Generators — registry atoms (audio(dur).gen() renders over the timeline) — 2026-07
- [x] **tone** — `osc` atom (sine/square/sawtooth/triangle, detune, gain)
- [x] **noise-gen** — `noise` atom (white/pink/brown/blue/violet, seeded, per-channel independent)
- [x] **chirp** — `chirp` atom (exp/linear sweep over the take)
- [~] **dtmf** — `@audio/synth-dtmf` direct-import only (digit string isn't a scalar param)
- [x] **pluck** — `pluck` atom (Karplus-Strong)
- [x] **risset-drum** — `risset` atom
- [x] **rhythm-track** — `rhythm` atom (bars derived from timeline duration)

### Analyzers
- [ ] **contrast** — speech contrast: foreground vs background RMS difference (WCAG accessibility)
- [ ] **label-sounds** — auto-label distinct sounds/silences as regions

## Tone.js parity

### Synthesis primitives
- [x] **oscillator** — `osc` registry atom (sine/square/saw/triangle, detune) — 2026-07
- [x] **envelope** — `adsr` registry atom applied as gain envelope (release placed to end at the take's end) — 2026-07
- [~] **lfo** — parameter modulation is engine automation (`t => v`); audible LFO effects = tremolo/vibrato/autopan atoms — no separate atom needed
- [ ] **synth-voice** — `@audio/synth-voice` published; needs note-event hosting (contract `events` routing) — direct-import meanwhile
- [x] **drum-synth** — `kick`/`cymbal`/`snare` atoms (Membrane/Metal/Noise class) — 2026-07
- [x] **pluck-synth** — `pluck` atom — 2026-07
- [ ] **poly** — `@audio/synth-poly` published; needs note-event hosting — direct-import meanwhile

### Mid/Side & channel utilities
- [ ] **midside** — encode/decode L/R ↔ M/S for mid/side processing
- [ ] **channel-strip** — gain + pan + mute + solo + send composite

### Analysis (real-time meters) — mostly already supported

Building blocks present: `a.block` updates per playback chunk (fn/play.js:63), `for await (let chunk of a.stream({at,duration}))` pulls PCM frames, `a.on('data', ({delta,offset}))` pushes block-level stats (min/max/rms/dc) during decode, `melSpectrum()` exported (fn/spectrum.js), `a.stat('rms'|'db')` snapshot queries. CLI already does live FFT visualization this way (bin/cli.js:419).

## MIREX parity

**Have:** tempo estimation (bpm), beat tracking (beats), onset detection (onsets), melody/pitch extraction (notes — YIN), chord estimation (chords — NNLS + Viterbi), key detection (key — Krumhansl-Schmuckler), MFCC (cepstrum), spectrum

### Core MIR (active MIREX tasks) — all exposed as stat atoms 2026-07 (`a.stat(name)`)
- [x] **structure** — `structure` stat atom → { boundaries, novelty }
- [x] **transcribe** — `transcribe` stat atom → note events
- [x] **downbeat** — `downbeat` stat atom
- [x] **coversong** — `coversong` stat atom ({ ref } two-signal form, instance pre-rendered)

### Analysis (classic MIREX tasks)
- [x] **melody** — `melody` stat atom → { times, freqs } contour — 2026-07
- [x] **multif0** — `multif0` stat atom — 2026-07
- [ ] **genre** — ML-tier, deferred (no-ML-in-hot-path stance)
- [ ] **mood** — ML-tier, deferred
- [ ] **tags** — ML-tier, deferred
- [x] **fingerprint** — `fingerprint` stat atom (Wang landmark) — 2026-07
- [x] **similarity** — `similarity` stat atom → { score, timbre, harmony } ({ ref } form) — 2026-07
- [x] **drums** — `drums` stat atom — 2026-07
- [ ] **lyrics-align** — ML-tier, deferred

### Source Separation
- [ ] **separate** — stem separation: vocals/drums/bass/other (U-Net / Open-Unmix style)

### Spectral Features (building blocks)
- [x] **spectralstats** — rolloff/spread/flux/slope/contrast/ltas stat atoms + core centroid/flatness — 2026-07
- [~] **chromagram** — `@audio/mir-chroma` frame-level building block (feeds chords); no whole-signal stat form yet
- [~] **tonnetz** — `@audio/mir-tonnetz` frame-level building block; no whole-signal stat form yet
- [x] **tempogram** — `tempogram` stat atom — 2026-07


## [ ] Benchmarks

- [x] Comparison table — `docs/comparison.md` (top 7 in-depth + methods naming reference + ~30 alternatives)
- [x] Performance benchmarks — `bench/` harness (`npm run bench`): 10 ops × 5 tools (audio/librosa/Pedalboard/SoX/FFmpeg), end-to-end from file, best-of-3 subprocess reps; numbers + honest reading in `docs/comparison.md` § Performance. Headline: beat tracking ≡ librosa, analysis ≈ decode cost; slow lane = JS phase vocoder (stretch/pitch ~6–8× realtime) → jz/WASM lane motivation. Found + worked around Node 25 shutdown deadlock (nodejs/node#54918) in subprocess reps — 2026-07

## [ ] Testing – test and fix anything not working

* [ ] All fns must be tested in cases:
  * [x] streams: stream() output matches read() for all major ops
  * [x] combination of multiple ops, especially structural ones
  * [ ] should work both in CLI player, CLI processing and API
  * [x] paged transitions - op can be applied to a page that's not yet available
  * [ ] there must be readme, CLI help, GERUNDS

* [ ] Modulation: pitch, stretch, repeat, filter, pan, reverb and other params should be adjustable by function — process-op params (gain/pan/filter/dither/…) done via engine automation; state-bound params (stretch/pitch factor — vocoder init) and structural params (repeat times) still open

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
* [x] filter automation — parameter changes mid-stream, no zipper artifacts (engine automation: fn params sampled in 128-sample sub-blocks, patch ramps; test/fix-plan.js sweep test)

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

* [x] No worker thread for CPU-heavy DSP — `audio/worker` ships P1–P3 ([.work/worker.md](worker.md)): edit-list RPC facade, breakpoint curves, SAB-free AudioWorklet/worker_threads playback; one self-hosting file — 2026-07. P4 (`audio(src, {worker:true})` opt-in unifying it with the default entrypoint) still open
* [ ] No OfflineAudioContext fallback for browser decode — relies entirely on audio-decode, limiting codec support in browsers


## Ideas

* [x] webworker mode - any meaning, no? → yes, designed: [.work/worker.md](worker.md)
* [ ] zzfx op
* [ ] text overlays/labels/metadata?
* [ ] collection of sound producing hacks - from instagrams, youtubes etc (like whispering voice in bg etc)
* [ ] https://github.com/counterpoint-studio/audio-file-mcp-app - alternative

## Applications

* [ ] Sound level meter (calibrated)
* [ ]

## Bugs (open)

* [x] `remix(n)` chained with subsequent process ops throws "Cannot set properties of undefined" — fixed conceptually: each pipeline stage owns output buffers sized to its channel width (plan.js initProcs/applyProcs); channel count is a per-stage property, not a ping-pong special case. Regression class covered in test/fix-plan.js.

### Fixed by 2026-07 audit sweep (see test/fix-plan.js, test/fix-core.js, test/fix-meta.js + test/index.js additions)

* [x] Reversed-segment offset math — crop/remove/insert/repeat/reverse used forward-only source-offset formula on rate<0 segments; unified on `segSrcStart`/`sliceSegs`/`spliceSegs` primitives (plan.js)
* [x] resolve-stage ops (trim/normalize) read un-remapped source stats — `crop().trim()` lost all data, `crop().normalize()` mis-targeted; stats now remapped/derived through the partial plan (or recomputed exactly at final)
* [x] loadRefs/refVersion checked `edit[1].pages` instead of opts values — insert/mix/crossfade refs never awaited, plan cache never invalidated by ref mutations
* [x] insert/mix/crossfade ignored sample-rate mismatch — segments now carry srcSR/dstSR rate; ctx.render pulls resample via renderAt
* [x] Circular source refs (`a.insert(a)`) — stack overflow → clear error (buildPlan/readRange guards)
* [x] speed/stretch ignored `{at, duration}` — spliceSegs-based ranged plans
* [x] Engine-level range scoping — filter family/dither/vocals/pitch/crossfeed no longer silently ignore `{at, duration}`
* [x] Engine-level automation — any numeric param accepts `t => v` (128-sample sub-blocks + patch ramps); filter automation works (coefficients re-derived on param change)
* [x] Mid-stream edits on decoded sources were frozen for in-flight stream()/play() — plan now recompiles on a.version change with ~20ms crossfade
* [x] toJSON dropped edits with instance sources (hasFunction walked prototype via for..in)
* [x] MAX_FLAT guard applied to public read() path (was render()-only)
* [x] NaN op params rejected at call time (RangeError)
* [x] stretch/pitch phase-lock silently off — time-stretch vocoder read `lock` from 2nd arg; call site fixed
* [x] LUFS per ITU-R BS.1770-4 — channel SUM (dual-mono +3.01dB) + 400ms/75%-overlap gating blocks
* [x] crossfeed unity-sum (was +1.1dB boost on centered content)
* [x] crossfade `'equal'` curve added — true equal-power law for uncorrelated material
* [x] flatness on power spectrum (Peeters 2004); mel filterbank triangular/overlapping (Davis & Mermelstein)
* [x] save() rejected instead of crashing process on write-stream error
* [x] stat() on un-awaited instance null-derefed (README recipes) — awaits full decode
* [x] stop() mid-decode corrupted state (decoded=true, len=0) — pushable-only finalize
* [x] dispose() resurrected by in-flight decode/seek continuations — disposal flag
* [x] emit() skipped listeners on self-unsubscribe — snapshot iteration
* [x] zero-sample decode hung .ready forever — always settles, rejects with error event
* [x] 'data' before 'metadata' event order — queued until metadata
* [x] eviction: seek-restored pages permanently unevictable; no evict during decode or push/record — LRU-touch on restore, untracked-first order, scheduled evict
* [x] core+cache without plan read evicted pages as silence — default READ restores
* [x] projectRegions positional zip broke under repeat — per-segment interval projection + merge
* [x] CLI: `1.2.3db`→NaN silent zeroed output, negative durations unparsed (documented `fade .2s -1s cos` broken), `-1s..` rejected as flag, play-sink exit 0 on failure, batch overwrite without `{name}`, setRawMode crash on piped stdin
* [x] audio.d.ts: filter callback inverted (in-place void), detect() missing, OpDescriptor missing pointwise/deriveStats/sr, stat() overloads


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
