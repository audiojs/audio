# Audio — Work In Progress

[![Build Status](https://img.shields.io/travis/audiojs/audio.svg)](https://travis-ci.org/audiojs/audio)
[![Code Climate](https://codeclimate.com/github/audiojs/audio/badges/gpa.svg)](https://codeclimate.com/github/audiojs/audio)
[![Greenkeeper badge](https://badges.greenkeeper.io/audiojs/audio.svg)](https://greenkeeper.io/)
[![Downloads](https://img.shields.io/npm/dm/audio.svg)](https://npmjs.org/package/audio)
[![experimental](https://img.shields.io/badge/stability-experimental-red.svg)](http://github.com/badges/stability-badges)
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

## Table of Content

* [Usage](#usage)
* [API](#api)
* [See Also](#see-also)
* [Credits](#credits)


## Usage

[![npm install audio](https://nodei.co/npm/audio.png?mini=true)](https://npmjs.org/package/audio/)

Load `./sample.mp3`, trim, normalize, fade in, fade out, save:

```js
const Audio = require('audio')

Audio('./sample.mp3').on('load', audio =>
    audio.trim().normalize().fade(.5).fade(-.5).save('sample-edited.wav')
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

### `3. Record and download 2 seconds of web-audio experiment`

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

* [**Creation**](#creation)
	* [new Audio()]()
* [**Properties**](#properties)
	* [audio.buffer]()
	* [audio.channels]()
	* [audio.duration]()
	* [audio.length]()
	* [audio.sampleRate]()
* [**Playback**](#playback)
	* [audio.play()]()
	* [audio.pause()]()
	* [audio.muted]()
	* [audio.loop]()
	* [audio.rate]()
	* [audio.volume]()
	* [audio.paused]()
	* [audio.currentTime]()
* [**Manipulations**](#manipulations)
	* [audio.get()]()
	* [audio.set()]()
	* [audio.append()]()
	* [audio.insert()]()
	* [audio.remove()]()
	* [audio.slice()]()
	* [audio.repeat()]()
	* [audio.trim()]()
	* [audio.pad()]()
	* [audio.gain()]()
	* [audio.fade()]()
	* [audio.normalize()]()
	* [audio.removeDC()]()
	* [audio.threshold()]()
	* [audio.reverse()]()
	* [audio.invert()]()
	* [audio.shift()]()
	* [audio.pan()]()
	* [audio.mix()]()
	* [audio.scale()]()
	* [audio.silence()]()
	* [audio.noise()]()
	* [audio.constant()]()
	* [audio.process()]()
* [**Metrics**](#metrics)
	* [audio.spectrum()]()
	* [audio.loudness(time, duration)]()
	* [audio.cepstrum(time, duration)]()
	* [audio.average(time, duration)]()
	* [audio.variance(time, duration)]()
	* [audio.size(time, duration)]()
* [**Utilities**](#utilities)
	* [audio.on()](), [audio.once()](), [audio.off()]()
	* [audio.then()]()
	* [Audio.isAudio()]()
	* [Audio.fromDb()](), [Audio.toDb()]()
	* [audio.save()]()


## Creation

### `new Audio(source, options?, (error, audio)=>{}?)`

Create _Audio_ instance from **source** with provided **options**.

Types of **source**:

* **Sync** − creates audio instantly. One of [_AudioBuffer_](https://github.com/audiojs/audio-buffer), [_AudioBufferList_](https://github.com/audiojs/audio-buffer-list), _Number_ indicating duration, _FloatArray_ with raw channels data or Array with any of mentioned.
* **Async** − invokes callback once source is loaded. Can be URL/path string or encoded binary data in _ArrayBuffer_, _Buffer_, _Blob_ or [_File_](https://developer.mozilla.org/en/docs/Web/API/File). [audio-loader](https://github.com/audiojs/audio-loader) and [audio-decode](https://github.com/audiojs/audio-decode) are used internally.

<!--
* **Stream** − [_Stream_](https://nodejs.org/api/stream.html), [_pull-stream_](https://github.com/pull-stream/pull-stream), _Function_, [_MediaStream_](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream)_WebAudioNode_ or _Array_ with sequence of any sources. Starts recording, updating contents until input stream ends or max duration reaches. `data` and `end` events are emitted during stream consumption. Returned thenable takes arguments `.then(success, error, progress)`. Plays role of [audiorecorder](https://npmjs.org/package/audiorecorder).
-->
<!--
| _HTMLAudioElement_, _HTMLMediaElement_ | Wrap [`<audio>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio) or [`<video>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video) element, capture it's contents. Puts audio into recording state. | stream |
-->

Options:

* **channels** − if number, the source will be remixed into that number of channels. If list, the corresponding source channels will be used. See [audio-buffer-remix](https://github.com/audiojs/audio-buffer-remix).
* **context** − web audio context. If not provided, the [audio-context](https://github.com/audiojs/audio-context) will be used.
* **cache** − cache async sources to avoid extra requests. By default `true`.

<!--
* **stats** − track stats for metrics. Increases memory consumption up to 3 times (yet O(N)). By default disabled.
* -->

```js
//create 2-channel digital copy of the masterpiece 4:33
let blankAudio = new Audio(4*60 + 33, 2)

//create from AudioBuffer
let bufAudio = new Audio(audioCtx.createBuffer(2, 22050, 44100))

//create from raw data
let rawAudio = new Audio(new Float32Array([0,1,.2,.3,...]), {channels: 2})

//create from multiple sources
let joinedAudio = new Audio([blankAudio, rawAudio, bufAudio], {channels: 2})

//decode binary data, callback style
new Audio(require('audio-lena/wav'), (err, wavAudio) => {
    if (err) throw err;
})

//load remote file, promise style
new Audio('http://techslides.com/demos/samples/sample.flac').then(success, error, progress)

//load and decode local file, emitter style
Audio('./test/chopin.mp3')
	.on('error', err => {})
	.on('progress', err => {})
	.on('load', streamAudio => {})
```

## Properties

### `audio.buffer`

[_AudioBufferList_](https://github.com/audiojs/audio-buffer-list) with audio data. Readable, writable.

### `audio.channels`

Number of channels. Changing this property will up-mix or down-mix channels, see interpretation table in [audio-buffer-remix](https://github.com/audiojs/audio-buffer-remix).

### `audio.sampleRate`

Buffer sample rate. Changing this property will resample audio to target rate. (WIP)

### `audio.duration`

Buffer duration. Changing this property will trim or pad the data.

### `audio.length`

Get total length of audio in samples.


## Playback

### `audio.play(time=0, duration?, {rate, loop, volume}?, onended?)`

Start playback from the indicated `start` time offset, invoke callback on end.

### `audio.pause()`

Pause current playback. Calling `audio.play()` once again will continue from the point of pause.

### `audio.muted`

Mute playback not pausing it.

### `audio.loop`

Repeat playback when the end is reached.

### `audio.rate`

Playback rate, by default `1`.

### `audio.volume`

Playback volume, defaults to `1`.

### `audio.paused``

If playback is paused.

### `audio.currentTime`

Current playback time in seconds. Setting this value seeks the audio to the new time.


## Manipulations

### `audio.get(time=0, duration?, {start, end, channels}?)`

Get audio data as a list of float arrays for indicated range. Range can be defined whether as `time` and `duration` or `start` and `end` offsets. To get single channel data, `channels` can be defined as a number.

```js
//get channels data
let [leftChannel, rightChannel] = audio.get()

//get 1s of SR and SL channels data, starting from 0.5s
let [slChannel, srChannel] = audio.get(.5, 1, {channels: [2,3]})

//get last 1000 samples of right channel data
let rightChannelData = audio.get({channels: 1, start: -1000, end: 0})
```

### `audio.set(data, time=0, {start, channels}?)`

Write data to audio starting at the indicated time. `data` is one of [_AudioBuffer_](https://github.com/audiojs/audio-buffer), [_AudioBufferList_](https://github.com/audiojs/audio-buffer-list), _Audio_, _FloatArray_ or list of _FloatArrays_. `data` and `time` can swap places for compatibility.

```js
//write data to left and right channels
audio.set([new Float32Array(100), new Float32Array(100)])

//write L and R buffer channels to SL and SR channels starting from 0.5s
audio.set(audioCtx.createBuffer(2, 22050, 44100), .5, {channels: [2,3]})

//write 100 samples to right channel starting from 1000 sample
audio.set(new Float32Array(100).fill(0), {start: 1000, channels: 1})
```

### `audio.append(data1, data2, ..., {channels}?)`

Append data to the end of audio. `data` should be [_AudioBuffer_](https://github.com/audiojs/audio-buffer), [_AudioBufferList_](https://github.com/audiojs/audio-buffer-list), _Audio_, _FloatArray_ or list of _FloatArrays_.

```js
//write data to left and right channels
audio.append([new Float32Array(100), new Float32Array(100)], audioCtx.createBuffer(2, 22050, 44100), audio2)
```

### `audio.insert(data, time=0, {start, channels}?)`

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

### `audio.remove(time=0, duration?, {start, end})`

Remove fragment of the indicated `duration` starting from the indicated `time`. If time is undefined, the fragment will be removed from the beginning of audio. Alternatively, indicate fragment by `start` and `end` properties. Returns audio with the removed fragment.

```js
//remove 1s starting from 0.5s
let fragment = audio.remove(.5, 1)
```

### `audio.slice(time=0, duration=total, {start, end, channels, clone})`

Get fragment of audio containing the indicated part. By default it returns sub-audio, unless `{clone: true}` is indicated by options.

```js
//get shallow copy of audio
let dup = audio.slice()

//get 0.5s...1.5s fragment with only stereo channels
let frag1 = audio.slice(.5, 1, {channels: [0,1]})

//clone 100 samples of audio contents
let frag2 = audio.slice({start: 100, end: 200, clone: true})
```

### `audio.repeat(times)`

Repeat existing contents of audio indicated number of times.

```js
//empty audio
zero = audio.repeat(0)

//no operation
audio = audio.repeat(1)

//repeat two times
twiceAudio = audio.repeat(2)
```

### `audio.trim({threshold:-40, left?, right?, level?}?)`

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

### `audio.pad(duration, {value:0, left, right}?)`

Make sure the duration of the audio is at least the indicated `duration`. Pass `{left: true}` or `{right: true}` depending on what direction you need to pad.

```js
//pad right, same as audio.duration = 10
audio.pad(10)

//pad left with value 1
audio.pad(10, {left: true, value: 1})
```

### `audio.fade(time=0, duration=0.4, {gain:-40db, easing, start, end, channels}?)`

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

### `audio.normalize(time=0, duration?, {start, end, channels}?)`

Normalize indicated interval or full audio, i.e. bring amplitudes to -1..+1 range. Max amplitude is found within all defined `channels`, if supplied.

```js
//normalize full contents
let audio = Audio(new Float32Array([0,.1,0,-.1]), {channels: 1}).normalize()
audio.get({channels: 0}) // [0, 1, 0, -1]

//normalize 0 and 1 channels
audio = Audio(new Float32Array([0,.1,  0,.2,  0,.3]), {channels: 3}).normalize({channel: [0, 1]})
audio.get() // [[0, .5], [0, 1], [0, .3]]
```

### `audio.gain(volume, time=0, duration?, {start, end, channels}?)`

Change volume of the interval of `duration` starting at `time`. `volume` is in decibels.

```js
//make half as loud
let audio = new Audio(Array(44100).fill(1), 1).gain(-20)
```

### `audio.reverse(time=0, duration?, {start, end, channels}?)`

Change the direction of samples for the indicated part.

```js
Audio('./sample.mp3', audio => {
    //reverse first three seconds of audio and play
    audio.reverse(0, 3).play()
})
```

### `audio.invert(time=0, duration?, {start, end, channels}?)`

Invert phase for the indicated range.

```js
//invert 1s following after the second second of audio
Audio(sample).invert(2, 1)
```


### `audio.shift(time=0, {rotate: false})`

Shift contents of audio to the left or right.

### `audio.pan(balance=.5, {gain: -5})`

Apply stereo panning with audio compensation.

```js
```

### `audio.removeDC()`

Remove DC offset, if any.

### `audio.threshold(level, time=0, duration?, {minPause, channels}?);`

Cancel values less than indicated threshold.

### `audio.mix(otherAudio, time=0, duration?, {channels}?)`

Lay second audio over the first one at the indicated interval.

### `audio.scale(amount, time=0, duration?)`

Change playback rate, pitch will be shifted.

### `audio.silence(time=0, duration?)`

Fill indicated fragment with 0.

### `audio.noise(time=0, duration?, {type:'white'})`

Fill indicated fragment with type of noise. Available noises:

* **white**
* **brown**
* **red**
* **blue**

### `audio.process((buf, cb) => cb(buf), time=0, duration?, {channels, frame}?, onready?)`

Process audio or part with _sync_ or _async_ function, see any [audiojs/audio-* modules](https://github.com/audiojs).

* _sync_ function has signature `(audioBuffer) => audioBuffer`.
* _async_ function has signature `(audioBuffer, cb) => cb(err, audioBuffer)`.

Options may define `{frame: frameSize}` to process chunks evenly.


## Metrics

### `audio.spectrum(time=0, options?)`

Get array with spectral component magnitudes (magnitude is length of a [phasor](wiki) — real and imaginary parts). [fourier-transform](https://www.npmjs.com/package/fourier-transform) is used internally.

Possible `options`:

| name | default | meaning |
|---|---|---|
| _size_ | `1024` | Size of FFT transform, e. g. number of frequencies to capture. |
| _channel_ | `0` | Channel number to get data for, `0` is left channel, `1` is right etc. |
| _db_ | `false` | Convert resulting magnitudes from `0..1` range to decibels `-100..0`. |

### `audio.loudness(time, duration)`
### `audio.cepstrum(time, duration)`
### `audio.average(time, duration)`
### `audio.variance(time, duration)`
### `audio.size(time, duration)`
<!--
Ideas:

* chord/scale detection
* tonic, or main frequency for the range — returns scientific notation `audio.pitch(time=0, (err, note) => {})`
* tempo for the range `audio.tempo(time=0, (err, bpm) => {})`
-->

## Utilities

### `audio.then(success, fail, progress)`

Promise to invoke method once source is loaded.

### `audio.on(evt, cb)`, `audio.once(evt, cb)`, `audio.off(evt, cb)`

EventEmitter interface.

### `Audio.isAudio(src)`

Check if `src` is instance of _Audio_.

### `audio.fromDb(db)`, `audio.toDb(gain)`

Convert gain to decibels or backwards, see [decibels](https://github.com/audiojs/decibels).

### `audio.save(fileName, done?)`

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
