# Playground UI against iZotope RX, feature by feature

A coverage map, not a roadmap: what a free alternative already covers, so a user can tell what it does. A ✗ row is built when a user needs it, never to close the table.

What the playground exposes in its interface, against what RX 12 (29 April 2026, the current release) exposes in its Editor, plus the Audition and SpectraLayers features RX lacks. This is the UI layer only; the DSP behind each module is in [comparison.md](comparison.md) and [market.md](market.md) ("Coverage against iZotope RX and Ozone").

Sources: the RX 11 and RX 12 manuals, read in full. `R12:x` means `https://docs.izotope.com/rx12/en/x.html`, and `R11:x` the same under `rx11`. Audition: helpx.adobe.com pages via Wayback snapshots. SpectraLayers: the SL 12.0.30 manual (`download.steinberg.net/downloads_software/SpectraLayers_12/help/Pro/`). Items the manuals don't settle are marked *unverified*.

**Status:** ✅ we have it · ◐ partly · ✗ missing · ⊘ not wanted (the reason is given) · ★ we have it and RX doesn't

## 1. Selecting

Sources: R11:interactive-tools, R12:keyboard-shortcuts, R11:find-similar.

| RX | Us | Status | Note |
|---|---|---|---|
| Time selection (T) | drag on the picture | ✅ | |
| Time-frequency rectangle (R) | drag a box on the spectrogram | ✅ | |
| Frequency selection across the whole file (F) | Shift while dragging a box on the spectrogram up or down: the band over all the time | ✅ | |
| Lasso (L), Brush (B) | none | ⊘ | A magic wand covers most curved shapes |
| Magic Wand (W): the tone under the pointer | double-click selects between the cues either side (the hits found, the markers), as a sampler slices; triple-click the phrase between pauses of 250 ms; in a pause, the pause | ◐ | Selection as in a text: hits are its words, pauses its lines. The tone under the pointer on the spectrogram is still to come |
| Harmonic selection | none | ✗ | The tone wand's next step |
| Feathering at selection edges (Shift+F; 20 ms minimum) | fixed per op: crossfaded splices on remove/cut, 5 ms ramps on ±dB, STFT overlap on spectral | ◐ | No user control |
| Find Similar Event, with Add Markers | none | ✗ | |
| Shift adds a selection, Alt subtracts | Alt-drag adds a range; ⌘D adds the next one like it (pause or sound); Delete, ±3 dB, a method, and Shorten for pauses act on all at once, in one step | ◐ | No subtract. As a text editor's several selections |
| One channel only (channel selectors, Shift+Cmd+L/R) | lanes drawn, not selectable | ✗ | Audition selects a channel by dragging near its lane's top or bottom edge |
| Snap to markers, ruler, zero crossings | times round to the zoom's 1-2-5 step; a pressed or dragged time (the caret, a range's edge, a moved selection's, a stretch's, a fade's) goes onto a cue or marker within 6 px, which lights, as Figma's objects snap, and the pointer's time on the time row says where a press would land; switched off in the view settings; frequency marks and level lines snap. A cue is where its hit's attack starts, at a zero crossing (fn/hits.js) | ◐ | Zero crossings only at cues |
| Invert selection, invert frequencies | none | ✗ | |
| Deselect, select all | Esc; ⌘A or double-click | ✅ | |
| Shift+arrows/Home/End extend | the same | ✅ | |
| `[` `]` set start/end at the playhead while playing | none | ✗ | |
| Type Start/End/Length into the readout | the script's `{ at, duration }` is editable text | ◐ | The clock shows start–end, the display above the levels its length; a click on the clock changes its units |
| Drag a selection's edges to resize | edges drag; Shift extends | ★ | Undocumented in RX (unverified) |
| Move the selection shape | ⌘-drag a selection: its audio slides over what is there, silence where it was (move(), a graphic editor's object, a DAW's clip in slip mode), past the end silence opening up to it; Alt-drag puts a copy in, what is there moving on; dragged up onto the tabs, a tab of its own | ★ | The picture shows the result while dragging |
| Delete closes the gap; on a band, silences it | Delete writes `remove()`, or `spectral()` for a band | ✅ | |
| Trim to selection (⌘T), Silence (Shift+S), Reverse (Shift+R) | Keep only (`crop`); no silence or reverse in the bar | ◐ | |
| Select a word or speaker from the transcript | none | ✗ | Needs transcription (§8) |

## 2. Pointer tools and on-canvas controls

Sources: R11:interactive-tools, R12:spectrogram-waveform-display.

| RX | Us | Status | Note |
|---|---|---|---|
| Zoom buttons, Zoom to selection (⌘\\), full (⌘0) | wheel, pinch, Ctrl+wheel, `=` `-` `0`; View > Zoom to the selection; out past the whole to eight times it | ✅ | |
| Zoom tool (Z), Grab tool (G) | wheel, trackpad and pinch | ⊘ | Modes a trackpad makes unnecessary |
| Scrub | none in RX: dragging the playhead "plays back audio while positioning" | ★ | Press, hold or drag the caret, or a selection's edge, and the moment under it sounds at once, at its own pitch, every channel (a vocoder with random-phase noise bins); an attack it passes plays once as recorded, not smeared (Nagel & Walther 2009, Röbel 2003); on a box, only its band |
| Instant Process (I): every new selection is processed at once | the bar under the selection | ⊘ | A latched mode, the kind users forget is on |
| Pencil | none (RX offers Interpolate instead) | ✗ | |
| Clip gain line: add, drag, delete points, shift segments | the gain line (View), on its own dB scale: points drag, a press on the line adds one, a double-click removes one; ⌘-drag a selection up or down, or −3/+3 dB, adds a ramped trapezoid to it | ◐ | No segment moves |
| Fade handles on the waveform | each top corner of a time selection, drawn as the fade it makes (the corner cut along the fade's curve): inward, fade in from its start or out to its end; outward, past the edge, a fade centred on it; a click chooses the curve (linear, exponential, logarithmic, S), which the fade just made takes too | ★ | None in RX; Audition has them on clips, a curve per clip |
| Markers and regions (M) | none | ✗ | The library writes chapters and cut lists (`save x.mp3`, `a.cuts()`) |
| Effect overlays you drag (De-clip threshold, Loudness Optimize gate) | guides for the step under the pointer among the edits: levels, fades, ranges, frequencies | ◐ | Drawn, not draggable |
| Warp a hit to a new time (Cues) | the hits found are cues: a line in each lane, a notch on the time row that a drag moves, both sides stretching. Each is where its attack starts: a jump in level found to 5 ms, then from the loudest 5 ms window near it back to where the rise is 5% of the way up, then to the zero crossing before; on the built-in chime and handpan, within 3 ms before each known strike, and reversed, each stop at the strike mirrored | ★ | RX needs Variable Time's contour |
| Pitch of a voiced stretch | the pitch curve on the spectrogram (Edit pitch), dragged whole, a click a point of the pitch line, dragged; the tools at a selection's foot: pitch, intonation, formants | ★ | RX: Dialogue Contour (25 nodes, formant) |
| Time-stretch a selection | the grip in each lane's bottom right corner, a text area's: across, its length (what follows moves with it), and nothing else; the pill on its top edge: its level; the tools at its foot: a voice's pitch, intonation, formants. ⌘-drag its end or body does the same. One handle, one act: a corner that did both made it too easy to change the level for the length | ★ | RX: Time & Pitch module on the selection |

## 3. Display

Sources: R12:spectrogram-waveform-display, R11:preferences.

| RX | Us | Status | Note |
|---|---|---|---|
| Waveform and spectrogram blended by one slider | waveform or spectrogram, a tab each; the wheel on the times zooms time, on the frequencies the frequencies | ◐ | Together they fought over one zoom: each zooms its own way |
| Spectrogram type, FFT size, window, overlap, colour map, dB range | reassigned STFT computed on the GPU as it is drawn (gl-spectrogram 2): sharp at every zoom, no wait; FFT of 40 ms, longer on a zoomed band; grey, lightness even in dB; one dB range for every channel, the loudest's | ◐ | No settings exposed |
| Frequency scale: linear, log, mel, Bark | octaves, mel or hertz in the view settings | ◐ | No Bark |
| Amplitude ruler in dB, normalized, 16-bit, % | dB, mirrored, or the sample values (±1), each under its tick; a pinch or Ctrl+wheel on it zooms the levels, −60dB to +12dB at the lane's edges (a quiet sound magnified, overs shown) | ◐ | No 16-bit or % |
| Colour-map ruler: drag the dB window | none | ✗ | |
| Time ruler in samples, h:m:s, timecode | a label every 1-2-5 step 72 px apart or more, its tick beside it, no axis line; the pointer's time on the same row, snapped as a press would take it, the labels under it giving way; minutes and seconds, seconds or samples (view settings, View > Times in) | ◐ | No timecode frames |
| Frequency ruler | each label under its tick, no unit, the lowest the lane shows at its foot; the pointer's frequency under its own tick; the scale (octaves, mel, hertz) in the view settings above the axes | ◐ | No colour map or dB window yet; they belong in the same settings |
| Drag a ruler to pan, wheel to zoom that axis | the wheel scrolls, through zoomed-in frequencies over them; a pinch or Ctrl and the wheel zooms the axis under the pointer | ◐ | No ruler drag; no amplitude zoom |
| Overview bar showing the whole file, the view, the selections | zoomed in, a faint scrollbar at the time row's foot, its thumb the view, dragged or pressed beside; a bird's view: zoom out past the whole, up to eight times it | ◐ | No waveform strip, no selections on it |
| Channels separate or summed; L/R or Mid/Side | always separate | ◐ | |
| Analog waveform (inter-sample peaks in red); sample points at deep zoom | none | ✗ | |
| Cursor readout: time, dB, Hz | on the axes, at the pointer; on the spectrogram the level its colour stands for too (the loudest cell within 2 px), marked on the spectrum meter | ✅ | |
| Follow playhead (page or continuous) | a zoomed view scrolls with the playhead held in the middle; played from a caret past it, the view glides it there | ✅ | |
| A file drawn as it loads | the output streams as the file arrives, across the length its header says; a file the chain must wait for (trim, normalize) shows dim as it decodes; Loading n% beside the time | ★ | RX decodes before it shows anything |
| Pictures fade before the rulers | the waveform and spectrogram thin out before the labels at their right and the time row below | ✅ | |

## 4. Playing and listening

Sources: R11:transport-controls---displays, R12:common-module-controls.

| RX | Us | Status | Note |
|---|---|---|---|
| Play, loop, play from click | Space, the loop switch on the display, play from the caret or the selection; Play held is a shuttle, dragged 0.1× to 10× (twice each 40 px), back to 1× let go, as a shuttle ring springs back | ✅ | The library's own play(): a deck on the page's one AudioContext, fed by the engine's worker as it plays (audio/worker, worker.js voice), so a busy page leaves no gap; its seams, starts and stops crossfaded; the playhead is what the device plays, and never steps back (the device clock only runs on; a glitching device's skipped frames hold it) |
| Play Selection Only, band-limited | Play on a band plays only the band (24 dB/oct Butterworth) | ✅ | |
| Record | Record opens the take as the script's source | ✅ | The library's own browser recording kept one block only until this session's fix to `record()`; it still takes 16-bit at 44.1 kHz, so the page keeps its own float recorder for now |
| Scrub every channel | the held caret sounds in stereo (or as many channels as there are), the image kept | ★ | |
| Rewind, Playhead Return (⌘R), input monitoring | none | ✗ | |
| Pre-roll/post-roll for Preview | none | ✗ | |
| Module Preview with live parameter changes, Bypass | every change re-renders and the new output takes over playback where it is (play({ from }), 20 ms crossfade), so a slider is heard as it moves; playback is a worker's of its own (engine.js deck), so processing never holds it up, and a file still decoding plays as far as it has come | ◐ | No per-step bypass |
| Compare Settings (named versions, rendered in the background) | Before: the file as it opened, level-matched, same place | ◐ | No versions of our own to compare |
| Output noise/clicks/hum/reverb only (the residual) | Δ on a stack card: the output before the step less the output after it, drawn and played; off for steps that change the sound's time, rate or channels, where the two don't line up | ★ | Any step, not only RX's repair modules |
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
| Stem Split (RX 12), Music/Scene Rebalance | `rebalance(vocals, bass, drums, other)` by SCNet-large (MIT weights); a stem alone with the others muted; `vocals` (centre channel, or a model) | ◐ | Ahead of RX 12 Best on drums and other and on most songs for every stem, behind on the bass median (bench/rx/separate.mjs). The weights (169 MB) are exported locally, not hosted: the page cannot reach them yet. No Scene Rebalance (dialogue, music, effects) |
| Graphic module UIs: EQ nodes, De-hum spectrum, De-clip histogram, contour editors | sliders only | ✗ | The EQ graph first; drawn on the picture's frequency axis |

## 6. History

Sources: R11:undo-history, R12:undo-history.

| RX | Us | Status | Note |
|---|---|---|---|
| Undo/redo | one history for typing, sliders and picture edits; a slider drag is one step | ✅ | |
| History panel: click a state to revert, rename | the list under Undo (and Edit > History): each step named by what it changed in the chain; a click goes back or forward to it, the selection as it was there (kept beside each step, before and after, as a text editor's). The edits are a second history, of the chain, undo's own menu: a card chosen shows the output up to its step, the steps after it dimmed, without undoing anything, and an edit made then drops them, as a browser's history; its eye turns one step off (commented out in the code) | ◐ | No rename |
| Restore Selection (revert only the selected region) | per edit: a selection's context menu, Turn an edit off here, sets that edit's `mix` to 0 over it, ramped over the splices; the agent's `step({ index, on: false, at, d })` the same | ★ | RX restores every step at once; here one edit, the rest kept. The library's `mix` (0 to 1 or a curve over time) on any edit that keeps the timing |
| Export History as XML | the script records every edit and runs: in the page, Node or the CLI | ★ | Share puts it in a link |
| `.rxdoc` session: audio, edits, history | the script persists in the browser; opened files don't | ◐ | |

## 7. Analysis and metering

Sources: R11:waveform-statistics, R11:spectrum-analyzer, R11:markers---regions.

| RX | Us | Status | Note |
|---|---|---|---|
| Level meter with peak hold | by each waveform lane at the right: a bar as tall as the RMS, a tick at the peak (red at full scale), on the lane's own scale; as it plays, at the playhead; stopped, at the caret or across the selection | ◐ | No peak hold |
| Waveform Statistics: true/sample peak, RMS, clipped samples, DC, loudness, LRA, locate buttons | the display beside the time: rate, channels and depth above; peak and LUFS below, or the selection's length, peak and RMS; Check lists each rule | ◐ | No per-channel table, no locate |
| (none in RX) | the status bar says what the sound is, as a musician would: the note at the caret (YIN, cents from 5 on), a selection's note or a melody's compass, the tempo (detect(), spectral flux) and key (Krumhansl-Schmuckler on chroma) of the selection or of all of it, over 6 s and only where its halves agree (tempo within 4%, Gouyon et al. 2006) | ★ | What kind of sound it is (speech, music, a dog) needs a classifier (YAMNet, PANNs): a plugin |
| Spectrum Analyzer (at the playhead, averaged over the selection) | by each spectrogram lane at the right: the spectrum's outline, each frequency at its height in the lane, on the spectrogram's levels and filled with its colours, so it is the colour legend too; at the playhead, the caret, or averaged over the selection (Welch) | ✅ | |
| Phase meter | none in RX either | ✗ | Audition has one |
| Loudness Control to broadcast presets | Check against Apple Podcasts, Spotify, EBU R 128, ACX, Netflix, the file before and after | ★ | Each rule with its limit and source |
| Markers window | none | ✗ | |
| File Info, metadata | rate, channels in the readout | ◐ | The library reads and writes metadata; the page doesn't show it |

## 8. Files and sessions

Sources: R11:working-with-files, R11:batch-processor, R11:composite-view, R11:text-navigation.

| RX | Us | Status | Note |
|---|---|---|---|
| Tabs, up to 32 files | a tab each over the picture, its own script and history, kept by the page; a sound opened goes into a tab of its own; several files still join or mix in one script | ✅ | |
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

So the editor keeps one gesture, select, and gives every other act a hit target, a held key, or a button next to the selection. The tool rail is gone:

| Tool (image editor → audio) | Its home without a mode | Status |
|---|---|---|
| Marquee → time range, box | drag | ✅ |
| Magic wand → a sound, as a word | double-click: the fragment between the cues around it; triple-click: the sound between its pauses | ✅ |
| Magic wand → a tone | double-click on the spectrogram | ✗ |
| Move → move the audio | drag the selection's body (as dragged text moves); the picture shows the result as it goes | ✅ |
| Free transform → stretch, level, pitch | the selection's handles, one act each: the grip in each lane's bottom right corner, its length (what follows moves with it); the pill on its top edge, its level; the tools at its foot, a voice's pitch, intonation and formants. Held ⌘ (Ctrl), its end and body do the same | ✅ |
| Crop | Keep only, in the bar | ✅ |
| Eraser, dodge/burn → attenuate, boost | −/+ dB in the bar; on a band, spectral gain | ✅ |
| Healing, content-aware fill → repair | Rebuild in the bar | ◐ (band only) |
| Clone stamp → copy audio over other audio | Alt-drag the selection's body: a copy put in where it lands, what is there moving on (a text's dragged copy; nothing written over) | ◐ |
| Gradient, corner radius → fades | the dots in the selection's top corners: inward from the edge, outward centred on it | ✅ |
| Pen path → gain envelope | the gain line (View), on its own dB scale: points drag, a press on the line adds one | ✅ |
| Pitch handle → a voiced stretch | the pitch curve (View), its voiced stretches dragged | ✅ |
| Warp → move a hit | the cues: a line in each lane, a notch on the time row; click for the caret, drag to move | ✅ |
| Multiple selections | Alt-drag adds a range, Alt-click a caret, ⌘D the next like it; edits act on every range, a paste or a marker on every caret | ✅ |
| Marquee on one axis | Shift while dragging a box on the spectrogram: across, a time range of every frequency; up or down, a band over all the time | ✅ |
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

- **Luminar Neo:** the image, and at its right Tools (every tool by kind, an icon each) and Edits (a card per tool used, the one open showing its sliders, an eye and a reset on it; Discard Edits at the foot).

The editor follows Lightroom and Luminar: the picture in the middle, a panel at its right.
- **Menu bar:** File, Edit, Select, View, Process, Play, Help: every command, with its keys, so the menu is the map of the page. One Menu on a phone.
- **Tabs** over the picture, as an audio editor's open files (RX's): a sound each, its own script and history; a sound opened goes into a tab of its own, or the one shown if it is empty; + a new one, × closes one, the last leaving an empty one. The picture's switch (waveform, spectrogram) at the strip's right, its right edge where the pictures end (view.js reports it, `onlayout`), undo and redo over the meters and labels past that; the spectrogram's tab again turns its frequency scale (octaves, mel, hertz), said by it a moment. How each draws is a right-click on it (and the View menu), not a setting: the spectrogram's scale, colours, gamma, range, FFT size; the waveform's colour (one, or its spectral centroid as the colour of light, the low warm and the high cool, 1,800 K at 100 Hz through daylight's white at 1 kHz to 16,000 K at 10 kHz on the black-body locus, a colour every 4 to 8 px on a grid of the sound's own: tint.js), its channels (a lane each, or one lane, each its hue) and fill (density, RMS, flat).
- **Output:** the picture, the whole height beside the panel, as the waveform or the spectrogram (an icon tab each), its meters 2 px before the levels or frequencies (a waveform's bar in its own colours, the RMS in its body's, out to the peak in its edges'; the spectrum's outline filled with the spectrogram's colours on its levels, its legend, a selected band lit in it), the times marked right under the lanes, each tick running down from them. The pictures and what is drawn over them (cues, the pitch curve) end before the meters, never behind them; nothing fades out before them. The waveform's axis is its levels, whatever else shows over it. The axis labels' gutter is as wide as a frequency's label (40 px), the panel starting 4 px after it: no gap between the axis and the panel.
- **Times that matter** on the time row, each tick joined to its line above, the colour of that line (an edge lit, bright): the caret's (while playing, the playhead's), a selection's start and end, the pointer's; the row's labels give way to them. Each label after its tick, a range's start's before it only where the range has no room for it.
- **Levels** zoom (a pinch or Ctrl+wheel on the axis), stopping at full scale on the way (the next step leaves it), and scroll up and down with the wheel when zoomed in, as frequencies do on the spectrogram; zoomed out, what goes over full scale shows either side, tinted red. Where the output clips (the library's stat('clipping')), the time row is underlined red.
- **The pointer hides** while an operation draws what it does: the caret sounding, a range or a handle dragged.
- **Cues** stay out of sight, a forest over the sound otherwise: one shows where it matters, the one a dragged edge or caret sits on, the one dragged, and held ⌘ the one under the pointer, which a press drags (warp) and a click puts the caret on. ⌘ ↑ ↓ go to the start and the end, as in a text. No triangles on the time row. They are both kinds as one, no setting: the edges of the pauses, where each sound starts (its attack, fn/hits.js) and ends (where the quiet begins, within a block), as a text's words are found; and the hits, where the level jumps either way (fn/hits.js, stat('hits')): up where an attack starts, down where a sound stops, the 10 ms after a moment over the 10 ms before, 6 dB or more, the largest of its way within 50 ms and twice the median change within 100 ms, so a decay or a swell (a slope in dB, where a strike is a step) makes none and a reversed sound's are its own mirrored; and only over the background: the level read down to 40 dB under the loudest, a hit's louder side 12 dB over the quietest tenth (a voice-over's 463 hits in 49 s became 106, its room noise's gone; a rumble's 111, none; a sung take kept 67 of 72). A hit within 30 ms of an edge is the edge. A double-click selects the fragment between them; a triple-click the sound between its pauses (60 ms or more), its edges on the cues; ⌥ and ⌘ arrows step by the same. Snapping takes them, shown or not, and the markers, within 3 px (Figma snaps to objects whether guides show or not). Not yet: weighing them by what the sound is (speech, a solo, a mix, percussion).
- **The keys say how, the same everywhere**, text carets and Figma selections in one, each with its pointer, and its key a word: **a**lt **a**dds, **s**hift **s**ums, ⌘ empowers. A press puts the caret, all else gone at once (on the press, not the release), a drag selects, a double-click a word, a triple-click a phrase. **Shift sums**: a press extends the selection, or the caret, to it at once from where it was begun (a text's anchor), inside or out, a drag going on with it (the pointer an I-beam with a chevron the way it goes). **Alt adds**: a click another caret, the one Shift then extends; a drag another range; a double-click another word; dragged inside the selection, a copy of its audio put in where it lands, what is there moving on after it (Finder's and Figma's Alt-drag); held, how far the pointer is from the selection or the caret, Figma's Alt measuring, a helper (the pointer with a plus). **⌘ (Ctrl) empowers** what a press does: dragged inside the selection, its audio slides over what is there (Finder's ⌘-drag); a range's end sets its length, as its grip does (trim, stretch or speed); the cues light and drag (warp); on the spectrogram a press makes a box of time and frequency; a drag aims finely (a quarter as far, nothing snapping: Blender's Shift, Logic's Control-Shift, Ableton's ⌘ bypassing the grid, Figma's Control), except what ⌘ took hold of. The keys show at once, wherever the focus is. What there is stays when one of it is taken: a caret's line or the time row drags the caret (only clicked, a caret's line leaves that caret alone), a range's edge resizes it and onto the other edge leaves a caret; the range under the pointer has the handles. A right-click on what a press would take moves nothing.
- **Splices** (Settings): every seam an edit makes is crossfaded, equal-power, over 10 ms by default (5, 20, off), so it makes no click: what Delete or Cut takes out (remove()'s crossfade), what a paste, a move or a copy puts in (paste()'s), silence opened (insert()'s); the length as without it.
- **Context menu** (a right-click on the picture, as a text editor's: outside the selection it puts the caret there first), an icon each: cut, copy, paste, delete, keep only (crop is clicked, never dragged, so it is no handle); fade in and out (the corners' curve), a crossfade across it, 3 dB louder and quieter, reverse, normalize, take this noise out; zoom to it; Find an edit (⌘K). At the caret: paste, a marker, select all. The menubar's own list (menu.js `at`), its keys the same.
- **Several selections:** Alt and a click adds a caret, Alt and a drag a range; on the spectrogram Alt and a drag adds another box (Photoshop's several selections), Play plays each box's band over its time (the library's highpass, lowpass, crop, pad, mix: heard.js boxed), Delete takes each out in one step, the palette acts on all; with a band, the caret and the playhead run through the band alone, which is what plays.
- **Handles,** small dark squares on whole pixels (crisp at any pixel ratio), notched flush with the top and with the line they sit by (the caret, which a range's start has; a range's end, its last pixel, lit over the square as it would move), never over it, the corners on the selection's top and edge square, those free of it round; a glyph in each, bright under the pointer, each saying what it does, each clicked to turn it to its next way, as a tool's options cycle, no menu (menus are the right-click's), and dragged to do it (what is only clicked, crop, is in the context menu); none while it plays: the fade corners drawn as their curve (inward a fade, outward the audio past the edge goes, crossfading into the range; a click, the next curve, its name said: Fade out, exponential); the pill on the top edge, up or down, its level in steps (1 dB by default); the tools at the foot, side by side from the middle, a voice's pitch, intonation and formants, each up or down; the grip just past the end, a square's height off each lane's foot (off the middle, where the sound is; low, as Audacity's speed handles, the lower pair with a clock, its top pair trimming, and Cubase's and Nuendo's lower corners with Sizing Applies Time Stretch; Logic Option-drags a region's right edge, FL Studio Shift-drags a clip's edge), its length (a click, the next): trim, as Audacity's ▷] (back, the audio there goes, the seam crossfaded; out, silence added), stretch, ↔, the pitch kept, or speed, as Audacity's clock, the pitch following, with a pointer of its own (arrows out from a wave), not the edges' resize arrows. With nothing selected, a square past the caret, with trim's glyph and pointer (it does what trimming out does), pulls silence open there (insert()), snapping as every drag does; silence opened is drawn by the pictures as silence (a piece at no level: the waveform's centre line, the spectrogram's nothing), data in the data's colour, never a helper's. A selection's edge under the pointer says which it is and where. No outline round the selection: its wash and its edges say where it is.
- **One way to write numbers:** a time reads the same on the clock, the time row, the pointer, the edit tags and a range's length, in the units the settings choose (playground/time.js); a value's unit follows it with no space (−1.0dB, 44.1kHz, 0.5s).
- **The panel** opens docked beside the picture at its right, part of the slab (no line between, no card, no title: its button, lit, says which), the picture keeping where it starts and its scale (it shows less of the sound, never squeezed), its left edge dragging its width (kept, a grip on it): **Edits**, its own button, the chain's steps as a rack of compact cards as wide as the panel (mel's modules: its own icon, playground/icons.js, the name, what it is set to, as far as the card's edge, cut short there) from the sound they start from, the one chosen open to its settings and the output shown up to it (as a history state; going back to a card is choosing it, an edit then made after it), its two acts over its right end where the pointer is, what it is set to fading under them: an eye that turns it off, × that takes it away; open, its Δ, what it takes out, and its settings, a slider each, each saying what it does and which way to move it when pointed at (playground/help.js: a sentence for every setting of every edit, plugins' too, which the tests keep), those few touch folded under Advanced (RX's De-click shows Sensitivity and Click widening, CEDAR's one threshold; here declick shows its threshold and folds five); Add an edit right under the last; the card under the pointer draws what it sets on the picture; with the output rolled back to a card, an edit made goes after it, the steps after it dropped in the same step, as a browser drops the pages ahead (undo brings them back); an edit from the context menu edits in place, the panel staying shut; **Settings** (over the meters, the view's), what holds everywhere, each group with what it is for in a few words: what shows over the sound, snapping, how a held caret sounds (the lab's eight), the units of time and of level (sample values by default), level steps, splices, the time row, the agent's bridge and key; **Code**: the same chain as the script, an edit a line each, its numbers dragged across (Tangle's scrubbable numbers: a step of the last decimal for every 4 px, Shift ten, the output following, one undo step), a double-click selecting a whole number for ↑ ↓ to step (a spin box's; Shift ten), each saying what it sets, pointed at, selected, dragged or stepped (its method, its parameter, its value and unit, the range its slider has); **Export**, three forms a rule apart: the file (its format, what it is written with as a field each, a lossless one's bits, MP3's bitrate, Ogg's quality, the library's encode options; the markers in it or not, a switch, a WAV's cue points, an MP3's chapters; its name and extension; the act with the file's size where it is known); the edit list for a video editor (the cuts as EDL, OTIO or FCPXML at a frame rate, the library's cuts()); the check against a delivery spec (rule, the result, the limit: the export's preflight); **Scenarios**: a goal's whole chain, found by its words, put on the sound open (playground/recipes.js, .work/recipes.md); **Agent**: the user's own agent (Claude Code or Codex, the bridge's choice as it starts) through the local bridge (npx audio --bridge; playground/agent.js), the chat its words as Markdown (playground/markdown.js), each call it makes said as the user would say it (playground/doing.js: what it does now, then done or refused in its place among its words, what it came to beside it, its place on the sound or its edit a click away), the seconds a turn has taken, the tab's conversations kept with it and a click away, the page's tools its hands (state, measure to measure anything without a change, through the edits too (step(i): the sound before and after one, what it takes out, where a range of the output was as it entered it), look for a picture of the waveform over the spectrogram, or of the output up to an edit or what it takes out, script, edit, select bringing the caret, a range or a box of a band into sight, scrub sounding the caret as it moves, step turning an edit off (over a range alone, too), removing, moving or rewriting it, open reading a file of the user's through the bridge, play with the original level-matched, check, undo, redo), each edit answered once its run ends. The head over the slab: over the picture, the open sounds (tabs dragged to reorder, each showing its own last sound at once; a selection dragged up onto them with Alt a tab of its own, with ⌘ moved there, the rest closing up), undo and redo, the picture's switch and its options' chevron, and over the meters the settings; over the panel, at the slab's top right as an editor's activity bar, the panels' buttons (edits, code, export, scenarios, agent).
- **The settings** are a dropdown under their button over the meter, not a panel (a panel for a handful of choices flung the sidebar open and shut) and not a menu of submenus: every group in sight, its choices as keys, what the chosen one does said under them. How a picture draws is its own, the same kind of dropdown from a right-click on its switch: the waveform's colour, lanes, fill and levels (dB or sample values); the spectrogram's method (frames, reassigned, squeezed, by band, tapers, Wigner–Ville: gl-spectrogram, after the lab's Seeing sound), frequency scale (octaves, mel, ERB, hertz), colours, gamma, range and FFT size. The agent's bridge (address, key) is in the Agent panel, where it is used.
- **A selection** is one highlight in both pictures, a wash over it, nothing around it darkened; a spectrogram's lanes take a stronger wash (16% against 5%), as its speckle hides the lift a waveform's even ground shows.
- **Groups:** a recipe of several calls goes in as one group (code.js groups: its name a comment on a line of its own, its calls set in under it), one card of the edits, folded; unfolded, its steps; its eye and × act on all of them.
- **An edit lands at once:** a script that is the last output's with calls added after it (an edit on the picture, a recipe, a step typed at the end) renders those calls on the last output's samples (worker.js rebased), the rest passed through block by block: a band taken out of 30 s after a 2 s noise reduction lands in about 80 ms, not 1.6 s. The same samples as the whole script (a test, to 1e-6), the same source and edits before them; anything else renders whole. An output as long as the one shown comes in over it as it renders, drawn only where it differs (view.patch, gl-spectrogram's set()); nothing freezes, nothing else is drawn again. Not yet: a change to an earlier step renders whole (a step's output kept, the chain going on from it, would land that at once too).
- **Files held over the picture** show where they go in, a caret of their own, and go in there (insert at that time, the seams crossfaded); over the tabs, into a tab of their own.
- **Speed** (the pitch kept: the library's `preservesPitch`, WSOLA in the deck, as a browser's media element): Play held and dragged across sets it (a scale over Play, 0.1× to 10×, a doubling each 32 px, the pointer hidden), kept; right-clicked, a list; shown by Play (WORKSHOP: a readout, a pill turning 1×, 1.5×, 2×, a slider, a ring). Playing and recording are one or the other.
- **Skin** (playground/skin.css): every colour, size and shadow the editor draws with, one file over the site's tokens; another skin (a Winamp skin read in, an editor's colour theme) is another file setting the same.
- **Tracks:** sounds side by side in time, each its own chain, played and exported as their sum (worker.js mixTracks: the widest padded to the longest's end, the others mix()ed in; another rate resampled to the first's). In the script, each a sound declared, `let voice = audio(…)`, that nothing else reads (code.js tracks): what another reads (a mix's source, a noise print, a reference) feeds it, no track. A lane each, its channels averaged, its name at its top left (RX's track headers; no stereo lanes there either), its end a rule; the one edited (a press in its lane; code.js focus) holds the caret, the selection, the handles, the gain and pitch lines, the edits drawn ahead and the cues, and its chain is the Edits panel's (its first card `name · file`) and every edit's. Move to a new track (Edit, right-click, ⌘P) takes a range to a track of its own under it, where it was: its chain as it stands, crop() and pad() (Audacity's Split New), silence left where it was (gain(−∞)), so the two sound as the one did; Open as a new track (File) adds a file; Delete the track. Each track made as an output is, kept by its own edits: one edited renders alone. Past the samples the page holds, each lane from its picture, its samples fetched where it zooms in. Not yet: mute and solo, recording into a new track, a piece dragged between tracks, a track's start dragged (its pad).
- **Markers** stand over the picture, a flag at the top of each line as a timeline's markers stand over its tracks; a double-click names one where it is (mark(t, label)), its right-click names it or takes it away.
- **A press held** half a second still is the caret's, as a touch's long press puts a text's caret (iOS): dragged, no selection, the sound under it heard.
- **Hints** (hint.js): one layer, over everything, of a few words by what they are about, for whoever has them: the code's numbers, what a drag on the picture does as it goes, what a handle or an edge does, a switch turned. Each hides only its own; its look is a theme's (editor.css .hint).
- **Pitch** in its own context (View, Edit pitch), on the spectrogram, which the picture turns to (and back to the waveform after, if it turned): the pitch curve (pYIN's Viterbi path every 10 ms, a frame under 0.03 of the peak silent, as Praat; 85% of Praat's voiced frames on a lecture, 10 cents from it, where the YIN before it found 36%) drawn on the voice's harmonics, never over the waveform. Dragged up or down, the whole pitch line moves with it (a stretch dragged alone, between points at its voiced edges, left its edges at their pitch where the voice went on past them: up, then down); a click on it makes a point of the line there, the line's as the gain line's, so a point between two bends what is between them; a double-click takes it away. The line is one pitch() curve, a voice's ({ voice: true }: its cycles re-spaced, formants kept), the chain's last step; its points sit on the curve, which shows the line's change since the output was measured at once. A selection's tools, side by side at its foot (the pill on its top edge stays its level; more tools to come there): a voice's pitch (a range's pitch(), whole semitones, ⌘ cents, the note it goes from and to), its intonation (intonation(): rises and falls about the median, half a lane twice as wide or a monotone, by 0.05; Melodyne's Pitch Modulation, Praat's pitch range factor) or its formants (formant(): the spectral envelope moved, the pitch kept; half a lane an octave). Each heard as it will sound from its first move, at 0 too, the first 2 s through the library's own, made in the deck's worker, playback's own, which the engine's processing never holds up (player.js audition, worker.js voice, engine.js deck; with no engine to make it, the page loads tune-curve and stft through editor.html's import map). On the waveform, the pitch line itself, the gain line's twin on its own scale (half a lane an octave, whole semitones, ⌘ to the cent).
- **Past the end:** silence pulled open at the end (the caret's square before it there), audio moved or a range trimmed out past it: out at the picture's right edge the view widens a frame at a time, so it goes as far as it is pulled.
- **A crossfade dragged** out of a corner is drawn as it will sound: both sides over each other across the seam, centred on it, on their equal-power curves (remove()'s splice).
- **The palette** (⌘K or ⌘P, Add an edit, the menus), a notch over the picture, as Sublime Text's and VS Code's: the edits for what is selected first (the band, the boxes, the ranges, the selection, the carets), then every method by kind, found by typing, the arrows and Enter to take one. It replaced the Tools tab; the way to a contextual mode with no panel at all.
- **Bottom bar,** along the whole foot, one row, a status bar as an editor's: play, record and loop, as a deck's; the time, one always, the caret's or the playhead's (the ranges are on the time row), and after it how long all that is selected is, marked as a length (WORKSHOP), pointed at the selection and its samples; what is happening (a note, a problem in red with what to do, a file loading, an output rendering and how far); the levels, apart by spaces, no dots; the rate and channels a click away from resample (the standard rates, audiojs/sample-rate, each with what it is for) and remix (mono, stereo, 5.1, 7.1: down by the ITU-R BS.775 matrix, up from mono into the centre, from stereo by the surround() matrix upmix).
- **An edit on the picture holds still:** drawn at once where it goes (a delete closing up, a move, a stretch, silence opening), and its output takes the picture's place without a move: the view where it was, at its scale (past the sound's end if it got shorter), the cues, markers and clips moved with the audio. An output such an edit is waiting for is not drawn as it arrives, which would flash the picture back: it comes whole. Only a new file shows all of itself.
- **Files opened here are kept** in the browser's own file system for the site (OPFS, playground/keep.js) by the name the script calls them, so a reload opens them again, nothing asked; those no tab opens go. A copy streamed to disk, never whole in memory, written whole or not at all (createWritable swaps in on close), read back as a File that reads from disk; a recording as a 32-bit float WAV. Within the site's quota (Chromium 60% of the disk, Firefox 10% or 10 GiB until persisted, Safari about 60%; MDN), persistence asked for. Tried and dropped: a dropped file's handle (nothing copied, but the browser asks again for it after a reload). One not there says so, with Open it…, and the file opened takes its name.
- **Recording** goes into the picture as it comes (a waveform, or a spectrogram where the spectrogram shows), at the view's scale, the view following it with its head held clear of the meters, which read the microphone, as a recording app's; into nothing, 10 s across. Space stops it, as it stops playback; stopped, the caret waits at the take's end, as a tape's head, so Record again records on (Audacity's R appends the same way); the take is not selected, as a selection would make the next Record a retake into it. The microphone opens on Record's press, its click following; Record blinks, armed, until it answers (Pro Tools' record key), then holds steady while it records, the take's length after the time. As a dictaphone's: over the output from the caret, or the selection's start, what it covers replaced and the end extended past, a tape's punch-in (one write() step, undone as any edit); into a selection it stops at its end, and with the loop on it records pass after pass there, each replacing the last (a looper's, the OP-1 tape's). With nothing open, the take is the sound. Industry: DAWs record new clips over the timeline (overwrite by default, Logic's cycle recording keeps each pass as a take); Audacity's punch-and-roll overwrites from the cursor; voice recorders offer overwrite or insert. Not yet: takes kept per pass, an insert mode, monitoring the rest while recording.
- **The wheel scrolls,** as it does everywhere; a pinch, or Ctrl and the wheel on a mouse, zooms the axis under the pointer (the frequencies over them or the spectrum, the levels over them, time elsewhere). Shift pressed while dragging the caret makes the drag a range from where it was pressed. Lines drawn in the lanes (cues, the caret) fade where the pictures fade, never across the spectrum or the labels. Esc closes an open menu and nothing else.

The panel opens and closes from the top right and the View menu, and is remembered; closed, the output has the whole block. What goes wrong when the script runs shows after the time, in red, and at its line in the script.

## What to build next, by what it saves the user

1. **The tone wand and harmonics** (§1). Whistles, rings and hum are single tones.
2. **A step's frequency response on the spectrogram**, drawn at once as its level is on the waveform (EQ, filters), then the EQ graph on the frequency axis (§5).
3. **Pictures from the library's index** (§3): the waveform from its per-block stats and the time map of its plan, samples fetched only where zoomed in, so an hour draws at once.
4. **Guides that drag:** a step's level or frequency line, under the pointer among the edits, dragged on the picture as its slider is.
5. **Themes:** the tokens a theme sets (colours, fonts, the hint's look, the waveform's look, icons) and its slots (the playbar fixed or floating, the tabs over the picture or down its side, dividers); a Winamp skin (.wsz: the transport's and digits' sprites, viscolor.txt's 24 colours, pledit.txt's) read into them by a plugin, as Webamp reads them.
6. **Tracks,** folded to look as now: a lane group each, its own chain, mixed; recording into the track chosen. **Record from:** the microphone, the tab's or the system's audio, text to speech, text to music (providers as plugins, the user's key).
7. **Groups in the library:** a recipe over a range is its calls each over the range, so one that changes the length (trim, shrink) shifts the range of the calls after it; a group as one op of the plan (its calls run on the range as a clip, spliced back) would fix that, and give the agent and the CLI the same unit the edits fold (code.js groups: a comment over its calls, set in).
8. **Recipes,** beyond the panel there is (found by words, folded by purpose, .work/recipes.md): save a chain as one, share, credit its author; a registry, as the plugins'. **Agents,** beyond the chat through the local bridge (npx audio --bridge: Claude Code or Codex driving the open tab's tools): the user's own key in the page, recipes named to the agent as its guides.
9. **Plugins:** the next milestone.
