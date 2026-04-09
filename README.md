# audio [![test](https://github.com/audiojs/audio/actions/workflows/test.yml/badge.svg)](https://github.com/audiojs/audio/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/audio)](https://npmjs.org/package/audio)

Audio in JavaScript. Load, edit, play, analyze, save — any format, streaming, non-destructive, scriptable.

```
npm i audio
```

```js
import audio from 'audio'
```

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

```
npx audio song.mp3
▶ 0:14:00 ━━━━━━━━━━━━━━━━━─────────────────────────────────── -0:29:06   ▁▂▃▄▅__
          ▅▇▇▇▇▇▇███▇▆▇▇▇▆▆▆▅▄▄▄▅▅▅▄▄▄▄▄▄▃▅▅ ▁▁▁▁▁
          50     500  1k     2k         5k        10k      20k

          48k   2ch   43:07   -0.8dBFS   -30.8LUFS
```

Space pause, arrows seek/volume, `l` loop, `q` quit.

```sh
# Basics
npx audio in.mp3                                 # open player
npx audio in.mp3 -p                              # autoplay
npx audio in.mp3 -i                              # file info
npx audio gain --help                            # per-op help

# Edit + save
npx audio in.mp3 gain -3db trim normalize -o out.wav
npx audio in.wav gain -3db 1s..10s -o out.wav    # range
npx audio in.mp3 highpass 80hz lowshelf 200hz -3db -o out.wav

# Clean up a recording
npx audio raw-take.wav trim -30db normalize podcast fade 0.3s -0.5s -o clean.wav

# Podcast montage
npx audio intro.mp3 + interview.wav + outro.mp3 trim normalize podcast fade 0.5s -2s -o episode.mp3

# Voiceover on music
npx audio bg.mp3 gain -12db mix narration.wav 2s -o mixed.wav

# Split a long file
npx audio audiobook.mp3 split 30m 60m -o 'chapter-{i}.mp3'

# Generate a tone
npx audio --tone 440hz 2s -o 440hz.wav

# Analysis
npx audio speech.wav stat cepstrum --bins 13
npx audio speech.wav stat spectrum --bins 128
npx audio speech.wav stat loudness rms

# Batch
npx audio '*.wav' trim normalize podcast -o '{name}.clean.{ext}'
npx audio '*.wav' gain -3db -o '{name}.out.{ext}'
npx audio in.wav --macro recipe.json -o out.wav

# Stdin/stdout
cat in.wav | audio gain -3db > out.wav
curl -s https://example.com/speech.mp3 | npx audio normalize -o clean.wav
ffmpeg -i video.mp4 -f wav - | npx audio trim normalize podcast > voice.wav
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

// Properties
a.sampleRate  a.channels  a.duration  a.length  a.source
a.pages  a.stats  a.edits  a.ready  a.version
a.currentTime  a.playing  a.paused  a.recording  a.volume  a.loop  a.block

// Structural ops
a.crop({at, duration})  a.remove({at, duration})  a.insert(src, {at})
a.repeat(n)  a.pad(before, after?)  a.speed(rate)  a.reverse({at?, duration?})
a.split(t1, t2, ...)  a.view({at, duration})  a.concat(b, c)
a.trim()  a.trim(-30)

// Sample ops — all accept {at, duration, channel}
a.gain(-3)  a.gain(t => -3 * t)  a.gain(0.5, {unit: 'linear'})
a.fade(0.5, 1)  a.fade(-1, 'exp')
a.mix(other, {at})  a.write(data, {at})  a.remix(channels)  a.pan(value)
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

* [Reference](docs/reference.md) – full API: create, properties, edit ops, I/O, analysis, events, CLI, browser
* [Architecture](docs/architecture.md) – stream-first design, pages & blocks, non-destructive editing, plan compilation
* [Recipes](docs/recipes.md) – all examples with JS + CLI pairs: montage, waveform, ML, glitch, streaming
* [Plugins](docs/plugins.md) – custom ops, stats, descriptors (process, plan, resolve, call), persistent ctx

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

Production — slim bundle + import map.

```html
<script type="importmap">
{
  "imports": {
    "@audio/decode-wav": "https://esm.sh/@audio/decode-wav",
    "@audio/decode-aac": "https://esm.sh/@audio/decode-aac",
    "@audio/decode-aiff": "https://esm.sh/@audio/decode-aiff",
    "@audio/decode-caf": "https://esm.sh/@audio/decode-caf",
    "@audio/decode-webm": "https://esm.sh/@audio/decode-webm",
    "@audio/decode-amr": "https://esm.sh/@audio/decode-amr",
    "@audio/decode-wma": "https://esm.sh/@audio/decode-wma",
    "mpg123-decoder": "https://esm.sh/mpg123-decoder",
    "@wasm-audio-decoders/flac": "https://esm.sh/@wasm-audio-decoders/flac",
    "ogg-opus-decoder": "https://esm.sh/ogg-opus-decoder",
    "@wasm-audio-decoders/ogg-vorbis": "https://esm.sh/@wasm-audio-decoders/ogg-vorbis",
    "qoa-format": "https://esm.sh/qoa-format",
    "@audio/encode-wav": "https://esm.sh/@audio/encode-wav",
    "@audio/encode-mp3": "https://esm.sh/@audio/encode-mp3",
    "@audio/encode-flac": "https://esm.sh/@audio/encode-flac",
    "@audio/encode-opus": "https://esm.sh/@audio/encode-opus",
    "@audio/encode-ogg": "https://esm.sh/@audio/encode-ogg",
    "@audio/encode-aiff": "https://esm.sh/@audio/encode-aiff"
  }
}
</script>
<script type="module">
  import audio from './dist/audio.min.js'
  let a = await audio('./voice.wav')
</script>
```

Only mapped codecs are fetched — `audio-decode` calls `import('mpg123-decoder')` on first MP3 open. Remove lines you don't need.


## Ecosystem

* [audio-decode](https://github.com/audiojs/audio-decode) – codec decoding (13+ formats)
* [encode-audio](https://github.com/audiojs/audio-encode) – codec encoding
* [audio-filter](https://github.com/audiojs/audio-filter) – filters (weighting, EQ, auditory)
* [audio-speaker](https://github.com/audiojs/audio-speaker) – audio output (Node)
* [audio-type](https://github.com/nickolanack/audio-type) – format detection
* [pcm-convert](https://github.com/nickolanack/pcm-convert) – PCM format conversion

<p align="center"><a href="./license.md">MIT</a> · <a href="https://github.com/krishnized/license">ॐ</a></p>
