## Writing Utilities
Create and use utilities for any type of audio manipulation.  They can be hosted
on npm to be shared and reused.  Here are some common utility guidelines:

 1. When writing functional utilities, it is common for the first argument to be
    the `Audio` initialization, and the second argument a plain object of
    options for the function.  For example:

    ```js
    module.exports = function myUtility(audio, options) {
      options = options || {};
      // ...
    }
    ```

 2. Preferably prefix your utility with `audio-` on npm, i.e. `audio-decode-wav`
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
