## Next

* [ ] BPM detection — autocorrelation on energy envelope, `audio.stat('bpm')` + `a.bpm()` query
* [ ] Pitch detection — spectral centroid or YIN, `audio.stat('pitch')` + `a.pitch()` query
* [ ] Show BPM/pitch in CLI info line (when detected)
* [ ] playback speed

## Engine redo (v2.3) — streams-first

Every operation works per-page. No full-data paths. Instant playback, editing, and analysis regardless of file size or edit chain depth.

### 1. Per-page render (core change)

* [ ] **Replace `render()` with `renderPage(a, n)`** — render single page through edit pipeline
  - Resolve segment map for page n → read source pages → apply sample transforms → cache
  - `a._.pages[n]` holds rendered page or null, keyed by version
  - Invalidate on edit (bump version, null out cache)
  - Kill flat `render()` and `a._.pcm` cache entirely
* [ ] **`buildPlan()` always succeeds** — never returns null
  - Every op must be structural (`.plan()`), sample-level (per-page), or stat-conditioned (`.resolve()`)
  - Custom `_fn` ops get page-compatible `(chunk, ctx)` contract
  - No fallback to full render — that path doesn't exist
* [ ] **All ops classifiable into four types:**

  | Type | Examples | How it works |
  |------|---------|-------------|
  | Structural | crop, insert, remove, reverse, repeat | Segment map — pointer math, zero-cost |
  | Sample-level | gain, fade, filter, write, mix | Per-page transform with state carried forward |
  | Stat-conditioned | normalize, trim | `.resolve()` reads pre-computed stats → emits structural/sample op |
  | Windowed | FFT, stretch, pitch correct | Sliding window + overlap-add, bounded memory |

* [ ] **`trim` gets `.resolve()`** — scan stats for silence bounds → emit `crop`
  - Start: scan forward until non-silence block (online)
  - End: find last non-silence block from stats (no full scan)
* [ ] **Stats accumulate per-page** — as each page renders, block stats update incrementally
  - `stat()` returns whatever's computed so far, or forces remaining pages
  - No separate stats recomputation pass

### 2. Entry points

* [ ] **`audio()` — universal constructor**, always async, always usable immediately
  - PCM/silence → `audio.from()` (sync fast-path, public)
  - Encoded source → streaming decode, pages arrive progressively
  - Serialized doc → recursive `audio()` + replay edits
  - Array of instances → concat (replaces `audio.concat()`)
  - `await` = stats finalized. Instance usable before that for playback/editing.
* [ ] **`audio.open()` stays** — returns before decode completes (`.loaded` promise, `.decoded = false`)
  - Different return semantics justify separate method vs option
  - Communicates intent: "I want progressive access"
* [ ] **`audio.record(opts?)`** — mic/stream input
  - Same internal mechanism as `audio.open()`: pages arrive progressively
  - `{duration, device}` options
  - Universal source adapter: Node streams, Web ReadableStream, MediaStreamTrack, MediaDecoder all push pages via same internal `push(chunkData, sampleRate)` interface
* [ ] **`audio.version`** — package version string

### 3. API cleanup

* [ ] **Options-only ranges** — drop positional offset/duration for all ops
  - `op(value..., {at, duration, channel}?)`
  - `a.gain(-3, {at: '1m12s', duration: 5, channel: 0})`
  - `{offset}` for sample-level addressing (alternative to `at` in seconds)
  - `parse-duration` for string → ms conversion
  - Numbers pass through as seconds. Removes all arg-sniffing from engine.
* [ ] **Consolidate `.filter(type, ...params)`** — single method, type as first arg
  - `a.filter('highpass', 80)`, `a.filter('eq', 1000, 2, 3)`, `a.filter('lowshelf', 200, -3)`
  - Removes 7 methods from namespace. Future effects follow same pattern.
  - CLI stays the same: `highpass 80hz` → internally dispatches to `.filter('highpass', 80)`
* [ ] **Unified stat query** — single `a.stat(name, opts?)` method
  - `a.stat('rms')` → number, `a.stat('rms', {bins: 200})` → Float32Array[200]
  - `a.stat('min', {bins: 800})` / `a.stat('max', {bins: 800})` for waveform
  - `bins: 0` = raw per-block data (no reduction)
  - Available: `db`, `rms`, `dc`, `clip`, `min`, `max`, `loudness`, `bpm`, `pitch`
  - `db` accepts `{type: 'peak'|'rms'}`. Default: peak dBFS.
  - Kills `query()` — stats recomputation moves inside `stat()` implementation
* [ ] **`a.read/write` — symmetric PCM pair**
  - `a.read({at, duration, channel?})` → Float32Array[] or Float32Array
  - `a.write(data, {at, channel?})` → overwrite samples at position, no length change
  - `channel` option: omit → all channels (Float32Array[]), specify → one (Float32Array)
  - Strip `format` from `read` (→ `encode()`), strip `decode` from `write` (raw PCM only)
* [ ] **`a.encode(format?, {at, duration}?)`** — returns encoded bytes
  - `a.save()` reuses `a.encode()` internally + writes to file/stream
* [ ] **`a.clone()`** — duplicate with independent edit history

### 4. Playback & events

* [ ] **Inline playback into instance** — no separate controller
  - `a.play()`, `a.pause()`, `a.stop()` directly on instance
  - `a.currentTime`, `a.playing` as properties
  - `a.ontimeupdate`, `a.onended` callbacks
  - Multiple playbacks → `a.view()` creates independent instances
* [ ] **Unify event pattern** — `on*` property everywhere
  - Instance: `a.onchange`, `a.ontimeupdate`, `a.onended`
  - Constructor opts: `onprogress` stays
  - If multi-listener needed later: `.on(event, fn)` / `.off(event, fn)`

### 5. Housekeeping

* [ ] Scope `version`/`onchange` out of README Properties (keep in History section only)
* [ ] Update README plugin registration to match real code
* [ ] `audio.from(fn, opts)` — function source: `audio.from(i => Math.sin(440 * TAU * i / sr), {duration: 1})`
* [ ] `audio.from(data, {format})` — PCM conversion: `audio.from(int16arr, {format: 'int16'})`
* [ ] Automation — any op param can be a function of time: `a.gain(t => -3 * t)`
* [ ] Plugin auto-discovery: scan `node_modules/audio-*` at CLI startup
* [ ] Macro system: `--macro recipe.json` applies serialized edit list
* [ ] Batch CLI: process multiple files with same edits
* [ ] Per-op help: `audio gain --help`


## Plugins (separate packages via `audio.op()`)

### Tier 2: Competitive

| Package | Type | Notes |
|---------|------|-------|
| `audio-stretch` | Structural op | Pitch/time stretch, independent, preserves formants |
| `audio-gate` | Sample op | Noise gate, threshold-based |
| `audio-compress` | Sample op | Dynamic range compression (threshold/ratio/attack/release) |
| `audio-reverb` | Sample op | Convolution or algorithmic reverb |
| `audio-declick` | Sample op | Click/pop removal |
| `audio-denoise` | Sample op | Noise reduction (spectral subtraction or adaptive) |

### Tier 3: Delighting

| Package | Type | Notes |
|---------|------|-------|
| `audio-spectral-edit` | Structural op | Frequency-domain selection and edit |
| `audio-stem-separate` | Structural op | Vocal/instrumental separation (ML) |
| `audio-pitch-correct` | Sample op | Auto-tune |
| `audio-transient-shaper` | Sample op | Transient enhancement/suppression |


## Ideas

* [ ] Common processing scripts (vocal warmup etc)
* [ ] Wavearea integration


## Known defects

_(none)_


## Done (v2.0–v2.2)

<details><summary>Completed work</summary>

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

</details>
