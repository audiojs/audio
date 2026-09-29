# REPL UI against iZotope RX, feature by feature

What the REPL exposes in its interface, against what RX 12 (29 April 2026, the current release) exposes in its Editor, plus the Audition and SpectraLayers features RX lacks. This is the UI layer only; the DSP behind each module is in [comparison.md](comparison.md) and [market.md](market.md) ("Coverage against iZotope RX and Ozone").

Sources: the RX 11 and RX 12 manuals, read in full. `R12:x` means `https://docs.izotope.com/rx12/en/x.html`, and `R11:x` the same under `rx11`. Audition: helpx.adobe.com pages via Wayback snapshots. SpectraLayers: the SL 12.0.30 manual (`download.steinberg.net/downloads_software/SpectraLayers_12/help/Pro/`). Items the manuals don't settle are marked *unverified*.

**Status:** ✅ we have it · ◐ partly · ✗ missing · ⊘ not wanted (the reason is given) · ★ we have it and RX doesn't

## 1. Selecting

Sources: R11:interactive-tools, R12:keyboard-shortcuts, R11:find-similar.

| RX | Us | Status | Note |
|---|---|---|---|
| Time selection (T) | drag on the picture | ✅ | |
| Time-frequency rectangle (R) | drag a box on the spectrogram | ✅ | |
| Frequency selection across the whole file (F) | none | ✗ | Could be a drag on the frequency ruler; a click there now switches the scale |
| Lasso (L), Brush (B) | none | ⊘ | A magic wand covers most curved shapes |
| Magic Wand (W): the tone under the pointer | double-click selects between the cues either side (the hits found, the markers), as a sampler slices; triple-click the phrase between pauses of 250 ms; in a pause, the pause | ◐ | Selection as in a text: hits are its words, pauses its lines. The tone under the pointer on the spectrogram is still to come |
| Harmonic selection | none | ✗ | The tone wand's next step |
| Feathering at selection edges (Shift+F; 20 ms minimum) | fixed per op: crossfaded splices on remove/cut, 5 ms ramps on ±dB, STFT overlap on spectral | ◐ | No user control |
| Find Similar Event, with Add Markers | none | ✗ | |
| Shift adds a selection, Alt subtracts | Alt-drag adds a range; ⌘D adds the next one like it (pause or sound); Delete, ±3 dB, a method, and Shorten for pauses act on all at once, in one step | ◐ | No subtract. As a text editor's several selections |
| One channel only (channel selectors, Shift+Cmd+L/R) | lanes drawn, not selectable | ✗ | Audition selects a channel by dragging near its lane's top or bottom edge |
| Snap to markers, ruler, zero crossings | times round to the zoom's 1-2-5 step; frequency marks and level lines snap | ◐ | No zero-crossing snap, no markers |
| Invert selection, invert frequencies | none | ✗ | |
| Deselect, select all | Esc; ⌘A or double-click | ✅ | |
| Shift+arrows/Home/End extend | the same | ✅ | |
| `[` `]` set start/end at the playhead while playing | none | ✗ | |
| Type Start/End/Length into the readout | the script's `{ at, duration }` is editable text | ◐ | The clock shows start–end, the display above the levels its length; a click on the clock changes its units |
| Drag a selection's edges to resize | edges drag; Shift extends | ★ | Undocumented in RX (unverified) |
| Move the selection shape | drag a selection: its audio moves there, the rest closing up; Alt-drag copies it over what is there | ★ | As dragged text moves. The picture shows the result while dragging |
| Delete closes the gap; on a band, silences it | Delete writes `remove()`, or `spectral()` for a band | ✅ | |
| Trim to selection (⌘T), Silence (Shift+S), Reverse (Shift+R) | Keep only (`crop`); no silence or reverse in the bar | ◐ | |
| Select a word or speaker from the transcript | none | ✗ | Needs transcription (§8) |

## 2. Pointer tools and on-canvas controls

Sources: R11:interactive-tools, R12:spectrogram-waveform-display.

| RX | Us | Status | Note |
|---|---|---|---|
| Zoom buttons, Zoom to selection (⌘\\), full (⌘0) | wheel, pinch, Ctrl+wheel, `=` `-` `0`; View > Zoom to the selection; out past the whole to eight times it | ✅ | |
| Zoom tool (Z), Grab tool (G) | wheel, trackpad and pinch | ⊘ | Modes a trackpad makes unnecessary |
| Scrub | none in RX: dragging the playhead "plays back audio while positioning" | ★ | Hold or drag the caret, or a selection's edge, and the moment under it sounds, at its own pitch (vocoder with random-phase noise bins); on a box, only its band |
| Instant Process (I): every new selection is processed at once | the bar under the selection | ⊘ | A latched mode, the kind users forget is on |
| Pencil | none (RX offers Interpolate instead) | ✗ | |
| Clip gain line: add, drag, delete points, shift segments | the gain line (View), on its own dB scale: points drag, a press on the line adds one, a double-click removes one; ⌘-drag a selection up or down, or −3/+3 dB, adds a ramped trapezoid to it | ◐ | No segment moves |
| Fade handles on the waveform | a time selection's top corners, dragged inward: fade in from its start, out to its end | ★ | None in RX; Audition has them on clips |
| Markers and regions (M) | none | ✗ | The library writes chapters and cut lists (`save x.mp3`, `a.cuts()`) |
| Effect overlays you drag (De-clip threshold, Loudness Optimize gate) | guides for the step at the caret: levels, fades, ranges, frequencies | ◐ | Drawn, not draggable |
| Warp a hit to a new time (Cues) | the hits found are cues: a line through the lanes each, a tick on the time row that a drag moves, both sides stretching | ★ | RX needs Variable Time's contour |
| Pitch of a voiced stretch | the pitch curve (View), its voiced stretches dragged up or down; ⌘-drag a selection up or down on the spectrogram | ◐ | RX: Dialogue Contour (25 nodes, formant) |
| Time-stretch a selection | its bottom right corner, as a text box's: across, its length (what follows moves with it); up or down, its level, or on the spectrogram its pitch; Shift keeps one axis. ⌘-drag its end or body does the same | ★ | RX: Time & Pitch module on the selection |

## 3. Display

Sources: R12:spectrogram-waveform-display, R11:preferences.

| RX | Us | Status | Note |
|---|---|---|---|
| Waveform and spectrogram blended by one slider | waveform or spectrogram, a tab each; the wheel on the times zooms time, on the frequencies the frequencies | ◐ | Together they fought over one zoom: each zooms its own way |
| Spectrogram type, FFT size, window, overlap, colour map, dB range | reassigned STFT, fixed; grey, lightness even in dB | ◐ | No settings exposed |
| Frequency scale: linear, log, mel, Bark | a click on the frequency axis cycles them | ✅ | |
| Amplitude ruler in dB, normalized, 16-bit, % | dB, mirrored, with −6/−12/−24 lines | ◐ | |
| Colour-map ruler: drag the dB window | none | ✗ | |
| Time ruler in samples, h:m:s, timecode | pointer time only, decimals set by zoom; times in minutes and seconds, seconds or samples (View > Times in, or a click on the clock) | ◐ | Ticks were removed on purpose; no timecode frames |
| Drag a ruler to pan, wheel to zoom that axis | wheel over the spectrogram zooms frequency with time | ◐ | No amplitude zoom |
| Overview bar showing the whole file, the view, the selections | a bird's view: zoom out past the whole, up to eight times it | ◐ | No separate bar |
| Channels separate or summed; L/R or Mid/Side | always separate | ◐ | |
| Analog waveform (inter-sample peaks in red); sample points at deep zoom | none | ✗ | |
| Cursor readout: time, dB, Hz | on the axes, at the pointer | ✅ | |
| Follow playhead (page or continuous) | a zoomed view scrolls with the playhead held in the middle | ✅ | |
| A file drawn as it loads | the output streams as the file arrives, across the length its header says; a file the chain must wait for (trim, normalize) shows dim as it decodes; Loading n% beside the time | ★ | RX decodes before it shows anything |
| Pictures fade before the rulers | the waveform and spectrogram thin out before the labels at their right and the time row below | ✅ | |

## 4. Playing and listening

Sources: R11:transport-controls---displays, R12:common-module-controls.

| RX | Us | Status | Note |
|---|---|---|---|
| Play, loop, play from click | Space, the loop switch on the display, play from the caret or the selection | ✅ | The library's own play(): a deck on the page's one AudioContext, its seams, starts and stops crossfaded; the playhead is what the device plays, and never steps back (the device clock only runs on; a glitching device's skipped frames hold it) |
| Play Selection Only, band-limited | Play on a band plays only the band (24 dB/oct Butterworth) | ✅ | |
| Record | Record opens the take as the script's source | ✅ | The library's own browser recording kept one block only until this session's fix to `record()`; it still takes 16-bit at 44.1 kHz, so the page keeps its own float recorder for now |
| Scrub every channel | the held caret sounds in stereo (or as many channels as there are), the image kept | ★ | |
| Rewind, Playhead Return (⌘R), input monitoring | none | ✗ | |
| Pre-roll/post-roll for Preview | none | ✗ | |
| Module Preview with live parameter changes, Bypass | every change re-renders and the new output takes over playback where it is (play({ from }), 20 ms crossfade), so a slider is heard as it moves | ◐ | No per-step bypass |
| Compare Settings (named versions, rendered in the background) | Before: the file as it opened, level-matched, same place | ◐ | No versions of our own to compare |
| Output noise/clicks/hum/reverb only (the residual) | Δ on a stack card: the output before the step less the output after it, drawn and played; off for steps that move time, where the two don't line up | ★ | Any step, not only RX's repair modules |
| Solo or mute a channel | none | ✗ | |
| Click history items to A/B states | none | ✗ | See §6 |
| Streaming Preview (a platform's normalization and codec) | Check measures against the spec; nothing to audition | ◐ | |

## 5. Modules

Sources: R11:module-list, R12:module-list, R11:common-module-controls, R11:module-chain, R11:repair-assistant.

| RX | Us | Status | Note |
|---|---|---|---|
| Module list: categories, filters, search (RX 12) | the + menu: grouped methods and search; in the rack and the selection bar | ✅ | |
| Floating module windows | the rack: units fold open to their sliders in place, any number at once; those the script's selection touches open themselves | ⊘ | Windows pile up and cover the audio |
| Presets per module, with shortcuts | Recipes: whole chains | ◐ | |
| Learn (a noise profile from the selection) | Denoise on the selection bar (Edit > Take this noise out everywhere): the selection, or every selected range, is where the noise plays alone; `denoise({ noise })` learns it there and takes it 12 dB down everywhere; the rack sets reduction and threshold, the picture marks where it was learned | ✅ | One step where RX takes two (Learn, then Process). OM-LSA gain on the held print (fn/denoise.js); `stat('print')` keeps a print for another take |
| Suggest, Adaptive | ops that set themselves (`auto`, adaptive denoise) | ◐ | |
| Module Chain: rows with power, settings, band, remove; drag to reorder | the chain is the script; the rack shows each call as a unit, × removes it | ◐ | No reorder, no power, no per-step band control |
| Repair Assistant | `auto`, and Check | ◐ | |
| Plug-in hosting (VST3/AU) | registry plugins | ⊘ | No native plugins in a browser |
| Stem Split (RX 12), Music/Scene Rebalance | `vocals` (centre channel) | ◐ | Neural separation unpublished |
| Graphic module UIs: EQ nodes, De-hum spectrum, De-clip histogram, contour editors | sliders only | ✗ | The EQ graph first; drawn on the picture's frequency axis |

## 6. History

Sources: R11:undo-history, R12:undo-history.

| RX | Us | Status | Note |
|---|---|---|---|
| Undo/redo | one history for typing, sliders and picture edits; a slider drag is one step | ✅ | |
| History panel: click a state to revert, rename | the list under Undo (and Edit > History): each step named by what it changed in the chain; a click goes back or forward to it. The stack's rollback bar, dragged up, leaves out the steps below it until it goes back down; a card's switch turns one step off (commented out in the code) | ◐ | No rename. The rollback bar is a CAD model's (SolidWorks, Fusion) |
| Restore Selection (revert only the selected region) | none | ✗ | |
| Export History as XML | the script records every edit and runs: in the page, Node or the CLI | ★ | Share puts it in a link |
| `.rxdoc` session: audio, edits, history | the script persists in the browser; opened files don't | ◐ | |

## 7. Analysis and metering

Sources: R11:waveform-statistics, R11:spectrum-analyzer, R11:markers---regions.

| RX | Us | Status | Note |
|---|---|---|---|
| Level meter with peak hold | by each waveform lane at the right: a bar as tall as the RMS, a tick at the peak (red at full scale), on the lane's own scale; as it plays, at the playhead; stopped, at the caret or across the selection | ◐ | No peak hold |
| Waveform Statistics: true/sample peak, RMS, clipped samples, DC, loudness, LRA, locate buttons | the display beside the time: rate, channels and depth above; peak and LUFS below, or the selection's length, peak and RMS; Check lists each rule | ◐ | No per-channel table, no locate |
| Spectrum Analyzer (at the playhead, averaged over the selection) | by each spectrogram lane at the right: the spectrum's outline, each frequency at its height in the lane; at the playhead, the caret, or averaged over the selection (Welch) | ✅ | |
| Phase meter | none in RX either | ✗ | Audition has one |
| Loudness Control to broadcast presets | Check against Apple Podcasts, Spotify, EBU R 128, ACX, Netflix, the file before and after | ★ | Each rule with its limit and source |
| Markers window | none | ✗ | |
| File Info, metadata | rate, channels in the readout | ◐ | The library reads and writes metadata; the page doesn't show it |

## 8. Files and sessions

Sources: R11:working-with-files, R11:batch-processor, R11:composite-view, R11:text-navigation.

| RX | Us | Status | Note |
|---|---|---|---|
| Tabs, up to 32 files | one script; several files join or mix in it | ◐ | |
| Open audio and video by drop or dialog | the same, several at once; also search Freesound/Jamendo/Wikimedia, built-in samples and generators | ★ | |
| Export dialog: format, bit depth, dither, bitrate | a format menu; the rest in `save()` options | ◐ | |
| Export selection, export regions to files | `save()` for each named file | ◐ | |
| Batch Processor | the CLI takes globs | ◐ | Not in the page |
| Composite View (edit many files as one) | none | ✗ | |
| Text Navigation: transcript, word tabs, speakers, search | none | ✗ | Needs a word-level model |
| RX Connect, ARA in DAWs | none | ⊘ | The web |
| Share a session as a link | Share | ★ | |

## 9. Keys

Sources: R12:keyboard-shortcuts.

| RX | Us | Status |
|---|---|---|
| Tool letters, Space, Shift+Space preview | no tools to choose; Space, ⌘Enter | ⊘ |
| Zoom keys, select all, deselect, delete, trim | `=` `-` `0`, ⌘A, Esc, Delete, ⌘X/C/V/Z/Y | ✅ |
| Move by words and lines | ⌥←/→ (Ctrl elsewhere) to the next sound's edge or hit, ⌘←/→ (Ctrl ↑/↓) to the next phrase's; Shift extends; ⌘D adds the next like the selection | ★ |
| A menu bar listing every command | File, Edit, Select, View, Process, Play, Help, each item with its keys; F10 reaches it; one Menu on a phone | ✅ |
| M marker, `[` `]`, invert, channel keys | none | ✗ |
| Module shortcuts: Shift+1…8 open, ⌘1…8 process | none | ✗ |
| Command palette | none in RX; our + menu searches methods | ◐ |

## 10. Beyond RX

**Audition:** Spot Healing Brush (paint and it heals) ◐ as a band's Rebuild · split waveform/spectrogram ★ · scrub and J/K/L shuttle ◐ (scrub, no shuttle) · fade handles ✗ · gain HUD ◐ (−3/+3 dB) · Diagnostics scan-and-fix list ✗ · Sound Remover (learn a sound, remove it everywhere) ✗ · continuous log/linear frequency scale ✗ · zero-crossing adjust ✗ · selection opacity (graded strength) ✗.

**SpectraLayers:** layers and unmix ✗ · Transform, where vertical scaling is pitch and horizontal is time ✗ (planned, below) · Clone Stamp ✗ · frequency and transient pencils, noise spray ✗ · tracking selections (a tone, harmonics) ✗ · selection fades by border drag ✗ · a Playback tool whose band follows the pointer ★ (a box's scrub) · Select Similar ✗.

## Tools without a toolbar

A tool palette is a latched mode: the same drag does different things depending on a choice made earlier, off to the side. Evidence and precedent:
- Sellen, Kurtenbach & Buxton (1992, HCI 7(2)) measured fewer mode errors with a mode held by the body (a foot pedal) than a latched one; a latching pedal did no better than i/Esc. They also note that a live selection is itself a mode.
- Raskin calls the held kind a quasimode (Shift, not Caps Lock).
- Tesler argued for object first, then verb: select, then act.
- **Audacity 4.0 (3 September 2026) removed its Select, Envelope, Draw and Multi-tool modes** and made them context-sensitive ([release notes](https://github.com/audacity/audacity/releases/tag/Audacity-4.0.0)).

So the REPL keeps one gesture, select, and gives every other act a hit target, a held key, or a button next to the selection. The tool rail is gone:

| Tool (image editor → audio) | Its home without a mode | Status |
|---|---|---|
| Marquee → time range, box | drag | ✅ |
| Magic wand → a sound, as a word | double-click: between the cues around it; triple-click: the phrase | ✅ |
| Magic wand → a tone | double-click on the spectrogram | ✗ |
| Move → move the audio | drag the selection's body (as dragged text moves); the picture shows the result as it goes | ✅ |
| Free transform → stretch, level, pitch | the selection's bottom right corner, as a text box's: across, its length (what follows moves with it); up or down, its level on the waveform, its pitch on the spectrogram; Shift keeps one axis. Held ⌘ (Ctrl), its end and body do the same | ✅ |
| Crop | Keep only, in the bar | ✅ |
| Eraser, dodge/burn → attenuate, boost | −/+ dB in the bar; on a band, spectral gain | ✅ |
| Healing, content-aware fill → repair | Rebuild in the bar | ◐ (band only) |
| Clone stamp → copy audio over other audio | Alt-drag the selection's body: a copy over what is there | ✅ |
| Gradient → fades | the selection's top corners, dragged inward | ✅ |
| Pen path → gain envelope | the gain line (View), on its own dB scale: points drag, a press on the line adds one | ✅ |
| Pitch handle → a voiced stretch | the pitch curve (View), its voiced stretches dragged | ✅ |
| Warp → move a hit | the cues: a line through the lanes, a tick on the time row; click for the caret, drag to move | ✅ |
| Multiple selections | Alt-drag adds a range, ⌘D the next like it; edits act on all | ✅ |
| Eyedropper → learn a noise profile | Denoise in the bar on the noise alone | ✅ |
| Ruler, sampler → measure | the display's two rows; the level and spectrum meters at the right | ✅ |
| Zoom, hand | wheel, pinch, trackpad | ✅ |
| Scrub | the caret and edges, held or dragged; every channel | ✅ |
| Markers | M at the caret; flags on the time row | ✅ |
| Slice → split | a marker; File exports the parts between markers | ✅ |

Only a few acts have a stroke that is itself the data:
- redrawing samples with a pencil: at sample zoom the line itself can take the drag, as in Audacity;
- painting tones or noise into the spectrogram (SpectraLayers' pencils and spray): synthesis, not repair; skip;
- smudge and liquify: no audio product has them.

None needs a palette.

## Layout

How others place panels:
- **CodePen 2.0** (July 2026): a left rail opens one panel at a time; the console sits in the preview.
- **StackBlitz and CodeSandbox:** VS Code's activity bar.
- **Observable:** output above code; code shows only when a cell is pinned.
- **Strudel:** code over the visuals; a side panel of tabs.
- **Lightroom Classic:** image in the middle, collapsible panel stacks left and right (F7/F8, Tab hides both), filmstrip below, History and Snapshots on the left.
- **RX:** module list right, history under it, transport bottom, floating module windows.

The REPL follows Lightroom: the picture in the middle, the chain in a panel at its right.
- **Menu bar:** File, Edit, Select, View, Process, Play, Help: every command, with its keys, so the menu is the map of the page. One Menu on a phone.
- **Output:** the picture, the largest area, as the waveform or the spectrogram (a tab each), its meters where it fades out before the levels or frequencies, the times marked below.
- **The chain,** at the right (below on a phone): its **stack** (a card per step, its settings inside, a switch that turns it off, Δ for what it takes out, a rollback bar at the foot) or its **code**, a tab each: two views of one script.
- **Bottom bar:** record and play, the time, the loop switch, and the display's two rows beside them (what the sound is, its rate and channels a click away from resample and remix; its levels or what the engine is doing), undo with its history, and the chain's toggle.

The chain opens and closes from the bar and the View menu, and is remembered; closed, the output has the whole block.

## What to build next, by what it saves the user

1. **The tone wand and harmonics** (§1). Whistles, rings and hum are single tones.
2. **A step's frequency response on the spectrogram**, drawn at once as its level is on the waveform (EQ, filters), then the EQ graph on the frequency axis (§5).
3. **Pictures from the library's index** (§3): the waveform from its per-block stats and the time map of its plan, samples fetched only where zoomed in, so an hour draws at once.
4. **Carets as ranges of no length** (Alt-click): paste, insert or mark at several places in one step, as the several ranges already do for edits.
