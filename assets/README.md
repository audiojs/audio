# Website assets

The website is static. Serve the repository root with any static HTTP server and open
`index.html`. For example: `python3 -m http.server 8112 --bind 127.0.0.1`.

- `audio.js`, `wav.js`, and `mp3.js` are generated from this checkout and its installed encoders.
  Refresh them with `node .site-build.js` after changing the library.
- `mp3.js` includes its WASM payload and loads only on the first MP3 export.
  Encoder licenses are in `LICENSE-encode-mp3.txt` and `LICENSE-wasm-media-encoders.txt`.
- `sprae.js` is the standalone Sprae 13.9.4 ES module, `dist/sprae.js` from the npm package.
  Its MIT license is included as `LICENSE-sprae.txt`.
- `geist.woff2` is the Geist variable Latin font, with its OFL license included.
- `wavefont.woff2` is the variable Wavefont from the local Wavefont 3.6.0 project;
  its SIL Open Font License is included as `OFL-wavefont.txt`.
- The five samples are generated in `site.js`, each a familiar sound: chime (an airport chime pair, C4–E4–G4–C5 rising, a pause, then falling), bigben (the Westminster Quarters' last two changes on G♯4 F♯4 E4 B3, then the hour bell on E3, as church-bell partials: hum, prime, minor-third tierce, quint, nominal), musicbox (Für Elise, bars 1–8, on music box tines: a clamped bar's modes at 1, 6.27 and 17.55 times the note), phone (an old telephone's clapper between two gongs at 20 Hz, two rings) and waves (two waves breaking on a beach: filtered noise and foam bubbles). The new four sit at −23 LUFS (EBU R128), the chime at −24.2. No recording is fetched or uploaded.

The prototype uses browser decoding for uploaded files and the local `audio` engine for
edits and WAV/MP3 export. The displayed library examples also support the library's own codecs.
The demo limits files to 20 MB and two minutes; these are demo limits, not library limits.

The demo and the code example are black slabs with scanlines and a cast shadow: a tight band
just below the slab, then layers whose offset and blur roughly double into a long, faint tail.
Each sits on a rectangle of dot-grid paper, a clear band around it.
The demo holds the two waveforms, the readout, and the program with one edit step per line.
Both waveforms stay drawn in full, each with its caret; the active track's label and caret are white,
and the pointer over a track lights its label. Nothing fades. The readout holds the position with
the active track's level, and Undo and + at its right; Undo stays, dimmed while there is nothing to undo. The code example holds tabs with one sliding underline, the listing and a
link; its scrollbar has a transparent track.
Neither changes height on interaction; only editing the code can grow them. Every transient
state has a reserved slot:

- the readout shows one thing in a fixed-height slot: a chain error while typing, else the selected range on one line, start–end, its peak on the same baseline, else a status message, else the position with the active track's levels on one line; on narrow screens the levels wrap beneath the position;
- the code slab reserves the tallest example, so switching tabs keeps its height.

Nothing flickers while an edit renders: the previous waveform and level readings stay on screen
until the new ones arrive, and controls fade only when they are unavailable (no file, an empty
result, nothing to undo), never because a render is in flight.

Each Wavefont preview has its own play/pause icon. Bars are 2px on a 5px pitch and show linear
amplitude on one scale for both lanes (full height is 0 dBFS), so normalize and gain edits show
as height. Each track keeps a caret where it was left: the active track's is white, the other's
gray. A press on a track makes it the active one and moves its caret at once; dragging from there
selects.
Played bars are opaque and upcoming bars are half-transparent. Click to seek, or drag
to select a lit range with opaque white bars. Playback stays within the selection. Crop, from the + menu, adds the
selected range to the edit chain with times rounded to a thousandth of the track (milliseconds
for tracks of one to ten seconds), keeping at least one sample. With a range of the edit selected,
the add menu applies there: remove cuts the range out and closes the gap, and every other method
but pad takes the range as its last argument, `.gain(-6, { at: 1.9, duration: 1.6 })`. Escape, or
a click on a waveform, clears the selection.
A crop of the original goes first in the chain and a crop of the edit goes last; cropping again
updates that crop instead of adding another: the original's is replaced, the edit's narrows.
The original's selection crops only (remove is disabled); other methods then apply to the whole edit, appended to the chain.
A lone crop is both, so the second crop replaces it either way. Undo steps back one crop.
Arrow, Home, and End keys seek; hold Shift to select. Ctrl/Command+A selects all, and Escape clears.
Waveform cursors disappear while the processing editor or a parameter slider has focus.
The selection remains sample-based; the Wavefont glyphs summarize ranges of samples.

Beside the position, the readout shows the active track's sample peak, as DAW peak meters label
it (`−1.0 dBFS`), from the library's own `stat('db')` of the same samples; a new reading replaces the last one when it arrives, and `–`
means there is nothing to measure. A selected range shows its own peak the same way.

The demo shows the program as one piece of plain, editable code: `audio(chime)`, one edit per
line, and `.save('chime.wav')`; the import lives in the code examples below, which use the same
chain. `audio(…)` names its source: a built-in sample by name, or an opened file in quotes. A click
on the name lists the samples, then Open a file…; choosing a sample, or typing its name, switches
to it and keeps the edits. The name in `.save('…')` is the downloaded file and its extension picks
the format; a click on it lists the downloads, one per format, and choosing one writes its
extension and downloads. No buttons ride the code. Under the pointer, the names and numbers light up like a
selection. A textarea with transparent text lies over its highlighted copy, so the text stays the
one truth. Errors show in the readout, so they never shift the layout; a program with an error
does not download until it is fixed or Escape restores the applied one. Valid
edits apply after 180 ms without typing; the field stays usable while an earlier render
finishes, then the latest input is applied. Incomplete or invalid expressions preserve
the last valid preview. IME composition waits until compositionend.

Typing a dot opens method suggestions with icons. Typing filters the list; arrows choose an
item, and Enter, Tab, or a click inserts it. The caret anywhere in an existing call, its name
included, opens that call's options instead: a slider for each number, range included, and nothing
for a call without numbers. The adjusted number stays marked in the colors of selected text, and
the numbers after it move with its text. Slider inputs are coalesced over 50 ms; a drag is one
Undo step. Undo is the button in the readout, or
Ctrl/Command+Z in the editor. Escape first dismisses assistance (suggestions stay closed until
the text changes), then discards pending or invalid input. Enter otherwise inserts a newline.

Blank input preserves the original samples. The demo accepts sixteen methods with numeric
arguments: trim, pad, shrink, repeat, reverse, gain, normalize, fade, speed, stretch, pitch,
lowpass, highpass and eq, plus `crop({ at, duration })` and `remove({ at, duration })` in seconds.
Every method but pad also takes a trailing `{ at, duration }`, applying it to that range only; the
CLI examples write the range as `start..end`.
Whitespace, decimals, exponents and a semicolon after `.save(…)` are accepted; it does not
evaluate JavaScript expressions. Chains are limited to 64 calls / 4,096 characters of edits and
two minutes of intermediate output. Render errors and nonfinite
results disable edited playback and export until recovery.

The + beside Undo opens the add menu, which lists every method the demo accepts in two columns,
with its icon and description (on narrow screens the description moves to the tooltip); choosing
one appends its call with default arguments (over text not yet applied, to the last valid chain),
and Undo removes it. With a range of the edit selected, the menu opens with
"Apply to" and the range, and pad, which has no range, is disabled. Menus grow out of their trigger and
fade away; a menu starts at its trigger's left edge, or ends at its right edge when it would
overflow. Arrow keys, Home, and End navigate a menu; Escape returns focus. Menus stay in the
viewport and follow their controls on scroll.

Saving is the program's `.save('…')`; there are no Run, Reset or separate Download controls.
Code highlighting uses gray tones.
CLI examples spell out both fade durations and use decimal arguments, so CLI
shorthands and exponent parsing do not change the displayed JavaScript operations.
Keys and code tabs show a ring for keyboard focus; text buttons use an underline
or subtle background. The program has no focus decoration; its caret shows focus. Every code
example follows the export format.
Playing one preview pauses the other.
Playback remains available during export. Edit errors stay visible while previewing
the original, until an edit recovers the result.

Verified in Chromium: per-preview playback/pause and seeking, natural playback end,
live edits, completion, parameter sliders, undo, the add menu, code tabs, clipboard, WAV/MP3 export, invalid/oversized input,
reopening the same file, keyboard focus, reduced motion, and widths from 320 to 1920 px.
Pointer selection and cropping were also checked in WebKit, Firefox and iPhone touch emulation.
`bin/cli.js` keeps a range on the fade shorthand: `fade IN -OUT start..end` expands to two fades
that both keep the range (it was dropped before), covered in `test/cli.js`.
The full `npm run test:all` suite passes (14 browser cases skipped by the existing runner).

`npm run test:site` rebuilds the local audio bundles and runs the automated browser
regressions in `test/site.test.js`; it is also part of `test:all`. Direct cases cover:

| Case | Input and sequence | Invariant |
|---|---|---|
| Static bundle | Block non-local requests → load → export generated signal | Wavefont loads locally with valid, varying glyphs; finite, shorter, audible PCM |
| Reuse | Padded mono A → same A → shorter stereo B; export → undo all → retype the default chain each | Deterministic edits; original samples restored within 16-bit quantization; channel count follows the current file |
| Invalid/empty input | Cancel, zero bytes, invalid bytes, zero-frame WAV after a valid signal | Previous source and exported PCM remain unchanged |
| Minimum valid input | One-sample WAV → export → undo all → export | Finite output; original sample restored |
| Empty edit result | Silent WAV → trim chain → undo all | Edited playback/export disabled; original playable; recovered output contains the original number of silent samples |
| Render errors | Reject the next render during Undo, an add-menu edit, and typing → play original → retype the chain | Stale edited output disabled; original playback preserves the error; valid output restored on retry |
| New-source render error | Upload a different, 500 ms file while rejecting its first edit render → play original → retype the chain | Original waveform, duration, and playback use the new source; a new edit recovers edited output |
| Upload boundaries | 20 MB / 20 MB + 1 byte; 120 s / 120 s + one input frame | Correct side of each limit accepted; rejected input preserves current source |
| Playback race | Delay resume A → switch preview → start B → resolve B → resolve or reject A | Exactly one audio source starts; B continues; stale failure does not surface |
| Playback error | Reject resume → export → retry playback | Exported PCM unchanged; playback retry succeeds |
| Export error | Reject encode → retry export | Controls re-enabled; retry exports identical PCM |
| History lifecycle | Play → persisted pagehide → play again | A fresh context permits playback |
| `site: typed edits change PCM and all code examples; undo restores the chain` | Type chains with/without trim and normalize on a padded tone, and fade on a constant signal → export → Undo → retype defaults → clear all edits | Duration, peak level, and fade boundaries follow the chain; every code tab stays synchronized |
| Separate transport | Play original → play edited → pause → resume original → change trim → play edited → upload stereo file → play original | One source at a time; independent positions; duration/channel count follow edits and the current file |
| Seeking | End → play → seek halfway while playing → End → Home → ArrowRight → add reverse | Playback reuses one buffer at the chosen offset; boundaries and menu edits reset positions exactly |
| Pending playback | Delay resume → pause → resolve resume | No audio source starts |
| Natural end | Play a 100 ms original → finish → replay | Progress reaches the end; replay starts at zero |
| `site: original playback preserves the empty-edit error after a playback retry` | Silent 4,800-frame WAV → reject original playback resume → retry playback → undo all → export | Playback failure clears on retry; empty-edit explanation remains until recovery; recovered PCM has 4,800 silent samples |
| `site: a pending WAV export permits pause, seek and switching previews` | Play original → delay encode → pause → seek edited → play edited → finish encode | Playback controls remain usable; edits remain disabled; WAV download completes |
| `site: selection fill stays independent of the playback cursor and waveform opacity` | Seek → reverse-drag 75–25% → play → Escape while playing | Only the selection has a fill; played/upcoming opacity is 1/.5; clearing resumes through the full recording |
| `site: selected playback stops at its end; click seeks and clears the range` | 100 ms tone → select 20–80% → play to end → click halfway | Playback stops at the selected endpoint; click clears selection and seeks |
| `site: cropping original selection uses that timeline and undo restores PCM` and edited variant | One-second padded tone → undo all → add speed 1.25 → select last 75% → crop from the + menu → Undo | Original crop precedes speed, edited crop follows it; both yield the expected 28,800 samples within WAV quantization; Undo restores exact prior PCM |
| `site: Crop and Undo keep working across selections, and cropping again updates the crop in place` | Two-second tone → gain(0) → four select/Escape cycles on alternating tracks → crop the edit twice → crop the original twice → Undo twice | Escape empties the selection on every cycle; the edit keeps one trailing crop at 1 s for 0.5 s; the original keeps one leading crop, replaced even while the result is empty; each Undo restores the previous crop |
| `site: with a range of the edit selected, the add menu applies methods there, as the library does in Node` | Two-second tone → undo all → select 25–50% of the edit → add gain → Undo → select → add remove → Undo → open the menu without a selection → select on the original → add gain | The menu reads "Apply to" the range and disables pad; gain gets the range as its last argument and remove takes it, each equal to the library in Node; without a selection pad is enabled; the original's selection adds a whole-edit gain |
| `site: a crop chain with no overlap disables output and Undo restores the prior samples` | One-second padded tone → gain(0) → crop edited last half → crop original first quarter → Undo | Empty chain result disables edited playback, seeking, and export; message describes edits without blaming trim; original remains playable; Undo restores exact prior PCM |
| `site: selection cancellation restores the previous range and keyboard selection reaches boundaries` | Shift+End → drag → Escape → Escape → Ctrl+A → add reverse | Cancellation restores the prior range; clear and menu edits remove it; select-all reaches both boundaries |
| `site: interrupted pointer selection restores the prior range and releases capture` | Existing range → drag → pointercancel or release pointer capture | Prior selection restored and capture released for both interruptions |
| `site: sub-sample selection at the final boundary crops one sample` | One-sample WAV → undo all → End → Shift+Left → crop from a + menu | The sample survives within WAV quantization; no empty output |
| `site: a pointer selection lights its track, shows its range in the readout digits, and crops at readable precision` | Two-second tone → undo all → drag the original at fractional positions → crop from a + menu | The original becomes active; the range's two ends use the timecode's font; the crop has at most three decimals near the dragged times; output equals the library's crop in Node |
| `site: added processing composes in order, duplicates work, and removal is undoable` | Padded tone → two gains → Undo → reverse → remove → Undo | Gain multiplies amplitudes twice; reverse reverses samples; history restores exact PCM |
| `site: an empty live chain preserves samples and typing retains editor focus` | Padded tone → whitespace-only input → automatic render → export → Undo → 64 reversals → 4,096-character identity chain | Focus survives rendering; blank chain and accepted size boundaries preserve every sample; Undo restores preceding output |
| `site: typed numeric arguments and repeated A → A → B chains produce the expected stereo PCM` | Stereo tone → gains with decimal/exponent arguments → same gains in different notation → gain(0) + reverse → Undo | Sample count, channels, amplitudes and reversal match independently computed PCM; equivalent chains agree; Undo restores argument values |
| `site: incomplete and unsupported chains leave preview, examples and history unchanged` | Select a range → submit incomplete final call boundaries, null/nonfinite/arithmetic arguments, unknown/prototype methods, malformed crop objects, zero speed, 65 calls and 4,097 characters → Escape → Undo all → valid gain | Audio, selection, code and history are unchanged; the error takes the readout while the selection waits behind it; no JavaScript executes; correction recovers |
| `site: live typing preserves formatting and multiline input without Run or Reset controls` | Type gain → Enter → type reverse → invalid input → add gain → Undo | Newlines and spacing survive live rendering; a menu edit over an invalid draft builds on the last valid chain; Undo restores it |
| `site: changing a numeric argument updates the bars, level reading and PCM without submitting` | 4,800-frame tone → gain −3, −12, −6 with no submit keys | The tallest edited bar is round(100 · peak · 10^(dB/20)) while the original's stays at its own peak; the reading equals the library's; frame count stays fixed and every sample follows the gain |
| `site: edits typed during a delayed render keep the editor usable and the latest chain wins` | Delay gain −3 render → type −9 then −12 + reverse → release render | Textarea remains usable; final code and every output sample match the latest chain |
| `site: pending edits resume after menu and Undo renders outlast the debounce timer` | 4,800-frame tone → delay an add-menu or Undo render → type gain −12 + reverse → wait past debounce → release render | Pending state clears; each output sample matches the reversed source at gain −12 |
| `site: pending edits resume on the previous source after a delayed file decode fails` | 4,800-frame tone → delay replacement decode → type gain −9 → wait past debounce → reject decode | Previous filename and 4,800 source frames remain; pending state clears and every sample follows gain −9 |
| `site: IME composition delays rendering until the completed input` | Begin composition → type gain → IME Enter/Escape → wait past debounce → end composition | Zero renders during composition and one render on completion; draft remains intact |
| `site: method completion filters, wraps, accepts Tab or clicks, and ignores decimal dots` | Dot → arrows wrap → type sp → Tab → click reverse → decimal dot → Escape → late select event → type → replace an existing call → caret in its name | Sixteen icon options, prefix filtering, no scroll jump, selected parameter ready to adjust; Escape keeps suggestions closed until the text changes; no duplicate parentheses; a caret in an existing call's name opens its options, not a one-item list |
| `site: the caret in an existing call opens its options: a slider per number, each changing only its own` | `.fade(0.02, 0.1, { at: 1, duration: 2 })` and `.reverse()` → caret in the fade name → Start 1.25 → 0.5 → Duration 1.5 → caret in reverse | Four sliders for fade in, fade out, start and duration; nothing marked until a slider is used; each slider changes only its number, the later one tracking the shorter text; a call without numbers opens nothing |
| `site: a parameter slider updates only its number, renders during a drag and undoes the gesture once` | 4,800-frame tone → gain −6 → pointerdown → slider −8, −10, −12 → pointerup → export → Undo | Each step changes code and the marked value has the colors of selected text; gain −12 matches PCM; one Undo restores gain −6 and identical prior PCM |
| `site: editor focus hides waveform cursors and highlights code without a focus decoration` | Seek → focus editor → exponent/decimal code → blur → long chain → scroll textarea | Positions persist; cursors hide and return, both carets showing; no outline, shadow or background; the highlighted copy is the whole program; numeric tokens match whole literals; highlight scroll stays aligned |
| `site: the extension in .save('…') picks the format: a real MP3 lazily, WAV again preserves PCM, others are refused` | Half-second tone → save WAV → type .mp3 → download → decode → .wav again → rename → .ogg | Encoder fetched only for MP3; real MP3 signature, correct name/channel count, bounded duration and audible finite PCM; WAV again yields identical samples; a typed name downloads as typed; .ogg is refused in the readout and disables download |
| `site: typed crop accepts the final sample, zero work and reversed field order` | One-sample WAV → blank chain → crop with reordered fields and exponent duration → reverse speed → zero-duration/out-of-range crops → Undo | Finite sample survives valid operations; empty results disable export; Undo restores the sample |
| `site: excessive duration and nonfinite sample results disable output and recover with another chain` | Padded tone → speed(1e-9), gain(1e6), repeated gain(400); follow each with reverse | Oversized/nonfinite output never reaches playback/export; original stays playable; another chain restores finite PCM |
| `site: grayscale highlighting keeps literal code in every tab, and the underline follows the chosen tab` | Add gain → open Node, Browser, CLI, MCP | The underline's offset and width match the chosen tab; token colors are achromatic; literal markup stays text |
| `site: generated CLI preserves typed fade direction, zero durations and exponent arguments` | Nonzero 4,800-frame signal → positive/negative one-argument fades, zero endpoints, two-sided fades, tiny normalize/gain/fade/crop arguments, large gain/crop arguments, remove ranges, every added method, and ranged gain, fade, reverse and lowpass → execute each displayed CLI command → decode both WAV exports | The CLI and preview agree on sample rate, channel count, frame count and every sample within WAV quantization |
| `site: the add menu appends each method with its defaults, and Undo removes it` | Padded half-second tone → undo all → add gain → add reverse → Undo → add each method to a blank chain | Gain and reverse match the source independently; Undo restores prior PCM; the menu lists all sixteen methods in groups and each adds a valid call |
| `site: the add menu stays usable on an empty result, and Undo recovers the samples` | 4,800 zero samples → empty default result → add gain → Undo four times | The menu stays enabled; the result stays empty with its message; Undo restores all 4,800 zero samples |
| `site: menu edits stop playback, clear the selection, and recover after a render error` | Padded four-second tone → select and play (still playing) → reject the add-menu render → type reverse | Playback stops and selection clears; stale output is disabled; the typed chain restores the expected reversed PCM |
| `site: Open a file… and the keyboard open the file picker; cancel and same-file reuse preserve audio` | Open a file… from the sample list → cancel → again → open a 4,800-frame tone → open the same file with Space | Cancellation preserves PCM; the list item opens the picker and names the file in audio(…); keyboard reopening gives identical output |
| `site: the add menu supports keyboard boundaries, dismissal and focus return` | Open the add menu with ArrowDown → End → wrap down/up → Home → Escape → outside click; open with ArrowUp → Enter | Keyboard navigation reaches both ends and wraps; dismissal restores the trigger; Enter adds the last method, eq |
| `site: the readout shows the active track's levels, the library measuring the same PCM` | Stereo tone → default chain → seek original → seek edited → gain −6 → silent WAV → seek original | The reading equals `audio.from(pcm).stat('db')` computed in Node for the active track; normalize(−1) reads −1.0 dB; an edit replaces the reading without blanking it; an empty edit shows no reading and silence reads −∞ dB |
| `site: a slider drag keeps the waveform and controls steady until each render lands` | Fade-out slider 0.1 → 0.3 → 0.4 → 0.5 → 0.6 → 0.7, sampling every animation frame | Tracks, both Play buttons, .save('…'), Undo and the add menu never change opacity; the waveform is never blank; it has changed when the drag ends |
| `site: the demo shows the program: one editable chain from the opened file to the saved one, in its format` | Default chain → download MP3 → each code tab → open a file → drop audio(…) → drop .save(…) | The program is `audio(chime)`, the chain and `.save('chime.wav')`, then `.save('chime.mp3')`; the examples switch to MP3; an opened file names both ends; a missing end is refused |
| `site: the devices keep their height through chain errors, selection, playback errors, files, formats and tabs` | Invalid chain of the same lines → Escape → select a range → Escape → reject playback → open a long-named file → download MP3 from `.save('…')` → switch every code tab | Demo height is unchanged at each step; the error and the message replace the timecode; the code slab keeps its height across tabs |
| `site: both tracks stay drawn in full with their carets; a press activates its track and moves its caret at once` | Pointer away → hover the original → press at 30% → release | Both tracks, Play buttons and carets at full opacity; only the labels differ, and the pointer lights the original's label without animating; on the press, before release, the original is active with its caret at 30% |
| `site: a selected range shows its peak in dBFS, the library measuring the same samples` | Stereo tone → select 30–45% of the original → select 5–20% | The reading equals the library's `stat('db', { at, duration })` in Node; the silent stretch reads −∞ dBFS |
| `site: names and numbers light under the pointer; a name lists its choices: samples and a file, or downloads` | Hover a number and the sample name → click the sample name → bigben → click the save name → bigben.mp3 → the list again, Tab → type musicbox, drums, a file name → Open a file… | Lit tokens use the selection's gray; no buttons ride the program; the samples and the downloads list; bigben keeps the edits and names the download; a chosen format writes its extension and downloads, Tab leaves without one; typing a sample switches; an unknown sample and a quoted name over a sample are refused; Open a file… opens the picker |
| `site: every sample is generated sound: finite, silent at both edges, its length, and near -23 LUFS` | Each sample with no edits → download WAV → decode and measure in Node | Its length shows; every sample is finite; the first and last 0.3 s stay below −60 dBFS; integrated loudness (ITU-R BS.1770, the library's `stat('loudness')`) is within 1.5 LU of −23 LUFS |
| `site: Undo and + share the readout; + appends; a range reads start–end on one line, its peak on its baseline` | Read the readout's buttons → + → gain → select 25–50% of the edit at 1280, 390 and 320 px | Undo and + in that order, Undo staying through a selection; gain appends to the chain; the range reads start–end on one line within the slot, its peak on the same baseline down to 390 px |
| `site: the open add menu stays in the viewport after resize and follows its trigger on scroll` | Open the add menu at 1440×1000 → resize to 320×900 → scroll trigger to 250 px → scroll another 50 px → Escape | The menu stays inside 16 px viewport margins, keeps an 8 px gap from the button, follows the scroll by 50 px, and dismisses normally |

No codec parser or stream implementation changed. Chain parsing has bounded input and is debounced during typing.
Rendering is serialized; every busy operation resumes pending edits when it finishes, including failed file loads.
The latest draft wins. Waveform maxima are computed once per
edit/load. Wavefont strings use 512 cached bins and update only on edits or resize;
playback updates the progress mask without rescanning PCM or redrawing glyphs.
Each preview reuses its AudioBuffer for seeking and replay; new files and edits invalidate
the corresponding buffer.
Picker placement runs at most once per animation frame and reads geometry only for open
pickers; scrolling does not process audio or redraw waveform glyphs.
