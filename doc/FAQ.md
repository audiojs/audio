### What is the `Audio` object?
The `Audio` object is the heart for interacting with digital audio in JavaScript.  It stores PCM data like your sample, bit depth, and sample rate alongside a few methods for reading and writing pulse data.

### What is this used for?
For any time where you want scriptable audio in JavaScript.  For example, it can be used for conversion to and from any format (granted you have the encoders and decoders), where this object works as the middleman.  You can also manipulate and compress the audio data with any types of algorithms you or others create with JS.

### How do I install it?
```sh
$ npm install --save audio
```
For browsers, use [Browserify][browserify].

### How can I help?
You can [join the gitter chat][gitter] and open issues / pull requests.

[gitter]: https://gitter.im/audiojs/audio
[browserify]: https://www.npmjs.com/package/browserify
