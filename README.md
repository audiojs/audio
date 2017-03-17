# Audio [![unstable](http://badges.github.io/stability-badges/dist/unstable.svg)](http://github.com/badges/stability-badges)[![Build Status](https://img.shields.io/travis/audiojs/audio.svg?style=flat-square)](https://travis-ci.org/audiojs/audio)[![NPM Version](https://img.shields.io/npm/v/audio.svg?style=flat-square)](https://www.npmjs.org/package/audio) [![License](https://img.shields.io/badge/license-MIT-brightgreen.svg?style=flat-square)](https://audiojs.mit-license.org/)

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

### 1. Basic processing — trim, normalize, fade in, fade out, save

```js
const Audio = require('audio')

Audio('./sample.mp3').on('load', (err, audio) => {
	audio.trim().normalize().fade(.3).fade(-1).download('sample-edited');
})
```

<!--
	ideas:
	  - image
		file → waveform → processed waveform → file
	  - try yourself - requirebin demo with file opener and processing
-->

<!--
### 2. Record 4s of microphone input

```js
const Audio = require('audio')

navigator.getUserMedia({audio: true}, stream =>	{
	Audio(stream, {duration: 4}).on('end', audio => audio.download())
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
-->

## API

### `let audio = new Audio(source, channels=2|options?, onload?)`

Create _Audio_ instance from the _source_ based on _options_ (or number of _channels_), invoke _onload_ when ready.

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
});

//create from remote source
let remoteAudio = new Audio('./sample.mp3', (err, remoteAudio) => {
	// `remoteAudio` here is fully loaded and decoded
})
```

`source` can be _sync_, _async_ or _stream_:

* _Sync_ source sets contents immediately and returns ready to use audio instance.
* _Async_ source waits for content to load and emits `load` event when ready (similar to _Image_ class). `audio.isReady` indicator can be used to check status. Not ready audio contains 1-sample buffer with silence. [audio-loader](https://github.com/audiojs/audio-loader) is used internally.
* [WIP] _Stream_ source puts audio into recording state, updating contents gradually until input stream ends or max duration reaches. `data` and `end` events are emitted during the consuming stream.

| source type | meaning | method |
|---|---|---|
| _String_ | Load audio from URL or local path: `Audio('./sample.mp3', (error, audio) => {})`. Result for the URL will be cached for the future instances. To force no-cache loading, do `Audio(src, {cache: false})`. | async |
| _AudioBuffer_ | Create from _AudioBuffer_. See [audio-buffer](https://github.com/audiojs/audio-buffer) instance. | sync |
| _ArrayBuffer_, _Buffer_ | Decode data contained in a _buffer_ or _arrayBuffer_. See [audio-decode](https://github.com/audiojs/audio-decode). | sync |
| _Array_, _FloatArray_ | Create audio from waw samples of `-1..1` range. | sync |
| _Number_ | Create blank audio of the duration. | sync |
<!--| _File_ | Try to decode audio from [_File_](https://developer.mozilla.org/en/docs/Web/API/File) instance. | sync |
| _Stream_, _pull-stream_ or _Function_ | Create audio from source stream. `Audio(WAAStream(oscillatorNode))`. Puts audio into recording state. | stream |
| _WebAudioNode_, _MediaStreamSource_ | Capture input from web-audio. Puts audio into recording state. | stream |
| _HTMLAudioElement_, _HTMLMediaElement_ | Wrap [`<audio>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio) or [`<video>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video) element, capture it's contents. Puts audio into recording state. | stream |
-->

Optionally pass number of `channels` or `options` as the second argument. Available `options`:

| name | default | meaning |
|---|---|---|
| _context_ | [audio-context](https://npmjs.org/package/audio-context) | WebAudioAPI context to use (optional). |
| _duration_ | `null` | Max duration of an audio. If undefined, it will take the whole possible input. |
| _sampleRate_ | `context.sampleRate` | Default sample rate for the audio data. |
| _channels_ | `2` | Upmix or downmix audio input to the indicated number of channels. If undefined it will take source number of channels. _channels_ number can be passed directly instead of options object. |
| _cache_ | `true` | Load cached version of source, if available. Used to avoid extra URL requests. |

### `audio.buffer`

[AudioBuffer](https://github.com/audiojs/audio-buffer) with the raw actual audio data. Can be modified directly.

### `audio.channels`

Number of channels. Setting that property will upmix or downmix channels, see [channel interpretation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Basic_concepts_behind_Web_Audio_API#Up-mixing_and_down-mixing) table.

### `audio.sampleRate`

Buffer sample rate. Changing this property will resample audio to target rate.

### `audio.duration`

Buffer duration. Changing this property will whether right-trim or right-pad the data.

### `audio.read(time?, duration?)`

Get _AudioBuffer_ of the `duration` starting from the `start` time.

### `audio.write(audioBuffer, time?)`

Write _AudioBuffer_ at the `start` time. Old data will be overridden, use `insert` method to save the old data. If `audioBuffer` is longer than the `duration`, audio will be extended to fit the `audioBuffer`. If `start` time is not defined, new audio will be written to the end, unless `duration` is explicitly set.


## Manipulations

### `audio.fade(time=0, duration, easing?)`

Fade in part of the audio of the `duration` stating at `time`.
Pass negative `duration` to fade out from the indicated time (backward direction).

Default `easing` is linear, but any of [eases](https://npmjs.org/package/eases) functions can be used. `easing` function has signature `v = ease(t)`, where `t` and `v` are from `0..1` range.

```js
const Audio = require('audio')
const eases = require('eases')

let audio = Audio('./source').on('load', audio => {
	//fade in 1s from the beginning
	audio.fade(1, easing.cubicInOut)

	//fade out 1s from the end
	.fade(-1, easing.quadIn)

	//fade in .2s starting at .6s
	.fade(.6, .2)

	//fade out .2s starting at .8s (ending at 1s)
	.fade(1, .2)
})
```

### `audio.normalize(time?, duration?)`

Normalize fragment or full audio, i.e. bring data to -1..+1 range. Channels amplitudes ratio will be preserved. See [`audio-buffer-utils/normalize`](https://github.com/audiojs/audio-buffer-utils#utilnormalizebuffer-target-start--0-end---0).

```js
const Audio = require('audio')

let audio = new Audio([0, .1, 0, -.1], {channels: 1}).normalize()
// <Audio 0, 1, 0, -1>
```

### `audio.trim(threshold?)`

Make sure there is no silence at the beginning/end of audio. Duration may be reduced therefore.

```js
const Audio = require('audio')

let audio = new Audio([0,0,0,.1,.2,-.1,-.2,0,0], 1).trim()
// <Audio .1, .2, -.1, -.2>
```

### `audio.splice(time?, deleteDuration?, newData?)`

Insert and/or delete new audio data at the start `time`.

### `audio.reverse(time?, duration?)`

Change the direction of samples for the indicated part.

### `audio.inverse(time?, duration?)`

Inverse phase for the indicated range.

### `audio.padStart(duration?, value?)`
### `audio.padEnd(duration?, value?)`

Make sure the duration of the fragment is long enough.


### `audio.gain(volume, time?, duration?)`

Change volume of the range.

### `audio.threshold(value, time?, duration?);`

Cancel values less than indicated threshold 0.

### `audio.mix(otherAudio, time?, duration?)`

Merge second audio into the first one at the indicated range.

### `audio.resample(sampleRate, how?)`

Change sample rate to the new one.

### `audio.remix(channelsNumber, how?)`

Upmix or downmix channels.

### `audio.scale(amount, time?, duration?)`

Change playback rate, pitch will be shifted.

### `audio.fill(value|(value, n, channel) => value, time?, duration?)`

Apply per-sample processing.

### `audio.silence(time?, duration?)`

Fill with 0.

### `audio.noise(time?, duration?)`

Fill with random.

### `audio.process(audioBuffer => audioBuffer, time?, duration?)`
### `audio.process((chunk, callback?) => cb(null, chunk), time?, duration?, callback?)`

Process audio with sync or async function, see any audiojs/audio-* modules.



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

### `audio.spectrum(time?, options?)`

Get array with spectral component magnitudes (magnitude is length of a [phasor](wiki) — real and imaginary parts). [fourier-transform](https://www.npmjs.com/package/fourier-transform) is used internally.

Possible `options`:

| name | default | meaning |
|---|---|---|
| _size_ | `1024` | Size of FFT transform, e. g. number of frequencies to capture. |
| _channel_ | `0` | Channel number to get data for, `0` is left channel, `1` is right etc. |
| _db_ | `false` | Convert resulting magnitudes from `0..1` range to decibels `-100..0`. |

<!--
Ideas:

* chord/scale detection
* cepstrum
* average, max, min, stdev and other params for the indicated range `audio.stats(time?, (err, stats) => {})`
* loudness for a fragment `audio.loudness(time?, (err, loudness) => {})`
* tonic, or main frequency for the range — returns scientific notation `audio.pitch(time?, (err, note) => {})`
* tempo for the range `audio.tempo(time?, (err, bpm) => {})`
* size of underlying buffer, in bytes `audio.size(time?, (err, size) => {})`
-->


## Utils

```js
//get new audio with copied data into a new buffer
audio.clone()

//get audio wrapper for the part of the buffer not copying the data. Mb useful for audio sprites
audio.subaudio(time?, duration?)

//download as a wav file in browser, place audio to a file in node
audio.download(fileName, options?)

//return buffer representation of data
audio.toBuffer()
```


## Motivation

We wanted to create versatile polyfunctional userland utility for audio manipulations, to the contrary of low-level audio packages of various kinds. We looked for an analog of [Color](https://npmjs.org/package/color) for color manipulations, [jQuery](https://jquery.org) for DOM or [regl](https://npmjs.org/package/regl) for WebGL, [opentype.js](http://opentype.js.org/) for fonts, but for audio.

As a result it turned out to be infrastructural high-level glue component for _audio-*_ packages and _gl-*_ audio visualizing components. It embodies reliable and performant modern practices of audio components and packages in general.


## Credits

Thanks to all these wonderful people:

* [Jamen Marz](https://github.com/jamen) for initiative and help on making decisions.
* [Daniel Gómez Blasco](https://github.com/danigb/) for patience and work on [audio-loader](https://github.com/audiojs/audio-loader).
* [Michael Williams](https://github.com/ahdinosaur) for stream insights.

## License

[MIT](LICENSE) &copy; audiojs.
