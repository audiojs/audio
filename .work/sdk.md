# Audio elements: a proposal

21 Nov 2026. For the owner to decide from. Every recommendation is marked **Rec**. Sources are files of this repository or
URLs read on this day.

## In short

Make the SDK a set of custom elements, in the light DOM, over the editor's own modules. One element holds a sound
(`<audio-sound>`): its script, its runs in the engine worker, its playback. The others show or edit that sound and find
it as Video.js 10's controls find their player: by being inside it, or by naming it (`for="id"`). Each element is the HTML
face of a factory the editor already has or will have (`script.js`, `view.js`, `player.js`), so the editor and the SDK
stay one code. Built and tested so far: `<audio-code>` (section 1), then `<audio-sound>` and six parts that play,
seek, time, tell, open and save it (section 1b). A page's author reads `elements/README.md`.

## 1. Built: `<audio-code>`

```html
<script type="module" src="https://audio.js.org/audio/elements/code.js"></script>
<audio-code>
<pre><code>audio('take.mp3')
  .trim()
  .normalize('podcast')</code></pre>
</audio-code>
```

- The `<pre>` is the text where no script runs. Once defined, the element draws the text as the editor does: numbered
  lines, each word coloured by `repl/syntax.js` over the parser's tree, by the rules of `repl/script.js`, in the skin's
  colours (`repl/skin.css`).
- CodeMirror (`repl/script.js`, through its own `lazy` option) loads only when a reader reaches for the block: the
  pointer over it, a press, or Tab into it. The press becomes the caret; a selection made meanwhile becomes the
  editor's selection. `readonly`: never loads it.
- `el.value`: the text. Set, it replaces the text as one undo step and fires nothing. `input` event on each change the
  reader makes. `el.focus()`.
- Styling: custom properties on the element (`--color-screen`, `--color-syntax-<word>`, `--font-mono`,
  `--font-size-code`, all the skin's names). The skin's values come in a cascade layer (`@layer audio`) on `:root`,
  so any value a page sets wins.
- Files: `elements/code.js`, `elements/index.html` (demo: one alone, the home's four cases together),
  `test/repl/audio-code.test.js` (10 tests).
- Weight, gzipped, read off the live site for the modules already deployed: drawn, 94 KB (the parser chunk is 47.7 KB of
  it, and CodeMirror shares it); reached for, CodeMirror 112 KB more. Today each of the home's four cases is an
  `<audio-repl panel="code">` frame loading the editor page; the home's hero, the same page embedded with no code pane,
  is budgeted at 575 KB first load (`test/live.js`, commit f631711).
- One change to an existing file: `repl/script.js` exports its two theme specs (`LOOKS`) and the mark's class name
  (`marked`) instead of building them inside `codemirror()`. Checked identical to the original by deep equality, key
  order included; `test/repl/look.test.js` 34/34 and `code.test.js` + `edits.test.js` 50/50 pass over it.

## 1b. Built: `<audio-sound>` and its parts

21 Nov 2026, after the owner's "ok go on with SDK ... it must allow suggesting the ops from ops list, changing opened
file, click on download. We need to have as many SDK components as meaningful."

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

- `<audio-sound>` (`elements/sound.js`): one sound as a script makes it. The script is its `<audio-code>`'s text, else
  its `script` attribute, else `audio(src)`. Run by `repl/engine.js` (one worker for every sound on a page, a tab each),
  played by `repl/player.js`, saved by the engine's `export` (each `save()` a file by its name). It lays no box.
  Properties `code`, `files`, `opens`, `saves`, `duration`, `time`, `playing`, `working`, `status`, `error`; methods
  `run()`, `play()`, `pause()`, `toggle()`, `save(name)`, `open(file)`; events `change`, `run`, `play`, `pause`, `ended`,
  `timeupdate`, `error`.
- Files a script opens by name: each `<audio src>` or `<source src>` in the sound names one (`data-name`, else the
  address's last part); an address the engine opens itself; the editor's samples (`chime.wav`) are made; any other
  name is asked of the page's folder. Names are page-wide: the sounds share one engine.
- Nothing of the engine loads till a part is pressed. The player's module (`repl/player.js`, `deck.js`: 19 KB gzipped)
  loads once the sound is in sight, so the first press opens the device in the press, as Safari asks (not tested in
  Safari on a phone).
- Once it has run, a change to its script runs it again 300 ms later, and what plays gives way to the new output where
  it is: an edit is heard as it is made. Before the first run a change runs nothing.
- Parts (`elements/part.js` and one module each), each of the sound it is in or the one its `for` names:
  `<audio-play>` (a button; `data-playing`, `data-working`, `--played` 0 to 1), `<audio-seek>` (a native range),
  `<audio-time>` (0:05 / 0:21; `remaining`), `<audio-status>` (a live region: Decoding 40%, Applying auto: denoise
  3.1s, an error with `data-error`), `<audio-open>` (the file the script opens, by name; pressed, a file of the reader's
  own in its place, the script renamed to it; a file dropped on anything in the sound the same), `<audio-save>` (the
  file the script saves, by name; a script with no `save()`: the output as the part's `name` says, a WAV by default).
  Each holds a real `<button>` or `<input>`; its look is the page's font and ink, no ground, in the `audio` layer.
- `<audio-code>` in a sound: a file's name typed in `audio('…')` is completed from the sound's files, a plugin's
  parameters come from its engine, `⌘↵` plays, `⌘S` saves.
- How a part finds its sound: `closest('audio-sound')`, or `for="id"`. Not the context-request event section 4
  recommended: in the light DOM the nearest ancestor is the same rule with no protocol to keep. A part inside another
  component's shadow root would need the event; none is yet.
- One change to the editor's modules: `repl/code.js` exports `files(code)`, the names a script opens and saves with
  their places (what `prepare` reads, with positions), for the parts' labels before any run and for `open()`.
- Tests: `test/repl/audio-sound.test.js`, 8, against the library in Node: a script's length, the bytes of the WAV and
  the FLAC it saves. Demo: `elements/sound.html`.
- Weight, gzipped, read off the site's dev server: at rest the elements and what they import, 124 KB (the parser 46,
  `repl/code.js` 21, `ops.js` 14, `syntax.js` 12, `script.js` 10, `sound.js` 6, `code.js` 5.5); the first play, 371 KB
  more in 36 files, the workers' own included (the engine's worker and its chunks, the MP3 decoder 60, the deck's 66).
- In use: the site's home, four cases (audiojs.github.io `index.html` `#uses`). There the wax cylinder's `auto()` is
  ready 7.2 s after the first press, the engine cold (the command line: 2.8 s); the other three under a second. Each
  saved file is as large as the command line's for the same call.

Not built, in the order section 6 gives: the editor's own code pane as `<audio-code>` (step 2: the two share
`repl/script.js` today, not the element); the pictures (step 4: `repl/view/model.js` holds its state once a page);
before and after (`<audio-before>`: the editor's B plays the source at the edits' loudness and maps the time across
edits that change the length, `editor/play.js`; a part needs both); loop, history, level, the chain.

## 1c. Built: the pictures, and the embedded editor as a sound

22 Nov 2026, after the owner's "go on with the waveform" and "the code reflects what's there in the hero example, -
adding code ops adds them in the hero and vice-versa".

- `<audio-wave>`, `<audio-spectrogram>` (`elements/picture.js`, `wave.js`, `spectrogram.js`): parts of a sound that
  draw its output, a lane a channel, the place it plays on it, a press, a drag or the arrows to go there; a slider to a
  screen reader. Drawn by `gl-waveform` and `gl-spectrogram`, the renderers `repl/view.js` draws with, each loaded with
  the first sound. `<audio-sound>` gives them `output` (its samples, or a long sound's summaries as the engine feeds
  them).
- This is not section 4's "one view.js instance each". The view is 5350 lines in 13 modules with its state at module
  level (`view/model.js`), seven of them changed in the working tree by other sessions that day: making it an instance
  is a refactor of its own, to be planned with whoever holds those files. What the elements share with the view today
  is the renderers; what they lack is the view's: zoom, selection, the time row, the grid, notes, edits on the picture.
  When the view is an instance, these two elements become its faces and keep their names.
- `<audio-repl>` answers as a sound (`repl/embed.js`; the frame's side `repl/editor/host.js`, loaded by `editor.js`):
  `code` both ways with an `input` event, `playing`, `working`, `status`, `error`, `duration`, `time`, `opens`,
  `saves`, `toggle()`, `play()`, `pause()`, `save()`, `open(File)`. So the parts and a code block of the page act on the
  whole editor in its frame. The frame says its state by reading the page's own twenty times a second (nothing added to
  the editor's modules but one import), and asks for the samples' catalogue when its script opens a file of the site's,
  so a recording is said by its word and credited as one opened from the menu.
- A part's sound is now anything that answers as one (`part.js`), not `<audio-sound>` alone.
- Tests: `test/repl/audio-picture.test.js` (4: a tone of amplitude 0.5 from a quarter to three quarters of a lane; a
  1 kHz tone's row on a log and a linear axis; press, drag and keys; `lazy` and two lanes), `embed-sound.test.js` (1).
- In use: the site's home. Its opening's editor is the sound of the case under it; the case's code block and parts
  name it (`for`), and a few lines of the page keep the two scripts one.
- Not committed with the elements: `repl/embed.js`, `repl/editor/host.js`, the import in `repl/editor.js` and
  `embed-sound.test.js` stand in the working tree with the other sessions' uncommitted editor work, which `embed.js`
  already carries.

## 2. What the editor has that could stand alone

"Tied" means: imports `repl/editor/context.js` (the page's shared bindings) or `repl/editor/config.js` (which reads
`document.querySelector('#app')` and `location.search` when imported). Either makes a module one-per-page.

| Part | Modules | Editor state | Engine worker | iframe | Stands alone now |
|---|---|---|---|---|---|
| Code block | `script.js`, `syntax.js`, `ops.js` (completions), `hint.js` (optional) | no: a factory, callbacks | only `describe(name)` for a plugin's parameters in completions, optional | no | **yes**: `<audio-code>` |
| Waveform, spectrogram, notes | `view.js` over `view/` (one picture, lanes, each a kind: `KINDS` in `view/model.js`), drawn by `gl-waveform` 5.3 and `gl-spectrogram` 2.4 (the owner's published packages) | **yes**: `view/model.js` holds its state at module level, "view() is made once a page (editor.js is its one caller)"; styled by `editor.css` | its data: samples, peaks, notes come from runs (`editor/run.js` `v.set`) | no | no: needs instance state |
| Piano roll | `view/notes.js` (part of the view) | as the view | notes found by the worker (`worker.js`) | no | no |
| Transport, playback | `player.js` (a factory), `deck.js` (one AudioContext a page, the library's playback), `scrub.js` worklet; UI in `editor/play.js` | player no; its UI yes | voices from `engine.js` `voice` (the deck worker, `voices.js`) | no | player yes, its buttons no |
| Level meters | `meters.js` (pure), drawn by `view/overlay.js` and `editor/readouts.js` | drawing yes | output samples | no | the maths yes |
| The sound's menu | `editor/menus.js` `soundMenu` over `menu.js` (a menubar factory), `library.js` (catalogue), `samples.js`, `sources.js` | yes | opens files into runs | no | parts yes |
| The edit chain | `editor/chain.js`, `editor/menus.js` (Edit… list), `settings.js` (a factory given `ed`), `stack.js` (cards, a factory given `ed`), `code.js` (the script as a tree, edits to its text), `ops.js`, `help.js`, `recipes.js`, `kind.js` | chain and list yes; settings and stack take `ed` only | plugin manifests via `describe` | no | settings and stack nearly: they need a script editor, which `<audio-code>` is |
| Kind, key, tempo readouts | `editor/readouts.js`, `kind.js` | yes | listeners run in the worker | no | `kind.js` yes |
| Recording | `editor/recording.js`, `sources.js`, `keep.js` | yes | takes into runs | no | no |
| Theme | `theme.js` (VS Code theme to custom properties; `wear(tokens, el)` writes them on any element), `tint.js`, `skin.css` | no | no | no | yes |
| Hints | `hint.js` (a factory; its look in `editor.css` `.hint`) | no | no | no | nearly: needs its CSS |
| Mark | `logo/mark.js` | no | no | no | yes: the website uses it |
| Engine | `engine.js` (a factory, `engine(url)`; runs keyed by tab, so one worker can serve several sounds) | no | is it | no | yes |
| The whole editor embedded | `embed.js` `<audio-repl>` | its own | its own | **yes**: the editor page in a frame; `postMessage` for `edit`, `edits`, `open`, `sound`; `mark`, `progress` events | yes, whole only |

The obstacles, in order of size: the view's module-level state; `config.js` reading the page at import; `context.js`
shared bindings; styles living in one `editor.css` (32 KB gzipped) scoped to the app's markup.

## 3. Precedents, read today

- **Video.js 10** (`@videojs/html` 10.6.0 on npm, stable per its roadmap,
  https://videojs.org/docs/framework/html/guides/v10-roadmap.md). A `<video-player>` is "the state boundary": it "creates
  a store and broadcasts it to all descendants" (https://videojs.org/docs/framework/html/llms.txt). Controls find it by a
  context their host requests on connect; "the nearest ancestor player answers with its store. An element outside a
  player receives nothing" (https://videojs.org/docs/framework/html/reference/api/player-controller.md). The context is
  Lit's: `@videojs/element` 10.6.0 depends on `@lit/context` (npm registry). `UIElement` "renders into the light DOM ...
  It has no templates, shadow root, or static styles" (https://videojs.org/docs/framework/html/reference/api/ui-element.md).
  State shows as `data-*` attributes for CSS; "each visible part owns at most one element"; skins are packaged layouts
  of the same components (https://videojs.org/docs/framework/react/concepts/ui-components). Media is found by
  `querySelector` for a plain `<video>`/`<audio>`, or registers itself
  (https://videojs.org/docs/framework/html/guides/architecture.md). Element names: `media-play-button`,
  `media-time-slider`, `media-time`, `media-controls`... (llms.txt above).
- **Media Chrome** (4.19.5). One `<media-controller>`; controls nested in it send request events up the DOM, or sit
  anywhere and name it: `<media-play-button mediacontroller="my-ctrl">`. State goes down as attributes
  (`mediapaused`) on elements that observe them (https://www.media-chrome.org/docs/en/architecture). Shadow DOM: styled
  by custom properties (`--media-primary-color`), `::part()`, slots (https://www.media-chrome.org/docs/en/styling).
- **Vidstack** (1.15.7): its install page opens "Vidstack has a new home: Video.js 10"
  (https://vidstack.io/docs/player/getting-started/installation/web-components). Video.js's own docs: "Vidstack Player
  is in security-only maintenance" (llms.txt). Its ideas live on in Video.js 10.
- **wavesurfer.js** (8.1.0 on npm): a JS API, `WaveSurfer.create({ container, url, ... })`, rendered in a shadow root
  styled by `::part` (`cursor`, `region`); features are plugins (Regions, Timeline, Minimap, Envelope, Record,
  Spectrogram, Hover) given the instance and a scope torn down on destroy; state as read-only signals
  (https://wavesurfer.xyz/docs/).
- **peaks.js** (4.0.0): a JS API, `Peaks.init({ zoomview: { container }, overview: { container }, mediaElement })`:
  two views of one sound share one instance and one media element (https://github.com/bbc/peaks.js).
- **The context protocol**: `context-request`, a consumer's event with a key and a callback, answered by the nearest
  provider, optionally subscribed; status "Candidate"
  (https://github.com/webcomponents-cg/community-protocols/blob/main/proposals/context.md).
- **The owner's own**: `<audio-repl>` (whole editor, iframe, `<pre>` fallback, skeleton); `wavearea` (a waveform you
  edit like text, its state in one module per document: `/Users/div/projects/wavearea/architecture.md`).

What to take: Video.js 10's model whole (one state boundary, context, light DOM, `data-*` state, one element per part,
skins as layouts); Media Chrome's naming by id for controls outside the boundary; peaks.js's point that several views
share one sound; wavesurfer's plugin teardown scope.

## 4. The proposed set

| Element | Does | Made of |
|---|---|---|
| `<audio-sound>` | holds one sound: its script, its runs, its output, its playback, its history; the state boundary | `engine.js`, `player.js`, `code.js`, the editor's run loop (`editor/run.js`) |
| `<audio-code>` | the script, editable (built) | `script.js` |
| `<audio-wave>`, `<audio-spectrogram>`, `<audio-notes>` | the picture, one kind each; caret, selection, cues | one `view.js` instance each, its kind preset |
| `<audio-play>`, `<audio-time>`, `<audio-loop>`, `<audio-history>`, `<audio-before>`, `<audio-level>` | the bar's parts, a button or a readout each | `editor/play.js`, `editor/readouts.js`, `meters.js` |
| `<audio-chain>` | the edits made and Edit… (the embed's `edits: chain`) | `editor/chain.js`, `editor/menus.js`, `settings.js` |
| `<audio-edits>` | the edits as cards | `stack.js` |
| `<audio-repl>` | the whole editor; later a layout of the above | as now |

**Sharing one sound.** Rec: nesting, by the context protocol's `context-request` event (no library: the protocol is an
event and a callback); and `for="id"` for an element outside its sound, as `<label for>` and Media Chrome's
`mediacontroller` do. Nesting suits a scene where code and picture sit side by side under one wrapper (`<audio-sound>`
lays no box: `display: contents`). `for` suits a page whose layout parts them. A property (`el.sound = soundEl`) for
script. Not a global singleton: four cases on one page are four sounds. One engine worker for all of them, a tab each
(`engine.js` already keys runs by tab).

**Attributes, properties, events.** Rec: reuse the words the embed and the UI config already have (`repl/README.md`):
`display`, `controls`, `ops`, `background`, `grid`, `axis`, `zoom`, `units`. On `<audio-sound>`: `src` (a sound with
no script: `audio(src)`), `script` from a nested `<audio-code>`; properties `code`, `time`, `playing`, `duration`,
`selection`; methods `play()`, `pause()`, `edit(call)`, `edits()`, `open(file)`, the four `<audio-repl>` has today; events
`input` (script changed), `run` (an output in), `play`, `pause`, `timeupdate`, `mark`, `progress` (the embed's).

**Styling.** Rec: light DOM, as Video.js 10. Reasons found while building `<audio-code>`: CodeMirror puts its completions
in `document.body` (`script.js` `tooltips({ parent: document.body })`), whose styles must come from the page's cascade,
not a shadow root (CodeMirror mounts its theme in the editor's root: `@codemirror/view` `mountStyles`); the `<pre>`
fallback stays the page's own content. State as `data-*` attributes (`data-live`, `data-playing`). Theming by the skin's
custom properties, which `theme.js` already writes from any VS Code theme. No `::part` (a shadow-DOM feature).

**With no script.** `<audio-code>`: its `<pre>` (built). `<audio-sound>`: a native `<audio controls src>` inside it,
as Video.js keeps a `<video>`, so a page with no script still plays the file. Pictures: nothing, or a page's `<img>`.

**Accessibility.** `<audio-code>`: before CodeMirror a `role="textbox"`, `aria-readonly`, `aria-label="Script"`
(CodeMirror's own label in `script.js`), focusable; the focus ring the accent's. Buttons: a real `<button>` inside each
control element, not a custom element acting as one (Video.js hand-writes the ARIA button pattern; a native button
needs none). The picture: keys as the editor's view has them (`view/select.js`), a live line for what an edit did
(`editor/chain.js` already says moves aloud).

**Loading cost.** `<audio-code>`: 94 KB, then 112 KB on reach (measured). `<audio-sound>`: the engine worker entry
`repl/dist/worker.js` 21 KB gzipped plus the library's chunks on first run (not measured), the deck worker 25 KB,
`deck.js` 14.5 KB, `player.js` 5 KB, `engine.js` 6.8 KB. Pictures: `gl-waveform` 10 KB, `gl-spectrogram` 25.6 KB, the
view's modules 129 KB gzipped as source with their comments (a bundle would be smaller; not measured). Rec: each
element loads its heavy part on reach or in sight (`IntersectionObserver`, as `<audio-repl>` does), never on define.

## 5. Packaging

- Files: `elements/<name>.js`, one per element, importing the editor's modules from `repl/` (Rec). A demo page
  `elements/index.html`; tests `test/repl/<element>.test.js`, run by `npm run test:repl` as they are.
- URL: `https://audio.js.org/audio/elements/<name>.js`. `.site-build.js` needs nothing: `mirror()` copies every file not
  hidden and not in `node_modules`, and `bundles()` makes `assets/lezer.js` and `assets/codemirror.js` before it
  (checked: `mirror()` run into a scratch folder carries `elements/code.js` and `elements/index.html`). Later, for
  fewer requests, a bundle per element as `page()` makes the repl's.
- npm: Rec not yet. The `audio` package's `files` hold the library only (`package.json`), and CodeMirror and the
  parser are devDependencies built into gitignored `assets/`. When the elements settle: a package of their own, each
  element one bundled module with CodeMirror a chunk loaded on reach. Name to be chosen (section 9).
- `test/scope.js` needs the new suite in `FEATURES` (not done: another session has that file open; section 10).

## 6. The editor built from the same elements

Each step leaves the editor working and its suites green.

1. Done: `<audio-code>` over `script.js`; `script.js` exports its looks.
2. The code pane becomes `<audio-code>`. The element takes what `editor.js` passes to `script.js` today (`files`,
   `describe`, `hint`, `keys`, `wrap`, an `eager` mode) and exposes the `script.js` instance for `open`, `slide`,
   `settle`, `change`, `errors`. Gain: the embedded code pane shows coloured code before CodeMirror comes.
3. `config.js` stops reading `#app` and `location` at import; it takes them from the element the editor mounts in.
   That root becomes an `<audio-sound>`. Then `context.js`'s bindings move onto that instance, a module at a time,
   each still importing what it imports.
4. `view.js` becomes an instance: `view/model.js`'s module state into the instance; the view's rules out of `editor.css`
   into a stylesheet the element brings. Then `<audio-wave>`, `<audio-spectrogram>`, `<audio-notes>`.
5. The bar's parts and the chain as elements, out of `editor/play.js`, `editor/readouts.js`, `editor/chain.js`,
   `editor/menus.js`; `editor.css`'s rules for each move with it.
6. `<audio-repl>` gets a mode with no frame: its layout of the elements in the page. The frame stays for isolation.

## 7. Web components, or not

| Way | For | Against |
|---|---|---|
| The iframe embed (now) | isolation; the whole editor; done | each instance loads the editor page; no parts; one message channel |
| A JS API (wavesurfer, peaks.js) | any framework; simple | no HTML; nothing with no script; every page writes glue |
| React components | React pages | the editor and the site are not React (sprae); ties the SDK to one framework |
| A headless core with an adapter per framework (audio/ui) | every framework idiomatic | an adapter to keep per framework |
| Custom elements | any page, any framework (React 19 "adds full support for custom elements", https://react.dev/blog/2024/12/05/react-19); HTML with a fallback; Video.js and Media Chrome went this way | light DOM is open to a page's CSS; frameworks that re-render children may fight the nodes an element adds |

If it were mine: custom elements, light DOM, each the face of a plain-JS factory that stays importable on its own
(`script.js`, `view.js`, `player.js`, `engine.js`). That gives HTML, a JS API and the editor from one code. I would do
step 2 next, then `<audio-sound>` with `<audio-play>` and `<audio-time>` (a runnable code block with a play button, no
picture), and only then the view refactor, the largest.

Unsure: whether three picture tags or one `<audio-view display>` serves pages better (the editor's lanes switch kind in
place); how many WebGL pictures a page can hold (each picture one or two WebGL2 contexts; browsers drop the oldest past
a limit; not measured here); how React and others treat children an element adds (not tested).

## 8. audio/ui

audio/ui (audio-ui.dev, Cécé Lucien Loua, Ouest Labs, MIT, https://github.com/ouestlabs/audio-ui) is "Audio controls for
React: knobs, faders, meters, waveforms, timelines, sequencers and piano rolls, as headless primitives on npm or
shadcn/ui components" (its GitHub description); its engine runs @audio processors in an AudioWorklet (the site's in the
wild entry, `audiojs.github.io/about/index.html`). Its web adapter is DOM functions over `@ui-sdk/web`, not custom
elements (its registry file `waveform-web.json`), so no tag of ours collides with one of theirs.

The two are different layers. audio/ui gives controls to build instruments and DAW screens. These elements are the
audio library's own views of one sound made by a script: its code, picture, playback and edits, the editor in parts.
A page could use both: an audio/ui knob setting an edit's value through `<audio-sound>`'s `edit()`. Rec: never "ui" in
our names; credit and link them where the elements are documented.

## 9. Decisions for the owner

| Decision | Rec |
|---|---|
| Custom elements as the SDK | yes (section 7) |
| Prefix | `audio-`, as `<audio-repl>` |
| The sound's element | `<audio-sound>` (not `<audio-player>`: it edits too) |
| How parts find their sound | nesting by `context-request`, and `for="id"` |
| Shadow or light DOM | light |
| Pictures | three tags over one view instance (your words: separate components) |
| Folder and URL | `elements/`, `audio.js.org/audio/elements/<name>.js` |
| npm | later, a package of its own; its name yours (not "ui") |
| `<audio-code>` look | the editor's slab by default; pages set the skin's properties |
| `<audio-code>` value set | one undo step, no event (every edit from outside is a step in the editor) |
| `<audio-code>` event | `input` |
| `<audio-code>` CodeMirror on hover | yes (a reader who only reads loads none; a pointer passing over loads it) |
| Long lines in `<audio-code>` | wrap behind an attribute, once its rule moves into `script.js` (section 10); scrolled sideways till then, as a `<pre>` |
| The skin's names on `:root` | rename `--bar` and `--gutter` in `skin.css` (the website uses both names for other things; its own values win today, but a page that leaves them unset gets the editor's) |
| The home's four cases | `<audio-code>` in place of `<audio-repl panel="code">`: the website session's call |
| Next | step 2, then `<audio-sound>` with play and time |

## 10. Changes wanted in files another session has open

- Done, 21 Nov, on the owner's "ok go on with SDK": `test/scope.js` `FEATURES` has `'audio-code': ['elements/']` and
  `'audio-sound': ['elements/']`, so CI runs both suites when an element changes, and with every change to the repl's
  shared files, as each suite of the editor's.
- `repl/editor.css` line 1110, `.script-editor .cm-lineWrapping .cm-line { padding-left: calc(6px + 4ch); text-indent:
  -4ch; }`: move into `script.js` `LOOKS.slab` as `'.cm-lineWrapping .cm-line': { paddingLeft: 'calc(6px + 4ch)',
  textIndent: '-4ch' }`, so a wrapped line's hanging indent is the script editor's own and `<audio-code wrap>` gets it
  with no copy.
- `repl/embed.js` `dedent()`: export it, so `<audio-code>` reads text written inside it as the embed does (it reads a
  `<pre>` as written today).
- `repl/README.md`: a line under Embed pointing to `elements/` once the owner settles the names.
