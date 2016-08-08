## Writing Utilities
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

[npm-audiojs]: https://www.npmjs.com/browse/keyword/audiojs
[through2]: https://www.npmjs.com/package/through2
