# Audio [![build status][travis-i]][travis] [![gitter][gitter-i]][gitter]

Class for processing audio in javascript, nodejs/browser.

[![npm install audio](https://nodei.co/npm/audio.png?mini=true)](https://npmjs.org/package/audio/)

```js
const Audio = require('audio');

//Load sample, trim/normalize and download back
Audio('./sample.mp3').trim().normalize().download();

//Simple montage
let result = Audio('./first.mp3').write(Audio(.5)).write(Audio('./second.mp3'));

result.normalize().download();
```

## API

<details><summary>**`const Audio = require('audio')`**</summary>
</details>
<details><summary>**`let audio = Audio(source, options? ready?)`**</summary>

Create _Audio_ instance from the _source_, invoke _ready_ callback if passed.

Possible source values:

| type | meaning |
|---|---|
| _String_ | Load audio from URL or local path. |
| _Number_ | Create audio with silence. |
| _AudioBuffer_ | Wrap _AudioBuffer_ instance. [audio-buffer](https://npmjs.org/package/audio-buffer) can be used to polyfill _AudioBuffer_. |
| _ArrayBuffer_, _Buffer_ | Decode data contained in buffer, if it is encoded. |
| _Array_, _FloatArray_ | Create audio from samples within `-1..1` range. |

Possible options:

| name | meaning |
|---|---|
| _context_ | WebAudioAPI context to use (optional). |

</details>
<details><summary>**`audio.duration`**</summary>
</details>
<details><summary>**`audio.channels`**</summary>
</details>
<details><summary>**`audio.sampleRate`**</summary>
</details>
<details><summary>**`audio.buffer`**</summary>

_AudioBuffer_ instance with actual samples data.

</details>

```js
//CRUD
//put to sep module?
audio.load(url|audioBuffer|audio|arrayBuffer|number|listOfSourcesForSprite);
audio.read(start, len);
audio.write(start, buf|array);
audio.splice(start, number, buf|array?);
audio.push(buf|array);
audio.shift(buf|array);

//playback
//put to audio-play mb?
//what’s up with arguments?
audio.play(start?, end?, opts?);
audio.currentTime;
audio.rate;
audio.loop;
audio.paused;
audio.volume;
audio.pause();

//get frequencies data for the offset
audio.frequencies(start?, fftSize?);

//utilities
audio.slice(start?, end?);
audio.normalize(start?, end?);
audio.reverse(start?, end?);
audio.inverse(start?, end?);
audio.trim(start?, end?);
audio.gain(volume, start?, end?);
audio.filter(params, start?, end?);
audio.map(fn(v, x, channel), start?, end?);
audio.mix(otherAudio, start?, end?)
audio.fadeIn(time, start?, end?);
audio.fadeOut(time, start?, end?);
audio.convolve(a, b);
audio.operation(fn, a, b);

//events
audio.on('load');
audio.on('end');
audio.on('play');
audio.on('pause');
audio.on('change');

//utils
audio.download(fileName);
ausio.toString();
ausio.toBuffer();
ausio.toArray();
ausio.toJSON();
```

## Motivation

_Audio_ is designed to be an universal and easy to use class for manipulating audio.
It is like [Color](https://npmjs.org/package/color) for color manipulations, or [jQuery](https://jquery.org) for DOM manipulations. It embodies best modern practices of reliable components.


## Installation

Use the [npm keyword "audiojs"][npm-audiojs] to find utilities (with directions in their own READMEs).

If you are creating a utility and need to use the `Audio` object:
```shell
$ npm install --save audio
```
(Use `audio@next` for latest prerelease versions)

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
