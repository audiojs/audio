# 🎧 audio [![test](https://github.com/audiojs/audio/actions/workflows/test.yml/badge.svg)](https://github.com/audiojs/audio/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/audio?color=white)](https://npmjs.org/package/audio)

_High-level audio workflow: playback, analysis and editing_

```js
// js
audio('raw.wav').trim(-30).normalize('podcast').fade(0.3, 0.5).save('clean.mp3')
```
```sh
# cli
audio raw.wav trim ..-30s normalize podcast fade 0.3s -0.5s -o clean.mp3
```

<!-- <img src="preview.svg?v=1" alt="Audiojs demo" width="540"> -->

* **Any Format** — fast wasm codecs, no ffmpeg.
* **Streaming** — playback during decode.
* **Non-destructive** — virtual edits, instant undo.
* **Page cache** — open 10Gb+ files.
* **Analysis** — loudness, spectrum, beats, pitch, chords, key.
* **Modular** – pluggable ops, tree-shakable.
* **CLI** — playback, unix pipes, tab completion.
* **Cross-platform** — browsers, node, deno, bun.
* **Audio-first** – dB, Hz, LUFS, not bytes and indices.

<!--
* [Architecture](docs/architecture.md) – stream-first design, pages & blocks, non-destructive editing, plan compilation
* [Plugins](docs/plugins.md) – custom ops, stats, descriptors (process, plan, resolve, call), persistent ctx
-->

---
<div align=center>

#### [Start](#start)&nbsp;&nbsp;&nbsp;[Recipes](#recipes)&nbsp;&nbsp;&nbsp;[API](#api)&nbsp;&nbsp;&nbsp;[CLI](#cli)&nbsp;&nbsp;&nbsp;[FAQ](#faq)&nbsp;&nbsp;&nbsp;[Plugins](docs/plugins.md)&nbsp;&nbsp;&nbsp;[Architecture](docs/architecture.md)

</div>

---

## Start

### Node

`npm i audio`

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
  a.trim().normalize().fade(0.5, 2)
  a.clip({ at: 60, duration: 30 }).play()   // play the chorus
</script>
```

Codecs load on demand via `import()` — map them with an import map or your bundler.

<details>
<summary><strong>Import map example</strong></summary>


```html
<script type="importmap">
{
  "imports": {
    "@audio/decode-mp3": "https://esm.sh/@audio/decode-mp3",
    "@audio/decode-wav": "https://esm.sh/@audio/decode-wav",
    "@audio/decode-flac": "https://esm.sh/@audio/decode-flac",
    "@audio/decode-opus": "https://esm.sh/@audio/decode-opus",
    "@audio/decode-vorbis": "https://esm.sh/@audio/decode-vorbis",
    "@audio/decode-aac": "https://esm.sh/@audio/decode-aac",
    "@audio/decode-qoa": "https://esm.sh/@audio/decode-qoa",
    "@audio/decode-aiff": "https://esm.sh/@audio/decode-aiff",
    "@audio/decode-caf": "https://esm.sh/@audio/decode-caf",
    "@audio/decode-webm": "https://esm.sh/@audio/decode-webm",
    "@audio/decode-amr": "https://esm.sh/@audio/decode-amr",
    "@audio/decode-wma": "https://esm.sh/@audio/decode-wma",
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

### CLI

```sh
npm i -g audio
audio voice.wav trim normalize podcast fade 0.3s -0.5s -o clean.mp3
```


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

### Detect notes, chords, and key

```js
let a = audio('melody.wav')
let notes = await a.stat('notes')         // [{time, duration, freq, midi, note, clarity}]
// → [{time: 0, duration: 0.5, freq: 440, midi: 69, note: 'A4', clarity: 0.95}, ...]

let chords = await a.stat('chords')       // [{time, duration, label, root, quality, confidence}]
// → [{time: 0, duration: 2.1, label: 'C', quality: 'maj', confidence: 0.87}, ...]

let k = await a.stat('key')              // {tonic, mode, label, confidence}
// → {tonic: 0, mode: 'major', label: 'C', confidence: 0.91}
```

### Generate a tone

```js
let a = audio.from(t => Math.sin(440 * Math.PI * 2 * t), { duration: 2 })
await a.save('440hz.wav')
```

### Custom op

```js
audio.op('crush', { params: ['bits'], process: (input, output, ctx) => {
  let steps = 2 ** (ctx.bits ?? 8)
  for (let c = 0; c < input.length; c++)
    for (let i = 0; i < input[c].length; i++)
      output[c][i] = Math.round(input[c][i] * steps) / steps
}})

a.crush(4)
a.crush({bits: 4, at: 1, duration: 2})
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
let clips = await a.stat('clipping')
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
let v = a.clip({ at: 1, duration: 0.25 })
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

* **`audio(source, opts?)`** – decode from file, URL, or bytes. Returns instantly — decodes in background.
* **`audio.from(source, opts?)`** – wrap existing PCM, AudioBuffer, silence, or function. Sync, no I/O.

```js
let a = audio('voice.mp3')                // file path
let b = audio('https://cdn.ex/track.mp3') // URL
let c = audio(inputEl.files[0])           // Blob, File, Response, ArrayBuffer
let d = audio()                           // empty, ready for .push() or .record()
let e = audio([intro, body, outro])       // concat (virtual, no copy)
let f = audio([a, b, c], { crossfade: 2 })  // concat with 2s crossfade
// opts: { sampleRate, channels, crossfade, curve, storage: 'memory' | 'persistent' | 'auto' }

await a    // await for decode — if you need .duration, full stats etc

let a = audio.from([left, right])                 // Float32Array[] channels
let b = audio.from(3, { channels: 2 })           // 3s silence
let c = audio.from(t => Math.sin(440*TAU*t), { duration: 2 })  // generator
let d = audio.from(audioBuffer)                   // Web Audio AudioBuffer
let e = audio.from(int16arr, { format: 'int16' }) // typed array + format
```


### Properties

```js
// format
a.duration                // total seconds (reflects edits)
a.channels                // channel count
a.sampleRate              // sample rate
a.length                  // total samples per channel

// playback
a.currentTime             // position in seconds (smooth interpolation during playback)
a.playing                 // true during playback
a.paused                  // true when paused
a.volume = 0.5             // 0..1 linear (settable)
a.muted = true            // mute gate (independent of volume)
a.loop = true             // on/off (settable)
a.ended                   // true when playback ended naturally (not via stop)
a.seeking                 // true during a seek operation
a.played                  // promise, resolves when playback starts
a.recording               // true during mic recording

// state
a.ready                   // promise, resolves when fully decoded
a.source                  // original source reference
a.pages                   // Float32Array page store
a.stats                   // per-block stats (peak, rms, etc.)
a.edits                   // edit list (non-destructive ops)
a.version                 // increments on each edit
```

### Structure

Non-destructive time/channel rearrangement. All support `{at, duration, channel}`.

* **`.trim(threshold?)`** – strip leading/trailing silence (dB, default auto).
* **`.crop({at, duration})`** – keep range, discard rest.
* **`.remove({at, duration})`** – cut range, close gap.
* **`.insert(source, {at})`** – insert audio or silence (number of seconds) at position.
* **`.clip({at, duration})`** – zero-copy range reference.
* **`.split(...offsets)`** – zero-copy split at timestamps.
* **`.pad(before, after?)`** – silence at edges (seconds).
* **`.repeat(n)`** – repeat n times.
* **`.reverse({at?, duration?})`** – reverse audio or range.
* **`.speed(rate)`** – playback speed (affects both pitch and duration).
* **`.stretch(factor)`** – time stretch, preserves pitch. Phase-locked vocoder.
* **`.pitch(semitones)`** – pitch shift, preserves duration. Positive = higher.
* **`.remix(channels)`** – channel count: number or array map (`[1, 0]` swaps L/R).

```js
a.trim(-30)                               // strip silence below -30dB
a.remove({ at: '2m', duration: 15 })      // cut 2:00–2:15, close gap
a.insert(intro, { at: 0 })               // prepend; .insert(3) appends 3s silence
let [pt1, pt2] = a.split('30m')          // zero-copy views
let hook = a.clip({ at: 60, duration: 30 })  // zero-copy excerpt
a.stretch(0.9)                            // slow 10%, preserve pitch
a.pitch(-2)                               // down 2 semitones, preserve tempo
a.remix([0, 0])                           // L→both; .remix(1) for mono
```

### Process

Amplitude, mixing, normalization. All support `{at, duration, channel}` ranges.

* **`.gain(dB, opts?)`** – volume. Number, range, or `t => dB` function. `{ unit: 'linear' }` for multiplier.
* **`.fade(in, out?, curve?)`** – fade in/out. Curves: `'linear'` `'exp'` `'log'` `'cos'`.
* **`.normalize(target?)`** – remove DC offset, clamp, and normalize loudness. LUFS presets follow EBU R128 / ITU-R BS.1770-4 (equivalent to FFmpeg `loudnorm`).
  * `'podcast'` – -16 LUFS, -1 dBTP.
  * `'streaming'` – -14 LUFS.
  * `'broadcast'` – -23 LUFS.
  * `-3` – custom dB target (peak mode).
  * no arg – peak 0dBFS.
  * `{ mode: 'rms' }` – RMS normalization. Also `'peak'`, `'lufs'`.
  * `{ ceiling: -1 }` – true peak limiter in dB.
  * `{ dc: false }` – skip DC removal.
* **`.mix(source, opts?)`** – overlay another audio (additive).
* **`.crossfade(source, duration?, curve?)`** – crossfade into another audio, complementary fade curves. Default 0.5s `'cos'`. &nbsp;<sub>≡ FFmpeg `acrossfade`</sub>
* **`.pan(value, opts?)`** – stereo balance (−1 left, 0 center, 1 right). Accepts function.
* **`.write(data, {at?})`** – overwrite samples with raw PCM.
* **`.transform(fn)`** – inline processor: `(input, output, ctx) => void`. Not serialized.

```js
a.gain(-3)                                // reduce 3dB
a.gain(6, { at: 10, duration: 5 })       // boost range
a.gain(t => -12 * Math.cos(t * TAU))     // automate over time
a.fade(0.5, -2, 'exp')                    // 0.5s in, 2s exp fade-out
a.normalize('podcast')                    // -16 LUFS; also 'streaming', 'broadcast'
a.mix(voice, { at: 2 })                  // overlay at 2s
a.crossfade(next, 2)                      // 2s crossfade into next
a.crossfade(next, 0.5, 'linear')          // linear crossfade
a.pan(-0.3, { at: 10, duration: 5 })      // pan left for range
```

### Filter

Biquad filters, chainable. All support `{at, duration}` ranges.

* **`.highpass(freq)`**, **`.lowpass(freq)`** – pass filter.
* **`.bandpass(freq, Q?)`**, **`.notch(freq, Q?)`** – band-pass / notch.
* **`.allpass(freq, Q?)`** – all-pass (phase shift, unity magnitude).
* **`.lowshelf(freq, dB)`**, **`.highshelf(freq, dB)`** – shelf EQ.
* **`.eq(freq, gain, Q?)`** – parametric EQ.
* **`.filter(type, ...params)`** – generic dispatch.

```js
a.highpass(80).lowshelf(200, -3)          // rumble + mud
a.eq(3000, 2, 1.5).highshelf(8000, 3)    // presence + air
a.notch(50)                               // remove hum
a.allpass(1000)                           // phase shift at 1kHz
a.filter(customFn, { cutoff: 2000 })     // custom filter function
```

### Effect

Audio effects and transformations.

* **`.vocals(mode?)`** – stereo vocal isolation/removal via mid/side cancellation. `'isolate'` (default) keeps center, `'remove'` keeps sides. &nbsp;<sub>≡ SoX `oops`</sub>
* **`.dither(bits?)`** – TPDF dithering for bit-depth reduction (default 16-bit).
* **`.crossfeed(freq?, level?)`** – headphone crossfeed for improved stereo imaging. Default: 700 Hz cutoff, 0.3 level. &nbsp;<sub>≡ SoX `earwax`, bs2b</sub>
* **`.resample(rate)`** – sample rate conversion. Non-destructive, chainable, undoable. Downsampling auto-inserts anti-alias lowpass.

```js
a.vocals()                                // isolate center-panned vocals
a.vocals('remove')                        // remove vocals (karaoke)
a.dither(16)                              // TPDF dither to 16-bit
a.crossfeed()                             // headphone crossfeed
a.resample(48000)                         // resample to 48kHz
a.resample(22050).gain(-3).save('lo.wav') // chain with other ops
```

### I/O

Read PCM, encode, push. Format inferred from extension.

* **`await .read(opts?)`** – rendered PCM. `{ format, channel }` to convert.
* **`await .save(path, opts?)`** – encode + write. `{ at, duration }` for sub-range.
* **`await .encode(format?, opts?)`** – encode to `Uint8Array`.
* **`.clone()`** – deep copy, independent edits, shared pages.
* **`.push(data, format?)`** – feed PCM into pushable instance. `.stop()` to finalize.

```js
let pcm = await a.read()                              // Float32Array[]
let raw = await a.read({ format: 'int16', channel: 0 })
for await (let block of a) send(block)                 // async-iterable over blocks
await a.save('out.mp3')                                // format from extension
let bytes = await a.encode('flac')                     // Uint8Array
let b = a.clone()                                      // independent copy, shared pages

let src = audio()                                      // pushable source
src.push(buf, 'int16')                                 // feed PCM
src.stop()                                             // finalize
```

### Playback / Recording

Live playback with dB volume, seeking, looping, live meter.

* **`.play(opts?)`** – start playback. `{ at, duration, volume, loop }`. `.played` promise resolves when output starts.
* **`.pause()`**, **`.resume()`**, **`.seek(t)`**, **`.stop()`** – playback control.
* **`.meter(what, cb?)`** – live stats during playback. `what` is a stat name, array of names, or opts. Returns a probe `{ value, stop() }`. Listener-gated (zero cost when nothing subscribes).
* **`.record(opts?)`** – mic recording. `{ deviceId, sampleRate, channels }`.

```js
a.play({ at: 30, duration: 10 })          // play 30s–40s
await a.played                             // wait for output to start
a.volume = 0.5; a.loop = true             // live adjustments
a.muted = true                             // mute without changing volume
a.pause(); a.seek(60); a.resume()         // jump to 1:00
a.stop()                                  // end playback or recording

let mic = audio()
mic.record({ sampleRate: 16000, channels: 1 })
mic.stop()
```

`.meter(what, cb?)` — polymorphic first arg: string → single stat, array → keyed object, opts object → full config. Channel semantics mirror `a.stat()`: omitted → scalar avg, `channel: n` → that channel, `channel: [0, 1]` → per-channel array. Omit `cb` for pull-style access via `probe.value`.

```js
a.meter('rms', v => draw(v))                                       // scalar avg across channels
a.meter(['rms', 'peak'], v => draw(v))                             // { rms, peak }
a.meter({ type: 'rms', channel: [0, 1] }, v => draw(v))            // [L, R]
a.meter({ type: 'spectrum', bins: 64, smoothing: 0.15 }, drawFFT)  // Float32Array of mel bins
a.meter({}, ({ delta, offset }) => draw(delta))                    // no type → all block stats

let m = a.meter({ type: 'rms' })                                   // pull form
requestAnimationFrame(function tick() { draw(m.value); requestAnimationFrame(tick) })
m.stop()                                                           // release
```

Opts: **`type`** (stat name, array, or omit for all), **`channel`** (`n`, `[n, m]`, or omit), **`smoothing`** (one-pole EMA τ in seconds), **`hold`** (peak-hold decay τ in seconds), **`bins`** / **`fMin`** / **`fMax`** (when `type: 'spectrum'`). Any registered stat works (`rms`, `peak`, `ms`, `min`, `max`, `dc`, `clipping`, `spectrum`, or user-registered via `audio.stat(...)`).


### Analysis

`await .stat(name, opts?)` — without `bins` returns scalar, with `bins` returns `Float32Array`. Array of names returns array of results. Sub-ranges via `{at, duration}`, per-channel via `{channel}`.

* **`'db'`** – peak amplitude in dBFS.
* **`'rms'`** – RMS amplitude (linear).
* **`'peak'`** – max absolute amplitude, `max(|min|, |max|)` (linear, dBFS via `20·log10`).
* **`'loudness'`** – integrated LUFS (ITU-R BS.1770).
* **`'dc'`** – DC offset.
* **`'clipping'`** – clipped samples (scalar: timestamps, binned: counts).
* **`'silence'`** – silent ranges as `{at, duration}`.
* **`'crest'`** – crest factor in dB (peak/RMS ratio). Sine ≈ 3dB, square ≈ 0dB.
* **`'centroid'`** – spectral centroid in Hz (brightness). Higher = brighter.
* **`'flatness'`** – spectral flatness 0–1. 0 = tonal, 1 = noise.
* **`'correlation'`** – inter-channel (L/R) phase correlation, −1 to +1. Mono returns 1.
* **`'max'`**, **`'min'`** – peak envelope per bin — use together for waveform rendering.
* **`'spectrum'`** – mel-frequency spectrum in dB (A-weighted).
* **`'cepstrum'`** – MFCCs.
* **`'bpm'`** – tempo in BPM.
* **`'beats'`** – beat timestamps as `Float64Array` (seconds).
* **`'onsets'`** – onset timestamps as `Float64Array` (seconds).
* **`'notes'`** – pitch events: `[{time, duration, freq, midi, note, clarity}]` (YIN).
* **`'chords'`** – chord sequence: `[{time, duration, label, root, quality, confidence}]` (NNLS chroma + Viterbi).
* **`'key'`** – musical key: `{tonic, mode, label, confidence}` (Krumhansl-Schmuckler).

For BPM/beats/onsets, opts: `{ minBpm, maxBpm, delta, frameSize, hopSize }`. Use `a.detect(opts)` to get `{ bpm, confidence, beats, onsets }` in one pass.
For notes, opts: `{ frameSize, hopSize, threshold, minClarity }`. For chords/key, opts: `{ frameSize, hopSize, method }` (`'nnls'` or `'pcp'`).

```js
let loud = await a.stat('loudness')                       // LUFS
let [db, clips] = await a.stat(['db', 'clipping'])        // multiple at once
let spec = await a.stat('spectrum', { bins: 128 })        // frequency bins
let [min, max] = await a.stat(['min', 'max'], { bins: 800 }) // peak envelope for canvas rendering
await a.stat('rms', { channel: 0 })                       // left only → number
await a.stat('rms', { channel: [0, 1] })                  // per-channel → [n, n]
let gaps = await a.stat('silence', { threshold: -40 })    // [{at, duration}, ...]
let bpm = await a.stat('bpm')                             // 120.5
let beats = await a.stat('beats')                         // Float64Array [0, 0.5, 1, ...]
let { bpm, confidence, beats, onsets } = await a.detect() // full pipeline, one pass
let notes = await a.stat('notes')                         // [{time, duration, freq, midi, note: 'A4', clarity}]
let chords = await a.stat('chords')                       // [{time, duration, label: 'Am', confidence}]
let k = await a.stat('key')                               // {label: 'C', mode: 'major', confidence}
```


### Meta

Container tags, cover art, markers, regions. Parsed on decode, preserved on save. Round-trips WAV / MP3 / FLAC.

* **`a.meta`** – normalized tags: `{title, artist, album, year, bpm, key, comment, pictures, raw, ...}`. Writable. `meta.raw` holds format-specific untouched blocks (WAV bext/iXML, ID3v2 frames, FLAC blocks).
* **`a.markers`** – point markers `[{time, label}]` in output seconds. Projected through edits (crop/reverse/speed shift or drop them).
* **`a.regions`** – time-span regions `[{at, duration, label}]`. Same projection semantics.
* **`meta.pictures`** – cover art `[{mime, type, description, data, url}]`. `.url` is a lazy Blob URL (browser) or data URL (Node).

```js
let a = await audio('song.mp3')
a.meta.title                     // 'Track Name'
a.meta.artist = 'Me'             // mutate
img.src = a.meta.pictures[0].url // lazy Blob URL

a.crop({ at: 10, duration: 30 })
a.markers                         // re-projected — outside markers dropped, inside shifted

await a.save('edited.mp3')        // tags + pictures preserved
await a.save('stripped.wav', { meta: false })   // opt out
```

### Utility

Events, lifecycle, undo/redo, serialization.

* **`.on(event, fn, opts?)`** / **`.off(event?, fn?)`** – subscribe / unsubscribe.
  * `'data'` – pages decoded/pushed. Payload: `{ delta, offset, sampleRate, channels }`.
  * `'change'` – any edit or undo.
  * `'metadata'` – stream header decoded. Payload: `{ sampleRate, channels }`.
  * `'timeupdate'` – playback position. Payload: `currentTime`.
  * `'play'` – playback started or resumed.
  * `'pause'` – playback paused.
  * `'volumechange'` – volume or muted changed.
  * `'ended'` – playback finished (not on loop).
  * `'progress'` – during save/encode. Payload: `{ offset, total }` in seconds.
* **`.dispose()`** – release resources. Supports `using` for auto-dispose.
* **`.undo(n?)`** – undo last edit(s). Returns edit for redo via `.run()`.
* **`.run(...edits)`** – apply edits as arrays `['type', opts?]`. Batch or replay.

Edits use `[type, opts]` shape, where `opts` is params (`value`, `freq`, etc.) plus range keys (`at`, `duration`, `channel`).

```js
a.run(
  ['gain', { value: -3, at: 10, duration: 5 }],
  ['crop', { at: 1, duration: 2 }],
  ['fade', { in: 1, curve: 'exp' }],
  ['insert', { source: ref, at: 2 }],
  ['gain', { value: -3 }],
)

let saved = JSON.stringify([
  ['gain', { value: -3 }],
  ['crop', { at: 1, duration: 2 }],
])
a.run(...JSON.parse(saved))
```

```js
a.on('data', ({ delta }) => draw(delta))  // decode progress
a.on('timeupdate', t => ui.update(t))     // playback position

a.undo()                                  // undo last edit
b.run(...a.edits)                         // replay onto another file
JSON.stringify(a); audio(json)            // serialize / restore
```

### Plugins

Extend with custom ops and stats. See [Plugin Tutorial](docs/plugins.md).

* **`audio.op(name, fn)`** – register op. Shorthand for `{ process: fn }`. Full descriptor: `{ params, process, plan, resolve }`.
* **`audio.op(name)`** – query descriptor. **`audio.op()`** – all ops.
* **`audio.stat(name, descriptor)`** – register stat. Shorthand `(chs, ctx) => [...]` or `{ block, reduce, query }`.

```js
// op: params declares named args → ctx.bits; process receives (input, output, ctx) per 1024-sample block
audio.op('crush', { params: ['bits'], process: (input, output, ctx) => {
  let steps = 2 ** (ctx.bits ?? 8)
  for (let c = 0; c < input.length; c++)
    for (let i = 0; i < input[c].length; i++)
      output[c][i] = Math.round(input[c][i] * steps) / steps
}})

// stat: block function collects per-block, reduce enables scalar queries across blocks
audio.stat('peak', {
  block: (chs) => chs.map(ch => { let m = 0; for (let s of ch) m = Math.max(m, Math.abs(s)); return m }),
  reduce: (blockValues, from, to) => { let m = 0; for (let i = from; i < to; i++) m = Math.max(m, blockValues[i]); return m },
})

a.crush(4)                    // chainable like built-in ops
a.stat('peak')                // → scalar from reduce
a.stat('peak', { bins: 100 }) // → binned array
```

## CLI

**`npm i -g audio`**

```sh
audio [file] [ops...] [-o output] [options]

# ops
eq          mix         pad         pan       crop
fade        gain        stat        trim      notch
remix       speed       split       insert    remove
repeat      bandpass    highpass    lowpass   reverse
lowshelf    highshelf   normalize   allpass   vocals
dither      crossfeed

# options
-p play     -l loop     -o output   -f force  --format
```

### Playback


<img src="player.gif" alt="Audiojs demo" width="624">

<!-- ```sh
audio kirtan.mp3
▶ 0:06:37 ━━━━━━━━────────────────────────────────────────── -0:36:30   ▁▂▃▄▅__
          ▂▅▇▇██▇▆▇▇▇██▆▇▇▇▆▆▅▅▆▅▆▆▅▅▆▅▅▅▃▂▂▂▂▁_____________
          50    500  1k     2k         5k       10k      20k

          48k   2ch   43:07   -0.8dBFS   -30.8LUFS
``` -->

<kbd>␣</kbd> pause · <kbd>←</kbd>/<kbd>→</kbd> seek ±10s · <kbd>⇧←</kbd>/<kbd>⇧→</kbd> seek ±60s · <kbd>↑</kbd>/<kbd>↓</kbd> volume ±3dB · <kbd>l</kbd> loop · <kbd>q</kbd> quit

```sh
# Play fragment of the song
audio song.mp3 10s..15s -p

# Play clip (not full song)
audio song.mp3 clip 10s..20s -p -l

# Normalize before
```

### Edit

```sh
# clean up
audio raw-take.wav trim -30db normalize podcast fade 0.3s -0.5s -o clean.wav

# ranges
audio in.wav gain -3db 1s..10s -o out.wav

# filter chain
audio in.mp3 highpass 80hz lowshelf 200hz -3db -o out.wav

# join
audio intro.mp3 + content.wav + outro.mp3 trim normalize fade 0.5s -2s -o ep.mp3

# crossfade into next track
audio track1.mp3 crossfade track2.mp3 2s -o mixed.wav

# voiceover
audio bg.mp3 gain -12db mix narration.wav 2s -o mixed.wav

# split
audio audiobook.mp3 split 30m 60m -o 'chapter-{i}.mp3'
```

### Analysis

```sh
# all default stats (db, rms, loudness, clipping, dc)
audio speech.wav stat

# specific stats
audio speech.wav stat loudness rms

# tempo / beat grid / onsets
audio track.mp3 stat bpm
audio track.mp3 stat beats onsets

# pitch / chords / key
audio song.mp3 stat notes
audio song.mp3 stat chords
audio song.mp3 stat key

# spectrum / cepstrum with bin count
audio speech.wav stat spectrum 128
audio speech.wav stat cepstrum 13

# stat after transforms
audio speech.wav gain -3db stat db
```

### Batch

```sh
audio '*.wav' trim normalize podcast -o '{name}.clean.{ext}'
audio '*.wav' gain -3db -o '{name}.out.{ext}'
```

### Stdin/stdout

```sh
cat in.wav | audio gain -3db > out.wav
curl -s https://example.com/speech.mp3 | audio normalize -o clean.wav
ffmpeg -i video.mp4 -f wav - | audio trim normalize podcast > voice.wav
```

### Tab completion

```sh
eval "$(audio --completions zsh)"       # add to ~/.zshrc
eval "$(audio --completions bash)"      # add to ~/.bashrc
audio --completions fish | source       # fish
```

## FAQ

<dl>
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
<dd>No. Playback, edits, and structural ops (crop, repeat, pad, insert, etc.) all stream incrementally during decode — output begins before the file finishes loading. The edit plan recompiles as data arrives, tracking a safe output boundary per op. Only ops that depend on total length (open-end reverse, negative <code>at</code>) wait for full decode.</dd>

<dt>TypeScript?</dt>
<dd>Yes, ships with <code>audio.d.ts</code>.</dd>

<dt>How is this different from SoX?</dt>
<dd>SoX is a C command-line tool — powerful but native-only, no browser, no programmatic API, no streaming edits, no undo. <code>audio</code> runs in Node and the browser with the same API, edits are non-destructive and lazy (nothing is rendered until you read/save), and it streams during decode. Several SoX effects are implemented (allpass, dither, crossfeed/earwax, vocals/oops, resample). Remaining effects (reverb, compressor, noise reduction, chorus, flanger, phaser) are planned.</dd>

<dt>How is this different from Audacity?</dt>
<dd>Audacity is a GUI desktop app. <code>audio</code> is a library and CLI — designed for scripting, automation, pipelines, and embedding in apps. Audacity is destructive (edits mutate samples); <code>audio</code> is non-destructive (edits are a plan replayed on read). Audacity can't run in the browser or be <code>npm install</code>ed into your project.</dd>

<dt>How is this different from ffmpeg?</dt>
<dd>ffmpeg is a video-first tool that also handles audio. It's a C binary — no JS API, no browser, no streaming edits. <code>audio</code> is audio-first: dB, Hz, LUFS are native units. Edits are non-destructive, playback streams during decode, and the whole thing is ~20K gzipped with codecs loading on demand.</dd>

<dt>How is this different from Web Audio API?</dt>
<dd>Web Audio API is a real-time audio graph for playback and synthesis — not for editing files. No undo, no save-to-file, no CLI, no Node (without polyfills). <code>audio</code> is for working on audio files: load, edit, analyze, save. For Web Audio API in Node, see <a href="https://github.com/audiojs/web-audio-api">web-audio-api</a>.</dd>

<dt>How is this different from Tone.js / Howler.js?</dt>
<dd>Tone.js is a Web Audio synthesis framework — great for making music in real-time, not for editing files. Howler.js is a playback library — load and play, no editing or analysis. <code>audio</code> is a complete audio workstation: decode, edit, analyze, encode, play, record, CLI.</dd>
</dl>

## Ecosystem

* [audio-decode](https://github.com/audiojs/audio-decode) – codec decoding (13+ formats)
* [encode-audio](https://github.com/audiojs/audio-encode) – codec encoding
* [audio-filter](https://github.com/audiojs/audio-filter) – filters (weighting, EQ, auditory)
* [audio-speaker](https://github.com/audiojs/audio-speaker) – audio output
* [audio-mic](https://github.com/audiojs/audio-mic) – audio input
* [pitch-detection](https://github.com/nickolanack/pitch-detection) – pitch, chord, key analysis
* [audio-type](https://github.com/nickolanack/audio-type) – format detection
* [pcm-convert](https://github.com/nickolanack/pcm-convert) – PCM format conversion

<p align="center"><a href="./license.md">MIT</a> · <a href="https://github.com/krishnized/license">ॐ</a></p>
