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
