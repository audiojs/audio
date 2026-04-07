## Next

* [ ] Wavearea integration
* [ ] BPM detection — autocorrelation on energy envelope, `audio.stat('bpm')` + `a.bpm()` query
* [ ] Pitch detection — spectral centroid or YIN, `audio.stat('pitch')` + `a.pitch()` query
* [ ] Show BPM/pitch in CLI info line (when detected)
* [ ] playback speed
* [ ] Common processing scripts (vocal warmup etc)

### Tier 2: Competitive

| Package | Type | Notes |
|---------|------|-------|
| `audio-stretch` | Structural op | Pitch/time stretch, independent, preserves formants |
| `audio-gate` | Sample op | Noise gate, threshold-based |
| `audio-compress` | Sample op | Dynamic range compression (threshold/ratio/attack/release) |
| `audio-reverb` | Sample op | Convolution or algorithmic reverb |
| `audio-delay` | Sample op | Convolution or algorithmic delay |
| `audio-declick` | Sample op | Click/pop removal |
| `audio-denoise` | Sample op | Noise reduction (spectral subtraction or adaptive) |

### Tier 3: Delighting

| Package | Type | Notes |
|---------|------|-------|
| `audio-spectral-edit` | Structural op | Frequency-domain selection and edit |
| `audio-stem-separate` | Structural op | Vocal/instrumental separation (ML) |
| `audio-pitch-correct` | Sample op | Auto-tune |
| `audio-transient-shaper` | Sample op | Transient enhancement/suppression |

* [ ] reduce-silences
* [ ] pitch
* [ ] stretch
* [ ] sidechain? (amp mod)

## Done (v2.0–v2.3)

<details><summary>Completed work</summary>

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

</details>
