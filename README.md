# Audio [![Build Status](https://img.shields.io/travis/audiojs/audio.svg?style=flat-square)](https://travis-ci.org/audiojs/audio) [![NPM Version](https://img.shields.io/npm/v/audio.svg?style=flat-square)](https://www.npmjs.org/package/audio) [![unstable](http://badges.github.io/stability-badges/dist/unstable.svg)](http://github.com/badges/stability-badges)

Class for high-level audio manipulations in javascript − nodejs and browsers.

<!--
	ideas:
	  - docs
	  - playground
	  - downloads
	  - size
	  - image (just teaser/logo)
-->

## Usage

[![npm install audio](https://nodei.co/npm/audio.png?mini=true)](https://npmjs.org/package/audio/)

Load audio from file, trim, normalize, fade in, fade out, save.

```js
const Audio = require('audio')

Audio('./sample.mp3').on('load', (audio) => {
	audio.trim().normalize().fade(.3).fade(-1).save('sample-edited.wav');
})
```

<!--
	ideas:
	  - image
		file → waveform → processed waveform → file
	  - try yourself - requirebin demo with file opener and processing
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
-->

# API

## Creation

### `let audio = new Audio(source, channels=2 | options?, onload?)`

Create _Audio_ instance from the `source` based on `options` (or number of `channels`), invoke `onload` when ready.

`source` can be _sync_, _async_ or _stream_:

* _Sync_ source − sets contents immediately and returns ready to use audio instance. Can be [_AudioBuffer_](https://github.com/audiojs/audio-buffer), _Number_ indicating duration or _Array_/_FloatArray_ with raw channels data.
* _Async_ source − loads and decodes content and emits `load` event when ready. Can be a string or _ArrayBuffer_/_Buffer_/_Blob_/[_File_](https://developer.mozilla.org/en/docs/Web/API/File) with encoded mp3/wav/ogg/etc data. `audio.isReady` indicator can be used to check status. For the time of loading audio contains 1-sample buffer with silence. [audio-loader](https://github.com/audiojs/audio-loader) and [audio-decode](https://github.com/audiojs/audio-decode) are used internally.
* [WIP] _Stream_ source − starts recording, updating contents until input stream ends or max duration reaches. `data` and `end` events are emitted during stream consumption. Can be [_Stream_](https://nodejs.org/api/stream.html), [_pull-stream_](https://github.com/pull-stream/pull-stream), _Function_, [_MediaStream_](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream) or _WebAudioNode_. Takes role of [audiorecorder](https://npmjs.org/package/audiorecorder).

<!--
| _HTMLAudioElement_, _HTMLMediaElement_ | Wrap [`<audio>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio) or [`<video>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video) element, capture it's contents. Puts audio into recording state. | stream |
-->

`options` may include:

* `channels` − number of channels, inferred from source or defaults to `2`.
* `context` − web audio context (optional), defaults to [audio-context](https://npmjs.org/package/audio-context).
* `duration` − max duration, by default takes whole available input.
* `sampleRate` − inferred from source or defaults to `44100`.
* `range` — db range to use for quietest sound, defaults to 40.
* `cache` − cache URL sources to avoid extra requests. By default `true`.
* `stats` − track stats for metrics. Increases memory consumption up to 3 times (yet O(N)). By default disabled.

```js
//create 2-channel audio of duration 4m 33s
let blankAudio = new Audio(4*60 + 33, 2)

//create from AudioBuffer
let bufAudio = new Audio(new AudioBuffer(2, [.1,.1,...]))

//create from raw data
let arrAudio = new Audio([0,1,.2,.3,...], {channels: 2})

//decode mp3/wav arrayBuffer/buffer
let wavAudio = new Audio(require('audio-lena/mp3'), (err, wavAudio) => {
	// `wavAudio` here is decoded from the mp3 source
})

//create from remote source
let remoteAudio = new Audio('./sample.mp3', (err, remoteAudio) => {
	// `remoteAudio` here is fully loaded and decoded
})

//record stream
let streamAudio = Audio(WAAStream(oscillatorNode)).on('end', (streamAudio) => {

})
```

## Properties

### `audio.buffer`

[AudioBuffer](https://github.com/audiojs/audio-buffer) with raw audio data. Can be modified directly.

### `audio.channels`

Number of channels. Changing this property will up-mix or down-mix channels, see [channel interpretation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Basic_concepts_behind_Web_Audio_API#Up-mixing_and_down-mixing) table.

### `audio.sampleRate`

Buffer sample rate. Changing this property will resample audio to target rate.

### `audio.duration`

Buffer duration. Changing this property may right-trim or right-pad the data.

### `audio.range`

Hearable range in decibels, defaults to `40`.

### `audio.length`

Get total length in samples.

## Manipulations

Most methods have signature `audio.method(param, start=0, duration=audio.duration, options?)`. `start` and `duration` are optional and define interval to affect, in seconds. `options` may provide `channel` property, restricting action to a specific channel or list of channels. Also options may have `from` and `to` properties defining interval in raw sample offsets, as an alternate to `start` and `duration`.

### `audio.append(otherAudio)`

Append new data to the end. `otherAudio` can be [_AudioBuffer_](https://github.com/audiojs/audio-buffer) or other _Audio_ instance.

<!--
### audio.insert, audio.delete, audio.repeat, audio.append, audio.clone

### audio.slice(start, end) - return copy of audio
### audio.sub(start, end) - return subaudio handle
### audio.copy(dest, start, end) - copy to destination

### audio.overlay(otherAudio)
### audio.pan()
### audio.dcOffset()
### audio.removeDcOffset()
-->

### `audio.data(time?, duration?, {channel}?)`

Get channel or channels data for the indicated range. Returned data is a list of arrays or single array with raw samples. Returned data is subarrayed, so modifying it will change actual audio.

```js
//get 1s of raw data starting from 1.5s
let [leftChannel, rightChannel] = audio.data(1.5, 1)

//get complete raw data for the right channel
let rightChannelData = audio.data({channel: 1})
```

<!--
### `audio.read(time=0, duration?)`

Get _AudioBuffer_ of `duration` starting at `time`. If no `duration` provided, all available data will be returned. The result is cloned, if you need the original data, read `audio.buffer` directly.

Also use `audio.readRaw(offset, length)` to read data in sample offsets.

```js
//get last 1s of samples of the left channel
audio.read(-1).getChannelData(0)
```

### `audio.write(audioBuffer, time=0)`

Write _AudioBuffer_ starting at `time`. Old data will be overwritten, to insert data see `splice` method. If `audioBuffer` is longer than the `duration`, audio will be extended to fit the `audioBuffer`. If `time` is not defined, new audio will be written to the end, unless `duration` is explicitly set.

```js
Audio(2).write(AudioBuffer(1, rawData), .5)
```
-->

### `audio.fade(start=0, duration, {gain: -40db, easing, channel}?)`

Fade in or fade out volume starting from `time` of `duration`. Negative duration will fade backwards. Options object may specify `easing` function or specific `gain`.

Default `easing` is linear, but any of [eases](https://npmjs.org/package/eases) functions can be used. `easing` function has signature `v = ease(t)`, where `t` and `v` are from `0..1` range.

Fading is done by decibels to compensate logarithmic volume perception, hearable range can be adjusted by `range` property.

```js
const eases = require('eases')

let audio = Audio('./source').on('load', audio => {
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

### `audio.normalize(time?, duration?, {channel}?)`

Normalize interval or full audio, i.e. bring amplitudes to -1..+1 range. Max amplitude is found within all defined channels, is any.

```js
//normalize full contents
let audio = Audio([0,.1,0,-.1], {channels: 1}).normalize()
audio.data({channel: 0}) // [0, 1, 0, -1]

//normalize 0 and 1 channels
audio = Audio([0,.1,  0,.2,  0,.3], {channels: 3}).normalize({channel: [0, 1]})
audio.data() // [[0, .5], [0, 1], [0, .3]]
```

### `audio.trim({threshold=-40, left?, right?, level?}?)`

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

### `audio.gain(volume, time?, duration?, {channel}?)`

Change volume of the interval of `duration` starting at `time`. `volume` is in decibels.

```js
//make half as loud
let audio = new Audio(Array(44100).fill(1), 1).gain(-20)
```

### `audio.reverse(time?, duration?, {channel}?)`

Change the direction of samples for the indicated part.

```js
Audio('./sample.mp3', audio => {
	//reverse first three seconds of audio and play
	audio.reverse(0, 3).play()
})
```

### `audio.invert(time?, duration?)`

Invert phase for the indicated range.

```js
//invert 1s following after the second second of audio
Audio(sample).invert(2, 1)
```


<!--
### `audio.splice(time?, deleteDuration?, newData?)`

Insert and/or delete new audio data at the start `time`.


### `audio.padStart(duration?, value?)`
### `audio.padEnd(duration?, value?)`

Make sure the duration of the fragment is long enough.


### `audio.threshold(value, time?, duration?);`

Cancel values less than indicated threshold 0.

### `audio.mix(otherAudio, time?, duration?)`

Merge second audio into the first one at the indicated range.

### `audio.scale(amount, time?, duration?)`

Change playback rate, pitch will be shifted.

### `audio.fill(value|(value, n, channel) => value, time?, duration?)`

Apply per-sample processing.

### `audio.silence(time?, duration?)`

Fill with 0.

### `audio.noise(time?, duration?)`

Fill with random.

### `audio.process(fn, time?, duration?, onend?)`

Process audio or part with _sync_ or _async_ function, see any [audiojs/audio-* modules](https://github.com/audiojs).

* _sync_ function has signature `(audioBuffer) => audioBuffer`.
* _async_ function has signature `(audioBuffer, cb) => cb(err, audioBuffer)`.


## Playback

Prelisten methods.

### `audio.play(time?, duration?, callback?)`

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

### `audio.paused` read only

If playback is paused.

### `audio.currentTime`

Current playback time in seconds. Setting this value seeks the audio to the new time.

### `audio.duration` read only

Indicates the length of the audio in seconds, or 0 if no data is available.

### `audio.on('end', audio => {})`

Fired once playback has finished.


## Metrics

Enable different audio params. Please note that enabled metrics require 3 times more memory for storing file than

### `audio.spectrum(time?, options?)`

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

Ideas:

* chord/scale detection
* tonic, or main frequency for the range — returns scientific notation `audio.pitch(time?, (err, note) => {})`
* tempo for the range `audio.tempo(time?, (err, bpm) => {})`
-->


## Utils

### `audio.fromDb(db)`

Convert decibels to gain.

### `audio.toDb(gain)`

Convert gain to decibels.

### `audio.save(fileName, done?)`

Download as a wav file in browser, write audio to file in node. In node file is going to be saved to the same directory as the caller's one. To redefine directory, use absolute path as `audio.save(__dirname + '/my-audio.wav')`

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


## Motivation

We wanted to create high-level utility for audio manipulations, to the contrary low-level [audio packages](https://github.com/audiojs). We looked for an analog of [Color](https://npmjs.org/package/color) for color manipulations, [jQuery](https://jquery.org) for DOM, [regl](https://npmjs.org/package/regl) for WebGL, [opentype.js](http://opentype.js.org/) for fonts, in audio world.

The result turned out to be central infrastructural component for [audiojs packages](https://github.com/audiojs) and glue for [audio visualizing components](https://github.com/audio-lab).


## Credits

Acknowledgement to contributors:

* [Jamen Marz](https://github.com/jamen) for initiative and help with making decisions.
* [Daniel Gómez Blasco](https://github.com/danigb/) for patience and work on [audio-loader](https://github.com/audiojs/audio-loader).
* [Michael Williams](https://github.com/ahdinosaur) for audio stream insights.

## License

[MIT](LICENSE) &copy; <a href="https://github.com/audiojs">audiojs</a>.
