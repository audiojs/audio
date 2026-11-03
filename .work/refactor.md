# Refactor: one library, one engine, small modules, tests on state

Approved 2026-11-02. Nothing else lands in `playground/`, `test/playground.test.js` or the library's root modules until this is done.
Owner: session audio-9e. Other sessions: finish what you have, report to audio-9e (don't commit), start nothing new here.

## Why

| Recurring problem | Sessions (2026) | Cause |
|---|---|---|
| Playhead or scroll stutter | 10-09, 10-10, 10-15, 10-17, 10-20, 11-02 | fixed by mechanism each time; nothing measures frame times under load |
| A non-audio action waits on a render | 10-03, 10-09, 10-12, 10-14, 10-18, 10-27, 10-28 | the render cache lives in the playground worker, added case by case |
| Unrelated parts regress | 10-11, 10-28, 10-30, 11-02 | agents read fragments of 4,000-line files; no visual baseline |
| Parallel sessions collide | 312763f, 10-05, 11-02 | many features in two files, one working tree |

## The library loads three times in the editor (measured 2026-11-02)

Chromium, `/playground/` on chime.wav, then Space (scratchpad `loads.mjs`):

| Realm | What loads | Library bytes |
|---|---|---|
| page | `assets/audio.js`, the whole library (core, plan, stats, cache, every `fn/*`, deck), committed, minified | 365 KB |
| page, on play | raw `worker.js` and `deck.js`: deck.js a second time on the same page | 66 KB |
| engine worker | `playground/dist/worker.js` + library chunk + plugin chunks | ~400 KB |
| deck worker (`engine.js` `decks()`) | the same engine bundle again, to play | ~400 KB |

The page uses the full bundle for `audio.context` (deck.js has it) and for `audio.from(samples)`, the fallback taken where
no worker voice opens (a test, or the deck worker failed: `player.js` `made()`). deck.js keeps `Symbol.for('audio.context')` and `Symbol.for('audio.deck')` on `globalThis` so
the copies agree. `playground/dist/chunks` holds 2,730 files, at most 1,129 referenced: the build never clears it.

## Stages

Each stage: its own commits, full suite green before and after (`npm run test:all`), merged before the next starts.
Work happens in a worktree (`../audio-refactor`, branch `refactor`), so master and the Mac app stay usable between stages.

### 0. Integrate the working tree

- [x] audio-2b reports its batch (11-02 18:00): no tests yet for the level readout near the centre line and for a snapped
      selection edge drawing no lit cue line; its suite run: 407 of 420, 'Denoise learns the noise…' and 'the spectrogram's
      frequency scale… snapping…' failing, 'recording with the spectrogram shown' timing out under load
- [x] audio-f1 holds its approved strip (named ranges, takes, selection, cues in each band's foot row) until stage 0 lands,
      then commits it itself; its report is in (zoom limits as UI config, handles on hover, cues at 10 and 50 ms ranked by
      plainness, Shift-extend, edge turn-over, level readout, takes drawn live, weighted twins swapped whole, muted dimmed)
- [ ] `assets/popoff.js` is popoff 3.1.0, committed in ~/projects/popoff (f167343) but not published: the user decides whether to publish
      before this repo commits a copy of it
- [x] `test/index.js` 'pages — a short sound decoded or pushed keeps no page it was gathered in': the fix holds 7 MB where the
      parent held 144 (the test's body alone, in place and in a copy); the whole file passes in place and fails at 80 MB in a copy
      outside the repo with node_modules linked: it measures the process's array buffers, so it goes to stage 1 below
- [x] the other sessions' uncommitted work identified, back to Oct 23 (restore), Oct 27–28 (tracks, takes, menus), Oct 29–Nov 2
      (themes, per-track views, notes, desktop, site move, cues, embed): ten sessions
- [x] the site move finished in the tree (user, 11-02: no site pages here): `site/`, `workshop/`, `CNAME` (Pages has no custom
      domain here: audio.js.org/audio/ is the org site's), `test/site.test.js` (all 118 tests needed the old landing page; not in CI)
      and `npm run test:site` removed; `assets/README.md` cut to the assets. The logo's lab moved to audiojs.github.io `lab/logo/`
      with its 9 tests (committed there, 811b790); `logo/*.js` stay here, the playground's bar and the site's home import them
- [ ] lost with the old landing page, for the user: the mark carried from the editor to the home (view transitions, `motion.js`
      `CARRY`): the playground half (`editor.css` view-transition names) remains; the new home doesn't take it up
- [ ] root `editor.html` and `playground.html` (old shared links, tested in `playground.test.js`) folded into one `404.html` in stage 2,
      when the test server answers misses as Pages does
- [x] full suite on the tree as it is; failures fixed or listed. Fixed: `restore` had no CLI help, README row or entry in the CLI
      test's list; the skill (the MCP tool's description) ran past 2,048 characters; a window blur left the look dropdown's owner
      expanded till a queued toggle event (`closeMenus` now closes it at once). Listed: playground 415 of 420 at load 30:
      'Denoise learns the noise…' (fixed in b9b8180; my diagnosis, also in 9b2cd3a's message, was wrong: the double-click
      was fine, the test pressed a place reckoned on the earlier sound's scale, which the 1.5× zoom-out limit moved into a burst),
      'recording with the spectrogram shown…' (fails at the parent too), 'the playhead runs on by the frames' own time…' and
      'a take recorded as the others play…' (pass alone); 'a sound longer than the page holds sounds under the caret…': the
      cues held the worker about 0.5 s on a 30-minute sound; b9b8180 makes them yield between passes, 2 of 3 since at load 30. The playback page of `test:browser` fails under load, as CI's advice-only suite does
- [x] committed in groups (b1c9507..a6b79b5): restore(); modulation, drift, center; write with d; core take errors and pages;
      hits; the playground (several sessions' work in shared files, one commit, each behavior named); the Mac app; the old home.
      Hunks of shared files staged by their line numbers (scratchpad hunks.py); each library commit run as a snapshot first
- [ ] for the user: `.work/stack-prototype.patch` (the `?layout=stack` prototype, rejected 10-29, kept on purpose) left
      untracked; the Delete on a named range now deletes its audio (764d91ca, 10-30), a change that asked for the user's call

### 1. Tests wait on state

- [ ] the page answers "settled" (no run pending, output drawn): the `ran()` the agent bridge awaits, exposed to tests
- [ ] the 294 `waitForTimeout`s in `test/playground.test.js` (120 s of sleeping per run) replaced by it or by `waitForFunction` on state;
      a sleep that stays says why in a comment
- [ ] tests stop rebuilding committed files (`playground.test.js` imports `.site-build.js`): build once before the browser suites
- [ ] 'engine: past what the page holds, an output comes as its peaks and spectra…' asserts the long output comes in more than
      one piece: a render quicker than the messages comes in one (alone: 4 of 4 failing at 9b2cd3a, 1 of 4 at 90c5458). Its
      sound through the test server's slow route (8 KB every 120 ms) makes the pieces certain
- [x] (this stage 3 run) `test/index.js` 'pages' measured in a process of its own: 7 MB steady, where it read 7 to 105 MB
- [ ] three guards for what was caught by eye:
  - [ ] no engine run for a non-audio action: mute, solo, rename, resize, view switch, tab switch, theme
  - [ ] followed playback with two tracks under 4× CPU throttle (CDP `Emulation.setCPUThrottlingRate`): frame-time p99 within budget
  - [ ] screenshots of the bar (time, length, status, undo/redo) at desktop, tablet and phone widths
- Done: suite green twice in a row; playground suite time recorded before and after

### 2. One library per realm, one build, one server

- [ ] page: `deck.js` and the `worker.js` facade only; `assets/audio.js` gone from the editor. A deck worker that fails falls back
      to the engine worker's voice, not to a library copy on the page; tests drive a worker
- [ ] deck worker: a lean entry (core, plan, the voice), not the engine bundle; or no deck worker at all, if the engine worker stays
      responsive during a model's pass (ONNX runtime on its own thread). Decided by measuring playback during a model pass
- [ ] the root cause at package level: the browser `"."` export (`dist/audio.js`) inlines `deck.js`, while `./worker` imports `./deck.js`
      raw, so any browser app using both runs two decks. `dist/audio.js` keeps `./deck.js` external (shipped beside it), or both
      entries come from one build
- [ ] `Symbol.for` globals that exist only to reconcile copies removed (`audio.context`, `audio.deck`; `audio.take` and `audio.worker`
      reviewed)
- [ ] jobs threads (`playground/jobs.js` → `parallel.js` → `core.js`) load core for nothing: `serve` moves to a core-free module
- [ ] dead import-map entry: `index.html` maps `@audio/tune-curve`, the library imports `@audio/tune/curve`; the map goes with the page bundle
- [ ] `npm run serve` builds and watches (esbuild context), clears its output first; a reload always runs the source as it is
- [ ] generated bundles out of git (`assets/audio.js`, `codemirror.js`, `lezer*.js`, copied `gl-*.js`), built by CI for Pages and by
      the Mac app's server on start
- [ ] one serving module (types, COOP/COEP) for `.site-serve.js`, `desktop/server.js` and the tests; `sw.js` reads the same headers
- [ ] `loads.mjs` becomes a test: each library module instantiated once per realm
- Done: page library bytes ~66 KB (from ~430 KB); `git status` clean after any build; an embed as the home's hero uses it
  (panel none, display wave, no code panel, no menubar) under 300 KB at first load, the user's target (11-02: 1,059 KB
  gzipped today, the mp3's 176 KB apart), codecs, renderers and converters as they're needed

### 3. The library owns engine concerns; duplicates removed

- [x] (7f1a50c..30988d1, merged after review; library suites 1,014, fixes, CLI, MCP, memory 28; the playground 425 of 428, its
      failures matched on master; press-to-sound on a long sound alike on both at load 60: 600 s 156–630 ms master, 458–656
      the branch; 1500 s 460–1117, 854–1128) store.js, one keyed store: OPFS in a page, memory elsewhere; a Web Lock per key, a sound
      opened from a file holding it shared till collected, writers taking it only if free; one size eviction skipping keys in
      use. checkpoint.js: keysOf (one serializer), recall, keep. The playground worker: −261 +72. keep.js stays the editor's
      (the user's original bytes, kept forever). Known, not new: a file is named by its name and size past a reload, so one
      replaced by another of the same name and size reuses what was kept
- [x] (done by the line above) one keyed store of channels (OPFS, one lock discipline) under `cache.js` pages, `audio.memo`, checkpoints and the playground's kept files.
      Today four writers: `cache.js`, `playground/keep.js`, `playground/worker.js` `disk()` and `shelf()`
- [x] (5672286, 5b85485) checkpoints in the library: a render kept by source and edits prefix, resumed from the longest kept prefix
      (now `playground/worker.js` "Renders kept": `keysOf`, `based`, `store`, `recall`), behind a host store like `audio.memo`.
      Node tests: a step toggled renders only after it; mute renders nothing; a kept prefix found again after a reload
- [ ] one summary of a sound for drawing: `stats.js` blocks and the worker's gl-waveform leaves are two pyramids of the same figures
- [ ] bugs the audit found by reading, each pinned by a failing test before its fix:
  - [x] (922d18a) the worker facade decides method kinds from a fixed list (`worker.js:145`): `await a.check('acx')`, `cuts`, `hits`, `notes`,
        `chords`, `key`, `spectrum` and the other promise methods resolve to the facade, the result dropped; the host already sends
        its registry (`worker.js:565`), unused
  - [x] (2263b84) a prepared op's stamp (`${a.version}:${a._.len}:…`, fifteen ops) left out `refVersion(a)`: an inserted sound
        edited later replayed a stale result (a codec's 0.475 → 0.475 where 0.05 was due); all key it by `stampOf(a)` now. The
        same in the `length` getter's cache, found beside it: an inserted sound cropped left the old length
  - [x] (4484f6e: fn/specs.js) `normalize('apple' | 'ebu')` throws (`fn/normalize.js:7`, `:316`) where `check('apple' | 'ebu')` works (`fn/check.js:113`)
  - [x] (bf72448) `trim` and `shrink` count blocks by `audio.BLOCK_SIZE`, `silence` by `stats.blockSize` (`fn/trim.js:52`, `fn/shrink.js:17`)
  - [x] (1792254, 6fafadc) the facade's playback had no `preservesPitch` and no paused clock: fixed by the session below; a seek
        made paused before the deck opened was lost locally (the facade kept it): fixed too
  - [x] (cc611f4: `held()` in batch.js) `toBatch` and `audio.use` feed one plugin different values: core clamps to [min, max] and resets a bad enum, batch doesn't
        (`core.js:545`, `batch.js:10-46`)
- [ ] duplicates inside the library (audit 11-02; the ones marked † checked against the code):
  - [x] (6995b46) the input an edit reads, written 18 times: `inputOf()` in `plan.js`; (2263b84) the stamp, `stampOf()`
  - [ ] the rest of prepare-once-then-play-by-offset (the arrived wait, the fingerprint key, the restamp): one `prepared()`
  - [ ] `{ at, duration }` → samples resolved by hand in ~30 places, `opRange` and `rangeOf` in two modules: one `span()` in core (~60)
  - [ ] the contract plugin host twice, `core.js:498-669` and `batch.js`: batch.js owns it (~35)
  - [x] (4484f6e) delivery targets in `normalize.js`, `check.js`, `audio.d.ts`, `cli.js`, `SKILL.md`: one table, fn/specs.js
        (mcp.js's prose names them as text)
  - [x] (f56da53) the CLI's own time grammar (`cli.js:78-91`) beside core's `parseTime`: one grammar, the CLI's unit gate kept
  - [ ] op help, completions, types and MCP lists kept by hand (`cli.js:153-235`, `:1100-1113`, `mcp.js:73-94`, and the test's own
        `expected` list in `test/cli.js` 'op help'): read from the registry, a test holding `audio.d.ts` to each op's `params`.
        Stage 0 met this drift twice: `restore()` landed with no CLI help, README row or `expected` entry, and three new ops pushed
        the skill (the MCP tool's description) past its 2,048 characters, so they were taken out of it
  - [x] (this run) the block-stat pass twice (`stats.js:26` copied to `meter.js:11`): `blockGroups()` in stats.js, the meter's
        deltas now carrying every field decode's stats do
  - [x] (944a193) peak and dB from block stats in five places: `peakOf()` in stats.js; the CLI's level as it plays read the highs
        alone (0.2 shown for a -0.8 peak)
  - [ ] the clipping recount after a gain, three times (`stats.js:327`, `fn/normalize.js:47`, `fn/gain.js:45`): one helper beside
        peakOf, once the store's branch has merged (it may touch stats.js)
  - [ ] structural ops known by name in `plan.js` `adjustLimit` (633-684): a `limit` hook on each op; splices on `spliceSegs`
  - [x] (6b67796) DSP primitives copied across `fn/*`: `fn/dsp.js` (i0, sinc, periodic Hann, pow2, downmix), the same doubles;
        the Kaiser factor left inline where folding it would reorder a product
  - [x] (739b1ce) shared helpers living in feature plugins: `fingerprint` to core, `playback` and `xfadeLen` to plan, the silence
        threshold to stats; importing `fn/align.js` alone no longer registers `vocals`. Left as domain reuse: pitch on stretch's
        shifter, derustle and auto on deepfilter's model run, analyses on spectrum's mel bands
  - [x] (1792254, 6fafadc) the playback session twice, `fn/play.js` and `worker.js`: one `playback()` in `deck.js`, each side an
        adapter of about 20 lines (58 lines fewer). Playback page A/B over 12 pairs at load 13 to 18: the same failures both sides
        (loop seams every run; clicks 3 of 14 on the branch, 2 of 13 on master); playground's 58 playback tests pass on it
  - [ ] not to merge (different on purpose): the deck worklet's own sinc and WSOLA (its source becomes the worklet), the
        interpolation kernels, periodic vs symmetric Hann, the crossfade laws, exact vs streaming loudness gating
- Done: `playground/worker.js` is the script runner and the page protocol only; full suite green; `docs/architecture.md` updated

### 4. Feature modules and one command list

- [ ] `playground/editor.js` (4,207 lines, 244 functions, 44 module-level `let`s) and `view.js` (one closure, line 137 to the end,
      18 callbacks) moved into feature modules of ≤ ~600 lines around one shared context (state, view, code, player, engine).
      A move first, no behavior change, a commit per feature, suite green after each
- [ ] one command list `{ id, label, keys, when, run }`: menus, context menu, shortcuts, tooltips, the Mac menu bar and the agent's
      tools read it. Today the same actions are written three times (`menus()`, two keydown handlers, the agent's `page` API)
- [ ] `test/playground.test.js` (848 KB, 407 tests) split the same way; `test/scope.js` picks by feature
- Done: each command defined once; no playground module past ~600 lines without a reason written at its top

### 5. The playground's architecture, written

- [ ] `playground/README.md` (now: embedding only) gains the realms, the data flow (code → model → run → output → view and player),
      what is cached where, and the invariants now spread through comments, each linked to its test
- [ ] the track grammar `code.js` infers, stated; side state kept by track name reconciled with the code on every change
- Written as each stage lands; finished last

## Draft feature boundaries (final map after stage 0, from the integrated files)

editor.js: theme · menus and dropdowns · run and output (evaluate, perform, show, arrival) · tracks (lanes, mute, solo, new, move,
voice and stems out) · edit writers (silence, stretch, trim, fade, level, pitch, curves, write, spread) · markers · recording and takes ·
clipboard · files and samples · search · export · agent and chat · tabs · keyboard

view.js: geometry (layout, lanes, rooms) · axes and scales · takes · freeze and tape · drawing (render, draw, waveform, spectrogram,
snapshot) · overlay (marks, grips, meters, keys) · pitch and notes · ruler, follow and overview · grid, selection, cues, markers ·
zoom · pointer gestures · selection model · keyboard · data

## Queued behind the refactor

Work sessions have asked for, held until the stage that frees its files lands (the user may override).

- audio-f1, playground (after stage 4):
  - [ ] a bug, its own: recording over other tracks, the head runs ahead of the live take by `lead`/rate (editor.js flush puts
        it at t.at + (got − t.pass)/rate while view.align draws the take `lead` earlier); the head should subtract `lead`
  - [x] (90c5458) Alt's level measure read from the waveform's peak at the pointer's time, a clamped line with the true value when the
        peak is out of the view
  - [ ] `.layer-new` shown only while the room is pointed at or holds the caret
  - [ ] more room between `.layer-name` and `.track-mute`
  - [x] (90c5458) the rename field without the accent outline, as wide as its text
  - [ ] the layer menu's Track section: mute and solo, lock, rename, delete
- audio-2b: its next work, on the split files (after stage 4)
- playground/player.js says the speed plays "as a tape's: the pitch with it"; preservesPitch is true by default on both
  sides now, as before on the local one: the comment is stale
- the audiojs.github.io session: an embed that loads only what its UI config uses (folded into stage 2); its host-side
  preview in playground/embed.js was let through after stage 0
- the audiojs.github.io session, for the home's embed (after stage 4, unless the user overrides):
  - [ ] the caret in an inactive tone while the picture isn't focused or the window is blurred, as `wash()` does the
        selection (`focused()`); the playhead bright while it plays
  - [ ] the spectrogram's top on `auto` fitted to the sound's content (its highest band above a floor, rounded up, never past
        Nyquist), a number for a fixed top, settable in the ui config
  - [x] (built by the audiojs.github.io session 11-03, its 2 tests passing; uncommitted till the user says) a third value of
        the Scroll setting, `hover`: the bar painted
        only while the pointer is over the picture, it is dragged, or the view moves, fading after; the ui config key `scroll`
        (`bar` the default, `hover`, `overview`) for an embed's start
