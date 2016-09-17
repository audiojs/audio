# Audio [![build status][travis-i]][travis] [![gitter][gitter-i]][gitter]

Class for audio manupulations in javascript, nodejs/browser.

[![npm install audio](https://nodei.co/npm/audio.png?mini=true)](https://npmjs.org/package/audio/)

```js
const Audio = require('audio')

//Load sample
let audio = Audio('./sample.mp3');

//trim/normalize, add fade
audio.trim().normalize().fadeIn(.3).fadeOut(1)

//download processed audio as a wav file
audio.download()
```

## API

### Creating

```js
const Audio = require('audio')

let audio = new Audio(source, options?, ready?)
```

Create _Audio_ instance from the _source_, invoke _ready_ callback.

Source can be:

| type | meaning |
|---|---|
| _String_ | Load audio from URL or local path: `Audio('./sample.mp3')` |
| _AudioBuffer_ | Wrap _AudioBuffer_ instance. `Audio(new AudioBuffer(data))`. See also [audio-buffer](https://npmjs.org/package/audio-buffer). |
| _ArrayBuffer_, _Buffer_ | Decode data contained in a buffer or arrayBuffer. `Audio(pcmBuffer)`. |
| _Array_, _FloatArray_ | Create audio from samples of `-1..1` range. `Audio(Array(1024).fill(0))`. |
| _Stream_, _source_ or _Function_ | Create audio from source stream. `Audio(WAAStream(oscillatorNode))`. `'ready'` event will be triggered as soon as stream is ended. |
| _Number_ | Create silence of the duration: `Audio(4*60 + 33)` to create digital copy of [the masterpiece](https://en.wikipedia.org/wiki/4%E2%80%B233%E2%80%B3). |

Possible options:

| name | meaning |
|---|---|
| _context_ | WebAudioAPI context to use (optional). |


If you are going to use audio from worker, use `require('audio/worker')`.


### Properties

Read-only properties. To change them, use according methods.

```js
//audio data properties
audio.duration;
audio.channels;
audio.sampleRate;

//audio buffer with the actual data
audio.buffer;
```

### Reading & writing

```js
//Load audio from source. Source can be any argument, same as in constructor.
audio.load(source, (err, audio) => {})

//Put source data by the offset, can be an _Audio_, _AudioBuffer_ or _Stream_.
//Plays role of concat/push/unshift/set
audio.write(source, start?, (err, audio) => {})

//Remove indicated range of data
audio.delete(start?, end?, (err, audio) => {})

//Get audio buffer of the duration starting from the offset time.
audio.read(start?, duration?, (err, buffer) => {})

//Create stream/pull-stream for the data
audio.stream(start?, duration?).pipe(...)
audio.pull(start?, duration?)
```

### Playback

Preview the selected range.

```js
//start playback of selected region, invoke callback on end
audio.play(start?, end?, {loop: false, rate: 1, volume: 1}?, (err) => {})
audio.pause()
audio.stop()

//read-only playback params
audio.currentTime;
audio.paused;
audio.rate;
audio.volume;
audio.loop;
```

### Metrics

```js
//get array with frequencies for the offset (make FFT)
audio.frequencies(start?, end?, how?, (err, magnitudes) => {})

//estimate average, max, min and other params for the indicated range
audio.stats(start?, end?, (err, stats) => {})

//estimate loudness for a fragment
audio.loudness(start?, end?, (err, loudness) => {})

//guess tonic, or main frequency for the range — returns scientific notation
audio.tone(start?, end?, (err, note) => {})

//guess tempo for the range
audio.tempo(start?, end?, (err, bpm) => {})

//size of underlying buffer, in bytes
audio.size(start?, end?, (err, size) => {})
```

### Manipulations

Methods are mutable, because data may be pretty big. If you need immutability do `audio.clone()` after each method call.

Note also that if audio data is not ready, all the applied manipulations will be queued.

```js
//slice the data to indicated part
audio.slice(start?, end?, (err, audio) => {})

//normalize fragment or complete data
audio.normalize(start?, end?, (err, audio) => {})

//change the direction of samples for the indicated part
audio.reverse(start?, end?, (err, audio) => {})

//inverse phase for the indicated range
audio.inverse(start?, end?, (err, audio) => {})

//make sure there is no silence for the indicated range
audio.trim(start?, end?, threshold?, (err, audio) => {})

//make sure the duration of the fragment is ok
audio.padStart(duration?, value?, (err, audio) => {})
audio.padEnd(duration?, value?, (err, audio) => {})

//change volume of the range
audio.gain(volume, start?, end?, (err, audio) => {})

//cancel values less then indicated threshold 0
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

### Events

```js
//fired once when audio buffer is ready
audio.on('ready')

//fired whenever new data is recieved and decoded
audio.on('load')

//playback events
audio.on('play')
audio.on('pause')
audio.on('stop')
audio.on('ended')
```

### Utils

```js
//get new audio with copied data into a new buffer
audio.clone()

//get audio wrapper for the part of the buffer not copying the data. Mb useful for audio sprites
audio.subaudio(start?, end?)

//download as a wav file in browser, place audio to a file in node
audio.download(fileName)

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
