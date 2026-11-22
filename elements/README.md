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
  <audio-play></audio-play> <audio-seek></audio-seek> <audio-time></audio-time>
  <audio-status></audio-status> <audio-open></audio-open> <audio-save></audio-save>
</audio-sound>
```

`index.js` defines them all; each also has its own module (`code.js`, `sound.js`, `play.js`, `seek.js`, `time.js`,
`status.js`, `open.js`, `save.js`). Demos: [index.html](index.html) (the code block), [sound.html](sound.html) (a sound
and its parts).

## What loads when

| When | What | Gzipped |
|---|---|---|
| The page loads | the elements, the parser, the script's reading | 124 KB |
| A sound is in sight | the player (`repl/player.js`, `deck.js`) | 19 KB |
| A reader reaches for a code block | CodeMirror | 108 KB |
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
`<input>`. Their look is the page's font and ink, no ground; state shows as attributes.

| Element | Does | For CSS |
|---|---|---|
| `<audio-play>` | plays and pauses | `data-playing`, `data-working`, `--played` (0 to 1) |
| `<audio-seek>` | a range along its length | |
| `<audio-time>` | `0:05 / 0:21`; `remaining`: `−0:16` | |
| `<audio-status>` | what the sound does, and what went wrong; a live region | `data-working`, `data-error` |
| `<audio-open>` | the file the script opens, by name; pressed, one of the reader's own in its place. `accept` | |
| `<audio-save>` | the file the script saves, by name; pressed, downloaded. `name` for a script with no `save()` | `data-working` |

## Not built

A picture of the sound (`<audio-wave>`, `<audio-spectrogram>`, `<audio-notes>`): the editor's view must hold its
state per instance first. Before and after, loop, history, level, the chain of edits. The editor's own code pane is
not yet this `<audio-code>`; the two share `repl/script.js`. The whole editor in a page is still
[`<audio-repl>`](../repl/README.md#embed), a frame.

Tests: `test/repl/audio-code.test.js`, `test/repl/audio-sound.test.js` (against the library in Node: a script's
length, the bytes it saves).
