# ▷ audio [![test](https://github.com/audiojs/audio/actions/workflows/test.yml/badge.svg)](https://github.com/audiojs/audio/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/audio?color=white)](https://npmjs.org/package/audio)

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
let a = audio('voice.mp3')
a.trim().normalize('podcast').fade(0.3, 0.5)
await a.save('clean.mp3')
```

### Browser

```html
<script type="module">
  import audio from './dist/audio.min.js'
  let a = audio('./song.mp3')
  a.play()
</script>
```

`audio.min.js` is ~20K gzipped.<br>
Codecs load on demand via `import()` — map them with an import map or your bundler.
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
let a = audio('raw-take.wav')
a.trim(-30).normalize('podcast').fade(0.3, 0.5)
await a.save('clean.wav')
```

### Podcast montage

```js
let intro = audio('intro.mp3')
let body  = audio('interview.wav')
let outro = audio('outro.mp3')

body.trim().normalize('podcast')
let ep = audio([intro, body, outro])
ep.fade(0.5, 2)
await ep.save('episode.mp3')
```

### Render a waveform

```js
let a = audio('track.mp3')
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
let music = audio('bg.mp3')
let voice = audio('narration.wav')
music.gain(-12).mix(voice, { at: 2 })
await music.save('mixed.wav')
```

### Split a long file

```js
let a = audio('audiobook.mp3')
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
let a = audio('speech.wav')
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
let b = audio(JSON.parse(json))           // re-decode + replay edits
```

### Remove a section

```js
let a = audio('interview.wav')
a.remove({ at: 120, duration: 15 })     // cut 2:00–2:15
a.fade(0.1, { at: 120 })                // smooth the splice
await a.save('edited.wav')
```

### Ringtone from any song

```js
let a = audio('song.mp3')
a.crop({ at: 45, duration: 30 }).fade(0.5, 2).normalize()
await a.save('ringtone.mp3')
```

### Detect clipping

```js
let a = audio('master.wav')
let clips = await a.stat('clip')
if (clips.length) console.warn(`${clips.length} clipped blocks`)
```

### Stream to network

```js
let a = audio('2hour-mix.flac')
a.highpass(40).normalize('broadcast')
for await (let chunk of a) socket.send(chunk[0].buffer)
```

### Glitch: stutter + reverse

```js
let a = audio('beat.wav')
let v = a.view({ at: 1, duration: 0.25 })
let glitch = audio([v, v, v, v])
glitch.reverse({ at: 0.25, duration: 0.25 })
await glitch.save('glitch.wav')
```

### Tremolo / sidechain

```js
let a = audio('pad.wav')
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

**`audio(source, opts?)`** – decode from file, URL, or bytes. Returns instantly — decodes in background.

```js
let a = audio('voice.mp3')                // file path
let b = audio('https://cdn.ex/track.mp3') // URL
let c = audio(inputEl.files[0])           // Blob, File, Response, ArrayBuffer
let d = audio()                           // empty, ready for .push() or .record()
let e = audio([intro, body, outro])       // concat (virtual, no copy)
// opts: { sampleRate, channels, storage: 'memory' | 'persistent' | 'auto' }

await a                                   // await for decode — if you need .duration, full stats etc
```


**`audio.from(source, opts?)`** – wrap existing PCM, AudioBuffer, silence, or function. Sync, no I/O.

```js
let a = audio.from([left, right])                 // Float32Array[] channels
let b = audio.from(3, { channels: 2 })           // 3s silence
let c = audio.from(t => Math.sin(440*TAU*t), { duration: 2 })  // generator
let d = audio.from(audioBuffer)                   // Web Audio AudioBuffer
let e = audio.from(int16arr, { format: 'int16' }) // typed array + format
```

### Properties

```js
a.duration                // total seconds (reflects edits)
a.channels                // channel count
a.sampleRate              // sample rate per second
a.length                  // total samples per channel

a.currentTime             // playback position in seconds
a.playing                 // true during playback
a.paused                  // true when paused
a.volume = -3             // playback volume in dB (settable)
a.loop = true             // loop playback on/off (settable)

a.recording               // true during mic recording
a.ready                   // promise — resolves when decode completes
a.block                   // current block index during decode

a.source                  // original source reference
a.pages                   // page store (Float32Array blocks)
a.stats                   // per-block stats (peak, rms, etc.)
a.edits                   // edit list (non-destructive ops)
a.version                 // increments on each edit
```

Most ops take a last options argument with `at`, `duration`, `channel`. Time values accept numbers (seconds) or strings with units:

```js
a.gain(-3, { at: 10, duration: 5 })       // seconds
a.gain(-3, { at: '1:30', duration: '30s' })  // timecode, duration string
a.gain(-3, { at: '2m', duration: '500ms' })  // also: '1.5h', '90s', '2m30s'
a.gain(-3, { channel: 0 })               // left channel only
a.gain(-3, { channel: [0, 2] })          // channels 0 and 2
```

### Structure

**`.crop({at, duration})`** – keep only this range, discard the rest.

```js
a.crop({ at: 10, duration: 30 })          // keep 10s–40s
```

**`.remove({at, duration})`** – cut a range and close the gap.

```js
a.remove({ at: 10, duration: 2 })          // cut 10s–12s, close gap
```

**`.insert(source, {at})`** – insert audio or silence at position.

```js
a.insert(intro, { at: 0 })               // prepend
a.insert(3)                               // append 3s silence
```

**`.repeat(n)`** – repeat n times.

```js
a.repeat(4)                               // loop 4×
```

**`.pad(before, after?)`** – pad silence at edges (seconds).

```js
a.pad(0.5, 2)                            // 0.5s before, 2s after
```

**`.speed(rate)`** – change playback speed — affects pitch and duration.

```js
a.speed(2)                                // double speed, half duration
```

**`.reverse({at?, duration?})`** – reverse audio or a range.

```js
a.reverse()                               // reverse entire audio
a.reverse({ at: 5, duration: 2 })        // reverse 5s–7s only
```

**`.split(...offsets)`** – split into views at timestamps (zero-copy).

```js
let [ch1, ch2, ch3] = a.split(1800, 3600) // split at 30m, 60m
```

**`.trim(threshold?)`** – remove leading/trailing silence.

```js
a.trim()                                  // auto threshold
a.trim(-30)                               // custom -30dB
```

**`.view({at, duration})`** – non-destructive view of a range (zero-copy).

```js
let chorus = a.view({ at: 60, duration: 30 })  // zero-copy slice
```

**`.remix(channels)`** – change channel count. Accepts a number or array map.

```js
a.remix(1)                                // stereo → mono
a.remix(2)                                // mono → stereo
a.remix([1, 0])                           // swap L/R
a.remix([0, 0])                           // both from left
a.remix([0, null, 1])                     // L, silence, R → 3ch
```


### Process

**`.gain(dB, {at?, duration?, channel?, unit?})`** – volume in dB. Accepts function for automation.

```js
a.gain(-3)                                // reduce 3dB
a.gain(6, { at: 10, duration: 5 })       // boost range
a.gain(0.5, { unit: 'linear' })          // linear multiplier
a.gain(t => -3 * t)                      // automate over time
```

**`.fade(in, out?, curve?)`** – fade in/out.

```js
a.fade(0.5)                               // 0.5s fade-in from start
a.fade(0.5, -2)                           // 0.5s in, 2s out from end
a.fade(1, 1, 'exp')                       // curves: 'linear' 'exp' 'log' 'cos'
```

**`.mix(other, {at?, duration?})`** – overlay another source (additive).

```js
a.mix(voice, { at: 2 })
```

**`.write(data, {at?})`** – overwrite samples at position with raw PCM.

```js
a.write(float32arr, { at: 10 })           // overwrite at 10s
```

**`.pan(value, {at?, duration?})`** – stereo balance. Accepts function.

```js
a.pan(-1)                                 // full left
a.pan(0)                                  // center
a.pan(0.5)                                // half right
a.pan(t => Math.sin(t * 2))              // oscillating
```

**`.normalize(target?)`** – loudness normalize.

```js
a.normalize()                             // peak 0dBFS
a.normalize('podcast')                    // -16 LUFS, -1 dBTP
a.normalize('streaming')                  // -14 LUFS
a.normalize('broadcast')                  // -23 LUFS
```

**`.transform(fn)`** – inline processor — not registered, not serialized.

```js
a.transform((chs, ctx) => {               // ctx: { sampleRate, blockSize, at, duration }
  return chs.map(ch => ch.map(s => s * 0.5))
})
```


### Filter

**`.highpass(freq)`**, **`.lowpass(freq)`** – high/low-pass filter.

```js
a.highpass(80)                            // remove rumble
```

**`.bandpass(freq, Q?)`**, **`.notch(freq, Q?)`** – band-pass / notch filter.

```js
a.notch(60)                               // remove 60Hz hum
```

**`.lowshelf(freq, dB)`**, **`.highshelf(freq, dB)`** – shelf EQ.

```js
a.lowshelf(200, -3).highshelf(8000, 2)   // voice cleanup
```

**`.eq(freq, gain, Q?)`** – parametric EQ.

```js
a.eq(1000, -6, 2)                        // surgical cut at 1kHz
```

**`.filter(type, ...params)`** – generic filter dispatch.

```js
a.filter('highpass', 80)
a.filter(customFn, { cutoff: 2000 })     // custom filter function
```


### I/O

**`await .read(opts?)`** – read rendered PCM or encode to bytes.

```js
let pcm = await a.read()                  // Float32Array[]
let raw = await a.read({ format: 'int16', channel: 0 })
```

**`await .save(path, opts?)`** – encode and write to file. Format from extension.

```js
await a.save('out.mp3')
await a.save('clip.wav', { at: 10, duration: 5 })
```

**`await .encode(format?, opts?)`** – encode to Uint8Array without saving.

```js
let bytes = await a.encode('mp3')         // Uint8Array
```

**`for await (let block of a)`** – async-iterable over materialized blocks.

```js
for await (let block of a) send(block)            // all blocks
for await (let block of a.view({ at: 10, duration: 5 })) send(block)
```

**`.clone()`** – deep copy with independent edit history (pages shared).

```js
let b = a.clone()                         // independent copy, shared pages
```

**`.push(data, format?)`** – feed PCM into a pushable instance. Independent of recording.

```js
let a = audio()
a.push(new Float32Array(44100))           // mono float32
a.push(int16buf, 'int16')                 // typed array + format
a.push(interleaved, { format: 'int16', channels: 2 })
a.stop()                                  // finalize
```


### Playback / Recording

**`.play(opts?)`** – start playback. Re-invocation restarts.

```js
a.play()
a.play({ at: 30, duration: 10 })          // play 30s–40s
a.play({ volume: -6, loop: true })        // quiet, looping
```

**`.pause()`**, **`.resume()`**, **`.stop()`**, **`.seek(t)`** – playback control.

```js
a.pause(); a.seek(30); a.resume()         // jump to 30s and continue
a.volume = -3                             // live volume in dB
a.loop = true                             // live loop toggle
```

**`.record(opts?)`** – start mic recording. Options pass through to `audio-mic`.

```js
a.record()                                // default mic
a.record({ deviceId: 'abc123' })          // specific device
a.record({ sampleRate: 16000, channels: 1 })
```

**`.stop()`** – stop playback or recording.

```js
a.stop()                                  // end recording or playback
```


### Analysis

**`await .stat(name, opts?)`** – query a stat. Accepts `{at, duration}` for sub-ranges, `{channel}` for per-channel, `{bins}` for array output.

```js
let loud = await a.stat('loudness')
let [db, clip] = await a.stat(['db', 'clip'])
let spec = await a.stat('spectrum', { bins: 128 })
let peaks = await a.stat('max', { bins: 800 })   // waveform
```

Without `bins` — returns scalar. With `bins` — returns `Float32Array` downsampled to that many points. Set `bins` to block count for raw per-block values:

```js
let blocks = Math.ceil(a.length / 1024)
let raw = await a.stat('max', { bins: blocks })   // one value per block

await a.stat('rms', { channel: 0 })               // left only → number
await a.stat('rms', { channel: [0, 1] })           // per-channel → [number, number]
await a.stat('max', { channel: 0, bins: 800 })     // left waveform → Float32Array
```

#### Level

**`'db'`** – peak amplitude in dBFS.

```js
await a.stat('db')                        // -0.8
await a.stat('db', { at: 10, duration: 5 })
```

**`'rms'`** – RMS amplitude (linear).

```js
await a.stat('rms')                       // 0.12
await a.stat('rms', { bins: 400 })        // RMS envelope
```

**`'loudness'`** – integrated loudness in LUFS (ITU-R BS.1770).

```js
await a.stat('loudness')                  // -14.2
```

**`'dc'`** – DC offset (mean sample value).

```js
await a.stat('dc')                        // 0.002
```

#### Detection

**`'clip'`** – clipped samples. Scalar returns timestamps (seconds), binned returns counts.

```js
let clips = await a.stat('clip')          // [2.1, 5.8, ...] seconds
let counts = await a.stat('clip', { bins: 100 })  // clip count per bin
```

**`'silence'`** – silent segments as `{at, duration}` ranges.

```js
let gaps = await a.stat('silence')                        // auto threshold
let gaps = await a.stat('silence', { threshold: -40 })    // custom
```

#### Waveform

**`'max'`**, **`'min'`** – peak envelope. Use together for waveform rendering.

```js
let [mins, maxs] = await a.stat(['min', 'max'], { bins: canvas.width })
for (let i = 0; i < maxs.length; i++)
  ctx.fillRect(i, h/2 - maxs[i]*h/2, 1, (maxs[i] - mins[i])*h/2)
```

#### Frequency

**`'spectrum'`** – mel-frequency spectrum in dB (A-weighted).

```js
await a.stat('spectrum')                              // 128 bins default
await a.stat('spectrum', { bins: 64, at: 10, duration: 5 })
```

**`'cepstrum'`** – MFCCs (mel-frequency cepstral coefficients).

```js
await a.stat('cepstrum')                              // 13 coefficients default
await a.stat('cepstrum', { bins: 20 })
```

### Utility

**`.on(event, fn)`** – subscribe to an event. **`.off(event?, fn?)`** – unsubscribe.

```js
a.on('data', ({ delta }) => drawWaveform(delta))
a.off('data', drawWaveform)               // remove one listener
a.off('data')                             // remove all 'data' listeners
a.off()                                   // remove all listeners on all events
```

Events:

| Event | Payload | When |
|---|---|---|
| `'data'` | `{ delta, offset, sampleRate, channels }` | PCM pages decoded/pushed — `delta` has per-block stats (`min`, `max`, `energy`, `clip`, `dc`) |
| `'change'` | — | Any edit or undo |
| `'metadata'` | `{ sampleRate, channels }` | Stream header decoded |
| `'timeupdate'` | `currentTime` | Playback position advances |
| `'ended'` | — | Playback finishes (not on loop) |
| `'progress'` | `{ offset, total }` | During `save()`/`encode()` — both in seconds |

**`.dispose()`** – release all resources. (same as `a[Symbol.dispose]`)

```js
a.dispose()                               // free pages, stop playback

{
  using a = audio('big.flac')             // auto-dispose on block exit
  await a.save('out.mp3')
}                                         // a.dispose() called automatically
```

**`.undo(n?)`** – undo last edit (or last n). Returns the edit — pass to `.run()` for redo.

```js
a.undo()                                  // undo last op
a.undo(3)                                 // undo last 3
```

**`.run(...edits)`** – apply edit objects. Edits are plain `{ type, args, at?, duration?, channel? }`.

```js
let edit = a.undo(); a.run(edit)          // redo

a.run({ type: 'gain', args: [-3] })      // same as a.gain(-3)
a.run(                                    // batch apply
  { type: 'trim', args: [-30] },
  { type: 'normalize', args: ['podcast'] },
  { type: 'fade', args: [0.3, 0.5] }
)

// replay same processing onto another file
let b = audio('other.wav')
b.run(...a.edits)
await b.save('other-processed.wav')
```

**`JSON.stringify(a)`** / **`audio(json)`** – serialize / restore.

```js
let json = JSON.stringify(a)
let b = audio(JSON.parse(json))            // re-decode + replay edits
```

**`audio.op(name, fn)`** – register custom op — all instances gain the method.

```js
audio.op('crush', (chs, ctx) => {
  let steps = 2 ** (ctx.args[0] ?? 8)
  return chs.map(ch => ch.map(s => Math.round(s * steps) / steps))
})
a.crush(4)                                // chainable, undoable
```

**`audio.stat(name, descriptor)`** – register custom stat computed during decode.

```js
audio.stat('zcr', { block: ch => /* zero-crossing rate */ })
```


## CLI

```sh
npx audio [file] [ops...] [-o output] [options]

# ops
eq          mix         pad         pan       crop
fade        gain        stat        trim      notch
remix       speed       split       insert    remove
repeat      bandpass    highpass    lowpass   reverse
lowshelf    highshelf   normalize
```


`-o` output · `-p` play · `-f` force · `--format` · `--verbose` · `+` concat

### Playback

```sh
npx audio kirtan.mp3
▶ 0:06:37 ━━━━━━━━────────────────────────────────────────── -0:36:30   ▁▂▃▄▅__
          ▂▅▇▇██▇▆▇▇▇██▆▇▇▇▆▆▅▅▆▅▆▆▅▅▆▅▅▅▃▂▂▂▂▁_____________
          50    500  1k     2k         5k       10k      20k

          48k   2ch   43:07   -0.8dBFS   -30.8LUFS
```
<kbd>␣</kbd> pause · <kbd>←</kbd>/<kbd>→</kbd> seek ±10s · <kbd>⇧←</kbd>/<kbd>⇧→</kbd> seek ±60s · <kbd>↑</kbd>/<kbd>↓</kbd> volume ±3dB · <kbd>l</kbd> loop · <kbd>q</kbd> quit

### Edit

```sh
# clean up
npx audio raw-take.wav trim -30db normalize podcast fade 0.3s -0.5s -o clean.wav
# ranges
npx audio in.wav gain -3db 1s..10s -o out.wav
# filter chain
npx audio in.mp3 highpass 80hz lowshelf 200hz -3db -o out.wav
# join
npx audio intro.mp3 + content.wav + outro.mp3 trim normalize fade 0.5s -2s -o ep.mp3
# voiceover
npx audio bg.mp3 gain -12db mix narration.wav 2s -o mixed.wav
# split
npx audio audiobook.mp3 split 30m 60m -o 'chapter-{i}.mp3'
```

### Analysis

```sh
# all default stats (db, rms, loudness, clip, dc)
npx audio speech.wav stat
# specific stats
npx audio speech.wav stat loudness rms
# spectrum / cepstrum with bin count
npx audio speech.wav stat spectrum 128
npx audio speech.wav stat cepstrum 13
# stat after transforms
npx audio speech.wav gain -3db stat db
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
<dd>No. <code>a.gain(-3).trim()</code> pushes entries to an edit list — source pages aren't touched. Edits replay on <code>read()</code> / <code>save()</code> / <code>for await</code>.</dd>

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
