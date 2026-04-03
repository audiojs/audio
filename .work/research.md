## Vision

**audio is an indexed, paged audio document with immutable source and declarative ops.**

`load → transform → save`. Compact, terse, portable. Handles 2h+ files in the browser without tab death.

### Essence
Take any audio input, apply operations, produce output. Like `sharp` for images. The taste of water in this package is the single line: `await audio('in.mp3').gain(-3).save('out.wav')` — if that works perfectly across Node + browser, the package has justified its existence.

### Pure form
A universal audio buffer smarter than raw PCM. Knows its own structure (index), handles its own memory (pages), records its own history (edits). The limit as versions → ∞: the audio equivalent of a spreadsheet cell — reactive, lazy, infinite capacity, zero ceremony.

### Theoretical minimum
```js
let a = await audio(input)
let pcm = await a.read()
```
Load anything, get PCM. Everything else is acceleration toward this.

### Bone (in)
- Load any format → PCM
- Non-destructive editing (structural + sample ops)
- Index-powered analysis (peaks, loudness, limits)
- Encode + save
- Playback
- CLI for sox-style audio manipulation
- Plugin system (`audio.op()`) for extending ops

### Flesh (out — must NOT become)
- Audio module compiler (→ `audio-module`)
- DAW framework (consumer builds that on top)
- Real-time DSP engine (→ `web-audio-api` / AudioWorklet)
- Plugin format wrapper (CLAP/VST/WAM → `audio-module`)
- Package manager for audio plugins

### Single-player value
One developer, one audio file, one script. No network, no server, no framework. `npx audio in.mp3 trim normalize -o out.wav`. Done. Value is immediate, complete, standalone. First user stays because the alternative is sox (arcane flags) or ffmpeg (not JS) or Web Audio API (ceremony).

### Soul / spark
The index. Always-resident, survives page eviction, powers analysis without touching PCM. 2-hour file waveform renders instantly from 7MB of index data. The architectural separation of index / pages / edits — that's the insight competitors would have to rebuild from scratch. The edit list is both undo history and serializable macro. Non-destructive by architecture, not by convention.

### Spine
Happy path: `audio(file) → ops → read/save/play`. 90% of users do exactly this. The gravity is the edit list — everything orbits it. Structural ops reshape timeline, sample ops transform values, smart ops analyze-then-queue. One list, three kinds, uniform serialization. What breaks first under weight: materialization of long edit chains on large files (→ streaming render in v2.1).


## Mental Model

```
Source → immutable backing (encoded file or PCM, depending on input)
Stats  → always-resident per-block measurements (min, max, energy — pluggable)
Pages  → decoded PCM in chunks, paged on demand
Ops    → declarative edit list
```

Any output (read, save, play) = load needed pages + apply ops. Play does it in rolling windows, save does it all at once. Same pipeline, different consumer.

`audio()` takes anything — files, URLs, bytes, PCM, AudioBuffer, silence duration. Always async (resolves immediately for PCM). Can page/re-decode encoded sources. `audio.from()` is the sync escape hatch when you know you have PCM and don't want a Promise.


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
let c = await audio([ch1, ch2])             // PCM data → wraps instantly
let d = await audio(3, {channels: 2})       // seconds of silence

// audio.from() — sync guarantee when you know you have PCM
let e = audio.from([ch1, ch2])
let f = audio.from(3, {channels: 2})

// Structural ops — reorganize timeline
a.crop(offset, duration)                    // trim to range
a.insert(other, offset?)                    // insert other audio at position
a.remove(offset, duration)                  // delete range
a.repeat(times, offset?, duration?)         // repeat N times

// Sample ops — transform values (arg, offset?, duration?)
a.gain(db, offset?, duration?)              // dB
a.fade(duration, curve?)                    // +duration = in, -duration = out
a.reverse(offset?, duration?)
a.mix(other, offset?, duration?)            // overlay other audio
a.write(data, offset?)                      // overwrite region
a.remix(channels)                           // mono↔stereo

// Smart ops — analyze stats, then resolve to structural/sample op
a.trim(threshold?)                          // → scans stats → crop()
a.normalize(targetDb = 0)                   // → reads stats peak → gain()
a.normalize('streaming')                    // → preset: -14 LUFS

// Custom ops — audio.op(name, init)
audio.op('invert', () => (block) => {
  for (let ch of block) for (let i = 0; i < ch.length; i++) ch[i] = -ch[i]
  return block
})
a.invert()                                  // whole audio
a.invert(2, 1)                              // range 2s..3s

// Inline processing via .apply()
a.apply((block) => { /* one-off transform */ return block })

// Output (async — format determines return type)
let pcm = await a.read(offset?, duration?)         // → Float32Array[]
let raw = await a.read(0, 1, { format: 'int16' })  // → Int16Array[]
let wav = await a.read({ format: 'wav' })           // → Uint8Array (encoded)
await a.save('/tmp/out.mp3')                       // encode + write (format from ext)

// Analyze (async — instant from stats, materializes if needed)
await a.db(offset?, duration?)              // → peak dBFS (number)
await a.rms(offset?, duration?)             // → RMS level (number)
await a.loudness(offset?, duration?)        // → integrated LUFS (number)
await a.peaks(count, opts?)                 // → {min, max} Float32Arrays

// Playback — controller returned, parallel by default
let p = a.play(offset?, duration?)
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
a.edits                                     // active edit list
a.undo()                                    // undo last edit
a.apply(...edits)                           // apply / replay edits
a.version                                   // monotonic counter
a.onchange = () => {}
a.toJSON()                                  // serialize edits
```


## Ecosystem

```
audio           — this package (document library)
audio-buffer    — standalone AudioBuffer (no AudioContext)
audio-decode    — codec decoding (13+ formats)
audio-encode    — codec encoding
audio-mic       — microphone input
audio-speaker   — audio output (lazy-loaded by audio for Node playback)
audio-module    — cross-platform plugin compiler (separate concern)
```


## Conventions

**Physical units.** Seconds, dB, Hz, LUFS. Samples are internal.

**Parameters.** `(offset, duration)` in seconds. audio-buffer uses `(start, end)` in samples — that's the abstraction boundary.

**Zero aliases.** One name per operation.

**Chain.** All ops sync. Async for I/O: load, read, save, encode, analysis. play() returns controller.

**fade.** `+duration` = in from start, `-duration` = out from end.


## Hard Contracts

- `audio()` takes any input, always returns a Promise. Encoded sources are paged (evictable + re-decodable). PCM sources resolve immediately but are still Promises.
- `audio.from()` is the sync escape hatch — PCM-backed, always resident, never paged. Returns instance directly.
- Stats are always resident. Pages are not.
- Custom ops are sample-only, block-local, and shape-preserving: same channel count in, same channel count out, same block lengths.
- `a.edits` is inspectable state, not a mutation API. Only ops, `undo()`, and `apply()` change history.
- `save(target)` persists to an explicit target only. Downloads/UI save flows belong above `audio`, on top of `read({ format })`.


## Architecture

### Stats (always resident, pluggable)

Per-block measurements computed during decode, retained permanently, survives page eviction. Powers peaks display, analysis, and smart op resolution (.resolve). Fully pluggable — core hardcodes nothing, `audio.js` registers min/max/energy.

```js
a.stats: {
  blockSize: 1024,                // samples per block
  min: [Float32Array, ...],       // per-channel, per-block min amplitude
  max: [Float32Array, ...],       // per-channel, per-block max amplitude
  energy: [Float32Array, ...],    // per-channel, per-block K-weighted mean square
}
```

Registration: `audio.stat(name, factory)` where factory returns a block function (supports stateful stats like K-weighted energy). Query methods (`db`, `rms`, `loudness`, `peaks`) are prototype extensions registered in `audio.js`.

Memory: ~7MB for 2h stereo (3 arrays × 2 channels × ~310K blocks × 4 bytes). Negligible vs PCM.

### Pages (PCM, paged on demand)

Planar Float32Arrays per channel. Stored in pages (chunks), loaded/cached on demand.

**Residency is automatic:**
- Small files: all pages resident after decode
- Large browser files: pages backed by OPFS (auto-detected). Budget ~500MB resident, rest paged
- Node: all resident (V8 handles multi-GB)
- `storage` option for override: `'memory' | 'persistent' | 'auto'`

Page size: 2^16 = 65536 samples ≈ 1.49s at 44100Hz.

### Ops: three kinds, one edit list

**Structural** — reorganize timeline: `crop`, `insert`, `remove`, `repeat`
**Sample** (built-in + custom) — transform values: `gain`, `fade`, `reverse`, `mix`, `write`, `remix`, custom via `audio.op()`
**Smart** — analyze stats then resolve to simpler op: `trim`, `normalize`
**Inline** — anonymous functions via `apply()`

### Stats dirtiness

**Clean** (arithmetic update): `gain`, `reverse`, `trim`, `normalize`
**Range-dirty** (affected blocks stale): `fade`, `mix`, `write`, custom ops
**Global-dirty** (full rebuild): `crop`, `remove`, `insert`, `repeat` — structural ops shift block boundaries

### Materialization

**Streaming render** (v2): Read plan + streaming.
1. Walk structural edits → segment map (which source → which output)
2. For each output chunk, read source pages per plan, apply sample ops, yield
3. Smart ops (trim, normalize) use `.resolve` to resolve from stats → simpler streamable ops

Falls back to cached full render when pipeline can't be streamed (inline fns, sample ops before structural).

### Smart op resolution (`.resolve`)

Ops like `trim` and `normalize` are "measure-then-act" — they need global stats, then produce a trivial transform. The `.resolve(args, ctx)` property on the processor allows resolution from stats without full render:
- `trim` resolves to `crop` (using stats.min/max for silence boundaries)
- `normalize` resolves to `gain` (using stats peak or K-weighted energy for LUFS)

This makes `audio('file').trim().normalize().save('out.wav')` fully streamable.

### Cursor / Preload

```js
a.cursor = 30.5  // seconds — "user is here"
// → preload pages near cursor
```

For wavearea integration, cursor = caret position.


## CLI

`npx audio` — sox-style. Effects are positional words, not flags.

```sh
audio [input] [ops...] [-o output]

# Basic
audio in.mp3 gain -3db trim normalize -o out.wav

# Ranges — offset..end syntax
audio in.mp3 gain -3db 1s..10s -o out.wav
audio in.mp3 fade 0..0.5s fade -0.5s.. -o out.wav

# Pipe
cat in.raw | audio gain -3db > out.raw

# Macro — apply saved edit list
audio in.mp3 --macro recipe.json -o out.wav

# Plugins — auto-discovered from node_modules/audio-*
npm i audio-compress
audio in.wav compress --ratio 4 -o out.wav
```

### Units

| Domain | Suffix | Default | Examples |
|--------|--------|---------|----------|
| Time | `s`, `ms` | seconds | `0.5s`, `500ms`, `0.5` |
| Amplitude | `db` | dB for gain | `-3db`, `0.5` |
| Frequency | `hz`, `khz` | Hz | `440hz`, `2khz` |

### Ranges

`offset..end` syntax. Negative = from end. Open-ended = start/end.

```
1s..10s      # from 1s to 10s
0..0.5s      # first half second
-1s..        # last second to end
```

### Plugin discovery

eslint model: scan `node_modules/audio-*` at startup. Any package that calls `audio.op()` registers its commands automatically. No config file.

### Macros

Serialized edit lists. `toJSON().edits` exports, `apply(edit)` replays.

```sh
audio in.mp3 --macro podcast-cleanup.json -o out.wav
```


## Plugin Architecture

Every plugin is `(audio) => { ... }` — receives `audio`, extends it.

```js
audio.fn       // instance prototype (like $.fn)
audio.op       // register op: audio.op('name', init)
audio.stat     // register stat: audio.stat('name', fn)
audio.hook     // single-slot hooks { create }
audio.run      // op dispatch — history replaces
audio.use()    // plugin registration
audio.from()   // sync entry
```

### Plugin contract

```js
// Every plugin receives audio, extends it
export default (audio) => {
  audio.op('gain', impl)        // register an op
  audio.fn.play = function() {} // add a proto method
  audio.stat('energy', impl)    // register a stat
}
```

### Bundles

```js
// audio.js — full bundle
import audio from './core.js'
import history from './history.js'
import crop from './fn/crop.js'
import gain from './fn/gain.js'
// ...
audio.use(history, crop, gain, ...)

// audio-mini.js — no history, no cache
import audio from './core.js'
import crop from './fn/crop.js'
audio.use(crop)
```

### File structure

```
core.js          — audio container, audio.fn, audio.run, audio.use()
decode.js        — decode engine
plan.js          — segment utilities (used by render)
render.js        — render engine (full + plan-based streaming)
stats.js         — block-level stat computation
cache.js         — OPFS paging, eviction
history.js       — non-destructive editing (replaces audio.run, wraps read/stream)
fn/              — all processing functions as plugins
```

### Op contract

```js
audio.op('compress', (threshold, ratio) => {
  let env = 0
  return (block, ctx) => { /* compression */ return block }
})
```

- `init(...params) → processor(block, ctx) → block | false | null`
- Closure holds state between blocks (filter memory, running averages)
- All custom ops are stats-dirty by default (safe)


## Custom Stats (v2.1)

Stats are fully pluggable via `audio.stat(name, factory)`. Factory pattern for stateful stats:

```js
// Stateless — direct function (auto-wrapped)
audio.stat('pitch', (channels) => detectPitch(channels[0]))
a.stats.pitch     // Float32Array — one value per block

// Stateful — factory returns closure with state
audio.stat('energy', () => {
  let kState = null
  return (channels, ctx) => {
    // K-weighting filter carries state between blocks
    if (!kState) kState = channels.map(() => ({ fs: ctx.sampleRate }))
    // ... compute K-weighted mean square
  }
})
```

Query methods are prototype extensions: `proto.db = async function(off, dur) { ... }`

Memory: ~1.2MB per field for 2h stereo.


## Structural Custom Ops (post-v2)

Allow variable-length output from custom ops:

```js
audio.op('silenceSpeed', (threshold, speed) => ({
  structural: true,
  process(channels, sr) {
    return channels.map(ch => compressSilence(ch, threshold, speed, sr))
  }
}))
```

Shape-preserving sample ops cover the common case for v2.


## Integration

### Wavearea
Audio collapses wavearea's 4 layers into 1: index powers waveform display, pages loaded only for playback/editing, OPFS handles 2h+ files.

### DAWs
One Audio instance per track. Parallel playback, non-destructive editing, undo, session serialization via `toJSON()`.

### Web Audio API
`audio.from(audioBuffer)` in, `read()` out.

### audio-module bridge
A plugin written to `audio-module` contract can also register as an `audio` op via `audio.op()`. The compilation toolchain lives in `audio-module`.



## Industry Landscape

### Market Leaders & Why Users Love Them

#### **Logic Pro** (Apple, $200 one-time)
- **Why users love it**: Sound library (7,000+ instrument patches, 2,800 loops), Flex Time (non-destructive timing), Flex Pitch (non-destructive pitch), AI Drummer
- **Happy path**: Musicians on Mac who want to go from zero to production in one tool. Value = no subscription + massive library + native integration
- **Workflow**: Visual waveform editing, multi-track arrangement, real-time effects preview

#### **Reaper** (Cockos, $60)
- **Why users love it**: Extreme customization (3-5 ways to do every action), stability, speed, generous trial, plugin ecosystem (VST/VST3/AU/CLAP)
- **Happy path**: Sound designers & film post who need total workflow control + want to debug their process. Value = affordable + ultimate flexibility
- **Workflow**: Deeply customizable UI, keyboard shortcuts, workspace theming, scripting support

#### **Pro Tools** (Avid, subscription model)
- **Why users love it**: Industry standard (every major studio has it), deep film/video integration, native video playback, collaborative workflows
- **Happy path**: Studios doing client work where standardization matters. Plugins ecosystem (AAX). Value = interoperability + client expectations
- **Workflow**: Video-first design, session sharing, mixing console metaphor

#### **Audacity** (Open source, free)
- **Why users love it**: Free, cross-platform, spectral editing, plugin system (VST/LV2/Nyquist), format support (WAV/MP3/FLAC/OGG)
- **Happy path**: Beginners, podcasters, casual users who need to trim/normalize/add basic effects
- **Drawback**: Dated interface, no real-time effects, clunky workflow

#### **Nuendo** (Steinberg, subscription)
- **Why users love it**: Film/post-production focus, spatial audio (Dolby Atmos), advanced synchronization, Cubase compatibility
- **Happy path**: Post-production workflows at scale (video sync, multi-track dialogue, object audio)

### CLI Audio Tools Gap (sox, ffmpeg)

| Aspect | sox/ffmpeg | Industry DAWs | audio (CLI) Opportunity |
|--------|-----------|---------------|------------------------|
| **Discoverability** | Arcane flag syntax | Visual, self-documenting | Clear, learnable CLI |
| **Non-destructive** | Destructive (overwrites) | Full undo/redo + edit list | Native via edit list |
| **Visual feedback** | None (command-line only) | Waveform, spectral, meters | Text-based analysis + optional JSON |
| **Format support** | Good (ffmpeg), basic (sox) | Extensive | Leverage audio-decode ecosystem |
| **Scripting** | Possible but awkward | Macros/automation | Serializable edits as JSON macros |
| **Batch operations** | Designed for this | Not native | Perfect fit for CLI |
| **Plugin ecosystem** | None | Extensive (VST/AU/CLAP) | audio.op() model |
| **Learning curve** | Steep (flag memorization) | Moderate (UI guided) | Gentle (English-like operations) |

### User Type Happy Paths

#### **Podcaster** (most common CLI user)
**Pain**: Trim silence, normalize levels, remove background noise, export MP3
**Current solution**: Audacity (GUI) or sox (CLI)
**audio CLI advantage**: `audio podcast.wav trim normalize denoise -o podcast.mp3` — one intuitive line

#### **Sound Designer**
**Pain**: Apply complex chains, iterate variations, export multiple formats
**Current solution**: Reaper (full DAW) or SoundForge (Windows-only)
**audio CLI advantage**: Macros as JSON edits, parallelizable (batch processing with state tracking)

#### **Batch Audio Processing**
**Pain**: Process 1000s of files (codec conversion, gain normalization, format detection)
**Current solution**: sox loops or shell scripts
**audio CLI advantage**: JavaScript + CLI = more expressive than shell, more maintainable

#### **Web Audio Integration**
**Pain**: Audio processing in browser (video posters, podcasters, streaming)
**Current solution**: Web Audio API (low-level) or ffmpeg.wasm (slow, large)
**audio CLI advantage**: Same library (Node + browser), non-destructive editing survives serialization

---

## Demanded Features (Priority Order)

### Tier 1: Must-Have (Every Industry Tool)
1. **Multi-format input** → PCM (MP3, WAV, FLAC, OGG, M4A, WebM)
2. **Encode + save** (same formats + OPUS, AIFF)
3. **Gain** (dB + linear)
4. **Fade** (in/out, curves)
5. **Trim** (silence detection + manual ranges)
6. **Normalize** (peak + LUFS)
7. **Playback** (with position control)
8. **Undo/redo** (full history, serializable)
9. **Batch operations** (same edits to many files)

### Tier 2: Competitive (What Sets Leaders Apart)
1. **Spectral analysis** (frequency-domain visualization)
2. **Pitch/time stretch** (non-destructive, independent)
3. **Silence compression** (smart removal)
4. **Noise gate** (threshold-based reduction)
5. **EQ** (parametric, visual)
6. **Compression** (threshold/ratio/attack/release)
7. **Plugin ecosystem** (custom ops via audio.op())
8. **Mixing** (multi-track support, pan, crossfade)

### Tier 3: Delighting (Why Users Choose One Over Another)
1. **Spectral editing** (select-and-delete in frequency domain)
2. **Time-stretch perception** (preserve/alter formants)
3. **Vocal removal** (stem separation)
4. **AI effects** (diarization, speech enhancement)
5. **Workflow scripting** (user-defined macros)
6. **Real-time preview** (hear changes before commit)

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
