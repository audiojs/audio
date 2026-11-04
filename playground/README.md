# Playground

The editor at [audio.js.org/audio/playground](https://audio.js.org/audio/playground/), and the same editor in any page as `<audio-repl>`.

## Embed

```html
<script type="module" src="https://audio.js.org/embed.js"></script>

<audio-repl panel="none" height="320" ui='{"zoom":{"out":1},"overshoot":0}'>
<pre><code>audio('/sounds/take.mp3')</code></pre>
</audio-repl>
```

The `<pre>` shows until the frame comes, and where scripts don't run. A sound named by its path from the site's root is that site's file. Nothing of the reader's is kept.

The element's own attributes:

| Attribute | Value |
|---|---|
| `height` | the element's height, px (`320`) |
| `title` | the frame's title, for screen readers |
| `ui` | the UI config below, as JSON |
| `panel` `display` `controls` `ops` `background` | each one key of the UI config, over the `ui` attribute's |

The element sends `mark` events as the playground's mark moves: `{ mode }` (`rest`, `work`, `play`, `record`, `scrub`) as it changes, `{ turn }` for each turn a scrub gives it.

## UI config

One JSON object, the `ui` attribute's, which the frame reads as `?ui=` (playground/editor/config.js `UI`). Every key is optional.

| Key | Value | Default |
|---|---|---|
| `panel` | `code` (the script beside the picture), `edits` (its steps, each with its settings) or `none` | `code` |
| `display` | `wave` or `spec` | `wave` |
| `controls` | the parts shown, each in its own place whatever the list's order. Over the picture: `sound` (its name, a menu of its ways in), `link` and `name` (the way to the playground), `ruler` (the time row), `look` (a band's dropdown of how it draws). In the bar: `play` `record` `loop` `clock` `history` `message` `heard`, a level (`level`, or what it reads: `peak` `rms` `loudness`), `rate` `channels` `depth` `before`, `view` (a switch: the waveform, the spectrogram), `open` and `save` (in the format picked from its menu) | all but `sound`, `view`, `open`, `save` |
| `ops` | edits a press away, one button after the history, a menu of them: calls with their own arguments, or the defaults the menus write, as `["trim", "normalize(-1)", "stretch(1.25)"]`; each with a line on what it does, the edits made listed first, checked, a press taking one away, and counted on the button | none |
| `background` | the ground it sits on, a CSS colour; `page` (attribute only) reads the page's own colour under the element. The picture's edges fade into whatever is under them | the slab's |
| `zoom` | how far time zooms: `in`, the fewest samples across the view; `out`, the most of the sound across it, as times its length (`1`: the sound exactly, never room after it) | `{ "in": 32, "out": 1.333 }` (4/3: a quarter of the view room after the sound) |
| `overshoot` | how far the view scrolls past the sound's end, as a share of the view (`0.5`: the end at its middle; `0`: never past it) | `0.5` |
| `scroll` | what scrolls the view, zoomed in: `bar` (a thin bar at the time row's foot), `hover` (the bar shown only while the pointer is over the picture, and for a second after the view is scrolled or zoomed by keys or touch) or `overview` (the whole sound in a strip under the time row) | `bar` |

A picture with no empty room after its sound, as a page's hero: `{ "zoom": { "out": 1 }, "overshoot": 0 }`.

## How it is built

The script is the document. Every edit, from the picture, a card or the agent, rewrites the script's text (`code.js`), and the sound is what that text makes. Undo steps back through the script's states. There is no second model of the edits to keep in step with it.

### Where code runs

| Realm | What runs there | Entry |
|---|---|---|
| Page | The editor (`editor.js` over `editor/`), the view (`view.js` over `view/`), the code pane, `deck.js`. No copy of the library | `index.html` |
| Engine worker | The whole library, plugins and codecs as chunks loaded on first use. Runs scripts, keeps sources and outputs, finds cues and notes, exports | `worker.js`, built to `dist/worker.js` |
| Deck worker | The library as playback needs it. Holds the last two sounds the page holds and renders what plays of them, so a script or a model's pass can't hold playback up. If it fails, the engine worker plays instead | `voices.js`, built to `dist/voices.js` |
| Jobs threads | One kernel over parts of a sound (declip). No core | `jobs.js`, built to `dist/jobs.js` |
| Audio thread | The deck's worklet, and `scrub.js` for a held caret | loaded by `deck.js` and `player.js` |
| Service worker | On GitHub Pages, the cross-origin isolation headers Pages doesn't send, so models' wasm runs on threads | `sw.js` |

`npm run serve` builds the bundles, rebuilds them as sources change, and serves the repository with nothing cached. Tests build only `playground/dist/`, which git ignores.

### From a keystroke to sound

1. The script changes. `schedule()` in `editor/run.js` waits a moment; a slider runs at once.
2. `evaluate()` reads the script (`code.js` `prepare`: what to run, its tracks) and `perform()` asks the engine (`engine.js` `run`). A newer run replaces one still waiting.
3. The engine worker runs the script. A chain it has already made comes from what is kept, and only what follows the kept step renders.
4. The output streams back in pieces, as samples or, past what the page holds, as peaks and spectra. `arrival()` draws what has come, `settle()` takes the whole output, and the view (`v.set`) and player (`pl.set`) get it.
5. Play asks for a voice (`engine.js` `voice`): the deck worker's for a sound the page holds, the engine's for a long one. The page adopts it through `audio/worker` and the worker renders straight into the deck.

`__settled()` resolves once no run is waiting, asked or on its way and two frames have been drawn. Tests wait on it.

### What is kept where

| What | Where | Key | Limit |
|---|---|---|---|
| Files a person opens or records | Browser files (`keep.js`) | file name | Never let go without being asked |
| Tabs: scripts, views, settings | `localStorage`, `audio-repl` (`editor/persist.js`) | tab | Browser's |
| Renders, each output | Browser files (`audio-editor-renders`) | script and files (`checkpoint.js` `keysOf`) | A quarter of the quota, 2 GiB at least |
| Renders, each output and step | Engine worker's memory (`kept`) | same | 128 MB |
| What models make | Browser files (`audio-editor-memo`) | input and settings | 1 GiB |
| An output's samples | Engine worker: pages past 64 MB go to browser files (`cache.js`) | run | Until the run is replaced or its tab closes |
| Sounds the page holds | Deck worker | sound | The last two |

### Tracks

A script has tracks when two or more statements declare a sound nothing else reads, the last of them being its last statement or a master after them:

```js
let voice = audio('voice.wav').normalize('podcast')
let bed = audio('bed.mp3').gain(-18)
```

- A sound another reads (a mix's source, a noise print, the sound tracks copy) feeds that one and has no track of its own.
- A sound read only as a sidechain key (`ducker({ key: voice })`) is still heard, so it is a track.
- A master is a last statement that copies one track and mixes each other into it, then adds steps of its own: `voice.clone().mix(bed).normalize('podcast')`. The output is its value, and each track is heard in it as its lane shows it.
- Anything else has no tracks, and the output is the last value.

`code.js` `tracks()` and `master()` are the only readers of this grammar.

What a track's lane holds outside the script is kept by the track's name: its mute (`state.muted`), lock (`state.locked`), height (`heights`), what it shows (`kinds`), and which track is edited (`state.track`).

- A rename in the UI (`renameTrackTo`) carries all five to the new name.
- A track made or taken away in the UI (`anew`) clears what its name held, so a new one of that name starts clean.
- A name lost by typing in the script is ignored, and the edited track falls back to one the script has (`trackOf`). Its state stays on purpose: a half-typed name or a syntax error must not lose a track's mute. The cost is that a rename typed into the script leaves the state behind, and a track typed in under an old name takes it.

### Keys, menus and the agent

Each act is one entry in `editor/commands.js`: its label, keys, when it can run, and what it does. The menus (`editor/menus.js`), the page's keys (`editor/keys.js`), the picture's keys (`view/select.js`, through `onkey`), tooltips, the help list, the agent's simple tools and the Mac menu bar all read it.

### What must hold

| Rule | Held by |
|---|---|
| The page loads no library; the voice is made in the deck's worker, or the engine's if that fails | `test/playground/run.test.js` 'the page plays through deck.js alone' |
| The page preloads exactly the modules the editor imports | `run.test.js` 'the page preloads every module' |
| No module writes a binding it imports: shared ones go through `assign()` | `run.test.js` 'no object literal in the page names a key twice' |
| A resize, a look, a theme or a tab shown starts no run; a mute, a solo or a rename makes no track again | `run.test.js` 'a mute, a solo, a rename, a resize' |
| The newest script is the one shown | `run.test.js` 'the newest script is the one shown' |
| A slider's drag is one undo step | `edits.test.js` 'Undo steps back through the script' |
| One browser tab edits at a time; the first stores and steps aside | `tabs.test.js` 'a second tab asks to be the editor' |
| A tab shown again shows its sound at once | `tabs.test.js` 'a tab shown again shows its sound at once' |
| Each setting comes back as it was kept | `look.test.js` 'every setting comes back' |
| The bar stays one row, whole, at desktop, tablet and phone widths | `layout.test.js` 'the bar on a desktop', 'tablet', 'phone' |

Tests live in `test/playground/`, a file a feature over `page.js`. `test/scope.js` picks which run from the paths changed.
