# Audio API

## Table of Contents

**1. [Creation](#creation)**

* [ ] [new Audio(src?, opts?)]()
* [x] [Audio.from(a, b?, ...c?, opts?)]()
* [ ] [Audio.load(url, opts?, cb?)]()
* [ ] [Audio.decode(buf, opts?, cb?)]()
* [ ] [Audio.record(stream, opts?)]()

**2. [Properties](#properties)**

* [ ] [audio.buffer]()
* [ ] [audio.channels]()
* [ ] [audio.duration]()
* [ ] [audio.length]()
* [ ] [audio.sampleRate]()

**3. [Utilities](#utilities)**

* [x] [Audio.equal(a, b, ...c)]()
* [x] [Audio.gain(db)]()
* [x] [Audio.db(gain)]()
* [x] [audio.time(offset)]()
* [x] [audio.offset(time)]()
* [ ] [audio.convert(format)]
* [ ] [audio.save(filename, opts?)]()
* [ ] [audio.stream(dst, opts?, onend?)]()
* [ ] [audio.clone()]

**4. [Manipulations](#manipulations)**

* [x] [audio.read(t?, dur?, dst|opts?)]()
* [ ] [audio.write(data|val|fn, t?, dur?, opts?)]()
* [ ] [audio.insert(data|val|fn, t?, dur?, opts?)]()
* [ ] [audio.slice(t?, dur?, opts?)]()
* [ ] [audio.remove(t?, dur?, opts?)]()
* [ ] [audio.pad(dur, opts?)]()
* [ ] [audio.shift(amt, t?, opts?)]()
* [ ] [audio.trim(opts?)]()
* [ ] [audio.repeat(times, t?, dur?, opts?)]()
* [ ] [audio.reverse(t?, dur?, opts?)]()
* [ ] [audio.invert(t?, dur?, opts?)]()
* [ ] [audio.gain(db, t?, dur?, opts?)]()
* [ ] [audio.fade(t?, dur, opts?)]()
* [ ] [audio.normalize(t?, dur?, opts?)]()
* [ ] [audio.pan(amt, t?, dur?, opts?)]()
* [ ] [audio.mix(audio, t?, dur?, opts?)]()
* [ ] [audio.scale(amt, t?, opts?)]()
* [ ] [audio.through(fn, t?, dur?, opts?)]()

**5. [Metrics](#metrics)**

* [ ] [audio.statistics(t?, dur?, opts?)]()
* [ ] [audio.bounds(t?, dur?, opts?)]()
* [ ] [audio.spectrum(t?, dur, opts?)]()
* [ ] [audio.cepstrum(t?, dur)]()
* [ ] [audio.loudness(t?, dur)]()
* [ ] [audio.memory(t?, dur, opts?)]()

**6. [Playback](#playback)**

* [ ] [audio.play(t?, dur?, opts?)]()
* [ ] [audio.pause()]()
* [ ] [audio.muted]()
* [ ] [audio.loop]()
* [ ] [audio.rate]()
* [ ] [audio.volume]()
* [ ] [audio.paused]() <kbd>readonly</kbd>
* [ ] [audio.currentTime]()




<!-- TODO: remove unnecessary tables from readme to allow for easier read flow -->


## Creation

### let audio = new Audio(source?, format|options?)

Create `audio` instance from `source` with optional `format` string or `options`.

```js
// Create blank audio
let blankAudio = new Audio()

// Create one second of silence
let silentAudio = new Audio(1, {channels: 2})

// Create from AudioBuffer
let bufAudio = new Audio(audioCtx.createBuffer(2, 22050, 44100))

// Create from raw planar data
let rawAudio = new Audio(new Float32Array([0,1,.2,.3,...]), 'stereo planar')

// Create from channels data
let chAudio = new Audio([[0,0,0], [.1,.1,.1], [.2,.2,.2]])

// Create from object
let optAudio = new Audio({
  channels: 3,
  length: 2000
})

// Create from data-uri string
let dataUriAudio = Audio('data:application/octet-stream;base64,AP8A/w==', 'uint8')

// Create from Buffer
let buf2Audio = Audio(Buffer.from([0, 255, 0, 127]), 'interleaved')

// Create from ndarray
let ndAudio = Audio(ndarray, {sampleRate: 48000})
```

#### `source`

Type | Meaning
---|---
_Number_ | Create silence of the indicated duration in seconds.
_AudioBuffer_ | Create from [AudioBuffer](https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer)).
_AudioBufferList_ | Create from [audio-buffer-list](https://github.com/audiojs/audio-buffer-list).
_Audio_ | Create from other audio instance by copying its data
_Object_ | Create from options object with `duration`/`length`, `channels` and `sampleRate` properties. `length` defines number of samples, `duration` defines time.
_Array_ of _Arrays_ | Create from channels data with `[[l, l, l...], [r, r, r...]]` layout.
_Array_ of _Numbers_ | Create from raw samples data, interpreted by `format`.
_Float32Array_, _Float64Array_ | Create from raw samples data with `±1` amplitude range.
_TypedArray_, _ArrayBuffer_, _Buffer_ | Create from PCM data, interpreted by `format` argument (see [pcm-convert](https://github.com/audiojs/pcm-convert)) for available audio data formats.
`base64`/`dataURI` string | [Base64](https://developer.mozilla.org/en/docs/Web/API/WindowBase64/Base64_encoding_and_decoding)-encoded or [DataURI](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URIs) string.
`ndarray` | Create from [ndarray](https://npmjs.org/package/ndarray) instance. The `shape` property is considered as `[length, channels]`.
`ndsamples` | Create from [ndsamples](https://npmjs.org/package/ndsamples) instance, similar to ndarray.
_none_ | Create 0-duration blank audio.

#### `format` or `options`

Can be an object or string, specifying `source` data format.

Example string: `'interleaved le stereo 44100'`, `'3-channel 96000'` etc. See [audio-format](https://github.com/audiojs/audio-format) package for the full list of available format strings.

Options may provide the following properties, extending format:

Property | Default | Description
---|---|---
`channels`, `numberOfChannels` | `source` channels or `1` | _Number_ or _Array_, indicating source channels count or channels layout.
`sampleRate`, `rate` | `source` or `context` sample rate. | Source sample rate.
`interleaved` | Auto | If `source` data has interleaved or planar layout.
`context` | [`audio-context`](https://github.com/audiojs/audio-context) | Web audio context instance, optional. In case if _Audio_ is used with [web-audio-api](https://github.com/audiojs/web-audio-api) or other modules.
<!-- `stats` | Track statistics. Increases memory consumption 3 times, but allows for fetching metrics data `O(C)`, useful for rendering purposes. | `false` -->

#### Related APIs

* [audio-buffer](https://github.com/audiojs/audio-buffer)
* [audio-buffer-list](https://github.com/audiojs/audio-buffer-list)
* [audio-buffer-from](https://github.com/audiojs/audio-buffer-from)


### Audio.from(...sources, format|options?)

Alias: `Audio.join`, `Audio.concat`, `Audio.create`

Create audio by joining multiple sources. Every `source` can be an array of sources as well. `options` may specify common options for the set of sources.

```js
// Create from multiple sources with 1s of silence at the beginning/end
let joinedAudio = Audio.from(1, audio1, audio2, audio3, 1)
```


### Audio.load(source, (error, audio) => {}?)

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
  let joined = Audio.from(...items)
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

* [audio-load](https://github.com/audiojs/audio-load) − load data from URL
* [audio-loader](https://github.com/audiojs/audio-loader) − load data from audio APIs



### Audio.decode(source, (error, audio) => {}?)

Decode audio data from `source` container. `wav` and `mp3` formats are supported out of the box, to enable other formats, include proper codec from [audiocogs](https://github.com/audiocogs), such as [flac.js](https://github.com/audiocogs/flac.js), [opus.js](https://github.com/audiocogs/opus.js) and others.

```js
// Decode binary data, callback style
Audio.decode(require('audio-lena/mp3'), (err, audio) => {})


// Decode flac data-uri string, promise style
require('flac.js')
Audio.decode(require('audio-lena/flac-datauri')).then(audio => {}, err => {})

// Decode multiple sources, create single audio with joined sources
Audio.decode([a, b, c], (err, [a, b, c]) => {
	let audio = Audio.from(a, b, c)
})
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



### Audio.record(source, duration|options?, (error, audio)=>{}?)

Create audio instance by recording stream-ish source. If callback provided, it will be called when the source is  Promise recieves `progress` clause.

```js
// record mic input
navigator.getUserMedia({audio: true, video: false}, stream => {
	Audio.record(stream, 5).then(audio => {
		//`audio` contains 5 seconds of recorded mic input
	})
})


// record HTML audio
let audioEl = document.createElement('audio')
audioEl.src = 'https://remote.url/audio.mp3'
Audio.record(audioEl, (err, audio) => {
	//`audio` here is ready
})


// record web-audio
let ctx = new AudioContext()
let oscillator = ctx.createOscillator()
oscillator.type = 'square'
oscillator.frequency.value = 440
oscillator.start()
Audio.record(oscillator, (err, audio) => {
	//this callback is invoked once oscillator is stopped
})
setTimeout(() => {
	oscillator.stop()
}, 2000)


// record node-stream with pcm data
// FIXME: get real case of node stream source
let stream = require('mic-input')
Audio.record(stream, (err, audio) => {
	//callback is invoked once stream is ended
})


// record pull-stream
// FIXME: get real case of pull stream source
let source = require('pull--source')
Audio.record(source).then(audio => {

})


// record multiple sources
Audio.record([a, b, c], (err, audio) => {
	//callback is invoked once all three of sources are recorded
})
```

#### Source

Type | Meaning
---|---
_Stream_ |
_pull-stream_ |
_Function_ |
_MediaStream_ |
_WebAudioNode_ |
_HTMLAudioElement_, _HTMLMediaElement_ |
_Array_ with sources |

#### Options

Property | Meaning
---|---
`duration`, `from`, `to` | Recording interval in seconds
`length`, `start`, `end | Recording interval in samples
`channel`, `channels` | Channels to record
``

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

Alias: `audio.channel`, `audio.numberOfChannels`

Number of channels. Changing this property will up-mix or down-mix channels, see interpretation table in [audio-buffer-remix](https://github.com/audiojs/audio-buffer-remix).

### audio.sampleRate

Alias: `audio.rate`

Buffer sample rate. Changing this property will resample audio to target rate. (WIP)

### audio.duration

Buffer duration. Changing this property will trim or pad the data.

### audio.length

Get total length of audio in samples.

---

## Utilities

### Audio.equal(a, b, ..., options)

Alias: `Audio.isEqual`, `Audio.equals`

Test if audio instances have same content. Comparison can be done by frequencies or samples with defined precision.

### Audio.db(level), Audio.gain(db)

Convert gain to decibels or backwards, see [decibels](https://github.com/audiojs/decibels).

### audio.save(fileName, done?)

Alias: `audio.saveAs`, `audio.download`

Download as a wav file in browser, write audio to file in node. In node file is going to be saved to the same directory as the caller's one. To redefine directory, use absolute path as `audio.save(__dirname + '/my-audio.wav')`. See [save-file](https://github.com/dfcreative/save-file) for details.

```js
// save as wav file
audio.save('my-audio.wav', (err, audio) => {
    if (err) throw err;
})
```

If you need custom output format, like _ogg_, _mp3_ or other, please use [audio-encode](https://github.com/audiojs/audio-encode).

```js
// save as ogg file
const encode = require('audio-encode/ogg')
const save = require('save-file')
encode(audio.buffer, (err, buf) => {
    save(buf, 'my-audio.ogg')
})
```

### audio.stream()

### audio.time()

### audio.offset()


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

### audio.limits(time=0, duration?, {channel|channels}?)

Find amplitudes boundaries (range) for the indicated time interval. Returns an array with `min, max` values. Accounts for all channels, unless specified.

```js
// get min/max amplitude for the .5s interval starting from 1s
let [min, max] = audio.limits(1, .5)

// get min/max amplitude in left channel
let [lMin, lMax] = audio.limits({channel: 0})
```

### audio.spectrum(time=0, options?)

Get array with spectral component magnitudes (magnitude is length of a [phasor](wiki) — real and imaginary parts). [fourier-transform](https://www.npmjs.com/package/fourier-transform) is used internally.

Possible `options`:

name | default | meaning
---|---|---
_size_ | `1024` | Size of FFT transform, e. g. number of frequencies to capture.
_channel_ | `0` | Channel number to get data for, `0` is left channel, `1` is right etc.
_db_ | `false` | Convert resulting magnitudes from `0..1` range to decibels `-100..0`.

### audio.loudness(time=0, duration?, options|method?)

Get loudness estimation for the interval indicated by `time` and `duration`. Returns an array with per-channel loudness values.

```js
// calculate RMS for 2 channels for the 120ms duration, starting from 1s
let [leftRms, rightRms] = audio.loudness(1, .12)
```

#### Options

Property | Default | Meaning
---|---|---
`method` | `'rms'` | Method of calculating loudness estimation. `'rms'` (root mean square) is used by default as fastest. Available methods: `TODO`
`channel`, `channels` | `null` | Target channels to calculate loudness for

#### Related API

* [audio-loudness](https://github.com/audiojs/audio-loudness) − loudness estimation algorithms.


### audio.cepstrum(time, duration)
### audio.statistics(time, duration)

Alias: `audio.stats`

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

### audio.read(time=0, duration?, {channel[s], format, destination}?)

Alias: `audio.get`

Read audio data from the indicated range, put result into `destination`. If destination is not defined, an array or object will be created based on `format`. By default returns an array with channels data.

```js
// get channels data for the 5s subrange starting from the 1s
let [leftChannel, rightChannel] = audio.read(1, 5)

// get audiobuffer with whole audio data
let abuf = audio.read({format: 'audiobuffer'})

// get 1s of SR and SL channels data, starting from 0.5s
let [slChannel, srChannel] = audio.read(.5, 1, {channels: [2,3]})

// get last 1000 samples of right channel data
let rightChannelData = audio.read(new Float32Array(1000), Audio.time(-1000), {channel: 1})

// read 10 samples of left channel as uint8 numbers, put into destination container
let uintArr = a.read(0, a.time(10), {dest: new Uint8Array(10), channel: 0})
```

#### Options

Property | Description | Default
---|---|---
`channel`, `channels` | Channel number or array with channel numbers to read data from. | all channels
`format` or `dtype` | Returned data type. | `destination` type
`destination`, `dest`, `dst` | Data container to put data. | `null`


### audio.write(data|value|fn, time=0, duration?, {channel|channels, format}?)

Alias: `audio.set`, `audio.fill`

Write `data` to audio, starting at the indicated `time`, sliced by the `duration`. Optionally indicate `format` of data source or `channels` to write data to.

```js
// write data to left and right channels
audio.write([new Float32Array(100), new Float32Array(100)])

// write L and R buffer channels to SL and SR channels starting from 0.5s of the duration .25s
audio.write(audioCtx.createBuffer(2, 22050, 44100), .5, .25, {channels: [2,3]})

// write 100 samples to the right channel starting from 1000 sample
audio.write(new Float32Array(100).fill(0), audio.time(1000), {channel: 1})

// fill 1s of audio starting from .5s with constant value .25
audio.write(.25, .5, 1)

// create 1000 samples filled with constant value 1
let constAudio = Audio({length: 1000}).write(1)

// create 1000 samples filled with sine wave
let sinAudio = Audio({length: 1000, channels: 2}).write((v, i, c, a) => {
  return Math.sin(Math.PI * 2 * 440 * i / a.sampleRate)
})

// reset left channel to zero value
sinAudio.write(0, {channels: [0]})
```

#### Data type

Type | Meaning
---|---
`Number` | Constant value to fill interval with.
`Function` | Function, returning number. Takes value `v`, sample index `i` and channel number `ch` arguments.
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
`format` or `dtype` | Source data format, if necessary, like `'uint8 stereo interleaved'`.

#### Related API

* [audio-format](https://github.com/audiojs/audio-format)
* [audio-buffer-from](https://github.com/audiojs/audio-buffer-from)


### audio.insert(data, time=0, {start, channels}?)

Alias: `audio.push`, `audio.concat`, `audio.add`, `audio.append`

Insert data at the indicated `time`. If `time` is omitted, the `data` will be appended to the beginning of audio. `data` should be [_AudioBuffer_](https://github.com/audiojs/audio-buffer), [_AudioBufferList_](https://github.com/audiojs/audio-buffer-list), _Audio_, _FloatArray_ or list of _FloatArrays_. `data` and `time` can be swapped places for compatibility.

```js
// append data to the end
audio.insert([new Float32Array(100), new Float32Array(100)], -0)

// prepend L and R buffer channels to SL and SR channels
audio.insert(audioCtx.createBuffer(2, 22050, 44100), {channels: [2,3]})

// insert async data
Audio('./src.mp3').then(audio =>
    Audio('./src2.mp3').then(audio2 => audio.insert(audio2))
).then(audio => {
	//...audio here contains both src and src2
})
```

### audio.remove(time=0, duration?, {}?)

Alias: `audio.delete`, `audio.cut`, `audio.consume`

Remove fragment of the indicated `duration` starting from the indicated `time`. If time is undefined, the fragment will be removed from the beginning of audio. Alternatively, indicate fragment by `start` and `end` properties. Returns audio with the removed fragment.

```js
// remove 1s starting from 0.5s
let fragment = audio.remove(.5, 1)
```

### audio.slice(time=0, duration=audio.duration, {channels, copy}?)

Alias: `audio.copy`

Get fragment of audio containing the indicated part. By default it returns subdata, unless `{copy: true}` is indicated by options.

```js
// get shallow copy of audio
let dup = audio.slice()

// get 0.5s...1.5s fragment with only stereo channels
let frag1 = audio.slice(.5, 1, {channels: [0,1]})

// clone 100 samples of audio contents
let frag2 = audio.slice({start: 100, end: 200, clone: true})
```

### audio.repeat(times)

Repeat existing contents of audio indicated number of times.

```js
// empty audio
zero = audio.repeat(0)

// no operation
audio = audio.repeat(1)

// repeat two times
twiceAudio = audio.repeat(2)
```

### audio.trim({threshold:-40, left|right, level}?)

Trim silence at the beginning/end. Optionally define `threshold` in decibels, `left` and `right` trim restrictions. `level` can be used to define threshold as absolute value `0..1`.

```js
// trim silence from ends
Audio([0,0,0,.1,.2,-.1,-.2,0,0], 1).trim()
// <.1, .2, -.1, -.2>

// trim samples from the beginning below -30 db
Audio([0.0001, 0, .1, .2, ...], 1).trim({threshold: -30, left: true})
// <.1, .2, ...>

// remove samples below .02 from the end
Audio([.1, .2, -.1, -.2, 0, .0001]).trim({level: .02, left: false})
// <.1, .2, -.1, -.2>
```

### audio.pad(duration, value=0|{value, left, right}?)

Make sure the duration of the audio is at least the indicated `duration`. Pass `{left: true}` or `{right: true}` depending on what direction you need to pad. Pass `value` to fill, defaults to `0`.

```js
// pad right, same as audio.duration = 10
audio.pad(10)

// pad left with value 1
audio.pad(10, {left: true, value: 1})

// pad right with .1 constant value
audio.pad(10, .1)
```

### audio.fade(time=0, duration=0.4, {gain:-40db, easing, start, end,channels}?)`

Fade in or fade out volume for the `duration` starting from `time`. Duration can be negative, in that case it will fade backwards, i.e. fade out. Options may supply `easing` function or specific `gain`.

Default `easing` is linear, but any of the [eases](https://npmjs.org/package/eases) functions can be used. `easing` function has signature `v = ease(t)`, where `t` and `v` are from `0..1` range.

Fading is done by decibels to compensate logarithmic volume perception.

```js
const eases = require('eases')

Audio.load('./source.ogg', audio => {
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

Normalize indicated interval or full audio, i.e. bring amplitudes to -1..+1 range. Max amplitude is found within all defined `channels`.

```js
// normalize full contents
let audio = Audio(new Float32Array([0,.1,0,-.1]), {channels: 1}).normalize()
audio.get({channels: 0}) //[0, 1, 0, -1]

// normalize 0 and 1 channels
audio = Audio(new Float32Array([0,.1,  0,.2,  0,.3]), {channels: 3}).normalize({channel: [0, 1]})
audio.get() //[[0, .5], [0, 1], [0, .3]]
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
// make half as loud
let audio = new Audio(Array(44100).fill(1), 1).gain(-20)
```

### audio.reverse(time=0, duration?, {start, end, channels}?)

Negate samples for the indicated part.

```js
Audio('./sample.mp3', audio => {
    //reverse first three seconds of audio and play
    audio.reverse(0, 3).play()
})
```

### audio.shift(time=0, {rotate: false})

Shift contents of audio to the left or right.

```js
```


### audio.pan(balance=.5, {gain: -5})

Apply stereo panning with audio compensation.

```js
```


### audio.mix(otherAudio, time=0, duration?, {channels}?)

Lay second audio over the first one at the indicated interval.

```js
```


### audio.scale(amount, time=0, duration?, options)

Stretch or shrink audio for the fragment.

```js
```


### audio.through(buf => buf, time=0, duration?, {channels, block}?)`

Alias: `audio.process`

Process audio or part of it with a function.

```js
// generate 2s of gray noise in stereo
let filter = require('audio-loudness')()
let noise = require('audio-noise/white')()
let grayNoise = Audio(2, 'stereo').through(noise).through(filter)

// create oscillator with LPF
let biquad = require('audio-biquad')({type: 'lpf', frequency: 880})
let saw = require('audio-oscillator')({type: 'saw', frequency: 440})
let dimmedSaw = Audio(2).through(saw).through(biquad)
```

#### Options

Property | Default | Meaning
--|---|---
`frame`, `block` | `false` | Enforce processing block size, ie. `1024` samples per block.
`channel`, `channels` | `all` | Affect only indicated channels, can be a number or array.

---
