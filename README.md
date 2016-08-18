# Audio [![build status][travis-i]][travis] [![gitter][gitter-i]][gitter]
> Framework for handling audio in JavaScript.

```javascript
fs.createReadStream('./foo.wav')
// Use streams to create, manipulate, or serialize audio.
// Decoding the read stream into Audio here with audio-wav.
.pipe(wav.decode())
// Create streams to use Audio in the pipeline:
.pipe(through2.obj(function(audio, enc, callback) {
  // Read or write values on the audio.
  var right = audio.read(100, 2);
  audio.write(7, 500, 1);
  // Push audio in the stream.
  callback(null, audio);
}));
```
(See more examples and usage in [the docs](docs/))

## Installation
Use the [npm keyword "audiojs"][npm-audiojs] to find utilities (with directions in their READMEs).

If you are creating a utility and need to use the `Audio` object:
```shell
$ npm install --save audio
```

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
