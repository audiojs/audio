# Reference

See also: [Architecture](architecture.md) · [Recipes](recipes.md) · [Plugins](plugins.md)

## Create

**`audio(source, opts?)`** — returns instance immediately. Thenable — `await` waits for full decode. Edits chain before decode.

```js
let a = audio('file.mp3')                 // sync — instance returned immediately
a.gain(-3).trim()                         // edits work before decode
await a.save('out.wav')                   // consuming ops wait internally

let b = await audio('file.mp3')           // thenable — waits for full decode
let c = await audio(url)                  // URL string or URL object
let d = await audio(uint8array)           // encoded bytes
let e = audio([a, b])                     // concat from array
```

**`audio.from(source, opts?)`** — sync. Wraps existing PCM. No decode, no I/O.

```js
let a = audio.from([left, right])         // Float32Array[] channels
let b = audio.from(3, { channels: 2 })   // 3 seconds of silence
let c = audio.from(audioBuffer)           // Web Audio AudioBuffer
let d = audio.from(t => Math.sin(440 * TAU * t), { duration: 1 })
let e = audio.from(int16arr, { format: 'int16' })
```

**`audio()`** — no source: pushable instance.

```js
let a = audio()
a.push(float32chunk)                      // Float32Array or Float32Array[]
a.push(int16arr, 'int16')                 // typed arrays convert automatically
a.push(buf, { format: 'int16', channels: 2 })
a.stop()                                  // drain + finalize
```

**`audio.open(source, opts?)`** — async. Returns once metadata (sampleRate, channels) ready. Decode continues in background.

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

## Edit ops

All ops are sync, chainable, non-destructive. They push to the edit list — source pages are never mutated.

All sample ops accept `{at, duration, channel}` options:

```js
a.gain(-3, {at: 1, duration: 5})        // 1s–6s only
a.gain(-6, {channel: 0})                // left channel only
```

### Structural

| Method | Description |
|--------|-------------|
| `crop({at, duration})` | Keep only the specified range |
| `remove({at, duration})` | Delete a range |
| `insert(source, {at})` | Insert audio or silence at position |
| `repeat(n)` | Repeat n times |
| `pad(before, after?)` | Add silence at edges |
| `speed(rate)` | Change speed (negative = reverse) |
| `split(t1, t2, ...)` | Split into views at timestamps (zero-copy) |
| `view({at, duration})` | Shared-page view of a range |
| `reverse({at?, duration?})` | Reverse entire audio or range |

### Sample

| Method | Description |
|--------|-------------|
| `gain(dB)` | Amplify/attenuate. Accepts number, function, or `{unit: 'linear'}` |
| `fade(in, out?, curve?)` | Fade in/out. Negative = from end. Curves: `'linear'`, `'exp'` |
| `mix(other, {at, duration})` | Overlay another audio |
| `write(data, {at})` | Overwrite samples |
| `remix(channels)` | Change channel count |
| `pan(value)` | Stereo balance (-1..1). Accepts number or function |

### Smart

| Method | Description |
|--------|-------------|
| `trim(dB?)` | Remove silence from edges |
| `normalize(target?)` | Peak normalize. Presets: `'streaming'`, `'podcast'`, `'broadcast'`. Modes: `{mode: 'lufs'\|'rms', target}` |

### Filter

Built-in [audio-filter](https://github.com/audiojs/audio-filter). Stateful across streaming chunks.

| Method | Description |
|--------|-------------|
| `highpass(hz)` | High-pass filter |
| `lowpass(hz)` | Low-pass filter |
| `bandpass(center, bw)` | Band-pass filter |
| `notch(hz)` | Notch filter |
| `lowshelf(hz, dB)` | Low shelf EQ |
| `highshelf(hz, dB)` | High shelf EQ |
| `eq(freq, gain, Q)` | Parametric EQ |

### History

```js
a.undo()                                 // pop last edit
a.run(edit1, edit2, ...)                 // push raw edits
let json = JSON.stringify(a)             // serialize (toJSON)
let b = await audio(JSON.parse(json))    // restore from source + edits
```

## I/O

```js
let pcm = await a.read()                           // Float32Array[]
let pcm = await a.read({at: 5, duration: 2})       // range
let ch0 = await a.read({channel: 0})               // single channel
let raw = await a.read({format: 'int16'})           // format conversion
let wav = await a.read({format: 'wav'})             // encode to bytes

await a.save('out.mp3')                             // save to file

for await (let block of a.stream()) process(block)  // async iterator
```

### Playback

```js
a.play()                                // play from start
a.play({at: 10, duration: 5})           // play range
a.play({volume: -6, loop: true})
a.pause()
a.resume()
a.stop()
a.seek(30)                              // jump to 30s
```

### Recording

```js
let a = audio()
a.record()                              // start mic (requires audio-mic)
a.stop()                                // stop + finalize
a.record()                              // resume — appends
```

## Analysis

All async, instant from stats when clean. `{at, duration}` for sub-range. `{bins}` for waveform data.

| Stat | Returns |
|------|---------|
| `'db'` | Peak dBFS |
| `'rms'` | RMS level |
| `'loudness'` | Integrated LUFS (BS.1770) |
| `'clip'` | Clipped sample timestamps |
| `'dc'` | DC offset |
| `'min'` / `'max'` | Min/max sample values |
| `'spectrum'` | Mel spectrum (dB) |
| `'cepstrum'` | MFCCs |
| `'silence'` | Silent regions `[{at, duration}, ...]` |

```js
await a.stat('db')
await a.stat('max', {bins: 800})                       // waveform
await a.stat('max', {bins: 800, channel: [0, 1]})     // per-channel
let [mn, mx] = await a.stat(['min', 'max'], {bins: 800})
let [peak, loud] = await a.stat(['db', 'loudness'])
```

## Events

| Event | Payload | When |
|-------|---------|------|
| `'change'` | — | Edit list changed |
| `'data'` | `{delta, offset}` | New stat blocks during decode/record |
| `'timeupdate'` | seconds | Playback position changed |
| `'ended'` | — | Playback finished |
| `'progress'` | `{offset, total}` | Encoding progress (save/encode) |

```js
a.on('change', () => {})
a.on('data', ({delta, offset}) => {})
a.off('change', fn)
a.dispose()                             // release all resources
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
