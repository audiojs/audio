# Reference

See also: [Architecture](architecture.md) · [Recipes](recipes.md) · [Plugins](plugins.md)

## Create

### audio(source, opts?)

Load audio from any source. Returns instance immediately — edits chain before decode completes. Thenable: `await` waits for full decode.

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

Sync entry — wraps existing PCM without decoding. No I/O, no waiting.

```js
let a = audio.from([left, right])        // Float32Array[] channels
let b = audio.from(3, { channels: 2 })  // 3 seconds of silence
let c = audio.from(audioBuffer)          // Web Audio AudioBuffer
let d = audio.from(t => Math.sin(440 * TAU * t), { duration: 1, sampleRate: 44100 })
let e = audio.from(int16arr, { format: 'int16' })
```

Encoded sources are paged (64K-sample chunks, evictable to OPFS for large files). PCM sources via `audio.from()` are always resident in memory.

**Streaming access** — subscribe to `metadata` for early access before full decode:

```js
let a = audio('large.mp3')
a.on('metadata', ({ sampleRate, channels }) => {
  a.play()                                // sampleRate/channels available
  for await (let block of a.stream()) {}  // streams as it decodes
})
```

### audio()

No source — creates a pushable instance. Think of it as a tape recorder: write data with `.push()`, start the mic with `.record()`, finalize with `.stop()`.

```js
let a = audio()
a.push(float32chunk)                     // feed PCM data
a.push(int16arr, 'int16')               // typed arrays convert automatically
a.push(buf, { format: 'int16', channels: 2 })
a.stop()                                 // drain + finalize
```

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `sampleRate` | `number` | Sample rate in Hz |
| `channels` | `number` | Effective channel count (reflects remix edits) |
| `duration` | `number` | Effective duration in seconds (reflects structural edits) |
| `length` | `number` | Total samples (reflects structural edits) |
| `source` | `string \| null` | Original path/URL, or null for PCM-backed |
| `pages` | `Float32Array[][]` | Decoded PCM pages |
| `stats` | `AudioStats` | Per-channel, per-block min/max/energy |
| `edits` | `EditOp[]` | Edit list (inspectable) |
| `version` | `number` | Monotonic counter, increments on edit/undo |
| `ready` | `Promise<true>` | Resolves when fully decoded |
| `currentTime` | `number` | Playhead position in seconds (read/write) |
| `playing` | `boolean` | True during playback |
| `paused` | `boolean` | True when paused |
| `recording` | `boolean` | True while mic is active |
| `volume` | `number` | Playback volume in dB (0 = unity) |
| `loop` | `boolean` | Whether playback loops |
| `block` | `Float32Array \| null` | Current playback block (for visualization) |

## Edit

All ops are sync, chainable, non-destructive. They push to the edit list — source pages are never mutated.

All sample ops accept `{at, duration, channel}` as trailing options to scope the effect:

```js
a.gain(-3, { at: 1, duration: 5 })      // apply only to 1s–6s
a.gain(-6, { channel: 0 })              // left channel only
a.gain(-6, { channel: [0, 1] })         // specific channels
```

### Structural

#### a.crop({at?, duration?})

Keep only the specified time range, discard the rest. Like selecting a region and deleting everything outside it.

```js
a.crop({ at: 1, duration: 5 })          // keep seconds 1–6
a.crop({ at: 10 })                      // keep from 10s onward
a.crop({ duration: 30 })                // keep first 30s
```

#### a.remove({at?, duration?})

Cut out a range and close the gap. The opposite of crop — removes the selection, keeps everything else.

```js
a.remove({ at: 10, duration: 2 })       // delete seconds 10–12
a.remove({ at: 0, duration: 0.5 })      // remove first half-second
```

#### a.insert(source, {at?})

Insert audio at a position. Accepts any source: another audio instance, a file path, PCM data, or a number (seconds of silence). Default: append at end.

```js
a.insert(intro, { at: 0 })              // prepend another audio
a.insert(3)                              // append 3 seconds of silence
a.insert(3, { at: 0 })                  // prepend 3s silence
a.insert(outro)                          // append at end (default)
```

#### a.repeat(n, {at?, duration?})

Repeat a range (or the whole audio) n times.

```js
a.repeat(2)                              // double the audio
a.repeat(4, { at: 0, duration: 1 })     // repeat first second 4 times
```

#### a.pad(before, after?)

Add silence at the edges. If only one argument, pads both sides equally.

```js
a.pad(1)                                 // 1s silence on both sides
a.pad(0.5, 2)                           // 0.5s before, 2s after
a.pad(0, 1)                             // 1s at the end only
```

#### a.speed(rate)

Change playback speed. Rate > 1 is faster, < 1 is slower. Affects both pitch and duration (like a tape speed change).

```js
a.speed(2)                               // double speed (half duration)
a.speed(0.5)                             // half speed (double duration)
```

#### a.reverse({at?, duration?})

Reverse the audio or a range within it.

```js
a.reverse()                              // reverse entire audio
a.reverse({ at: 5, duration: 2 })       // reverse 2s starting at 5s
```

#### a.split(...offsets)

Split into multiple views at the given time points. Returns an array of audio instances that share pages (zero-copy).

```js
let [a, b, c] = audio.split(10, 20)     // 3 parts: 0–10s, 10–20s, 20–end
let chapters = audiobook.split(1800, 3600)
```

#### a.view({at?, duration?})

Return a non-destructive view of a range. Shares pages with the original — no copy.

```js
let intro = a.view({ duration: 10 })     // first 10 seconds
let outro = a.view({ at: a.duration - 5 })
```

#### a.concat(...sources)

Concatenate other audio sources onto this instance.

```js
a.concat(b, c, d)                       // append b, c, d in order
```

### Sample

#### a.gain(value, {at?, duration?, channel?, unit?})

Adjust volume. Default unit is dB. Pass a function for automation (called per-sample with absolute time).

```js
a.gain(-3)                               // reduce by 3dB
a.gain(6, { at: 10, duration: 5 })      // boost 6dB from 10s for 5s
a.gain(0.5, { unit: 'linear' })         // halve amplitude
a.gain(t => -3 * t)                     // linear fade-down over time
a.gain(-6, { channel: 0 })              // left channel only
```

#### a.fade(in, out?, curve?)

Fade in from start and/or fade out from end. Positive = fade in, negative = fade out. Two-argument form does both at once.

```js
a.fade(0.5)                              // fade in first 0.5s
a.fade(-1)                               // fade out last 1s
a.fade(0.5, 2)                          // 0.5s fade in, 2s fade out
a.fade(-1, 'exp')                        // exponential fade out
a.fade(0.3, 'cos')                      // cosine-curved fade in
```

Curves: `'linear'` (default), `'exp'`, `'log'`, `'cos'`.

#### a.mix(other, {at?, duration?})

Overlay another audio source. Additive — signals sum together (may clip).

```js
a.mix(voice)                             // overlay from start
a.mix(voice, { at: 2 })                 // overlay starting at 2s
a.mix(sfx, { at: 10, duration: 3 })     // overlay 3s of sfx at 10s
```

#### a.write(data, {at?})

Overwrite samples at a position with raw PCM data.

```js
a.write([left, right], { at: 2 })       // overwrite from 2s with stereo PCM
a.write(monoFloat32, { at: 0 })         // overwrite from start
```

#### a.remix(channels)

Change channel count. Down-mixing averages channels; up-mixing duplicates.

```js
a.remix(1)                               // stereo → mono
a.remix(2)                               // mono → stereo
```

#### a.pan(value, {at?, duration?, channel?})

Stereo balance. −1 = full left, 0 = center, 1 = full right. No effect on mono. Pass a function for automation.

```js
a.pan(-0.5)                              // shift left
a.pan(1)                                 // full right
a.pan(t => Math.sin(t * 2))             // oscillating pan
```

### Smart

Smart ops analyze the audio first (scan stats), then queue a basic op. `trim` becomes `crop`, `normalize` becomes `gain`.

#### a.trim(threshold?)

Remove leading and trailing silence. Threshold in dB (default: auto-detected).

```js
a.trim()                                 // auto threshold
a.trim(-30)                              // custom -30dB threshold
```

#### a.normalize(target?)

Loudness normalization. Scans source stats, then applies the right amount of gain to hit the target.

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

### Filter

Built-in IIR filters via [audio-filter](https://github.com/audiojs/audio-filter). Filter state is maintained across streaming chunks — safe for real-time use.

#### a.highpass(freq)

Remove frequencies below the cutoff. Cleans up rumble and low-end noise.

```js
a.highpass(80)                           // cut below 80Hz
```

#### a.lowpass(freq)

Remove frequencies above the cutoff. Smooths out harsh high-end.

```js
a.lowpass(8000)                          // cut above 8kHz
```

#### a.bandpass(freq, Q?)

Pass only frequencies around the center. Q controls width (higher = narrower).

```js
a.bandpass(1000, 2)                      // narrow band around 1kHz
```

#### a.notch(freq, Q?)

Remove a narrow band of frequencies. Useful for eliminating hum or resonance.

```js
a.notch(60)                              // remove 60Hz hum
a.notch(50, 10)                          // narrow 50Hz notch (EU mains)
```

#### a.lowshelf(freq, gain?, Q?)

Boost or cut frequencies below a point. The gentle alternative to highpass — shapes rather than removes.

```js
a.lowshelf(200, -3)                      // cut 3dB below 200Hz
a.lowshelf(100, 6)                       // boost 6dB below 100Hz
```

#### a.highshelf(freq, gain?, Q?)

Boost or cut frequencies above a point. Add air, or tame sibilance.

```js
a.highshelf(8000, 2)                     // add 2dB brightness above 8kHz
a.highshelf(10000, -4)                   // cut harshness above 10kHz
```

#### a.eq(freq, gain?, Q?)

Parametric EQ. Surgical frequency control at a specific point.

```js
a.eq(1000, 3, 2)                        // boost 3dB at 1kHz, Q=2
a.eq(250, -4, 1)                         // cut 4dB at 250Hz, wide
```

#### a.filter(type, ...params)

Generic filter dispatch. Same result as the named methods above.

```js
a.filter('highpass', 80)
a.filter('eq', 1000, 3, 2)
a.filter(customFn, { cutoff: 2000 })     // custom filter function
```

### Inline

#### a.transform(fn)

Apply a custom per-block processor. Receives all channels for each block, returns modified channels. Return `false` to skip the block (no-op).

```js
a.transform((channels, ctx) => {
  for (let ch of channels)
    for (let i = 0; i < ch.length; i++)
      ch[i] *= 0.5
  return channels
})
```

`ctx` provides `{ sampleRate, blockSize, at, duration, blockOffset }`.

### History

#### a.undo(n?)

Pop the last edit (or last n edits). Returns the removed edit(s).

```js
let edit = a.undo()                      // undo last edit
a.undo(3)                               // undo last 3 edits
```

#### a.run(...edits)

Push raw edit objects onto the edit list. Useful for replaying undone edits or applying macros.

```js
a.run({ type: 'gain', args: [-3] })
a.run(edit1, edit2, edit3)               // apply in order

let edit = a.undo()
a.run(edit)                              // redo
```

#### JSON.stringify(a) / audio(json)

Serialize the document to JSON. Restore by passing the parsed object back to `audio()`. Edit history + source reference are preserved.

```js
let json = JSON.stringify(a)             // { source, edits, sampleRate, channels, duration }
let b = await audio(JSON.parse(json))    // re-decode + replay all edits
```

## I/O

### a.read(opts?)

Read rendered PCM data. Returns `Float32Array[]` (channels) by default. Pass `channel` for a single Float32Array. Pass `format` for encoded bytes.

```js
let pcm = await a.read()                          // all channels
let pcm = await a.read({ at: 5, duration: 2 })   // 2s from 5s
let ch0 = await a.read({ channel: 0 })           // left channel only
let raw = await a.read({ format: 'int16' })       // format conversion
let wav = await a.read({ format: 'wav' })         // encoded bytes
```

### a.encode(format?, opts?)

Encode to bytes without saving to disk. Returns Uint8Array.

```js
let wav = await a.encode('wav')
let mp3 = await a.encode('mp3', { at: 0, duration: 30 })
```

### a.save(target, opts?)

Encode and write to file. Format from extension. Emits `'progress'` events.

```js
await a.save('out.wav')
await a.save('out.mp3')
await a.save('clip.wav', { at: 10, duration: 5 })
```

### a.stream(opts?)

Async iterator over materialized blocks. Ops applied per-block — no full materialization needed.

```js
for await (let block of a.stream()) {
  // block: Float32Array[] — channels for one page
  process(block)
}

for await (let block of a.stream({ at: 10, duration: 5 })) { ... }
```

### a.clone()

Deep copy with independent edit history. Pages are shared (zero-copy).

```js
let b = a.clone()
b.gain(-6)                               // does not affect a
```

## Playback

### a.play(opts?)

Start playback. Node uses `audio-speaker`; browser uses Web Audio API.

```js
a.play()                                 // play from start
a.play({ at: 10, duration: 5 })         // play 5s from 10s
a.play({ volume: -6, loop: true })      // quieter, looping
```

### a.pause()

Pause playback. Position is preserved — call `.resume()` to continue.

### a.resume()

Resume from where it was paused.

### a.stop()

Stop playback and/or recording. For pushable instances, also drains and finalizes.

### a.seek(t)

Jump to a position in seconds. If playing, playback continues from the new position.

```js
a.seek(30)                               // jump to 30s
a.seek(0)                                // back to start
```

## Recording

### a.record(opts?)

Start recording from microphone. Requires `audio-mic` package (dynamic import). The instance accumulates data — call `.stop()` to finalize, then edit/save as usual.

```js
let a = audio()
a.record()
// ... later ...
a.stop()
a.trim().normalize()
await a.save('recording.wav')
```

### a.push(data, format?)

Feed PCM data into a pushable instance manually.

```js
a.push(float32chunk)
a.push(int16arr, 'int16')
a.push(buf, { format: 'int16', channels: 2 })
```

## Analysis

All stat queries are async. Instant from block stats when clean, streams dirty blocks when needed. Supports `{at, duration}` for sub-ranges.

### a.stat(name, opts?)

Query a named statistic.

```js
await a.stat('db')                       // peak dBFS
await a.stat('rms')                      // RMS level
await a.stat('loudness')                 // integrated LUFS (BS.1770)
await a.stat('clip')                     // clipped sample count
await a.stat('dc')                       // DC offset
```

Pass `{bins}` for downsampled waveform data:

```js
await a.stat('max', { bins: 800 })                       // 800-point peaks
await a.stat('max', { bins: 800, channel: [0, 1] })     // per-channel
let [mn, mx] = await a.stat(['min', 'max'], { bins: 800 })
```

Pass `{at, duration}` for sub-range:

```js
let [peak, loud] = await a.stat(['db', 'loudness'], { at: 10, duration: 5 })
```

### a.stat('spectrum', opts?)

Mel-frequency spectrum in dB.

```js
let spec = await a.stat('spectrum', { bins: 128 })
let spec = await a.stat('spectrum', { bins: 64, fMin: 30, fMax: 16000 })
```

### a.stat('cepstrum', opts?)

Mel-frequency cepstral coefficients (MFCCs) — common for speech/ML features.

```js
let mfcc = await a.stat('cepstrum', { bins: 13 })
```

### a.stat('silence', opts?)

Detect silent regions. Returns array of `{at, duration}`.

```js
let regions = await a.stat('silence')
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

Release all resources — stops playback/recording, clears listeners, nulls caches and pages. Call when done with an instance to prevent memory leaks.

```js
a.dispose()
```

Also available as `a[Symbol.dispose]()` for `using` syntax.

## Custom

### audio.op(name, descriptor)

Register a custom op. All instances gain the method. See [Plugins](plugins.md) for the full descriptor format.

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

One-off inline processor. Not registered, not serialized — for quick custom processing.

```js
a.transform((channels, ctx) => {
  // ctx: { sampleRate, blockSize, at, duration, blockOffset }
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
