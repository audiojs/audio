# Audio [![Build Status](https://img.shields.io/travis/audiojs/audio.svg?style=flat-square)](https://travis-ci.org/audiojs/audio) [![unstable](https://img.shields.io/badge/stability-unstable-orange.svg?style=flat-square)](http://github.com/badges/stability-badges)

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

Audio('./sample.mp3').then(audio =>
	audio.trim().normalize().fade(.3).fade(-1).save('sample-edited.wav')
)
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

### 9. Load intro, append 1s pause, start recording. Once ended, save as file.

Audio(['./intro.mp3', 1, MediaStream]).once('ready', (err, audio) => audio.save(Date() + '-recording.mp3'))
-->

## API

### `new Audio(source, options?|channels=2, (err, audio)=>{}?)`

Create _Audio_ instance from the `source` based on `options` (or number of `channels`), invoke callback when source is loaded. Returns `then`able audio instance, which resolves once the source is loaded.

`source` can be _sync_, _async_ or _stream_:

* _Sync_ source − [_AudioBuffer_](https://github.com/audiojs/audio-buffer), [_AudioBufferList_](https://github.com/audiojs/audio-buffer-list), _Number_ indicating duration or _Array_/_FloatArray_ with raw channels data or array with any of these to load sequence. Sets contents immediately and returns ready to use audio instance.
* _Async_ source − URL string, _ArrayBuffer_, _Buffer_, _Blob_, [_File_](https://developer.mozilla.org/en/docs/Web/API/File) with encoded mp3/wav/ogg/etc data. The data is loaded and decoded, `load` event fired when ready. `audio.isReady` indicator can be used to check status. For the time of loading audio contains zero buffer with silence. [audio-loader](https://github.com/audiojs/audio-loader) and [audio-decode](https://github.com/audiojs/audio-decode) are used internally.
* _Stream_ source − [_Stream_](https://nodejs.org/api/stream.html), [_pull-stream_](https://github.com/pull-stream/pull-stream), _Function_, [_MediaStream_](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream)_WebAudioNode_ or _Array_ with sequence of any sources. Starts recording, updating contents until input stream ends or max duration reaches. `data` and `end` events are emitted during stream consumption. Returned thenable takes arguments `.then(success, error, progress)`. Plays role of [audiorecorder](https://npmjs.org/package/audiorecorder).

<!--
| _HTMLAudioElement_, _HTMLMediaElement_ | Wrap [`<audio>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio) or [`<video>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video) element, capture it's contents. Puts audio into recording state. | stream |
-->

`options` may include:

* `channels` − number of channels, inferred from source or defaults to `2`.
* `context` − web audio context (optional), defaults to [audio-context](https://npmjs.org/package/audio-context).
* `sampleRate` − inferred from source or defaults to `44100`.
* `cache` − cache URL sources to avoid extra requests. By default `true`.
* `stats` − track stats for metrics. Increases memory consumption up to 3 times (yet O(N)). By default disabled.

```js
//create 2-channel audio of duration 4m 33s
let blankAudio = new Audio(4*60 + 33, 2)

//create from AudioBuffer
let bufAudio = new Audio(new AudioBuffer(2, [.1,.1,...]))

//create from raw data
let arrAudio = new Audio([0,1,.2,.3,...], {channels: 2})

//decode mp3/wav arrayBuffer/buffer, nodejs-callback style
let wavAudio = new Audio(require('audio-lena/mp3'), (err, wavAudio) => {
	// `wavAudio` here is decoded from the mp3 source
})

//create from remote source, promise-callback style
let remoteAudio = new Audio('./sample.mp3').then((remoteAudio) => {
	// `remoteAudio` here is fully loaded and decoded
})

//record stream, emitter-callback style
let streamAudio = Audio(WAAStream(oscillatorNode)).on('end', (streamAudio) => {

})
```

### `audio.then(success, error, progress)`

Promise interface for loading source. If multiple sources provided, promise will resolve when all sources are loaded:

```js
Audio(['./a.mp3', './b.wav', './c.flac']).then(audio => {
	// audio here contains joined content of a, b and c
})
```

### `auidio.on(evt, audio=>{})`, `audio.once(evt, audio=>{})`

Events:

* `load` − when source is loaded
* `progress` − when part of the source is received
* `error` − when something went wrong during loading

### `audio.buffer`

[AudioBufferList](https://github.com/audiojs/audio-buffer-list) with raw audio data. Can be modified directly.

### `audio.channels`

Number of channels. Changing this property will up-mix or down-mix channels, see interpretation table in [audio-buffer-remix](https://github.com/audiojs/audio-buffer-remix).

### `audio.sampleRate`

Buffer sample rate. Changing this property will resample audio to target rate. (WIP)

### `audio.duration`

Buffer duration. Changing this property may right-trim or right-pad the data.

### `audio.length`

Get total length in samples.


### `audio.insert(time=-0, source, {start, channel}?)`

Insert data at the `time` offset. If `time` is undefined, the `source` will be appended to the end. `source` should be sync data, like [_AudioBuffer_](https://github.com/audiojs/audio-buffer), [_AudioBufferList_](https://github.com/audiojs/audio-buffer-list), loaded _Audio_ instance or array of any of these. If you need async/stream data inserted − create new audio and wait for it to load, then insert, as so:

```js
new Audio('./src.mp3')
    .then(audio =>
        new Audio('./src2.mp3')
        .then(audio2 => audio.insert(audio2))
    )
    .then(audio => {
    	//...audio here contains both src and src2
    })
```

Optional `start` raw offset can be passed in options.

### `audio.remove(time=0, duration?, {start, end, channel}?)`

Delete duration from the audio. Returns the removed audio fragment.

### `audio.clone(deep?)`

Return cloned instance, by default pointing the same buffer. Pass `deep = true` to clone the buffer contents.

<!--

### audio.repeat
### audio.slice(start, end) - return copy of audio
### audio.sub(start, end) - return subaudio handle
### audio.copy(dest, start, end) - copy to destination

### audio.overlay(otherAudio)
### audio.pan()
### audio.dcOffset()
### audio.removeDcOffset()
-->

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


### `audio.normalize(time=0, duration?, {channel}?)`

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


### `audio.pad(duration, {value: 0, left, right}?)`

Make sure the duration of the audio is long enough. Pass `{left: true}` or `{right: true}` depending on what direction you need to pad.


### `audio.gain(volume, time=0, duration?, {channel}?)`

Change volume of the interval of `duration` starting at `time`. `volume` is in decibels.

```js
//make half as loud
let audio = new Audio(Array(44100).fill(1), 1).gain(-20)
```


### `audio.reverse(time=0, duration?, {channel}?)`

Change the direction of samples for the indicated part.

```js
Audio('./sample.mp3', audio => {
	//reverse first three seconds of audio and play
	audio.reverse(0, 3).play()
})
```


### `audio.invert(time=0, duration?)`

Invert phase for the indicated range.

```js
//invert 1s following after the second second of audio
Audio(sample).invert(2, 1)
```

### `audio.data(time=0, duration?, {channel}?)`

Get channel or channels data for the indicated range as a list of arrays or single array with raw samples.

```js
//get 1s of raw data starting from 1.5s
let [leftChannel, rightChannel] = audio.data(1.5, 1)

//get complete raw data for the right channel
let rightChannelData = audio.data({channel: 1})
```

<!--



### `audio.threshold(level, time=0, duration?, {minPause, channel}?);`

Cancel values less than indicated threshold 0.


### `audio.mix(otherAudio, time=0, duration?, {channel}?)`

Merge second audio into the first one at the indicated range.


### `audio.scale(amount, time=0, duration?)`

Change playback rate, pitch will be shifted.

### `audio.fill(value|(value, n, channel) => value, time=0, duration?)`

Apply per-sample processing.

### `audio.silence(time=0, duration?)`

Fill with 0.

### `audio.noise(time=0, duration?)`

Fill with random.


### `audio.process((buf, cb) => cb(buf), time=0, duration?, onend?, {channel}?)`

Process audio or part with _sync_ or _async_ function, see any [audiojs/audio-* modules](https://github.com/audiojs).

* _sync_ function has signature `(audioBuffer) => audioBuffer`.
* _async_ function has signature `(audioBuffer, cb) => cb(err, audioBuffer)`.


## Playback

Prelisten methods.

### `audio.play(time=0, duration?, callback?)`

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

Ideas:

* chord/scale detection
* tonic, or main frequency for the range — returns scientific notation `audio.pitch(time=0, (err, note) => {})`
* tempo for the range `audio.tempo(time=0, (err, bpm) => {})`
-->


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


## Motivation

We wanted to create high-level utility for audio manipulations, to the contrary of low-level audio packages, which are plenty in npm. We looked for analog of [Color](https://npmjs.org/package/color) for color manipulations, [jQuery](https://jquery.org) for DOM, [regl](https://npmjs.org/package/regl) for WebGL, [opentype.js](http://opentype.js.org/) for fonts, in audio land.
The road took us couple of years and multitude of components.


## Credits

Acknowledgement to contributors:

* [Jamen Marz](https://github.com/jamen) for initiative and help with making decisions.
* [Daniel Gómez Blasco](https://github.com/danigb/) for patience and work on [audio-loader](https://github.com/audiojs/audio-loader).
* [Michael Williams](https://github.com/ahdinosaur) for audio stream insights.


## License

[MIT](LICENSE) &copy; <a href="https://github.com/audiojs">audiojs</a>.
