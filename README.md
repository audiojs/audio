# audio [![test](https://github.com/audiojs/audio/actions/workflows/test.yml/badge.svg)](https://github.com/audiojs/audio/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/audio?color=white)](https://npmjs.org/package/audio)

_Audio playback, editing and analysis_

<!-- <img src="docs/preview.svg?v=1" alt="Audiojs demo" width="540"> -->

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

```html
<script type="module">
  import audio from 'https://esm.sh/audio'
  audio('./song.mp3').trim().normalize().fade(0.5, 2).clip({ at: 60, duration: 30 }).play()
</script>
```

### CLI

```sh
npm i -g audio # or: npx audio …
audio voice.wav trim normalize podcast fade 0.3s -0.5s save clean.mp3
```

### Skill

```sh
npx skills add audiojs/audio
```

### MCP

```sh
npx add-mcp "npx -y audio --mcp"  # asks which of your agents: Claude Code, Codex, Cursor, Gemini CLI, Kimi Code, Pi, OpenCode, Zed…
```

`Prompt: make ~/Desktop/interview.m4a podcast-ready and tell me the loudness before and after`

One agent at a time: `claude mcp add audio -- npx -y audio --mcp`, `qwen mcp add audio npx -y audio --mcp`, `droid mcp add audio "npx -y audio --mcp"`.

### Editor and agents

```sh
npx audio --bridge
# audio bridge on http://127.0.0.1:7777
#
#   key     3e37b8c61acf5b50f010852168f4843d
#   agents  Claude Code, Codex, Pi, Kimi Code
#
#   In the editor's Agent panel, paste the key, then Connect. It stays the same next time.
```

Connect the editor to it with the key (once: the bridge keeps it), and its chat runs an agent of yours, which measures, looks at, edits and plays the sound open there, and finds which edit did what: it measures the sound before and after each, and what each took out; each tab keeps its conversations, each with the agent, and its model, picked under the message. The bridge finds Claude Code, Codex, Pi, Gemini CLI, Qwen Code, Kimi Code, OpenCode, Kilo Code, Cline, Goose, Factory Droid, Cursor, Augment, Kiro and Mistral Vibe on PATH; any other that speaks [ACP](https://agentclientprotocol.com/get-started/registry) runs by its command line, `--agent "my-agent --acp"`.

Any MCP agent gets the editor's tools (`state`, `measure`, `look`, `edit`, `select`, `play`, `check`, …), the running bridge found by itself: `npx add-mcp "npx -y audio --mcp --editor"`.

An agent thinks with the model its own settings name: Pi takes local ones for good from `ollama launch pi --config`; Claude Code takes any Anthropic-compatible endpoint from the bridge's environment:

```sh
ANTHROPIC_BASE_URL=http://localhost:11434 ANTHROPIC_AUTH_TOKEN=ollama ANTHROPIC_API_KEY= ANTHROPIC_MODEL=qwen3-coder npx audio --bridge
```

| Models | `ANTHROPIC_BASE_URL`, with the provider's key as `ANTHROPIC_AUTH_TOKEN` |
|---|---|
| Ollama | `http://localhost:11434`, token `ollama` ([docs](https://docs.ollama.com/integrations/claude-code)) |
| Z.ai GLM | `https://api.z.ai/api/anthropic` ([docs](https://docs.z.ai/devpack/tool/claude)) |
| Kimi | `https://api.moonshot.ai/anthropic` ([docs](https://platform.kimi.ai/docs/guide/claude-code-kimi)) |
| Qwen | `https://coding-intl.dashscope.aliyuncs.com/apps/anthropic`, Coding Plan ([docs](https://www.alibabacloud.com/help/en/model-studio/claude-code)) |
| DeepSeek | `https://api.deepseek.com/anthropic` ([docs](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code)) |


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

// does it pass? each rule of the spec, measured
let { pass, rules } = await a.check('podcast')         // acx, podcast, streaming, broadcast, netflix
```

### Master & deliver

```js
// master a song to a reference track: its tone (mid and side), width and loudness, under -1 dBTP
audio('mix.wav').master(await audio('reference.wav')).save('master.wav')

// audiobook chapter for ACX: RMS -23..-18 dB, peaks under -3 dB, floor under -60 dB, room tone at each end, 44.1 kHz
let ch = audio('chapter-01.wav')
  .highpass(80).omlsa({ gMin: -12 }).compressor({ threshold: -24, ratio: 2.5 })
  .normalize(-20, 'rms', { ceiling: -3.5 })
  .trim().pad(1.5, 2).roomtone()                      // room tone, not digital silence
  .resample(44100)
console.log(await ch.check('acx'))                    // passed 10 of 10 real narrations (.work/pro.md)
await ch.save('chapter-01.mp3', { bitrate: 192 })

// tighten pauses in a talking-head video, then hand the cuts to the video editor
let talk = audio('talk.mp4').shrink(0.3)
await talk.save('talk.m4a')                            // the sound, cut
await talk.save('talk.edl')                            // the same cuts for the picture (Premiere, Resolve)
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

```js
a.gain(t => -12 * (0.5 + 0.5 * Math.cos(t * Math.PI * 4)))  // 2Hz tremolo in dB
a.lowpass(t => 400 + 4000 * t)                              // filter sweep
a.pan({ t: [0, 2, 4], v: [-1, 1, -1] })                     // curve L→R→L over 4s, serializable
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

| Method                         | Description                                                                                                                         |
|:--|:--|
| `audio(source, opts?)` | decode from file, URL, bytes, or a byte stream. Returns instantly — decodes in background; streams decode as they arrive. |
| `audio.from(source, opts?)` | wrap existing PCM, AudioBuffer, silence, or function. Sync, no I/O. |

```js
let a = audio('voice.mp3')                // file path
let b = audio('https://cdn.ex/track.mp3') // URL
let c = audio(inputEl.files[0])           // Blob, File, Response, ArrayBuffer
let d = audio()                           // empty, ready for .push() or .record()
let e = audio([intro, body, outro])       // concat (virtual, no copy)
let f = audio([a, b, c], { crossfade: 2 })  // concat with 2s crossfade
let g = audio(process.stdin)              // byte stream: pipe, socket, fetch body – decodes as it arrives
// opts: { sampleRate, channels, crossfade, curve, storage: 'memory' | 'persistent' | 'auto' }

await a    // await for decode — if you need .duration, full stats etc

let a = audio.from([left, right])                 // Float32Array[] channels
let b = audio.from(3, { channels: 2 })           // 3s silence
let c = audio.from(t => Math.sin(440*TAU*t), { duration: 2 })  // generator
let d = audio.from(audioBuffer)                   // Web Audio AudioBuffer
let e = audio.from(int16arr, { format: 'int16' }) // typed array + format
let f = audio.from(store, { length, channels, sampleRate }) // pages in a store ({ read(i), has(i), write(i, page) }), read as needed
```

### Properties

| Property                         | Description                                                                                                                         |
|:--|:--|
| `.duration` | total seconds, after edits. |
| `.channels` | channel count. |
| `.sampleRate` | sample rate. |
| `.length` | samples per channel. |
| `.currentTime` | what the speakers play now, in seconds: their latency compensated, smooth; at pause it holds where playback resumes. |
| `.playing` | true during playback. |
| `.paused` | true when paused. |
| `.volume` | 0..1 linear. Settable. |
| `.muted` | mute, independent of volume. Settable. |
| `.loop` | settable, mid-playback too: the span repeats, each seam a 10 ms equal-power crossfade. |
| `.playbackRate` | 0.0625..16, settable mid-playback, click-free. The pitch stays (WSOLA, as a browser's media element plays at a speed) unless `.preservesPitch` is false: then it glides over ~50 ms and the pitch follows, tape-style. `.speed()` bakes it. |
| `.preservesPitch` | true: at a rate other than 1, the pitch kept. false: varispeed, the pitch with the speed. Settable mid-playback. |
| `.ended` | true when playback reached the end, not after `stop()`. |
| `.seeking` | true during a seek. |
| `.played` | promise, resolves when playback sounds. |
| `.recording` | true during mic recording. |
| `.ready` | promise, resolves when fully decoded. |
| `.source` | original source. |
| `.bitDepth` | stored sample depth of the source: 16, 24, 32 (float); null for lossy or generated audio. Lossless `save` keeps it. |
| `.pages` | `Float32Array` page store. |
| `.stats` | per-block stats (peak, rms, etc.). |
| `.edits` | edit list. |
| `.version` | increments on each edit. |

### Structure

| Method                         | Description                                                                                                                         |
|:--|:--|
| `.trim(threshold?)` | strip leading/trailing silence (dB, default auto). On a live stream a given threshold streams, holding a silent tail until sound resumes; the automatic one reads the whole input, so it waits for the end. |
| `.shrink(gap?, threshold?)` | shorten silent pauses to `gap` seconds (default 0.3); `0` removes them. Streams with a given threshold, like `trim`.<br><sub>≡ FFmpeg `silenceremove`, Audacity truncate-silence</sub> |
| `.crop({at, duration})` | keep range, discard rest. |
| `.remove(at, duration, crossfade?)` | delete range, close gap. `crossfade` (`'10ms'`) makes the splice an equal-power crossfade centered on the cut; the length stays the same. |
| `.insert(source, at?, crossfade?)` | insert audio (default: at end), or a number of seconds of silence; `crossfade` fades both seams. |
| `.copy({at?, duration?})` | copy range (default: all) to this instance's clipboard. |
| `.cut({at?, duration?, crossfade?})` | copy, then remove. |
| `.paste({at?, crossfade?})` | insert the clipboard (default: at end). |
| `.move({at, duration, to, crossfade?})` | slide a range to `to`, over what is there; silence where it was, the length kept (past the end, extended). `crossfade` crossfades each edge, centered.<br><sub>≡ a DAW's clip moved in slip mode</sub> |
| `.clip({at, duration})` | zero-copy excerpt as a new instance. |
| `.split(...offsets)` | zero-copy excerpts between timestamps. |
| `.pad(before, after?)` | silence at edges (seconds). |
| `.repeat(n)` | repeat n times. |
| `.reverse({at?, duration?})` | reverse audio or range. |
| `.speed(rate)` | changes pitch and duration together. |
| `.stretch(factor, {voice?})` | changes duration, keeps pitch (phase-locked vocoder). A `t => f` or `{t, v}` factor slides the tempo; duration becomes ∫factor dt. A range `{at, duration}` comes out `round(round(duration · sampleRate) · factor)` samples long, to the sample; the audio around it as it was. `{ voice: true }` keeps a voice's pulse shape and consonants, which the vocoder makes distant: shortened, its waveform copied a segment at a time (WSOLA, `@audio/stretch-wsola`); slowed, the vocoder's frames restarted from the waveform where it fits (PVSOLA, `@audio/stretch-pvsola`), so breath and reverberation are not repeated into a flanger. One voice, not chords.<br><sub>≡ Logic Flex Time Monophonic, Ableton Tones</sub> |
| `.warp(markers)` | move moments in time: `[[from, to], …]` in seconds. Between markers the audio stretches to fit, pitch kept; start and end stay.<br><sub>≡ Logic Flex Time, Ableton warp markers</sub> |
| `.pitch(semitones, {voice?})` | changes pitch, keeps duration. Semitones may be a curve `{t, v}` (seconds → semitones, straight between points, flat past the ends, as the gain line's) or `t => semitones`; where it is zero the audio is as it was. `{ voice: true }` re-spaces a voice's own glottal cycles (TD-PSOLA, the optional `@audio/tune-curve`): formants and consonants kept, one voice.<br><sub>≡ Melodyne pitch drawing</sub> |
| `.intonation(factor)` | a voice's rises and falls wider or flatter about its median pitch: `1` as it was, `0` a monotone, `2` twice as wide. Its own cycles re-spaced (as `pitch({ voice: true })`): timing, formants and consonants kept, one voice.<br><sub>≡ Melodyne pitch modulation, Praat's pitch range factor</sub> |
| `.formant(semitones)` | moves the formants (the spectral envelope: a voice's vowels, the size of its head), keeps the pitch. A number, a curve `{t, v}` or `t => semitones`. Any sound; with `pitch()`, a voice kept its own or made another's.<br><sub>≡ Melodyne formant tool, Praat's formant shift ratio</sub> |
| `.remix(channels)` | channel count (down per ITU-R BS.775: 7.1 → 5.1, stereo, mono), or a map: `[1, 0]` swaps L/R, `null` a silent channel. |

Every op takes a trailing `{at, duration, channel}` range, except channel-changing `remix` and `crossover`, and every op that keeps the timeline a `mix`: how much of its output is heard, the rest its input, 0 to 1 or a curve `{t, v}` over time (`{ mix: { t: [11.99, 12, 14, 14.01], v: [1, 0, 0, 1] } }` turns it off from 12 s to 14 s, as RX's Restore Selection; an effect's own `mix` is its own). Times are seconds or strings (`'1:30'`, `'2m'`); negative counts from the end. FFmpeg's short names work wherever the long ones do: `d` for `duration`, `xfade` for `crossfade` (`a.remove({ at: 1, d: 0.5, xfade: 0.01 })`).

```js
a.trim(-30)                               // strip silence below -30dB
a.remove({ at: '2m', duration: 15 })      // delete 2:00–2:15, close gap
a.remove(12.3, 0.4, '10ms')               // cut a breath, crossfaded: no click
a.insert(intro, { at: 0 })                // prepend; .insert(3) appends 3s silence
a.copy(60, 30).paste(120)                 // duplicate the chorus at 2:00
a.cut(2, 1).paste(5)                      // move 2s–3s to 5s of the shortened timeline
a.move({ at: 2, duration: 1, to: 5 })     // slide 2s–3s over 5s–6s, silence left at 2s–3s
let [pt1, pt2] = a.split('30m')           // zero-copy parts
let hook = a.clip({ at: 60, duration: 30 })  // zero-copy excerpt
a.stretch(1.1)                            // 10% longer, same pitch
a.warp([[1, 1], [2, 2.4], [3, 3]])        // the hit at 2s lands at 2.4s; 1s–3s keeps its length
a.pitch(-2)                               // 2 semitones down, same tempo
a.pitch({ t: [1, 1.2, 2, 2.2], v: [0, 3, 3, 0] }, { voice: true })  // a note drawn 3 semitones up, formants kept
a.intonation(1.5, { at: 2, d: 3 })        // 2s–5s: every rise and fall half as wide again
a.formant(-2)                             // a larger, darker voice on the same notes
a.remix([0, 0])                           // L→both; .remix(1) for mono
```

### Process

| Method                         | Description                                                                                                                         |
|:--|:--|
| `.gain(dB, opts?)` | `{ unit: 'linear' }` takes a multiplier. |
| `.fade(in, out?, curve?)` | curves `'linear'` `'exp'` `'log'` `'cos'`, as functions in `audio.op('fade').curves`. `{start, end}` levels 0..1 fade between any levels (a duck); `{mid}` skews the half-amplitude point.<br><sub>≡ Audacity adjustable-fade</sub> |
| `.normalize(target?, mode?)` | remove DC, normalize. Loudness targets hold a true-peak ceiling, -1 dBTP by default: a lookahead limiter, then the loudness it took made back up. Presets per Apple Podcasts, Spotify, EBU R 128 (ITU-R BS.1770-4):<br>`'podcast'` -16 LUFS<br>`'streaming'` -14 LUFS<br>`'broadcast'` -23 LUFS<br>`-18, 'lufs'` any loudness; `-3` peak dB; no arg: peak 0 dBFS; `'rms'` mode<br>an audio instance: its integrated loudness<br>`{ ceiling: -2 }` dBTP, `false` off<br>`{ dc: false }` keep DC<br>`{ adaptive: true }` on a live stream, start at once: the gain follows what it has heard, the ceiling (the target itself in peak mode) guards what it hasn't. Without it, one gain for the whole selection: a live stream waits for its end.<br><sub>≡ FFmpeg `loudnorm`</sub> |
| `.roomtone(threshold?)` | fill digital silence (≥ 10 ms under -90 dBFS: edited-out pauses, `pad()`) with the recording's own room tone: its quiet stretches that hold still for 0.3 s, 20 dB under the program. `.trim().pad(1.5, 2).roomtone()` gives an audiobook chapter its room tone at each end (ACX rejects digital silence). Where every pause was gated or cut, there is no room to take, and nothing changes.<br><sub>≡ iZotope RX Ambience Match</sub> |
| `.mix(source, at?, gain?)` | overlay at `at` seconds, source level `gain` dB.<br><sub>≡ FFmpeg `amix` weights</sub> |
| `.crossfade(source, duration?, curve?)` | append with overlap, default 0.5s. `'cos'` (default) suits similar material; `'equal'` (equal-power) keeps loudness across unrelated tracks; each in `audio.op('crossfade').curves`. With no source, `.crossfade({ at, duration })` crossfades across the range, as an editor crossfades a selection: the audio before it fades into the audio after it, and the range goes.<br><sub>≡ FFmpeg `acrossfade`</sub> |
| `.pan(value, opts?)` | −1 left, 0 center, 1 right. |
| `.write(data, {at?})` | overwrite from `at` with raw PCM or another sound, as a tape records over what is there; what runs past the end extends it. |
| `.transform(fn)` | inline `(input, output, ctx) => void`. Not serialized. |

```js
a.gain(-3)                                // reduce 3dB
a.gain(6, { at: 10, duration: 5 })        // boost range
a.gain(t => -12 * Math.cos(t * TAU))      // automate over time
a.fade(0.5, -2, 'exp')                    // 0.5s in, 2s exp fade-out
a.normalize('podcast')                    // -16 LUFS, -1 dBTP
a.normalize(-27, 'lufs', { ceiling: -2 }) // Netflix
a.mix(voice, { at: 2 })                   // overlay at 2s
a.mix(bed, 0, -18)                        // music bed, 18 dB under
a.crossfade(next, 2)                      // 2s crossfade into next
a.crossfade(song2, 4, 'equal')            // equal-power, for unrelated tracks
a.pan(-0.3, { at: 10, duration: 5 })      // pan left for range
```

### Filter

| Method                         | Description                                                                                                                         |
|:--|:--|
| `.highpass(freq, order?)`, `.lowpass(freq, order?)` | Butterworth pass filter; even integer order ≥ 2: 2 (12 dB/oct, default), 4 (24), 6, 8, … Other orders are rejected. |
| `.bandpass(freq, Q?)`, `.notch(freq, Q?)` | band-pass / notch. |
| `.allpass(freq, Q?)` | phase shift, unity magnitude. |
| `.lowshelf(freq, dB)`, `.highshelf(freq, dB)` | shelf EQ. |
| `.eq(freq, gain, Q?)` | parametric EQ. |
| `.filter(type, ...params)` | by type name, or a custom filter function. |

All biquads.

```js
a.highpass(80).lowshelf(200, -3)          // rumble + mud
a.eq(3000, 2, 1.5).highshelf(8000, 3)     // presence + air
a.notch(50)                               // remove hum
a.allpass(1000)                           // phase shift at 1kHz
a.filter(customFn, { cutoff: 2000 })      // custom filter function
```

### Effect

| Method                         | Description                                                                                                                         |
|:--|:--|
| `.vocals(mode?, {model?})` | mid/side: `'isolate'` (default) keeps center, `'remove'` keeps sides. `model` separates with a trained model instead, `'umxhq'` (Open-Unmix, MIT weights) or `'htdemucs'` (Hybrid Transformer Demucs, higher SDR, weights for research only), through the optional `@audio/neural-separate`; `'remove'` then subtracts the model's vocals. Weights are exported locally ([how](https://github.com/audiojs/neural/tree/main/packages/neural-separate#weights)) or served from `weights`.<br><sub>≡ SoX `oops`; Demucs, Open-Unmix</sub> |
| `.dither(bits?, {shape?})` | TPDF, default 16-bit. `shape: true` adds 2nd-order noise shaping: quantization noise moves above ~Nyquist/2, audibly quieter. |
| `.crossfeed(freq?, level?)` | headphone crossfeed, default 700 Hz, 0.3.<br><sub>≡ SoX `earwax`, bs2b</sub> |
| `.resample(rate, {type?})` | upsampling defaults to linear, downsampling to anti-aliased windowed sinc, its taps widening with the ratio. `type: 'sinc'` or `'linear'` forces one. |
| `.crossover(...freqs)` | N split frequencies → N+1 bands × channels, band-major. Linkwitz-Riley 4th order; bands sum back flat.<br><sub>≡ FFmpeg `acrossover`</sub> |
| `.match(ref, amount?)` | match EQ: up to 8 parametric bands fit to the reference/source spectrum ratio. Tone only; loudness stays with `normalize`. Streams `{lookahead}` s behind (10), refitting as it hears more. `{ midside: true }` matches a stereo pair's mid and side apart, and the side level to the reference's width.<br><sub>≡ iZotope Ozone Match EQ</sub> |
| `.master(ref, opts?)` | master to a reference track: `match` in mid and side, then `normalize` to the reference's integrated loudness under -1 dBTP (`{ ceiling }`).<br><sub>≡ Matchering</sub> |
| `.spectral(band?, gain?, {at, duration})` | gain on a time × frequency region, `band` = `[lo, hi]` Hz; default removes it.<br><sub>≡ Audacity spectral edit, FFmpeg `afftfilt`</sub> |
| `.repair(band?, {at, duration, method?, window?})` | rebuild a damaged range (dropout, beep, click burst) from its surroundings. `method` `'auto'` (default) transplants the passage that joins seamlessly, searched in the `window` s (10) before the range; failing that, AR interpolation up to 70 ms, a sinusoidal bridge beyond. `'ar'`, `'sinusoidal'`, `'similarity'`, `'spectral'` force one.<br><sub>≡ iZotope RX Spectral Repair</sub> |
| `.declick(threshold?, longest?, {at?, duration?})` | remove clicks: a vinyl tick, a bad splice, a digital glitch, a mouth click on a voice. Each stands `threshold` times (8) out of the AR prediction error around it and is rebuilt by least-squares AR interpolation from 46 ms either side; a pulse with its like 2.5–15 ms away (a voice, a plucked string) or a burst over `longest` ms (6) is sound, left alone. Given `{ at, duration }`, the clicks there: looked for only there, none passed over. Nothing a click doesn't reach changes. Streams about 0.9 s behind. Clicks at 5× the sound around them: ticks 17 dB down, mouth clicks 17, glitches 20 (`@audio/denoise-declick`'s README).<br><sub>≡ iZotope RX De-click, Audacity Click Removal</sub> |
| `.denoise(reduction?, threshold?, {noise})` | remove a noise that holds still (hiss, hum and buzz, a fan, room tone, tape), learned where it plays alone: `noise` is that `{ at, duration }` of the op's input, or several, or a print saved from `stat('print')`. It goes `reduction` dB down (12) everywhere, or in the op's own `{ at, duration }`, or only in a `band` `[low, high]` Hz, the rest as it was; what stays is the same noise, quieter, without musical tones. `threshold` (dB) raises the print: more of the quiet counts as noise. OM-LSA on the held noise (`@audio/denoise-omlsa`), each channel its own print; a live source renders once the range has arrived. VoiceBank+DEMAND PESQ, the noise learned from the half second before each speaker starts: noisy 1.97, `omlsa()` 2.40, `denoise()` 2.48. For noise that moves: `omlsa()`, `deepfilter()`.<br><sub>≡ iZotope RX Spectral De-noise (Learn), Adobe Audition Noise Reduction (noise print), Audacity Noise Reduction</sub> |
| `.deepfilter(limit?, {weights?, device?})`, `.rnnoise(limit?)` | neural speech denoising through the optional `@audio/neural-denoise`: it also removes noise that moves (keys, traffic, a busy room). `deepfilter` runs DeepFilterNet3, its 8 MB model downloaded once, over the whole input before rendering; `rnnoise` streams RNNoise, weights in the package, 30 ms behind. `limit` is the most the noise goes down, in dB: `deepfilter`'s 18 is the most before the voice itself sounds filtered (DNSMOS SIG holds to 18 and falls past it), so room tone stays; `rnnoise`'s 16 is the most before it cuts into the voice: RNNoise turns down word ends even with no noise at all (10 dB at 16, 31 unlimited); `0` lifts it. `deepfilter` keeps held sung notes, which the model alone takes for noise (VocalSet: 1.9 dB down, not 39), and hears a 16 kHz file's or a codec's empty top band as the noise floor the model trained with (16 kHz VoiceBank+DEMAND PESQ 2.83, not 2.72). VoiceBank+DEMAND PESQ: noisy 1.97, `wiener()` 2.19, `rnnoise()` 2.49, `deepfilter()` 2.90, `deepfilter(0)` 3.15. Speech only: music loses 8 to 16 dB in every band.<br><sub>≡ DeepFilterNet, RNNoise</sub> |

```js
a.vocals()                                // isolate center-panned vocals
a.vocals('remove')                        // remove vocals (karaoke)
a.vocals({ model: 'umxhq' })              // vocals by a separation model
a.dither(16)                              // TPDF dither to 16-bit
a.dither(16, { shape: true })             // noise-shaped
a.crossfeed()                             // headphone crossfeed
a.resample(48000)                         // resample to 48kHz (linear)
a.resample(96000, { type: 'sinc' })       // high-quality windowed-sinc
a.match(reference, 0.7)                   // 70% of the way to its tone
a.spectral([1000, 4000], -30, { at: 2.1, duration: 0.3 })  // a cough
a.repair({ at: 1.2, duration: 0.05 })     // a dropout
a.repair({ at: 42, duration: 1 })         // a lost second of music: the passage that fits
a.declick()                               // every click
a.declick({ at: 12.31, duration: 0.02 })  // the clicks seen there
a.denoise({ noise: { at: 1.2, duration: 0.5 } })  // hiss learned from a pause, 12 dB down everywhere
a.deepfilter()                            // speech out of noise: 18 dB down at most, room tone kept
a.rnnoise()                               // the same, streaming
```

### I/O

| Method                         | Description                                                                                                                         |
|:--|:--|
| `await .read(opts?)` | rendered PCM. `{ format, channel }` to convert. A source still arriving is waited for: a range until it has arrived, all of it until the end (an endless stream: read ranges, or `stream()`). |
| `await .save(path, opts?)` | encode + write, format from extension. Lossless keeps the source depth; `{ bitDepth, bitrate, quality, codec }` set the encoder; m4a and mp3 write markers as chapters. Output streams as it encodes, headers patched with their totals at the end (a pipe keeps them "unknown"); m4a from a live source is fragmented. A video source saved to `.mp4`/`.mov` keeps its picture: only the audio track changes. `.edl`, `.otio`, `.fcpxml` write the cuts. |
| `await .encode(format?, opts?)` | encode to `Uint8Array`; `'edl'`, `'otio'`, `'fcpxml'`: the cuts, as UTF-8. |
| `await .cuts(format?, opts?)` | the edits as a cut list for a video editor: `'edl'` (CMX 3600: Premiere, Resolve, Avid), `'fcpxml'` (Final Cut Pro, Resolve), `'otio'` (OpenTimelineIO); none gives `{ fps, clips: [{ at, duration, from, rate, source }] }`. Cuts, moves, gaps and inserted files place the clips; speed, stretch and warp set their rate; markers go along. Processing is not in the list: lay the processed audio under the picture. Cuts land on the video track's frames (MP4/MOV), else `{ fps }` (30), each within half a frame of the sound; its timecode track starts the source times, drop-frame as it counts (`{ dropFrame }`). The CLI's `save cuts.edl` writes one. |
| `.clone()` | independent edits, shared pages. |
| `.push(data, format?)` | feed PCM into a pushable instance; `.stop()` finalizes. |

```js
let pcm = await a.read()                              // Float32Array[]
let raw = await a.read({ format: 'int16', channel: 0 })
for await (let block of a) send(block)                 // async-iterable over blocks
await a.save('out.mp3')                                // format from extension
await a.save('book.mp3', { bitrate: 192 })             // ACX: 192 kbps CBR
await a.save('master.wav', { bitDepth: 24 })           // 24-bit
await a.save('talk.mp4')                               // video in, video out
let bytes = await a.encode('flac')                     // Uint8Array
let b = a.clone()                                      // independent copy, shared pages

let src = audio()                                      // pushable source
src.push(buf, 'int16')                                 // feed PCM
src.stop()                                             // finalize
```

### Playback / Recording

| Method                         | Description                                                                                                                         |
|:--|:--|
| `.play(opts?)` | `{ at, duration, loop, volume, rate, paused }`. `at` defaults to `currentTime` (the start once ended); playing already, it jumps there without a gap. |
| `.play({ from: b })` | take over `b`'s playback where it is (its span, loop, volume, rate, pause), crossfaded, no gap; `b` stops. |
| `.pause()`, `.resume()`, `.seek(t)`, `.stop()` | each ramps over 5 ms, none clicks; `seek` crossfades, and in a loop stays in its span. `stop()` also ends recording. |
| `.record(opts?)` | mic. `{ deviceId, sampleRate, channels }`. |
| `audio.context` | the page's one AudioContext, which playback uses: made on first use, resumed by the first gesture; set your own before playing. |

Playback renders up to 2 s ahead into an AudioWorklet on `audio.context` (Node: @audio/speaker), so a busy main thread doesn't stop it, and sounds within milliseconds of `play()` (the device's own latency aside). An edit to the playing instance is heard ~50 ms later where it happens: the audio rendered ahead gives way, crossfaded. A source still arriving (decoding, pushed) plays what has come and goes on as more comes. Any channel count plays as it is; the device downmixes.

```js
a.play({ at: 30, duration: 10 })          // play 30s–40s
await a.played                            // wait for sound
a.volume = 0.5; a.loop = true             // live adjustments
a.muted = true                            // mute without changing volume
a.playbackRate = 1.5                      // faster, the pitch kept
a.preservesPitch = false                  // the pitch follows the speed, as a tape's
a.pause(); a.seek(60); a.resume()         // jump to 1:00
a.highpass(80)                            // an edit while playing: heard where it happens
b.play({ from: a })                       // b takes over at the same place, crossfaded
b.stop()                                  // end playback or recording

await audio.context.audioWorklet.addModule('./scrub.js')  // your own nodes, on the same context
let scrub = new AudioWorkletNode(audio.context, 'scrub')

let mic = audio()
mic.record({ sampleRate: 16000, channels: 1 })
mic.stop()
```

### Metering

| Method                         | Description                                                                                                                         |
|:--|:--|
| `.meter(what, cb?)` | live per-block stats of what plays, delivered as it is heard: `rms`, `peak`, `ms`, `min`, `max`, `dc`, `clipping`, `spectrum`, or your own. Without `cb`, read `.value`. Returns `{ value, stop() }`. The same on a worker facade: measured in the worker, delivered on the page. |

| Option                         | Description                                                                                                                         |
|:--|:--|
| `type` | stat name, array of names, or omit for all block stats. |
| `channel` | `n` for one channel, `[n, m]` per-channel, or omit for scalar avg (mirrors `a.stat()`). |
| `smoothing` | one-pole EMA time constant τ, in seconds. |
| `hold` | peak-hold decay τ, in seconds. |
| `bins`, `fMin`, `fMax` | spectrum resolution and range (when `type: 'spectrum'`). |

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

### Analysis

| Method                         | Description                                                                                                                         |
|:--|:--|
| `await .stat(name, opts?)` | one value; with `{ bins: n }` a `Float32Array`, the value over each of n spans of the range: where, not only how much (lists, a key and spectra come whole; `bins` sizes spectrum and cepstrum); an array of names gives an array. `{ channel: n }` one channel, `[n, m]` per channel; `{at, duration}` sub-range. |
| `await .detect(opts?)` | `{ bpm, confidence, beats, onsets }` in one pass; `{ channel }` as in `stat`. |
| `await .check(spec)` | pass or fail against a delivery spec: `{ pass, rules: [{ name, value, unit, min, max, pass }] }`. `'acx'` (RMS, peak, noise floor, room tone, 44.1 kHz), `'podcast'` (Apple: -16 LUFS ±1, ≤ -1 dBTP), `'streaming'` (Spotify: plays at -14 LUFS, ≤ -1 dBTP), `'broadcast'` (EBU R 128: -23 ±0.2 LUFS, ≤ -1 dBTP), `'netflix'` (dialog -27 ±2 LUFS, ≤ -2 dBTP). Each limit cites its source in [fn/check.js](fn/check.js). |

| Stat                         | Description                                                                                                                         |
|:--|:--|
| `'db'` | peak amplitude in dBFS. |
| `'rms'` | RMS amplitude, linear (the CLI prints dBFS). |
| `'noisefloor'` | RMS of the quietest 0.4 s, dB: the room between words (ACX Check's measure, sample-exact). |
| `'print'` | the noise print of a range, as `denoise({ noise })` takes it: dB in 1025 bands 23.4375 Hz apart, 0 to 24 kHz (white noise of RMS 0.01 prints −40). |
| `'peak'` | `max(\|min\|, \|max\|)`, linear. |
| `'loudness'` | integrated LUFS (ITU-R BS.1770-4; surround channels weighted, LFE excluded). |
| `'momentary'`, `'shortterm'` | maximum 400 ms / 3 s loudness, LUFS (EBU Tech 3341). |
| `'dialog'` | loudness of the speech only, LUFS: speech found automatically (AES TD1008 dialog loudness). |
| `'dc'` | DC offset. |
| `'clipping'` | clipped samples, at 16-bit full scale (±32767/32768) or beyond (scalar: timestamps, binned: counts). |
| `'silence'` | silent ranges as `{at, duration}`. |
| `'crest'` | peak/RMS in dB. Sine ≈ 3dB, square ≈ 0dB. |
| `'centroid'` | spectral centroid in Hz (brightness). |
| `'flatness'` | spectral flatness: 0 tonal, 1 noise. |
| `'correlation'` | L/R phase correlation, −1 to +1. Mono returns 1. |
| `'max'`, `'min'` | peak envelope per bin, for waveforms. |
| `'spectrum'` | mel spectrum in dB (A-weighted); of several channels, their mean power. |
| `'cepstrum'` | MFCCs. |
| `'bpm'` | tempo. |
| `'beats'`, `'onsets'` | timestamps as `Float64Array` (seconds). |
| `'hits'` | where the level jumps, up (a strike) or down (a stop), as `Float64Array` (seconds): each at its attack's zero crossing, the sample to cut at, where `'onsets'` reads 23 ms blocks. |
| `'notes'` | `[{time, duration, freq, midi, note, clarity}]` (pYIN + Tony note HMM); with `robust: true`, the same through noise and rooms (a neural pYIN stage 1); with `poly: true`, polyphonic `[{time, duration, freq, midi, note, velocity, bends}]` (Basic Pitch). |
| `'chords'` | `[{time, duration, label, root, quality, bass, confidence}]`: Chordino on NNLS chroma (Mauch & Dixon 2010), matched to the reference plugin; labels like `'Am'`, `'G7'`, `'C/E'`, `'N'`. |
| `'key'` | `{tonic, mode, label, confidence}` (Krumhansl-Schmuckler). |
| `'voicing'` | share of the range voiced, 0 to 1: frames of pYIN's pitch curve with a pitch, every 10 ms. |
| `'hnr'` | harmonics-to-noise ratio, dB, over the voiced frames (Boersma 1993; matches Praat's To Harmonicity (ac) frame by frame); null where none is voiced. |
| `'harmonic'` | level of the periodic part, dB: the periodic share of each frame's power (Boersma's r) times the power. Unlike RMS, unmoved by noise taken away: what an edit left of a voice. |

Opts: `bpm`, `beats`, `onsets` take `{ minBpm, maxBpm, delta, frameSize, hopSize }`; `notes` takes `{ minFreq, maxFreq, frameSize, hopSize, minDuration }`; `chords`, `key` take `{ frameSize, hopSize, tuning }` (frames of 16384 samples at 44.1 kHz, 0.34 to 0.51 s at other rates, every eighth of a frame; concert A read from the audio unless `tuning` in Hz is given); `chords` also `boostN` (no-chord bias, 0.1); `key` also `method: 'nnls' | 'pcp'`. `chords` needs `@audio/mir-nnls-chroma` and `@audio/mir-chordino`, `key` needs `@audio/mir-nnls-chroma`: GPL-2.0-or-later translations of the reference plugins, installed by choice (`npm i @audio/mir-nnls-chroma @audio/mir-chordino`); `key` with `method: 'pcp'` needs only the MIT `@audio/mir-chroma` and `@audio/mir-key`, installed with `audio` unless optional dependencies are skipped. `notes` with `robust: true` needs `@audio/neural-pitch` (weights inside): a network's pitch candidates in place of YIN's keep the notes where YIN loses them (Vocadito onsets F 0.76 against 0.53 at 0 dB SNR) and trail it slightly on clean audio, so YIN stays the default. `notes` with `poly: true` takes `{ minFreq, maxFreq, minDuration, onsetThreshold, frameThreshold }` and needs `@audio/neural-transcribe`, whose model downloads on first use; `bends` are cents from the note's pitch per 11.6 ms frame, in 33.3-cent steps (in-tune notes read 0).

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

| Property                         | Description                                                                                                                         |
|:--|:--|
| `.meta` | tags: `{title, artist, album, year, bpm, key, comment, pictures, raw, ...}`. Writable. `meta.raw` holds format-specific blocks untouched (WAV bext/iXML, ID3v2 frames, FLAC blocks). |
| `.meta.pictures` | cover art `[{mime, type, description, data, url}]`. `.url` is a lazy Blob URL (browser) or data URL (Node). |
| `.markers` | `[{time, label}]` in output seconds; edits shift or drop them. |
| `.mark(time, label?)` | a marker at `time`, seconds of the audio as edited so far; `{at, duration}`, a region. Later edits carry it; in silence, at its distance from the sound nearest it; past the end, the end until a later edit makes the audio reach it. Chainable. |
| `.regions` | `[{at, duration, label}]`; edits shift or drop them. |

Parsed on decode, written on save; round-trips WAV, MP3, FLAC.

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

| Method                         | Description                                                                                                                         |
|:--|:--|
| `.on(event, fn)`, `.off(event?, fn?)` | subscribe / unsubscribe. |
| `.undo(n?)` | returns the undone edit, for redo via `.run()`. |
| `.run(...edits)` | apply `['type', opts]` edits: op params (`value`, `freq`, …) plus range keys. |
| `.dispose()` | release resources. Supports `using`. |

| Event                         | Description                                                                                                                         |
|:--|:--|
| `'data'` | pages decoded/pushed. Payload: `{ delta, offset, sampleRate, channels }`. |
| `'change'` | any edit or undo. |
| `'metadata'` | stream header decoded. Payload: `{ sampleRate, channels, estDuration }`: seconds it lasts, from the header where it says (WAV, AIFF, FLAC, an MP3's Xing or VBRI frame, a constant bitrate), else from its size; null when neither is known. |
| `'timeupdate'` | playback position, as heard (~50 times a second). Payload: `currentTime`. |
| `'play'` | playback started or resumed. |
| `'pause'` | playback paused. |
| `'volumechange'` | volume or muted changed. |
| `'ended'` | playback ended: at its end, by `stop()`, or taken over by `play({ from })`; not in a loop. |
| `'progress'` | during save/encode. Payload: `{ offset, total }` in seconds. |

```js
a.on('data', ({ delta }) => draw(delta))  // decode progress
a.on('timeupdate', t => ui.update(t))     // playback position

a.run(
  ['gain', { value: -3, at: 10, duration: 5 }],
  ['crop', { at: 1, duration: 2 }],
  ['fade', { in: 1, curve: 'exp' }],
  ['insert', { source: ref, at: 2 }],
)
a.undo()                                  // undo last edit
b.run(...a.edits)                         // replay onto another file
JSON.stringify(a); audio(json)            // serialize / restore
```

### Plugins

| Method                         | Description                                                                                                                         |
|:--|:--|
| `audio.use(...plugins)` | register an [@audio contract](https://github.com/audiojs/compile/blob/main/CONTRACT.md) factory, a stat `{ stat, compute }`, a codec `{ codec, test?, decode?, encode? }`, a function receiving `audio`, or a [registry](docs/plugins.md#registry) name. Registry plugins need no `use`: `a.compressor()` and `a.stat('truepeak')` load them on first use. |
| `audio.op(name, descriptor)` | register an op: a `process` function or `{ params, process, plan, resolve }`. |
| `audio.op(name?)` | one descriptor, or all ops. |
| `audio.stat(name, descriptor)` | register a stat: `(chs, ctx) => [...]` or `{ block, reduce, query }`. |

Plugins also run without the engine: `audio/batch` over a whole signal, `audio/stream` over live chunks. [Plugin tutorial](docs/plugins.md).

```js
import { compressor } from '@audio/dynamics-compressor/audio'
audio.use(compressor)                       // bring-your-own factory

a.freeverb({ room: 0.8 })                   // registry plugin: loads on first render; tail composes
music.ducker({ key: voice })                // sidechain via the key option
await a.stat('truepeak')                    // stat plugins land on a.stat()

audio.op('crush', { params: ['bits'], process: (input, output, ctx) => {
  let steps = 2 ** (ctx.bits ?? 8)
  for (let c = 0; c < input.length; c++)
    for (let i = 0; i < input[c].length; i++)
      output[c][i] = Math.round(input[c][i] * steps) / steps
}})
a.crush(4)                                  // custom op, chainable like built-ins
```

### Worker

| Call                         | Description                                                                                                                         |
|:--|:--|
| `audioWorker(source, opts?)` | same API, engine in a Worker; the main thread keeps a few-KB facade. |
| `audio(source, { worker: true })` | same, once `audio/worker` is imported. |
| `{ worker: new Worker(url) }` | your own worker entry: codecs, plugins, your own code and messages, then `audio/worker`, which talks on a port of its own. |
| `expose(a)` → id, `audioWorker.adopt(id, { worker })` | hand an instance your worker made to the page as a facade. |
| `audioWorker.context` | the page's AudioContext, the same as `audio.context`. |

Across the boundary `clip()`, `split()`, `clone()` return promises; op errors emit `'error'`; functions don't cross, use `{t, v}` curves. `play()` renders in the worker straight into the page's AudioWorklet: the main thread can stall for seconds without a dropout. [Architecture](docs/architecture.md#worker-engine).

```js
import audioWorker from 'audio/worker'
let a = audioWorker('track.mp3')            // decode/edits/stats/encode in a Worker
a.gain(-3).fade(0.5)
let [mins, maxs] = await a.stat(['min','max'], { bins: 640 })  // transferred, zero-copy
a.play()                                    // rendered in the worker, played by an AudioWorklet (Node: @audio/speaker)

// your own worker: its messages stay its own, and what it makes plays on the page
import audio from 'audio'                   // worker.js
import { expose } from 'audio/worker'
self.onmessage = ({ data }) => self.postMessage({ out: expose(audio(data.file).gain(-3)) })

let worker = new Worker('./worker.js', { type: 'module' })   // page
worker.onmessage = ({ data }) => audioWorker.adopt(data.out, { worker }).play()
```


## CLI

**`npm i -g audio`**, or without installing: `npx audio …`

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
crossfeed    shrink      crossover   match       spectral
repair       copy        cut         paste

# sinks (terminate the chain — at most one)
stat [NAMES...]    print analysis (default)
play [loop]        open player UI
save PATH          encode and write (or `-` for stdout); `192k` bitrate, `24bit` depth

# options
-f --force         overwrite existing output
--format FMT       override output format
--macro FILE       apply edits from JSON
--cue FILE         split at cue-sheet tracks (with split)
--verbose          show progress
--help, -h         help (or per-op: `audio gain --help`)
--mcp              serve the CLI to AI agents as an MCP tool (stdio)

# named options, after an op or sink: name:value
normalize -27 lufs ceiling:-2     ducker key:voice.wav     save out.m4a codec:alac

# compatibility shortcuts
-p ⇔ play     -l ⇔ play loop     -o PATH ⇔ save PATH
```

### Playback


<img src="docs/player.gif" alt="Audiojs demo" width="624">

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

# music bed ducked under the voice (sidechain)
audio bed.mp3 ducker key:voice.wav mix voice.wav save episode.wav

# loudness to any target, true peak held; delivery settings
audio book.wav normalize -20 lufs save book.mp3 192k

# fix a video's sound, keep the picture
audio talk.mp4 highpass 80hz 4 normalize podcast save talk.clean.mp4

# master to a reference track (tone, width, loudness)
audio mix.wav master reference.wav save master.wav

# shorten pauses; the same cuts as an EDL for the video editor (.fcpxml, .otio too)
audio talk.mp4 shrink 0.3 save talk.edl

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

# loudness to spec: integrated, max momentary / short-term, speech only, true peak
audio mix.wav stat loudness momentary shortterm dialog truepeak

# pass or fail against a delivery spec (exit 1 on a fail); --json for scripts
audio episode.wav normalize podcast check podcast
audio chapter.wav check acx --json

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
audio 'chapters/*.mp3' check acx                      # a whole audiobook: one line per chapter
```

### Stdin/stdout

```sh
cat in.wav | audio gain -3db save -      > out.wav
curl -s https://ex.com/speech.mp3 | audio normalize save clean.wav
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
<dd>Audio is stored in fixed-size pages. In the browser, with <code>{ storage: 'persistent' }</code> (or <code>'auto'</code>, where OPFS exists), cold pages evict to OPFS when memory exceeds budget — auto-sized from <code>navigator.storage.estimate()</code> (quota/4, 64MB..512MB), overridable via <code>{budget}</code>; each instance keeps its own store, its copies share it. Works for decoded files, <code>audio.from(pcm)</code> and pushed streams. Stats stay resident (~7 MB for 2h stereo).</dd>

<dt>Are edits destructive?</dt>
<dd>No. <code>a.gain(-3).trim()</code> pushes entries to an edit list — source pages aren't touched. Edits replay on <code>read()</code> / <code>save()</code> / <code>for await</code>.</dd>

<dt>Can I use it in the browser?</dt>
<dd>Yes, same API. See <a href="#browser">Browser</a> for bundle options and import maps.</dd>

<dt>Does it need the full file before I can work with it?</dt>
<dd>No. Playback, edits, and structural ops (crop, repeat, pad, insert, etc.) all stream incrementally during decode — output begins before the file finishes loading. The edit plan recompiles as data arrives, tracking a safe output boundary per op. Only ops that depend on total length (open-end reverse, negative <code>at</code>) wait for full decode.</dd>

<dt>TypeScript?</dt>
<dd>Yes, ships with <code>audio.d.ts</code>.</dd>

<dt>Does it have feature parity with FFmpeg / SoX / librosa?</dt>
<dd>Yes — the <a href="https://github.com/audiojs">audiojs</a> ecosystem covers the practical baseline of FFmpeg filters, SoX effects, librosa analysis, Pedalboard and MIREX, all as <code>@audio/*</code> plugins <code>audio</code> wires through one API (the few uncovered items are esoteric or deliberately skipped). Every effect, filter, generator and analyzer lives in the <a href="docs/plugins.md#registry">registry</a> — call one by name and it loads on first use. Coverage matrix: <a href="docs/comparison.md">docs/comparison.md</a>.</dd>

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
