# audio [![test](https://github.com/audiojs/audio/actions/workflows/test.yml/badge.svg)](https://github.com/audiojs/audio/actions/workflows/test.yml)

Indexed, paged audio document with immutable source and declarative ops.

```js
import audio from 'audio'

let a = await audio('file.mp3')
a.gain(-3).trim().normalize()
await a.save('out.wav')
```

## Install

```sh
npm i audio
```

## API

### Create

```js
// Async — decode from file, URL, ArrayBuffer, Uint8Array
let a = await audio('file.mp3')
let b = await audio('file.mp3', {
  onprogress({ delta, offset, total }) {}   // progressive index as decode streams
})

// Sync — from PCM data, AudioBuffer, or silence
let c = audio.from([ch1, ch2])              // Float32Array[] channels
let d = audio.from(3, { channels: 2 })     // seconds of silence
let e = audio.from(audioBuffer)             // AudioBuffer
```

### Ops

All ops are sync, chainable, and queue to the edit list.

```js
// Structural — reorganize timeline
a.slice(offset, duration)     // → new audio (shares source)
a.insert(other, offset?)
a.remove(offset, duration)
a.pad(duration, {side:'end'})
a.repeat(times)

// Sample — transform values
a.gain(db, offset?, duration?)
a.fade(duration)              // +seconds = in, -seconds = out
a.reverse(offset?, duration?)
a.mix(other, offset?, duration?)
a.write(data, offset?)

// Smart — analyze index, then queue basic op
a.trim(threshold?)            // → scans index → slice()
a.normalize(targetDb?)        // → reads peak → gain()
```

### Inline Processing

`do()` accepts edit objects, functions, or both — variadic:

```js
// Inline function — one-off block processor
a.do((block, ctx) => {
  for (let ch of block) for (let i = 0; i < ch.length; i++) ch[i] *= 0.5
  return block
})

// Return false to stop early (eg. process until silence)
a.do((block) => {
  if (isSilent(block)) return false   // stop processing
  return applyFilter(block)
})

// Mix edits and functions in one call
a.do(
  { type: 'trim' },
  (block) => lowpass(block, 2000),
  { type: 'normalize' }
)
```

### Plugins

Register named ops via `audio.op(name, init)`. The init function takes params, returns a block processor:

```js
// No params — init returns processor directly
audio.op('invert', () => (block) => {
  for (let ch of block) for (let i = 0; i < ch.length; i++) ch[i] = -ch[i]
  return block
})
a.invert()
a.invert(2, 1)         // apply to range 2s..3s

// With params — closed over, available to every block
audio.op('amplify', (factor) => (block) => {
  for (let ch of block) for (let i = 0; i < ch.length; i++) ch[i] *= factor
  return block
})
a.amplify(2)

// Stateful — init creates fresh state per render (filter memory, etc.)
audio.op('lowpass', (freq) => {
  let prev = 0                  // state between blocks
  return (block, ctx) => {
    let rc = 1 / (2 * Math.PI * freq)
    let dt = 1 / ctx.sampleRate
    let a = dt / (rc + dt)
    for (let ch of block) for (let i = 0; i < ch.length; i++) ch[i] = prev = prev + a * (ch[i] - prev)
    return block
  }
})
a.lowpass(2000)
```

A plugin is just a package that calls `audio.op()`:

```js
// audio-compress/index.js
import audio from 'audio'
audio.op('compress', (threshold, ratio) => (block, ctx) => { ... })
```

```js
import 'audio-compress'
a.compress(-20, 4)
```

### Macros

Edits are serializable. `toJSON()` exports them, `do()` replays:

```js
// Save a processing recipe
let recipe = a.gain(-3).trim().normalize().toJSON().edits

// Apply to another file
let b = await audio('other.mp3')
b.do(...recipe)
await b.save('processed.wav')
```

### Output

```js
let pcm = await a.read()                         // Float32Array[] (PCM)
let pcm = await a.read(offset, duration)          // sub-range
let pcm = await a.read(0, 1, {format: 'int16'})   // PCM format conversion
let wav = await a.read({format: 'wav'})           // Uint8Array (encoded)
let mp3 = await a.read({format: 'mp3'})           // encode to any format
await a.save('out.mp3')                           // encode + write (format from ext)
```

### Analysis

```js
await a.limits(offset?, duration?)    // {min, max}
await a.loudness(offset?, duration?)  // LUFS
await a.peaks(count)                  // {min: Float32Array, max: Float32Array}
await a.peaks(100, {channel: 0})      // per-channel
```

### Playback

```js
let p = a.play(offset?, duration?)
p.pause()
p.stop()
p.currentTime          // seconds (get/set)
p.playing              // boolean
p.ontimeupdate = t => {}
p.onended = () => {}
```

### Streaming

```js
for await (let block of a.stream(offset?, duration?)) {
  // block: Float32Array[] per page
}
```

### Properties

```js
a.duration       // seconds
a.channels       // number
a.sampleRate     // Hz
a.length         // total samples
a.edits          // edit list (inspectable)
a.version        // increments on edit/undo
a.onchange       // callback
```

### History

```js
a.undo()                // pop last edit, returns it
a.do(edit)              // push edit (re-apply, replay macro, inline fn)
a.do(...edits)          // variadic — multiple edits at once
a.toJSON()              // serialize edits
```

### Index

Always-resident summaries built during decode. Powers analysis and waveform display without loading PCM.

```js
a.index.blockSize   // 1024
a.index.min         // [Float32Array, ...] per-channel, per-block
a.index.max
a.index.energy      // mean square energy per block (for loudness)
```

## Physical Units

All parameters in physical quantities. No samples or indices in the public API.

- **Time**: seconds (float)
- **Amplitude**: dB
- **Frequency**: Hz
- **Loudness**: LUFS

## Ecosystem

| Package | Purpose |
|---------|---------|
| [audio-decode](https://github.com/audiojs/audio-decode) | Codec decoding (13+ formats) |
| [audio-encode](https://github.com/audiojs/audio-encode) | Codec encoding |
| [audio-buffer](https://github.com/audiojs/audio-buffer) | Standalone AudioBuffer |
| [audio-mic](https://github.com/nickolanack/audio-mic) | Microphone input |
| [audio-speaker](https://github.com/nickolanack/audio-speaker) | Audio output |

## License


<p align=center><a href="./LICENSE">MIT</a> • <a href="https://github.com/krishnized/license/">ॐ</a></p>
