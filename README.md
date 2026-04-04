# audio [![test](https://github.com/audiojs/audio/actions/workflows/test.yml/badge.svg)](https://github.com/audiojs/audio/actions/workflows/test.yml)

> Paged, indexed, immutable audio — load, edit, save, play, analyze. Incorporates index/pages/edits architecture.

```js
import audio from 'audio'

let a = await audio('voice.mp3')
a.trim().normalize().fade(0.5).fade(-0.5)
await a.save('clean.wav')
```

```sh
npm i audio
```

All parameters use physical units: **seconds**, **dB**, **Hz**, **LUFS**. No sample indices in the public API.

## Quick Reference

| Method | Description |
|--------|-------------|
| `audio(source, opts?)` | Decode from file/URL/bytes (async, paged) |
| `audio.from(source, opts?)` | Wrap PCM/AudioBuffer/silence (sync, resident) |
| `audio.concat(...sources)` | Join audio instances end-to-end |
| **Structural** | |
| `.crop(offset?, duration?)` | Keep only this range |
| `.insert(source, offset?)` | Insert audio at position; number = seconds of silence |
| `.remove(offset, duration)` | Delete range |
| `.repeat(times)` | Repeat N times |
| **Sample** | |
| `.gain(db, offset?, duration?)` | Adjust volume in dB |
| `.fade(duration, curve?)` | Positive = fade in from start, negative = fade out from end |
| `.reverse(offset?, duration?)` | Reverse samples |
| `.mix(other, offset?, duration?)` | Overlay audio |
| `.write(data, offset?)` | Overwrite region |
| `.remix(channels)` | Change channel count |
| `.trim(threshold?)` | Remove silence from edges |
| `.normalize(target?)` | Normalize to peak, LUFS preset, or explicit LUFS |
| **Inline** | |
| `.apply(...edits)` | Apply edit objects and/or processor functions |
| **Output** | |
| `.read(offset?, duration?, opts?)` | Get PCM or encoded bytes |
| `.save(target)` | Encode + write to file |
| **Analysis** | |
| `.db(offset?, duration?)` | Peak level in dBFS |
| `.rms(offset?, duration?)` | RMS level |
| `.loudness(offset?, duration?)` | Integrated LUFS (BS.1770) |
| `.peaks(count, opts?)` | Downsampled min/max peaks |
| **Playback** | |
| `.play(offset?, duration?)` | Start playback (Node: audio-speaker, browser: WAA) |
| **Streaming** | |
| `.stream(offset?, duration?)` | Async iterator over blocks |
| **History** | |
| `.undo()` | Pop last edit |
| `.apply(...edits)` | Re-apply undone edits |
| `.toJSON()` | Serialize audio |
| `audio(json)` | Restore from serialized audio |
| **Properties** | |
| `.duration` `.channels` `.sampleRate` `.length` | Read-only |
| `.source` `.edits` `.version` `.onchange` `.cursor` `.stats` | State |
| **Extension** | |
| `audio.op(name, init)` | Register custom op |
| `audio.stat(name, fn)` | Register per-block stat |

## Create

**`audio(source)` — async.** Decodes encoded audio. Returns a Promise.

```js
let a = await audio('file.mp3')          // file path (Node)
let b = await audio(url)                  // URL string or URL object
let c = await audio(uint8array)           // encoded bytes

// Progressive decode — streams index deltas as pages decode
let d = await audio('long.flac', {
  onprogress({ delta, offset, total }) {
    // delta.min, delta.max, delta.energy — Float32Array[] per channel
    // Append to waveform display as decode streams
    appendWaveform(delta.min, delta.max)
  }
})
```

**`audio.from(source)` — sync.** Wraps existing PCM. No decode, no I/O.

```js
let e = audio.from([left, right])         // Float32Array[] channels
let f = audio.from(3, { channels: 2 })   // 3 seconds of silence
let g = audio.from(audioBuffer)           // Web Audio AudioBuffer
```

**`audio.concat(...sources)` — async.** Joins audio instances end-to-end (inverse of split).

```js
let c = audio.concat(a, b)               // join end-to-end
```

Encoded sources are paged (64K-sample chunks, evictable to OPFS for large files). PCM sources via `audio.from()` are always resident.

## Ops

All ops are sync, chainable, non-destructive. They push to the edit list — source pages are never mutated.

### Structural — reorganize timeline

```js
a.crop(1, 5)              // keep seconds 1–6
a.remove(10, 2)           // delete seconds 10–12
a.insert(intro, 0)        // prepend another audio instance
a.insert(3)               // append 3s silence (number = seconds of silence)
a.insert(3, 0)            // prepend 3s silence
a.repeat(2)               // double the audio
```

### Sample — transform values

```js
a.gain(-3)                // reduce by 3dB
a.gain(6, 10, 5)          // boost 6dB from 10s for 5s

a.fade(0.5)               // fade in first 0.5s (positive = from start)
a.fade(-1)                // fade out last 1s (negative = from end)
a.fade(-1, 'exp')         // fade out, exponential curve

a.reverse()               // reverse entire audio
a.reverse(5, 2)           // reverse 2s starting at 5s

a.mix(other)              // overlay other audio
a.mix(other, 10, 5)       // overlay at 10s for 5s

a.write([left, right], 2) // overwrite from 2s with PCM data

a.remix(1)                // stereo → mono
a.remix(2)                // mono → stereo
```

### Analysis — scan then transform

```js
a.trim()                  // remove silence from edges (auto threshold)
a.trim(-30)               // custom threshold in dB

a.normalize()                        // normalize to 0dBFS (peak mode)
a.normalize('streaming')             // -14 LUFS (YouTube, Spotify, Apple Music)
a.normalize('podcast')               // -16 LUFS
a.normalize('broadcast')             // -23 LUFS (EBU R128)
a.normalize(-14, 'lufs')             // explicit LUFS target
```

These ops need the full audio to analyze before transforming (find peak, detect silence). They're regular processors — same contract as `gain` or `fade` — but can't be streamed per-chunk.

### Inline — one-off processing via `.apply()`

`.apply()` accepts edit objects (from undo/serialization) and/or inline processor functions. Each argument becomes one edit.

```js
// Processor function — receives all channels, returns modified
a.apply((channels, ctx) => {
  for (let ch of channels)
    for (let i = 0; i < ch.length; i++)
      ch[i] *= 0.5
  return channels
})

// Return false to skip (no-op)
a.apply((channels) => {
  if (isSilent(channels)) return false
  return channels
})

// Mix edit objects and functions
a.apply(
  { type: 'trim', args: [-30] },
  (channels) => lowpass(channels, 2000),
  { type: 'normalize', args: [0] }
)

// Re-apply undone edits
let edit = a.undo()
a.apply(edit)
```

## Output

```js
// PCM — Float32Array[] channels
let pcm = await a.read()
let pcm = await a.read(5, 2)                   // 2s from 5s

// Typed PCM
let raw = await a.read(0, 1, { format: 'int16' })

// Encoded
let wav = await a.read({ format: 'wav' })       // Uint8Array
let mp3 = await a.read({ format: 'mp3' })

// Save — format from extension
await a.save('out.wav')
await a.save('out.mp3')
```

## Analysis

Individual stat methods + `peaks()` for waveform visualization. All async — instant from index when clean, materializes dirty blocks when needed. All support `(offset?, duration?)` for sub-range.

```js
// Measurement — individual stat methods
await a.db()                   // peak in dBFS
await a.rms()                  // RMS level
await a.loudness()             // integrated LUFS (BS.1770, K-weighted)

await a.db(10, 5)             // peak for 10s–15s
await a.rms(10, 5)            // RMS for 10s–15s

// Visualization — downsampled waveform
let w = await a.peaks(800)              // 800-point {min, max}
let l = await a.peaks(800, { channel: 0 })  // per-channel
```

## Playback

`play()` returns an independent controller. Multiple controllers play simultaneously. Node uses `audio-speaker`; browser uses Web Audio API.

```js
let p = a.play()              // play from start
let p = a.play(10, 5)         // play 5s from 10s

p.pause()
p.stop()

p.currentTime                  // seconds (get/set)
p.playing                      // boolean
p.ontimeupdate = (t) => {}
p.onended = () => {}

// Parallel playback
let p1 = a.play(0)
let p2 = a.play(30)           // both play at once
```

## Streaming

Async iterator over materialized blocks — one page at a time, ops applied.

```js
for await (let block of a.stream()) {
  // block: Float32Array[] — channels for one page
  process(block)
}

// Sub-range
for await (let block of a.stream(10, 5)) { ... }
```

## History

The audio instance is serializable. `toJSON()` returns `{ source, edits, sampleRate, channels, duration }` — enough to fully restore from the original source.

```js
a.undo()                       // pop last edit

// Serialize
let json = JSON.stringify(a)   // toJSON() called automatically

// Restore — reloads source, replays edits
let b = await audio(JSON.parse(json))
```

```js
a.version                      // monotonic counter
a.onchange = () => {}          // fires on edit/undo
a.source                       // original URL/path, or null for PCM
```

## Plugins

### Custom ops

Register via `audio.op(name, init)`. The init function takes params, returns a block processor. Fresh state per render.

```js
// Simple — no params
audio.op('invert', () => (block) => {
  for (let ch of block)
    for (let i = 0; i < ch.length; i++)
      ch[i] = -ch[i]
  return block
})
a.invert()
a.invert(2, 1)                 // range: 2s for 1s

// With params
audio.op('amplify', (factor) => (block) => {
  for (let ch of block)
    for (let i = 0; i < ch.length; i++)
      ch[i] *= factor
  return block
})
a.amplify(2)

// Stateful — filter memory in closure, fresh per render
audio.op('lowpass', (freq) => {
  let prev = 0
  return (block, ctx) => {
    let rc = 1 / (2 * Math.PI * freq)
    let dt = 1 / ctx.sampleRate
    let a = dt / (rc + dt)
    for (let ch of block)
      for (let i = 0; i < ch.length; i++)
        ch[i] = prev = prev + a * (ch[i] - prev)
    return block
  }
})
a.lowpass(2000)
```

A plugin is just a package that calls `audio.op()`:

```js
// audio-compress/index.js
import audio from 'audio'
audio.op('compress', (threshold, ratio) => {
  let env = 0
  return (block, ctx) => { /* ... */ return block }
})
```

```js
import 'audio-compress'
a.compress(-20, 4)
```

#### Op properties

Ops can declare optional properties on the init function to integrate with the engine:

| Property | Type | Purpose |
|----------|------|---------|
| `.plan` | `function` | Structural segment planning (enables streaming) |
| `.plan` | `false` | Cannot be streamed — needs full render |
| `.dur` | `function` | Declares how the op changes audio length |
| `.ch` | `function` | Declares how the op changes channel count |
| `.resolve` | `function` | Index-based resolution (avoids full render) |

Built-in ops use these — for example `crop` has `.dur` and `.plan`, `remix` has `.ch`, `trim` has `.plan = false`. Most ops need no properties at all.

### Custom stats

Extend the always-resident index with computed fields per block:

```js
audio.stat('rms', (channels) => channels.map(ch => {
  let sum = 0
  for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i]
  return Math.sqrt(sum / ch.length)
}))

a.stats.rms    // [Float32Array, ...] per-channel
```

Return `number[]` for per-channel values, `number` for cross-channel (broadcast to all channels).

## Recipes

### Convert format

```sh
audio in.mp3 -o out.wav
audio in.wav -o out.mp3
```

```js
let a = await audio('in.mp3')
await a.save('out.wav')
```

### Quick cleanup

```sh
audio raw.wav trim normalize fade 500ms fade -500ms -o clean.mp3
```

```js
let a = await audio('raw.wav')
a.trim().normalize().fade(0.5).fade(-0.5)
await a.save('clean.mp3')
```

### Extract segment

```sh
audio long.mp3 crop 30s..1m30s -o clip.wav     # keep 30s–90s
audio podcast.mp3 crop 5m..10m -o clip.wav     # keep 5m–10m
```

```js
let a = await audio('long.mp3')
a.crop(30, 60)                                 // keep 30s–90s
await a.save('clip.wav')
```

### Adjust volume

```sh
audio in.wav gain -3db -o quieter.wav
audio in.wav gain 6db -o louder.wav
```

```js
a.gain(-3)                                     // reduce 3 dB
a.gain(6)                                      // boost 6 dB
```

### Normalize for streaming

```sh
audio in.wav normalize streaming -o out.wav    # -14 LUFS (YouTube, Spotify)
audio in.wav normalize podcast -o out.wav      # -16 LUFS
audio in.wav normalize broadcast -o out.wav    # -23 LUFS (EBU R128)
```

```js
a.normalize('streaming')                       // -14 LUFS
a.normalize('podcast')                         // -16 LUFS
a.normalize('broadcast')                       // -23 LUFS (EBU R128)
```

### Join files

```js
let [a, b, c] = await Promise.all(['1.mp3', '2.mp3', '3.mp3'].map(f => audio(f)))
let joined = audio.concat(a, b, c)
await joined.save('full.wav')
```

### Stereo ↔ mono

```sh
audio stereo.wav remix 1 -o mono.wav
audio mono.wav remix 2 -o stereo.wav
```

```js
a.remix(1)                                     // stereo → mono
a.remix(2)                                     // mono → stereo
```

### Fade in / out

```sh
audio in.wav fade 1s fade -2s -o out.wav
audio in.wav fade 500ms fade -1500ms -o out.wav
```

```js
a.fade(1)                                      // 1s fade in
a.fade(-2)                                     // 2s fade out
a.fade(-1, 'exp')                              // exponential curve
```

### Measure audio

```sh
audio in.mp3 --stat
```

```js
let peak = await a.db()                        // peak dBFS
let rms  = await a.rms()                       // RMS level
let lufs = await a.loudness()                  // integrated LUFS
```

### Loop

```sh
audio loop.wav repeat 4 -o looped.wav
```

```js
a.repeat(4)
```

### Add silence

```js
a.insert(2, 0)                                // 2s at start
a.insert(3)                                   // 3s at end
```

### Reverse

```sh
audio in.wav reverse -o reversed.wav
```

```js
a.reverse()
```

### Podcast cleanup

```js
let a = await audio('raw-episode.wav')
a.trim(-30).normalize(-1).fade(1).fade(-2)
await a.save('episode.mp3')
```

### Waveform display

```js
// Progressive — render waveform as decode streams
let a = await audio('track.flac', {
  onprogress({ delta, offset, total }) {
    for (let i = 0; i < delta.min[0].length; i++) {
      let block = delta.fromBlock + i
      drawBar(block, delta.min[0][i], delta.max[0][i])
    }
  }
})

// Final waveform — downsampled to exact pixel count
let w = await a.peaks(canvas.width)
drawWaveform(w.min, w.max)
```

### Batch processing

```js
let recipe = [
  { type: 'trim', args: [-30] },
  { type: 'normalize', args: [0] },
  { type: 'fade', args: [0.5] },
  { type: 'fade', args: [-0.5] },
]

for (let file of files) {
  let a = await audio(file)
  a.apply(...recipe)
  await a.save(file.replace('.wav', '.mp3'))
}
```

### Multi-track mixing

```js
let tracks = await Promise.all(files.map(f => audio(f)))

tracks[0].gain(-3)
tracks[1].gain(-6).fade(2)

for (let t = 0; t < duration; t += 1) {
  let chunks = await Promise.all(tracks.map(tr => tr.read(t, 1)))
  output.write(mixdown(chunks))
}
```

## CLI

```sh
npx audio in.mp3 --stat                         # show info (duration, peak, loudness)
npx audio in.mp3 gain -3db trim normalize -o out.wav
npx audio in.wav --play                          # play to speakers
npx audio in.wav gain -3db 1s..10s -o out.wav    # range syntax
npx audio in.mp3 crop 1m30s..3m -o clip.wav      # compound durations
npx audio in.mp3 normalize streaming -o out.wav  # LUFS preset
cat in.wav | audio gain -3db > out.wav           # pipe stdin/stdout
```

Time units: `s`, `ms`, `m`, `h` — and compounds like `1m30s`, `2h20m`. Ranges: `30s..1m`, `5m..10m`.

Flags: `--play` / `-p` (play result), `--stat` (show audio info), `--force` / `-f` (overwrite output), `--verbose`, `-o` (output file), `--format` (override format).

## Ecosystem

| Package | Purpose |
|---------|---------|
| [audio-decode](https://github.com/audiojs/audio-decode) | Codec decoding (13+ formats, streaming) |
| [audio-encode](https://github.com/audiojs/audio-encode) | Codec encoding |
| [audio-type](https://github.com/nickolanack/audio-type) | Audio format detection |
| [audio-filter](https://github.com/audiojs/audio-filter) | Audio filters (K-weighting, EQ, etc.) |
| [pcm-convert](https://github.com/nickolanack/pcm-convert) | PCM format conversion |
| [audio-speaker](https://github.com/nickolanack/audio-speaker) | Audio output (Node) |
| [audio-mic](https://github.com/nickolanack/audio-mic) | Microphone input |

## Architecture

### File structure

```
audio.js         Entry — imports core + all ops + stats, registers them. Thin.
core.js          Engine — decode, pages, index, render, playback, proto.
op/
  plan.js          Plan utilities — segment operations for structural ops
  crop.js          Structural ops — reshape timeline, declare .plan and .dur
  remove.js
  insert.js
  repeat.js
  reverse.js
  gain.js          Sample ops — transform values per-chunk
  fade.js
  mix.js
  write.js
  remix.js         Channel op — declares .ch
  trim.js          Analysis ops — need full render (.plan = false)
  normalize.js
stat/
  min.js           Per-block stats — pluggable via audio.stat(name, fn)
  max.js
  energy.js
  db.js
  rms.js
  loudness.js
  peaks.js
```

Three import paths:

```js
import audio from 'audio'           // full bundle — all 12 built-in ops
import audio from 'audio/core'      // bare engine — no ops, register your own
import gain from 'audio/op/gain.js' // individual op
```

Ops don't import from core — structural ops use `op/plan.js` for plan utilities.

### Op contract

Every op follows one pattern — `audio.op(name, init)`:

```
init(params...) → processor(channels, ctx) → channels | false
```

`init` takes user parameters (dB, seconds, etc.) and returns a processor function. The processor receives `Float32Array[]` channels and a context `{ offset, duration, sampleRate, blockOffset }`, and returns transformed channels (or `false` to skip).

Ops that affect metadata declare properties on the init function:

```
.plan     function → structural (segment planner for streaming)
          false    → needs full PCM, can't stream (eg. trim, normalize)
.dur      function → changes audio length (crop, remove, insert, repeat)
.ch       function → changes channel count (remix)
.resolve  function → index-based resolution (avoids full render)
```

Core reads these properties — no op names are hardcoded in the engine.

### Data flow

```
source (file/URL/bytes)
  │
  ▼
┌─────────────────────────────────────────┐
│ Decode — chunked streaming (WASM)       │
│ Index built per page during decode      │
└──────────┬──────────────────┬───────────┘
           │                  │
           ▼                  ▼
    ┌────────────┐    ┌──────────────┐
    │ Pages      │    │ Index        │
    │ 64K-sample │    │ per-block    │
    │ evictable  │    │ min/max/     │
    │ to OPFS    │    │ K-energy     │
    └──────┬─────┘    └──────┬───────┘
           │                 │
           ▼                 ▼
      ┌──────────────────────────┐
      │ Edit List                │
      │ append-only, lazy, undo  │
      └────────────┬─────────────┘
                   │
      ┌────────────┴─────────────┐
      │ Read Plan                │
      │ structural → segment map │
      │ sample → pipeline        │
      └────┬─────────┬──────┬───┘
           ▼         ▼      ▼
       .read()  .stream()  .play()
```

**Pages** — Source PCM in 64K-sample chunks. Large files auto-evict to OPFS and restore on demand, keeping memory bounded. Pages from `audio.from()` are subarray views (zero-copy).

**Index** — Built incrementally during decode: per-channel, per-block (1024 samples) min/max/energy. Energy is K-weighted (BS.1770) for LUFS measurement. Powers `db()`, `rms()`, `loudness()`, and `peaks()` without touching PCM. Extensible via `audio.stat()`.

**Edit list** — All ops push to an append-only list. Source pages are never mutated. Edits are serializable (`toJSON`), replayable (`apply`), undoable (`undo`).

**Read plan** — On output, edits compile to a read plan. Structural ops (those with `.plan`) produce a segment map. Sample ops form a per-chunk pipeline. `read()`, `stream()`, and `play()` walk the plan — no full materialization unless an op requires it (`.plan = false`).

**Storage** — `audio(file, { storage })` controls paging: `'auto'` (default) uses OPFS when available and needed, `'persistent'` requires OPFS, `'memory'` forces in-memory.

## License

<p align=center><a href="./LICENSE">MIT</a> <a href="https://github.com/krishnized/license/">ॐ</a></p>
