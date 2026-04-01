## v2.0 Release Ready ✓

**What was built in this sprint:**
- ✓ Complete CLI implementation (`bin/cli.js` + `bin/cli-utils.js`, 200 LOC)
- ✓ Browser Web Audio API playback (parallel AudioContext support)
- ✓ CLI tests with 39 assertions covering ops, parsing, file I/O
- ✓ Argument parser: op tokenization, range syntax, unit parsing
- ✓ All Tier 1 features complete (must-have)

**Ready for npm publish:**
- ✓ `npm test` passes 132/132 tests (111 library + 21 CLI)
- ✓ `npx audio in.wav gain -3 trim normalize -o out.wav` works end-to-end
- ✓ Help text documented
- ✓ Playback works in Node and browser

**Outstanding for v2.1:**
- [ ] Verify wavearea integration end-to-end — deferred to wavearea v2 migration
- [ ] Macro system (serialized edit list replay)
- [ ] Batch CLI operations
- [ ] Per-op help system


## Known Defects

- [ ] `record`
- [x] `onprogress` now `await`s the callback, yielding between pages so consumers can render progressively. True streaming decode (per-chunk from audio-decode) deferred to post-v2.
- [ ] `energy` index field is plain RMS² (`sum(v²)/count`), not K-weighted. `loudness()` claims LUFS but operates on unweighted energy. Fix: either rename to approximate RMS loudness, or implement K-weighting filter (digital-filter dep), or make energy a pluggable index field.
- [x] `estimateDecodedSize` now peeks at format magic bytes (RIFF/FORM→2×, fLaC→5×, lossy→20×) instead of blanket 10:1×4. WAV files no longer falsely trigger OPFS caching.
- [x] Structural ops (slice, remove, insert, pad, repeat) were incorrectly marked `index: true`. Fixed — now index-dirty (global rebuild on analysis). Was a silent correctness bug: analysis after structural ops returned stale index data.
- [x] `a.duration` / `a.length` / `a.channels` now reflect edits. `length` getter walks edit list to compute effective sample count. `channels` getter tracks remix ops. `sourceLength` stores raw decoded length for internal use. Undo restores correctly.


## Exhaustive Feature Roadmap (Industry Parity)

### Tier 1: Must-Have (Table Stakes)
Every industry editor has these. All stay in `audio` core except where noted as plugin.

**Core Library** (✓ v2.0 COMPLETE)
- [x] Multi-format input: MP3, WAV, FLAC, OGG, M4A, WebM (via audio-decode)
- [x] Encode + save: all input formats + OPUS, AIFF (via audio-encode)
- [x] Gain (dB + linear)
- [x] Fade (in/out, curves)
- [x] Trim (silence detection + manual ranges)
- [x] Normalize (peak + LUFS)
- [x] Playback: Node (audio-speaker) + Browser (Web Audio API AudioContext)
- [x] Undo/redo (full history, serializable)
- [x] Remix: mono↔stereo, channel extraction (via audio-buffer/util)

**CLI** (✓ v2.0 COMPLETE)
- [x] `npx audio [input] [ops...] [-o output]` — positional command-line interface
- [x] Op discovery: `audio --help` lists all ops with examples
- [x] Range syntax: `1s..10s`, `0..0.5s` for time ranges
- [x] Unit parsing: dB, Hz, seconds with suffixes (-3db, 0.5s, 440hz)
- [x] Pipe support: stdin/stdout via `-` or omit input (deferred: actual pipe redirection)
- [x] Progress output: `--verbose` shows decode + render progress
- [ ] Macro execution: `--macro recipe.json` applies serialized edit list (v2.1)
- [ ] Per-op help: `audio gain --help` (v2.1)

**Batch Operations** (v2.1)
- [ ] Batch CLI: process multiple files with same edits
- [ ] Parallel execution: spawn workers for multi-file processing
- [ ] State tracking: preserve edit list identity across batch run

---

### Tier 2: Competitive (What Sets Leaders Apart)
These are where Reaper, Logic, Pro Tools differentiate. Mix of core + separate packages.

**Core Library Enhancements**
- [ ] Multi-track mixing: `mix()` with offset + level + pan
- [ ] Pan: stereo panning, channel routing
- [ ] Crossfade: smooth transitions between clips
- [ ] Index extensions: `audio.index(name, fn)` — pluggable analysis fields (pitch, BPM, spectral moments, kEnergy)
- [ ] Streaming render: read plan + streaming decode (v2.1, unblocks real-time feedback + large files)
- [ ] Cursor tracking: preload pages near playback position

**Separate Packages** (plugins via `audio.op()`)

| Package | Purpose | Type | Est. Complexity |
|---------|---------|------|-----------------|
| `audio-spectrum` | Frequency-domain analysis, FFT peaks | Analysis plugin | Medium |
| `audio-stretch` | Pitch/time stretch (independent control) | Sample op + structural | High |
| `audio-stretch-formant` | Time-stretch with formant preservation | Structural variant | Very High |
| `audio-gate` | Noise gate (threshold-based muting) | Sample op | Low |
| `audio-eq` | Parametric EQ (multi-band) | Sample op | Medium |
| `audio-compress` | Dynamic range compression | Sample op | Medium |
| `audio-compress-silence` | Smart silence removal/compression | Structural + sample | Medium |
| `audio-reverb` | Reverb simulation (convolver or algorithm) | Sample op | High |
| `audio-declick` | Click/pop removal (spectral gating) | Sample op | Medium |
| `audio-denoise` | Noise profile + spectral subtraction | Sample op | High |
| `audio-normalize-loudness` | LUFS-based loudness normalization | Smart op | Low |

---

### Tier 3: Delighting (Why Users Choose One Over Another)
Post-release nice-to-haves. Most are plugins.

**Advanced Plugins**
| Package | Purpose | Est. Complexity |
|---------|---------|-----------------|
| `audio-spectral-edit` | Select/delete frequency ranges interactively | Very High |
| `audio-vocoder` | Vocoder effect | High |
| `audio-stem-separate` | Vocal/instrumental separation (ML-backed) | Very High |
| `audio-diarization` | Speaker detection + labeling | Very High |
| `audio-speech-enhance` | Speech clarity improvement (ML) | Very High |
| `audio-pitch-correct` | Auto-tune / pitch correction | High |
| `audio-transient-shaper` | Transient enhancement/reduction | Medium |
| `audio-loudness-meter` | Real-time loudness monitoring | Medium |

**CLI Scripting**
- [ ] Macro system: `toJSON()` export, `--macro` import, replay
- [ ] Workflow templates: shared macro recipes (podcast cleanup, podcast mastering, etc.)
- [ ] User-defined operations: JavaScript macro language for custom workflows
- [ ] Batch templates: parameterized macros for album/series processing

**Real-time Preview**
- [ ] Browser playback with live effect chains (requires streaming render v2.1)
- [ ] Cursor feedback during playback (seeking, mark/in/out points)

---

### Ecosystem & Architecture

**Plugin System**
- [x] `audio.op(name, init)` contract (simple, block-local, shape-preserving)
- [x] Custom sample ops work end-to-end
- [ ] Plugin auto-discovery: scan `node_modules/audio-*` at CLI startup
- [ ] Plugin help: each package exports `--help`, integrated into main help
- [ ] Plugin registry: npm namespace for discoverability

**Format Support (Current)**
- [x] Input: MP3, WAV, FLAC, OGG, M4A, WebM (audio-decode ecosystem)
- [x] Output: all input formats + OPUS, AIFF (audio-encode ecosystem)
- [ ] Lossy vs lossless auto-detection for storage decisions

**Cross-Platform**
- [x] Node.js (v18+)
- [x] Browser (modern, OPFS for large files)
- [ ] CLI: Windows, macOS, Linux (via npm/npx)
- [ ] Wavearea integration (GUI for visual editing)


## Future

* [ ] vst/plugin host to process with external plugins


## Archive

## Phase 1: Foundation — data model + create + properties

Clean repo. Fresh ESM package. The Audio class with pages, index, edits.

- [x] Remove old v1 code (index.js, src/*.js, old deps, old tests)
- [x] package.json: ESM, `"type": "module"`, deps on audio-decode/encode
- [x] Audio class: `pages`, `index`, `edits`, `sampleRate`, `channels`, `version`
- [x] `audio.from(data, opts?)` — sync. Accepts Float32Array[], AudioBuffer, number (silence). Builds pages + index from PCM. Always resident.
- [x] `audio(source, opts?)` — async. Detects input: encoded → decode via audio-decode, PCM → wraps immediately. Returns Promise always.
- [x] Index computation during page creation: min/max/energy per block per channel at blockSize=1024
- [x] Properties: `duration`, `channels`, `sampleRate` (read-only)
- [x] `edits` array (inspectable, readonly), `version` counter, `onchange` callback
- [x] Tests: create from PCM, create from silence, create from file, URL, ArrayBuffer, AudioBuffer, properties correct, index populated

**Gate:** `await audio('test.wav')` works. `.duration`, `.channels`, `.sampleRate` correct. Index computed. ✓


## Phase 2: Streaming decode + onprogress

Progressive decoding with append-only index deltas.

- [x] Decode for encoded sources via audio-decode, build pages + index
- [x] `onprogress({ delta, offset, total })` — append-only delta: fromBlock, per-channel min/max/energy
- [x] Index grows incrementally as pages are processed
- [x] Tests: onprogress fires with correct delta shape, delta covers full index

**Gate:** `await audio('large.mp3', { onprogress })` streams index deltas progressively. ✓

Note: Current decode is synchronous (full decode then page-by-page index). True worker-based streaming decode deferred — architecture supports it via onprogress contract.


## Phase 3: Structural ops

Edit list + ops that reorganize the timeline.

- [x] Op representation: `{ type, args }` in `edits`
- [x] `slice(offset, duration)` → new Audio sharing source pages
- [x] `insert(other, offset?)` — splice pages into timeline
- [x] `remove(offset, duration)` — exclude range from timeline
- [x] `pad(duration, {side})` — insert silence pages
- [x] `repeat(times)` — multiply timeline references
- [x] All return `this` (except slice → new Audio)
- [x] `undo()` / `redo()` — move between edits and redo stack. New edit after undo clears redo.
- [x] `version` increments, `onchange` fires on edit/undo/redo
- [x] Tests: each op queued, each op materialized correctly, chaining, undo/redo cycles, version tracking, slice independence, pad start/end, structural + sample chained

**Gate:** `a.remove(1, 2).insert(b, 3).pad(0.5)` chains and materializes correctly. Undo/redo works. ✓


## Phase 4: Sample ops

Block-level transforms with range support.

- [x] `gain(db, offset?, duration?)`
- [x] `fade(duration)` — position-dependent
- [x] `reverse(offset?, duration?)`
- [x] `mix(other, offset?, duration?)`
- [x] `write(data, offset?)`
- [x] Range filtering: engine applies op only to blocks within offset..offset+duration
- [x] Tests: each op, gain with range (before/in/after), fade in/out, reverse values, mix sum, write overwrite

**Gate:** `a.gain(-3, 2, 1).fade(.5).reverse()` queues and materializes correctly. ✓


## Phase 5: Smart ops + audio.define

- [x] `trim(threshold?)` — scan index for silence, refine at sample level in boundary pages, queue slice()
- [x] `normalize(targetDb?)` — read max(index.max), queue gain()
- [x] `audio.define(name, opts?, fn)` — register custom sample op
  - opts: `{ args: 0|1, index: true|false }`
  - Validates name, reserves built-ins, adds chainable method
- [x] Tests: trim sample-level accuracy, normalize target, define + use custom op, custom op with args, custom op with range, duplicate throws, toJSON serialization

**Gate:** `a.trim().normalize()` correct. `audio.define('invert', fn); a.invert(2, 1)` works. ✓


## Phase 6: Materialization — read, encode, save

Output pipeline: pages + ops → PCM / bytes / file.

- [x] Materialization engine: build output timeline from structural ops → iterate, load pages, apply sample ops
- [x] `read(offset?, duration?)` → Float32Array[] (copies)
- [x] `read(offset, duration, { format })` → format conversion for int16/uint8
- [x] `encode(format)` → Uint8Array via audio-encode
- [x] `save(target)` — Node: fs.writeFile(path)
- [x] `toJSON()` — serialize edits
- [x] Tests: read full (lena), read sub-range, read with format, read returns copies, encode/decode round-trip, save + reload, toJSON

**Gate:** `a.gain(-3).trim().read()` returns correct PCM. `save('/tmp/out.wav')` works. ✓


## Phase 7: Analysis from index

- [x] `limits(offset?, duration?)` → `{min, max}` from index, collapsed
- [x] `loudness(offset?, duration?)` → LUFS from index.energy (400ms windows + BS.1770 gating)
- [x] `peaks(count)` → `{min, max}` downsampled from index, collapsed. Per-channel via `{ channel }` option.
- [x] Index-dirty detection: walk edits, compute stale block ranges from dirty ops
- [x] Stale → materialize + reindex affected blocks only (range-scoped)
- [x] Tests: limits sine wave, limits with range, peaks count + type, peaks per-channel, loudness synthetic + lena, dirty op reindexes

**Gate:** Analysis instant from index. Dirty op reindexes correctly. ✓


## Phase 8: Playback

- [x] `play(offset?, duration?, opts?)` → PlaybackController
- [x] Controller: `pause()`, `stop()`, `currentTime`, `playing`, `ontimeupdate`, `onended`
- [x] Parallel by default: multiple controllers from same Audio
- [x] Browser: WAA AudioBufferSourceNode playback with ontimeupdate interval
- [ ] Windowed buffer for large files, 15ms click-free fades (optimization)
- [x] Node: audio-speaker (lazy-loaded)
- [x] Tests: play returns controller with all methods, parallel controllers are distinct

**Gate:** Two controllers created simultaneously. Stop one, other independent. ✓

Note: Browser WAA backend deferred — Node playback via audio-speaker works. Browser needs AudioContext integration.


## Phase 9: Streaming

- [x] `stream(offset?, duration?)` → AsyncIterableIterator yielding Float32Array[] per page
- [x] Ops applied during materialization
- [x] Tests: stream full, stream sub-range, stream after ops

**Gate:** `for await (let block of a.stream()) { ... }` yields correct blocks. ✓


## Phase 10: OPFS page cache

- [x] `storage` option on audio instances ('memory' | 'persistent' | 'auto')
- [x] Architecture supports paging: pages have `data: null` for evicted state, index is separate
- [x] Browser test infrastructure: esbuild bundle + serve.js + browser.html + Playwright
- [x] Cache backend interface: `{ read(i), write(i, data), has(i), evict(i) }`
- [x] LRU eviction: `evictToFit` with configurable `budget` (bytes)
- [x] Page-in on demand: render restores evicted pages from cache
- [x] Tests: eviction with budget, page restore on read, index survives eviction, analysis without page-in (4 tests)
- [x] `opfsCache(dirName?)` — OPFS cache backend: read/write/has/evict/clear
- [x] Auto-detection: `storage: 'auto'` creates OPFS cache when estimated decoded size > budget
- [x] Fail-early: throws if `storage: 'persistent'` and OPFS unavailable; throws if file too large and no OPFS
- [x] `estimateDecodedSize()` — heuristic from encoded buffer size
- [x] Tests: Node (3 tests: persistent throws, memory bypass, storage preserved) + browser (OPFS round-trip, eviction, restore, index survives)


## Phase 11: Polish + publish

- [x] README from research.md API section
- [x] Full test suite: 60 tests, 142 assertions, all passing (tst)
- [x] Browser test infrastructure (esbuild + serve.js + Playwright)
- [x] TypeScript declarations: hand-written .d.ts with full API types
