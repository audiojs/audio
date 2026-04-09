# Reference

See also: [Architecture](architecture.md) · [Recipes](recipes.md) · [Plugins](plugins.md)

<table><tr><td valign="top">

**[Create](#create)**<br>
<sub>[audio()](#audiosource-opts) · [audio.from()](#audiofromsource-opts) · [audio()](#audio-1)</sub>

**[Properties](#properties)**

**[Structural](#structural)**<br>
<sub>[crop](#acropat-duration) · [remove](#aremoveat-duration) · [insert](#ainsertsource-at) · [repeat](#arepeatn-at-duration) · [pad](#apadbefore-after) · [speed](#aspeedrate) · [reverse](#areverseat-duration) · [split](#asplitoffsets) · [view](#aviewat-duration) · [concat](#aconcatsources)</sub>

**[Sample](#sample)**<br>
<sub>[gain](#againvalue-at-duration-channel-unit) · [fade](#afadein-out-curve) · [mix](#amixother-at-duration) · [write](#awritedata-at) · [remix](#aremixchannels) · [pan](#apanvalue-at-duration-channel)</sub>

**[Smart](#smart)**<br>
<sub>[trim](#atrimthreshold) · [normalize](#anormalizetarget)</sub>

**[Filter](#filter)**<br>
<sub>[highpass](#ahighpassfreq) · [lowpass](#alowpassfreq) · [bandpass](#abandpassfreq-q) · [notch](#anotchfreq-q) · [lowshelf](#alowshelffreq-gain-q) · [highshelf](#ahighshelffreq-gain-q) · [eq](#aeqfreq-gain-q) · [filter](#afiltertype-params)</sub>

</td><td valign="top">

**[I/O](#io)**<br>
<sub>[read](#areadopts) · [encode](#aencodeformat-opts) · [save](#asavetarget-opts) · [stream](#astreamopts) · [clone](#aclone)</sub>

**[Playback](#playback)**<br>
<sub>[play](#aplayopts) · [pause](#apause) · [resume](#aresume) · [stop](#astop) · [seek](#aseekt)</sub>

**[Recording](#recording)**<br>
<sub>[record](#arecordopts) · [push](#apushdata-format)</sub>

**[Analysis](#analysis)**<br>
<sub>[stat](#astatname-opts)</sub>

**[Events](#events)**<br>
<sub>[on](#aonevent-fn) · [off](#aoffevent-fn) · [dispose](#adispose)</sub>

**[History](#history)**<br>
<sub>[undo](#aundon) · [run](#arunedits) · [JSON](#jsonstringifya--audiojson)</sub>

**[Custom](#custom)**<br>
<sub>[audio.op](#audioopname-descriptor) · [audio.stat](#audiostatname-descriptor) · [transform](#atransformfn)</sub>

**[CLI](#cli)** · **[Browser](#browser)**

</td></tr></table>

## Create

### audio(source, opts?)

Returns instance immediately — edits chain before decode completes. Thenable: `await` waits for full decode.

```js
let a = audio('file.mp3')                // returns instantly, decodes in background
a.gain(-3).trim()                        // edits queue before decode finishes
await a.save('out.wav')                  // consuming ops wait internally

let b = await audio('file.mp3')          // wait for full decode
let c = await audio(url)                 // URL string or URL object
let d = await audio(uint8array)          // encoded bytes (ArrayBuffer or Uint8Array)
let e = audio([a, b])                    // concat from array of sources
let f = await audio(JSON.parse(json))    // restore from serialized document
```

Options: `{ sampleRate, channels, storage: 'memory' | 'persistent' | 'auto' }`.

### audio.from(source, opts?)

Sync — wraps existing PCM without decoding, no I/O.

```js
let a = audio.from([left, right])        // Float32Array[] channels
let b = audio.from(3, { channels: 2 })  // 3 seconds of silence
let c = audio.from(audioBuffer)          // Web Audio AudioBuffer
let d = audio.from(t => Math.sin(440 * TAU * t), { duration: 1, sampleRate: 44100 })
let e = audio.from(int16arr, { format: 'int16' })
```

Encoded sources are paged (64K-sample chunks, evictable to OPFS for large files). PCM sources via `audio.from()` are always resident in memory. Subscribe to `metadata` for early access before full decode:

```js
let a = audio('large.mp3')
a.on('metadata', ({ sampleRate, channels }) => {
  a.play()                                // sampleRate/channels available
  for await (let block of a.stream()) {}  // streams as it decodes
})
```

### audio()

No source — creates a pushable instance for `.push()`, `.record()`, or `.stop()`.

```js
let a = audio()
a.push(float32chunk)                     // feed PCM data
a.push(int16arr, 'int16')               // typed arrays convert automatically
a.push(buf, { format: 'int16', channels: 2 })
a.stop()                                 // drain + finalize
```

## Properties

```js
a.sampleRate                // Hz (44100, 48000, …)
a.channels                  // effective channel count (reflects remix edits)
a.duration                  // seconds (reflects edits)
a.length                    // samples (reflects edits)
a.source                    // original path/URL or null
a.pages                     // Float32Array[][] — decoded PCM pages
a.stats                     // per-block stats (min/max/energy/…)
a.edits                     // edit list (inspectable)
a.ready                     // Promise<true> — resolves when metadata ready
a.currentTime               // playback/seek position in seconds
a.playing                   // boolean
a.paused                    // boolean
a.recording                 // boolean — true while mic is active
a.volume                    // dB (0 = unity)
a.loop                      // boolean
a.block                     // Float32Array — current playback block (for visualization)
a.version                   // monotonic edit counter
```

All edit ops are sync, chainable, non-destructive — they push to the edit list, source pages are never mutated. Sample ops accept `{at, duration, channel}` to scope the effect.

## Structural

### a.crop({at?, duration?})

Keep only the specified range, discard the rest.

```js
a.crop({ at: 1, duration: 5 })          // keep seconds 1–6
a.crop({ at: 10 })                      // keep from 10s onward
a.crop({ duration: 30 })                // keep first 30s
```

### a.remove({at?, duration?})

Cut a range and close the gap.

```js
a.remove({ at: 10, duration: 2 })       // delete seconds 10–12
a.remove({ at: 0, duration: 0.5 })      // remove first half-second
```

### a.insert(source, {at?})

Insert audio or silence at a position.

```js
a.insert(intro, { at: 0 })              // prepend another audio
a.insert(3)                              // append 3 seconds of silence
a.insert(3, { at: 0 })                  // prepend 3s silence
a.insert(outro)                          // append at end (default)
```

### a.repeat(n, {at?, duration?})

Repeat a range (or the whole audio) n times.

```js
a.repeat(2)                              // double the audio
a.repeat(4, { at: 0, duration: 1 })     // repeat first second 4 times
```

### a.pad(before, after?)

Add silence at the edges.

```js
a.pad(1)                                 // 1s silence on both sides
a.pad(0.5, 2)                           // 0.5s before, 2s after
a.pad(0, 1)                             // 1s at the end only
```

### a.speed(rate)

Change playback speed — affects both pitch and duration.

```js
a.speed(2)                               // double speed (half duration)
a.speed(0.5)                             // half speed (double duration)
```

### a.reverse({at?, duration?})

Reverse the audio or a range within it.

```js
a.reverse()                              // reverse entire audio
a.reverse({ at: 5, duration: 2 })       // reverse 2s starting at 5s
```

### a.split(...offsets)

Split into multiple views at the given time points (zero-copy).

```js
let [a, b, c] = audio.split(10, 20)     // 3 parts: 0–10s, 10–20s, 20–end
let chapters = audiobook.split(1800, 3600)
```

### a.view({at?, duration?})

Return a non-destructive view of a range (zero-copy).

```js
let intro = a.view({ duration: 10 })     // first 10 seconds
let outro = a.view({ at: a.duration - 5 })
```

### a.concat(...sources)

Concatenate other audio sources onto this instance.

```js
a.concat(b, c, d)                       // append b, c, d in order
```

## Sample

### a.gain(value, {at?, duration?, channel?, unit?})

Adjust volume in dB. Pass a function for automation.

```js
a.gain(-3)                               // reduce by 3dB
a.gain(6, { at: 10, duration: 5 })      // boost 6dB from 10s for 5s
a.gain(0.5, { unit: 'linear' })         // halve amplitude
a.gain(t => -3 * t)                     // linear fade-down over time
a.gain(-6, { channel: 0 })              // left channel only
```

### a.fade(in, out?, curve?)

Fade in from start and/or out from end. Curves: `'linear'` (default), `'exp'`, `'log'`, `'cos'`.

```js
a.fade(0.5)                              // fade in first 0.5s
a.fade(-1)                               // fade out last 1s
a.fade(0.5, 2)                          // 0.5s fade in, 2s fade out
a.fade(-1, 'exp')                        // exponential fade out
```

### a.mix(other, {at?, duration?})

Overlay another audio source (additive).

```js
a.mix(voice)                             // overlay from start
a.mix(voice, { at: 2 })                 // overlay starting at 2s
a.mix(sfx, { at: 10, duration: 3 })     // overlay 3s of sfx at 10s
```

### a.write(data, {at?})

Overwrite samples at a position with raw PCM data.

```js
a.write([left, right], { at: 2 })       // overwrite from 2s with stereo PCM
a.write(monoFloat32, { at: 0 })         // overwrite from start
```

### a.remix(channels)

Change channel count.

```js
a.remix(1)                               // stereo → mono
a.remix(2)                               // mono → stereo
```

### a.pan(value, {at?, duration?, channel?})

Stereo balance (−1 left, 0 center, 1 right). Pass a function for automation.

```js
a.pan(-0.5)                              // shift left
a.pan(1)                                 // full right
a.pan(t => Math.sin(t * 2))             // oscillating pan
```

## Smart

Smart ops analyze the audio first (scan stats), then queue a basic op — `trim` becomes `crop`, `normalize` becomes `gain`.

### a.trim(threshold?)

Remove leading and trailing silence.

```js
a.trim()                                 // auto threshold
a.trim(-30)                              // custom -30dB threshold
```

### a.normalize(target?)

Loudness normalization — scans stats, applies gain to hit target.

```js
a.normalize()                            // peak normalize to 0dBFS
a.normalize(-1)                          // peak normalize to -1dBFS
a.normalize('podcast')                   // -16 LUFS (podcast standard)
a.normalize('streaming')                 // -14 LUFS (Spotify/YouTube)
a.normalize('broadcast')                 // -23 LUFS (EBU R128)
a.normalize({ mode: 'lufs', target: -14 })
a.normalize({ mode: 'rms', target: -18 })
a.normalize({ ceiling: -0.3 })          // peak limit at -0.3dB
```

## Filter

Built-in IIR filters via [audio-filter](https://github.com/audiojs/audio-filter). Stateful across streaming chunks.

### a.highpass(freq)

Remove frequencies below the cutoff.

```js
a.highpass(80)                           // cut below 80Hz
```

### a.lowpass(freq)

Remove frequencies above the cutoff.

```js
a.lowpass(8000)                          // cut above 8kHz
```

### a.bandpass(freq, Q?)

Pass only frequencies around the center.

```js
a.bandpass(1000, 2)                      // narrow band around 1kHz
```

### a.notch(freq, Q?)

Remove a narrow band of frequencies.

```js
a.notch(60)                              // remove 60Hz hum
a.notch(50, 10)                          // narrow 50Hz notch (EU mains)
```

### a.lowshelf(freq, gain?, Q?)

Boost or cut frequencies below a point.

```js
a.lowshelf(200, -3)                      // cut 3dB below 200Hz
a.lowshelf(100, 6)                       // boost 6dB below 100Hz
```

### a.highshelf(freq, gain?, Q?)

Boost or cut frequencies above a point.

```js
a.highshelf(8000, 2)                     // add 2dB brightness above 8kHz
a.highshelf(10000, -4)                   // cut harshness above 10kHz
```

### a.eq(freq, gain?, Q?)

Parametric EQ — surgical frequency control.

```js
a.eq(1000, 3, 2)                        // boost 3dB at 1kHz, Q=2
a.eq(250, -4, 1)                         // cut 4dB at 250Hz, wide
```

### a.filter(type, ...params)

Generic filter dispatch.

```js
a.filter('highpass', 80)
a.filter('eq', 1000, 3, 2)
a.filter(customFn, { cutoff: 2000 })     // custom filter function
```

## I/O

### a.read(opts?)

Read rendered PCM data.

```js
let pcm = await a.read()                          // Float32Array[]
let pcm = await a.read({ at: 5, duration: 2 })   // range
let ch0 = await a.read({ channel: 0 })           // single channel
let raw = await a.read({ format: 'int16' })       // format conversion
let wav = await a.read({ format: 'wav' })         // encode to bytes
```

### a.encode(format?, opts?)

Encode to bytes without saving to disk.

```js
let wav = await a.encode('wav')
let mp3 = await a.encode('mp3', { at: 0, duration: 30 })
```

### a.save(target, opts?)

Encode and write to file. Format from extension.

```js
await a.save('out.wav')
await a.save('out.mp3')
await a.save('clip.wav', { at: 10, duration: 5 })
```

### a.stream(opts?)

Async iterator over materialized blocks.

```js
for await (let block of a.stream()) process(block)
for await (let block of a.stream({ at: 10, duration: 5 })) { ... }
```

### a.clone()

Deep copy with independent edit history (pages shared).

```js
let b = a.clone()
b.gain(-6)                               // does not affect a
```

## Playback

### a.play(opts?)

Start playback.

```js
a.play()                                 // play from start
a.play({ at: 10, duration: 5 })         // play range
a.play({ volume: -6, loop: true })      // quieter, looping
```

### a.pause()

Pause playback, preserving position.

### a.resume()

Resume from where it was paused.

### a.stop()

Stop playback and/or recording.

### a.seek(t)

Jump to a position in seconds.

```js
a.seek(30)                               // jump to 30s
a.seek(0)                                // back to start
```

## Recording

### a.record(opts?)

Start recording from microphone (requires `audio-mic`).

```js
let a = audio()
a.record()
// ... later ...
a.stop()
a.trim().normalize()
await a.save('recording.wav')
```

### a.push(data, format?)

Feed PCM data into a pushable instance.

```js
a.push(float32chunk)
a.push(int16arr, 'int16')
a.push(buf, { format: 'int16', channels: 2 })
```

## Analysis

All stat queries are async — instant from block stats when clean. `{at, duration}` for sub-ranges, `{bins}` for waveform data.

| Stat | Returns |
|------|---------|
| `'db'` | Peak dBFS |
| `'rms'` | RMS level |
| `'loudness'` | Integrated LUFS (BS.1770) |
| `'clip'` | Clipped sample count |
| `'dc'` | DC offset |
| `'min'` / `'max'` | Min/max sample values |
| `'spectrum'` | Mel spectrum (dB) |
| `'cepstrum'` | MFCCs |
| `'silence'` | Silent regions `[{at, duration}, ...]` |

### a.stat(name, opts?)

Query a named statistic.

```js
await a.stat('db')
await a.stat('max', { bins: 800 })                       // waveform
await a.stat('max', { bins: 800, channel: [0, 1] })     // per-channel
let [mn, mx] = await a.stat(['min', 'max'], { bins: 800 })
let [peak, loud] = await a.stat(['db', 'loudness'], { at: 10, duration: 5 })
let spec = await a.stat('spectrum', { bins: 128 })
let mfcc = await a.stat('cepstrum', { bins: 13 })
let regions = await a.stat('silence', { threshold: -40, minDuration: 0.5 })
```

## Events

| Event | Payload | When |
|-------|---------|------|
| `'change'` | — | Edit list changed |
| `'data'` | `{delta, offset}` | New stat blocks during decode/record |
| `'metadata'` | `{sampleRate, channels}` | Metadata available (before full decode) |
| `'timeupdate'` | seconds | Playback position changed |
| `'ended'` | — | Playback finished |
| `'progress'` | `{offset, total}` | Encoding progress during save/encode |

### a.on(event, fn)

Subscribe. Returns `this` for chaining.

```js
a.on('change', () => redraw())
a.on('data', ({ delta, offset }) => appendWaveform(delta))
a.on('timeupdate', t => updateCursor(t))
```

### a.off(event, fn)

Unsubscribe a specific listener.

### a.dispose()

Release all resources. Also available as `a[Symbol.dispose]()`.

```js
a.dispose()
```

## History

### a.undo(n?)

Pop the last edit (or last n edits).

```js
let edit = a.undo()                      // undo last edit
a.undo(3)                               // undo last 3 edits
```

### a.run(...edits)

Push raw edit objects onto the edit list.

```js
a.run({ type: 'gain', args: [-3] })
a.run(edit1, edit2, edit3)               // apply in order
let edit = a.undo(); a.run(edit)         // redo
```

### JSON.stringify(a) / audio(json)

Serialize to JSON and restore.

```js
let json = JSON.stringify(a)             // { source, edits, sampleRate, channels, duration }
let b = await audio(JSON.parse(json))    // re-decode + replay all edits
```

## Custom

### audio.op(name, descriptor)

Register a custom op — all instances gain the method. See [Plugins](plugins.md).

```js
audio.op('crush', (chs, ctx) => {
  let steps = 2 ** (ctx.args[0] ?? 8)
  return chs.map(ch => ch.map(s => Math.round(s * steps) / steps))
})

a.crush(4)                               // chainable, serializable, undoable
a.crush(4, { at: 1, duration: 2 })      // scoped to range
```

### audio.stat(name, descriptor)

Register a custom stat computed during decode. See [Plugins](plugins.md).

```js
audio.stat('zeroCrossings', {
  block: (chs) => chs.map(ch => {
    let count = 0
    for (let i = 1; i < ch.length; i++)
      if ((ch[i] >= 0) !== (ch[i-1] >= 0)) count++
    return count
  }),
  reduce: (src, from, to) => {
    let sum = 0
    for (let i = from; i < to; i++) sum += src[i]
    return sum
  }
})
```

### a.transform(fn)

One-off inline processor — not registered, not serialized. `ctx` provides `{ sampleRate, blockSize, at, duration, blockOffset }`.

```js
a.transform((channels, ctx) => {
  for (let ch of channels)
    for (let i = 0; i < ch.length; i++)
      ch[i] *= 0.5
  return channels
})
```

## CLI

```sh
npx audio in.mp3                                 # open player
npx audio in.mp3 -p                              # autoplay
npx audio in.mp3 -i                              # file info
npx audio in.mp3 gain -3db trim normalize -o out.wav
npx audio in.wav gain -3db 1s..10s -o out.wav
npx audio in.mp3 highpass 80hz lowshelf 200hz -3db -o out.wav
npx audio '*.wav' gain -3db -o '{name}.out.{ext}'  # batch
npx audio in.wav --macro recipe.json -o out.wav
npx audio gain --help                            # per-op help
cat in.wav | audio gain -3db > out.wav
```

Ranges: `1s..10s`, `30s..1m`, `-1s..`. Units: `s`, `ms`, `m`, `h`, `db`, `hz`, `khz`.

Flags: `-i` info, `-p` play, `-f` force, `--verbose`, `--format`, `-o` output, `--macro`.

Tab completion:

```sh
eval "$(audio --completions zsh)"       # add to ~/.zshrc
eval "$(audio --completions bash)"      # add to ~/.bashrc
audio --completions fish | source       # fish
```

## Browser

Pre-built ESM bundles in `dist/`:

| File | Size | Use |
|------|------|-----|
| `audio.min.js` | 65K | Core + codec dispatch. Codecs load on demand. |
| `audio.js` | 118K | Unminified. |
| `audio.all.js` | 10M | Everything bundled. Zero-config. |

Quick start:

```html
<script type="module">
  import audio from './dist/audio.all.js'
  let a = await audio('./song.mp3')
  a.play()
</script>
```

Production — slim bundle + import map:

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

Codecs are lazy — `audio-decode` calls `import('mpg123-decoder')` only when an MP3 file is opened. Unmapped formats throw at decode time, not load time.

<details><summary>All codec packages</summary>

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
