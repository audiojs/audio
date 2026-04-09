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
npx audio kirtan.mp3 -p
⏸ 0:00:24 ────────────────────────────────────────────────── -0:42:42   ▁▂▃▄▅__
          ▃▅▆▆▇▇▇▆▆▆▇▇▇▇▆▆▆▆▅▆▆▅▅▅▅▅▅▅▄▄▄▂▂▂▁▁▁_____________
          50    500  1k     2k         5k       10k      20k

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

| Method | Description |
|--------|-------------|
| `audio(source, opts?)` | Decode from file/URL/bytes (async, thenable, paged) |
| `audio.from(source, opts?)` | Wrap PCM/AudioBuffer/silence/function (sync, resident) |
| `audio()` | Pushable instance — `.push()`, `.record()`, `.stop()` |
| `audio([a, b, ...])` | Concat from array |
| **Properties** | |
| `.duration` `.channels` `.sampleRate` `.length` | Audio dimensions (reflect edits) |
| `.currentTime` `.playing` `.paused` `.volume` `.loop` | Playback state |
| `.source` `.pages` `.stats` `.edits` `.version` | Internal state |
| **Structural** | |
| `.crop({at, duration})` | Keep only this range |
| `.remove({at, duration})` | Delete a range |
| `.insert(source, {at})` | Insert audio or silence at position |
| `.repeat(n)` | Repeat n times |
| `.pad(before, after?)` | Pad silence at edges (seconds) |
| `.speed(rate)` | Change playback speed |
| `.reverse({at?, duration?})` | Reverse audio or range |
| `.split(t1, t2, ...)` | Split into views at timestamps |
| `.view({at, duration})` | Non-destructive view of a range |
| `.concat(b, c, ...)` | Concatenate sources |
| **Sample** | |
| `.gain(dB, {at?, duration?, channel?})` | Volume in dB. Accepts function for automation |
| `.fade(in, out?, curve?)` | Fade in/out. Positive = from start, negative = from end |
| `.mix(other, {at?, duration?})` | Overlay another audio |
| `.write(data, {at?})` | Overwrite samples at position |
| `.remix(channels)` | Change channel count |
| `.pan(value, {at?, duration?})` | Stereo balance (−1..1). Accepts function |
| **Smart** | |
| `.trim(threshold?)` | Remove silence from edges |
| `.normalize(target?)` | Loudness normalize. Presets: `'podcast'`, `'streaming'`, `'broadcast'` |
| **Filter** | |
| `.highpass(hz)` `.lowpass(hz)` | High/low-pass filter |
| `.bandpass(freq, Q)` `.notch(freq, Q)` | Band-pass / notch filter |
| `.lowshelf(hz, dB)` `.highshelf(hz, dB)` | Shelf EQ |
| `.eq(freq, gain, Q)` | Parametric EQ |
| **I/O** | |
| `await .read({at?, duration?, channel?, format?})` | Read PCM or encode to bytes |
| `await .save(path, {format?, at?, duration?})` | Save to file |
| `await .encode(format?, {at?, duration?})` | Encode to Uint8Array |
| `for await (let block of .stream())` | Async iterator over blocks |
| **Playback** | |
| `.play({at?, duration?, volume?, loop?})` | Start playback |
| `.pause()` `.resume()` `.stop()` `.seek(t)` | Playback control |
| **Recording** | |
| `.record()` | Start mic recording |
| `.push(data, format?)` | Feed PCM into pushable |
| `.stop()` | Stop playback or recording |
| **Analysis** | |
| `await .stat(name, {at?, duration?, bins?, channel?})` | Query stat: `'db'`, `'rms'`, `'loudness'`, `'clip'`, `'dc'`, `'silence'` |
| `await .stat('max', {bins})` | Downsampled waveform |
| `await .stat('spectrum', {bins})` | Mel spectrum |
| `await .stat('cepstrum', {bins})` | MFCCs |
| `await .stat([...names], opts)` | Multiple stats at once |
| **Events** | |
| `.on(event, fn)` `.off(event, fn)` | `'change'`, `'data'`, `'timeupdate'`, `'ended'`, `'progress'` |
| `.dispose()` | Release all resources |
| **History** | |
| `.undo()` `.run(edit1, ...)` | Undo / replay edits |
| `JSON.stringify(a)` / `audio(json)` | Serialize / restore |
| **Custom** | |
| `audio.op(name, fn)` | Register custom op |
| `audio.stat(name, descriptor)` | Register custom stat |
| `.transform(fn)` | Inline processor |

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
