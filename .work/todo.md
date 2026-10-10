# audio — todo

Registry: **141 names** (ops + stats; codec halves ship in every decode-*/encode-*). Flavors complete: op ✔ stat ✔ codec ✔.
Parity evidence: [.work/baseline.md](baseline.md). Perf: [docs/comparison.md § Performance](../docs/comparison.md).

**Frozen 2026-10-06.** No new surface until a user asks for it: fixes, measurements and what real users hit go first. The proven users are developers (Node playback with a real transport, games, CLI players); podcast and audiobook production can be a product of its own on this engine. Signal: npm downloads on days without a release, and dependents found by their lockfiles, not the monthly total (64% of September's fell on its 4 release days).

## Adoption

Be the answer a person finds by search and an agent picks as a dependency. Proof, not pitch: every page plays a real before/after, runs on your own file, shows the code. Canonical home audiojs.dev. Signal: agent pick rate, dependents by lockfile, downloads on days without a release, Search Console clicks per page.

Page rule: one page, one search query, one problem. Hear it (A/B) → try your file (in-browser, no upload) → copy the code (Node, browser, CLI) → numbers and limits.

### 0. Baseline (week 1)
- [ ] Agent test: 20 audio tasks × Claude Code, Cursor, ChatGPT, Copilot; log which library each picks and whether its code runs (bench/agents/)
- [ ] Same 20 with "use `audio`": separates discovery from usability
- [ ] Search Console + Bing Webmaster on audiojs.dev, sitemap.xml; record ranks for every target query below

### 1. Flagship: RX 12 measured (weeks 1–3)
- [ ] `/rx`: listen yourself, A / ours / RX per module, from bench/rx renders; numbers from docs/rx.md, "RX leads where" kept
- [ ] Publish rx-reel: YouTube, X, Bluesky, Mastodon, LinkedIn → `/rx`
- [ ] Show HN: how we measured RX 12 against free code, losses included

### 2. Creator queries (one page each, a week)
- [ ] remove background noise · remove hum · fix clipped audio · remove clicks / mouth clicks
- [ ] remove echo (de-reverb) · remove breaths · de-ess · remove plosives
- [ ] ACX check online · podcast loudness check (-16 LUFS) · free iZotope RX alternative → `/rx`

### 3. Developer queries (one recipe page each, tested in CI)
- [ ] trim / convert / normalize audio in JavaScript · play audio in Node
- [ ] encode MP3 in the browser without ffmpeg.wasm · waveform · detect BPM and key · split on silence
- [ ] open a 10 GB file in the browser (measure first, then claim)
- [ ] "When to use something else": ffmpeg.wasm, Tone.js, Howler, OfflineAudioContext, sox/pydub
- [ ] `audio-decode` README (3.2M/mo): one line, "editing after decoding → `audio`"

### 4. Agents
- [ ] llms.txt + llms-full.txt (API + recipes) on the site and in the npm package
- [ ] README first screen: what, when to use, when not, one example per runtime
- [ ] MCP in the official registry, Smithery, Glama; skills in skill directories; Context7 listing
- [ ] Every call agents hallucinated in the baseline fails with an error naming the right call

### 5. Try and adopt
- [ ] Playground opens on a broken take: one click fixes, A/B, export
- [ ] Every code block on the site → "open in playground"
- [ ] `npx audio` one-liner on every repair page
- [ ] Stranger test: 3 developers, 10 minutes, no help; fix where they stall

### 6. Advocacy
- [ ] Ask the 7 lockfile users why they picked it and what hurt; fix that first
- [ ] "Built with audio" from dependents, with their permission
- [ ] Answer open Stack Overflow / Reddit / GitHub questions a page already solves; link the page
- [ ] Each issue answered with a recipe becomes a page

### Videos (15–30 s, one a week, real renders only)
- [ ] One per repair: the defect in red on the spectrogram → one function → gone
- [ ] Terminal: `npx audio take.wav denoise normalize save out.mp3`
- [ ] Agent: "make this ACX-ready" → `check acx` fails → fixes → passes
- [ ] 10 GB file, flat memory graph (once measured)

### Week 12
- [ ] Keep the channels that brought dependents and agent picks; drop the rest; rerun the agent test

## Next

1. [x] **MCP server + skills** — gate long met, ~40+ registry ops + full stat surface ready ([.work/mcp.md](mcp.md)): `bin/mcp.js` (load/info/analyze/edit/save/undo/read/play, stateful sessions, `@modelcontextprotocol/sdk` over stdio) + `audio-master`/`audio-clean`/`audio-analyze` skills. Watch: counterpoint-studio/audio-file-mcp-app (competitor).
2. [x] **Playground** — the editor renamed: the library's live face, every edit a line of `audio` code (playground.html; #53, #58)
3. [ ] **jz/WASM lane** — for streaming/realtime/worklet where batch JIT can't help: compile hot kernels (fourier-transform, biquad, pvoc) via `@audio/compile` → per-atom `dist/*.wasm` + `./wasm` export, host prefers in `useAtom`. Blocked on jz typed-array provenance fix (bench/fftplan + bench/provenance repro cases landed in jz; ~6× gap). ~1.4× over warm JS once fixed — realtime-lane priority, not batch.
* [ ] Integrations for VSCode, sublime, atom and other tools: edit audio
* [ ] playground: theme selector, don't force users.
* [ ] Automastering - must have.
* [ ] drop a file - receive agent recommendation on improvements: essentially agent should do all job
* [ ] Presets: one-tap looks for a sound (idea)
* [ ] Diarization - detecting spekers, autoadding cues
* [ ] Detect current type of speaker etc

* [x] tracks, to meet classical SAAS layout (.work/editor.md Tracks)
  * [ ] mute and solo; record into a new track; a piece dragged between tracks; a track's start dragged (its pad)

## Enhance and remix: the cheap plan (this laptop)

Goal: split a recording into voice and the rest, make each better, regenerate a part elsewhere if wanted (Suno), merge back. Speech: Adobe Podcast Enhance quality, offline first.

Laptop: M4 Max, 14 cores, 36 GB, 84 GB disk free (~/.cache/audiojs holds 88 GB of bench data: clear before any training). No PyTorch installed.

Have, measured (docs/rx.md): steady noise `denoise({ noise })` / `omlsa()` · DeepFilterNet3 `deepfilter()` (8 MB, ahead of RX Dialogue Isolate on VoiceBank) · `dereverb()` (WPE, ahead of RX De-reverb) · `rebalance()` SCNet stems (ahead of RX Music Rebalance) · `auto()` repair chain (DFN3 inside) · `match()` / `master(ref)` · `ducker({ key })` · `sbr()` · `exciter()` · tracks in the playground, each its own chain, summed on export.
Have, not measured: `defeedback()` (analyzer, tracker, notch bank).
Checked 2026-10-09 in Node: a 6.8 s MUSDB clip split into voice (`rebalance(0, -∞, -∞, -∞)`) and rest (`rebalance(-∞)`) in 8.4 s on CPU, voice through `deepfilter().dereverb()` in 2.0 s, mixed back. Voice + rest misses the mix by −32.4 dB: SCNet's residual counted twice.
Missing: true harmonic resynthesis (`sbr` is a waveshaper exciter, not the voice's own harmonics) · generative restoration (DFN3 masks; it can't rebuild lost bandwidth, mic colour, codec damage, heavy rooms) · the split → regenerate → merge glue.

### 1. Split, merge (glue: days)
- [x] Voice and rest that add back to the input: `vocals({ model })` and `vocals('remove', { model })`, SCNet-large hosted (−155 dB from the mix on a MUSDB clip); no new op (`split()` is the time split)
- [x] Playground: Edit › Split the voice to a new track (right-click at the caret, ⌘P too): `voice` under it, the rest left, each its own chain
- [ ] Playground: four stems to four tracks
- [x] `align(ref)`: GCC-PHAT to the sample where the waveforms are shared, else onset envelopes (a part remade); CLI `align REF`; 3.6 s for a 4-minute song
- [ ] `align()`: tempo drift (a part remade at another tempo): lags at its start and end, `stretch()` between
- [x] Suno hand-off by file: File › Export the track alone; File › Open as a new track; Edit › Line up with (`align`), Match with (`match` + `normalize` to the original part)
- [ ] Automix voice over a bed (podcast with music): the bed ducked under the voice (`ducker({ key })`), a master stage over the tracks' sum
- [x] `memo()` shared while it is made and until the store holds it: two tracks, one model run (in the page: the split 101 s, one track alone 84 s; in Node, both at once with no store: one run); Node: `audio.memo = new Map()`

### 2. Harmonic resynthesis, DSP (a week)
- [ ] Voice bandwidth rebuilt from its own harmonics: f0 (`pitch-pyin`), partials (`sinusoidal-track`), envelope (`lpc`) extrapolated past the cutoff; harmonics k·f0 synthesized above it, the unvoiced part as noise under the envelope; the low end (telephone 300 Hz) the same way down
- [ ] Measure against `sbr()` and the input: VoiceBank cut to 8 and 16 kHz, log-spectral distance, PESQ WB, DNSMOS; RX Spectral Recovery not hostable
- [ ] Then the same for pitched solo instruments in a stem (voice, flute, violin); polyphony stays out

### 3. Generative speech restoration: the Adobe Enhance class (1–2 weeks)
- [ ] `restore()` on Sidon v0.1 (MIT; w2v-BERT 2.0's first 8 layers + LoRA, DAC decoder; 470 MB f16): export to ONNX on this laptop, int8, onnxruntime-node with CoreML, chunked as deepfilter
- [ ] Measure against `deepfilter()` and `auto()`: VoiceBank+DEMAND, vbreverb, phone and laptop-mic takes; DNSMOS, UTMOS, WER (neural-asr), speaker similarity; listen blind
- [ ] Strength knob: mix back into the input as deepfilter's mixback
- [ ] `auto('speech')` gains it as the last repair stage when the package is installed

### 4. A browser-size restorer (weeks, only if 3 proves the gap)
- [ ] Student 2–20M params (10–30 MB int8): a net predicting band gains, deep-filter taps and harmonic amplitudes, the DSP from 2 rendering them
- [ ] Trained on Sidon's outputs over our own speech data (distillation, MIT allows), PyTorch MPS on this laptop
- [ ] Runs in onnxruntime-web, WebGPU, real time

### 5. Browser, measure what exists
- [ ] **Fast, best-quality split on the GPU** (measured 2026-10-09 in Node, onnxruntime-node 1.30, machine under load: absolute times pessimistic, ratios hold)
  - Why it is slow: SCNet's time is its LSTMs, a recurrence the GPU can't spread over time: CPU 5.7 of 11.5 s per 11 s segment, WebGPU 19.4 of 26 s (all else on WebGPU ~1 s). In the page, single-thread wasm: 114 s for a 6.8 s clip
  - The GPU way: a band-split transformer, no recurrence, and the quality leader (BS-RoFormer won SDX23; Mel-RoFormer paper: vocals 12.08 dB vs BS 11.49 on MUSDB18HQ; viperx's BS-RoFormer ep317, 160M, claims 12.9 vocals; ours SCNet-large 11.00 on the 50 MUSDB18 previews, BSSEval v4)
  - BS-RoFormer ep317 (xycld/BS-RoFormer-ONNX) on WebGPU: 8.3 s per 8 s chunk vs CPU 40 s. Kernels 4.8 s, of it matmuls 0.9 s; the rest unfused element-wise ops (RMSNorm, GELU, rotary written out as Mul/Div/Tanh/Sigmoid/Expand/Slice) and dispatch over ~3000 nodes. Its 62-way Split broke Dawn's 10 storage buffers per shader: replaced by Slices
  - [x] Mel-Band RoFormer (Kim's vocals model, MIT) exported for the GPU: neural `scripts/export-roformer.py`, preset `mel-roformer` (runs on WebGPU where there is one, Node too: neural-runtime's `webgpu` is onnxruntime-node's provider there). 826 operators; batched band products, folded norms, rotary as tables. Verified 1e-5–2e-4 from the PyTorch forward; the JS pipeline 89–92 dB from the reference
  - [x] Measured: MUSDB18 previews vocals **12.08 dB** (SCNet-large 11.00, RX 12 Best 10.89), vocals −6 dB remix 23.38 (22.11, 22.26); RTF **0.44** on Node's WebGPU (SCNet-large 0.96 CPU); 2.4 s a segment on WebGPU, 9 s on CPU
  - [x] Found and fixed: onnxruntime 1.30's WebGPU Softmax over a tensor past 128 MiB (WebGPU's default storage binding) is wrong one run in two: the graph slices each transformer to keep every tensor under 100 MB
  - [x] Hosted: `audiojs/mel-roformer`, `mel-roformer.fp16.onnx` (464 MB, MUSDB vocals 12.08 as the float32 export) pinned in neural-separate's REVISIONS; the playground's split takes it where the browser has a GPU (SCNet-large on SwiftShader or none). In Chromium on Metal: a 6.8 s song split in the page in ~5 s once the model is in (first time: the 464 MB download, ~35 s here)
  - [x] Found and fixed: a Cache API that refuses the model (a private window's quota) failed the load (neural-runtime now loads it uncached); the editor bundled only ONNX Runtime's wasm build (now its WebGPU build too, fetched only when a GPU model runs)
  - [ ] Faster: onnxruntime's WebGPU kernels are the limit (fp32 matmul 1.8 TFLOPS, fp16 4.2, attention 0.5–0.75 of the M4 Max's ~16): own WebGPU kernels for this one architecture, est. 0.5–1 s a segment
    - [x] Chromium on Metal offers `chromium-experimental-subgroup-matrix` (Apple's simdgroup matrices, 8×8, f32 and f16), shader-f16, 4 GB bindings
    - [x] Prototype matmul on subgroup matrices: 2.2–2.5 TFLOPS against onnxruntime's 1.4–1.5 in the same (loaded) minutes
    - [x] Prototype flash attention on subgroup matrices (online softmax through workgroup memory): 134.6 dB from a JS reference; the time attention (480 × 801 × 64) 46 ms against onnxruntime's ~166 ms a layer
    - [x] The engine, neural `roformer.js`: `export-roformer.py --engine` tensors (hosted beside the ONNX file at `audiojs/mel-roformer` c1aba02), 163 dispatches a segment; 101.5 dB from onnxruntime's CPU on the same weights (`scripts/engine.mjs`); the page takes it where the GPU has subgroup matrices (Chromium on Metal), else onnxruntime
    - [x] Measured under the same load (other sessions' jobs, load average 60–120): 1.5–1.8 s a segment against onnxruntime-web WebGPU's 2.6–3.3; GPU time: time attention ~30 %, matrix products ~55 % (~3 TFLOPS each)
    - [ ] Next, on a quiet machine: matrix products with workgroup-staged tiles and float16 inputs (simdgroup f16 → f16 results: accumulate in f32 per K-chunk), attention with K/V staged (tried: not faster under load), one GPU device kept across calls (now made per separate())
  - [ ] Four stems on the GPU: a BS-RoFormer or Mel-RoFormer 4-stem checkpoint with clear weights, the same exporter
  - [ ] Desktop lane: CoreML/MLX in Node (ORT's CoreML EP put SCNet in 33 partitions and its ANE compile ran 25 min: not this way)
- [ ] DFN3 and SCNet in onnxruntime-web, wasm and WebGPU: time per minute of audio on this laptop
- [ ] Defeedback: a bench on recorded feedback (none yet)

## AI tier

* [ ] Use ai editoring: select a part, tell AI what to generate here instead (in-context agent)
* [ ] AI generation: select various external gens beyond just studio
* [ ] AI remastering: for a selection, remaster variants.
* [ ] Podcast: make podcast-ready speech
* [ ] Detect parts of speech, ads etc - remove
* [ ] Agentic musician for live playing
* [ ] detect style of music

## Pro tier

* [ ] WASM processing
* [ ] Professional integrations
* [ ] Desktop: VST plugins gateway
* [ ] Processing recipes: dolby etc, collections
* [ ] Create your own VSTs
* [ ]


## Scenarios

* [ ] Record yourself at home, master-prepare the recording quickly, autotune notes, reduce noise, trim silences
* [ ] Record on the studio: multiple takes in multiple tracks, selecting the best one, solo/mute/edits - from various system inputs, prepare, save the sketch
* [ ] Edit audio for video files: drop video directly with a little preview - trim silences, shorten long parts, normalize/process

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
- [ ] Text overlays/labels inside of audio (like wav encodes) — meta/markers/regions shipped; authoring UX open
- [ ] Collection of sound-producing recipes (whispering-voice-in-bg class hacks)
- [ ] v3 naming (breaking — collect, don't drip): `clip()` vs `stat('clipping')` — rename method to `excerpt()`/`view()`; README disambiguates for now
