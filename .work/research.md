## Vision

**audio is an indexed, paged audio document with immutable source and declarative ops.**

`load → transform → save`. Compact, terse, portable. Handles 2h+ files in the browser without tab death.

## Values

- Commands
- Big files
- Plugins
- One-off runs?

## Mental Model

```
Source → immutable backing (encoded file or PCM, depending on input)
Index  → always-resident summaries (waveform, energy, peaks)
Pages  → decoded PCM in chunks, paged on demand
Ops    → declarative edit list
```

Any output (read, save, play) = load needed pages + apply ops. Play does it in rolling windows, save does it all at once. Same pipeline, different consumer.

`audio()` takes anything — files, URLs, bytes, PCM, AudioBuffer, silence duration. Always async (resolves immediately for PCM). Can page/re-decode encoded sources. `audio.from()` is the sync escape hatch when you know you have PCM and don't want a Promise. Same instance API.


## API

Physical units only: seconds, dB, Hz, LUFS. No samples/indices.
All materialization is async. All output arrays are copies (immutability).

```js
import audio from 'audio'

// Create — audio() takes anything, always async
let a = await audio('file.mp3')             // file/URL/bytes → decode + index
let b = await audio('file.mp3', {
  onprogress({ delta, offset, total }) {}   // progressive index as decode streams
})
let c = await audio([ch1, ch2])             // PCM data → wraps instantly (async resolves immediately)
let d = await audio(3, {channels: 2})       // seconds of silence

// audio.from() — sync guarantee when you know you have PCM
let e = audio.from([ch1, ch2])              // sync, always resident
let f = audio.from(3, {channels: 2})

// Structural ops — reorganize timeline (unique params each)
a.slice(offset, duration)                   // → new Audio (shares source)
a.insert(other, offset?)                    // insert other audio at position
a.remove(offset, duration)                  // delete range
a.pad(duration, {side:'end'})               // add silence
a.repeat(times)                             // repeat N times

// Sample ops — transform values (arg, offset?, duration?)
a.gain(db, offset?, duration?)              // dB
a.fade(duration)                            // +duration = in, -duration = out
a.reverse(offset?, duration?)
a.mix(other, offset?, duration?)            // overlay other audio
a.write(data, offset?)                      // overwrite region

// Smart ops — analyze index, then queue structural/sample op
a.trim(threshold?)                          // → scans index → slice()
a.normalize(targetDb = 0)                   // → reads index peak → gain()

// Custom ops — audio.define(name, opts?, fn)
audio.define('invert', (block) => {
  for (let ch of block) for (let i = 0; i < ch.length; i++) ch[i] = -ch[i]
  return block
})
a.invert()                                  // whole audio
a.invert(2, 1)                              // range 2s..3s

// Output (async, copies)
let pcm = await a.read(offset?, duration?)         // → Float32Array[]
let raw = await a.read(0, 1, { format: 'int16' })  // → Int16Array[] (pcm-convert internally)
let bytes = await a.encode('mp3')                  // → Uint8Array
await a.save('/tmp/out.mp3')                       // Node path: encode + write file
await a.save(fileHandle)                           // browser File System Access handle

// Analyze (async — instant from index, materializes if needed)
await a.limits(offset?, duration?)          // → {min, max}
await a.loudness(offset?, duration?)        // → LUFS
await a.peaks(count)                        // → {min: Float32Array, max: Float32Array}

// Playback — controller returned, parallel by default
let p = a.play(offset?, duration?, opts?)   // opts: { loop, volume, speed }
p.pause()
p.stop()
p.currentTime                               // seconds (get/set)
p.playing                                   // boolean
p.ontimeupdate = (t) => {}
p.onended = () => {}

// Streaming — async iterator over materialized blocks
for await (let block of a.stream()) { ... } // yields Float32Array[] per block

// Properties (read-only, sync)
a.duration                                  // seconds
a.channels                                  // number
a.sampleRate                                // Hz

// Edit history
a.edits                                     // active edit list (inspectable, readonly)
a.undo()                                    // undo last edit (moves to redo stack)
a.redo()                                    // redo (moves back to edits)
a.version                                   // monotonic counter (increments on any edit change)
a.onchange = () => {}                       // fired on edit/undo/redo
a.toJSON()                                  // serialize edits
```


## Ecosystem

```
audio           — this package
audio-buffer    — standalone AudioBuffer (no AudioContext), includes from/utils/remix
audio-decode    — codec decoding (13+ formats)
audio-encode    — codec encoding
audio-mic       — microphone input
audio-speaker   — audio output (lazy-loaded by audio for Node playback)
```

All prerequisites implemented. audio-play and audio-buffer-list absorbed into `audio`.


## Conventions

**Physical units.** Seconds, dB, Hz, LUFS. Samples are internal.

**Parameters.** `(offset, duration)` in seconds. audio-buffer uses `(start, end)` in samples — that's the abstraction boundary.

**Zero aliases.** One name per operation.

**Chain.** All ops sync. Async for I/O: load, read, save, encode, analysis. play() returns controller.

**fade.** `+duration` = in from start, `-duration` = out from end.


## Hard Contracts

- `audio()` takes any input, always returns a Promise. Encoded sources are paged (evictable + re-decodable). PCM sources resolve immediately but are still Promises.
- `audio.from()` is the sync escape hatch — PCM-backed, always resident, never paged. Returns instance directly.
- Index is always resident. Pages are not.
- Custom ops are sample-only, block-local, and shape-preserving: same channel count in, same channel count out, same block lengths.
- `a.edits` is inspectable state, not a mutation API. Only ops, `undo()`, and `redo()` change history.
- `save(target)` persists to an explicit target only. Downloads/UI save flows belong above `audio`, typically on top of `encode()`.


## Architecture

### Index (always resident)

The index is the primary product for UX. Built during decode, retained permanently, survives page eviction. Powers waveform display, analysis, and smart op resolution.

```js
index: {
  blockSize: 1024,                // samples per block — one resolution for everything
  min: [Float32Array, ...],       // per-channel, per-block min amplitude
  max: [Float32Array, ...],       // per-channel, per-block max amplitude
  energy: [Float32Array, ...],    // per-channel, per-block K-weighted mean square
}
```

Everything at blockSize. One resolution, no exceptions:
- `min/max` → `peaks()`, `limits()`, `trim()`, `normalize()`, waveform display
- `energy` → `loudness()` aggregates into 400ms windows + applies BS.1770 gating at query time
- Per-channel stored, collapsed on read by default
- Stereo waveform / loudness overlay: per-channel access without index change

Memory: ~7MB for 2h stereo (3 arrays × 2 channels × ~310K blocks × 4 bytes). Negligible vs PCM.

### onprogress() shape

`onprogress()` is append-only. It does **not** receive the whole index on every decode step.

```js
onprogress({
  delta: {
    fromBlock,                           // starting block index for this batch
    min: [Float32Array, ...],            // per-channel min blocks
    max: [Float32Array, ...],            // per-channel max blocks
    energy: [Float32Array, ...],         // per-channel K-weighted energy blocks
  },
  offset,                                // decoded seconds so far
  total                                  // total seconds if known
})
```

This keeps progress events bounded for 2h+ files and lets consumers append UI state without copying a growing index object.

### Multichannel semantics

Index stores **per-channel** data. API returns **collapsed** by default:

- `peaks()` → collapsed min/max across channels (single waveform)
- `limits()` → global min/max across channels
- `loudness()` → integrated program loudness (BS.1770 weighted)

Per-channel access: `peaks(count, { channel: 0 })` or similar — no index change needed. Stereo waveform display is a consumer decision, not an architecture change.

### Pages (PCM, paged on demand)

Planar Float32Arrays per channel. Stored in pages (chunks), loaded/cached on demand.

```js
this.pages = [
  { data: [Float32Array, Float32Array] | null },  // null = evicted
  ...
]
this.index = { ... }                               // always resident
this.edits = [...]                                 // edit ops
this.sampleRate = 44100
this.channels = 2
```

**Residency is automatic, not user-configured:**
- Small files: all pages resident after decode
- Large browser files: pages backed by OPFS (auto-detected). Budget ~500MB resident, rest paged
- Node: all resident (V8 handles multi-GB). Temp-file backing available for extreme cases
- `storage` option for override: `audio(file, { storage: 'memory' | 'persistent' | 'auto' })`

**`storage: 'auto'` behavior (browser):**
- If OPFS is available and writable, use persistent paged mode automatically
- If OPFS is unavailable/denied/quota-limited, fall back to memory mode **only if** estimated decoded size fits the safe memory budget
- If OPFS is unavailable and the file is too large for safe in-memory decode, fail early with a clear error instead of risking tab death

**Explicit overrides:**
- `storage: 'persistent'` = require OPFS, throw if unavailable
- `storage: 'memory'` = force in-memory decode, even for large files
- `storage: 'auto'` = safest default path

AudioBuffer is an I/O format only — audio-decode output, audio.from() input.

### Page size

Page size: 2^16 = 65536 samples ≈ 1.49s at 44100Hz. Power-of-2 for FFT.

blockSize: 1024 (power-of-2, divides pageSize evenly). Configurable via `audio(file, { blockSize })` if needed — default covers wavearea and general use.

### Ops: three kinds, one edit list

All ops queue to `a.edits`. Three kinds internally:

**Structural** (built-in only) — reorganize timeline. Each has unique params:
- `slice(offset, duration)` → new Audio
- `insert(other, offset?)`, `remove(offset, duration)`, `pad(duration, {side})`, `repeat(times)`

**Sample** (built-in + custom) — transform block values. Convention: `(arg, offset?, duration?)`:
- Built-in: `gain`, `fade`, `reverse`, `mix`, `write`
- Custom: registered via `audio.define()`

**Smart** (built-in only) — analyze index, then queue a structural/sample op:
- `trim(threshold?)` → scans index → queues `slice()`
- `normalize(targetDb?)` → reads index peak → queues `gain()`

### audio.define(name, opts?, fn)

Register a custom sample op. Name and options first, function (often multi-line) last.

`fn(block, arg?, ctx?) => block`
- `block`: `[Float32Array, ...]` — this block's channels
- `arg`: user's first argument (when `args: 1`)
- `ctx`: `{ offset, sampleRate, blockSize }` — block's position

`opts` (optional): `{ args, index }`
- `args`: 0 (default) or 1. 0 = `a.name(offset?, duration?)`. 1 = `a.name(arg, offset?, duration?)`.
- `index`: true = index survives this op. Default false (dirty, safe).

Registration rules:
- `name` must be a valid identifier, not already registered (built-in names reserved)
- Sample ops only — must preserve channel count and block length

```js
// Simplest — no opts needed
audio.define('invert', (block) => {
  for (let ch of block) for (let i = 0; i < ch.length; i++) ch[i] = -ch[i]
  return block
})
a.invert()
a.invert(2, 1)          // range 2s..3s

// With arg — { args: 1 } means first user param is the op arg
audio.define('eq', { args: 1 }, (block, { low, mid, high }, ctx) => { ... })
a.eq({ low: 3, high: -2 })
a.eq({ low: 3 }, 10, 5)  // range 10s..15s

// Index-safe
audio.define('invert', { index: true }, (block) => { ... })
```

Built-in sample ops use the same mechanism. A "plugin" is a package that calls `audio.define`.

**Index-clean** — index stays valid with arithmetic adjustment:
- `slice, insert, remove, pad, repeat` — structural: select/reorder index blocks
- `gain` — shift min/max/energy by dB offset
- `reverse` — reorder index blocks, values unchanged
- `trim` — scans index for boundaries, refines at sample level in boundary pages
- `normalize` — reads `max(index.max)` → becomes gain op
- Custom ops with `{ index: true }`

**Index-dirty** (default for custom ops) — affected range stale, rebuilt on next analysis:
- `fade` — position-dependent gain, can't update min/max without PCM
- `mix` — combines two sources, index is not additive
- `write` — arbitrary data injection
- Custom ops without `{ index: true }` (dirty by default, safe)

Dirty is **range-scoped**, not global. Every op carries offset/duration — engine marks only those index blocks as stale. `fade(0.5)` on a 2h file stales ~21 blocks out of ~310K. Analysis rebuilds only stale blocks.

**Rule:** analysis is always async. When no stale blocks, resolves instantly from index. When stale blocks exist, materializes + reindexes only those blocks, then answers. Uniform return type.

### Materialization

```
1. Resolve smart ops: trim scans index → refines at sample level in boundary pages → slice(). normalize reads index peak → gain().
2. Structural: build output timeline (which source samples → which output positions)
3. Sample: iterate timeline, apply gain/fade/reverse per sample (pages loaded on demand)
```

### Concurrency

Materialization is reentrant. Playback is controller-based, parallel by default:

- `read()`, `encode()`, `save()`, analysis, and `stream()` may run concurrently on the same instance
- `play()` returns an independent controller. Multiple controllers can play simultaneously (parallel by default)
- Every materialization consumer and every playback controller has its own cursor/state
- Edits are snapshot-based per call: a `read()` started at version N finishes against version N even if later ops are queued


## Playback

Playback lives on returned controllers, not on the Audio document. `play()` starts async and returns a playback handle immediately.

```js
let p1 = a.play(0)                          // starts playing
let p2 = a.play(0.5, 1, { volume: 0.5 })   // overlaps — both play simultaneously
p1.stop()                                    // stop just this one
p2.currentTime                               // seconds, get/set
p2.playing                                   // boolean
p2.ontimeupdate = (t) => {}
p2.onended = () => {}
```

Parallel by default. Each `play()` returns an independent controller. Multiple controllers can play simultaneously (sprites, overlapping hits). Exclusive playback is the caller's choice: stop the previous controller before starting a new one.

Browser: WAA (AudioBufferSourceNode, windowed buffer for large files). Node: audio-speaker (lazy-loaded). Buffering/seeking handled internally.


## Streaming

`stream()` yields materialized blocks one at a time — pages loaded on demand, ops applied per block.

```js
for await (let block of a.stream(offset?, duration?)) {
  // block: Float32Array[] — one page's worth of channels
  process(block)
}
```

This fits the paged architecture naturally — pages are already chunked. Streaming = "materialize and yield one page at a time." Useful for encoding large files, piping to network, progressive processing without holding everything in memory.


## Integration

### Web Audio API

`audio.from(audioBuffer)` in, `read()` out. Construct AudioBuffer from returned channels at the boundary.

### Wavearea

Audio collapses wavearea's 4 layers into 1:

```js
let a = await audio(file, {
  onprogress({ delta }) {
    let min = collapseChannels(delta.min)   // collapse per-channel blocks for single-waveform UI
    let max = collapseChannels(delta.max)
    waveform += deltaToWavefont(min, max)
  }
})

let p = a.play(caretTime)
p.ontimeupdate = (t) => { caret = timeToBlock(t) }

a.remove(start, duration)
a.insert(clipboard, offset)
a.undo()
```

Eliminates: api.js, worker.js, player.js, most of store/. Keeps: wavefont encoding, UI.

Index powers waveform display without PCM. Pages loaded only for playback/editing. In browser, OPFS-backed auto mode handles 2h+ files when available and otherwise fails safely before tab death.

### DAWs

Audio is the per-track engine. A DAW uses one Audio instance per track.

```js
// DAW = N tracks + mixer + transport
let tracks = await Promise.all(files.map(f => audio(f, { onprogress })))

// per-track editing
tracks[0].gain(-3).fade(.5)
tracks[2].remove(10, 2).insert(clipboard, 10)
tracks[1].undo()

// per-track waveform — from index, no PCM
for (let t of tracks) drawWaveform(await t.peaks(width))

// bounce/export — materialize in windows, mix progressively
for (let t = 0; t < duration; t += windowSize) {
  let chunks = await Promise.all(tracks.map(tr => tr.read(t, windowSize)))
  output.write(mixdown(chunks))
}

// session save/load
let session = tracks.map(t => t.toJSON())
```

What audio provides per track: non-destructive editing, undo, waveform index, paged PCM, materialization, playback controllers, session serialization. What the DAW adds on top: multi-track mixing (sum Float32Arrays), master transport (coordinate controllers), automation curves, routing.

### Extending

`audio.define()` is the extension mechanism — same one built-ins use internally. Future effect packages (audio-vst, audio-wam, audio-faust) just call it.


## v2 Scope

**Ships:**
- `audio()` async canonical path + `audio.from()` sync resident fast path
- `audio.define()` — register custom ops, explicit contract
- 12 built-in ops (9 index-clean + 3 index-dirty) + custom via audio.define()
- Index: min + max + energy per block per channel, built during decode
- Materialization: smart op resolution → structural → sample
- Output: `read()` (with format option), `encode()`, `save(target)`
- 3 analysis methods: always async (instant from index when clean, materializes when dirty)
- Playback controllers via `play()`, parallel by default
- `stream()` async iterator for streaming
- `edits`, `undo()`, `redo()`, `version`, `onchange`, `toJSON()`
- OPFS page cache for browser large files
- node:test, JSDoc + .d.ts

**Does NOT ship:**
- CLI
- audio-vst / audio-wam / audio-faust packages
- Piped/writable stream output (ReadableStream/WritableStream API)
- Spectrum analysis
- Node temp-file page cache (V8 handles multi-GB; add if needed)


## CLI

`npx audio` — sox-style. Effects are positional words, not flags. Units explicit when needed.

### Convention (modeled after sox)

```sh
audio [input] [ops...] [-o output]
```

```sh
# Basic
audio in.mp3 gain -3db trim normalize -o out.wav

# Ranges — offset..end syntax
audio in.mp3 gain -3db 1s..10s -o out.wav       # gain only 1s to 10s
audio in.mp3 fade 0..0.5s fade -0.5s.. -o out.wav  # fade in first 0.5s, fade out last 0.5s

# Fade with curve
audio in.mp3 fade 0..1s ease-in fade -1s.. ease-out -o out.wav

# Pipe — `-` or implicit stdin/stdout (sox convention)
cat in.raw | audio gain -3db > out.raw
audio in.mp3 encode mp3 -o -                     # stdout
audio - gain -3db -o out.wav --rate 44100 --ch 2  # stdin with format hint

# Macro — apply saved edit list
audio in.mp3 --macro recipe.json -o out.wav

# Plugins — auto-discovered from node_modules/audio-*
npm i audio-compress
audio in.wav compress --ratio 4 -o out.wav       # just works
```

### Units

| Domain | Suffix | Default (no suffix) | Examples |
|--------|--------|---------------------|----------|
| Time | `s`, `ms` | seconds | `0.5s`, `500ms`, `0.5` |
| Amplitude | `db`, none | dB for gain, linear for others | `-3db`, `0.5` |
| Frequency | `hz`, `khz` | Hz | `440hz`, `2khz` |

### Ranges

`offset..end` syntax. Negative = from end. Open-ended = start/end.

```
1s..10s      # from 1s to 10s
0..0.5s      # first half second
-1s..        # last second to end
..5s         # start to 5 seconds
-1s..-0.5s   # 0.5s interval, 1s from end
```

This replaces the JS API's `(offset, duration)` convention for CLI. Ranges are more readable in a terminal than offset+duration.

### Fade

```sh
fade 0..0.5s              # fade in, first 0.5s, linear (default)
fade -0.5s..              # fade out, last 0.5s
fade 0..1s ease-in        # fade in with curve
fade -1s.. ease-out       # fade out with curve
```

Curves: `linear` (default), `ease-in`, `ease-out`, `ease-in-out`, `log`, `exp`. Matches CSS easing naming.

### stdin/stdout

Sox convention: `-` for explicit stdin/stdout. Or implicit — if no input file specified and stdin has data, read from stdin. If no `-o`, write to stdout.

```sh
# Explicit
audio - gain -3db -o - < in.raw > out.raw

# Implicit
cat in.raw | audio gain -3db > out.raw
```

For raw PCM stdin: `--rate`, `--ch`, `--format` specify the format (like sox's `-t raw -r 44100 -c 2`).

### Plugin discovery

eslint model: scan `node_modules/audio-*` at startup. Any package that calls `audio.op()` registers its commands automatically. No config file, no forced install.

```
node_modules/
  audio-compress/   → exports audio.op('compress', ...)
  audio-reverb/     → exports audio.op('reverb', ...)
```

User installs what they need: `npm i audio-compress`. The CLI finds it. Convention over configuration.

Not sox/ffmpeg style (fixed set). Not forced install. Just: if it's there, it works.

### Macros

Serialized edit lists. `toJSON().edits` exports, `redo(edit)` replays.

```json
[
  {"type": "trim", "threshold": -40},
  {"type": "normalize", "targetDb": 0},
  {"type": "fade", "duration": 0.5},
  {"type": "fade", "duration": -0.5}
]
```

```sh
audio in.mp3 --macro podcast-cleanup.json -o out.wav
```

In code:
```js
let recipe = JSON.parse(fs.readFileSync('recipe.json'))
let a = await audio('in.mp3')
for (let edit of recipe) a.redo(edit)
await a.save('out.wav')
```

No special macro runtime. Edits ARE macros.


## Index Extensions

The index is currently fixed: min, max, energy. But analysis needs are open-ended: K-weighted energy, pitch, chord, cepstrum, BPM, spectral centroid, zero-crossing rate, etc.

**Design: index fields are pluggable.**

```js
// Register a custom index field — one function, context tells you why
audio.index('pitch', (block, ctx) => {
  // ctx.op: 'decode' | 'gain' | 'fade' | ... — what triggered this
  // ctx.prev: previous value for this block (null on first decode)
  // ctx.edit: the edit object (null on decode)
  // ctx.sampleRate, ctx.blockSize

  // Short-circuit: ops that don't affect pitch
  if (ctx.op === 'gain' || ctx.op === 'reverse') return ctx.prev

  // Compute from PCM (decode, fade, or any dirty op)
  return detectPitch(block[0], ctx.sampleRate)
})

// Now available:
a.index.pitch     // Float32Array — one value per block
```

**Contract:**
- One function: `(block, ctx) => value`. Called per block.
- `ctx.op` = `'decode'` on initial build, or the op type on update.
- Return `ctx.prev` = field is clean for this op (no recompute, value preserved).
- Return new value = field updated.
- If the function needs PCM (for decode or dirty ops), it gets the block. For clean ops, it can short-circuit without touching PCM.
- Index fields survive page eviction (tiny per block — one number).
- Custom index fields participate in dirty tracking: stale ranges per-field, not global.

**Built-in fields use the same mechanism:**
```js
// Internally, audio registers:
audio.index('min', (block, ctx) => {
  if (ctx.op === 'gain') return ctx.prev * (10 ** (ctx.edit.db / 20))
  if (ctx.op === 'reverse') return ctx.prev
  return Math.min(...block[0])  // compute from PCM
})
```

**K-weighted energy example:**
```js
import { kWeightFilter } from 'digital-filter'

audio.index('kEnergy', (block, ctx) => {
  if (ctx.op === 'gain') return ctx.prev * (10 ** (ctx.edit.db / 10))  // energy scales with gain²
  if (ctx.op === 'reverse') return ctx.prev  // energy unchanged

  // Compute from PCM (decode or dirty op)
  let filtered = kWeightFilter(block[0], ctx.sampleRate)
  return filtered.reduce((s, v) => s + v * v, 0) / filtered.length
})

// Now loudness() can use a.index.kEnergy instead of plain energy
```

**Dirty tracking becomes per-field:**

Currently: one dirty range for all index fields. With extensions: each field tracks its own stale blocks. A `gain` op might be clean for min/max/energy/kEnergy but dirty for pitch. A `reverse` might be clean for energy but dirty for BPM.

```
a.gain(-3)         // min/max/energy: clean (arithmetic). pitch: clean. bpm: clean.
a.fade(0.5)        // min/max: dirty for range. energy: dirty. pitch: dirty. bpm: dirty.
```

The stale check walks edits per field, not globally. Analysis methods check only their own field's staleness.

**Memory:** Each index field adds ~1.2MB for 2h stereo at 1024 blockSize (one Float32 per block × ~310K blocks). 10 custom fields = 12MB total. Still negligible vs PCM.


## Custom Processing

Beyond simple ops (block-level transforms), users need complex processing chains:

### Compound ops (macros)

Audacity-style batch processing. A macro is a list of edits applied sequentially:

```js
// Define a reusable processing chain
let podcast = [
  { type: 'trim', threshold: -30 },
  { type: 'normalize', targetDb: -1 },
  { type: 'fade', duration: 0.5 },
  { type: 'fade', duration: -0.5 },
]

// Apply to any audio
let a = await audio('episode.mp3')
for (let edit of podcast) a.redo(edit)
await a.save('clean.mp3')
```

No special macro API needed — `redo(edit)` already pushes edits. A "macro" is just an array of edit objects.

### Conditional ops (smart processing)

Ops that analyze audio and decide what to do:

```js
// Speed up silence (podcast editing)
audio.op('speedSilence', { args: 1 }, (block, { threshold, speedFactor }, ctx) => {
  // If block is below threshold, compress time (return shorter block)
  // This is a structural change — needs special handling
})
```

Problem: current ops are shape-preserving (same block length in/out). Structural changes (time compression) can't be expressed as sample ops.

**Solution: allow ops to return different-length blocks.** If an op returns a shorter block, the output timeline adjusts. This breaks the "shape-preserving" contract but enables powerful processing:

```js
audio.op('silenceSpeed', { args: 1, structural: true }, (block, opts, ctx) => {
  let energy = block[0].reduce((s, v) => s + v * v, 0) / block[0].length
  if (energy < opts.threshold) {
    // Compress: keep every Nth sample
    let factor = opts.speed || 4
    return block.map(ch => ch.filter((_, i) => i % factor === 0))
  }
  return block
})
```

This is a post-v2 extension. For v2, shape-preserving ops cover the common case.

### Filter chains (DSP pipelines)

Integration with `digital-filter`, `audio-filter`, etc.:

```js
import { biquad } from 'digital-filter'

// Register a filter as an op
audio.op('lowpass', { args: 1 }, (block, freq, ctx) => {
  let filter = biquad('lowpass', freq, ctx.sampleRate)
  return block.map(ch => filter(ch))
})

a.lowpass(2000)  // chainable, serializable
```

Filters are just ops. The `digital-filter` package provides the DSP, `audio.op()` provides the integration. No special filter API needed.


## Plugin Contract (revised)

With index extensions and structural ops, the plugin contract evolves:

```js
audio.op(name, opts?, fn)
```

**opts:**
- `args: 0 | 1` — calling convention
- `index: true | false | { field: rule, ... }` — per-field index behavior
  - `true` = all fields clean
  - `false` = all fields dirty (default)
  - `{ min: true, max: true, energy: false, pitch: null }` = per-field
- `structural: false` — if true, op may change block length (post-v2)

**Example:**
```js
audio.op('compress', { args: 1, index: { min: false, max: false, energy: false } }, (block, opts, ctx) => {
  // Compressor changes dynamics — min/max/energy all affected
  ...
})
```

For most ops, `index: false` (the default) is correct and safe. Only ops that provably preserve specific fields need the per-field declaration. This keeps the simple case simple.


## Open Questions

- [ ] Page size: benchmark 2^15 vs 2^16 vs 2^17
- [ ] OPFS budget: 500MB default, auto-detect available?
- [ ] Worker bundling: inline blob URL or separate file?
- [ ] Index rebuild: lazy per-field or global?
- [ ] CLI arg parsing: custom or use existing lib (like sade)?
- [ ] Structural custom ops: how to handle variable-length output blocks?
- [ ] Index extensions: eager (compute during decode) vs lazy (compute on first access)?
