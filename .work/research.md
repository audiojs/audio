## Principles

1. **Stream-first** — every operation works per-page. No full-data paths exist. Instant playback, editing, analysis regardless of file size or edit chain depth.
2. **Non-destructive** — edits are a declarative list. Source is immutable. Any state is reconstructable from source + edits.
3. **Physical units** — seconds, dB, Hz, LUFS. Samples are internal. The user never counts frames.
4. **Single path** — one pipeline serves read, play, stream, save, stat. Per-page render with segment map + sample transforms. No separate "fast path" vs "full path."
5. **Zero ceremony** — `await audio('in.mp3').gain(-3).save('out.wav')` must work. Value is immediate, complete, standalone.
6. **Pluggable** — ops, stats, sources, encoders are all registered the same way: `(audio) => { ... }`. Core hardcodes nothing.


## Vision

The universal audio buffer. Like `sharp` for images, but for sound — load anything, transform instantly, output anywhere. Handles 2h+ files in the browser without tab death. Sets the standard for how audio is manipulated in JavaScript: one library, every platform, no ceremony. The package other tools build on.


## Mission

Replace sox/ffmpeg/Web Audio API ceremony for the 90% case: one file, some transforms, one output. Provide a streaming, non-destructive, paged audio document that's equally native to Node CLI scripts and browser DAW UIs. Make audio manipulation in JS as natural as string manipulation.


## Essence

Take any audio input, apply operations, produce output. The irreducible core:
```js
let a = await audio(input)
let pcm = await a.read()
```
Load anything, get PCM. Everything else is acceleration.

The soul: **the index** (always-resident per-block stats) + **segment map** (structural edits as pointer math) + **per-page pipeline** (sample ops applied lazily). 2-hour file waveform renders instantly from 7MB of index data. The edit list is both undo history and serializable macro.


## Key Decisions

### D1: Stream-first architecture

**Decision**: Every operation works per-page. Kill flat `render()`. `buildPlan()` always succeeds.

**Why**: Files are big. Even 10-minute files need instant playback, processing, editing. Wavearea needs rendered pages on demand with a full edit stack applied. Full materialization blocks everything.

**What changes**: `renderPage(a, n)` replaces `render()`. Per-page cache keyed by version. No fallback to full render.

**Rejected alternatives**:
- *Render-then-cache*: Current approach. Blocks on first read, O(n) memory. Doesn't scale.
- *Lazy render with full fallback*: Partial streaming, but `buildPlan()` returning null kills it for any chain with `trim`/`normalize`/custom ops.

**Implication**: Every op must be classifiable:

| Type | Examples | Mechanism |
|------|---------|-----------|
| Structural | crop, insert, remove, reverse, repeat | Segment map — pointer math, zero-cost |
| Sample-level | gain, fade, filter, write, mix | Per-page with state carried forward |
| Stat-conditioned | normalize, trim | `.resolve()` from pre-computed stats → emits simpler op |
| Windowed | FFT, stretch, pitch correct | Sliding window + overlap-add, bounded memory |

Nothing needs full data. Global statistics are computed incrementally during decode.


### D2: Op type taxonomy

**Decision**: Four op types (above). No op can require full materialization.

**Why**: If one op in a chain needs full data, the whole chain blocks. DAW-grade editing requires streaming throughout.

**Stat-conditioned ops**: `normalize` already has `.resolve()` (reads stats → emits `gain`). `trim` needs `.resolve()` added (scan stats for silence bounds → emit `crop`). These ops are zero-cost at plan time because stats are pre-computed.

**Custom ops**: Must accept `(chunk, ctx)` contract. Closure holds state between pages (filter memory, running averages). Shape-preserving by default.

**Rejected**: Allowing a "full-render escape hatch" for custom ops. This would re-introduce the flat render path. If an op truly needs full data, it should run as a pre-pass that produces a new audio instance, not as an inline edit.


### D3: Entry points — audio() / audio.open() / audio.record()

**Decision**: Three entry points. `audio()` is universal constructor.

```
audio(source, opts?)     — universal. Always async. Usable immediately, await = stats ready.
audio.open(source, opts?) — returns before decode completes (.loaded promise, .decoded = false)
audio.from(pcm|buf|num)  — sync fast-path (internal, but public)
audio.record(opts?)      — mic/stream input
```

**Why `audio.open()` earns its existence**: Different return semantics (instance with `.loaded` promise). Communicates intent: "I want progressive access." `{stream: true}` hides important behavioral difference in an option.

**Why not `audio.decode()`**: `audio()` already decodes. A static decode returning raw PCM is what `audio-decode` does directly. No need to wrap.

**Source adapters**: Recording, Node streams, Web ReadableStream, MediaStreamTrack, MediaDecoder all push pages via same internal `push(chunkData, sampleRate)` interface. One adapter, many sources.

**Rejected**:
- *Single `audio()` with options for everything*: Hides stream/record intent. Forces checking `decoded` flag everywhere.
- *`audio.stream()`*: Recording isn't "streaming a file." Different source, different lifecycle.


### D4: read/write symmetry

**Decision**: `a.read()` and `a.write()` are a symmetric PCM pair. Same format, same options, opposite direction.

```js
a.read({at, duration, channel?})  → Float32Array[] or Float32Array
a.write(data, {at, channel?})     → overwrite samples at position
```

**Why**: Both stripped to pure PCM ops. `channel` omitted = all channels (Float32Array[]), specified = one (Float32Array). `insert` stays separate (splice, grows length). `read` is the primitive; `encode()` builds on it.

**What was stripped**: `format` option from `read` (→ `encode()`). `decode` from `write` (raw PCM only).

**Rejected**:
- *get/set*: Clean pair but audio domain expects read/write.
- *write → paste*: "Paste" implies insertion, not overwrite.
- *write → set*: TypedArray semantics, but breaks the natural read/write pair once both are clean.
- *Merging write into insert({overwrite: true})*: Overloads insert with contradictory behavior (splice vs overwrite).


### D5: Unified stat — `a.stat(name, opts?)`

**Decision**: Single method. No sugar methods on prototype.

```js
a.stat('rms')                              → number (single value)
a.stat('rms', {bins: 200})                 → Float32Array[200]
a.stat('rms', {bins: 200, at: 10, duration: 5, channel: 0})
a.stat('min', {bins: 800}) / a.stat('max', {bins: 800})  → waveform
```

**Why**: `bins` controls resolution. No peak/peaks confusion. Plugin stats and built-in stats use same path. `bins: 0` = raw per-block data.

**Available**: `db`, `rms`, `dc`, `clip`, `min`, `max`, `loudness`, `bpm`, `pitch`

**Kills**: `a.db()`, `a.rms()`, `a.loudness()`, `a.peaks()`, `a.query()`

**Rejected**:
- *Individual methods*: Namespace pollution. Singular/plural confusion (peak vs peaks). Plugin stats would be second-class.
- *Separate scalar/aggregate API*: Artificial distinction. Resolution is a parameter, not a different method.


### D6: Filter consolidation

**Decision**: `.filter(type, ...params, opts?)` — single method.

```js
a.filter('highpass', 80)
a.filter('eq', 1000, 2, 3)
a.filter('lowshelf', 200, -3)
```

**Why**: Removes 7 methods from namespace. Future effects (reverb, compression) follow same pattern. CLI stays the same: `highpass 80hz` → dispatches to `.filter('highpass', 80)`.

**Rejected**: Keeping individual methods. They don't carry enough weight to justify namespace slots. `filter` with type as first arg matches `op(value..., opts?)` pattern.


### D7: Options-only ranges — `{at, duration, channel}`

**Decision**: Drop positional offset/duration args from all ops. Options object only.

```js
a.gain(-3, {at: '1m12s', duration: 5, channel: 0})
```

**Why**: Eliminates arg-sniffing. `parse-duration` for string → ms. Numbers pass through as seconds. `{offset}` for sample-level addressing. Consistent across all ops.

**Rejected**: Keeping positional args for common cases. The sniffing logic is fragile and makes every op implementation check arg types.


## Architecture

### Mental model

```
Source → immutable backing (encoded file or PCM)
Stats  → always-resident per-block measurements (min, max, energy — pluggable)
Pages  → decoded PCM in chunks, paged on demand, rendered lazily through edit pipeline
Edits  → declarative list of ops (structural + sample + stat-conditioned)
```

Any output (read, save, play, stat) = resolve segment map for needed pages + apply transforms + cache.

### Pipeline

```
request page N → segment map (which source page?) → read source → apply sample ops → cache → return
```

Same pipeline for everything: `read()` requests a range of pages, `play()` requests pages ahead of cursor, `stream()` yields pages sequentially, `stat()` reads cached stats or forces page render.

### Stats (always resident)

Per-block measurements computed during decode, retained permanently. Powers waveform display, analysis, and stat-conditioned op resolution. ~7MB for 2h stereo.

### Pages (PCM, paged on demand)

65536 samples per page ≈ 1.49s at 44100Hz. Small files: all resident. Large browser files: OPFS-backed with eviction budget. Node: all resident.

### Ops → edit list

Structural ops reshape the segment map. Sample ops transform values per-page. Stat-conditioned ops resolve from stats at plan time. One list, uniform serialization, undo = pop.

### Hard contracts

- Stats are always resident. Pages are not.
- `buildPlan()` never returns null. Every op is plannable.
- Custom ops accept `(chunk, ctx)` — page-compatible, shape-preserving.
- `a.edits` is inspectable state. Only ops, `undo()`, `apply()` change it.
- Physical units only in public API. Samples are internal.


## Scope

### Bone (is)
- Load any format → PCM (streaming decode)
- Non-destructive editing (structural + sample + stat-conditioned ops)
- Per-page render with segment map (stream-first)
- Index-powered analysis (stats, waveform, loudness)
- Encode + save
- Playback (inline, per-page)
- CLI for sox-style manipulation
- Plugin system for extending ops + stats

### Flesh (is NOT)
- Audio module compiler (→ `audio-module`)
- DAW framework (consumer builds that on top)
- Real-time DSP engine (→ Web Audio API / AudioWorklet)
- Plugin format wrapper (CLAP/VST/WAM → `audio-module`)


## Key Result Areas

### KRA 1: Stream-first engine
**Objective**: Every operation works per-page with no full-data fallback.
- [ ] `renderPage(a, n)` replaces `render()`, per-page cache by version
- [ ] `buildPlan()` always succeeds — all ops plannable
- [ ] `trim.resolve()` added (scan stats → emit `crop`)
- [ ] Stats accumulate incrementally per-page
- **Goal**: Play a 2h file with 10 edits applied, <100ms to first audio page

### KRA 2: Clean API surface
**Objective**: Minimal, symmetric, options-based API with no arg sniffing.
- [ ] Options-only ranges across all ops
- [ ] `read/write` symmetric pair, `encode/save` for output
- [ ] `a.stat(name, opts?)` unified query
- [ ] `.filter(type, ...params)` consolidation
- **Goal**: Zero arg-sniffing code in engine. Every op signature: `op(value..., opts?)`

### KRA 3: Universal source handling
**Objective**: Any audio source (file, URL, PCM, mic, stream) enters through one adapter interface.
- [ ] `audio()`, `audio.open()`, `audio.record()` entry points
- [ ] Universal `push(chunkData, sampleRate)` adapter for all stream sources
- [ ] Constructor accepts array for concat
- **Goal**: Mic recording, file decode, and Web stream all produce identical instance type

### KRA 4: Wavearea readiness
**Objective**: Instant waveform + playback with full edit stack, suitable for DAW-grade UI.
- [ ] Per-page render supports wavearea's random-access page requests
- [ ] Stats power waveform without touching PCM
- [ ] Playback inline on instance, cursor-driven page preload
- **Goal**: Waveform renders from stats alone. Playback starts within one page (1.5s) of any cursor position

### KRA 5: Plugin ecosystem
**Objective**: Third-party ops and stats register the same way as built-ins.
- [ ] Op contract: `(chunk, ctx) → chunk` with closure state
- [ ] Stat contract: `(channels, ctx) → value` with factory pattern
- [ ] Auto-discovery: `node_modules/audio-*`
- **Goal**: External plugin indistinguishable from built-in op in API and performance

---

## Strategic Insights for audio

### What audio CLI Should Be
✓ The **sharp** of audio: "I have audio, I want transformed audio, one line of code"
✓ **Non-destructive** by architecture: edits are first-class, serializable, replayable
✓ **Discoverable**: `audio --help` shows all ops, `audio op-name --help` shows args
✓ **Scriptable**: Both shell + JS, JSON macro export/import
✓ **Batch-native**: Process 1000s with same state tracking as single file

### What audio Should NOT Be
✗ A DAW (leave mixing/arrangement to DAWs built on top)
✗ A VST/AU host (use audio-module bridge for plugin compilation)
✗ A real-time DSP engine (too heavy; use Web Audio API)
✗ Slower than sox/ffmpeg (streaming render v2.1 must be fast)

### Moat (What Competitors Can't Copy)
- **Index-powered operations** without PCM load: 2h file waveform in 7MB, instant analysis
- **Non-destructive by default**: Edits live in memory, survive serialization, replayable like code
- **Unified model**: Same ops in Node + browser + CLI, same edit list format everywhere
- **Plugin contract simplicity**: `audio.op(name, init)` is 10x simpler than VST/AU/CLAP

---

## Roadmap

### v2.0 (Current)
- Tier 1 complete: format, gain, fade, trim, normalize, playback, undo, CLI
- Streaming render with plan-based pipeline
- Smart op resolution (.resolve) — trim/normalize avoid full render
- Ops fully decoupled from core (op/plan.js)
- OPFS paging for large browser files
- CLI: positional ops, range syntax, --play, --stat

### v2.1 (Next)
- Plugin ecosystem: audio.op() discovery from node_modules/audio-*
- In-place pipeline mutation for memory efficiency
- Spectral analysis index field
- CLI: macro import/export, pipe support

### v3 (Future)
- Tier 2 competitive: pitch/time stretch, EQ, compression, gate (via audio-effect plugins)
- Structural custom ops (variable-length output)
- Index delta-tracking through edits (avoid stale index rebuild)

---

## Sources

- [Best Audio Editing Software in 2026 Guide](https://www.appypieautomate.ai/blog/best-audio-editing-software)
- [13 Best Audacity Alternatives 2026](https://tutorialtactic.com/blog/audacity-alternatives/)
- [15 Best Professional Audio Editing Software 2026](https://wplook.com/audio-editing-software/)
- [Reaper vs Pro Tools Comparison](https://www.selecthub.com/audio-editing-software/pro-tools-vs-reaper-audio/)
- [Five Things To Love About REAPER](https://www.production-expert.com/production-expert-1/five-things-to-love-about-reaper/)
- [SoX Audio Processing](https://www.stefaanlippens.net/audio_conversion_execution_speed_comparison_of_SoX_FFmpeg_MPlayer/)
- [DAW Comparisons and Features](https://online.berklee.edu/help/en_US/daw/2077278-comparison-of-daws/)
- [Digital Audio Workstation Overview](https://blog.landr.com/best-daw/)

## Open Questions

- [ ] Page size: benchmark 2^15 vs 2^16 vs 2^17
- [ ] OPFS budget: 500MB default, auto-detect available?
- [ ] Structural custom ops: how to handle variable-length output blocks?
- [ ] Index extensions: eager (compute during decode) vs lazy (compute on first access)?
- [ ] Plugin discovery: npm registry or custom ecosystem?
- [ ] Index delta-tracking through edits: can we avoid stale index for gain→trim chains?
