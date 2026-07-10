# audio — todo

Registry: **141 names** (ops + stats; codec halves ship in every decode-*/encode-*). Flavors complete: op ✔ stat ✔ codec ✔.
Parity evidence: [.work/baseline.md](baseline.md). Perf: [docs/comparison.md § Performance](../docs/comparison.md).

## Next

1. [ ] **MCP server + skills** — gate long met, ~40+ registry ops + full stat surface ready ([.work/mcp.md](mcp.md)): `bin/mcp.js` (load/info/analyze/edit/save/undo/read/play, stateful sessions, `@modelcontextprotocol/sdk` over stdio) + `audio-master`/`audio-clean`/`audio-analyze` skills. Watch: counterpoint-studio/audio-file-mcp-app (competitor).
2. [ ] **Playground** — drag-n-drop + code editor, audiotool-style probe (#53, #58); worker engine (SAB-free playback) removed the hard part
3. [ ] **jz/WASM lane** — for streaming/realtime/worklet where batch JIT can't help: compile hot kernels (fourier-transform, biquad, pvoc) via `@audio/compile` → per-atom `dist/*.wasm` + `./wasm` export, host prefers in `useAtom`. Blocked on jz typed-array provenance fix (bench/fftplan + bench/provenance repro cases landed in jz; ~6× gap). ~1.4× over warm JS once fixed — realtime-lane priority, not batch.
4. [ ] Small: Wavearea: adopt facade.play() P3 or keep own player · `audio-ponyfill` package (#68) · common processing scripts (vocal warmup etc)

## Open

### Ecosystem (kernels exist, wiring/decision pending)
- [ ] Native targets (VST3/AU/CLAP/LV2) via `@audio/compile` — gated on one flagship plugin justifying it
- Direct-import only (inputs aren't scalar params — documented in README "Beyond the registry"): reverb-convolution (IR), eq-fir (curve), tune-midi (guide notes), denoise-repair (regions), synth-dtmf (digit string), synth-wavetable (tables), spatial-delay (per-channel array), per-band multiband/dyneq/multisat, spectral-edit + Audacity spectral-selection ops (time×freq regions), measure/sinusoidal/voice substrate families
- [ ] Neural lane policy — `@audio/neural-{amp,denoise,separate,runtime}` exist; runtime adapter + no-ML-in-hot-path policy decision gates stem-separate, genre/mood/tags, lyrics-align
- [x] ~~Upstream kernel defects~~ fixed in effect repo (1.1.3, suite 50✓): chorus/phaser/flanger/vibrato live-resize NaN (total ring wrap, state-resize guards, integer param floors — restart flags now liftable if live ramping is wanted), freqshift dry/wet comb (blend against the group-delay-aligned dry — constant latency at every mix), multitap per-call tap-table allocation (+ zero-length ring guard)
- [x] ~~Merge near-dupes~~ done (denoise 14107f0): impls live in `@audio/dynamics-{gate,deesser}` (hysteresis+look-ahead gate, deesser mode 'band'); denoise family keeps its seconds-based API via thin adapters; denoise-gate/-deesser removed + deprecated on npm
- [x] ~~Family-core swap~~ done: denoise on `@audio/stft` (8 pkgs, no local fft left), dynamics-core dissolved (ebb279f — dB/time-constant helpers inlined per atom, biquad from `@audio/biquad`); suites: denoise 54✓, dynamics 35✓
- [x] ~~Per-atom `.d.ts`~~ generated: @audio/compile tools/dts.js derives `audio.d.ts` from manifest params metadata (op/stat/codec flavors, Auto param unions, JSDoc ranges/units) — 156 files across 19 family repos, `./audio` exports gain `types`, all strict-tsc clean. Regenerate on manifest change. Individual READMEs stay open (content authorship — generated prose would be filler).
- [x] ~~Uniform test harness~~ @audio/compile tools/verify.js — feeds seeded PCM through every audio.js manifest (op/stat/codec/analyzer flavors, generator handling, two-signal stat fixtures) + sweeps every numeric param to min/max asserting finite output: **156/156**. First run caught synth-chirp's degenerate-sweep NaN (f0 = f1 → ∞ log ratio; fixed 1.1.2).
### Parity remainders
- ML-tier (deferred per no-ML stance until neural-lane policy): genre, mood, tags, lyrics-align, stem-separate
- Everything else closed 2026-07-10 (see Unreleased): aderivative/aintegral, contrast, label-sounds, zcr shipped as atoms; channelsplit (`split()`/remix) + channel-strip (gain+pan+automation) are recipes, not ops


### Ideas / someday
- [ ] Sound level meter app (calibrated)
- [ ] Text overlays/labels — meta/markers/regions shipped; authoring UX open
- [ ] Collection of sound-producing recipes (whispering-voice-in-bg class hacks)
- [ ] v3 naming (breaking — collect, don't drip): `clip()` vs `stat('clipping')` — rename method to `excerpt()`/`view()`; README disambiguates for now

---

# Archive

### Engine / API
- [x] ~~Modulation of structural params / sliding-stretch~~ shipped: `stretch(t => f)` / `stretch({t, v})` — factor as fn/curve of source time, duration = ∫factor dt (see Unreleased). Streaming variable-length for *data-dependent* custom ops stays out of scope (realtime-unhosteable); deterministic rate curves decompose to piecewise segments — the supported structural mechanism.
- [x] ~~Per-block note-event feed for streaming instruments~~ shipped: core.js feedEvents — compiled note slots sliced per block, times rebased, pooled slots per contract §events; seek-safe (binary search, no monotonic cursor); validated by an inline streaming instrument test (voices persist across blocks, stream≡read).

### Testing gaps
- [x] ~~CLI execution tests~~ insert/mix/crossfade/resample e2e added (pad already had one) — and the mix content check caught the opRange tiling bug (see Unreleased)
- [x] ~~stream≡read for pitch + dither~~ pitch: ranged-vs-full spectral test (Goertzel — zc overcounts on phasy vocoder output; found pitch(5) spectrally exact); dither: statistical equivalence (pass divergence ≤ 2.5 LSB, no bias, TPDF bound vs source)
- [x] ~~Live-decode/push-source coverage~~ dither/pitch/stretch/mix on push sources + dither through a live stream while pushing; normalize on push sources still needs design review (full stats unavailable)
- [x] ~~FATE-style stored-reference tests~~ test/plugin-fate.js: freeverb impulse→RT60 1.42s (Schroeder integration), delay echo spacing + decay ratio = feedback, tremolo depth/rate via rms envelope, pinned FNV-1a checksum of a deterministic biquad+gain+fade chain (bit-exact reproducibility)
- [x] ~~Reusable sweep/noise/impulse test generators~~ test/gen.js (tone, Farina ESS sweep, seeded noise, impulse, clickTrack, silence, rms) — 13 duplicate definitions collapsed to aliases across index/cli/fix-*/atom-* suites; atom-denoise now on seeded noise (reproducible)
- [x] ~~README/CLI-help/gerund coverage~~ enforced by a cli test: every public op must have help, a gerund label, and a README mention — all currently covered

## Unreleased (2026-07)

**Sliding stretch** — `a.stretch(t => f)` / `stretch({t, v})`: continuous tempo envelope, pitch preserved, duration = ∫factor dt. Three layers: fourier-transform 2.4.0 (stftBatch/stftStream accept function hops `(frameStart, ctx) => hop`, sampled per analysis frame; running accumulators replace the closed-form emit bound; constant hops keep the exact legacy path — 32✓); stretch-pvoc-lock 1.2.0 (`factor` as fn of source seconds → per-frame anaHop — 155✓); engine (expand samples the envelope per 2048-sample quantum → piecewise-constant `_stretch_seg` segments — plan-time deterministic, so ranged reads/seek/duration/serialization ride the segment algebra — + `_stretch_dsp` drives the vocoder's live hop fn and a ring-position → quantum drain map: the drain rate follows the *content* under the cursor, not wall time, killing FIFO-lag detune). Bit-exact stream≡read; ranged form supported; pre-range bit-equal. adjustLimit integrates piecewise for progressive decode; renderBlock/maxSrcSample got a sorted-tiling binary search (piecewise plans emit thousands of segments). **Per-block note feed** — streaming instruments get contract §events per block (slots sliced + rebased block-relative, pooled, seek-safe); whole-render feed unchanged. Engine 661✓, CLI 144✓.


**Parity remainders closed (2026-07-10)** — registry += derivative/integral (`@audio/filter-derivative` — FFmpeg aderivative/aintegral; differential-verified vs ffmpeg 8.0.1: derivative bit-exact chunked, integral float32-accumulator-exact with a strictly-more-accurate double acc; `leak<1` anti-drift extension), speech-contrast (`@audio/loudness-contrast` — Audacity Contrast / WCAG 2.0 SC 1.4.7 ≥20 dB pass; explicit `fg`/`bg` [at,dur] slices = Audacity's two-selection workflow, auto threshold-pooled 10 ms frames as extension), sounds (`@audio/loudness-sounds` — Audacity Label Sounds: 10 ms chunks, peak/avg/rms measurement, minSilence gap-close + minSound forward-fold, per-side sound-bounded padding, 10k cap), zcr (`@audio/spectral-zcr` — librosa-exact: signbit diff incl −0, frames 2048/512, mean over frame length). Registry 136 → 141; umbrellas filter 3.1.0 / loudness 1.1.0 / spectral 1.2.0; family suites filter 109✓ loudness 21✓ spectral 23✓. Adversarial review caught two real bugs pre-publish: padding claimed gaps sequentially (manual: labels may overlap *labels*, never sounds — now per-side against raw sound boundaries) and contrast auto-pool scanning inside the caller's explicit fg (now excluded). channelsplit closed as `split()`/remix recipe, Tone.js channel-strip as gain+pan recipe. comparison.md refreshed: all stale `(plan)` cells → shipped registry names, new Derivative/integral + Speech contrast rows, Silence row += `stat('sounds')`, honest cells for FIR (direct-import), stem-separation (`@audio/neural-separate` import), HRTF (—).

**Worker P4 closed** — `audio(src, {worker: true})` dispatches to the worker facade once `audio/worker` is imported (global-symbol slot — no engine↔facade import in either direction, no double-hosting in worker scope); + live `playbackRate` parity: varispeed extracted to fn/varispeed.js (shared, engine-free), worker pump runs it, sinks map output consumption → source time (worklet: per-block span queue with interpolation; speaker: per-chunk srcEnd) — fix-worker 21✓. **Contract `frames` hook** (structural custom ops, whole-render form) — `streaming: false` plugins declare output length as fn of input (`frames: (n, {params}) => round(n·factor)`); plan sizes output buffers by it, timeline/duration/serialization follow (CONTRACT.md §frames; engine test pinned). **Stretch manifests ×9** ride on it — published 1.1.0, registry += stretch-{pvoc-lock,pvoc,pghi,wsola,psola,sms,transient,hybrid,paul} (plugin-stretch suite). **Published 2026-07-10**: mir-chroma/tonnetz 1.1.0 (registry += chroma/tonnetz, plugin-stats tests), effect ×6 1.1.3 (kernel fixes), decode 3.11.1 (dual-mono fix — audio deps refreshed); registry 125 → 136. Stragglers item dropped (referent packages don't exist — verified npm/GitHub; real near-dupe deprecations happened in the denoise merge). **atom → plugin rename in code** — test/atom-*.js → plugin-*.js, `useAtom/isAtom` → `useOp/isOp`, descriptor `atom` field → `plugin` (`atom` kept as deprecated alias one cycle), `atomHelp` → `pluginHelp`, CLI prints "Plugin", d.ts StatAtom/CodecAtom → StatPlugin/CodecPlugin (deprecated aliases). **Dither noise-shape test de-flaked** (5-probe/64k statistic vs 2-probe/16k coin-flip).

**mix/write tiling fix** — unranged position-dependent process ops restarted at every block: `opRange` defaulted `at` to 0 while the engine passes *block-relative* at, so `mix(b)` tiled b's first 1024 samples across the whole file (`write(data)` same class; ranged calls were fine, which is why constant-fill tests never saw it). Fixed at the root: unset `at` → −blockOffset (absolute 0); gain/pan clamp unaffected, crossfade-direct also healed. Caught by the new CLI mix e2e content check; pinned in fix-plan.js. **Testing infra**: test/gen.js shared generators (Farina sweep, seeded noise — 13 dup tone defs collapsed), CLI e2e for insert/mix/crossfade/resample, page-boundary dither/pitch tests.

**Live playback speed** — `a.playbackRate` takes effect mid-playback: fn/play.js varispeed (device at native sr; fractional tape cursor, linear interp, one-pole ~50ms rate smoothing — Tape.js-style, click-free, no device reopen; bit-exact copy path at unit rate). CLI player: `[`/`]` ∓0.25×, `=` reset, rate shown in transport. **shrink op** (shrink-silence) — compress pauses to target gap via stat-conditioned resolve emitting shift-adjusted removes (trim pattern); ranged; `shrink(0)` = full silenceremove; covers FFmpeg `silenceremove` + Audacity truncate-silence. **Adjustable fade** — `fade(dur, {start, end, mid, at})`: arbitrary gain levels + half-amplitude-point skew; classic fades bit-identical (Audacity adjustable-fade). **save/encode empty-range guard** (#27) — throws before the sink opens (no truncated/header-only files); live sources error on ended-empty. **CLI `split --cue`** — cue-sheet parsing (INDEX 01 mm:ss:ff), `{title}` output token, title/artist/album tagged onto parts, hidden-pregap crop. **OPFS budget auto-detect** — `navigator.storage.estimate()` quota/4 clamped 64MB..2GB (`audio.detectBudget`), explicit `{budget}` still wins, 500MB fallback. **OfflineAudioContext decode fallback** — browser-native decode for formats beyond bundled codecs; original error preserved when unavailable. **crossover op** — LR4 band-splitting (N freqs → N+1 bands × channels, band-major = FFmpeg `acrossover`), allpass-aligned flat sum; the op `ch` hook already expressed N× width (`desc.ch(ch, extra)` is a function — the eq-crossover blocker note was stale; `@audio/eq-crossover` designer stays direct-import). Engine 646 green, CLI 143.

## Release 2.5.0 / 2.5.1 — flavors complete (2026-07)

Contract split absorbed (@audio/atom → `@audio/compile`, manifest = **audio.js** / `<pkg>/audio` / `"audio"` field; ecosystem republished 1.1.1; toBatch/toStream → `audio/batch`). **Codec flavor**: `{ codec, test?, decode?, encode? }` registers via the same use()/registry — test() sniffs where audio-type draws a blank, decode/encode extend `audio()`/`save()`; halves merge by format name (2.5.1); bundled umbrellas keep precedence (streaming decode stays streaming); decode ×12 + encode ×10 manifests published; contract doc sentence in @audio/compile (objects — compilers ignore by construction). **Note-event hosting**: `notes` option → contract §events slots (on/off paired by id) for whole-render instruments; `voice` + `poly` published → registry 125. genre/mood/tags: checked, nothing available, deferred (no-ML). Engine 629 green.

## Release 2.4.0 — registry waves (2026-07)

`audio.atoms` 60 → 123 in four waves. **A — 31 effect-class atoms**: reverb ×5 (schroeder, plate, fdn, spring, shimmer — whole-render rings out via engine tail-pad), dynamics ×5 (fet/opto/varimu/vca + multiband=mcompand), filter ×11 (moog, korg35, diode, oberheim, resonator, spectral-tilt, variable, comb, dcblocker, emphasis+deemphasis), eq ×4 (geq, tilt, baxandall, dyneq), saturate ×4, amp ×2, defeedback. **B — 11 generators** (`inputs: []`, render over the timeline): osc, noise, chirp, pluck, risset, rhythm, sfx, kick/cymbal/snare, adsr — closed Audacity Generators + Tone.js synthesis rows. **C — stat-atom flavor** (`{ stat, compute }`, host reads ranged PCM, instance opts pre-render) + 20 stats: loudness truepeak/lra/replaygain/dr, spectral rolloff/spread/slope/flux/contrast/ltas, mir structure/tempogram/melody/downbeat/fingerprint/drums/multif0/transcribe/similarity/coversong — closed MIREX Analysis + FFmpeg Analysis/Metering. **D** — direct-import boundary documented (README "Beyond the registry"). 59 packages published across 11 family repos; suites re-verified against artifacts.

Also in 2.4.0: **tune** registry atom (pitch-correct: scale snap, YIN→segment→PSOLA; tune-midi direct-import); stretch 2.0.1 adopted (stretch-core dissolved, fractional-anaHop fix — engine workaround dropped); shift 1.1.1 + fourier-transform 2.3.1 absorbed (shift atom latency re-verified 2048).

## Perf — save/encode streaming JIT fix (2026-07)

`save()`/`encode()` drove DSP through a per-1024-block async loop — V8 never tiered up the FFT (baseline JIT whole-file, ~10× slow on one-shot CLI); `read()` was always fast (sync generator). Fix: decoded sources render through the synchronous `streamPlan` in `ENCODE_BATCH` (1<<17) bursts, awaiting only for I/O — bit-identical to read() (LSB-verified), knee measured at 1<<14, worst stall ~60ms. Results: cold 240s pitch save 34.75s → 4.01s; CLI 10-min pitch 95s → 15.2s, stretch 73s → 8.7s (~1.5–2.6× SoX/librosa, was ~15×). Benchmarks: `bench/` harness (`npm run bench`, 10 ops × 5 tools, end-to-end subprocess reps) + honest numbers in docs/comparison.md; found + worked around Node 25 shutdown deadlock (nodejs/node#54918). jz slow-lane reproduced upstream: bench/fftplan + bench/provenance cases (typed-array kind loss through returned objects/Map/params — ~6×; fused map+reduce suspicion retracted, was wasm warmup artifact).

## Release 2.3.x — ecosystem edition (2026-07)

Engine hosts contract atoms natively (params/automation, param-dependent tails, latency compensation, streaming:false whole-render, sidechain key bus); registry born at 49 names (effect ×21 + denoise ×11 waves published); scope adopted wholesale (9 legacy deps gone); atom terminology absorbed; worker packaging → one self-hosting worker.js; README registry section + recipes consolidation. Releases: 2.3.0, 2.3.1.

Registry-completion follow-up (shipped in 2.4.0): spatial ×7 (widener, haas, panner, autopan, midside, microshift, surround — 2→5.1 via engine ch-plumbing: op `ch` hook, plan.ch, renderBlock width; 6ch WAV verified) + shift ×4 (pitch-shift umbrella w/ method enum, vocoder, formant-shift, paulstretch — FIFO hosting with measured latency 2048 = 1×frame; live semitones via fn-ratio); CLI atom `--help` fixed (desc.module leftover). peerDependencies item ruled stale (no @audio pkg imports audio; direction is engine→atom only).

## Parity checklists (evidence — all shipped unless listed in Open above)

**SoX**: noise (specsub/wiener/omlsa) · compressor/expander/limiter/compand · resample · dither · vocals (oops) · allpass · earwax ✔
**FFmpeg dynamics**: acompressor, alimiter, agate, compand, dynaudnorm (leveler), asoftclip ✔
**FFmpeg spatial**: stereotools/stereowiden/extrastereo (widener/haas/midside class), bs2b (crossfeed), surround (2→5.1) ✔
**FFmpeg restoration**: afftdn, adeclick, adeclip, deesser (+ dehum/dereverb/deplosive/dewind/decrackle/debreath beyond parity) ✔
**FFmpeg EQ**: tiltshelf (tilt), superequalizer (geq), acrossover (crossover op — built-in, LR4 band-split via `ch` hook) ✔; firequalizer — direct-import (response curve)
**FFmpeg analysis**: aspectralstats (centroid/flatness core + rolloff/spread/flux/slope/contrast/ltas/zcr stats), drmeter (dr), replaygain ✔
**FFmpeg misc**: amultiply (ringmod), afreqshift (freqshift), aloop (repeat), aderivative/aintegral (derivative/integral — bit-exact differential vs 8.0.1) ✔, adelay (spatial-delay, direct-import), afftfilt (spectral-edit kernel, direct-import), silenceremove — ends (trim) + throughout (shrink) ✔; channelsplit = `split()`/remix recipe
**Audacity**: noise gate (gate), Generators — tone (osc), noise-gen, chirp, pluck, risset-drum, rhythm-track ✔ (dtmf direct-import); truncate-silence (shrink) + adjustable-fade (fade start/end/mid) ✔; Contrast (speech-contrast stat, WCAG 2.0 SC 1.4.7) + Label Sounds (sounds stat) ✔; spectral-selection ops — direct-import (spectral-edit)
**Tone.js**: oscillator, envelope (adsr), drum-synth (kick/cymbal/snare), pluck-synth, synth-voice (voice), poly ✔; lfo = engine automation + tremolo/vibrato/autopan; midside ✔; channel-strip = gain+pan recipe (not an op)
**MIREX**: bpm, beats, onsets, notes, chords, key, cepstrum, spectrum (core) + structure, transcribe, downbeat, coversong, melody, multif0, fingerprint, similarity, drums, tempogram (stat atoms) ✔; ML-tier → Open
**Stats prerequisites (AI gate)**: crest, centroid, flatness, correlation ✔ — MCP unblocked

## Architecture (settled)

- Plugin flavors: **op** (contract factory + params), **stat** (`{stat, compute}`), **codec** (`{codec, test?, decode?, encode?}`) — all register via `audio.use()` / `audio.plugins` (`audio.atoms` = deprecated ≤2.5 alias); CLI auto-resolves names, `--help` synthesized from param metadata
- Contract = audio.js manifest (audiojs/compile CONTRACT.md); *atom* = informal name for the unit/package; engine hosts natively (no toOp) incl. whole-render + tails, generators, ch-changing atoms, sidechain key bus, note events, plugin-delay compensation
- `@audio/*` scope: ~330+ packages, 36+ umbrellas; shared primitives deduped (@audio/stft, window, biquad); publish hygiene (no file:/link: specs)
- Sibling conventions superseded by the scope rewrite (audio-effect/time-stretch/audio-filter deprecated → scope equivalents)

## Fixed bugs (2026-07 audit sweep — test/fix-*.js pin them)

remix+proc channel-width class (per-stage output buffers) · reversed-segment offset math · resolve-stage stats un-remapped (crop().trim()) · loadRefs/refVersion wrong field · insert/mix/crossfade sample-rate mismatch · circular refs → clear error · speed/stretch ranged plans · engine-level range scoping + automation for all ops · mid-stream edit recompile with crossfade · toJSON prototype walk · MAX_FLAT on read() · NaN params rejected · phase-lock call site · LUFS per BS.1770-4 · crossfeed unity-sum · equal-power crossfade curve · flatness/mel per literature · save() stream-error rejection · stat() on un-awaited instance · stop()/dispose() races · emit() snapshot iteration · zero-sample decode hang · data-before-metadata order · eviction LRU classes · projectRegions under repeat · CLI parse/exit/raw-mode class · audio.d.ts drift · adjustLimit repeat · dither pointwise flag · seek prefetch swallow · resample chain-break redesign · from(instance) shared pages · silence segment rate · crossfade ordering guards · buildPlan refVersion · dup helpers (rMean/CURVES/linearResample) · walkPages LRU touch · ms/rms split · error event on decode failure

## Earlier eras

- **Meter** (peak stat, 'meter' event w/ polymorphic 3rd arg, smoothing/hold, CLI spectrum rework) · **Metadata & markers** (a.meta/raw, markers, regions, encode round-trip; codec meta moved into decode-*/encode-* packages) · **Consistency audit** (custom filter ctx forwarding, unified analysis surface, srcStats getter, lazy mic import, registry-driven CLI help, frozen `a._`)
- **v2.3 engine redo** — streams-first: 4 op types, buildPlan always succeeds, filter warm-up on seek, two-tier stats, options-only ranges, unified stat query, read/write pair, plugin auto-discovery, macros, automation
- **v2.2** plugin architecture · **v2.1** refactoring · **v2.0** core (decode/pages/index/render/playback, tier-1 ops, CLI, non-destructive editing, OPFS paging)
- **CLI polish** (spinner, time format, transport indicators, clipping/DC warnings)
- **Issues closed by v2.0–2.3**: #22 #42 #43 #44 #45 #48 #50 #52 #55 #56 #62 #64 #66 #67 (+#69 n/a). Open after triage: #53, #57, #58, #63, #68 (#27 closed by the save guard, 2026-07).
