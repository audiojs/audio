# Audio [![Travis][travis-icon]][travis] [![Gitter][gitter-icon]][gitter]
> Audio in JavaScript.

```javascript
var test = new Audio({
  sample: [34, 334, -23, 0, ...pulses], // Pulse data or buffer
  sampleRate: 44100, // Sample rate
  bitDepth: 16, // Bit depth
  length: 44100 * 10, // 10s length
  byteOrder: 'LE', // Either BE or LE
  // ...
});
```
See more options and usage in [the documentation](/docs).

This object enables you to hold extensive PCM data and do reading and writing on it, where it also works as a central object for [other algorithmic functions][npm-audiojs] for things like conversion, compression, or any type of audio manipulation.  For example, it can work as the middleman for converting to and from different audio formats.

Visit [audio.js](https://github.com/audiojs) for more audio utilities in JavaScript.

## Installation
```shell
$ npm install --save audio
```
For use in the browser use [Browserify][browserify].

## Credits
| ![jamen][avatar] |
|:---:|
| [Jamen Marzonie][github] |

## License
[MIT](LICENSE) &copy; Jamen Marzonie

[avatar]: https://avatars.githubusercontent.com/u/6251703?v=3&s=125
[github]: https://github.com/jamen
[travis]: https://travis-ci.org/jamen/node-audio
[travis-icon]: https://img.shields.io/travis/jamen/node-audio.svg
[gitter]: https://gitter.im/jamen/node-audio
[gitter-icon]: https://img.shields.io/gitter/room/jamen/node-audio.svg
[browserify]: http://npmjs.com/browserify
[audiojs]: https://www.npmjs.com/browse/keyword/audiojs
[npm-audiojs]: https://www.npmjs.com/browse/keyword/audiojs
