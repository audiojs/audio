# Audio [![build status][travis-i]][travis] [![gitter][gitter-i]][gitter]

Class for processing audio in javascript, nodejs/browser.

[![npm install audio](https://nodei.co/npm/audio.png?mini=true)](https://npmjs.org/package/audio/)

```js
const Audio = require('audio');

//Load sample
let audio = Audio('./sample.mp3');

//trim/normalize, add fade
audio.trim().normalize().fadeIn(.3).fadeOut(1)

//download processed audio back
audio.download();
```

## API

### Creating

```js
const Audio = require('audio');

let audio = new Audio(source, options? ready?);
```

Create _Audio_ instance from the _source_, invoke _ready_ callback if passed.

Possible source values:

| type | meaning |
|---|---|
| _String_ | Load audio from URL or local path. |
| _Number_ | Create audio with silence of the duration. |
| _AudioBuffer_ | Wrap _AudioBuffer_ instance. [audio-buffer](https://npmjs.org/package/audio-buffer) can be used to polyfill _AudioBuffer_. |
| _ArrayBuffer_, _Buffer_ | Decode data contained in buffer/arrayBuffer. |
| _Array_, _FloatArray_ | Create audio from samples within `-1..1` range. |
| _Stream_, _source_ or _Function_ | Create audio from source stream. |

Possible options:

| name | meaning |
|---|---|
| _context_ | WebAudioAPI context to use (optional). |

Load audio from remote

### Properties

Read-only properties. To change them, use according methods.

```js
//data properties
audio.duration;
audio.channels;
audio.sampleRate;

//audio buffer with the data
audio.buffer;

//current playback time
audio.currentTime;
```

### Reading & writing

```js
//Load audio from source. Source can be any argument, same as in constructor.
audio.load(source);

//Put data by the offset. Source can be an _Audio_, _AudioBuffer_ or _Stream_.
//Plays role of concat/push/unshift/set
audio.write(source, start?);

//Remove data from the indicated offset
audio.delete(start?, duration?);

//Get audio buffer of the duration starting from the offset time.
audio.read(start?, duration?);
```

### Playback

Preview the selected chunk.

```js
audio.play(start?, end?, {loop: false, rate: 1, volume: 1}?);
audio.pause();
audio.stop();
```

### Metrics

Think carefully here.

```js
//get frequencies data for the offset
audio.frequencies(start?, end?, how?);

//estimate average, max, min and other params for the indicated range
audio.stats(start?, end?);

//estimate loudness for a fragment
audio.loudness(start?, end?);

//guess tonic, or main frequency for the range — returns scientific notation
audio.tone(start?, end?);

//guess tempo for the range
audio.tempo(start?, end?);

//size of underlying buffer, in bytes
audio.size(start?, end?);
```

### Manipulations

All the manipulation methods are mutable, because data might be pretty big. If you need immutability do `audio.clone()` between each operation.

We should think carefully about this API.

```js
//slice the data to indicated part
audio.slice(start?, end?);

//normalize part of
audio.normalize(start?, end?);

//change the direction of samples for the indicated part
audio.reverse(start?, end?);

//inverse phase for the indicated range
audio.inverse(start?, end?);

//make sure there is no silence for the indicated range
audio.trim(start?, end?, threshold?);

//make sure there is silence for the indicated range
audio.padStart(duration?);
audio.padEnd(duration?);

//change volume of audio
audio.gain(volume, start?, end?);

//merge second audio into the first one at the indicated fragment
audio.mix(otherAudio, start?, end?);

//change sample rate to the new one
audio.resample(sampleRate, how?);

//upmix or downmix channels
audio.map(channelsNumber, how?);

//change play rate
audio.scale(amount, start?, end?);

//apply per-sample processing
audio.fill((value, n, channel) => value, start?, end?);

//fill with 0
audio.silence(start?, end?);

//fill with random
audio.noise(start?, end?);

//apply gradual fade to the part of audio
audio.fadeIn(duration?, start?, easing?);
audio.fadeOut(duration?, start?, easing?);

//process audio with sync function, see any audiojs/audio-* module
audio.process(audioBuffer => audioBuffer, start?, end?);
audio.process(require('audio-biquad')({frequency:2000, type: 'lowpass'}));

//process audio with async function
audio.process((audioBuffer, cb) => cb(null, audioBuffer), start?, end?);
```

### Events

```js
//fired once when audio buffer is ready
audio.on('ready');

//fired when new data is recieved and decoded
audio.on('load');

//playback events
audio.on('play');
audio.on('pause');
audio.on('stop');
```

### Utils

```js
//get new audio with copied data into a separate buffer
audio.clone();

//get audio wrapper for the part of the buffer. Audio buffer will be kept the same.
//useful for creating sprites
audio.subaudio(start?, end?);

//download file in browser, place audio to a file in node
audio.download(fileName);

//return buffer representation of data
audio.toBuffer();
```

## Motivation

Looking at [Color](https://npmjs.org/package/color) and [jQuery](https://jquery.org), there was no analogous class for audio. _Audio_ is intended to fill that gap.

It embodies reliable and performant practices of modern components.


## Credits

|  ![jamen][author-avatar]  |
|:-------------------------:|
| [Jamen Marz][author-site] |

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
