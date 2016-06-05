# audio [![Travis][travis-icon]][travis] [![Gitter][gitter-icon]][gitter]
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
See more options and usage in [the documentation](/doc).

This object allows you to hold extensive PCM data and do simple reading and writing on it, where you can also use algorithmic functions for manipulating.  It also acts as a middleman for decoding and encoding different audio formats in JavaScript.

## Installation
```shell
$ npm install --save audio
```

## Credits
| ![jamen][avatar] |
|:---:|
| [Jamen Marzonie][github] |

## License
[MIT](LICENSE) &copy; Jamen Marzonie

[avatar]: https://avatars.githubusercontent.com/u/6251703?v=3&s=125
[github]: https://github.com/jamen
[travis]: https://travis-ci.org/audiojs/audio
[travis-icon]: https://img.shields.io/travis/audiojs/audio.svg
[gitter]: https://gitter.im/audiojs/audio
[gitter-icon]: https://img.shields.io/gitter/room/audiojs/audio.svg
