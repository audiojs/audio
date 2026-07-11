# audio [![test](https://github.com/audiojs/audio/actions/workflows/test.yml/badge.svg)](https://github.com/audiojs/audio/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/audio?color=white)](https://npmjs.org/package/audio)

_Audio playback, editing and analysis_

<!-- <img src="preview.svg?v=1" alt="Audiojs demo" width="540"> -->

* **Any Format** — fast [wasm codecs](https://github.com/audiojs/decode), no ffmpeg.
* **Non-destructive** — virtual edits, infinite undo, instant clone.
* **Stream-first** — playback/encode during decode, realtime editing.
* **Paged** — no 2Gb memory limit, open 10Gb+ files.
* **Analysis** — loudness, spectrum, beats, pitch, chords, key.
* **Modular** – pluggable ops, tree-shakable.
* **CLI** — playback, batch processing, scripting, unix pipes, tab completion.
* **Cross-platform** — browsers, node, deno, bun.

<!--
* [Architecture](docs/architecture.md) – stream-first design, pages & blocks, non-destructive editing, plan compilation
* [Plugins](docs/plugins.md) – custom ops, stats, descriptors (process, plan, resolve, call), persistent ctx
-->
<div align=center>

<br>
<a href="https://www.npmjs.com/package/audio"><img src="https://raw.githubusercontent.com/audiojs/.github/main/profile/terminal.svg" alt="npm install audio"></a>

#### [Start](#start)&nbsp;&nbsp;&nbsp;[Recipes](#recipes)&nbsp;&nbsp;&nbsp;[API](#api)&nbsp;&nbsp;&nbsp;[CLI](#cli)&nbsp;&nbsp;&nbsp;[FAQ](#faq)&nbsp;&nbsp;&nbsp;[Plugins](docs/plugins.md)&nbsp;&nbsp;&nbsp;[Architecture](docs/architecture.md)&nbsp;&nbsp;&nbsp;[Comparison](docs/comparison.md)

</div>


## Start

### Node

`npm i audio`

```js
import audio from 'audio'
audio('voice.mp3').trim().normalize('podcast').fade(0.3, 0.5).save('clean.mp3')
```

### Browser

Audio loads codecs and plugins lazily on first use via `import('@audio/decode-mp3')` / `import('freeverb')`. So a browser needs *some* way to resolve those bare specifiers:

**CDN, zero-config** — esm.sh rewrites the lazy imports for you, nothing else to set up:

```html
<script type="module">
  import audio from 'https://esm.sh/audio'
  audio('./song.mp3').trim().normalize().fade(0.5, 2).clip({ at: 60, duration: 30 }).play()
</script>
```

**Bundler** (Vite / esbuild / webpack) — `import audio from 'audio'`; codecs and plugins become code-split chunks, fetched on demand. Subpath imports (`audio/core`, `audio/fn/gain`) are source ESM and need a bundler.

**Local bundle + import map** — serve `dist/audio.min.js` yourself and map the bare specifiers to a CDN (or local copies):

```html
<script type="importmap">
{ "imports": { "@audio/": "https://esm.sh/@audio/", "audio": "./dist/audio.min.js" } }
</script>
<script type="module">
  import audio from 'audio'
  audio('./song.mp3').normalize().play()   // @audio/decode-mp3 resolves via the map, on demand
</script>
```


### CLI

```sh
npm i -g audio
audio voice.wav trim normalize podcast fade 0.3s -0.5s save clean.mp3
```


## Recipes

### Clean up

```js
// master a raw take
let a = audio('raw-take.wav')
a.trim(-30).normalize('podcast').fade(0.3, 0.5)
await a.save('clean.wav')

// full restoration chain via ecosystem plugins (see API › Plugins)
a.gate(-45).dehum().deesser().compressor({ threshold: -18 }).limiter({ ceiling: -1 })

// cut 2:00–2:15, smooth the splice
a.remove({ at: 120, duration: 15 }).fade(0.1, { at: 120 })

// find clipped blocks
let clips = await a.stat('clipping')
```

### Compose

```js
// podcast montage
let ep = audio([intro, interview.trim().normalize('podcast'), outro], { crossfade: 0.5 })
await ep.save('episode.mp3')

// voiceover over music
music.gain(-12).mix(voice, { at: 2 })

// ringtone: the chorus + fades
audio('song.mp3').crop({ at: 45, duration: 30 }).fade(0.5, 2).normalize().save('ringtone.mp3')

// split an audiobook into chapters
let [ch1, ch2, ch3] = audio('audiobook.mp3').split(1800, 3600)

// glitch: stutter + reverse
let v = a.clip({ at: 1, duration: 0.25 })
audio([v, v, v, v]).reverse({ at: 0.25, duration: 0.25 })
```

### Analyze

```js
// waveform bars — and progressively, as it decodes
let [mins, peaks] = await a.stat(['min', 'max'], { bins: canvas.width })
a.on('data', ({ delta }) => appendBars(delta.max[0], delta.min[0]))

// features for ML
let mfcc = await a.stat('cepstrum', { bins: 13 })
let [loud, rms] = await a.stat(['loudness', 'rms'])

// notes, chords, key
let notes = await a.stat('notes')    // [{time, duration, freq, midi, note, clarity}]
let chords = await a.stat('chords')  // [{time, duration, label, root, quality, confidence}]
let key = await a.stat('key')        // {tonic, mode, label, confidence}
```

### Record & generate

```js
// mic take
let a = audio()
a.record()
// …later
a.stop()
a.trim().normalize()

// tone — any t => sample function
let tone = audio.from(t => Math.sin(440 * Math.PI * 2 * t), { duration: 2 })

// sonify data
let s = audio.from(t => Math.sin((200 + data[t / 0.2 | 0]) * Math.PI * 2 * t) * 0.5, { duration: data.length * 0.2 })
```

### Automate

Any numeric op param accepts a `t => value` function — the engine samples it during render (sample-accurate for `gain`/`pan`, ~3ms steps elsewhere). A breakpoint curve `{t, v}` does the same and stays serializable (survives `toJSON()` and the worker boundary):

```js
a.gain(t => -12 * (0.5 + 0.5 * Math.cos(t * Math.PI * 4)))  // 2Hz tremolo in dB
a.lowpass(t => 400 + 4000 * t)                              // filter sweep
a.pan({ t: [0, 2, 4], v: [-1, 1, -1] })                     // curve: L→R→L over 4s
music.ducker({ key: voice })                                // sidechain (plugin)
```

### Stream & persist

```js
// stream to network — encode/playback during decode
for await (let chunk of audio('2hour-mix.flac').highpass(40)) socket.send(chunk[0].buffer)

// serialize edits, restore later
let json = JSON.stringify(a)     // { source, edits, ... }
let b = audio(JSON.parse(json))  // re-decode + replay edits
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

Format, playback and state — media-element semantics where they apply.

* **`.duration`** – total seconds (reflects edits).
* **`.channels`** – channel count.
* **`.sampleRate`** – sample rate.
* **`.length`** – total samples per channel.
* **`.currentTime`** – playback position in seconds (smooth interpolation during playback).
* **`.playing`** – true during playback.
* **`.paused`** – true when paused.
* **`.volume`** – playback volume, 0..1 linear. Settable.
* **`.muted`** – mute gate, independent of volume. Settable.
* **`.loop`** – loop playback on/off. Settable.
* **`.playbackRate`** – live playback speed, 0.0625..16. Settable during playback — ramps smoothly (tape-style varispeed, ~50ms), no clicks. Playback-only; use `.speed()` to bake.
* **`.ended`** – true when playback ended naturally (not via stop).
* **`.seeking`** – true during a seek operation.
* **`.played`** – promise, resolves when playback starts.
* **`.recording`** – true during mic recording.
* **`.ready`** – promise, resolves when fully decoded.
* **`.source`** – original source reference.
* **`.pages`** – `Float32Array` page store.
* **`.stats`** – per-block stats (peak, rms, etc.).
* **`.edits`** – edit list (non-destructive ops).
* **`.version`** – increments on each edit.

### Structure

Non-destructive time/channel rearrangement. All support `{at, duration, channel}`.

* **`.trim(threshold?)`** – strip leading/trailing silence (dB, default auto).
* **`.shrink(gap?, threshold?)`** – compress silent pauses to a target gap (seconds, default 0.3) throughout, or within `{at, duration}`. `shrink(0)` removes silence entirely. &nbsp;<sub>≡ FFmpeg `silenceremove`, Audacity truncate-silence</sub>
* **`.crop({at, duration})`** – keep range, discard rest.
* **`.remove({at, duration})`** – cut range, close gap.
* **`.insert(source, {at})`** – insert audio or silence (number of seconds) at position.
* **`.clip({at, duration})`** – zero-copy range reference (an excerpt — unrelated to `stat('clipping')`, which detects over-0dBFS distortion).
* **`.split(...offsets)`** – zero-copy split at timestamps.
* **`.pad(before, after?)`** – silence at edges (seconds).
* **`.repeat(n)`** – repeat n times.
* **`.reverse({at?, duration?})`** – reverse audio or range.
* **`.speed(rate)`** – playback speed (affects both pitch and duration).
* **`.stretch(factor)`** – time stretch, preserves pitch. Phase-locked vocoder. Factor accepts a `t => f` function or `{t, v}` curve over source time — **sliding stretch** (continuous tempo envelope): duration becomes ∫factor dt, pitch stays put. Ranged via `{at, duration}`.
* **`.pitch(semitones)`** – pitch shift, preserves duration. Positive = higher.
* **`.remix(channels)`** – channel count: number or array map (`[1, 0]` swaps L/R). No `{at, duration}` — channel count can't change mid-timeline.

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
* **`.fade(in, out?, curve?)`** – fade in/out. Curves: `'linear'` `'exp'` `'log'` `'cos'`. Adjustable via opts: `{start, end}` gain levels (0..1 — fade between arbitrary levels, e.g. a duck), `{mid}` — position of the half-amplitude point within the fade (skews the curve), `{at}` — anywhere in the timeline. &nbsp;<sub>≡ Audacity adjustable-fade</sub>
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
* **`.crossfade(source, duration?, curve?)`** – crossfade into another audio. Default 0.5s `'cos'` (complementary amplitude, best for similar material); `'equal'` for the equal-power law (constant loudness across unrelated material, e.g. two songs). &nbsp;<sub>≡ FFmpeg `acrossfade`</sub>
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
* **`.dither(bits?, {shape?})`** – TPDF dithering for bit-depth reduction (default 16-bit). `shape:true` enables 2nd-order noise shaping — pushes quantization noise above ~Nyquist/2 (audibly quieter at given bit depth).
* **`.crossfeed(freq?, level?)`** – headphone crossfeed for improved stereo imaging. Default: 700 Hz cutoff, 0.3 level. &nbsp;<sub>≡ SoX `earwax`, bs2b</sub>
* **`.resample(rate, {type?})`** – sample rate conversion. Non-destructive, chainable, undoable. Upsampling defaults to fast linear interpolation; downsampling defaults to an anti-aliased 32-tap windowed sinc. Use `type:'sinc'` to force sinc quality, or `type:'linear'` to force the fastest interpolation.
* **`.crossover(...freqs)`** – band-splitting crossover: N split points → N+1 bands × channels, band-major order. Linkwitz-Riley 4th order, allpass-aligned — summing bands reconstructs the input flat. &nbsp;<sub>≡ FFmpeg `acrossover`</sub>

```js
a.vocals()                                // isolate center-panned vocals
a.vocals('remove')                        // remove vocals (karaoke)
a.dither(16)                              // TPDF dither to 16-bit
a.dither(16, {shape: true})               // noise-shaped (audibly quieter)
a.crossfeed()                             // headphone crossfeed
a.resample(48000)                         // resample to 48kHz (linear)
a.resample(96000, {type: 'sinc'})         // high-quality windowed-sinc
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

Live playback with dB volume, seeking, looping; mic recording.

* **`.play(opts?)`** – start playback. `{ at, duration, volume, rate, loop }`. `.played` promise resolves when output starts. `a.playbackRate` is live — set it mid-playback for smooth tape-style speed ramping.
* **`.pause()`**, **`.resume()`**, **`.seek(t)`**, **`.stop()`** – playback control.
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

### Metering

Live stats streamed per block during playback — same names as [Analysis](#analysis). Listener-gated: zero cost when nothing subscribes.

* **`.meter(what, cb?)`** – subscribe to live stats. `what` is a stat name, array of names, or an opts object; omit `cb` for pull-style access via the returned probe's `.value`. Returns `{ value, stop() }`.
  * `type` – stat name, array of names, or omit for all block stats.
  * `channel` – `n` for one channel, `[n, m]` per-channel, or omit for scalar avg (mirrors `a.stat()`).
  * `smoothing` – one-pole EMA time constant τ, in seconds.
  * `hold` – peak-hold decay τ, in seconds.
  * `bins` / `fMin` / `fMax` – spectrum resolution and range (when `type: 'spectrum'`).

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

Any registered stat works — `rms`, `peak`, `ms`, `min`, `max`, `dc`, `clipping`, `spectrum`, or your own via `audio.stat(...)`.


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

* **`.on(event, fn)`** / **`.off(event?, fn?)`** – subscribe / unsubscribe.
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

One mechanism extends everything — ops, stats, codecs; built-ins register through the same interface. See [Plugin Tutorial](docs/plugins.md).

* **`audio.use(...plugins)`** – register plugins: a factory following the [@audio contract](https://github.com/audiojs/compile/blob/main/CONTRACT.md), a stat `{ stat, compute }`, a codec `{ codec, test?, decode?, encode? }`, a function receiving `audio`, or a registry name (dynamic import — `npm i` the package; catalog in [docs/plugins.md#registry](docs/plugins.md#registry)).
* **`audio.op(name, fn)`** – register op. Shorthand for `{ process: fn }`. Full descriptor: `{ params, process, plan, resolve }`.
* **`audio.op(name)`** – query descriptor. **`audio.op()`** – all ops.
* **`audio.stat(name, descriptor)`** – register stat. Shorthand `(chs, ctx) => [...]` or `{ block, reduce, query }`.

Contract factories plug in as full ops — automation, click-free ramps, tails, latency, sidechain and CLI `--help` handled by the engine:

```js
import { compressor } from '@audio/dynamics-compressor/audio'
audio.use(compressor)                       // bring-your-own factory
await audio.use('freeverb', 'truepeak')     // or by registry name

a.freeverb({ room: 0.8 })                   // tail composes automatically
music.ducker({ key: voice })                // sidechain via the key option
await a.stat('truepeak')                    // stat plugins land on a.stat()
```

Custom ops and stats are plain descriptors — chainable and queryable like built-ins:

```js
audio.op('crush', { params: ['bits'], process: (input, output, ctx) => {
  let steps = 2 ** (ctx.bits ?? 8)
  for (let c = 0; c < input.length; c++)
    for (let i = 0; i < input[c].length; i++)
      output[c][i] = Math.round(input[c][i] * steps) / steps
}})
a.crush(4)
```

Codec plugins extend what `audio()` can open and `save()`/`encode()` can write; plugins also run engine-less — `audio/batch` over a whole signal, `audio/stream` over live chunks. Details in the [tutorial](docs/plugins.md).

### Worker

The whole engine off the main thread — one import, same call shape; the main bundle holds a few-KB facade. See [architecture](docs/architecture.md#worker-engine).

```js
import audioWorker from 'audio/worker'
let a = audioWorker('track.mp3')            // decode/edits/stats/encode in a Worker
a.gain(-3).fade(0.5)
let [mins, maxs] = await a.stat(['min','max'], { bins: 640 })  // transferred, zero-copy
a.play()                                    // AudioWorklet (no SharedArrayBuffer) / @audio/speaker
```

Once imported, the main entry dispatches too: `audio('track.mp3', { worker: true })`. Custom worker entry (extra codecs, plugins): `import '@audio/decode-aac'; import 'audio/worker'` — pass the file via `{ worker }`. Boundary: `clip()`/`split()`/`clone()` return promises of facades; op errors surface on `'error'`; function params don't cross — use curves `{t, v}`.

## CLI

**`npm i -g audio`**

```sh
audio [source] [transforms...] [sink] [options]
```

A pipeline: a **source** produces audio, **transforms** reshape it, a **sink** consumes it. The default sink is `stat` — printing an overview.

```sh
# sources
FILE         path, URL, or glob  ('*.wav' for batch)
-            stdin (or omit when piping)
record       capture from microphone

# transforms (chained left-to-right)
gain         fade        trim        normalize   crop
clip         remove      reverse     repeat      pad
speed        stretch     pitch       insert      mix
crossfade    remix       pan         split       resample
highpass     lowpass     eq          lowshelf    highshelf
notch        bandpass    allpass     vocals      dither
crossfeed    shrink      crossover

# sinks (terminate the chain — at most one)
stat [NAMES...]    print analysis (default)
play [loop]        open player UI
save PATH          encode and write (or `-` for stdout)

# options
-f --force         overwrite existing output
--format FMT       override output format
--macro FILE       apply edits from JSON
--cue FILE         split at cue-sheet tracks (with split)
--verbose          show progress
--help, -h         help (or per-op: `audio gain --help`)

# compatibility shortcuts
-p ⇔ play     -l ⇔ play loop     -o PATH ⇔ save PATH
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

<kbd>␣</kbd> pause · <kbd>←</kbd>/<kbd>→</kbd> seek ±10s · <kbd>⇧←</kbd>/<kbd>⇧→</kbd> seek ±60s · <kbd>↑</kbd>/<kbd>↓</kbd> volume · <kbd>l</kbd> loop · <kbd>s</kbd> save as · <kbd>q</kbd> quit

```sh
# play full song
audio song.mp3 play

# play fragment
audio song.mp3 10s..15s play

# play and loop a hook
audio song.mp3 30s..45s play loop

# play with effects applied live (streamable ops)
audio song.mp3 normalize broadcast highpass 80hz play
```

### Edit

```sh
# clean up
audio raw-take.wav trim -30db normalize podcast fade 0.3s -0.5s save clean.wav

# scope a range (applies to whole chain)
audio in.wav 1s..10s gain -3db save out.wav

# range on a single op
audio in.wav gain -3db 1s..10s save out.wav

# filter chain
audio in.mp3 highpass 80hz lowshelf 200hz -3db save out.wav

# concat
audio intro.mp3 + content.wav + outro.mp3 trim normalize fade 0.5s -2s save ep.mp3

# crossfade into next
audio track1.mp3 crossfade track2.mp3 2s save mixed.wav

# voiceover
audio bg.mp3 gain -12db mix narration.wav 2s save mixed.wav

# split
audio audiobook.mp3 split 30m 60m save 'chapter-{i}.mp3'
audio album.wav split --cue album.cue save '{i} - {title}.mp3'   # cue-sheet tracks, tagged

# record
audio record 30s save voice.wav
```

### Analysis

```sh
# overview (default sink)
audio speech.wav

# range overview — `audio FILE 0..10s` ⇔ `audio FILE stat 0..10s`
audio speech.wav 0..10s

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

# stat after transforms (transforms apply, then stat)
audio speech.wav gain -3db stat db
```

### Batch

```sh
audio '*.wav' trim normalize podcast save '{name}.clean.{ext}'
audio '*.wav' gain -3db save '{name}.out.{ext}'
```

### Stdin/stdout

```sh
cat in.wav | audio gain -3db save -      > out.wav
curl -s https://ex.com/speech.mp3 | audio normalize save clean.wav
ffmpeg -i video.mp4 -f wav - | audio trim normalize podcast save - > voice.wav
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
<dd>Decode: WAV, MP3, FLAC, OGG Vorbis, Opus, AAC, AIFF, CAF, WebM, AMR, WMA, QOA via <a href="https://github.com/audiojs/decode">decode</a>. Encode: WAV, MP3, FLAC, Opus, OGG, AIFF via <a href="https://github.com/audiojs/encode">encode</a>. Codecs are WASM-based, lazy-loaded on first use.</dd>

<dt>Does it need ffmpeg or native addons?</dt>
<dd>No, pure JS + WASM. For CLI, you can install globally: <code>npm i -g audio</code>.</dd>

<dt>How big is the bundle?</dt>
<dd>~20K gzipped core. Codecs load on demand via <code>import()</code>, so unused formats aren't fetched.</dd>

<dt>How does it handle large files?</dt>
<dd>Audio is stored in fixed-size pages. In the browser, cold pages can evict to OPFS when memory exceeds budget — auto-sized from <code>navigator.storage.estimate()</code> (quota/4, 64MB..2GB), overridable via <code>{budget}</code>. Stats stay resident (~7 MB for 2h stereo).</dd>

<dt>Are edits destructive?</dt>
<dd>No. <code>a.gain(-3).trim()</code> pushes entries to an edit list — source pages aren't touched. Edits replay on <code>read()</code> / <code>save()</code> / <code>for await</code>.</dd>

<dt>Can I use it in the browser?</dt>
<dd>Yes, same API. See <a href="#browser">Browser</a> for bundle options and import maps.</dd>

<dt>Does it need the full file before I can work with it?</dt>
<dd>No. Playback, edits, and structural ops (crop, repeat, pad, insert, etc.) all stream incrementally during decode — output begins before the file finishes loading. The edit plan recompiles as data arrives, tracking a safe output boundary per op. Only ops that depend on total length (open-end reverse, negative <code>at</code>) wait for full decode.</dd>

<dt>TypeScript?</dt>
<dd>Yes, ships with <code>audio.d.ts</code>.</dd>

<dt>Does it have feature parity with FFmpeg / SoX / librosa?</dt>
<dd>Yes — the <a href="https://github.com/audiojs">audiojs</a> ecosystem covers the practical baseline of FFmpeg filters, SoX effects, librosa analysis, Pedalboard and MIREX, all as <code>@audio/*</code> plugins <code>audio</code> wires through one API (the few uncovered items are esoteric or deliberately skipped). Every effect, filter, generator and analyzer lives in the <a href="docs/plugins.md#registry">registry</a> — <code>audio.use('name')</code> to pull one. Coverage matrix: <a href="docs/comparison.md">docs/comparison.md</a>.</dd>

<dt>How is this different from SoX / FFmpeg / Audacity / librosa / Web Audio / Tone.js?</dt>
<dd>In one line: <code>audio</code> is the only one that runs the same API in Node and the browser, with non-destructive lazy edits that stream during decode. The native tools (SoX, FFmpeg) are faster on raw throughput but have no JS API, browser, or undo; the browser libs (Web Audio, Tone.js, Howler) are real-time graphs, not file editors. Full feature and <a href="docs/comparison.md#performance">performance</a> matrices vs pydub, librosa, aubio, essentia, Pedalboard, SoX, FFmpeg, Audacity and MATLAB are in <a href="docs/comparison.md">docs/comparison.md</a>.</dd>
</dl>

## Built with

* [decode](https://github.com/audiojs/decode) – codec decoding (13+ formats)
* [encode](https://github.com/audiojs/encode) – codec encoding
* [filter](https://github.com/audiojs/filter) – filters (weighting, EQ, auditory)
* [speaker](https://github.com/audiojs/speaker) – audio output
* [mic](https://github.com/audiojs/mic) – audio input
* [pitch](https://github.com/audiojs/pitch) – pitch, chord, key analysis
* [audio-type](https://github.com/audiojs/audio-type) – format detection
* [pcm-convert](https://github.com/audiojs/pcm-convert) – PCM format conversion

<p align="center"><a href="./license.md">MIT</a> · <a href="https://github.com/krishnized/license">ॐ</a></p>
