# audio — todo

Registry: **125 names** (ops + stats; codec halves ship in every decode-*/encode-*). Flavors complete: op ✔ stat ✔ codec ✔.
Parity evidence: [.work/baseline.md](baseline.md). Perf: [docs/comparison.md § Performance](../docs/comparison.md).

## Next

1. [ ] **MCP server + skills** — gate long met, ~40+ registry ops + full stat surface ready ([.work/mcp.md](mcp.md)): `bin/mcp.js` (load/info/analyze/edit/save/undo/read/play, stateful sessions, `@modelcontextprotocol/sdk` over stdio) + `audio-master`/`audio-clean`/`audio-analyze` skills. Watch: counterpoint-studio/audio-file-mcp-app (competitor).
2. [ ] **Playground** — drag-n-drop + code editor, audiotool-style probe (#53, #58); worker engine (SAB-free playback) removed the hard part
3. [ ] **jz/WASM lane** — for streaming/realtime/worklet where batch JIT can't help: compile hot kernels (fourier-transform, biquad, pvoc) via `@audio/compile` → per-atom `dist/*.wasm` + `./wasm` export, host prefers in `useAtom`. Blocked on jz typed-array provenance fix (bench/fftplan + bench/provenance repro cases landed in jz; ~6× gap). ~1.4× over warm JS once fixed — realtime-lane priority, not batch.
4. [ ] **playback speed** — live rate control (Tape.js smooth ramping as reference)
5. [ ] **shrink-silence** (+ compress pauses to target gap) — covers FFmpeg `silenceremove` (throughout) + Audacity truncate-silence; silence stat + remove op exist, needs a stat-conditioned resolve like trim
6. [ ] Small: minimal duration guard on save (#27) · CLI `audio split --cue album.cue` · Wavearea: adopt facade.play() P3 or keep own player · `audio-ponyfill` package (#68) · common processing scripts (vocal warmup etc)

## Open

### Engine / API
- [ ] Modulation of state-bound + structural params (stretch/pitch factor — vocoder init; repeat times) — process-op params done via engine automation. Checked vs stretch 2.0.1: pvoc-lock `factor` still scalar upstream; shift-side ratioFn already live in vocoder/formant atoms.
- [ ] sliding-stretch (continuous tempo+pitch envelope) — needs API; `@audio/stretch-paulstretch` (length-changing) stays batch per contract (equal frames in/out)
- [ ] Per-block note-event feed for *streaming* instruments — whole-render feed shipped (voice/poly); deferred until a streaming instrument exists
- [ ] eq-crossover as band-splitting op — needs "N× input channels", which neither contract §channels nor the op `ch` hook expresses
- [ ] adjustable-fade (non-linear, mid-point, partial selection) — `audio` utility
- [ ] Worker P4 — `audio(src, {worker: true})` opt-in unifying worker engine with the default entrypoint ([.work/worker.md](worker.md))
- [ ] OfflineAudioContext fallback for browser decode (codec support beyond audio-decode)
- [ ] Structural custom ops — variable-length output blocks (open since research.md)
- [ ] OPFS budget auto-detect via `navigator.storage.estimate()` (fixed 500MB default today)

### Ecosystem (kernels exist, wiring/decision pending)
- [ ] Chromagram/tonnetz whole-signal stat forms (`@audio/mir-chroma`/`-tonnetz` are frame-level building blocks)
- [ ] Neural lane policy — `@audio/neural-{amp,denoise,separate,runtime}` exist; runtime adapter + no-ML-in-hot-path policy decision gates stem-separate, genre/mood/tags, lyrics-align
- [ ] Upstream kernel defects (flagged by manifest verification): chorus/phaser live-resize NaN (mitigated via restart flags), freqshift dry/wet comb at mix<1, multitap per-call allocation
- [ ] Deprecate legacy stragglers: `dynamics-processor`, `noise-reduction` (+ `pitch-shift` deprecation message empty) → `@audio/dynamics`, `@audio/denoise`, `@audio/shift`
- [ ] Merge near-dupes: dynamics-gate/denoise-gate, dynamics-deesser/denoise-deesser (deliberately-qualified variants today)
- [ ] Family-core swap: denoise-core/stft → `@audio/stft`, dynamics-core/biquad → `@audio/biquad` (published, not swapped in)
- [ ] Per-atom `.d.ts` + individual READMEs (~280 atoms — content authorship, not mechanical)
- [ ] Uniform test harness: feed PCM, assert output, across all family libs
- [ ] Native targets (VST3/AU/CLAP/LV2) via `@audio/compile` — gated on one flagship plugin justifying it
- Direct-import only (inputs aren't scalar params — documented in README "Beyond the registry"): reverb-convolution (IR), eq-fir (curve), tune-midi (guide notes), denoise-repair (regions), synth-dtmf (digit string), synth-wavetable (tables), spatial-delay (per-channel array), per-band multiband/dyneq/multisat, spectral-edit + Audacity spectral-selection ops (time×freq regions), measure/sinusoidal/voice substrate families

### Parity remainders
- FFmpeg: channelsplit (core `split()`/remix cover most; per-channel mono outputs = CLI recipe), aderivative/aintegral (trivial, low value — on demand)
- Audacity: speech **contrast** analyzer (foreground/background RMS, WCAG — distinct from spectral-contrast stat), **label-sounds** (auto-label regions — silence stat + segmentation compose)
- Tone.js: channel-strip composite (gain+pan+mute+solo — recipe, likely not an op)
- ML-tier (deferred per no-ML stance until neural-lane policy): genre, mood, tags, lyrics-align, stem-separate

### Testing gaps
- [ ] CLI execution tests: insert, crossfade, pad, mix, resample (parseArgs-only today)
- [ ] stream≡read for pitch (vocoder state) + dither (needs statistical equivalence, TPDF random)
- [ ] Live-decode/push-source coverage: dither, pitch, stretch, mix; normalize on push sources needs design review (full stats unavailable)
- [ ] Page-boundary tests for dither/pitch
- [ ] FATE-style stored-reference tests for effects (impulse→RT60, delay/decay ratios, modulation depth via spectral analysis) + reference-checksum approach for bit-exact reproducibility
- [ ] Reusable sweep/noise/impulse test generators (factored out)
- [ ] README/CLI-help/gerund coverage for every op

### Ideas / someday
- [ ] Sound level meter app (calibrated)
- [ ] Text overlays/labels — meta/markers/regions shipped; authoring UX open
- [ ] Collection of sound-producing recipes (whispering-voice-in-bg class hacks)
- [ ] v3 naming (breaking — collect, don't drip): `clip()` vs `stat('clipping')` — rename method to `excerpt()`/`view()`; README disambiguates for now

---

# Archive

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
**FFmpeg EQ**: tiltshelf (tilt), superequalizer (geq) ✔; firequalizer/crossover — direct-import/designer (see Open)
**FFmpeg analysis**: aspectralstats (centroid/flatness core + rolloff/spread/flux/slope/contrast/ltas stats), drmeter (dr), replaygain ✔
**FFmpeg misc**: amultiply (ringmod), afreqshift (freqshift), aloop (repeat), adelay (spatial-delay, direct-import), afftfilt (spectral-edit kernel, direct-import), silenceremove ends (trim) ✔/[~]
**Audacity**: noise gate (gate), Generators — tone (osc), noise-gen, chirp, pluck, risset-drum, rhythm-track ✔ (dtmf direct-import); truncate-silence + spectral-selection ops → Open
**Tone.js**: oscillator, envelope (adsr), drum-synth (kick/cymbal/snare), pluck-synth, synth-voice (voice), poly ✔; lfo = engine automation + tremolo/vibrato/autopan; midside ✔
**MIREX**: bpm, beats, onsets, notes, chords, key, cepstrum, spectrum (core) + structure, transcribe, downbeat, coversong, melody, multif0, fingerprint, similarity, drums, tempogram (stat atoms) ✔; ML-tier → Open
**Stats prerequisites (AI gate)**: crest, centroid, flatness, correlation ✔ — MCP unblocked

## Architecture (settled)

- Plugin flavors: **op** (contract factory + params), **stat** (`{stat, compute}`), **codec** (`{codec, test?, decode?, encode?}`) — all register via `audio.use()` / `audio.atoms`; CLI auto-resolves names, `--help` synthesized from param metadata
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
- **Issues closed by v2.0–2.3**: #22 #42 #43 #44 #45 #48 #50 #52 #55 #56 #62 #64 #66 #67 (+#69 n/a). Open after triage: #27, #53, #57, #58, #63, #68.
