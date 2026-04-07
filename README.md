# audio [![test](https://github.com/audiojs/audio/actions/workflows/test.yml/badge.svg)](https://github.com/audiojs/audio/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/audio)](https://npmjs.org/package/audio)

High-level audio manipulations.
Loading, manipulations, processing, scripting, playback, analysis, recording, streaming any audio in CLI/js.

<!-- FIXME: Features/principles must be emphasized better -->
* Non-destructive
* Stream-first
* Scriptable
* No memory limitation
* Physical units / industry standards
* Modular

```sh
npm i audio
```

```js
import audio from 'audio'

let a = await audio('voice.mp3')
a.trim().normalize().fade(0.5, 0.5)
await a.save('clean.wav')
```


<table><tr><td valign="top">

**[Create](#create)**<br>
<sub>[audio()](#create) · [audio.open()](#audioopensouce-opts) · [audio.from()](#audiofromsource-opts) · [audio.record()](#audiorecordopts)</sub>

**[Properties](#properties)**

**[Ops](#ops)**<br>
<sub>[crop](#structural) · [remove](#structural) · [insert](#structural) · [repeat](#structural) · [pad](#structural) · [speed](#structural) · [split](#structural) · [view](#structural) · [gain](#sample) · [fade](#sample) · [reverse](#sample) · [mix](#sample) · [write](#sample) · [remix](#sample) · [pan](#sample) · [trim](#smart) · [normalize](#smart) · [transform](#transform)</sub>

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

**`audio.record(opts?)`** — record audio. With `{ input: 'mic' }`, captures from microphone via [`audio-mic`](https://npmjs.com/package/audio-mic). Without it, feed PCM chunks manually.

```js
// Mic recording (requires audio-mic)
let a = audio.record({ input: 'mic' })
await a.ready                          // mic is capturing
// ... record for a while ...
a.stop()                               // finalize — stats computed

// Push-based (custom source)
let a = audio.record({ sampleRate: 44100, channels: 1 })
a.push(float32chunk)                   // feed PCM data
a.push(anotherChunk)
a.stop()                               // finalize — stats computed
```

`audio.version` — package version string.

Encoded sources are paged (`PAGE_SIZE`-sample chunks, evictable to OPFS for large files). PCM sources via `audio.from()` are always resident.


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

a.speed(2)                         // double speed (half duration)
a.speed(0.5)                       // half speed (double duration)
a.speed(-1)                        // reverse at normal speed

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
a.fade(0.5, 1)                     // fade in 0.5s, fade out 1s
a.fade(0.5, 1, 'exp')              // both with exponential curve
a.fade(-1, 'exp')                  // single fade with curve
a.fade(-1, {curve: 'exp'})         // same, explicit option

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

a.normalize()                        // peak 0 dBFS + DC removal
a.normalize(-1)                      // peak -1 dBFS
a.normalize('streaming')             // -14 LUFS (YouTube, Spotify)
a.normalize('podcast')               // -16 LUFS
a.normalize('broadcast')             // -23 LUFS (EBU R128)
a.normalize({ mode: 'lufs', target: -14 })  // explicit LUFS target
a.normalize({ mode: 'rms', target: -18 })   // RMS -18 dBFS
a.normalize({ ceiling: -1 })         // peak 0dB + true-peak ceiling -1dBTP
a.normalize({ dc: false })           // skip DC removal
a.normalize({ channel: 0 })          // left channel only
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
a.eq(1000, 3, 2)                     // freq, gain, Q
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
await a.stat('silence')                 // [{at, duration}, …] silent regions
await a.stat('silence', {threshold: -40, minDuration: 0.5})

let w = await a.stat('max', {bins: 800})// 800-point Float32Array for waveform
let m = await a.stat('min', {bins: 800, channel: [0, 1]})// per-channel
let c = await a.stat('max', {channel: 0})// single channel scalar

// array of names — parallel query, positional result
let [mn, mx] = await a.stat(['min', 'max'], { bins: 800 })
let [peak, loud] = await a.stat(['db', 'loudness'])
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
const invert = (chs, ctx) => {
  let s = ctx.at != null ? Math.round(ctx.at * ctx.sampleRate) : 0
  let end = ctx.duration != null ? s + Math.round(ctx.duration * ctx.sampleRate) : chs[0].length
  return chs.map(ch => {
    let o = new Float32Array(ch)
    for (let i = s; i < end; i++) o[i] = -o[i]
    return o
  })
}
audio.op('invert', invert)

a.invert()
a.invert({at: 2, duration: 1})         // range: 2s for 1s
```

### Custom stats

```js
audio.stat.rms = (chs) => chs.map(ch => {
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


## Recipes

### Clean up a voice recording

```js
let a = await audio('raw-take.wav')
a.trim(-30).normalize('podcast').fade(0.3, 0.5)
await a.save('clean.wav')
```
```sh
npx audio raw-take.wav trim -30db normalize podcast fade 0.3s -0.5s -o clean.wav
```

### Render a waveform

```js
let a = await audio('track.mp3')
let [mins, peaks] = await a.stat(['min', 'max'], { bins: canvas.width })
for (let i = 0; i < peaks.length; i++) {
  ctx.fillRect(i, h/2 - peaks[i] * h/2, 1, (peaks[i] - mins[i]) * h/2)
}
```

### Progressive waveform (stream as it decodes)

```js
let a = await audio('long.flac', {
  onprogress({ delta }) {
    appendBars(delta.max[0], delta.min[0])
  }
})
```

### Record from mic

```js
let a = audio.record({ input: 'mic' })
await a.ready

// ... record for a while ...
a.stop()
a.trim().normalize()
await a.save('recording.wav')
```

<details><summary>Web Audio API integration</summary>

```js
let stream = await navigator.mediaDevices.getUserMedia({ audio: true })
let ctx = new AudioContext(), src = ctx.createMediaStreamSource(stream)
let proc = ctx.createScriptProcessor(4096, 1, 1)
let a = audio.record({ sampleRate: ctx.sampleRate, channels: 1 })
proc.onaudioprocess = e => a.push([e.inputBuffer.getChannelData(0)])
src.connect(proc); proc.connect(ctx.destination)

// ... later
proc.disconnect(); stream.getTracks().forEach(t => t.stop())
a.stop()
a.trim().normalize()
await a.save('recording.wav')
```

</details>

### Podcast montage

```js
let intro  = await audio('intro.mp3')
let body   = await audio('interview.wav')
let outro  = await audio('outro.mp3')

body.trim().normalize('podcast')
let ep = intro.concat(body, outro)
ep.fade(0.5, 2)
await ep.save('episode.mp3')
```
```sh
npx audio intro.mp3 + interview.wav + outro.mp3 trim normalize podcast fade 0.5s -2s -o episode.mp3
```

### Batch normalize

```sh
npx audio '*.wav' trim normalize podcast -o '{name}.clean.{ext}'
```

### Batch with macro file

```sh
echo '[{"type":"trim"},{"type":"normalize","args":["podcast"]},{"type":"fade","args":[0.3]},{"type":"fade","args":[-1]}]' > recipe.json
npx audio '*.wav' --macro recipe.json -o '{name}.processed.{ext}'
```

### Generate a tone

```js
let TAU = Math.PI * 2, sr = 44100
let a = audio.from(i => Math.sin(440 * TAU * i / sr), { duration: 2, sampleRate: sr })
await a.save('440hz.wav')
```
```sh
npx audio --tone 440hz 2s -o tone.wav
```

### Sonify data

```js
let prices = [100, 102, 98, 105, 110, 95, 88, 92, 101, 107]
let sr = 44100, dur = 0.2
// FIXME: we have audio.from, a.transform - these are canonical stream names. But do they have same signature? Do from receives an index, transform receives a block? page? we should unify.
let a = audio.from(i => {
  let idx = Math.min(Math.floor(i / (sr * dur)), prices.length - 1)
  let freq = 200 + (prices[idx] - 80) * 10
  return Math.sin(freq * Math.PI * 2 * i / sr) * 0.5
}, { duration: prices.length * dur, sampleRate: sr })
await a.save('stock-sonification.wav')
```

### Extract features for ML

```js
let a = await audio('speech.wav')
let mfcc = await a.stat('cepstrum', { bins: 13 })
let spec = await a.stat('spectrum', { bins: 128 })
let [loud, rms] = await a.stat(['loudness', 'rms'])
```
```sh
npx audio speech.wav stat cepstrum --bins 13
npx audio speech.wav stat spectrum --bins 128
npx audio speech.wav stat loudness rms db
```

### Split a long file

```js
let a = await audio('audiobook.mp3')
let [ch1, ch2, ch3] = a.split(1800, 3600)
for (let [i, ch] of [ch1, ch2, ch3].entries())
  await ch.save(`chapter-${i + 1}.mp3`)
```
<!-- FIXME: we need test for this CLI -->
```sh
npx audio audiobook.mp3 split 30m 60m -o 'chapter-{i}.mp3'
```

### Remove a section

```js
let a = await audio('interview.wav')
// FIXME: this is a bit confusing: it removes 15s starting at 120s? we need to add comment
a.remove({ at: 120, duration: 15 })
// FIXME: and this: it fades in 100ms starting at 120s? but we have just removed it, no? Or that's next 2 mins? looks unclear the whole edit. Why do we need duration option here?
a.fade(0.1, { at: 120, duration: 0.1 })
await a.save('edited.wav')
```
```sh
npx audio interview.wav remove 2m..2m15s fade 0.1s 2m..2m0.1s -o edited.wav
```

### Stream to network (low memory)

```js
let a = await audio.open('2hour-mix.flac')
a.highpass(40).normalize('broadcast')
for await (let chunk of a.stream()) {
  socket.send(chunk[0].buffer)
}
```
```sh
npx audio 2hour-mix.flac highpass 40hz normalize broadcast | stream-to-icecast
```
<!-- FIXME: stream-to-icecast can be a package from audiojs ecosystem -->

### Voiceover on music

```js
let music = await audio('bg.mp3')
let voice = await audio('narration.wav')
music.gain(-12)
// FIXME: mix should have level and fade options, or actually we can test ourselves to apply fade, gain and then mix into other file - so that ops would be applied to mixable file first, right?
music.mix(voice, { at: 2 })
await music.save('mixed.wav')
```
```sh
npx audio bg.mp3 gain -12db mix narration.wav 2s -o mixed.wav
```

### Stereo autopan
<!-- FIXME: we can also add example of AM -->
```js
let a = await audio('song.wav')
a.pan(t => Math.sin(t * 0.5))
await a.save('autopan.wav')
```

### Detect clipping

```js
let a = await audio('master.wav')
// FIXME: should that stat return only count, or exact indexer or timestamps?
let clips = await a.stat('clip')
if (clips > 0) console.warn(`${clips} clipped samples — reduce gain`)
```
```sh
npx audio master.wav stat clip
```

### Playback with seek

```js
let a = await audio('episode.mp3')
a.play({ volume: -3 })
a.seek(300)
a.pause()
a.resume()
// FIXME: volume also needed here, right?
```
```sh
npx audio episode.mp3 --play --volume -3db
```

### A/B compare loudness

```js
let a = await audio('mix-v1.wav'), b = await audio('mix-v2.wav')
let [la, lb] = await Promise.all([a.stat('loudness'), b.stat('loudness')])
console.log(`v1: ${la.toFixed(1)} LUFS  v2: ${lb.toFixed(1)} LUFS  Δ${(lb - la).toFixed(1)}`)
```
```sh
npx audio mix-v1.wav mix-v2.wav stat loudness
```

### Pipe through stdin/stdout

<!-- FIXME: we should test it works -->
```sh
curl -s https://example.com/speech.mp3 | npx audio gain -3db normalize -o clean.wav
ffmpeg -i video.mp4 -f wav - | npx audio trim normalize podcast > voice.wav
```

### Custom op — bitcrusher

```js
const crush = (chs, ctx) => {
  let bits = ctx.args[0] ?? 8, steps = 2 ** bits
  return chs.map(ch => {
    let o = new Float32Array(ch.length)
    for (let i = 0; i < ch.length; i++)
      o[i] = Math.round(ch[i] * steps) / steps
    return o
  })
}
audio.op('crush', crush)

let a = await audio('drums.wav')
a.crush(4)
await a.save('crushed.wav')
```

### Serialize edits, restore later

```js
let a = await audio('voice.mp3')
a.trim().normalize('podcast').fade(0.3, 0.5)

let json = JSON.stringify(a)                // { source, edits, ... }
// ... persist to DB, send to worker, etc.
let b = await audio(JSON.parse(json))       // re-decode + replay edits
await b.save('restored.wav')
```

### Ringtone from any song

```js
let a = await audio('song.mp3')
a.crop({ at: 45, duration: 30 })
a.fade(0.5, 2)
a.normalize()
await a.save('ringtone.mp3')
```
```sh
npx audio song.mp3 crop 45s..1m15s fade 0.5s -2s normalize -o ringtone.mp3
```

### Glitch: stutter + reverse segments

```js
let a = await audio('beat.wav')
let v = a.view({ at: 1, duration: 0.25 })  // grab a 250ms slice
let glitch = v.concat(v, v, v)              // 4x stutter
glitch.reverse({ at: 0.25, duration: 0.25 })  // reverse 2nd hit
glitch.gain(t => -12 * t)                  // decay into silence
await glitch.save('glitch.wav')
```

<!--
### ✴ Visionary

_Not yet implemented — aspirational APIs. If these resonate, open an issue._

**Split on silence** — auto-detect pauses, split into segments.
```js
let parts = a.split('silence', { threshold: -40, minDuration: 0.5 })
for (let [i, p] of parts.entries()) await p.save(`segment-${i}.mp3`)
```
```sh
npx audio lecture.mp3 split --silence -40db 0.5s -o 'segment-{i}.mp3'
```

**Pitch shift / time stretch** — change pitch without duration, or duration without pitch. (`a.speed(rate)` changes both; these are independent ops.)
```js
a.pitch(12)                                // up one octave, same duration
a.pitch(-7)                                // down a fifth, same duration
a.stretch(0.8)                             // 80% speed, same pitch
a.stretch(2)                               // double duration, same pitch
```
```sh
npx audio vocals.wav pitch +12 -o octave-up.wav
npx audio vocals.wav stretch 0.8x -o slow.wav
```

**Noise gate / denoise** — suppress or remove background noise.
```js
a.gate(-40)                                // silence below -40dB
a.denoise()                                // spectral noise reduction
a.denoise(noiseProfile)                    // from a noise sample
```
```sh
npx audio interview.wav denoise -o clean.wav
npx audio interview.wav gate -40db -o gated.wav
```

**Auto-duck** — sidechain: duck music under voice automatically.
```js
music.duck(voice, { threshold: -20, reduction: -12, attack: 0.1, release: 0.5 })
```
```sh
npx audio bg.mp3 duck narration.wav -20db -12db -o ducked.wav
```

**Beat detection** — find tempo, beat positions, downbeats.
```js
let { bpm, beats } = await a.stat('beats')
a.split(...beats)                          // cut on every beat
```
```sh
npx audio track.wav stat beats
```

**Source separation** — isolate vocals, drums, bass, other.
```js
let { vocals, drums, bass, other } = await a.separate()
await vocals.save('vocals.wav')
```
```sh
npx audio song.mp3 separate --stem vocals -o vocals.wav
```

**Spectrogram ↔ audio** — render audio as image, or resynthesize from image.
```js
let img = await a.stat('spectrogram', { width: 1024, height: 512 })  // ImageData
let b = await audio.from(img, { type: 'spectrogram' })               // Griffin-Lim
```

**Crossfade concat** — overlap-add join with automatic crossfade.
```js
let ep = intro.concat(body, outro, { crossfade: 2 })
```
```sh
npx audio intro.mp3 + body.wav + outro.mp3 --crossfade 2s -o episode.mp3
```

**Loudness match** — match loudness across a batch of files.
```js
await audio.match('loudness', -14, [a, b, c])    // all to -14 LUFS
```
```sh
npx audio '*.wav' match loudness -14lufs -o '{name}.matched.{ext}'
```

**Live processing** — real-time effect chain on mic/stream input.
```js
let a = audio.live({ input: 'mic' })
a.highpass(80).notch(60).gain(-3)
a.connect(audioContext.destination)         // monitor output
```
-->


## Architecture

### File Guide

| File | Role |
|------|------|
| **`core.js`** | Engine — decode, paginate, plugin registry (`audio.stat`, `audio.fn`, `audio.hook`), instance factory, page I/O. The only required file. |
| **`stats.js`** | Block-level stat engine — computes min/max/energy/clip/dc per `BLOCK_SIZE`-sample block during decode. Powers waveform display, loudness measurement, and stat queries without touching PCM. |
| **`cache.js`** | Page cache — LRU eviction to OPFS and on-demand restore. Keeps large files playable without exhausting RAM. |
| **`history.js`** | Edit pipeline — non-destructive edit list, plan builder, stream renderer. Turns `a.gain(-3).trim()` into a declarative plan that materializes on read. |
| **`audio.js`** | Full bundle — imports core + stats + cache + history + all plugins, calls `audio.use()`. The default import. |
| **`fn/*.js`** | Plugins — each file exports one op, stat, or method. Self-contained, independently importable. |
| **`bin/cli.js`** | CLI — parses args, auto-discovers plugins, runs ops, handles batch/glob/macro/playback. |

### Concepts

**Stream-first** means no operation touches the full PCM at once. Audio is stored in pages. Decode streams pages progressively. Every output — `read()`, `stream()`, `play()`, `save()`, `stat()` — walks pages one chunk at a time through the edit pipeline. A 2-hour file never needs 2 hours of float arrays in memory.

**Non-destructive editing** means ops don't mutate source pages. `a.gain(-3).crop({at: 1, duration: 5})` pushes two entries to `a.edits`. Source data stays immutable. The edit list replays on demand — and can be undone, serialized, or reapplied.

**Plan** is the compiled form of the edit list. `buildPlan(a)` walks all edits and produces:

- **Segment map** — which source ranges map to which output positions (structural ops: crop, remove, insert, repeat, pad). Like a virtual timeline of pointers.
- **Sample pipeline** — transforms applied per page in order (gain, fade, reverse, filter, pan). Each op receives one page-sized chunk and processes every sample in a tight loop. Page size bounds memory allocation per step, not processing cost — the same samples get touched either way.
- **Stat-conditioned resolution** — ops like `trim` and `normalize` inspect pre-computed stats at plan time to emit concrete ops (crop, gain). No extra decode pass needed.

```
source pages ──→ segment map ──→ sample pipeline ──→ output chunks
(Float32)        (structural)    (per-page ops)     (stream or flat)
```

### Pages and blocks

Audio is fragmented at two levels — **pages** for storage, **blocks** for processing:

| | `PAGE_SIZE` (default 65536) | `BLOCK_SIZE` (default 1024) |
|-|---|---|
| **What** | Samples per storage chunk | Samples per processing unit |
| **Stores** | Float32Array[] per channel | min, max, energy, clip, dc per block |
| **Purpose** | Memory management, cache eviction, decode streaming | Op processing, stat computation, waveform resolution |
| **Memory** | PCM data — evictable to OPFS | Stats — always resident (~7 MB for 2h stereo) |

**Pages** set the streaming granularity. The edit pipeline materializes one block at a time: read source samples → apply structural ops (segment map) → run sample transforms (gain, fade, filter) → yield output block. This bounds peak memory to one block per channel, regardless of file length. Cache eviction works at page granularity: cold pages offload to OPFS, hot pages near the playhead (via `seek()`) stay resident.

Ops and stats both process in `BLOCK_SIZE` chunks — same unit, same granularity. This matches Web Audio API design (128-sample render quantum). Stateful ops like filters carry state sample-to-sample within and across blocks. Keep `PAGE_SIZE` large (minutes of audio) as the memory/storage unit; `BLOCK_SIZE` small (1024 default) as the processing unit.

**Blocks** are the stat unit. During decode, each page is subdivided into block-sized windows. Per block: min/max/energy/clip/dc are computed and stored. These power instant waveform rendering, loudness measurement (LUFS), and stat-conditioned ops (trim, normalize) — all without touching PCM.

Both are configurable — set before creating any instances:

```js
audio.PAGE_SIZE = 131072  // 128K samples — larger pages, fewer allocs
audio.BLOCK_SIZE = 256    // finer stat resolution — smoother waveforms
```

Each instance's stats record `stats.blockSize` — the block size used at its decode time.

**Waveform zoom and block resolution.** `BLOCK_SIZE` sets the finest pre-computed stat resolution. Three zoom regimes:

- **Zoomed out** (many samples per pixel): `stat('max', { bins })` aggregates multiple blocks into fewer bins. Pre-computed stats suffice — no PCM access.
- **1:1** (one block per pixel): stats render directly.
- **Zoomed in** (fewer samples than one block per pixel): read PCM from pages for sample-accurate waveform. The page cache makes this fast for the visible region.

Changing `BLOCK_SIZE` cannot retroactively refine existing stats. For finer resolution in a zoomed region, read the PCM — pages are always available.

### Three import paths

```js
import audio from 'audio'            // full bundle — all ops, stats, cache
import audio from 'audio/core.js'    // bare engine — no ops, no cache
import gain from 'audio/fn/gain.js'  // individual plugin
```

### Browser

Pre-built ESM bundles in `dist/`:

| File | Size | Use |
|------|------|-----|
| `audio.min.js` | 65K | Core + codec dispatch. Codecs load on demand via `import()`. |
| `audio.js` | 118K | Same, unminified. |
| `audio.all.js` | 10M | Everything bundled. Zero-config, nothing else needed. |

**Quick start** — single script, no build step:

```html
<script type="module">
  import audio from './dist/audio.all.js'
  let a = await audio('./song.mp3')
  a.play()
</script>
```

**Production** — slim bundle + import map. Only mapped codecs get downloaded, and only when that format is first opened:

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
  let a = await audio('./voice.wav')   // fetches @audio/decode-wav on first use
</script>
```

Codecs are lazy — `audio-decode` calls `import('mpg123-decoder')` only when an MP3 file is opened. Unmapped formats throw at decode time, not at load time.

<details><summary>All codec packages</summary>
<!-- FIXME: just give one importmap for production instead of this table -->
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
| [audio-encode](https://github.com/audiojs/audio-encode) | Codec encoding |
| [audio-filter](https://github.com/audiojs/audio-filter) | Filters (weighting, EQ, auditory) |
| [audio-speaker](https://github.com/audiojs/audio-speaker) | Audio output (Node) |
| [audio-type](https://github.com/nickolanack/audio-type) | Format detection |
| [pcm-convert](https://github.com/nickolanack/pcm-convert) | PCM format conversion |



<p align="center"><a href="./license.md">MIT</a> · <a href="https://github.com/krishnized/license">ॐ</a></p>
