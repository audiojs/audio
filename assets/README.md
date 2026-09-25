# Website assets

The website is static. Serve the repository root with any static HTTP server and open
`index.html`. For example: `python3 -m http.server 8112 --bind 127.0.0.1`.

- `audio.js`, `wav.js`, `mp3.js`, `flac.js`, `aiff.js`, and `ogg.js` are generated from this checkout and its installed encoders.
  Refresh them with `node .site-build.js` after changing the library.
- Encoders load only when their format is exported. MP3 and Ogg include their WASM payloads; FLAC uses the bundled libflacjs encoder.
  Encoder licenses are in `LICENSE-encode-*.txt`, `LICENSE-libflacjs.txt`, and `LICENSE-wasm-media-encoders.txt`.
- `sprae.js` is the standalone Sprae 13.9.4 ES module, `dist/sprae.js` from the npm package.
  Its MIT license is included as `LICENSE-sprae.txt`.
- `geist.woff2` is the Geist variable Latin font, with its OFL license included.
- `wavefont.woff2` is the variable Wavefont from the local Wavefont 3.6.0 project;
  its SIL Open Font License is included as `OFL-wavefont.txt`.
- The five samples are generated in `site-samples.js`: a few seconds each of sparse, distinct strikes that read in the waveform, stereo at 44.1 kHz and about −16 LUFS. chime (an airport chime pair, C4–E4–G4–C5 rising, a pause, then falling, on vibraphone bars with their upper modes and a mallet's click), handpan (a slow phrase in D Kurd, each note tuned to its octave and twelfth with the steel's untuned modes above, the ding ringing along), birdsong (two phrases of gliding, warbling whistles between 1.9 and 2.9 kHz, each ending in a twitter falling from 7 kHz), rhodes (the Just the Two of Us chords, Dbmaj9, C7♭9♭13, Fm9, Ebm9, Ab13 and home to Dbmaj9, the voices stepping down and each long chord struck again after the second beat, on an FM electric piano with the suitcase's tremolo and a tape's wobble) and monitor (a patient monitor's beep near 1 kHz at 72 beats a minute). A Freeverb hall places each. No recording is fetched or uploaded.

The prototype uses browser decoding for uploaded files and the local `audio` engine for
edits and WAV, MP3, FLAC, AIFF, and Ogg Vorbis export. The displayed library examples also support the library's own codecs.
The demo limits files to 20 MB and two minutes; these are demo limits, not library limits.

The demo and the code example are black slabs with scanlines and a cast shadow: a tight band
just below the slab, then layers whose offset and blur roughly double into a long, faint tail.
The dot grid starts at the top edge. Header and footer rules meet its columns and rows;
both slabs start on dot rows with their sides on dot columns, and the footer follows changes in content height.
Text blocks sit on plain paper while the grid continues through the header and footer.
The demo holds two waveforms, the readout, and a wrapping chain of edit crumbs.
Both waveforms stay drawn in full, each with its caret; the active track's label and caret are white,
and the pointer over a track lights its label and caret. Nothing fades. The readout holds the position with
the active track's level at the cursor. Track headers show total duration only. Undo appears at the right edge only when history exists and also responds to Ctrl/Command+Z. Selecting a range replaces it with Crop and Remove on the time baseline; clearing the range restores Undo when available. The action area keeps a fixed width so the readout does not shift. The code example holds tabs with one sliding underline, the listing and a
link; its scrollbar has a transparent track.
Menus and playback do not change device height; adding, removing, or reordering edits can wrap the chain. Every transient
state has a reserved slot:

- the readout shows one thing in a fixed 60 px slot: the selected range on one line at up to 32 px, start–end, its peak on the same baseline, else recording status, else a status message or edit error, or the position with the level at the cursor on one line; time and level baselines stay fixed when selecting or clearing a range; on narrow screens both modes put the levels on the same second line;
- the code slab reserves the tallest example, so switching tabs keeps its height.

Nothing flickers while an edit renders: the previous waveform and level readings stay on screen
until the new ones arrive, and controls fade only when they are unavailable (no file or an empty
result), never because a render is in flight.

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
Crop and Remove on the original's selection apply at the start of the chain; on the edited waveform they apply at the end. Other methods selected on the original still apply to the whole edit, appended to the chain. Quick actions return focus to Undo, which remains available after an empty result or render failure.
A lone crop is both, so the second crop replaces it either way. Undo steps back one crop.
Arrow, Home, and End keys seek; hold Shift to select. Ctrl/Command+A selects all, and Escape clears.
Waveform carets stay visible while parameter sliders have focus, both paused and playing; changing fade-in or fade-out preserves their positions.
The selection remains sample-based; the Wavefont glyphs summarize ranges of samples.

Beside the position, the readout shows the local peak in the 10 ms window at the cursor in dBFS.
It follows seeking and playback; only that short window is scanned each frame. Silence reads −∞,
and an empty track reads `–`. Selected-range peaks come from the library's `stat('db')` over the corresponding samples. Track headers show duration only; they do not compute or display whole-track peaks.

The 12 px loop toggle beside the decibel reading repeats the full track or selected range. Original playback
uses native buffer looping; edited playback keeps scheduling the engine's live stream across
loop boundaries. Tiny loops repeat within a block to bound audio-node creation. Toggling loop
preserves the cursor; live parameter edits keep playback running. The square-ended loop icon shows only its current state: gray when off, light when on, with no hover color, press dimming, background fill, or color transition to compete with a click. Undo and + icons align to the same content edge as the durations; + is centered on the final crumb row.

The source control sits beside Original. Its menu starts with Open a file… and Record, followed by a divider and the five sounds.
The menu sizes to its content, constrained to the viewport, with hidden scrollbar chrome.
Choosing a sample keeps the edits; opening a file or finishing a recording starts from the default chain.
Record uses the browser microphone and MediaRecorder locally. The Original play control becomes Stop, and an analyser fills its waveform with 50 ms peak bins and a red caret. The visible span grows from five seconds up to the two-minute limit; only 2,400 peak bins are retained for this preview. Recording status replaces the time and level controls during capture.
Stopping or reaching two minutes releases the microphone and decodes the captured audio into the
original track. Denial, cancellation, empty capture, and recorder errors preserve the previous source;
page suspension releases the microphone, including permission requests that resolve afterwards.
The output pill shows `source-edited`; extensions appear in the save menu with WAV, MP3, FLAC,
AIFF, and Ogg choices. The pill carries a small download arrow; each menu choice carries a plain uppercase extension. Names stay stable when parameters or the export format change.
Both file pills use the same height, padding, font, and border as the edit pills. Resting pill
outlines use the same opaque `--color-screen-rule` token as the divider, unchanged on hover or opening. Resting fills use the solid `--color-screen` background color, masking the scanlines. The waveform and download icons have a 6 px gap before their labels, including the connected menu tab.
The desktop grid gives the widget at least 464 px, enough for the three default crumbs and + on one row; phones keep their available width and wrap. Only edits remain in the chain, with + pinned to the widget’s bottom-right corner. The final crumb reserves room for +, so it can never create a row of its own. Chevrons wrap with the preceding pill. Each crumb names the method
and its values. Clicking it opens a compact menu of sliders, with a 2 px gap below each label and 4 px vertical padding per parameter. Steps without parameters open no dropdown. During a drag, + becomes a trash target; hovering it hides the floating crumb so the target remains visible, and releasing removes that effect. Moving away restores the floating crumb. Delete or Backspace on a focused crumb also removes it. Trim exposes its threshold slider in dB and an Auto control restoring the API’s automatic threshold.

An open crumb stays flat and joins its dropdown through a matching tab. The tab and panel
share the selected pill's border and fill, with no dividing seam across their join. A dragged crumb
brightens and follows the pointer with a shadow. Dragging previews the order
with animated neighbor movement; releasing applies the chain once and creates one Undo step.
Escape, pointer cancellation, lost capture, blur, resize, page suspension, and an outside drop
cancel the preview. Alt+arrow keys also reorder. Boundary moves and
same-slot drops leave history untouched. Reduced motion skips the swap animation.
Page suspension cancels both crumb drags and waveform selections before closing audio playback.

Sliders coalesce changes over 50 ms, with one Undo step per gesture. Parameter changes keep
playback and its cursor running. The edited preview consumes the engine's `.stream()` on the
same instance; replacing its edit list lets the engine ramp changed values in the next blocks.
The browser schedules about 100 ms ahead on one audio clock. Waveforms and levels refresh
separately; Pause stays available during those renders. Empty or failed edits stop edited playback.
Ctrl/Command+Z works
anywhere in the demo. An empty chain preserves the original
samples. The sixteen methods are trim, pad, shrink, repeat, reverse, gain, normalize, fade,
speed, stretch, pitch, lowpass, highpass, eq, crop, and remove. Crop and remove take
`{ at, duration }` in seconds; every method but pad also accepts a trailing range.
Intermediate output is limited to two minutes. Render errors and nonfinite results disable
edited playback and export until an edit or Undo recovers them.

The + menu lists methods in two columns with icons and descriptions; on narrow screens
the descriptions move to tooltips. Choosing a method appends it with default arguments.
With a range of the edit selected, the menu shows "Apply to" and that range; pad is disabled.
The + menu joins its trigger through a matching tab, like the pill menus, and shows all methods without a scrollbar on ordinary screens. Its scrolling body is sized from the tab’s actual overlap. Short screens allow scrolling with the scrollbar hidden. Both menus stay inside the viewport when opened and follow scrolling.
Arrow keys, Home, and End navigate the lists; Escape restores focus to the trigger.

Code examples follow the chain and export format, using grayscale highlighting.
CLI examples spell out both fade durations and decimal arguments so their shorthand
matches the JavaScript operations. Controls and code tabs show a keyboard focus ring.
Playing one preview pauses the other.
Playback remains available during export. Edit errors stay visible while previewing
the original, until an edit recovers the result.

Verified in Chromium: per-preview playback/pause and seeking, natural playback end,
parameter sliders, crumb reordering, undo, the add menu, code tabs, clipboard, WAV/MP3 export, invalid/oversized input,
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
| Reuse | Padded mono A → same A → shorter stereo B; export → undo all → rebuild the default chain each | Deterministic edits; original samples restored within 16-bit quantization; channel count follows the current file |
| Invalid/empty input | Cancel, zero bytes, invalid bytes, zero-frame WAV after a valid signal | Previous source and exported PCM remain unchanged |
| Minimum valid input | One-sample WAV → export → undo all → export | Finite output; original sample restored |
| Empty edit result | Silent WAV → trim chain → undo all | Edited playback/export disabled; original playable; recovered output contains the original number of silent samples |
| Render errors | Reject the next render during Undo and an add-menu edit → play original → rebuild the chain | Stale edited output disabled; original playback preserves the error; valid output restored on retry |
| New-source render error | Upload a different, 500 ms file while rejecting its first edit render → play original → rebuild the chain | Original waveform, duration, and playback use the new source; a new edit recovers edited output |
| Upload boundaries | 20 MB / 20 MB + 1 byte; 120 s / 120 s + one input frame | Correct side of each limit accepted; rejected input preserves current source |
| Playback race | Delay resume A → switch preview → start B → resolve B → resolve or reject A | Exactly one audio source starts; B continues; stale failure does not surface |
| Playback error | Reject resume → export → retry playback | Exported PCM unchanged; playback retry succeeds |
| Export error | Reject encode → retry export | Controls re-enabled; retry exports identical PCM |
| History lifecycle | Play → persisted pagehide → play again | A fresh context permits playback |
| Separate transport | Play original → play edited → pause → resume original → change trim → play edited → upload stereo file → play original | One source at a time; independent positions; duration/channel count follow edits and the current file |
| Seeking | End → play → seek halfway while playing → End → Home → ArrowRight → add reverse | Edited playback starts a stream at the chosen offset; boundaries and menu edits reset positions exactly |
| Pending playback | Delay resume → pause → resolve resume | No audio source starts |
| Natural end | Stereo clips of 1, 1,025, and 48,000 frames → original and edited playback → finish → replay → seek EOF → replay | Progress reaches the end; each replay starts at sample zero; edited blocks retain the exact frame count and amplitude |
| `site: original playback preserves the empty-edit error after a playback retry` | Silent 4,800-frame WAV → reject original playback resume → retry playback → undo all → export | Playback failure clears on retry; empty-edit explanation remains until recovery; recovered PCM has 4,800 silent samples |
| `site: a pending WAV export permits pause, seek and switching previews` | Play original → delay encode → pause → seek edited → play edited → finish encode | Playback controls remain usable; edits remain disabled; WAV download completes |
| `site: selection fill stays independent of the playback cursor and waveform opacity` | Seek → reverse-drag 75–25% → play → Escape while playing | Only the selection has a fill; played/upcoming opacity is 1/.5; clearing resumes through the full recording |
| `site: selected playback stops at its end; click seeks and clears the range` | 100 ms tone → select 20–80% → play to end → click halfway | Playback stops at the selected endpoint; click clears selection and seeks |
| `site: Crop and Undo keep working across selections, and cropping again updates the crop in place` | Two-second tone → gain(0) → four select/Escape cycles on alternating tracks → crop the edit twice → crop the original twice → Undo twice | Escape empties the selection on every cycle; the edit keeps one trailing crop at 1 s for 0.5 s; the original keeps one leading crop, replaced even while the result is empty; each Undo restores the previous crop |
| `site: with a range of the edit selected, the add menu applies methods there, as the library does in Node` | Two-second tone → undo all → select 25–50% of the edit → add gain → Undo → select → add remove → Undo → open the menu without a selection → select on the original → add gain | The menu reads "Apply to" the range and disables pad; gain gets the range as its last argument and remove takes it, each equal to the library in Node; without a selection pad is enabled; the original's selection adds a whole-edit gain |
| `site: a crop chain with no overlap disables output and Undo restores the prior samples` | One-second padded tone → gain(0) → crop edited last half → crop original first quarter → Undo | Empty chain result disables edited playback, seeking, and export; message describes edits without blaming trim; original remains playable; Undo restores exact prior PCM |
| `site: selection cancellation restores the previous range and keyboard selection reaches boundaries` | Shift+End → drag → Escape → Escape → Ctrl+A → add reverse | Cancellation restores the prior range; clear and menu edits remove it; select-all reaches both boundaries |
| `site: interrupted pointer selection restores the prior range and releases capture` | Original range 25–100% → drag 40–60% → pointercancel, release capture, or persisted pagehide | Prior selection restored and capture released for all three interruptions |
| `site: sub-sample selection at the final boundary crops one sample` | One-sample WAV → undo all → End → Shift+Left → crop from a + menu | The sample survives within WAV quantization; no empty output |
| `site: a pointer selection lights its track, shows its range in the readout digits, and crops at readable precision` | Two-second tone → undo all → drag the original at fractional positions → crop from a + menu | The original becomes active; the range's two ends use the timecode's font; the crop has at most three decimals near the dragged times; output equals the library's crop in Node |
| `site: added processing composes in order, duplicates work, and removal is undoable` | Padded tone → two gains → Undo → reverse → remove → Undo | Gain multiplies amplitudes twice; reverse reverses samples; history restores exact PCM |
| `site: grayscale highlighting keeps literal code in every tab, and the underline follows the chosen tab` | Add gain → open Node, Browser, CLI, MCP | The underline's offset and width match the chosen tab; token colors are achromatic; literal markup stays text |
| `site: the add menu appends each method with its defaults, and Undo removes it` | Padded half-second tone → undo all → add gain → add reverse → Undo → add each method to a blank chain | Gain and reverse match the source independently; Undo restores prior PCM; the menu lists all sixteen methods in groups and each adds a valid call |
| `site: menu edits stop playback, clear the selection, and recover after a render error` | Padded four-second tone → select and play (still playing) → reject the add-menu render → rebuild with reverse | Playback stops and selection clears; stale output is disabled; the new chain restores the expected reversed PCM |
| `site: Open a file… and the keyboard open the file picker; cancel and same-file reuse preserve audio` | Open a file… from the sample list → cancel → again → open a 4,800-frame tone → open the same file with Space | Cancellation preserves PCM; the list item opens the picker and names the file in audio(…); keyboard reopening gives identical output |
| `site: the add menu supports keyboard boundaries, dismissal and focus return` | Open the add menu with ArrowDown → End → wrap down/up → Home → Escape → outside click; open with ArrowUp → Enter | Keyboard navigation reaches both ends and wraps; dismissal restores the trigger; Enter adds the last method, eq |
| `site: a slider drag keeps the waveform and controls steady until each render lands` | Fade-out slider 0.1 → 0.3 → 0.4 → 0.5 → 0.6 → 0.7, sampling every animation frame | Tracks, both Play buttons, the edit crumb, Undo and the add menu never change opacity; the waveform is never blank; it has changed when the drag ends |
| `site: both tracks stay drawn in full with their carets; a press activates its track and moves its caret at once` | Pointer away → hover the original → press at 30% → release | Both tracks, Play buttons and carets at full opacity; only the labels differ, and the pointer lights the original's caret without animating; on the press, before release, the original is active with its caret at 30% |
| `site: a selected range shows its peak in dBFS, the library measuring the same samples` | Stereo tone → select 30–45% of the original → select 5–20% | The reading equals the library's `stat('db', { at, duration })` in Node; the silent stretch reads −∞ dBFS |
| `site: every sample is generated sound: stereo, finite, silent at both edges, its length, and near -16 LUFS` | Make each sample twice in Node → each sample with no edits → download WAV → decode and measure in Node | Both makes are identical; the length site-samples.js makes shows; both channels are finite, their first and last 0.3 s below −60 dBFS; integrated loudness (ITU-R BS.1770, the library's `stat('loudness')`) is within 1.5 LU of −16 LUFS |
| `site: a length reads its tenths exactly: 441,600 frames at 48 kHz show 0:09.2, a millisecond less 0:09.1` | Open 441,600 frames at 48 kHz → open 441,552 frames | 441,600 / 48,000 falls just below 9.2 in floating point, yet reads 0:09.2; 9.199 s reads 0:09.1, tenths flooring at the millisecond |
| `site: the open add menu stays in the viewport after resize and follows its trigger on scroll` | Open the add menu at 1440×1000 → resize to 320×900 → scroll trigger to 250 px → scroll another 50 px → scroll trigger above the viewport → Escape | The menu opens inside 16 px margins, keeps its tab over the trigger, allows the trigger to scroll offscreen without pulling the page back, and dismisses normally |
| `site: dragging a crumb previews an animated swap, commits audio once, and Undo restores it` | 4,800-frame tone → gain −6 then normalize −1 → drag gain after normalize → release → Undo | Drag preview leaves audio untouched; committed PCM is 6 dB quieter; one Undo restores the prior chain and PCM |
| `site: interrupted crumb drags restore the chain without an Undo entry` | Default three edits → drag first to last → Escape, pointercancel, lost capture, blur, resize, pagehide, or outside release | Original order restored, floating crumb removed, inline order cleared, and Undo remains disabled |
| `site: keyboard arrows reorder duplicate methods, respect boundaries, and preserve focus` | gain −6, gain −12, reverse → Alt+Left at first → Alt+Right twice → right boundary → Alt+Left | Boundary is a no-op; duplicate methods retain their own values; focus follows the moved edit |
| `site: touch reorders wrapped crumbs and reduced motion skips swap animation` | 320 px viewport, reduced motion → real touch from first to last wrapped crumb | Correct committed order, visible +, and zero swap animations |
| `site: an empty chain accepts a first edit; single-crumb boundary moves and same-slot drops add no Undo step` | 4,800-frame tone, empty chain → add reverse → boundary keys → same-slot drag → Undo | Boundary keys leave a single crumb in place; one Undo returns to empty edits and identical original PCM |
| `site: a pending reorder rejects another drag; a render failure disables stale output and Undo restores PCM` | gain −6 then normalize −1 → reorder while delaying read → second drag → reject read → Undo | No second drag starts; stale output disabled; original stays playable; Undo restores the exact prior PCM |
| `site: rules and players meet the dot grid; matching file pills fit beside their tracks` | Long filename → resize through 320, 375, 414, 768, 1024, 1440, 1920 px; change normalize to −3 dB at 375 px | Rules and slab origins align to dot columns/rows; code updates preserve alignment; file pills match edit pill dimensions and style, no horizontal overflow |
| `site: selection actions replace Undo on the baseline without shifting the readout` | + gain → select 25–50% → clear at 320–1440 px → click Undo | Both measured text baselines and widget height remain unchanged; range fits at up to 32 px; Loop is 12 px; the selection icons meet the time baseline; Undo hides when empty and restores the default chain |
| `site: an open crumb can be dragged through its connected menu tab` | Open trim → drag through its tab to the last slot → release → Ctrl/Command+Z | Connected tab passes pointer input to its crumb; drop closes the menu and commits once; one Undo restores the default chain |
| `site: Add shows all methods without a scrollbar; a short viewport still reaches the last method` | Open Add at 1440×1000, 320×900, 320×350 → End → Escape | Sixteen methods, no visible scrollbar, no overflow on normal screens; short-screen menu stays in bounds and scrolls the last focused method into view |
| `site: live filter sliders change streamed samples without restarting playback or the cursor` | Six-second 6 kHz tone → lowpass 10 kHz → play → drag cutoff to 500 Hz and back | One iterator, no stopped audio nodes, scheduled blocks meet exactly, RMS changes with cutoff, cursor advances and stays visible |
| `site: original playback and pause remain available during a delayed parameter render` and its edited counterpart | Four-second constant signal → gain 0 → play → delay waveform read → gain −12 → pause → finish read | Transport advances during the delay; edited stream already emits the new gain; pause stops the producer; exported PCM has the expected gain |
| `site: streaming handles a one-sample A, replay A, and a different stereo B` | One-sample mono .25 → play twice → three-sample stereo B → play | Exact block lengths and RMS, correct channels, clean natural ends and reuse |
| `site: a live duration change reaches its new end; removing all samples stops output` | Four-second constant signal → crop 4 s → play → crop 1 s → select 20–80% → replay → crop 0 s | Same stream reaches the new boundary exactly; zero samples clears the obsolete selection, disables output and cancels queued blocks |
| `site: a playing selection keeps its time boundaries when a live parameter changes track length` | Four-second constant signal → pad 0 → select 1–2 s → play → add 2 s after | Selection stays at the same times, one iterator emits exactly that duration and stops at its endpoint |
| `site: stale stream resolve cannot interrupt a switch to the original` and reject counterpart | Delay the edited stream's first block → play Original → resolve/reject old stream | No edited blocks scheduled and original playback survives without an error |
| `site: a live render failure stops queued edited audio and a new parameter value recovers` | Three-second constant signal → gain 0 → play → reject read on gain −6 → gain −12 → play | Old queued audio stops; stale export disabled; recovery streams the correct gain |
| `site: a stream failure cancels queued blocks and playback can retry` | Play → throw at block four → retry | Producer and queued blocks stop on failure; a fresh stream plays successfully |

The engine's live parameter patch also updates range start, duration and channel; its direct
regression `mid-stream parameter patches update range, zero duration and channel through the final sample`
in `test/fix-plan.js` checks exact stereo samples across moved, empty and negative ranges through
a one-sample final block. `stream boundaries: zero work, EOF, final sample and replay around one block`
uses 1, 1023, 1024 and 1025 frames: request zero duration, request at EOF, read the final sample,
then stream twice, checking exact gained samples and identical replay. No codec parser changed.
Rendering stays serialized; pending slider
values apply after an in-flight render or file load finishes. Drag movement changes transforms
and visual order, not audio. Geometry work is linear in the number of visible crumbs, and
neighbor animations start only when the proposed order changes. A committed drop uses the
existing render/history path. Waveform maxima are computed once per edit/load; Wavefont
strings use 512 cached bins and update only on edits or resize. Playback changes the progress mask and scans only a 10 ms PCM window for its local level. The original reuses its AudioBuffer for seeking and replay;
the edited preview queues bounded stream blocks, cancelling them on pause, seek, or source changes.
Menu placement runs at most once
per animation frame and reads geometry only for open menus.

Additional player regressions:

| Test | Input and operations | Evidence |
| --- | --- | --- |
| `cursor level follows local samples; track headers show duration without peak levels` | Mono levels with silent, .1, and .5 regions → seek both tracks including EOF → gain −6 → play → silent file | Local readings −∞/−20/−6, gain and playback update the meter; headers contain no dBFS summary; empty edit reads `–` |
| `original/edited loops a selected range and stops at its end when toggled off` | .6 s constant signal → select 25–75% → loop for 1 s → edited gain −6 → loop off | Cursor stays in range, edited blocks meet without gaps, gain reaches live samples, playback stops at the selection end |
| `a one-sample edited loop batches repetitions and pause cancels its producer` | One sample .25 → no edits → loop → pause → replay A → stereo B | 1024-frame blocks retain exact amplitude, node count stays bounded, no production after pause, replay and stereo replacement use the new samples |
| `trim exposes automatic and explicit thresholds, including silence and both slider boundaries` | Quiet edges and louder center → thresholds −80, −30, 0 → Auto → Undo | Exported PCM matches API trim, 0 dB removes all samples, Auto restores output and Undo restores the explicit threshold |
| `source menu fits its content and trailing chevrons stay on the preceding wrapped line` | Open at 1440, 375, 320 px → inspect chain | Menu has no horizontal or vertical content overflow beyond pixel rounding and no scrollbar chrome; chevrons remain beside the preceding pill |
| `FLAC, AIFF and Ogg export real stereo audio and load codecs only on demand` | Stereo 220/550 Hz → no edits → export each format | Correct file signatures, filenames, channel count and duration; decoded PCM within quantization/lossy tolerance; no codec fetched before its export |
| `Record captures a local microphone twice, releases tracks, and loads playable exportable samples` | Synthetic MediaStream → native MediaRecorder → stop → export/play → repeat with the two-minute timer callback | Finite audible PCM, released microphone tracks, fresh default chain and extension-free edited name |
| `denied, missing and cancelled microphone requests preserve the source and release late tracks` | Deny permission → unavailable input → cancel before permission resolves | Prior PCM unchanged; late stream tracks stopped |
| `an empty recording and recorder errors recover; pagehide releases an active microphone` | Empty fake recorder → recorder error → record and pagehide | Clear error states, preserved source, stopped microphone tracks each time |
| `scoped trim keeps its range when switching between Auto and explicit thresholds` | Quiet edges and loud center → selected trim → change Start → threshold −30 → Auto → Duration .5 | Range fields keep their argument positions and exported PCM matches the API before and after Auto |
| `pagehide ignores a recording whose decode finishes after suspension` | Record → delay decoding → stop → pagehide → finish old decode | Busy clears, tracks are released, stale capture cannot replace the original |
| `stale recording callbacks cannot stop a newer take` | Record A → pagehide → record B → fire A’s saved error and limit callbacks → fire B’s error | A’s callbacks leave B recording with live tracks and no error; B’s own error stops its tracks and reports failure |
| `utility icons share the content edge and loop colors stay stable through clicks and hover` | Resize 1440/375/320 → hover → hold mouse press off/on → repeated clicks → hold Space off/on → leave → open Save | Icon edges match durations; every sampled frame matches the current on/off color at full opacity, including held mouse and keyboard presses; track peak summaries are absent; Save shows the five plain extension marks |
| `original/edited replays from zero after natural end and seeking to EOF` | Stereo clips of 1, 1,025, and 48,000 frames → play to end → replay → seek EOF → replay | Both tracks restart at sample zero; edited playback retains exact frame count and amplitude |
| `recording fills the original waveform with a red caret and stops from its play control` | Silent synthetic mic → gain .5 → resize to 375 px → pass five seconds → Stop | Silent/loud peaks match input, red caret advances, span expands without losing peaks, height stays fixed, playback controls and caret reset |
| `site: add stays beside the final crumb at every wrap boundary` | Default chain → four crumbs → one crumb → empty chain; each resized from 256 to 560 px in 4 px steps → add gain | + stays centered beside the last crumb with no overlap or trailing empty row; empty chain still accepts an edit |
| `site: the desktop widget fits its default chain and the add menu joins its trigger` | Default chain at 960–1920 px, then 375/320 px → open + → close through the same button | Desktop widget is at least 464 px and fits all three crumbs; phones do not overflow; tab exactly covers + and joins the menu body |

| `site: dropping on the plus-turned-trash removes only that effect, Undo restores PCM, and the last drop leaves Add` | 4,800-frame tone → gain −6, gain −12, reverse → drag second gain to trash → Undo → remove sole reverse → add gain → Backspace → Undo | Exact remaining gain/reverse samples; identical PCM after Undo; empty chain equals original samples and focuses Add |
| `site: cancelled trash drops restore Add without editing; touch can delete a wrapped crumb` | Default chain → hover trash → Escape, pointercancel, lost capture, blur, resize, pagehide, outside drop → 320 px touch-delete fade → Undo | Cancellations change neither chain nor history and clear the trash state; touch removes only fade and Undo restores it |

| `site: quick crop/remove uses the original/edited timeline and Undo restores the exact stereo audio` | One-second stereo tones → gain −6, reverse → select 25–50% on each track → keyboard Crop or Remove → Undo | All four combinations match library PCM and frame counts; the selection clears, focus moves to Undo, and Undo restores identical audio |
| `site: quick actions recover from an empty result and render failure with Undo still available` | One sample .25 → select all → Remove → Undo → select all → fail Crop render → Undo | Empty output and failed output both retain visible Undo; recovery restores the exact sample and clears the error |
