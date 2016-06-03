# Audio [![NPM version][npm-image]][npm-url] [![Travis][travis-icon]][travis] [![Gitter][gitter-icon]][gitter]
> Audio in JavaScript.

A bare-bones JavaScript object for LPCM digital audio.  Store a buffer sample, bit depth of any size, and sample rate, then read and write pulse data.

```javascript
var Audio = require('audio');

// Initialize audio.
var foo = new Audio([10, -4], {length: 441000});

// Write more pulse data.
foo.write([3, 10, -3], 2);

// Read pulse data.
foo.slice(2, 4);
// => [3, 10]
```

## Installation
```shell
$ npm install --save audio
```

## Documentation
See [the `doc` folder](/doc) for more information.

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
[npm-image]: https://badge.fury.io/js/audio.svg
[npm-url]: https://npmjs.org/package/audio
