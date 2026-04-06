## Next

* [ ] BPM detection — autocorrelation on energy envelope, `audio.stat('bpm')` + `a.bpm()` query
* [ ] Pitch detection — spectral centroid or YIN, `audio.stat('pitch')` + `a.pitch()` query
* [ ] Show BPM/pitch in CLI info line (when detected)
* [ ] recording
* [ ] playback speed

## Engine

* [ ] Options-only ranges — drop positional offset/duration, all ops: `op(value..., {at, duration, channel}?)`
  - `a.gain(-3, {at: '1m12s', duration: 5, channel: 0})`
  - `a.reverse({channel: 1})`
  - Use `parse-duration` for string → ms conversion (already a dep collaborator)
  - Numbers pass through as seconds
  - Removes arg-sniffing from engine; plan reads `opts.at`, `opts.duration`, `opts.channel`
* [ ] `audio.from(fn, opts)` — function source: `audio.from(i => Math.sin(440 * TAU * i / sr), {duration: 1})`
* [ ] `audio.from(data, {format})` — PCM conversion: `audio.from(int16arr, {format: 'int16'})`
* [ ] Automation — any op param can be a function of time: `a.gain(t => -3 * t)`, `a.filter(t => ({ freq: 200 + t * 1000 }))`
* [ ] In-place pipeline mutation for memory efficiency
* [ ] Index delta-tracking through edits (avoid stale rebuild for gain→trim chains)
* [ ] Structural custom ops — variable-length output from custom ops
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
* [ ] `record` — microphone input


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
