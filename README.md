# Audio [![build status][travis-i]][travis] [![gitter][gitter-i]][gitter]

> High-level class for working with waveform/audio data.

[![npm install audio](https://nodei.co/npm/audio.png?mini=true)](https://npmjs.org/package/audio/)

```js
const Audio = require('audio');

let audio = Audio('./foo.wav');

//properties
audio.duration;
audio.channels;
audio.sampleRate;
audio.buffer;
audio.bars;

//CRUD
audio.load(url|audioBuffer|audio|arrayBuffer|number|listOfSourcesForSprite);
audio.read(start, len);
audio.write(start, buf|array);
audio.splice(start, number, buf|array?);
audio.push(buf|array);
audio.shift(buf|array);

//playback
audio.play(start?, end?);
audio.pause();
audio.currentTime;
audio.rate;
audio.loop;
audio.paused;
audio.volume;

//get frequencies data for the offset
audio.frequencies(start?, fftSize?);

//get grouped representation of the time domain data
audio.bars(groupSize, channel, start?, end?);

//normalize selection or whole length
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

## Documentation

See [the `docs/` folder](docs/) for info on the framework and object.  Use [StackOverflow][stackoverflow] for your questions.

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
