# Stage 4 design: feature modules and one command list

Drafted 11-03 from editor.js and view.js as of 14d91e3 (read only), for the implementer; `.work/refactor.md` stage 4 holds
the checklist. Line numbers are of that commit.

**Approach.** New modules go in `playground/editor/` and `playground/view/`. `editor.js` stays as the boot module and
`view.js` as the view's interface, so index.html, stack.js's `SLOP` import and every test that routes those URLs keep
working.

Code moves verbatim, and reads never change text: every shared value is an ES live binding. The only text that changes is
a write to a binding another module owns, which becomes `assign({ x })`.

Feature modules only declare things (functions, consts, lets). Each top-level effect (a listener, `own()`, `menubar()`,
`agent()`, `drawMark()`, `requestAdapter`, `permissions.query`, observers) moves into that module's `wire()`. Boot calls
each `wire()` at the line where the effect sits today, so the order of effects stays the same.

## 1. Module maps

### editor.js → playground/editor/

A range means every top-level declaration in today's editor.js between those lines, with the comment above each. Every
module imports `context` and `config` (and `format`) as needed.

| Module | Purpose | Takes (lines) | Owns (`let`s) | Imports (features) |
|---|---|---|---|---|
| context.js (new) | shared bindings + `assign()` | the declarations in §2 | §2 | none |
| config.js | `root`, URL params, `UI`, constants, `stored` | 31, 37-56, 62, 64-176, 201-250 (with `SHUTTLE.at/span`), 272-278, 471 | none | none |
| format.js | numbers, words, `note` | 314-334, 1722, 1910, 2025, 2147, 3028-3039 | none | none |
| persist.js | storage, one editor at a time | 252-271 (`owning`→wire), 290-312 | full | tabs, menus, chat, files, recording |
| look.js | theme, looks, settings | 177-200, 660-698 (wear/message/webview→wire), 1034-1099, 1294-1311, 1833-1842, 1869-1909, 2042-2055, 2085-2102, 3183 | worn | persist, readouts, tracks, tabs |
| clipboard.js | copy, paste | 399-436 (storage listener→wire), 2334-2371 | none | edits, tabs, run |
| readouts.js | meters, readout, notes, chords, cues | 1805-1832, 1843-1868, 1914-2041 | peaked, readings, readMarks, levelMarks, hearings, listening, live | run, tracks, menus |
| writers.js | edit writers, markers, curves, resample | 2059-2075, 2701-2915 | pitchFrom | edits, run, tracks |
| edits.js | history, selection edits, `write`, `spread`, `flatten` | 2103-2158, 2372-2539, 2916-3020 | spreading | writers, tracks, run, tabs, clipboard, recording |
| tracks.js | lanes, mute and solo, layers, track ops | 1197-1267, 1659-1719, 1779-1784, 2540-2700 (`gpu`→wire) | gpu | edits, look, menus, run, tabs, files |
| recording.js | record, takes | 375 `recorder`, 378, 2076-2084, 3238-3507 (permissions, `holdInput`, pointerenter→wire) | recorder, placed, take, arming, unarm, allowed | play, run, tracks, edits, files, tabs |
| play.js | players, transport, shuttle, scrub, the logo mark | 364-370, 375 `ticker`/`original`, 440-470 (`logoMark`/`heard`→wire), 1786-1804, 2056-2058, 2159-2333 | ticker, original, scrubbed, swaying, resume, logoMark | run, readouts, recording, tabs |
| files.js | open, keep, samples, recipes, search, export, links, drop | 375 `previewAudio`, 377, 398, 3040-3158, 3184-3228, 3508-3592, 3977-3992, 4235-4256 (→wire), 623 `restoring`→wire | shelf, restoring, relink, asTrack, previewAudio, searches, searched, searchAbort | run, edits, tracks, tabs, persist, menus |
| run.js | evaluate, perform, show, arrival, settle, status | 340-360, 374, 375 `timer`/`checks`, 382-383, 1312-1658 (`eng.onrestart`→wire), 1720-1778 | arrivals, holding, timer, checks, sent, waiters, outcome, ticking, asked, began | play, readouts, tracks, tabs, recording, edits, clipboard, persist |
| tools.js | the agent's page API | 838-843, 3593-3828 | none | run, edits, tracks, look, play, files, tabs, chat |
| chat.js | bridge, conversations | 282-289, 3829-3976 (bridge, connect, setInterval, chatLog→wire) | picked, pickedModel, following, bridge | tools, tabs, persist |
| tabs.js | docs, strip, switch, close, reopen | 390-397, 3993-4234 (tabStrip observers→wire) | docs, docIds, closed, tabMoved | most |
| menus.js | menus, dropdowns, context menu, palette | 280, 877-1033 (`bar`→wire), 1100-1196 (listeners→wire), 1268→wire, 1272-1293, 3021-3027, 3159-3182, 3229-3237 | recent, bar, dropOwner, invoker | all |
| keys.js | page keys, focus, warm-up | 4257-4290 (→wire) | none | menus, play, edits, recording, files, tabs, writers |
| editor.js (boot) | start-up order | 33-34, 336-339, 473-659, 700-835, 846-875, 4291-4298 | local `state`, `eng`, `v` | all |

Expected sizes are about 40 to 470 lines; run.js is the largest.

### view.js → playground/view/

**Step zero (its own commit).** Lift the closure to module scope:
- Every closure `let`, pure `const` and function becomes module-level.
- Initializers that depend on the DOM or the options become `let`s assigned by `mount()`, in today's order, which keeps
  the DOM append order.
- `view(root, { onaxis = () => {}, … })` keeps its exact signature and passes every option and callback to `mount`,
  which assigns `export let onaxis, onselect, …` in model.js. Call sites stay `onselect(…)`.
- `view()` is called once per page (editor.js 701 is the only call). Write that invariant at the top of model.js.

| Module | Purpose | Takes (view.js lines) |
|---|---|---|
| view.js | signature, root listeners, the API object, re-exports of `KINDS NOTES noteOf stylize HOLD SLOP` | 137, 3960-3995 (except paste), 4030-4407 |
| view/model.js | constants, options and callbacks, DOM and GL, shared state, `mount()`, `assign()` | 63-135, 138-171, 439-442, 1884-1890, 2473 |
| view/data.js | sound in: put, renew, grown, replace | 179-273, 284-297, 3921-3958, 4004-4029 |
| view/geometry.js | lanes, bands, rooms, tracks, takes' places, frozen pieces | 337-582, 699-753 |
| view/scales.js | time and value to px, ticks, axis width, zoom, ranges | 583-682, 1711-1833, 2913-2993, 3839-3853 |
| view/render.js | resize, render loop, reel, waveform, spectrogram, weighting, snapshot, grid, colours | 274-283, 683-698, 754-1109, 2420-2527, 3901-3920 |
| view/overlay.js | overlay: scene, marks, grips, meters, keys | 1110-1682 |
| view/strips.js | measure, fades, looks, room, selection, cues, markers, names | 1834-1951, 2528-2784 |
| view/notes.js | pitch, notes, guides, gain and pitch lines, clipping | 1683-1710, 1952-2116, 2785-2912 |
| view/ruler.js | time row, follow, scrollbar, overview | 298 (`steer`), 2117-2419 |
| view/gestures.js | what a press starts | 3079-3301 |
| view/pointer.js | down, move, drags, hover, leave, up, clicks | 2994-3078, 3302-3688 |
| view/select.js | selection model, wheel, keys, paste | 3689-3838, 3854-3900, 3973-3978 (paste wiring) |

Each view module owns the lets declared in its range that are not listed under model.js in §2. Overlay is about 575 lines;
the rest are 160 to 540.

## 2. Shared state

The rule:
- A `let` lives in the one module that writes it, as `export let`, read live by importers.
- A `let` written by two or more modules goes into the context module and is written through `assign({...})`.
- Nothing moves onto the sprae `state`: it would deep-proxy outputs' Float32Arrays and make internal values reactive.

**editor/context.js**

| `let` | Written by today | Home |
|---|---|---|
| state, eng, v | boot only (473, 336, 701), never reassigned | boot keeps `const state = sprae(root, {`, `const eng = engine()` and `v = view(` as locals (test anchors) and calls `assign()` right after each; never swapped, so the two bindings never differ |
| ed, rk | boot 624/848; `spread()` swaps both (2984-2989) | context; boot must not keep locals for these, or the spread proxies stop reaching its callbacks |
| pl | boot 621; switchTab | context, line `let pl = null` kept verbatim |
| output, incoming, showing | settle, show, arrival, begin; switchTab and takeUp write `incoming` | context, line `let output = null, incoming = null, showing = 0` kept verbatim |
| hush | evaluate; toggleMute | context |
| steps, depthWas | remember; switchTab | context |
| rechoose | remember, write; boot oncaret 644 | context |
| viewing | boot onview 855; switchTab | context |
| shown, carded | showEdit; marks; boot oncall 854 | context |
| notesFor | notesShown; switchTab | context |
| queued | switchTab; boot onbusy 754 mutates it | context |

Declarations that tests patch must not take an `export` keyword: export them with a trailing `export { pl, output, … }`.

**view/model.js**

- Every `let` the API writes (69): count rate duration display units show segments markers arriving more dropped
  droppedNew meters recording empty asking pieces guest start end fview selection band playhead played speed guides nudge
  steered cues ranks envelope shift contour snapping fadeCurve cueKinds landed clips aview levelUnits gripMode pitching
  ruler grid levelStep look waveLook data tracks focus allLanes sections windows windowsOf leveled scroll heights kinds
  noted cruise cruised palette map ruled framed unframed shaded leavesOf.
- Lets written by two or more modules (13): hovered cursor anchor chosen pictures picked reached lift zoomed moving pull
  held ahead.
- Moving `resize` and `twinsFor` into render.js and the paste wiring into select.js keeps `W H dpr frame weighing twinsOf
  pasting` with one writer each (`frame ||=` runs on every `invalidate()`).

The API object stays whole in view.js: split, it would need composing with `Object.getOwnPropertyDescriptors` (a spread
copies getter values, not getters).

## 3. Cycles

- **Boot.** Nothing imports `editor.js`. While moves are in progress, a moved module may import a not-yet-moved function
  from `'../editor.js'` (add `export` there). That cycle runs through the entry module, which has top-level await (621):
  expected safe (no feature has top-level await or reads anything at evaluation), to verify on the first commit that does
  it. All such imports gone after commit 17: `grep -l "editor.js'" playground/editor` prints nothing.
- **Features.** run, tabs, play, recording, edits, tracks and menus import each other: safe because only hoisted functions
  and lazily called arrows cross the cycles. Module-level initializers may read leaves only (config, context, model,
  external modules). Hence into `wire()`: `bridge = agent({ tools: page })` (reads tools.js), `bar = menubar(…, menus)`
  (calls `menus()` at once), `restoring` (writes `shelf`).
- **View.** model.js is the leaf. The render↔overlay and pointer↔gestures↔select cycles carry functions only. No view
  module imports view.js.

## 4. Order, with a fast check per commit

Each commit also adds its modulepreload lines to index.html, and passes the static check: extend 'no object literal in the
page names a key twice' (test/playground.test.js, its `readdir` of `playground/` is not recursive) to read `playground/**`
and to fail on esbuild's `assign-to-import` warning, which reports every write to an imported binding.

Every test opens a fresh page and `afterEach` asserts no page errors, so a pattern subset runs on its own.

| # | Commit | `--test-name-pattern` |
|---|---|---|
| 1 | config.js | `preloads every module\|no object literal\|opens on the chime\|every setting comes back` |
| 2 | context.js; write sites become `assign()` while still in one file; retarget 5 tests (§6) | **full suite** |
| 3 | format.js | as #1 |
| 4 | persist.js | `every setting comes back\|second tab asks\|closed tab opens again\|kept across a reload` |
| 5 | look.js | `theme\|settings are a panel\|the display\|waveform coloured\|black-and-white\|level axis\|lanes bare` |
| 6 | clipboard.js | `copies\|copied\|paste` |
| 7 | readouts.js | `readout\|status bar\|level reads\|meters\|chord` |
| 8 | writers.js | `marker\|fade\|crossfade\|stretch\|gain line\|pitch\|louder\|silence\|square past` |
| 9 | edits.js | `undo\|Undo\|redo\|card\|step\|recipe\|deleting\|keeps only\|flattened` |
| 10 | tracks.js | `track\|layers over\|lane` |
| 11 | recording.js | `record\|take\|Record\|microphone` |
| 12 | play.js | `play\|Play\|playhead\|mark \|stopping settles\|loop\|scrub\|B plays` |
| 13 | files.js | `file\|export\|found sound\|search\|link\|kept`, then **full** |
| 14 | run.js | `output\|arriv\|error\|engine\|render\|newest script\|intro\|first visit` |
| 15 | tools.js, chat.js | `agent\|conversation` |
| 16 | tabs.js | `tab` |
| 17 | menus.js, keys.js | `menus\|menu works\|submenu\|context menu\|right-click\|palette\|keys\|Esc\|M puts\|Space\|⇧R`, then **full** |
| V1 | model.js (constants, `mount`) | as #1 plus `nothing is drawn behind\|page comes up once` |
| V2 | lift the closure, `assign()` rewrites, retarget the draw patch | **full** |
| V3–V13 | overlay → strips → notes → ruler → render → scales → geometry → gestures → pointer → select → data | overlay `held Alt\|handles\|meters\|measur`; strips `marker\|strip\|selection behind\|caret faint`; notes `notes lane\|note sung\|pitch\|clips`; ruler `overview\|scrollbar\|time row\|playhead\|followed`; render `spectrogram\|waveform\|weighted\|slab\|resizing`; scales `zoom\|pinch\|axis\|wheel`; geometry `lane\|track\|room under\|height`; gestures, pointer, select `caret\|drag\|press\|click\|Shift\|Alt\|⌘\|range\|cue`; data `arriv\|longer than the page\|decod\|output rendering`, then **full** |
| C1 | commands.js and the dispatcher | #17's pattern plus `agent`, then **full** |
| T | split the test file | **full** |

**The test split.** The helpers (lines 31-128) to `test/playground/page.js`, one `*.test.js` per feature group plus engine
and code; in scope.js each suite gets its feature modules, page.js and the fixtures in `on`.

## 5. One command list

**Where actions are written today:**
- Menus: `menus()` editor.js 877-1018, helpers 1019-1032, `lookMenu` 1095, `contextMenu` 1171-1196, `trackMenu` 1197-1207,
  `roomMenu` 1266, the palette's `quick()` 1283-1293, `takesMenu` 3503-3505.
- Keys: editor.js 4257-4264 (Esc) and 4267-4282 (B M K L R ⇧R ⌥R Space ⇧⌘T ⌘S ⌘O ⌘P/⌘K ⌘G ⇧⌘G); CodeMirror 649
  (Mod-Enter, Mod-s); view.js `key()` 3854-3899 (arrows, Home/End, = − 0, Esc, ⌘D ⌘A ⌫, and ⌘X ⌘C ⌘V ⌘Z ⇧⌘Z ⌘Y through
  `onedit`).
- Tooltips with keys: index.html 272, 335, 339, 341, 348-349, 380; the help list 473-512.
- Agent: `page` 3596-3751, `bridge` 3831-3840, tool definitions in bin/mcp.js 59-116.
- Mac menu bar: desktop/app.js 17-29 serializes `.menubar.menus()` (menu.js 276) and runs items by their menu path.

**Schema:**
```js
{ id, label, keys, when: s => bool, run, scope: 'page' | 'any' | 'view', checked?: s => bool, items?: s => [...], hint?, tip?, icon?, native? }
```
- `s` is one snapshot per menu opening or key press: `{ sel, band, whole, ranges, playing, recording, canUndo, canRedo,
  canPaste, track, … }`.
- `scope` keeps today's rules: `page` not while typing (today's check at 4268), `any` in fields too (⌘S ⌘O ⌘P), `view`
  only while the picture has focus.
- ⌘V is `native`: the browser's paste event carries the clipboard. The view keeps caret movement and paste.
- Menus become layouts of ids; state gets `tip(id)` (label plus keys) for tooltips; desktop/app.js sends `id`, not the path.
- The agent's `undo`, `redo`, `stop`, `play` and `tabs({ close })` use the command's `when` and `run`, keeping their own
  waits and errors; its other tools take arguments and stay in tools.js.

| Group | Commands (keys) |
|---|---|
| File | tab.new · file.open ⌘O · file.recent▸ · sound.find · sound.make▸ · export ⌘S · export.format▸ · export.parts · export.track · export.tracks · check▸ · link.copy · tab.close · tab.reopen ⇧⌘T |
| Edit | undo ⌘Z · redo ⇧⌘Z/⌘Y · history▸ · cut ⌘X · copy ⌘C · paste ⌘V · delete ⌫ · crop K · mark M · group ⌘G · ungroup ⇧⌘G |
| Select | select.all ⌘A · select.none Esc · select.fragment · select.sound · select.next ⌘D · caret.cue ⌥←/⌥→ · caret.sound ⌘←/⌘→ · caret.start Home · caret.end End |
| View | display.wave/spec/notes · look.wave▸ · look.spec▸ · grid▸ · show.hits/gain/guides · pitch.curve · snap · zoom.in = · zoom.out − · zoom.selection · zoom.all 0 · panel.toggle · panel.<side> · theme▸ · theme.open · units▸ · view.reset |
| Track | track.new · track.fromFile · track.move · track.voice · track.stems · track.lineUp▸ · track.match▸ · track.duck▸ · track.master · track.toTab · track.delete · track.rename · track.solo · track.lock |
| Process | recipes▸ · method.<op> (made from ops.js) · palette ⌘P/⌘K · context-only edits: declick, repair, denoise, quieter, louder, reverse, crossfade, normalize |
| Transport | play Space (and Mod-Enter in the code) · loop L · compare B · speed▸ · record R · record.track ⇧R · record.take ⌥R · takes▸ · take.delete |
| Help | help.keys · help.library · help.source |

## 6. Risks

1. **Tests that patch source text.** Anchors to keep verbatim in boot, indentation included: `v = view(` (19 tests),
   `const state = sprae(root, {`, `const eng = engine()`, `onheard: weighting => output`, `  onaudition(o) {`. In commit 2,
   five tests route to `**/playground/editor/context.js` instead: 4072, 10859 and 10905 patch `let output = null,
   incoming`; 4969 and 4994 patch `let pl = null` (10859, 10905, 4969, 4994 then need two routes each). In V2, test
   3946's view.js patch moves to view/render.js with the anchor `function draw() {\n` at column 0; render.js must import
   `pieces`, which the injected line reads. Stage 1 replaces some of these patches with a settled hook: land commit 2
   after it.
2. **Evaluation order.** Feature modules now evaluate before boot. Listeners on the same target and phase keep their
   order: window capture pointerdown (1161, 4286, 4288), document keydown (4257 capture, 4267), window blur (menubar's,
   then 4266). The theme's first `wear()` (666) runs after `await initialDocs()` today: keep it there with `look.wire()`.
3. **Undefined where there was a TDZ error.** `state`, `ed`, `v` read before set are `undefined`, not a ReferenceError;
   the existing guards (`v?.`, `if (!ed)`) behave the same; callbacks run synchronously inside `view()` see `undefined`,
   as today.
4. **Caching a swapped binding.** No module copies `ed`, `rk` or `pl` into a module-level const or a default parameter,
   or `spread()` and `switchTab` stop taking effect (stack.js received `ed` by value at 849 already; unchanged).
5. **Hoisting.** Imports bind before any code runs, and a moved const arrow is initialized earlier than today, never
   later. The one new hazard, a module-level initializer reading a cyclic peer, the leaf rule forbids.
6. **Name aliases.** Kept exactly: code.js's `steps as stepsOf` beside context's `steps`, and `mark as drawMark` beside
   format's `mark`; esbuild's "already declared" catches collisions when the view closure is lifted (none found).
7. **Preloads.** The modulepreload list equals the import graph after every commit, or the preload test fails.
8. **`this`.** Only in the sprae state literal's getters, which stay in boot; the view API uses none.
9. **View singleton and DOM order.** `mount()` creates elements in today's order: cut, reel, fades, canvases, row and
   marks, meters, scrollbar, overlay, runway, forkButton, lookButton.
10. **Key scope in the command list.** View's ⌘Z, ⌘X and ⌫ in the page dispatcher keep `scope: 'view'`, or they fire
    while the code editor has focus.
