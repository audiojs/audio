# Audio

[![experimental](https://img.shields.io/badge/stability-experimental-red.svg)](http://github.com/badges/stability-badges)
[![Build Status](https://img.shields.io/travis/audiojs/audio.svg)](https://travis-ci.org/audiojs/audio)
[![Greenkeeper badge](https://badges.greenkeeper.io/audiojs/audio.svg)](https://greenkeeper.io/)
[![Code Climate](https://codeclimate.com/github/audiojs/audio/badges/gpa.svg)](https://codeclimate.com/github/audiojs/audio)
[![Downloads](https://img.shields.io/npm/dm/audio.svg)](https://npmjs.org/package/audio)
[![npm](https://img.shields.io/npm/v/audio.svg)](https://www.npmjs.com/package/audio)
[![license](https://img.shields.io/npm/l/audio.svg)](https://www.npmjs.com/package/audio)

Class for high-level audio manipulations in javascript. An abstraction from the level of raw data and DSP to the level of natural sound manipulations.

<!--
ideas:
	- docs
	- playground: editing based on settings-panel (demo)
	- gallery:
		- spectrum vis
		- waveform vis
		- demoscene vis
		- benchmark
		- recorder app w/ choo
		- text waveform
		- player component
	- downloads
	- size
	- image (just teaser/logo)
-->

## Usage & use-cases

[![npm install audio](https://nodei.co/npm/audio.png?mini=true)](https://npmjs.org/package/audio/)

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

-->

> Load `./sample.mp3`, trim, normalize, fade in, fade out, save:

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


> Record 4s of mic input.

```js
const Audio = require('audio')

navigator.getUserMedia({audio: true}, stream =>

	Audio.record(stream, (err, audio) => {
		audio.save('my-record.wav')
	})
)
```


> Record and download 2 seconds of web-audio experiment

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
let audio = Audio(osc, {duration: 2})
audio.on('end', () => {
	osc.stop()
	audio.download('experiment')
})
```


> Download AudioBuffer returned from offline context

```js
const Audio = require('audio')

//setup offline context
let offlineCtx = new OfflineAudioContext(2, 44100*40, 44100)
audioNode.connect(offlineCtx)

//process result of offline context
offlineCtx.startRendering().then((audioBuffer) => {
	Audio(audioBuffer).save()
})
```


> Montage audio

```js
const Audio = require('audio')

let audio = Audio.load('./record.mp3', (err, audio) => {
	//repeat slowed down fragment
	audio.write(audio.copy(2.1, 1).scale(.9), 3.1)

	//delete fragment, fade out
	audio.delete(2.4, 2.6).fadeOut(.3, 2.1)

	//insert other fragment not overwriting the existing data
	Audio('./other-record.mp3', (err, otherAudio) => {
		audio.insert(2.4, otherAudio)
	})

	audio.download('edited-record')
})
```

> Render waveform of HTML5 `<audio>`

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

> Process audio with _audio-*_ modules

```js
const Audio = require('audio')
const Biquad = require('audio-biquad')

let lpf = new Biquad({frequency: 2000, type: 'lowpass'})
let audio = Audio(10).noise().process(lpf)
```

	Data handle - subaudio, for sprites etc

	Load intro, append 1s pause, start recording. Once ended, save as file.

Audio(['./intro.mp3', 1, MediaStream]).once('ready', (err, audio) => audio.save(Date() + '-recording.mp3'))


## [API](https://github.com/audiojs/audio/blob/master/api.md)

**1. [Core](#creation)**

* [new Audio(src?, opts?)]()
* [Audio.from(a, b?, c?, ..., opts?)]()
* [Audio.load(url, opts?, cb?)]()
* [Audio.decode(buf, opts?, cb?)]()
* [audio.buffer]()
* [audio.channels]()
* [audio.duration]()
* [audio.length]()
* [audio.sampleRate]()
* [audio.time(offset)]()
* [audio.offset(time)]()
* [Audio.gain(db)]()
* [Audio.db(gain)]()
* [Audio.isAudio(a)]()
* [Audio.isEqual(a, b, ...c)]()
* [audio.serialize(format)]()
* [audio.save(filename, opts?)]()
* [Audio.record(stream, opts?)]()
* [audio.stream(dst, opts?, onend?)]()
* [audio.clone()]()

**2. [Manipulations](#manipulations)**

* [audio.read(dst?, t?, dur?, opts?)]()
* [audio.write(src|val, t?, dur?, opts?)]()
* [audio.insert(data, t?, dur?, opts?)]()
* [audio.slice(t?, dur?, opts?)]()
* [audio.remove(t?, dur?, opts?)]()
* [audio.pad(dur, opts?)]()
* [audio.shift(amt, t?, opts?)]()
* [audio.trim(opts?)]()
* [audio.repeat(times, t?, dur?, opts?)]()
* [audio.reverse(t?, dur?, opts?)]()
* [audio.invert(t?, dur?, opts?)]()
* [audio.gain(db, t?, dur?, opts?)]()
* [audio.fade(t?, dur, opts?)]()
* [audio.normalize(t?, dur?, opts?)]()
* [audio.pan(amt, t?, dur?, opts?)]()
* [audio.mix(audio, t?, dur?, opts?)]()
* [audio.scale(amt, t?, opts?)]()
* [audio.map(fn, opts?)]()

**3. [Metrics](#metrics)**

* [audio.statistics(t?, dur?, opts?)]()
* [audio.bounds(t?, dur?, opts?)]()
* [audio.spectrum(t?, dur, opts?)]()
* [audio.cepstrum(t?, dur)]()
* [audio.loudness(t?, dur)]()
* [audio.memory(t?, dur, opts?)]()

**4. [Playback](#playback)**

* [audio.play(t?, dur?, opts?)]()
* [audio.pause()]()
* [audio.muted]()
* [audio.loop]()
* [audio.rate]()
* [audio.volume]()
* [audio.paused]() <kbd>readonly</kbd>
* [audio.currentTime]()


## See Also

* [audiojs](https://github.com/audiojs) − open-source audio components for javascript
* [web-audio-api](https://github.com/audiojs/web-audio-api) − web-audio-api implementation for nodejs

## Related

* [tuna](https://github.com/Theodeus/tuna)

## Credits

Acknowledgement to contributors:

* [Dmitry Yv](https://github.com/dfcreative) for redesign and take on main implementation.
* [Jamen Marz](https://github.com/jamen) for initiative and help with making decisions.
* [Daniel Gómez Blasco](https://github.com/danigb/) for patience and work on [audio-loader](https://github.com/audiojs/audio-loader).
* [Michael Williams](https://github.com/ahdinosaur) for audio stream insights.


## License

[MIT](LICENSE) &copy; <a href="https://github.com/audiojs">audiojs</a>.
