# Recipes

See also: [Reference](reference.md) · [Architecture](architecture.md) · [Plugins](plugins.md)

## Clean up a voice recording

```js
let a = await audio('raw-take.wav')
a.trim(-30).normalize('podcast').fade(0.3, 0.5)
await a.save('clean.wav')
```
```sh
npx audio raw-take.wav trim -30db normalize podcast fade 0.3s -0.5s -o clean.wav
```

## Render a waveform

```js
let a = await audio('track.mp3')
let [mins, peaks] = await a.stat(['min', 'max'], { bins: canvas.width })
for (let i = 0; i < peaks.length; i++) {
  ctx.fillRect(i, h/2 - peaks[i] * h/2, 1, (peaks[i] - mins[i]) * h/2)
}
```

## Progressive waveform (stream as it decodes)

```js
let a = audio('long.flac')
a.on('data', ({ delta }) => {
  appendBars(delta.max[0], delta.min[0])
})
await a
```

## Record from mic

```js
let a = audio()
a.record()                             // starts mic capture (requires audio-mic)
await new Promise(r => setTimeout(r, 5000))  // record 5 seconds
a.stop()                               // stop recording + finalize
a.trim().normalize()
await a.save('recording.wav')
```

`.record()` again after `.stop()` resumes — new chunks append to existing audio.

## Push from any source

`audio()` is the universal receiver — anything that produces chunks calls `.push()`:

```js
import mic from 'audio-mic'

let a = audio()
let read = mic({ sampleRate: 44100, channels: 1, bitDepth: 16 })
read((err, buf) => {
  if (buf) a.push(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2), 'int16')
})

// ... record for a while ...
read(null)                             // stop mic
a.stop()                               // finalize
a.trim().normalize()
await a.save('recording.wav')
```

<details><summary>Web Audio API / WebSocket / Node stream</summary>

```js
// Web Audio API (browser)
let a = audio()
proc.onaudioprocess = e => a.push([e.inputBuffer.getChannelData(0)])
// ... later: proc.disconnect(); a.stop()

// WebSocket
let a = audio()
ws.onmessage = e => a.push(new Int16Array(e.data), 'int16')
ws.onclose = () => a.stop()

// Node.js readable stream (raw PCM)
let a = audio()
pcmStream.on('data', buf => a.push(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2), 'int16'))
pcmStream.on('end', () => a.stop())
```

</details>

## Podcast montage

```js
let intro = await audio('intro.mp3')
let body  = await audio('interview.wav')
let outro = await audio('outro.mp3')

body.trim().normalize('podcast')
let ep = audio([intro, body, outro])
ep.fade(0.5, 2)
await ep.save('episode.mp3')
```
```sh
npx audio intro.mp3 + interview.wav + outro.mp3 trim normalize podcast fade 0.5s -2s -o episode.mp3
```

## Voiceover on music

```js
let music = await audio('bg.mp3')
let voice = await audio('narration.wav')
music.gain(-12)
music.mix(voice, { at: 2 })             // overlay narration at 2s
await music.save('mixed.wav')
```
```sh
npx audio bg.mp3 gain -12db mix narration.wav 2s -o mixed.wav
```

## Batch normalize

```sh
npx audio '*.wav' trim normalize podcast -o '{name}.clean.{ext}'
```

## Batch with macro file

```sh
echo '[{"type":"trim"},{"type":"normalize","args":["podcast"]},{"type":"fade","args":[0.3]},{"type":"fade","args":[-1]}]' > recipe.json
npx audio '*.wav' --macro recipe.json -o '{name}.processed.{ext}'
```

## Generate a tone

```js
let TAU = Math.PI * 2
let a = audio.from(t => Math.sin(440 * TAU * t), { duration: 2 })
await a.save('440hz.wav')
```
```sh
npx audio --tone 440hz 2s -o tone.wav
```

## Sonify data

```js
let prices = [100, 102, 98, 105, 110, 95, 88, 92, 101, 107]
let dur = 0.2
let a = audio.from(t => {
  let idx = Math.min(Math.floor(t / dur), prices.length - 1)
  let freq = 200 + (prices[idx] - 80) * 10
  return Math.sin(freq * Math.PI * 2 * t) * 0.5
}, { duration: prices.length * dur, sampleRate: 44100 })
await a.save('stock-sonification.wav')
```

## Extract features for ML

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

## Split a long file

```js
let a = await audio('audiobook.mp3')
let [ch1, ch2, ch3] = a.split(1800, 3600)
for (let [i, ch] of [ch1, ch2, ch3].entries())
  await ch.save(`chapter-${i + 1}.mp3`)
```
```sh
npx audio audiobook.mp3 split 30m 60m -o 'chapter-{i}.mp3'
```

## Remove a section

```js
let a = await audio('interview.wav')
a.remove({ at: 120, duration: 15 })    // cut 2:00–2:15
a.fade(0.1, { at: 120 })               // smooth the splice point
await a.save('edited.wav')
```
```sh
npx audio interview.wav remove 2m..2m15s fade 0.1s 2m..2m0.1s -o edited.wav
```

## Stream to network (low memory)

```js
let a = await audio('2hour-mix.flac')
a.highpass(40).normalize('broadcast')
for await (let chunk of a.stream()) {
  socket.send(chunk[0].buffer)
}
```
```sh
npx audio 2hour-mix.flac highpass 40hz normalize broadcast | stream-to-icecast
```

## Ringtone from any song

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

## Stereo autopan

```js
let a = await audio('song.wav')
a.pan(t => Math.sin(t * 0.5))
await a.save('autopan.wav')
```

## Tremolo / sidechain

```js
let a = await audio('pad.wav')
a.gain(t => -12 * (0.5 + 0.5 * Math.cos(t * Math.PI * 4)))  // 2Hz tremolo in dB
await a.save('tremolo.wav')
```
```js
let music = await audio('mix.wav')
let env = await audio('kick.wav').then(a => a.read({ channel: 0 }))
music.gain(t => 1 - Math.abs(env[Math.floor(t * 44100)] || 0), { unit: 'linear' })
await music.save('sidechained.wav')
```

## Detect clipping

```js
let a = await audio('master.wav')
let clips = await a.stat('clip')
if (clips.length) console.warn(`${clips.length} clipped blocks at: ${[...clips.slice(0, 5)].map(t => t.toFixed(2) + 's')}`)

let overlay = await a.stat('clip', { bins: 1000 })  // per-bin clip counts for waveform overlay
```
```sh
npx audio master.wav stat clip
```

## Playback with seek

```js
let a = await audio('episode.mp3')
a.play({ volume: -3 })
a.seek(300)
a.volume = -6                               // live volume change (dB)
a.pause()
a.resume()
```
```sh
npx audio episode.mp3 -p
```

## A/B compare loudness

```js
let a = await audio('mix-v1.wav'), b = await audio('mix-v2.wav')
let [la, lb] = await Promise.all([a.stat('loudness'), b.stat('loudness')])
console.log(`v1: ${la.toFixed(1)} LUFS  v2: ${lb.toFixed(1)} LUFS  Δ${(lb - la).toFixed(1)}`)
```
```sh
npx audio mix-v1.wav mix-v2.wav stat loudness
```

## Pipe stdin/stdout

```sh
curl -s https://example.com/speech.mp3 | npx audio gain -3db normalize -o clean.wav
ffmpeg -i video.mp4 -f wav - | npx audio trim normalize podcast > voice.wav
```

## Custom op — bitcrusher

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

## Serialize edits, restore later

```js
let a = await audio('voice.mp3')
a.trim().normalize('podcast').fade(0.3, 0.5)

let json = JSON.stringify(a)                // { source, edits, ... }
// ... persist to DB, send to worker, etc.
let b = await audio(JSON.parse(json))       // re-decode + replay edits
await b.save('restored.wav')
```

## Glitch: stutter + reverse segments

```js
let a = await audio('beat.wav')
let v = a.view({ at: 1, duration: 0.25 })  // grab a 250ms slice
let glitch = audio([v, v, v, v])            // 4x stutter
glitch.reverse({ at: 0.25, duration: 0.25 })  // reverse 2nd hit
glitch.gain(t => -12 * t)                  // decay into silence
await glitch.save('glitch.wav')
```
