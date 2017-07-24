# Audio — Work In Progress

[![experimental](https://img.shields.io/badge/stability-experimental-red.svg)](http://github.com/badges/stability-badges)
[![Build Status](https://img.shields.io/travis/audiojs/audio.svg)](https://travis-ci.org/audiojs/audio)
[![Greenkeeper badge](https://badges.greenkeeper.io/audiojs/audio.svg)](https://greenkeeper.io/)
[![Code Climate](https://codeclimate.com/github/audiojs/audio/badges/gpa.svg)](https://codeclimate.com/github/audiojs/audio)
[![Downloads](https://img.shields.io/npm/dm/audio.svg)](https://npmjs.org/package/audio)
[![npm](https://img.shields.io/npm/v/audio.svg)](https://www.npmjs.com/package/audio)
[![license](https://img.shields.io/npm/l/audio.svg)](https://www.npmjs.com/package/audio)


Class for high-level audio manipulations in javascript.

<!--
	ideas:
	  - docs
	  - playground (demo)
	  - downloads
	  - size
	  - image (just teaser/logo)
-->

## Usage

[![npm install audio](https://nodei.co/npm/audio.png?mini=true)](https://npmjs.org/package/audio/)

Load `./sample.mp3`, trim, normalize, fade in, fade out, save:

```js
const Audio = require('audio')

Audio.load('./sample.mp3').then(audio =>
  audio
    .trim()
    .normalize()
    .fade(.5)
    .fade(-.5)
    .save('sample-edited.wav')
)
```

<!--
ideas:
- image
  file → waveform → processed waveform → file
- try yourself - requirebin demo with file opener and processing

mvp:

- stats: averages, variance
- push data
- delete data (splice?)
- insert data (splice?)

- remove Buffer, process from exports

test projects:

- waveform player for Steve's website
- text waveform

-->

<!--
Record 4s of microphone input.

```js
const Audio = require('audio')

navigator.getUserMedia({audio: true}, stream =>	{
	Audio(stream, {duration: 4}).on('end', audio => audio.save())
});
```

### 3. Record and download 2 seconds of web-audio experiment

```js
const Audio = require('audio')

//create web-audio experiment
let ctx = new AudioContext()
let osc = ctx.createOscillator()
osc.type = 'sawtooth'
osc.frequency.value = 440
osc.start()
osc.connect(ctx.destination)

//record 2 seconds of web-audio experiment
let audio = new Audio(osc, {duration: 2})
audio.on('end', () => {
	osc.stop()
	audio.download('experiment')
})
```

### 4. Download AudioBuffer returned from offline context

```js
const Audio = require('audio')

//setup offline context
let offlineCtx = new OfflineAudioContext(2, 44100*40, 44100)
audioNode.connect(offlineCtx)

//process result of offline context
offlineCtx.startRendering().then((audioBuffer) => {
	Audio(audioBuffer).download()
})
```

### 5. Montage audio

```js
const Audio = require('audio')

let audio = Audio('./record.mp3', (err, audio) => {
	//repeat slowed down fragment
	audio.write(Audio(audio.read(2.1, 1)).scale(.9), 3.1)

	//delete fragment, fade out
	audio.delete(2.4, 2.6).fadeOut(.3, 2.1)

	//insert other fragment not overwriting the existing data
	Audio('./other-record.mp3', (err, otherAudio) => {
		audio.insert(2.4, otherAudio)
	})

	audio.download('edited-record')
})
```

### 6. Render waveform of HTML5 `<audio>`

```js
const Audio = require('audio')
const Waveform = require('gl-waveform')

//create waveform renderer
let wf = Waveform();

//get audio element
let audioEl = document.querySelector('.my-audio')
audioEl.src = './chopin.mp3'

//create audio holder
let audio = new Audio(audioEl)
audio.on('load', (err, audio) => {
	let buf = audio.readRaw(4096)
	let data = buf.getChannelData(0)

	//put left channel data to waveform renderer
	wf.push(data);
})
```

### 7. Process audio with _audio-*_ modules

```js
const Audio = require('audio')
const Biquad = require('audio-biquad')

let lpf = new Biquad({frequency: 2000, type: 'lowpass'})
let audio = Audio(10).noise().process(lpf)
```

### 8. Data handle - subaudio, for sprites etc

### 9. Load intro, append 1s pause, start recording. Once ended, save as file.

Audio(['./intro.mp3', 1, MediaStream]).once('ready', (err, audio) => audio.save(Date() + '-recording.mp3'))
-->

## API

**1. [Creation](#creation)**

* [x] [new Audio(src?, opts?)]()
* [x] [Audio.load(url, opts?)]()
* [x] [Audio.decode(buf, opts?)]()
* [ ] [Audio.record(stream, opts?)]()

**2. [Properties](#properties)**

* [ ] [audio.buffer]()
* [ ] [audio.channels]()
* [ ] [audio.duration]()
* [ ] [audio.length]()
* [ ] [audio.sampleRate]() <kbd>readonly</kbd>

**3. [Playback](#playback)**

* [ ] [audio.play(t?, dur?, opts?)]()
* [ ] [audio.pause()]()
* [ ] [audio.muted]()
* [ ] [audio.loop]()
* [ ] [audio.rate]()
* [ ] [audio.volume]()
* [ ] [audio.paused]() <kbd>readonly</kbd>
* [ ] [audio.currentTime]()

**4. [Metrics](#metrics)**

* [ ] [audio.average(t?, dur?, opts?)]()
* [ ] [audio.variance(t?, dur?, opts?)]()
* [x] [audio.range(t?, dur?, opts?)]()
* [ ] [audio.spectrum(t?, dur, opts?)]()
* [ ] [audio.loudness(t?, dur)]()
* [ ] [audio.cepstrum(t?, dur)]()
* [ ] [audio.size(t?, dur, opts?)]()

**5 [Manipulations](#manipulations)**

* [x] [audio.read(dst?, t?, dur?, opts?)]()
* [x] [audio.write(src, t?, dur?, opts?)]()
* [ ] [audio.insert(data, t?, dur?, opts?)]()
* [ ] [audio.slice(t?, dur?, opts?)]()
* [ ] [audio.remove(t?, dur?, opts?)]()
* [x] [audio.reverse(t?, dur?, opts?)]()
* [x] [audio.invert(t?, dur?, opts?)]()
* [x] [audio.gain(db, t?, dur?, opts?)]()
* [ ] [audio.fade(t?, dur?, opts?)]()
* [x] [audio.normalize(t?, dur?, opts?)]()
* [ ] [audio.pan(amt, t?, dur?, opts?)]()
* [ ] [audio.mix(audio, t?, dur?, opts?)]()
* [ ] [audio.fill(val|fn, t?, dur?, opts?)]()
* [ ] [audio.scale(amt, t?, opts?)]()
* [ ] [audio.shift(amt, t?, opts?)]()
* [ ] [audio.trim(t?, dur?, opts?)]()
* [ ] [audio.repeat(times, t?, dur?, opts?)]()
* [ ] [audio.pad(dur, opts?)]()
* [ ] [audio.through(fn, opts?)]()

**6. [Utilities](#utilities)**

* [ ] [audio.save(name, opts?, cb?)]()
* [ ] [audio.stream(dst, opts?, cb?)]()
* [ ] [Audio.isAudio(a)]()
* [ ] [Audio.isEqual(a, b, ...c)]()
* [ ] [Audio.gain(db)]()
* [ ] [Audio.db(gain)]()
* [ ] [Audio.time(offset)]()
* [ ] [Audio.offset(time)]()


## Creation

### let audio = new Audio(source?, channels|options?)

Create `audio` instance from `source` with provided `options`.

```js
// Create one second of silence
let blankAudio = new Audio(1)

// Create from AudioBuffer
let bufAudio = new Audio(audioCtx.createBuffer(2, 22050, 44100))

// Create from raw planar data
let rawAudio = new Audio(new Float32Array([0,1,.2,.3,...]), {channels: 2})

// Create from multiple sources wrapped to 1s of silence
let joinedAudio = new Audio([1, blankAudio, rawAudio, bufAudio, 1], {channels: 2})

// Create from channels data
let chData = new Audio([[0,0,0], [.1,.1,.1], [.2,.2,.2]])

// Create from fully-defined options
let optAudio = new Audio({
  channels: 3,
  data: rawAudio
})

// Create from base64 string
```

#### Source

| Type | Meaning |
|---|---|
| _AudioBuffer_ | Create audio based on audio buffer (that is [web-audio-api audio-buffer](https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer)). |
| _AudioBufferList_ | Create audio based on audio-buffer-list. |
| _Audio_ | Create based on passed audio instance. |
| _Number_ | Create silent audio of the indicated duration, in seconds. |
| _FloatArray_ | Read raw data with planar layout `[l, l, l, l, ... r, r, r, r, ...]`. |
| _Array_ of _Arrays_ | Read raw channels data `[[l, l, l...], [r, r, r...]]`. |
| _Array_ of anything | Join multiple various sources together. |
| TODO: ndsamples | |
| TODO: ndarray | |
| TODO: ArrayBuffer, Buffer | |
| TODO: base64/datauri string | |

#### Options

| Property | Description | Default |
|---|---|---|
| `channels`, `numberOfChannels` | _Number_ or _Array_, indicating source channels count or channels layout. | `source` channels or `1` |
| `length`, `duration` | Ensure the length or duration, duration is in seconds | `source` length |
| `context` | Web audio context instance, optional. | [`audio-context`](https://github.com/audiojs/audio-context) |
| `sampleRate`, `rate` | Ensure sample rate. | `source` or `context` sample rate |
| `stats` | Track statistics. Increases memory consumption 3 times, but allows for fetching metrics data `O(C)`, useful for rendering purposes. | `false` |
| `data` | Source data, if no `source` provided as the first argument. | `null` |
| `format` | Source data format, if necessary, such as `'uint8 interleaved'`. Useful for cases of raw data. | `auto` |

#### Related APIs

* [audio-buffer](https://github.com/audiojs/audio-buffer)
* [audio-buffer-list](https://github.com/audiojs/audio-buffer-list)
* [audio-buffer-from](https://github.com/audiojs/audio-buffer-from)



### Audio.load(source, (error, audio)=>{}?)

Load and decode local or remote audio file or list of files. Callback is invoked when all data is loaded and decoded. Returns promise.

```js
// Load remote file, promise style
Audio.load('https://remote.url/file.mp3').then(audio => {}, error => {})

// Load local file, callback style
Audio.load('./chopin.mp3', (error, audio) => {
  audio.normalize().trim().fade(-1).insert(intro, 0).saveAs('concert.wav')
})

// Load multiple sources
Audio.load([
  './intro.wav',
  'https://remote.url/file.mp3',
  Audio.load('./outro.wav'),
  Audio(2)
]).then(items => {
  let joined = Audio(items)
})
```

#### Source

| Type | Meaning |
|---|---|
| Local path: `./*`, `/*`, `../*`, `C:\*` etc. | Load or read local file relative to caller module's directory, ie. from the place where `Audio.load()` is invoked. In browser it is relative to current URL. |
| Remote path: `http[s]://*` | Load and decode remote file. |
| TODO: data-uri string | |
| _Array_ of anything | Listed sources are loaded in parallel and callback is invoked when all sources are ready. |

TODO: freesound loader, soundcloud loader

#### Related APIs

* [audio-load](https://github.com/audiojs/audio-load)
* [audio-loader](https://github.com/audiojs/audio-loader)



### Audio.decode(source, (error, audio)=>{}?)

Decode audio data from `source` with data in an audio format. `wav` and `mp3` formats are supported out of the box, to enable other formats, include proper codec from [audiocogs](https://github.com/audiocogs), such as [flac.js](https://github.com/audiocogs/flac.js), [opus.js](https://github.com/audiocogs/opus.js) and others.

```js
// Decode binary data, callback style
Audio.decode(require('audio-lena/mp3'), (err, audio) => {})


// Decode flac data-uri string, promise style
require('flac.js')
Audio.decode(require('audio-lena/flac-datauri')).then(audio => {}, err => {})
```

#### Source

| Type | Meaning |
|---|---|
| _ArrayBuffer_ | Array buffer instance with encoded data, default for browser/node. |
| _Buffer_ | [Nodejs buffer](https://nodejs.org/api/buffer.html) with encoded data. |
| _Blob_ | [Blob](https://developer.mozilla.org/en/docs/Web/API/Blob) instance with encoded data. |
| _File_ | [File](https://developer.mozilla.org/en/docs/Web/API/File) with encoded data, the name will be dropped. |
| dataURI string | [Data-URI](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URIs) string of a kind `data:audio/<type>;base64,<data>` .|
| Base64 string | String with [base64](https://developer.mozilla.org/en/docs/Web/API/WindowBase64/Base64_encoding_and_decoding)-encoded data. |
| _AudioBufferView_ | _Float32Array_, _UInt8Array_ etc. with encoded data. |
| _Array_ of above | Decode list of sources, invoke callback when everything succeeded. |

#### Format

| Format | Package |
|---|---|
| `wav` | shipped by default |
| `mp3` | shipped by default via [mp3.js](https://github.com/audiocogs/mp3.js) |
| `mp4` | [mp4.js](https://github.com/audiocogs/mp4.js) |
| `aac` | [aac.js](https://github.com/audiocogs/mp4.js) |
| `flac` | [flac.js](https://github.com/audiocogs/flac.js) |
| `alac` | [alac.js](https://github.com/audiocogs/alac.js) |
| `opus` | [opus.js](https://github.com/audiocogs/opus.js) |
| `ogg` | TODO: not working due to issues in [vorbis.js](https://github.com/audiocogs/vorbis.js/issues/3) |

#### Related APIs

* [audio-decode](https://github.com/audiojs/audio-decode)
* [audio-type](https://github.com/audiojs/audio-type)
* [aurora](https://github.com/audiocogs/aurora.js)



### Audio.record(source, (error, audio)={}?)

Create promise to record stream-ish source. Promise recieves `progress` clause.

```js
```

#### Source

TODO

| Type | Meaning |
|---|---|
| _Stream_ | |
| _pull-stream_ | |
| _Function_ | |
| _MediaStream_ | |
| _WebAudioNode_ | |
| _HTMLAudioElement_, _HTMLMediaElement_ | |
| _Array_ with sources | |


<!--

* **Stream** − [_Stream_](https://nodejs.org/api/stream.html), [_pull-stream_](https://github.com/pull-stream/pull-stream), _Function_, [_MediaStream_](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream)_WebAudioNode_ or _Array_ with sequence of any sources. Starts recording, updating contents until input stream ends or max duration reaches. `data` and `end` events are emitted during stream consumption. Returned thenable takes arguments `.then(success, error, progress)`. Plays role of [audiorecorder](https://npmjs.org/package/audiorecorder).
-->
<!--
| _HTMLAudioElement_, _HTMLMediaElement_ | Wrap [`<audio>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio) or [`<video>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video) element, capture it's contents. Puts audio into recording state. | stream |
-->

---

## Properties

### audio.buffer

[_AudioBufferList_](https://github.com/audiojs/audio-buffer-list) with audio data. Readable, writable.

### audio.channels

Number of channels. Changing this property will up-mix or down-mix channels, see interpretation table in [audio-buffer-remix](https://github.com/audiojs/audio-buffer-remix).

### audio.sampleRate

Buffer sample rate. Changing this property will resample audio to target rate. (WIP)

### audio.duration

Buffer duration. Changing this property will trim or pad the data.

### audio.length

Get total length of audio in samples.

---


## Playback

### audio.play(time=0, duration?, {rate, loop, volume}?, onended?)

Start playback from the indicated `start` time offset, invoke callback on end.

### audio.pause()

Pause current playback. Calling `audio.play()` once again will continue from the point of pause.

### audio.muted

Mute playback not pausing it.

### audio.loop

Repeat playback when the end is reached.

### audio.rate

Playback rate, by default `1`.

### audio.volume

Playback volume, defaults to `1`.

### audio.paused

If playback is paused.

### audio.currentTime

Current playback time in seconds. Setting this value seeks the audio to the new time.

---


## Metrics

### audio.range(time=0, duration?, {channel|channels}?)

Find amplitudes range for the indicated time interval. Returns an array with `min, max` values. Accounts for all channels.

```js
//get min/max amplitude for the .5s interval starting from 1s
let [min, max] = audio.range(1, .5)

//get min/max amplitude in left channel
let [lMin, lMax] = audio.range({channel: 0})
```

### audio.spectrum(time=0, options?)

Get array with spectral component magnitudes (magnitude is length of a [phasor](wiki) — real and imaginary parts). [fourier-transform](https://www.npmjs.com/package/fourier-transform) is used internally.

Possible `options`:

| name | default | meaning |
|---|---|---|
| _size_ | `1024` | Size of FFT transform, e. g. number of frequencies to capture. |
| _channel_ | `0` | Channel number to get data for, `0` is left channel, `1` is right etc. |
| _db_ | `false` | Convert resulting magnitudes from `0..1` range to decibels `-100..0`. |

### audio.loudness(time, duration)
### audio.cepstrum(time, duration)
### audio.average(time, duration)
### audio.variance(time, duration)
### audio.clip(time, duration)
### audio.size(time, duration)
<!--
Ideas:

* chord/scale detection
* tonic, or main frequency for the range — returns scientific notation `audio.pitch(time=0, (err, note) => {})`
* tempo for the range `audio.tempo(time=0, (err, bpm) => {})`
-->

---


## Manipulations

### audio.read(destination?, time=0, duration?, {channel|channels, format, start, end}?)

Read audio data from the indicated range, put result into `destination`. If destination is not defined, an array or object will be created based on `format`. By default returns array with channels data.

```js
//get channels data for the 5s subrange starting from the 1s
let [leftChannel, rightChannel] = audio.read(1, 5, {format: 'array'})

//get audiobuffer with whole audio data
let abuf = audio.read({format: 'audiobuffer'})

//get 1s of SR and SL channels data, starting from 0.5s
let [slChannel, srChannel] = audio.read(.5, 1, {channels: [2,3]})

//get last 1000 samples of right channel data
let rightChannelData = audio.read(new Float32Array(1000), {channel: 1, start: -1000, end: 0})
```

#### Options

Property | Description | Default
---|---|---
`channel` | A channel to read data from. | `null`
`channels`, `numberOfChannels` | _Number_ or _Array_, indicating channels to read data from. | `this.channels`
`start`, `end` or `length` | Optional interval markers, in samples. | `null`
`format` or `dtype` | Returned data type. | `destination` type


### audio.write(data, time=0, duration?, {channel|channels, format, start, end}?)

Write `data` to audio starting at the indicated `time`, optionally sliced by the `duration`. Optionally indicate `format` of data source.

```js
//write data to left and right channels
audio.write([new Float32Array(100), new Float32Array(100)])

//write L and R buffer channels to SL and SR channels starting from 0.5s of the duration .25s
audio.write(audioCtx.createBuffer(2, 22050, 44100), .5, .25, {channels: [2,3]})

//write 100 samples to the right channel starting from 1000 sample
audio.write(new Float32Array(100).fill(0), {start: 1000, channels: 1})
```

#### Data type

Type | Meaning
---|---
`Array<Array>` | Array with channels data.
`AudioBuffer`, `AudioBufferList`, `Audio` | Other audio source.
`Array<Number>`, `Float32Array`, `Float64Array` | Raw samples from `-1..+1` range, interpreted by `options.format` |
`Int8Array`, `Uint8Array`, `TypedArray` | Other typed array, interpreted by `options.format`.
`ArrayBuffer`, `Buffer` | Raw data, interpreted by `options.format`.
`base64`, `dataURI` string | String with raw data, decoded based on `options.format`.
`ndarray`, `ndsamples` | n-dimensional array with `[length, channels]` shape.

#### Options

Property | Meaning
---|---
`channels`, `channel` | Target channels to write source data, can be an array or number.
`start`, `end` or `length` | Optional interval markers, in samples.
`format` or `dtype` | Source data format, if necessary, like `'uint8 stereo interleaved'`.

#### Related API

* [audio-format](https://github.com/audiojs/audio-format)
* [audio-buffer-from](https://github.com/audiojs/audio-buffer-from)


### audio.append(data1, data2, ..., {channels}?)

Append data to the end of audio. `data` should be [_AudioBuffer_](https://github.com/audiojs/audio-buffer), [_AudioBufferList_](https://github.com/audiojs/audio-buffer-list), _Audio_, _FloatArray_ or list of _FloatArrays_.

```js
//write data to left and right channels
audio.append([new Float32Array(100), new Float32Array(100)], audioCtx.createBuffer(2, 22050, 44100), audio2)
```

### audio.insert(data, time=0, {start, channels}?)

Insert data at the indicated `time`. If `time` is omitted, the `data` will be appended to the beginning of audio. `data` should be [_AudioBuffer_](https://github.com/audiojs/audio-buffer), [_AudioBufferList_](https://github.com/audiojs/audio-buffer-list), _Audio_, _FloatArray_ or list of _FloatArrays_. `data` and `time` can be swapped places for compatibility.

```js
//append data to the end
audio.insert([new Float32Array(100), new Float32Array(100)], -0)

//prepend L and R buffer channels to SL and SR channels
audio.insert(audioCtx.createBuffer(2, 22050, 44100), {channels: [2,3]})

//insert async data
Audio('./src.mp3').then(audio =>
    Audio('./src2.mp3').then(audio2 => audio.insert(audio2))
).then(audio => {
	//...audio here contains both src and src2
})
```

### audio.remove(time=0, duration?, {start, end}?)

Remove fragment of the indicated `duration` starting from the indicated `time`. If time is undefined, the fragment will be removed from the beginning of audio. Alternatively, indicate fragment by `start` and `end` properties. Returns audio with the removed fragment.

```js
//remove 1s starting from 0.5s
let fragment = audio.remove(.5, 1)
```

### audio.slice(time=0, duration=total, {start, end, channels, clone}?)

Get fragment of audio containing the indicated part. By default it returns sub-audio, unless `{clone: true}` is indicated by options.

```js
//get shallow copy of audio
let dup = audio.slice()

//get 0.5s...1.5s fragment with only stereo channels
let frag1 = audio.slice(.5, 1, {channels: [0,1]})

//clone 100 samples of audio contents
let frag2 = audio.slice({start: 100, end: 200, clone: true})
```

### audio.repeat(times)

Repeat existing contents of audio indicated number of times.

```js
//empty audio
zero = audio.repeat(0)

//no operation
audio = audio.repeat(1)

//repeat two times
twiceAudio = audio.repeat(2)
```

### audio.trim({threshold:-40, left, right, level}?)

Trim silence at the beginning/end. Optionally define `threshold` in decibels, `left` and `right` trim restrictions. `level` can be used to define threshold as absolute value `0..1`.

```js
//trim silence from ends
Audio([0,0,0,.1,.2,-.1,-.2,0,0], 1).trim()
// <.1, .2, -.1, -.2>

//trim samples from the beginning below -30 db
Audio([0.0001, 0, .1, .2, ...], 1).trim({threshold: -30, left: true})
// <.1, .2, ...>

//remove samples below .02 from the end
Audio([.1, .2, -.1, -.2, 0, .0001]).trim({level: .02, left: false})
// <.1, .2, -.1, -.2>
```

### audio.pad(duration, {value:0, left, right}?)

Make sure the duration of the audio is at least the indicated `duration`. Pass `{left: true}` or `{right: true}` depending on what direction you need to pad.

```js
//pad right, same as audio.duration = 10
audio.pad(10)

//pad left with value 1
audio.pad(10, {left: true, value: 1})
```

### audio.fade(time=0, duration=0.4, {gain:-40db, easing, start, end,channels}?)`

Fade in or fade out volume for the `duration` starting from `time`. Duration can be negative, in that case it will fade backwards, i.e. fade out. Options may supply `easing` function or specific `gain`.

Default `easing` is linear, but any of the [eases](https://npmjs.org/package/eases) functions can be used. `easing` function has signature `v = ease(t)`, where `t` and `v` are from `0..1` range.

Fading is done by decibels to compensate logarithmic volume perception.

```js
const eases = require('eases')

Audio('./source.ogg').on('load', audio => {
    //fade in 1s from the beginning
    audio.fade(1, easing.cubicInOut)

    //fade out 1s from the end
    .fade(-1, easing.quadIn)

    //fade in 20db during .2s starting at .6s
    .fade(.6, .2, {gain: -20})

    //fade out 5db during .2s starting at .8s (ending at 1s)
    .fade(1, .2, {gain: -5})
})
```

### audio.normalize(time=0, duration?, {start, end, channels}?)

Normalize indicated interval or full audio, i.e. bring amplitudes to -1..+1 range. Max amplitude is found within all defined `channels`, if supplied.

```js
//normalize full contents
let audio = Audio(new Float32Array([0,.1,0,-.1]), {channels: 1}).normalize()
audio.get({channels: 0}) // [0, 1, 0, -1]

//normalize 0 and 1 channels
audio = Audio(new Float32Array([0,.1,  0,.2,  0,.3]), {channels: 3}).normalize({channel: [0, 1]})
audio.get() // [[0, .5], [0, 1], [0, .3]]
```

| Property | Meaning |
|---|---|
| `channels` | Channels to affect, by default all. |
| `start` | Start from the position. |
| `end` | End at the position. |
| `dcOffset` | TODO: Remove DC offset, by default `true`. Can be a number. |
| `range` | TODO: Amplitudes range, by default `[-1, 1]`. |

### audio.gain(volume, time=0, duration?, {start, end, channels}?)

Change volume of the interval of `duration` starting at `time`. `volume` is in decibels.

```js
//make half as loud
let audio = new Audio(Array(44100).fill(1), 1).gain(-20)
```

### audio.reverse(time=0, duration?, {start, end, channels}?)

Change the direction of samples for the indicated part.

```js
Audio('./sample.mp3', audio => {
    //reverse first three seconds of audio and play
    audio.reverse(0, 3).play()
})
```

### audio.shift(time=0, {rotate: false})

Shift contents of audio to the left or right.

### audio.pan(balance=.5, {gain: -5})

Apply stereo panning with audio compensation.

```js
```

### audio.mix(otherAudio, time=0, duration?, {channels}?)

Lay second audio over the first one at the indicated interval.

### audio.scale(amount, time=0, duration?)

Change playback rate, pitch will be shifted.

### audio.through(buf => buf, time=0, duration?, {channels, frame}?)`

Process audio or part of it with a function.

```js
//generate 2s of gray noise in stereo
let filter = require('audio-filter/loudness')()
let noise = require('audio-noise/white')()
let a = Audio(2, 2).through(noise, filter)

//create oscillator with LPF
let biquad = require('audio-filter/biquad')()
let saw = require('audio-oscillator/sawtooth')()
let b = Audio(2).through(saw, biquad)
```

#### Options

| Property | Default | Meaning |
|---|---|---|
| `frame` | `false` | Ensure processing frame length. By default it is the same as in constructor. |
| `channel`, `channels` | `all` | Affect only indicated channels, can be a number or array. |
| `start` | `null` | Start from the indicated sample offset. |
| `end` | `null` | End at the indicated sample offset. |
| `time` | `null` | Start at the indicated time, in seconds. Supercedes `time` argument. |
| `duration` | `null` | Affect the duration starting from the indicated time, in seconds. |

---


## Utilities

### Audio.isAudio(src)

Check if `src` is instance of _Audio_.

### Audio.fromDb(db), Audio.toDb(gain)

Convert gain to decibels or backwards, see [decibels](https://github.com/audiojs/decibels).

### audio.save(fileName, done?)

Download as a wav file in browser, write audio to file in node. In node file is going to be saved to the same directory as the caller's one. To redefine directory, use absolute path as `audio.save(__dirname + '/my-audio.wav')`. See [save-file](https://github.com/dfcreative/save-file) for details.

```js
//save as wav file
audio.save('my-audio.wav', (err, audio) => {
    if (err) throw err;
})
```

If you need custom output format, like _ogg_, _mp3_ or other, please use [audio-encode](https://github.com/audiojs/audio-encode).

```js
//save as ogg file
const encode = require('audio-encode/ogg')
const save = require('save-file')
encode(audio.buffer, (err, buf) => {
    save(buf, 'my-audio.ogg')
})
```

## See Also

* [audiojs](https://github.com/audiojs) − collection of open-source audio components for javascript
* [web-audio-api](https://github.com/audiojs/web-audio-api) − web-audio-api implementation for nodejs


## Credits

Acknowledgement to contributors:

* [Jamen Marz](https://github.com/jamen) for initiative and help with making decisions.
* [Daniel Gómez Blasco](https://github.com/danigb/) for patience and work on [audio-loader](https://github.com/audiojs/audio-loader).
* [Michael Williams](https://github.com/ahdinosaur) for audio stream insights.


## License

[MIT](LICENSE) &copy; <a href="https://github.com/audiojs">audiojs</a>.
