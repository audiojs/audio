# audio [![test](https://github.com/audiojs/audio/actions/workflows/test.yml/badge.svg)](https://github.com/audiojs/audio/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/audio)](https://npmjs.org/package/audio)

Audio in JavaScript: load, edit, play, analyze, save, batch-process.

```js
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
* [Architecture](docs/architecture.md) – stream-first design, pages & blocks, non-destructive editing, plan compilation
* [Plugins](docs/plugins.md) – custom ops, stats, descriptors (process, plan, resolve, call), persistent ctx
-->

## Quick Start

### Node

**`npm i audio`**

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

`audio.min.js` is ~20K gzipped. Codecs load on demand via `import()` — map them with an import map or your bundler.
<details>
<summary><strong>Import map example</strong></summary>


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
```

</details>


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

### Remove a section

```js
let a = await audio('interview.wav')
a.remove({ at: 120, duration: 15 })     // cut 2:00–2:15
a.fade(0.1, { at: 120 })                // smooth the splice
await a.save('edited.wav')
```

### Ringtone from any song

```js
let a = await audio('song.mp3')
a.crop({ at: 45, duration: 30 }).fade(0.5, 2).normalize()
await a.save('ringtone.mp3')
```

### Detect clipping

```js
let a = await audio('master.wav')
let clips = await a.stat('clip')
if (clips.length) console.warn(`${clips.length} clipped blocks`)
```

### Stream to network

```js
let a = await audio('2hour-mix.flac')
a.highpass(40).normalize('broadcast')
for await (let chunk of a.stream()) socket.send(chunk[0].buffer)
```

### Glitch: stutter + reverse

```js
let a = await audio('beat.wav')
let v = a.view({ at: 1, duration: 0.25 })
let glitch = audio([v, v, v, v])
glitch.reverse({ at: 0.25, duration: 0.25 })
await glitch.save('glitch.wav')
```

### Tremolo / sidechain

```js
let a = await audio('pad.wav')
a.gain(t => -12 * (0.5 + 0.5 * Math.cos(t * Math.PI * 4)))  // 2Hz tremolo in dB
await a.save('tremolo.wav')
```

### Sonify data

```js
let prices = [100, 102, 98, 105, 110, 95, 88, 92, 101, 107]
let a = audio.from(t => {
  let freq = 200 + (prices[Math.min(Math.floor(t / 0.2), prices.length - 1)] - 80) * 10
  return Math.sin(freq * Math.PI * 2 * t) * 0.5
}, { duration: prices.length * 0.2 })
await a.save('sonification.wav')
```


## API

### Create

**`audio(source, opts?)`** – Decode from file, URL, or bytes. Returns instantly — edits chain before decode completes. Thenable.

```js
let a = await audio('voice.mp3')
let b = audio('track.flac')  // no await — edits queue, consuming ops wait
b.gain(-3).trim()
await b.save('out.wav')
```

Opts: `{ sampleRate, channels, storage: 'memory' | 'persistent' | 'auto' }`.

#### `audio.from(source, opts?)`

Wrap existing PCM, AudioBuffer, silence, or function. Sync, no I/O.

```js
let a = audio.from([left, right])                 // Float32Array[] channels
let b = audio.from(3, { channels: 2 })           // 3s silence
let c = audio.from(t => Math.sin(440*TAU*t), { duration: 2 })
let d = audio.from(audioBuffer)                   // Web Audio AudioBuffer
let e = audio.from(int16arr, { format: 'int16' }) // typed array + format
```

#### `audio()`

Pushable instance for `.push()`, `.record()`, `.stop()`.

#### `audio([a, b, ...])`

Concat from array of sources.

### Properties

```js
a.duration  a.channels  a.sampleRate  a.length    // dimensions (reflect edits)
a.currentTime  a.playing  a.paused  a.volume  a.loop  // playback state
a.recording  a.ready  a.block                     // recording, decode promise, current block
a.source  a.pages  a.stats  a.edits  a.version    // internal state
```

### Structure

#### `.crop({at, duration})`

Keep only this range, discard the rest.

```js
a.crop({ at: 10, duration: 30 })
```

#### `.remove({at, duration})`

Cut a range and close the gap.

```js
a.remove({ at: 10, duration: 2 })
```

#### `.insert(source, {at})`

Insert audio or silence at position.

```js
a.insert(intro, { at: 0 })               // prepend
a.insert(3)                               // append 3s silence
```

#### `.repeat(n)`

Repeat n times.

#### `.pad(before, after?)`

Pad silence at edges (seconds).

```js
a.pad(0.5, 2)                            // 0.5s before, 2s after
```

#### `.speed(rate)`

Change playback speed — affects pitch and duration.

```js
a.speed(2)                                // double speed, half duration
```

#### `.reverse({at?, duration?})`

Reverse audio or a range.

#### `.split(...offsets)`

Split into views at timestamps (zero-copy).

```js
let [ch1, ch2, ch3] = a.split(1800, 3600)
```

#### `.trim(threshold?)`

Remove leading/trailing silence.

```js
a.trim()                                  // auto threshold
a.trim(-30)                               // custom -30dB
```

#### `.view({at, duration})`

Non-destructive view of a range (zero-copy).

#### `.concat(...sources)`

Append sources in order.


### Samples

#### `.gain(dB, {at?, duration?, channel?, unit?})`

Volume in dB (or linear with `{unit: 'linear'}`). Accepts function for automation.

```js
a.gain(-3)                                // reduce 3dB
a.gain(6, { at: 10, duration: 5 })       // boost range
a.gain(t => -3 * t)                      // automate over time
```

#### `.fade(in, out?, curve?)`

Fade in/out. Positive = from start, negative = from end. Curves: `'linear'`, `'exp'`, `'log'`, `'cos'`.

```js
a.fade(0.5, -2)                           // 0.5s in, 2s out from end
```

#### `.mix(other, {at?, duration?})`

Overlay another source (additive).

```js
a.mix(voice, { at: 2 })
```

#### `.write(data, {at?})`

Overwrite samples at position with raw PCM.

#### `.remix(channels)`

Change channel count. `a.remix(1)` stereo→mono, `a.remix(2)` mono→stereo.

#### `.pan(value, {at?, duration?})`

Stereo balance (−1 left, 0 center, 1 right). Accepts function.

```js
a.pan(-0.5)                               // shift left
a.pan(t => Math.sin(t * 2))              // oscillating
```

#### `.normalize(target?)`

Loudness normalize. Presets: `'podcast'` (-16 LUFS), `'streaming'` (-14 LUFS), `'broadcast'` (-23 LUFS).

```js
a.normalize()                             // peak 0dBFS
a.normalize('podcast')                    // -16 LUFS, -1 dBTP
```

#### `.transform(fn)`

Inline processor — not registered, not serialized. `fn(channels, ctx)` where ctx has `{ sampleRate, blockSize, at, duration }`.

```js
a.transform((chs, ctx) => chs.map(ch => ch.map(s => s * 0.5)))
```


### Filter

#### `.highpass(freq)` · `.lowpass(freq)`

High/low-pass filter.

```js
a.highpass(80)                            // remove rumble
```

#### `.bandpass(freq, Q?)` · `.notch(freq, Q?)`

Band-pass / notch filter.

```js
a.notch(60)                               // remove 60Hz hum
```

#### `.lowshelf(freq, dB)` · `.highshelf(freq, dB)`

Shelf EQ.

```js
a.lowshelf(200, -3).highshelf(8000, 2)   // voice cleanup
```

#### `.eq(freq, gain, Q?)`

Parametric EQ.

```js
a.eq(1000, -6, 2)                        // surgical cut at 1kHz
```

#### `.filter(type, ...params)`

Generic filter dispatch.

```js
a.filter('highpass', 80)
a.filter(customFn, { cutoff: 2000 })     // custom filter function
```


### I/O

#### `await .read(opts?)`

Read rendered PCM or encode to bytes.

```js
let pcm = await a.read()                  // Float32Array[]
let raw = await a.read({ format: 'int16', channel: 0 })
```

#### `await .save(path, opts?)`

Encode and write to file. Format from extension.

```js
await a.save('out.mp3')
await a.save('clip.wav', { at: 10, duration: 5 })
```

#### `await .encode(format?, opts?)`

Encode to Uint8Array without saving.

#### `for await (let block of .stream())`

Async iterator over materialized blocks.

#### `.clone()`

Deep copy with independent edit history (pages shared).


### Playback

#### `.play(opts?)`

Start playback.

```js
a.play()
a.play({ at: 30, duration: 10, loop: true })
```

#### `.pause()` · `.resume()` · `.stop()` · `.seek(t)`

Playback control.

### Recording

#### `.record()`

Start mic recording.

#### `.push(data, format?)`

Feed PCM into pushable instance.

#### `.stop()`

Stop playback or recording.


### Analysis

#### `await .stat(name, opts?)`

Query a stat. `{at, duration}` for sub-ranges, `{bins}` for waveforms.

```js
let loud = await a.stat('loudness')
let [db, clip] = await a.stat(['db', 'clip'])
let spec = await a.stat('spectrum', { bins: 128 })
let peaks = await a.stat('max', { bins: 800 })   // waveform
```

Stats: `'db'` `'rms'` `'loudness'` `'clip'` `'dc'` `'silence'` `'max'` `'min'` `'spectrum'` `'cepstrum'`

### Util

#### `.on(event, fn)` · `.off(event, fn)`

Events: `'change'`, `'data'`, `'metadata'`, `'timeupdate'`, `'ended'`, `'progress'`.

```js
a.on('data', ({ delta }) => drawWaveform(delta))
```

#### `.dispose()`

Release all resources. Also `a[Symbol.dispose]()`.


#### `.undo(n?)`

Undo last edit (or last n). Returns the edit — pass to `.run()` for redo.

#### `.run(...edits)`

Replay raw edit objects.

```js
let edit = a.undo(); a.run(edit)          // redo
```

#### `JSON.stringify(a)` / `audio(json)`

Serialize / restore.

```js
let json = JSON.stringify(a)
let b = await audio(JSON.parse(json))     // re-decode + replay edits
```

#### `audio.op(name, fn)`

Register custom op — all instances gain the method.

```js
audio.op('crush', (chs, ctx) => {
  let steps = 2 ** (ctx.args[0] ?? 8)
  return chs.map(ch => ch.map(s => Math.round(s * steps) / steps))
})
a.crush(4)                                // chainable, undoable
```

#### `audio.stat(name, descriptor)`

Register custom stat computed during decode.


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
