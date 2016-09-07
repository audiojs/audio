# Audio [![build status][travis-i]][travis] [![gitter][gitter-i]][gitter]
> Framework for handling audio in JavaScript.

```javascript
// Use streams to create, manipulate, or serialize audio.
// For example, decoding and encoding with audio-wav:
fs.createReadStream('./foo.wav').pipe(wav.decode())

// Create your own streams to use the PCM data directly.
.pipe(through2.obj(function(audio, enc, callback) {
  // Read pulse values
  var left = audio.read(200, 1);
  var right = audio.read(100, 2);

  // Write pulse values
  audio.write(7, 500, 2);

  // Push audio to continue pipe chain.
  callback(null, audio);
}));
```

A framework and object for using audio in JavaScript.  Based on top of streams to allow chaining utilities that wrap more complex operations.

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
