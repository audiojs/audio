# audio [![test](https://github.com/audiojs/audio/actions/workflows/test.yml/badge.svg)](https://github.com/audiojs/audio/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/audio)](https://npmjs.org/package/audio)

Audio in JavaScript: load, edit, play, analyze, save, batch-process.

```js
import audio from 'audio'

audio('raw-take.wav')
  .trim(-30)
  .normalize('podcast')
  .fade(0.3, 0.5)
  .save('clean.mp3')
```

* **Any format** — WASM codecs, lazy-loaded, no ffmpeg.
* **Streaming** — instant playback/edits not waiting for decode.
* **Immutable** — safe virtual edits, instant ops, undo/redo, serialize.
* **Paged** — opens huge files, no 2Gb memory limit, OPFS page cache.
* **Analysis** — feature extraction, peak/RMS/LUFS/spectrum/clip/silence.
* **Modular** – pluggable ops/stats, autodiscovery, tree-shake.
* **CLI** — player, unix pipelines, batch glob, tab completion.
* **Isomorphic** — cross-platform API, node/browser.
* **Audio terminology** – dB, Hz, LUFS, not samples/indices/arrays.

<!--
* [Reference](docs/reference.md) – full API: create, properties, edit ops, I/O, analysis, events, CLI, browser
* [Architecture](docs/architecture.md) – stream-first design, pages & blocks, non-destructive editing, plan compilation
* [Recipes](docs/recipes.md) – all examples with JS + CLI pairs: montage, waveform, ML, glitch, streaming
* [Plugins](docs/plugins.md) – custom ops, stats, descriptors (process, plan, resolve, call), persistent ctx
-->

## Quick Start

### Node

```js
import audio from 'audio'
let a = await audio('voice.mp3')
a.trim().normalize('podcast').fade(0.3, 0.5)
await a.save('clean.mp3')
```

### Browser

```html
<script type="module">
  import audio from './dist/audio.min.js'
  let a = await audio('./song.mp3')
  a.play()
</script>
```

`audio.min.js` is ~20K gzipped. Codecs load on demand via `import()` — map them with an import map or your bundler. See [import map example](#import-map) below.

## API

### Create

```js
let a = await audio('voice.mp3')              // file / URL / bytes
let b = audio.from(pcm, {sampleRate: 44100})  // wrap existing PCM
let c = audio.from(t => Math.sin(440*TAU*t), {duration: 2}) // synthesize
```

* `audio(source, opts?)` – decode from file, URL, or bytes (async, thenable, paged)
* `audio.from(source, opts?)` – wrap PCM, AudioBuffer, silence, or function (sync, resident)
* `audio()` – pushable instance for `.push()`, `.record()`, `.stop()`
* `audio([a, b, ...])` – concat from array

### Properties

```js
console.log(a.duration, a.channels, a.sampleRate)
a.volume = 0.5; a.loop = true
```

* `.duration` `.channels` `.sampleRate` `.length` – audio dimensions (reflect edits)
* `.currentTime` `.playing` `.paused` `.volume` `.loop` – playback state
* `.source` `.pages` `.stats` `.edits` `.version` – internal state

### Structural

```js
a.crop({at: 10, duration: 30})                 // keep 30s from 10s
let [ch1, ch2] = a.split(1800)                // split at 30min
a.insert(audio.from({duration: 2}), {at: 5})  // insert 2s silence at 5s
```

* `.crop({at, duration})` – keep only this range
* `.remove({at, duration})` – delete a range
* `.insert(source, {at})` – insert audio or silence at position
* `.repeat(n)` – repeat n times
* `.pad(before, after?)` – pad silence at edges (seconds)
* `.speed(rate)` – change playback speed
* `.reverse({at?, duration?})` – reverse audio or range
* `.split(t1, t2, ...)` – split into views at timestamps
* `.view({at, duration})` – non-destructive view of a range
* `.concat(b, c, ...)` – concatenate sources

### Sample

```js
a.gain(-3)                                     // lower 3dB
a.fade(0.5, -2)                                // 0.5s in, 2s out from end
a.gain(t => -20 + t * 10, {channel: 0})       // automate left channel
```

* `.gain(dB, {at?, duration?, channel?})` – volume in dB, accepts function for automation
* `.fade(in, out?, curve?)` – fade in/out, positive = from start, negative = from end
* `.mix(other, {at?, duration?})` – overlay another audio
* `.write(data, {at?})` – overwrite samples at position
* `.remix(channels)` – change channel count
* `.pan(value, {at?, duration?})` – stereo balance (−1..1), accepts function

### Smart

```js
a.trim().normalize()                           // clean up recording
a.normalize('podcast')                         // -16 LUFS, -1 dBTP
```

* `.trim(threshold?)` – remove silence from edges
* `.normalize(target?)` – loudness normalize, presets: `'podcast'`, `'streaming'`, `'broadcast'`

### Filter

```js
a.highpass(80)                                 // remove rumble
a.lowshelf(200, -3).highshelf(8000, 2)        // voice cleanup
a.eq(1000, -6, 2)                             // surgical cut at 1kHz
```

* `.highpass(hz)` `.lowpass(hz)` – high/low-pass filter
* `.bandpass(freq, Q)` `.notch(freq, Q)` – band-pass / notch filter
* `.lowshelf(hz, dB)` `.highshelf(hz, dB)` – shelf EQ
* `.eq(freq, gain, Q)` – parametric EQ

### I/O

```js
await a.save('out.mp3')                        // save to file
let pcm = await a.read({format: 'f32'})       // extract raw Float32
for await (let blk of a.stream()) send(blk)   // stream blocks
```

* `await .read({at?, duration?, channel?, format?})` – read PCM or encode to bytes
* `await .save(path, {format?, at?, duration?})` – save to file
* `await .encode(format?, {at?, duration?})` – encode to Uint8Array
* `for await (let block of .stream())` – async iterator over blocks

### Playback

```js
a.play()                                       // play from start
a.play({at: 30, duration: 10, loop: true})    // loop a 10s region
```

* `.play({at?, duration?, volume?, loop?})` – start playback
* `.pause()` `.resume()` `.stop()` `.seek(t)` – playback control

### Recording

```js
let a = audio(); a.record(); /*…*/ a.stop()   // record from mic
a.push(chunk); a.push(chunk); a.stop()        // feed from stream
```

* `.record()` – start mic recording
* `.push(data, format?)` – feed PCM into pushable
* `.stop()` – stop playback or recording

### Analysis

```js
let loud = await a.stat('loudness')            // integrated LUFS
let [db, clip] = await a.stat(['db', 'clip']) // batch query
let spec = await a.stat('spectrum', {bins: 128}) // frequency bins
```

* `await .stat(name, {at?, duration?, bins?, channel?})` – query a stat
* Stats: `'db'` `'rms'` `'loudness'` `'clip'` `'dc'` `'silence'` `'max'` `'spectrum'` `'cepstrum'`
* `await .stat([...names], opts)` – multiple stats at once

### Events

```js
a.on('change', () => render(a))               // re-render on edit
a.on('data', ({delta}) => draw(delta))        // visualize during decode
```

* `.on(event, fn)` `.off(event, fn)` – `'change'`, `'data'`, `'timeupdate'`, `'ended'`, `'progress'`
* `.dispose()` – release all resources

### History

```js
a.gain(-3).trim(); a.undo()                   // undo last edit
let json = JSON.stringify(a)                   // serialize
let b = await audio(JSON.parse(json))         // restore from snapshot
```

* `.undo()` – undo last edit
* `.run(edit1, ...)` – replay edits
* `JSON.stringify(a)` / `audio(json)` – serialize / restore

### Custom

```js
audio.op('lo-fi', (chs, ctx) => chs.map(ch => // register op
  ch.map(s => Math.round(s * 2**ctx.args[0]) / 2**ctx.args[0])))
a.transform(chs => chs.map(ch => ch.reverse())) // inline per-channel
```

* `audio.op(name, fn)` – register custom op
* `audio.stat(name, descriptor)` – register custom stat
* `.transform(fn)` – inline processor


## Recipes

### Clean up a recording

```js
let a = await audio('raw-take.wav')
a.trim(-30).normalize('podcast').fade(0.3, 0.5)
await a.save('clean.wav')
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

### Render a waveform

```js
let a = await audio('track.mp3')
let [mins, peaks] = await a.stat(['min', 'max'], { bins: canvas.width })
for (let i = 0; i < peaks.length; i++)
  ctx.fillRect(i, h/2 - peaks[i] * h/2, 1, (peaks[i] - mins[i]) * h/2)
```

### Render as it decodes

```js
let a = audio('long.flac')
a.on('data', ({ delta }) => appendBars(delta.max[0], delta.min[0]))
await a
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

### Record from mic

```js
let a = audio()
a.record()
await new Promise(r => setTimeout(r, 5000))
a.stop()
a.trim().normalize()
await a.save('recording.wav')
```

### Extract features for ML

```js
let a = await audio('speech.wav')
let mfcc = await a.stat('cepstrum', { bins: 13 })
let spec = await a.stat('spectrum', { bins: 128 })
let [loud, rms] = await a.stat(['loudness', 'rms'])
```

### Generate a tone

```js
let a = audio.from(t => Math.sin(440 * Math.PI * 2 * t), { duration: 2 })
await a.save('440hz.wav')
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
npx audio [file] [ops...] [-o output] [options]
```

| | | | |
|---|---|---|---|
| `gain` | `fade` | `trim` | `normalize` |
| `crop` | `remove` | `reverse` | `repeat` |
| `pad` | `speed` | `insert` | `mix` |
| `remix` | `pan` | `highpass` | `lowpass` |
| `eq` | `lowshelf` | `highshelf` | `notch` |
| `bandpass` | `split` | `stat` | |

`-o` output · `-p` play · `-i` info · `-f` force · `--format` · `--verbose` · `+` concat

### Playback

```sh
npx audio kirtan.mp3
▶ 0:06:37 ━━━━━━━━────────────────────────────────────────── -0:36:30   ▁▂▃▄▅__
          ▂▅▇▇██▇▆▇▇▇██▆▇▇▇▆▆▅▅▆▅▆▆▅▅▆▅▅▅▃▂▂▂▂▁_____________
          50    500  1k     2k         5k       10k      20k

          48k   2ch   43:07   -0.8dBFS   -30.8LUFS
```
<kbd>␣</kbd> pause · <kbd>←</kbd>/<kbd>→</kbd> seek ±10s · <kbd>⇧←</kbd>/<kbd>⇧→</kbd> seek ±60s · <kbd>↑</kbd>/<kbd>↓</kbd> volume ±3dB · <kbd>l</kbd> loop · <kbd>q</kbd> quit

### Clean up a recording

```sh
npx audio raw-take.wav trim -30db normalize podcast fade 0.3s -0.5s -o clean.wav
```

### Edit with ranges

```sh
npx audio in.mp3 gain -3db trim normalize -o out.wav
npx audio in.wav gain -3db 1s..10s -o out.wav
npx audio in.mp3 highpass 80hz lowshelf 200hz -3db -o out.wav
```

### Join

```sh
npx audio intro.mp3 + content.wav + outro.mp3 trim normalize fade 0.5s -2s -o episode.mp3
```

### Voiceover on music

```sh
npx audio bg.mp3 gain -12db mix narration.wav 2s -o mixed.wav
```

### Split a long file

```sh
npx audio audiobook.mp3 split 30m 60m -o 'chapter-{i}.mp3'
```

### Analysis

```sh
npx audio speech.wav stat cepstrum --bins 13
npx audio speech.wav stat spectrum --bins 128
npx audio speech.wav stat loudness rms
```

### Batch

```sh
npx audio '*.wav' trim normalize podcast -o '{name}.clean.{ext}'
npx audio '*.wav' gain -3db -o '{name}.out.{ext}'
```

### Stdin/stdout

```sh
cat in.wav | audio gain -3db > out.wav
curl -s https://example.com/speech.mp3 | npx audio normalize -o clean.wav
ffmpeg -i video.mp4 -f wav - | npx audio trim normalize podcast > voice.wav
```

### Tab completion

```sh
eval "$(audio --completions zsh)"       # add to ~/.zshrc
eval "$(audio --completions bash)"      # add to ~/.bashrc
audio --completions fish | source       # fish
```


## Import Map

For browsers without a bundler, map codec packages to a CDN:

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


## FAQ

<dl>
<dt>How is this different from Web Audio API?</dt>
<dd>Web Audio API is a real-time graph for playback and synthesis. This is for loading, editing, analyzing, and saving audio files. They work well together. For Web Audio API in Node, see <a href="https://github.com/audiojs/web-audio-api">web-audio-api</a>.</dd>

<dt>What formats are supported?</dt>
<dd>Decode: WAV, MP3, FLAC, OGG Vorbis, Opus, AAC, AIFF, CAF, WebM, AMR, WMA, QOA via <a href="https://github.com/audiojs/audio-decode">audio-decode</a>. Encode: WAV, MP3, FLAC, Opus, OGG, AIFF via <a href="https://github.com/audiojs/audio-encode">audio-encode</a>. Codecs are WASM-based, lazy-loaded on first use.</dd>

<dt>Does it need ffmpeg or native addons?</dt>
<dd>No, pure JS + WASM. For CLI, you can install globally: <code>npm i -g audio</code>.</dd>

<dt>How big is the bundle?</dt>
<dd>~20K gzipped core. Codecs load on demand via <code>import()</code>, so unused formats aren't fetched.</dd>

<dt>How does it handle large files?</dt>
<dd>Audio is stored in fixed-size pages. In the browser, cold pages can evict to OPFS when memory exceeds budget. Stats stay resident (~7 MB for 2h stereo).</dd>

<dt>Are edits destructive?</dt>
<dd>No. <code>a.gain(-3).trim()</code> pushes entries to an edit list — source pages aren't touched. Edits replay on <code>read()</code>/<code>save()</code>/<code>stream()</code>.</dd>

<dt>Can I use it in the browser?</dt>
<dd>Yes, same API. See <a href="#browser">Browser</a> for bundle options and import maps.</dd>

<dt>Does it need the full file before I can work with it?</dt>
<dd>No, playback and edits work during decode. The <code>'data'</code> event fires as pages arrive.</dd>

<dt>TypeScript?</dt>
<dd>Yes, ships with <code>audio.d.ts</code>.</dd>
</dl>


## Ecosystem

* [audio-decode](https://github.com/audiojs/audio-decode) – codec decoding (13+ formats)
* [encode-audio](https://github.com/audiojs/audio-encode) – codec encoding
* [audio-filter](https://github.com/audiojs/audio-filter) – filters (weighting, EQ, auditory)
* [audio-speaker](https://github.com/audiojs/audio-speaker) – audio output (Node)
* [audio-type](https://github.com/nickolanack/audio-type) – format detection
* [pcm-convert](https://github.com/nickolanack/pcm-convert) – PCM format conversion

<p align="center"><a href="./license.md">MIT</a> · <a href="https://github.com/krishnized/license">ॐ</a></p>
