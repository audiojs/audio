# audio [![test](https://github.com/audiojs/audio/actions/workflows/test.yml/badge.svg)](https://github.com/audiojs/audio/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/audio)](https://npmjs.org/package/audio)

Load, edit, save, play, analyze audio in JavaScript.

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
<sub>[audio()](#create) · [audio.open()](#audioopensouce-opts) · [audio.from()](#audiofromsource-opts) · [audio.concat()](#audioconcatsources)</sub>

**[Properties](#properties)**

**[Ops](#ops)**<br>
<sub>[crop](#structural) · [remove](#structural) · [insert](#structural) · [repeat](#structural) · [split](#structural) · [view](#structural) · [gain](#sample) · [fade](#sample) · [reverse](#sample) · [mix](#sample) · [write](#sample) · [remix](#sample) · [trim](#smart) · [normalize](#smart) · [apply](#inline)</sub>

**[Filter](#filter)**<br>
<sub>[highpass](#filter) · [lowpass](#filter) · [bandpass](#filter) · [notch](#filter) · [lowshelf](#filter) · [highshelf](#filter) · [eq](#filter)</sub>

</td><td valign="top">

**[I/O](#io)**<br>
<sub>[read](#io) · [save](#io) · [stream](#io)</sub>

**[Analysis](#analysis)**<br>
<sub>[db](#analysis) · [rms](#analysis) · [loudness](#analysis) · [clip](#analysis) · [dc](#analysis) · [peaks](#analysis)</sub>

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

// progressive decode — streams stats as pages decode
let d = await audio('long.flac', {
  onprogress({ delta, offset, total }) {
    appendWaveform(delta.min, delta.max)
  }
})
```

**`audio.from(source, opts?)`** — sync. Wraps existing PCM. No decode, no I/O.

```js
let e = audio.from([left, right])         // Float32Array[] channels
let f = audio.from(3, { channels: 2 })   // 3 seconds of silence
let g = audio.from(audioBuffer)           // Web Audio AudioBuffer
```

**`audio.open(source, opts?)`** — async. Starts streaming decode, returns instance immediately. Pages and stats arrive progressively. Use `.loaded` to await full decode.

```js
let a = await audio.open('long.flac')  // instance available immediately
drawWaveform(a)                        // partial stats already usable
await a.loaded                         // wait for full decode
```

**`audio.concat(...sources)`** — joins audio instances end-to-end.

```js
let h = audio.concat(a, b)
```

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
a.version                  // monotonic counter — increments on edit/undo
a.decoded                  // true when source fully decoded
a.onchange                 // callback — fires on edit/undo
a.cursor                   // playback hint — preloads nearby pages
```


## Ops

All ops are sync, chainable, non-destructive. They push to the edit list — source pages are never mutated.

### Structural

```js
a.crop(1, 5)              // keep seconds 1–6
a.remove(10, 2)           // delete seconds 10–12
a.insert(intro, 0)        // prepend another audio
a.insert(3)               // append 3s silence
a.repeat(2)               // double the audio

a.split(30, 60)           // split into views at 30s, 60s (zero-copy)
a.view(10, 5)             // shared-page view of 10s–15s
```

### Sample

```js
a.gain(-3)                // reduce by 3dB
a.gain(6, 10, 5)          // boost 6dB from 10s for 5s

a.fade(0.5)               // fade in first 0.5s
a.fade(-1)                // fade out last 1s
a.fade(-1, 'exp')         // exponential curve

a.reverse()               // reverse entire audio
a.mix(other, 10, 5)       // overlay at 10s for 5s
a.write([left, right], 2) // overwrite from 2s

a.remix(1)                // stereo → mono
a.remix(2)                // mono → stereo
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

### Inline

```js
a.apply((channels, ctx) => {
  for (let ch of channels)
    for (let i = 0; i < ch.length; i++) ch[i] *= 0.5
  return channels
})

// mix edit objects and functions
a.apply(
  { type: 'trim', args: [-30] },
  (channels) => process(channels),
  { type: 'normalize', args: [0] }
)
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
let pcm = await a.read()                        // Float32Array[]
let pcm = await a.read(5, 2)                    // 2s from 5s
let raw = await a.read(0, 1, { format: 'int16' })
let wav = await a.read({ format: 'wav' })        // Uint8Array
await a.save('out.mp3')

for await (let block of a.stream()) {            // async iterator
  process(block)                                 // Float32Array[] per page
}
```


## Analysis

All async, instant from stats when clean. Support `(offset?, duration?)` for sub-range.

```js
await a.db()                   // peak dBFS
await a.rms()                  // RMS level
await a.loudness()             // integrated LUFS (BS.1770)
await a.clip()                 // clipped sample count
await a.dc()                   // DC offset

let w = await a.peaks(800)     // 800-point {min, max} for waveform
```


## Playback

Returns independent controller. Node uses `audio-speaker`; browser uses Web Audio API.

```js
let p = a.play()              // play from start
let p = a.play(10, 5)         // play 5s from 10s

p.pause()
p.stop()
p.currentTime                  // get/set seconds
p.playing                      // boolean
p.ontimeupdate = (t) => {}
p.onended = () => {}
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
audio.op('invert', () => (block) => {
  for (let ch of block)
    for (let i = 0; i < ch.length; i++) ch[i] = -ch[i]
  return block
})

a.invert()
a.invert(2, 1)                 // range: 2s for 1s
```

### Custom stats

```js
audio.stat('rms', (channels) => channels.map(ch => {
  let sum = 0
  for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i]
  return Math.sqrt(sum / ch.length)
}))

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
cat in.wav | audio gain -3db > out.wav
```

Ranges: `1s..10s`, `30s..1m`, `-1s..`. Units: `s`, `ms`, `m`, `h`, `db`, `hz`, `khz`.

Flags: `--play` / `-p`, `--force` / `-f`, `--verbose`, `--format`, `-o`.


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

```
audio.js         Entry — registers all built-in ops, stats, methods
core.js          Engine — decode, pages, stats, render, proto
history.js       Non-destructive editing — edit list, undo, plan, streaming
cache.js         OPFS paging, eviction
stats.js         Block-level stat accumulation
fn/              All ops, stats, and methods as plugins
```

Three import paths:

```js
import audio from 'audio'            // full bundle
import audio from 'audio/core'       // bare engine — no ops
import gain from 'audio/fn/gain.js'  // individual plugin
```

Data flow:

```
source → decode → pages (64K, evictable) + stats (per-block, always resident)
                    ↓
              edit list (append-only, non-destructive)
                    ↓
              read plan (structural → segments, sample → pipeline)
                    ↓
              .read() / .stream() / .play()
```

Stats (~7MB for 2h stereo) power instant analysis without touching PCM. Extensible via `audio.stat()`.


<p align="center"><a href="./license.md">MIT</a> · <a href="https://github.com/krishnized/license">ॐ</a></p>
