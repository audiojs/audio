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

0. [ ] **Node playback starts ~2 s late on PulseAudio** (CI's null sink): @audio/speaker's miniaudio device takes the first ~0.1 s of writes, then nothing for ~2.2 s, then real time; Chromium's stream on the same sink starts in 90 ms. Found by test/polyfill.js (`_moves`: 421 ms to move, the page 91). Suspend-on-idle is not it. Look at miniaudio's PulseAudio buffer attributes (low-latency profile: tlength, prebuf) or the ALSA backend.

1. [x] **MCP server + skills** — gate long met, ~40+ registry ops + full stat surface ready ([.work/mcp.md](mcp.md)): `bin/mcp.js` (load/info/analyze/edit/save/undo/read/play, stateful sessions, `@modelcontextprotocol/sdk` over stdio) + `audio-master`/`audio-clean`/`audio-analyze` skills. Watch: counterpoint-studio/audio-file-mcp-app (competitor).
2. [x] **Playground** — the editor renamed: the library's live face, every edit a line of `audio` code (playground.html; #53, #58)
3. [ ] **jz/WASM lane** — for streaming/realtime/worklet where batch JIT can't help: compile hot kernels (fourier-transform, biquad, pvoc) via `@audio/compile` → per-atom `dist/*.wasm` + `./wasm` export, host prefers in `useAtom`. Blocked on jz typed-array provenance fix (bench/fftplan + bench/provenance repro cases landed in jz; ~6× gap). ~1.4× over warm JS once fixed — realtime-lane priority, not batch.
4. [ ] Small: Wavearea: adopt facade.play() P3 or keep own player · `audio/polyfill`: HTMLAudioElement in any runtime (#68) · common processing scripts (vocal warmup etc)

* [ ] Integrations for VSCode, sublime, atom and other tools: edit audio
* [ ] playground: theme selector, don't force users.
* [ ] Automastering - must have.
* [ ] drop a file - receive agent recommendation on improvements: essentially agent should do all job
* [ ] Presets: one-tap looks for a sound (idea)
* [ ] Diarization - detecting spekers, autoadding cues
* [ ] Detect current type of speaker etc

* [x] tracks, to meet classical SAAS layout (.work/editor.md Tracks)
  * [ ] mute and solo; record into a new track; a piece dragged between tracks; a track's start dragged (its pad)

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
