## Quick Rules
Create and use utilities for any type of audio manipulation.  They are hosted on
npm to be shared and reused, creating a framework.  Here are some common utility
guidelines to keep a clean structured system:

 1. Modules should be designed stream-based, so you can create a pipeline of
    different utilities in production.  You can use `Readable`, `Writable`, or
    `Duplex` depending on the purpose.  An example of using plugins:

    ```js
    fs.createReadStream('./foo.wav') // Create buffer stream
    .pipe(decodeWav({ ...options })) // Decode utility (Buffer of WAV -> Audio)
    .pipe(manipulate(...)) // Manipulation utility (mutates Audio)
    .pipe(encodeMp3(...)) // Encoding utility (Audio -> Buffer of MP3)
    // ... use the buffer for whatever...
    .pipe(fs.createWriteStream('./foo.mp3'));
    ```

 2. Prefix your utility with `audio-` on npm, i.e. `audio-decode-wav`
    or `audio-encode-wav`.  This helps with package discovery and to show
    relevancy to the project.

 3. Put the keyword `"audiojs"` in your package.json so it will be listed on our
    [npm keyword page][npm-audiojs].  This also helps with package discovery and
    relevancy.

    ```js
    {
      "name": "audio-foobar",
      // ...
      "keywords": [
        "audiojs"
      ]
    }
    ```

## Using `Audio`
It saves your time by doing the reading and writing math for you, using properties you tell it to use. More specifically `Audio`'s purpose is to:
 1. Store the source of some [PCM audio][pcm-audio].
 2. Store the properties of that source (duration of the audio, bit depth, amount of channels, signed values, and the byte order).
 3. Does the audio math for you in the methods (i.e. `.read`, `.write`, and `.slice`).

Note: Properties not used in the methods are still important, like with `sampleRate` with playback.

Here is an example of a utility with `through2` to reverse some audio:

```javascript
function reverse(options) {
  options = options || {};
  return through2.obj(function(audio, enc, callback) {
    // Reverse the source
    audio.source = audio.source.reverse();

    // Pipe audio.
    callback(null, audio);
  });
};

// Example of using:
fs.createReadStream('./foo.wav')
.pipe(decodeWav())
.pipe(reverse())
// you've used your utility!
```

(You don't have to use `through2`, only for simplicity here)

[npm-audiojs]: https://www.npmjs.com/browse/keyword/audiojs
[through2]: https://www.npmjs.com/package/through2
[pcm-audio]: https://en.wikipedia.org/wiki/Pulse-code_modulation
