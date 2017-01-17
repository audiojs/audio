# Audio [![build status][travis-i]][travis] [![gitter][gitter-i]][gitter] [![experimental](http://badges.github.io/stability-badges/dist/experimental.svg)](http://github.com/badges/stability-badges)

Class for audio manipulations in javascript — nodejs and browsers.

[![npm install audio](https://nodei.co/npm/audio.png?mini=true)](https://npmjs.org/package/audio/)

```js
const Audio = require('audio')

/*
//Basic processing: trim, normalize, fade, save
Audio('./sample.mp3').trim().normalize().fadeIn(.3).fadeOut(1).download();


//Record 4s of mic input
navigator.getUserMedia({audio: true}, stream =>	Audio(stream, {duration: 4}).download());


//Record, process and download web-audio experiment
let ctx = new AudioContext();
let osc = ctx.createOscillator();
osc.type = 'sawtooth';
osc.frequency.value = 440;
osc.start();
osc.connect(ctx.destination);
let audio = Audio(osc);
setTimeout(() => {
	osc.stop();
	audio.end().download();
}, 2000);


//Download AudioBuffer returned from offlineContext
let offlineCtx = new OfflineAudioContext(2,44100*40,44100);
osc.connect(offlineCtx);
offlineCtx.startRendering().then((audioBuffer) => {
	Audio(audioBuffer).download();
});


//Montage audio
let audio = Audio('./record.mp3');
audio.set(Audio(audio.get(2.1, 1)).scale(.9), 3.1); //repeat slowed down fragment
audio.delete(2.4, 2.6).fadeOut(.3, 2.1); //delete fragment, fade out
audio.splice(2.4, Audio('./other-record.mp3')); //insert other fragment not overwriting the existing data
*/
```

## API

### Creating

#### `new Audio(source, options?, (err, audio) => {}?)`

Create _Audio_ instance from the _source_, invoke _load_ callback.

`source` can be static, dynamic or stream. Static source, like _AudioBuffer_ or _Array_, sets contents immediately and behaves synchronously. Dynamic source like _String_ or _Promise_ waits for source to load and only then invokes the callback. Stream source puts audio in [recording state](#recording), updating contents as it becomes available.

| type | meaning |
|---|---|
| _String_ | Load audio from URL or local path: `Audio('./sample.mp3', done)`. Result for the URL will be cached to increase performance of future instances. To force no-cache loading, do `Audio(src, {cache: false})`. |
| _AudioBuffer_ | Wrap _AudioBuffer_ instance: `Audio(new AudioBuffer(data))`. See also [audio-buffer](https://npmjs.org/package/audio-buffer). |
| _ArrayBuffer_, _Buffer_ | Decode data contained in a buffer or arrayBuffer. `Audio(pcmBuffer)`. |
| _Array_, _FloatArray_ | Create audio from samples of `-1..1` range. `Audio(Array(1024).fill(0))`. |
| _File_ | Try to decode audio from [_File_](https://developer.mozilla.org/en/docs/Web/API/File) instance. |
| _Number_ | Create silence of the duration: `Audio(4*60 + 33)` to create digital copy of [the masterpiece](https://en.wikipedia.org/wiki/4%E2%80%B233%E2%80%B3). |
| _Stream_, _pull-stream_ or _Function_ | Create audio from source stream. `Audio(WAAStream(oscillatorNode))`. Puts audio into recording state. |
| _WebAudioNode_, _MediaStreamSource_ | Capture input from web-audio. Puts audio into recording state. |
| _HTMLAudioElement_, _HTMLMediaElement_ | Wrap [`<audio>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio) or [`<video>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video) element, capture it's contents. Puts audio into recording state. |

Possible `options`:

| name | default | meaning |
|---|---|---|
| _context_ | [audio-context](https://npmjs.org/package/audio-context) | WebAudioAPI context to use (optional). |
| _duration_ | `null` | Max duration of an audio. If undefined, it will take the whole possible input. |
| _sampleRate_ | `context.sampleRate` | Default sample rate to store the audio data. The input will be resampled, if sampleRate differs. |
| _channels_ | `2` | Upmix or downmix audio input to the indicated number of channels. If undefined - will take source number of channels. |
| _cache_ | `true` | Load cached version of source, if available. Use to avoid extra URL requests. |


### Static source

#### `audio.read(start?, duration?, (err, buffer) => {})`

Get audio buffer of the duration starting from the offset time.

#### `audio.readRaw(offset?, duration?, (err, buffer) => {})`

Get audio buffer of the duration starting from the offset sample.

#### `audio.write(buffer, start?, (err, audio) => {}?)`

Sets a new audio data by offset.

#### `audio.writeRaw(buffer, offset?, (err, audio) => {}?)`

Sets a new audio data by offset.

#### `audio.replace(start?, deleteDuration?, insertData?, (err, audio) => {})`

Inserts and/or deletes new audio data by offset. Slower than set


### Dynamic source

#### `audio.load(source, (err, audio) => {}?)`

Load audio from source, discard old content. Source can be any argument, same as in the constructor. `load` event will be fired once audio is received and decoded.

#### `audio.isLoading`

Whether audio content is loading.


### Recording

To capture dynamic inputs like microphone, `<audio>` element or streams, _Audio_ utilizes classical _recording_ paradigm. To start recording invoke `audio.record(source)` and then it's contents will be periodically updated from the source, whether it is _MediaSourceStream_ mic input, `<audio>` source element, _WebAudioNode_ or _Stream_. When the source is finished, the `end` event will be fired and recording will stop.

```js
let audio = new Audio()

//record mic input
navigator.getUserMedia({audio: true, video: false},	stream => {
	audio.record(stream)
	setTimeout(() => audio.end(), 2000)
})
```

#### `audio.record(source, offset?)`

Start recording from the source. New audio data will be placed to the end, unless specific `offset` is defined. Offset can be negative, that indicates offset from the end.

#### `audio.isRecording`

Indicates whether audio is in the recording state.

#### `audio.end()`

Stop recording.


### Playback

Listen part of the audio.

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

Reset playback. Calling `audio.play()` will start from the beginning.

#### `audio.isPaused`

If playback is active.

#### `audio.on('play')`
#### `audio.on('pause')`
#### `audio.on('stop')`
#### `audio.on('ended')`

Playback events.


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
audio.normalize(start?, end?, (err, audio) => {})

//change the direction of samples for the indicated part
audio.reverse(start?, end?, (err, audio) => {})

//inverse phase for the indicated range
audio.inverse(start?, end?, (err, audio) => {})

//make sure there is no silence for the indicated range
audio.trim(start?, end?, threshold?, (err, audio) => {})

//make sure the duration of the fragment is long enough
audio.padStart(duration?, value?, (err, audio) => {})
audio.padEnd(duration?, value?, (err, audio) => {})

//change volume of the range
audio.gain(volume, start?, end?, (err, audio) => {})

//cancel values less than indicated threshold 0
audio.threshold(value, start?, end?, (err, audio) => {});

//merge second audio into the first one at the indicated range
audio.mix(otherAudio, start?, end?, (err, audio) => {})

//change sample rate to the new one
audio.resample(sampleRate, how?, (err, audio) => {})

//upmix or downmix channels
audio.remap(channelsNumber, how?, (err, audio) => {})

//change play rate, pitch will be shifted
audio.scale(amount, start?, end?, (err, audio) => {})

//apply per-sample processing
audio.fill(value, start?, end?, (err, audio) => {})
audio.fill((value, n, channel) => value, start?, end?, (err, audio) => {})

//fill with 0
audio.silence(start?, end?, (err, audio) => {})

//fill with random
audio.noise(start?, end?, (err, audio) => {})

//apply gradual fade to the part of audio
audio.fadeIn(duration?, start?, easing?, (err, audio) => {})
audio.fadeOut(duration?, start?, easing?, (err, audio) => {})

//process audio with sync function, see any audiojs/audio-* module
audio.process(audioBuffer => audioBuffer, start?, end?, (err, audio) => {})
audio.process(require('audio-biquad')({frequency:2000, type: 'lowpass'}), (err, audio) => {})

//process audio with async function
audio.process((chunk, cb) => cb(null, chunk), start?, end?, (err, audio) => {})

//reserved methods
audio.map()
audio.filter()
```


### Utils

```js
//get new audio with copied data into a new buffer
audio.clone()

//get audio wrapper for the part of the buffer not copying the data. Mb useful for audio sprites
audio.subaudio(start?, end?)

//download as a wav file in browser, place audio to a file in node
audio.download(fileName, options?)

//return buffer representation of data
audio.toBuffer()
```


## Motivation

We wanted to create analog of [Color](https://npmjs.org/package/color) and [jQuery](https://jquery.org) for audio. It embodies reliable and performant practices of modern components.

## Credits

|  ![jamen][author-avatar]  | ![dfcreative](https://avatars2.githubusercontent.com/u/300067?v=3&u=9c2bd522c36d3ae54f3957b0babc2ff27ca4b91c&s=140) |
|:-------------------------:|:-------------------------:|
| [Jamen Marz][author-site] | [Dima Yv](https://github.com/dfcreative) |


## License
[MIT](LICENSE) &copy; Jamen Marz


[travis]: https://travis-ci.org/audiojs/audio
[travis-i]: https://travis-ci.org/audiojs/audio.svg
[gitter]: https://gitter.im/audiojs/audio
[gitter-i]: https://badges.gitter.im/Join%20Chat.svg
[npm-audiojs]: https://www.npmjs.com/browse/keyword/audiojs
[author-site]: https://github.com/jamen
[author-avatar]: https://avatars.githubusercontent.com/u/6251703?v=3&s=125
[stackoverflow]: http://stackoverflow.com/questions/ask
