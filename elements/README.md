# Elements

The editor in parts: custom elements a page composes. Each is the HTML face of a module the editor itself runs on
(`repl/script.js`, `repl/engine.js`, `repl/player.js`), in the light DOM, styled by the page.

```html
<script type="module" src="https://audio.js.org/audio/elements/index.js"></script>

<audio-sound>
  <audio src="/sounds/take.mp3" data-name="take.mp3" preload="none"></audio>
  <audio-code><pre><code>audio('take.mp3')
  .trim()
  .normalize('podcast')
  .save('episode.mp3')</code></pre></audio-code>
  <audio-wave></audio-wave>
  <audio-play></audio-play> <audio-seek></audio-seek> <audio-time></audio-time>
  <audio-status></audio-status> <audio-open></audio-open> <audio-save></audio-save>
</audio-sound>
```

`index.js` defines them all; each also has its own module (`code.js`, `sound.js`, `wave.js`, `spectrogram.js`,
`play.js`, `seek.js`, `time.js`, `status.js`, `open.js`, `save.js`). Demos: [index.html](index.html) (the code block),
[sound.html](sound.html) (a sound, its pictures and its parts, and an embedded editor as the sound).

## What loads when

| When | What | Gzipped |
|---|---|---|
| The page loads | the elements, the parser, the script's reading | 124 KB |
| A sound is in sight | the player (`repl/player.js`, `deck.js`) | 19 KB |
| A reader reaches for a code block | CodeMirror | 108 KB |
| A picture draws its first sound | its renderer: `gl-waveform` 10 KB, `gl-spectrogram` 26 KB | |
| The first play or save | the engine's worker, the library's chunks, a decoder | about 370 KB, and the file |

Measured on the site's home, 21 Nov 2026. The script itself runs in a worker; the page's thread stays free.

## `<audio-code>`

A script, coloured as the editor colours it, editable once a reader reaches for it (the pointer over it, a press, Tab
into it). Its `<pre>` is the text where no script runs.

| | |
|---|---|
| `value` | the text. Set: the whole of it replaced, one undo step, no event |
| `input` event | the reader changed the text |
| `readonly` | never loads the editor; the text stays coloured and selectable |
| `focus()` | the keys in it |

In an `<audio-sound>` (or naming one with `for`) it is that sound's script: a file's name typed in `audio('…')` is
completed from the sound's files, `⌘↵` plays, `⌘S` saves.

Look: the editor's skin (`repl/skin.css`), set by custom properties on the element: `--color-screen` (its ground),
`--color-screen-ink`, `--color-syntax-<word>` (a word each: `call`, `string`, `comment`, `paren`…), `--font-mono`,
`--font-size-code`. The skin's values come in a cascade layer, `audio`, so any value a page sets wins. A page with
colours of its own for the words marks its root `data-worn`: the skin's leave, and a word given none takes the text's.

## `<audio-sound>`

One sound as a script makes it: run by the editor's engine, played by its player, saved as the script says. It lays no
box (`display: contents`).

Its script: its `<audio-code>`'s text; with none, its `script` attribute; with none, `audio(src)` of its `src`.

The files a script opens by name, in this order: an `<audio src>` or `<source src>` inside the sound (by `data-name`,
else the address's last part); an address (`https:`, a path from the site's root), which the engine opens itself; one
of the editor's samples (`chime.wav`); a file of that name in the page's folder. Names are the page's: every sound on
it shares one engine, and a name is one file there.

| Property | |
|---|---|
| `code` | the script (set: its `<audio-code>`'s value) |
| `files` | the names the page gives it and the engine holds |
| `opens`, `saves` | the files the script opens and saves, by name |
| `duration` | s; 0 till it has run |
| `output` | what it came to, for a picture: `{ sampleRate, length, channels }`, or, longer than the page holds (ten minutes of one channel), `{ summary }`; `null` till it has run |
| `time` | where it is, s (set: goes there) |
| `playing`, `working` | |
| `status` | what it does, in a word and a figure: `Decoding 40%`, `Applying auto: denoise 3.1s` |
| `error` | a message, or `''` |

| Method | |
|---|---|
| `run()` | runs the script as it is now; resolves with `{ duration, sampleRate, saves }`, or `null` where it failed |
| `play()`, `pause()`, `toggle()` | the script run first where it has not |
| `save(name)` | each `save()` of the script a file the page downloads; with none, the output as `name` says (`take.mp3`), a WAV by default |
| `open(file)` | a `File` in place of the first the script opens: in the engine under a free name, the script renamed to it |

Events: `change` (any of the above), `run`, `play`, `pause`, `ended`, `timeupdate`, `error`.

Once it has run, a change to its script runs it again a moment later, and what plays gives way to the new output where
it is. A file dropped on anything inside it opens.

## Its parts

Each is of the sound it is inside, or of the one it names: `<audio-play for="take">`. Each holds a real `<button>` or
`<input>` (a picture is itself a slider to the keys). Their look is the page's font and ink, no ground; state shows as
attributes.

| Element | Does | For CSS |
|---|---|---|
| `<audio-wave>` | the waveform, a lane a channel, the place it plays on it; a press, a drag or the arrows go there. `lazy` | `color`; `data-drawn`, `data-working` |
| `<audio-spectrogram>` | the spectrogram, the same. `scale`: `log`, `mel`, `erb`, `lin`; `background`; `lazy` | `color`; `data-drawn`, `data-working` |
| `<audio-play>` | plays and pauses | `data-playing`, `data-working`, `--played` (0 to 1) |
| `<audio-seek>` | a range along its length | |
| `<audio-time>` | `0:05 / 0:21`; `remaining`: `−0:16` | |
| `<audio-status>` | what the sound does, and what went wrong; a live region | `data-working`, `data-error` |
| `<audio-open>` | the file the script opens, by name; pressed, one of the reader's own in its place. `accept` | |
| `<audio-save>` | the file the script saves, by name; pressed, downloaded. `name` for a script with no `save()` | `data-working` |

The pictures are drawn by the renderers the editor's own view draws with, [gl-waveform](https://github.com/dy/gl-waveform)
and [gl-spectrogram](https://github.com/dy/gl-spectrogram), the whole sound across the element's width. In sight, a
picture has its sound run (there is no picture of a sound not made); `lazy` waits for the sound to be played. They do
not zoom, select or show a time row: that is the editor's view (`repl/view.js`), which is not an element yet.

## An embedded editor as the sound

[`<audio-repl>`](../repl/README.md#embed), the whole editor in a frame, answers as a sound too: the parts name it, and
its script is the page's to read and to set.

```html
<audio-repl id="take" panel="none"><pre><code>audio('/sounds/take.mp3').trim()</code></pre></audio-repl>
<audio-play for="take"></audio-play> <audio-time for="take"></audio-time> <audio-save for="take"></audio-save>
<audio-code id="script"><pre><code>audio('/sounds/take.mp3').trim()</code></pre></audio-code>
<script type="module">
  // one text: an edit made in the editor is the code block's, and the code block's is the editor's
  const take = document.getElementById('take'), script = document.getElementById('script')
  take.addEventListener('input', () => { if (script.value !== take.code) script.value = take.code })
  script.addEventListener('input', () => { take.code = script.value })
</script>
```

It has `code` (set: the frame's script whole, one step of its history), an `input` event when its script changes in
the frame, `playing`, `working`, `status`, `error`, `duration`, `time`, `opens`, `saves`, `toggle()`, `play()`,
`pause()`, `save()`, `open(file)`, and the events of `<audio-sound>`. It has no `output`: its picture is its own.

## Not built

The editor's view as an element: zoom, selection, the time row, notes, edits made on the picture. Before and after,
loop, history, level, the chain of edits. The editor's own code pane is not yet this `<audio-code>`; the two share
`repl/script.js`. A long sound's pictures (past ten minutes of one channel) are fed from the engine's summaries and
are not tested.

Tests: `test/repl/audio-code.test.js`, `audio-sound.test.js` (against the library in Node: a script's length, the
bytes it saves), `audio-picture.test.js` (against the renderers' own definitions: a tone's amplitude, a tone's row),
`embed-sound.test.js`.
