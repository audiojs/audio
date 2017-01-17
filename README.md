# Audio [![experimental](http://badges.github.io/stability-badges/dist/experimental.svg)](http://github.com/badges/stability-badges) [![Build Status](https://img.shields.io/travis/audiojs/audio.svg?style=flat-square)](https://travis-ci.org/audiojs/audio) [![NPM Version](https://img.shields.io/npm/v/audio.svg?style=flat-square)](https://www.npmjs.org/package/audio) [![License](https://img.shields.io/badge/license-MIT-brightgreen.svg?style=flat-square)](https://audiojs.mit-license.org/)

Class for userland audio manipulations in javascript — nodejs and browsers.

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

Common use-cases.

#### 1. Basic processing — trim, normalize, fade, save

```js
const Audio = require('audio')

Audio('./sample.mp3').on('load', (err, audio) => {
	audio.trim().normalize().fadeIn(.3).fadeOut(1).download();
})
```

<!--
	ideas:
	  - image
		file → waveform → processed waveform → file
	  - try yourself - requirebin demo with file opener and processing
-->

#### 2. Record 4s of microphone input

```js
const Audio = require('audio')

navigator.getUserMedia({audio: true}, stream =>	{
	Audio(stream, {duration: 4}).on('end', (err, audio) => audio.download())
});
```

#### 3. Record and download 2 seconds of web-audio experiment

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
let audio = new Audio
audio.duration = 2
audio.record(osc)
audio.on('end', () => {
	osc.stop()
	audio.end().download()
})
```

#### 4. Download AudioBuffer returned from offline context

```js
const Audio = require('audio')

//setup offline context
let offlineCtx = new OfflineAudioContext(2,44100*40,44100)
audioNode.connect(offlineCtx)

//process result of offline context
offlineCtx.startRendering().then((audioBuffer) => {
	Audio(audioBuffer).download()
})
```

#### 5. Montage audio

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

#### 6. Render waveform of HTML5 `<audio>`

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


## API

In order to be user-friendly, _audio_ takes on some conventions.
Methods follow natural language convention `audio.<do>(<what>, <how>?, <after>?)`, or in other words `audio.<method>(<data>, <options>?, <callback>?)`.
Every method has optional callback argument, following node-style callbacks. First argument of the callback is error and the second is data: `audio.trim(..., (error, data) => {})`.



### Creating

#### `let audio = new Audio(source, options?, callback?)`

Create _Audio_ instance from the _source_ based on _options_. Invoke _callback_ when the _source_ is loaded and audio is ready. The _callback_ will take _error_ and _audio_ arguments.

```js
let audio = new Audio('./sample.mp3', {duration: 2}, (err, audio) => {
	if (err) throw Error(err);

	// audio contains fully loaded and decoded sample.mp3 here
})
```

Source can be syncronous, asynchronous or stream. Sync source, like _AudioBuffer_, _Array_ or _Number_, sets contents immediately. Async source, like _String_ or _Promise_, waits for it to load and only then invokes the callback. Stream source puts audio into [recording state](#recording), updating contents as it becomes available, and when input stream ends or reaches max duration it fires `end` event.

| source type | meaning | loading method |
|---|---|---|
| _String_ | Load audio from URL or local path: `Audio('./sample.mp3', (error, audio) => {})`. Result for the URL will be cached for the future instances. To force no-cache loading, do `Audio(src, {cache: false})`. | dynamic |
| _AudioBuffer_ | Wrap _AudioBuffer_ instance: `Audio(new AudioBuffer(data))`. See also [audio-buffer](https://npmjs.org/package/audio-buffer). | static |
| _ArrayBuffer_, _Buffer_ | Decode data contained in a buffer or arrayBuffer. `Audio(pcmBuffer)`. | static |
| _Array_, _FloatArray_ | Create audio from samples of `-1..1` range. `Audio(Array(1024).fill(0))`. | static |
| _File_ | Try to decode audio from [_File_](https://developer.mozilla.org/en/docs/Web/API/File) instance. | static |
| _Number_ | Create silence of the duration: `Audio(4*60 + 33)` to create digital copy of [the masterpiece](https://en.wikipedia.org/wiki/4%E2%80%B233%E2%80%B3). | static |
| _Stream_, _pull-stream_ or _Function_ | Create audio from source stream. `Audio(WAAStream(oscillatorNode))`. Puts audio into recording state. | stream |
| _WebAudioNode_, _MediaStreamSource_ | Capture input from web-audio. Puts audio into recording state. | stream |
| _HTMLAudioElement_, _HTMLMediaElement_ | Wrap [`<audio>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio) or [`<video>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video) element, capture it's contents. Puts audio into recording state. | stream |

Possible `options`:

| name | default | meaning |
|---|---|---|
| _context_ | [audio-context](https://npmjs.org/package/audio-context) | WebAudioAPI context to use (optional). |
| _duration_ | `null` | Max duration of an audio. If undefined, it will take the whole possible input. |
| _sampleRate_ | `context.sampleRate` | Default sample rate for the audio data. |
| _channels_ | `2` | Upmix or downmix audio input to the indicated number of channels. If undefined it will take source number of channels. |
| _cache_ | `true` | Load cached version of source, if available. Used to avoid extra URL requests. |






#### `audio.read(start?, duration?, callback)`

Get audio buffer of the duration starting from the offset time.

#### `audio.readRaw(offset?, duration?, callback)`

Get audio buffer of the duration starting from the offset sample.

#### `audio.write(buffer, start?, callback?)`

Sets a new audio data by offset.

#### `audio.writeRaw(buffer, offset?, callback?)`

Sets a new audio data by offset.

#### `audio.replace(start?, deleteDuration?, insertData?, callback?)`

Inserts and/or deletes new audio data by offset. Slower than set

#### `audio.insert()`

#### `audio.delete()`


#### `audio.load(source, callback?)`

Load audio from source, discard old content. Source can be any argument, same as in the constructor. `load` event will be fired once audio is received and decoded.

<small>[audio-loader](https://github.com/audiojs/audio-loader) is used internally to tackle loading routines</small>

#### `audio.loading`

Whether audio content is loading.


### Recording

To capture dynamic inputs like microphone, `<audio>` element or streams, _Audio_ utilizes classical _recording_ paradigm. To start recording invoke `audio.record(source)` and then it's contents will be periodically updated from the source, whether it is _MediaSourceStream_ mic input, `<audio>` source element, _WebAudioNode_ or _Stream_. When the source is finished, the `end` event will be fired and recording will stop.


#### `audio.record(source, offset?)`

Start recording from the source. New audio data will be placed to the end, unless specific `offset` is defined. Offset can be negative, that indicates offset from the end.

<small>Similar to [captureStream](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/captureStream).</small>

#### `audio.recording`

Indicates whether audio is in the recording state.

#### `audio.end()`

Stop recording.

#### `audio.schedule(time)`


### Playback

Listen part of the audio.

?! In some sense playback is akin to idle time-bound processing.

#### `audio.play(start = 0, duration?, options?, err => {}?)`

Start playback from the indicated offset, invoke callback on end.

Possible `options`:

| name | default | meaning |
|---|---|---|
| _loop_ | `true` | Repeat after end. |
| _rate_ | `1` | Speed up/slow down playback. |
| _volume_ | `1` | Gain hearable sound. |

#### `audio.pause()`

Pause current playback. Calling `audio.play()` once again will continue from the point of pause.

#### `audio.stop()`

Reset playback/recording. Calling `audio.play()` will start from the beginning.

#### `audio.muted`

#### `audio.loop`

#### `audio.rate`

#### `audio.volume`

#### `audio.paused` read only

If playback is active.

#### `audio.currentTime`

Current playback/recording time in seconds. Setting this value seeks the audio to the new time.

#### `audio.duration` read only

Returns a double indicating the length of the media in seconds, or 0 if no media data is available.

#### `audio.ended` read only

Boolean that indicates whether the media element has finished playing.

#### `audio.error` read only

MediaError object for the most recent error, or null if there has not been an error.



### Metrics

#### `audio.spectrum(start?, options?)`

Get array with spectral component magnitudes (magnitude is length of a phasor). Underneath the [fourier-transform](https://www.npmjs.com/package/fourier-transform) is used.

Possible `options`:

| name | default | meaning |
|---|---|---|
| _size_ | `1024` | Size of FFT transform, e. g. number of frequencies to capture. |
| _channel_ | `0` | Channel number to get data for, `0` is left channel, `1` is right etc. |
| _db_ | `false` | Convert resulting magnitudes from `0..1` range to decibels `-100..0`. |


Ideas:

* chord/scale detection
* cepstrum
* average, max, min and other params for the indicated range `audio.stats(start?, (err, stats) => {})`
* loudness for a fragment `audio.loudness(start?, (err, loudness) => {})`
* tonic, or main frequency for the range — returns scientific notation `audio.pitch(start?, (err, note) => {})`
* tempo for the range `audio.tempo(start?, (err, bpm) => {})`
* size of underlying buffer, in bytes `audio.size(start?, (err, size) => {})`


### Manipulations

Methods are mutable, because data may be pretty big. If you need immutability do `audio.clone()`.

```js
//normalize fragment or complete data
audio.normalize(start?, duration?, callback?)

//change the direction of samples for the indicated part
audio.reverse(start?, duration?, callback?)

//inverse phase for the indicated range
audio.inverse(start?, duration?, callback?)

//make sure there is no silence for the indicated range
audio.trim(start?, duration?, threshold?, callback?)

//make sure the duration of the fragment is long enough
audio.padStart(duration?, value?, callback?)
audio.padEnd(duration?, value?, callback?)

//change volume of the range
audio.gain(volume, start?, duration?, callback?)

//cancel values less than indicated threshold 0
audio.threshold(value, start?, duration?, callback?);

//merge second audio into the first one at the indicated range
audio.mix(otherAudio, start?, duration?, callback?)

//change sample rate to the new one
audio.resample(sampleRate, how?, callback?)

//upmix or downmix channels
audio.remix(channelsNumber, how?, callback?)

//change play rate, pitch will be shifted
audio.scale(amount, start?, duration?, callback?)

//apply per-sample processing
audio.fill(value|(value, n, channel) => value, start?, duration?, callback?)

//fill with 0
audio.silence(start?, duration?, callback?)

//fill with random
audio.noise(start?, duration?, callback?)

//apply gradual fade to the part of audio
audio.fadeIn(duration?, start?, easing?, callback?)
audio.fadeOut(duration?, start?, easing?, callback?)

//process audio with sync function, see any audiojs/audio-* module
audio.process(audioBuffer => audioBuffer, start?, duration?, callback?)
audio.process(require('audio-biquad')({frequency:2000, type: 'lowpass'}), callback?)

//process audio with async function
audio.process((chunk, callback?) => cb(null, chunk), start?, duration?, callback?)
```


### Utils

```js
//get new audio with copied data into a new buffer
audio.clone()

//get audio wrapper for the part of the buffer not copying the data. Mb useful for audio sprites
audio.subaudio(start?, duration?)

//download as a wav file in browser, place audio to a file in node
audio.download(fileName, options?)

//return buffer representation of data
audio.toBuffer()
```


### Events

#### `audio.on('play')`
#### `audio.on('pause')`
#### `audio.on('stop')`
#### `audio.on('end')`
#### `audio.on('record')`
#### `audio.on('load')`


## Motivation

We wanted to create versatile polyfunctional userland utility for audio manipulations, to the contrary of low-level packages of various kinds. We looked an analog of [Color](https://npmjs.org/package/color) for color manipulations, [jQuery](https://jquery.org) for DOM or [regl](https://npmjs.org/package/regl) for WebGL, [opentype.js](http://opentype.js.org/) for fonts, but for audio. It embodies reliable and performant modern practices of audio components and packages in general.

## Credits

Thanks to all the wonderful people:

* [Jamen Marz](https://github.com/jamen) for initiative and help on making decisions.
* [Daniel Gómez Blasco](https://github.com/danigb/) for patience and work on [audio-loader](https://github.com/audiojs/audio-loader) component.
* [Michael Williams](https://github.com/ahdinosaur) for stream insights.

## License
[MIT](LICENSE) &copy;
