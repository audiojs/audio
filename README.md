# audio [![test](https://github.com/audiojs/audio/actions/workflows/test.yml/badge.svg)](https://github.com/audiojs/audio/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/audio)](https://npmjs.org/package/audio)

High-level audio manipulations in JavaScript. Load, edit, save, play, analyze audio.

```js
import audio from 'audio'

let a = await audio('voice.mp3')
a.trim().normalize().fade(0.5).fade(-0.5)
await a.save('clean.wav')
```

```sh
npm i audio
```

<table><tr><td valign="top">

**[Create](#create)**<br>
<sub>[audio()](#create) · [audio.open()](#audioopensouce-opts) · [audio.from()](#audiofromsource-opts) · [audio.record()](#audiorecordopts) · [audio.concat()](#audioconcatsources)</sub>

**[Properties](#properties)**

**[Ops](#ops)**<br>
<sub>[crop](#structural) · [remove](#structural) · [insert](#structural) · [repeat](#structural) · [pad](#structural) · [split](#structural) · [view](#structural) · [gain](#sample) · [fade](#sample) · [reverse](#sample) · [mix](#sample) · [write](#sample) · [remix](#sample) · [pan](#sample) · [trim](#smart) · [normalize](#smart) · [apply](#inline)</sub>

**[Filter](#filter)**<br>
<sub>[highpass](#filter) · [lowpass](#filter) · [bandpass](#filter) · [notch](#filter) · [lowshelf](#filter) · [highshelf](#filter) · [eq](#filter)</sub>

</td><td valign="top">

**[I/O](#io)**<br>
<sub>[read](#io) · [save](#io) · [stream](#io)</sub>

**[Analysis](#analysis)**<br>
<sub>[stat](#analysis)</sub>

**[Playback](#playback)**<br>
<sub>[play](#playback) · [pause](#playback) · [stop](#playback)</sub>

**[History](#history)** · **[Plugins](#plugins)** · **[CLI](#cli)**

</td></tr></table>

All parameters use physical units: **seconds**, **dB**, **Hz**, **LUFS**. No sample indices in the public API.


## Create

**`audio(source, opts?)`** — async. Decodes encoded audio, returns a Promise.

```js
let a = await audio('file.mp3')          // file path (Node)
let b = await audio(url)                  // URL string or URL object
let c = await audio(uint8array)           // encoded bytes
let d = await audio([a, b])              // concat from array

// progressive decode — streams stats as pages decode
let e = await audio('long.flac', {
  onprogress({ delta, offset, total }) {
    appendWaveform(delta.min, delta.max)
  }
})
```

**`audio.from(source, opts?)`** — sync. Wraps existing PCM. No decode, no I/O.

```js
let f = audio.from([left, right])         // Float32Array[] channels
let g = audio.from(3, { channels: 2 })   // 3 seconds of silence
let h = audio.from(audioBuffer)           // Web Audio AudioBuffer
let i = audio.from(i => Math.sin(440 * TAU * i / sr), { duration: 1 })  // function source
let j = audio.from(int16arr, { format: 'int16' })  // typed array with format conversion
```

**`audio.open(source, opts?)`** — async. Starts streaming decode, returns instance immediately. Pages and stats arrive progressively. Use `.loaded` to await full decode.

```js
let a = await audio.open('long.flac')  // instance available immediately
drawWaveform(a)                        // partial stats already usable
await a.loaded                         // wait for full decode
```

**`audio.record(opts?)`** — push-based recording. Feed PCM chunks, stop when done.

```js
let a = audio.record({ sampleRate: 44100, channels: 1 })
a.push(float32chunk)                   // feed PCM data
a.push(anotherChunk)
a.stop()                               // finalize — stats computed
```

**`audio.concat(...sources)`** — joins audio instances end-to-end.

```js
let k = audio.concat(a, b)
```

`audio.version` — package version string.

Encoded sources are paged (64K-sample chunks, evictable to OPFS for large files). PCM sources via `audio.from()` are always resident.


## Properties

```js
a.sampleRate               // Hz (44100, 48000, …)
a.channels                 // effective channel count
a.duration                 // seconds (reflects edits)
a.length                   // samples (reflects edits)
a.source                   // original path/URL or null
a.pages                    // Float32Array[][] — decoded PCM
a.stats                    // per-block stats (min/max/energy/…)
a.edits                    // edit list (inspectable)
a.decoded                  // true when source fully decoded
a.cursor                   // playback hint — preloads nearby pages
```


## Ops

All ops are sync, chainable, non-destructive. They push to the edit list — source pages are never mutated.

All sample ops accept `{at, duration, channel}` options:

```js
a.gain(-3, {at: 1, duration: 5})       // 1s–6s only
a.gain(-6, {channel: 0})               // left channel only
a.gain(-6, {channel: [0, 1]})          // specific channels
```

### Structural

```js
a.crop({at: 1, duration: 5})       // keep seconds 1–6
a.remove({at: 10, duration: 2})    // delete seconds 10–12
a.insert(intro, {at: 0})           // prepend another audio
a.insert(3)                        // append 3s silence
a.repeat(2)                        // double the audio
a.pad(1)                           // 1s silence both ends
a.pad(0.5, 2)                      // 0.5s before, 2s after

a.split(30, 60)                    // split into views at 30s, 60s (zero-copy)
a.view({at: 10, duration: 5})      // shared-page view of 10s–15s
```

### Sample

```js
a.gain(-3)                         // reduce by 3dB
a.gain(6, {at: 10, duration: 5})   // boost 6dB from 10s for 5s
a.gain(t => -3 * t)                // automation: ramp down over time

a.fade(0.5)                        // fade in first 0.5s
a.fade(-1)                         // fade out last 1s
a.fade(-1, 'exp')                  // exponential curve

a.reverse()                        // reverse entire audio
a.reverse({at: 5, duration: 2})    // reverse 2s range
a.mix(other, {at: 10, duration: 5})// overlay at 10s for 5s
a.write([left, right], {at: 2})    // overwrite from 2s

a.remix(1)                         // stereo → mono
a.remix(2)                         // mono → stereo

a.pan(-0.5)                        // pan left (stereo balance)
a.pan(t => Math.sin(t))            // automation: oscillating pan
```

### Smart

Scan stats, then transform:

```js
a.trim()                             // remove silence from edges
a.trim(-30)                          // custom threshold in dB

a.normalize()                        // peak 0 dBFS
a.normalize('streaming')             // -14 LUFS (YouTube, Spotify)
a.normalize('podcast')               // -16 LUFS
a.normalize('broadcast')             // -23 LUFS (EBU R128)
a.normalize(-14, 'lufs')             // explicit target
```

### Run

```js
// apply edit objects directly
a.run(
  { type: 'trim', args: [-30] },
  { type: 'gain', args: [-3], at: 0.5, duration: 1 },
  { type: 'normalize', args: [0] }
)

// re-apply undone edits
let edit = a.undo()
a.run(edit)
```

### Transform

```js
// inline per-chunk transform
a.transform((channels, ctx) => {
  for (let ch of channels)
    for (let i = 0; i < ch.length; i++) ch[i] *= 0.5
  return channels
})
```


## Filter

Built-in filters via [audio-filter](https://github.com/audiojs/audio-filter). Stateful across streaming chunks.

```js
a.highpass(80)                       // Hz
a.lowpass(8000)
a.bandpass(1000, 2000)               // center, bandwidth
a.notch(60)                          // remove hum

a.lowshelf(200, -3)                  // Hz, dB
a.highshelf(8000, 2)
a.eq(1000, 2, 3)                     // freq, Q, dB gain
```


## I/O

```js
let pcm = await a.read()                          // Float32Array[]
let pcm = await a.read({at: 5, duration: 2})      // 2s from 5s
let ch0 = await a.read({channel: 0})              // single channel
let raw = await a.read({at: 0, duration: 1, format: 'int16'})
let wav = await a.read({ format: 'wav' })          // Uint8Array
await a.save('out.mp3')

for await (let block of a.stream()) {              // async iterator
  process(block)                                   // Float32Array[] per page
}
```


## Analysis

All async, instant from stats when clean. `{at, duration}` for sub-range. `{bins}` for waveform data.

```js
await a.stat('db')                      // peak dBFS
await a.stat('rms')                     // RMS level
await a.stat('loudness')                // integrated LUFS (BS.1770)
await a.stat('clip')                    // clipped sample count
await a.stat('dc')                      // DC offset

await a.stat('spectrum', {bins: 128})   // mel spectrum (dB)
await a.stat('cepstrum', {bins: 13})    // MFCCs

let w = await a.stat('max', {bins: 800})// 800-point Float32Array for waveform
let m = await a.stat('min', {bins: 800, channel: [0, 1]})// per-channel
let c = await a.stat('max', {channel: 0})// single channel scalar
```


## Playback

Returns the instance. Node uses `audio-speaker`; browser uses Web Audio API.

```js
a.play()                               // play from start
a.play({at: 10, duration: 5})          // play 5s from 10s
a.play({volume: -6, loop: true})

a.pause()
a.resume()
a.stop()
a.seek(30)                              // jump to 30s
a.currentTime                           // seconds (read/write)
a.playing                               // boolean
a.paused                                // boolean
a.volume                                // dB (read/write, 0 = unity)
a.loop                                  // boolean (read/write)
a.ontimeupdate = (t) => {}
a.onended = () => {}
```


## History

Non-destructive. Serializable. Replayable.

```js
a.undo()

let json = JSON.stringify(a)          // toJSON() auto
let b = await audio(JSON.parse(json)) // restore from source + edits

a.version                      // monotonic counter
a.onchange = () => {}
```


## Plugins

### Custom ops

```js
audio.op.invert = (chs, ctx) => {
  let s = ctx.at != null ? Math.round(ctx.at * ctx.sampleRate) : 0
  let end = ctx.duration != null ? s + Math.round(ctx.duration * ctx.sampleRate) : chs[0].length
  return chs.map(ch => {
    let o = new Float32Array(ch)
    for (let i = s; i < end; i++) o[i] = -o[i]
    return o
  })
}
audio.use()                              // wires a.invert()

a.invert()
a.invert({at: 2, duration: 1})         // range: 2s for 1s
```

### Custom stats

```js
audio.stat.rms = () => (channels) => channels.map(ch => {
  let sum = 0
  for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i]
  return Math.sqrt(sum / ch.length)
})

a.stats.rms                    // [Float32Array, ...] per-channel
```


## CLI

```sh
npx audio in.mp3                                 # show info
npx audio in.mp3 gain -3db trim normalize -o out.wav
npx audio in.wav --play
npx audio in.wav gain -3db 1s..10s -o out.wav
npx audio in.mp3 normalize streaming -o out.wav
npx audio in.mp3 highpass 80hz lowshelf 200hz -3db -o out.wav
npx audio '*.wav' gain -3db -o '{name}.out.{ext}'  # batch
npx audio in.wav --macro recipe.json -o out.wav
npx audio gain --help                            # per-op help
cat in.wav | audio gain -3db > out.wav
```

Ranges: `1s..10s`, `30s..1m`, `-1s..`. Units: `s`, `ms`, `m`, `h`, `db`, `hz`, `khz`.

Flags: `--play` / `-p`, `--force` / `-f`, `--verbose`, `--format`, `-o`, `--macro FILE`.

Macro files are JSON arrays of edits: `[{"type": "gain", "args": [-3]}, {"type": "trim"}]`.

Plugins in `node_modules/audio-*` are auto-discovered at startup.


## Ecosystem

| Package | Purpose |
|---------|---------|
| [audio-decode](https://github.com/audiojs/audio-decode) | Codec decoding (13+ formats) |
| [audio-encode](https://github.com/audiojs/audio-encode) | Codec encoding |
| [audio-filter](https://github.com/audiojs/audio-filter) | Filters (weighting, EQ, auditory) |
| [audio-speaker](https://github.com/audiojs/audio-speaker) | Audio output (Node) |
| [audio-type](https://github.com/nickolanack/audio-type) | Format detection |
| [pcm-convert](https://github.com/nickolanack/pcm-convert) | PCM format conversion |


## Architecture

Four layers:

| Layer | Purpose | Files |
|-------|---------|-------|
| **Source** | Immutable backing — encoded file or PCM | `core.js` (decode) |
| **Stats** | Per-block measurements, always resident (~7MB for 2h stereo) | `stats.js` |
| **Pages** | Decoded PCM in 64K chunks, paged on demand, evictable | `cache.js` |
| **Edits** | Declarative op list — structural, sample, stat-conditioned | `history.js` |

`audio.js` is the entry point — registers all built-in ops, stats, and methods. `fn/` contains each op/stat as a plugin.

Any output (read, play, stream, save, stat) resolves the same pipeline:

```
source pages → segment map (structural ops) → sample pipeline (per-page) → output
```

Stats power waveform display and analysis without touching PCM. Stat-conditioned ops like `normalize` and `trim` resolve from stats at plan time — no extra render pass.

Three import paths:

```js
import audio from 'audio'            // full bundle
import audio from 'audio/core'       // bare engine — no ops
import gain from 'audio/fn/gain.js'  // individual plugin
```


<p align="center"><a href="./license.md">MIT</a> · <a href="https://github.com/krishnized/license">ॐ</a></p>
