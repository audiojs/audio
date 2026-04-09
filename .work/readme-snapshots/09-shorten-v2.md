# audio [![test](https://github.com/audiojs/audio/actions/workflows/test.yml/badge.svg)](https://github.com/audiojs/audio/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/audio)](https://npmjs.org/package/audio)

Audio in JavaScript. Load, edit, play, analyze, save — any format, streaming, non-destructive, scriptable.

```
npm i audio
```

```js
import audio from 'audio'

let a = await audio('voice.mp3')
a.trim().normalize('podcast').fade(0.3, 0.5)
await a.save('clean.wav')
```

```sh
npx audio voice.mp3 trim normalize podcast fade 0.3s -0.5s -o clean.wav
```

## Examples

### Clean up a recording

```js
let a = await audio('raw-take.wav')
a.trim(-30).normalize('podcast').fade(0.3, 0.5)
await a.save('clean.wav')
```

### Render a waveform

```js
let a = await audio('track.mp3')
let [mins, peaks] = await a.stat(['min', 'max'], { bins: canvas.width })
for (let i = 0; i < peaks.length; i++)
  ctx.fillRect(i, h/2 - peaks[i] * h/2, 1, (peaks[i] - mins[i]) * h/2)
```

### Progressive waveform (stream as it decodes)

```js
let a = audio('long.flac')
a.on('data', ({ delta }) => appendBars(delta.max[0], delta.min[0]))
await a
```

### Record from mic

```js
let a = audio()
a.record()
await new Promise(r => setTimeout(r, 5000))
a.stop()
a.trim().normalize()
await a.save('recording.wav')
```

### Podcast montage

```js
let intro = await audio('intro.mp3')
let body  = await audio('interview.wav')
let outro = await audio('outro.mp3')

body.trim().normalize('podcast')
let ep = audio([intro, body, outro])
ep.fade(0.5, 2)
await ep.save('episode.mp3')
```
```sh
npx audio intro.mp3 + interview.wav + outro.mp3 trim normalize podcast fade 0.5s -2s -o episode.mp3
```

### Voiceover on music

```js
let music = await audio('bg.mp3')
let voice = await audio('narration.wav')
music.gain(-12).mix(voice, { at: 2 })
await music.save('mixed.wav')
```

### Split a long file

```js
let a = await audio('audiobook.mp3')
let [ch1, ch2, ch3] = a.split(1800, 3600)
for (let [i, ch] of [ch1, ch2, ch3].entries())
  await ch.save(`chapter-${i + 1}.mp3`)
```

### Generate a tone

```js
let a = audio.from(t => Math.sin(440 * Math.PI * 2 * t), { duration: 2 })
await a.save('440hz.wav')
```

### Extract features for ML

```js
let a = await audio('speech.wav')
let mfcc = await a.stat('cepstrum', { bins: 13 })
let spec = await a.stat('spectrum', { bins: 128 })
let [loud, rms] = await a.stat(['loudness', 'rms'])
```

### Batch normalize

```sh
npx audio '*.wav' trim normalize podcast -o '{name}.clean.{ext}'
```

### Custom op

```js
audio.op('crush', (chs, ctx) => {
  let steps = 2 ** (ctx.args[0] ?? 8)
  return chs.map(ch => ch.map(s => Math.round(s * steps) / steps))
})

a.crush(4)
```

### Serialize and restore

```js
let json = JSON.stringify(a)             // { source, edits, ... }
let b = await audio(JSON.parse(json))    // re-decode + replay edits
```

[More recipes →](docs/recipes.md) — sonification, sidechain, glitch, ringtone, playback, custom ops, stdin/stdout piping, and more.

## CLI

```sh
npx audio in.mp3                                 # open player
npx audio in.mp3 -p                              # autoplay
npx audio in.mp3 -i                              # file info
npx audio in.mp3 gain -3db trim normalize -o out.wav
npx audio in.wav gain -3db 1s..10s -o out.wav    # range
npx audio in.mp3 highpass 80hz lowshelf 200hz -3db -o out.wav
npx audio '*.wav' gain -3db -o '{name}.out.{ext}'  # batch
npx audio in.wav --macro recipe.json -o out.wav
npx audio gain --help                            # per-op help
cat in.wav | audio gain -3db > out.wav           # stdin/stdout
```

Ranges: `1s..10s`, `30s..1m`, `-1s..`. Units: `s`, `ms`, `m`, `h`, `db`, `hz`, `khz`.

Flags: `-i` info, `-p` play, `-f` force, `--verbose`, `--format`, `-o` output, `--macro`.

Tab completion:

```sh
eval "$(audio --completions zsh)"       # add to ~/.zshrc
eval "$(audio --completions bash)"      # add to ~/.bashrc
audio --completions fish | source       # fish
```

## Quick reference

```js
// Create
let a = audio('file.mp3')                // sync — thenable, edits chain before decode
let a = await audio('file.mp3')          // wait for full decode
let a = await audio(url)                 // URL string or URL object
let a = await audio(uint8array)          // encoded bytes
let a = audio([a, b])                    // concat
let a = audio.from([left, right])        // wrap Float32Array[] — no decode
let a = audio.from(3, { channels: 2 })  // silence
let a = audio.from(t => Math.sin(440 * TAU * t), { duration: 1 })
let a = audio()                          // pushable — .push(), .record(), .stop()
let a = await audio.open('file.mp3')     // async — resolves on metadata, decode continues

// Properties
a.sampleRate  a.channels  a.duration  a.length  a.source
a.pages  a.stats  a.edits  a.ready  a.version
a.currentTime  a.playing  a.paused  a.recording  a.volume  a.loop  a.block

// Structural ops
a.crop({at, duration})  a.remove({at, duration})  a.insert(src, {at})
a.repeat(n)  a.pad(before, after?)  a.speed(rate)  a.reverse({at?, duration?})
a.split(t1, t2, ...)  a.view({at, duration})  a.concat(b, c)

// Sample ops — all accept {at, duration, channel}
a.gain(-3)  a.gain(t => -3 * t)  a.gain(0.5, {unit: 'linear'})
a.fade(0.5, 1)  a.fade(-1, 'exp')
a.mix(other, {at})  a.write(data, {at})  a.remix(channels)  a.pan(value)

// Smart ops
a.trim()  a.trim(-30)
a.normalize()  a.normalize('podcast')  a.normalize('streaming')  a.normalize('broadcast')
a.normalize({mode: 'lufs', target: -14})  a.normalize({mode: 'rms', target: -18})

// Filters
a.highpass(80)  a.lowpass(8000)  a.bandpass(1000, 2000)  a.notch(60)
a.lowshelf(200, -3)  a.highshelf(8000, 2)  a.eq(1000, 3, 2)

// I/O
await a.read()  await a.read({at, duration, channel, format})
await a.save('out.mp3')
for await (let block of a.stream()) { ... }

// Playback
a.play()  a.play({at, duration, volume, loop})
a.pause()  a.resume()  a.stop()  a.seek(30)

// Recording
a.record()  a.stop()
a.push(float32)  a.push(int16arr, 'int16')

// Analysis
await a.stat('db')  await a.stat('rms')  await a.stat('loudness')
await a.stat('clip')  await a.stat('dc')  await a.stat('silence')
await a.stat('max', {bins: 800})  await a.stat('spectrum', {bins: 128})
await a.stat('cepstrum', {bins: 13})
let [mn, mx] = await a.stat(['min', 'max'], {bins: 800})

// Events
a.on('change', fn)  a.on('data', fn)  a.on('timeupdate', fn)
a.on('ended', fn)  a.on('progress', fn)  a.off(name, fn)  a.dispose()

// History
a.undo()  a.run(edit1, edit2)
JSON.stringify(a)  // serialize
await audio(JSON.parse(json))  // restore

// Custom
audio.op('name', processFn)  // register op
audio.stat('name', { block, reduce })  // register stat
a.transform((chs, ctx) => chs)  // inline op
```

## Docs

| | |
|-|-|
| [Reference](docs/reference.md) | Full API — create, properties, edit ops, I/O, analysis, events, CLI, browser setup |
| [Architecture](docs/architecture.md) | Stream-first design, pages & blocks, non-destructive editing, plan compilation |
| [Recipes](docs/recipes.md) | All examples with JS + CLI pairs — montage, waveform, ML, glitch, streaming, etc. |
| [Plugins](docs/plugins.md) | Custom ops, stats, descriptors (process, plan, resolve, call), persistent ctx |

## Browser

Pre-built ESM bundles in `dist/`:

| File | Size | Use |
|------|------|-----|
| `audio.min.js` | 65K | Core + codec dispatch. Codecs load on demand via `import()`. |
| `audio.js` | 118K | Same, unminified. |
| `audio.all.js` | 10M | Everything bundled. Zero-config. |

Quick start — single script, no build step:

```html
<script type="module">
  import audio from './dist/audio.all.js'
  let a = await audio('./song.mp3')
  a.play()
</script>
```

Production — slim bundle + import map. Only mapped codecs get downloaded, on first use:

```html
<script type="importmap">
{
  "imports": {
    "@audio/decode-wav": "https://esm.sh/@audio/decode-wav",
    "mpg123-decoder":    "https://esm.sh/mpg123-decoder"
  }
}
</script>
<script type="module">
  import audio from './dist/audio.min.js'
  let a = await audio('./voice.wav')
</script>
```

<details><summary>All codec packages</summary>

```html
<script type="importmap">
{
  "imports": {
    "mpg123-decoder": "https://esm.sh/mpg123-decoder",
    "@wasm-audio-decoders/flac": "https://esm.sh/@wasm-audio-decoders/flac",
    "ogg-opus-decoder": "https://esm.sh/ogg-opus-decoder",
    "@wasm-audio-decoders/ogg-vorbis": "https://esm.sh/@wasm-audio-decoders/ogg-vorbis"
  }
}
</script>
```

**Decoders** (used by `audio-decode`):

| Format | Package |
|--------|---------|
| WAV | `@audio/decode-wav` |
| MP3 | `mpg123-decoder` |
| FLAC | `@wasm-audio-decoders/flac` |
| Opus | `ogg-opus-decoder` |
| Vorbis | `@wasm-audio-decoders/ogg-vorbis` |
| AAC/M4A | `@audio/decode-aac` |
| AIFF | `@audio/decode-aiff` |
| CAF | `@audio/decode-caf` |
| WebM | `@audio/decode-webm` |
| AMR | `@audio/decode-amr` |
| WMA | `@audio/decode-wma` |
| QOA | `qoa-format` |

**Encoders** (used by `encode-audio`):

| Format | Package |
|--------|---------|
| WAV | `@audio/encode-wav` |
| MP3 | `@audio/encode-mp3` |
| FLAC | `@audio/encode-flac` |
| Opus | `@audio/encode-opus` |
| OGG | `@audio/encode-ogg` |
| AIFF | `@audio/encode-aiff` |

</details>

## Ecosystem

| Package | Purpose |
|---------|---------|
| [audio-decode](https://github.com/audiojs/audio-decode) | Codec decoding (13+ formats) |
| [encode-audio](https://github.com/audiojs/audio-encode) | Codec encoding |
| [audio-filter](https://github.com/audiojs/audio-filter) | Filters (weighting, EQ, auditory) |
| [audio-speaker](https://github.com/audiojs/audio-speaker) | Audio output (Node) |
| [audio-type](https://github.com/nickolanack/audio-type) | Format detection |
| [pcm-convert](https://github.com/nickolanack/pcm-convert) | PCM format conversion |

<p align="center"><a href="./license.md">MIT</a> · <a href="https://github.com/krishnized/license">ॐ</a></p>
