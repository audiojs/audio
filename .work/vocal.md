# Vocal tuning against VOCALTUNER, Melodyne and Audimee

What a voice's pitch tools do here, against [chjogit/VOCALTUNER](https://github.com/chjogit/VOCALTUNER) (1.0.0, commit 325f0cb, read in full, not built or run), Melodyne's pitch tools and [Audimee](https://audimee.com)'s two editors (§8). VOCALTUNER refs are `path:line` in its repo; ours are paths in this one. What to build from all three, in order: [Parity](#parity-what-to-build-in-order).

**Status:** ✅ we have it · ◐ partly · ✗ missing · ⊘ not wanted (the reason is given) · ★ we have it and the tool compared doesn't

## Verdict

Ours covers VOCALTUNER's pitch correction and goes past it in the parts that decide how a corrected voice sounds: formants (it has none), resynthesis (it runs WORLD over every 10 s chunk that holds an edit; we re-space the voice's own cycles and pass everything else sample for sample), scales (it has major and natural minor), note segmentation (Tony's HMM against slope-peak heuristics), retune speed and tolerance (it has neither), and persistence (it saves no edits at all). With `modulation`, `drift` and `center` added here, Melodyne's three pitch layers are ops, measured apart.

It is stronger in three places, all editor or alignment work rather than DSP: a guide mode that aligns a double's syllables and pitch to a reference track (DTW on MFCCs, Whisper lyrics as anchors), note editing in the roll (cut and join notes, move and stretch them in time, a handle per curve extremum with a time warp), and edits mirrored across tracks. None of those exist in our Notes view yet; the engine has the parts for all but the DTW alignment.

Audimee's 2024 pitch editor has a note's pitch, a Vibrato and a Pitch (tuning strength) knob with a key, Vibrato and Drift modes per note, and a Cut mode that splits notes. Its pitch layers are all ops here; what it has that we lack is the gestures: splitting a note, tuning a take to a key with one control. Its Text to Vocals editor (October 2026) sings with a model (lyrics, phonemes, re-singing, breathiness, singers), a different job from editing a take, except for four things that carry over: a vibrato's rate, note timing in the roll, harmonies from one voice, and MIDI out.

## Parity: what to build, in order

Every gap the three tools show, ordered by what a singer's take needs first. A row is here for an edit a singer makes, not to close a table ([editor.md](editor.md)'s rule). Each names who has it, what our engine already does, and what is left. Tick a row when its gesture ships with a test. Status read from the code on 2026-11-10.

Sources: VOCALTUNER and Melodyne as in §1 and §4. Audimee as in §8: **seen** in a saved screenshot, **text** from a vendor page or its video's captions, **code** only a string in its client JavaScript.

### 1. The op exists; the Notes view lacks the gesture

- [ ] **Tune a take to its key, with a strength.** Audimee: the Pitch knob and key menu, its Quick Tuning card (seen); Melodyne: Correct Pitch; VOCALTUNER: Pitch Balance. Ours: `center(k, { scale, root })` and `tune({ scale, root, strength, speed, tolerance })`, palette only; the status bar reads the key already (`listen()`, repl/editor/readouts.js). Left: one control on the notes (the selection, else the take) that starts at the key read, its strength dragged as the foot tools are, the scale's rows drawn while it is held (`guides()` draws them for `tune`, repl/ops.js).
- [ ] **Centre a note on its semitone in one gesture.** VOCALTUNER and Melodyne: double-click a note; Audimee: double-click snaps every note to the key (text). Ours: `center(0, { at, d })`, palette only. Left: the gesture. A double-click selects the fragment everywhere else in the picture, so either a double-click on a note alone does it, said in the help, or a key does.
- [ ] **Split and join notes.** Audimee: Cut mode, a click splits a note and the parts move apart (tab seen, gesture text), and Text to Vocals' slicer (C) and tie (L) (code); VOCALTUNER's cut tool; Melodyne's note separation. Ours: Tony's notes as found. The engine needs nothing: a part of a note is a range, its edits ranged ops. Left: a split kept with the tab where Tony found one note and the singer sang two, each part then pressed, dragged and heard alone; a join, the reverse.
- [ ] **Move a note in time, stretch its edges.** All three (Audimee: Text to Vocals, code). Ours: `warp([[from, to]])`, `stretch(f, { at, d, voice: true })`, no gesture. Left: §6 "Time": a note dragged sideways writes warp markers at its ends, the neighbours' far ends held; its edge dragged writes the stretch.
- [ ] **Vibrato depth and drift as tools at the notes' foot.** Melodyne's Modulation and Drift tools; Audimee's Vibrato and Drift modes (seen); VOCALTUNER's. Ours: `modulation(k)`, `drift(k)`, palette only; the foot has intonation and formants. Left: the two tools as §6 designs them (detents at 1 and 0, a double-click toggling, each note's curve drawn as it will be).

### 2. Engine work first

- [ ] **A vibrato's rate.** Audimee Text to Vocals: a Speed knob, 3 to 8 Hz (code); VOCALTUNER: 3.5 to 8 Hz on its synthetic vibrato. Ours: depth only. `layer()` (fn/intonation.js) already parts each note's vibrato from its line; the rate is that part read faster or slower, its phase continuous, its depth kept.
- [ ] **Vibrato on a note sung straight, faded in.** VOCALTUNER: a sine, faded in over min(0.3 × length, 0.25 s) and out (§1). Ours: the `vibrato` effect, a delay line over the range (rate, depth), blind to the voice and its notes, no fades. Left: a voice op adding a faded sine to each note's line, depth in cents, rate in Hz.
- [ ] **Transition length per joint (portamento).** VOCALTUNER: a dot at each joint; Melodyne: the pitch transition tool; Audimee: none found. Ours: a fixed 100 ms crossover in the note ops. Left: the crossover as a parameter, then a handle at the joint.
- [ ] **Draw the pitch freehand.** Audimee Text to Vocals: Draw pitch (D) (code). Ours: the pitch line's points, the whole curve dragged, Praat's bends as handles. Left: a draw gesture writing one `pitch()` curve, the pointer's path simplified to points.
- [ ] **The notes to a MIDI file; MIDI in as a guide.** Audimee: MIDI export on every plan (seen in its pricing), import keeping notes, timing and velocities (code); Melodyne exports MIDI. Ours: `stat('notes')` carries each note's MIDI number, with no .mid writer; `@audio/tune-midi` tunes to a MIDI guide, imported directly, not in the registry. Left: a Standard MIDI File writer behind `save('x.mid')` and the export menu, then tune-midi registered.

### 3. New jobs

- [ ] **Harmonies from one voice.** Audimee's Harmony maker: up to 5 harmony tracks from a recording, 35 presets, pitch and timing varied a little, under 75 s of audio (text). Ours: none, but the parts are here: `pitch(…, { voice: true })`, tracks, the key read, `center`'s scales. Left: a shift per note within the key (a third above is 3 or 4 semitones by the note), each harmony a track of its own.
- [ ] **Doubles, varied in time and pitch.** Audimee: unison layers in Text to Vocals (synthesised), variation in the Harmony maker. Ours: `chorus` and `microshift`, detuned copies with no timing variation. Left: a double as a track, its timing warped by a slow random curve of some tens of ms, its pitch by a few cents.
- [ ] **A double aligned to a guide track.** VOCALTUNER's guide mode (§1). Ours: `align(ref)`, one lag and a rate. The largest engine gap, a module of its own: banded DTW on MFCCs and frame classes, lyrics as optional anchors, then each note's pitch to the reference's.
- [ ] **A tempo grid, notes snapped to it.** Audimee Text to Vocals: BPM, time signature, grid and snap (J) (bar seen in thumbnails); Melodyne: a time grid. Ours: the tempo read in the status bar, the ruler in seconds, snapping to cues and markers. Left: bars from the tempo and the first downbeat, a snap target beside the cues.
- [ ] **Edits linked across tracks.** VOCALTUNER copies an edit's deltas onto the overlapping blocks of other tracks. Ours: a range through every track applies the op to each, each analysed on its own (§2).

### ⊘ Not for an editor of recordings

Audimee's Text to Vocals sings with a model: lyrics and phonemes per note, Re-Sing, singers, Tension and Breathiness from −100 to +100, synthesised unison layers (all code; the Expression and Re-Sing buttons seen). Its Convert page swaps the voice for another (216 voices, or your own trained one). Each needs a singing or conversion model, not an edit of the take. The one that could return for a recording is breathiness: it needs the voice parted into periodic and aperiodic sound, which `stat('harmonic')` measures and no op edits.

### Where we lead: keep it so

- Formants moved, the pitch kept: Audimee has none, VOCALTUNER none.
- The voice itself heard as it will sound while a note or a tool is dragged (repl/editor.js, the audition of a drag); Audimee plays a preview tone (text).
- A melody's rises and falls wider or flatter (`intonation`), and its drift, vibrato and centre apart, measured (§5); Text to Vocals has no drift.
- Praat's bends as handles on the pitch curve, and a pitch line of points.
- Several pitch-shift methods, the voice's own cycles re-spaced, unvoiced audio passed sample for sample (§3).
- Timing by onsets (⌘-drag a cue, the audio either side stretching to it), a part lined up with a reference (`align`).
- Every edit a line of the script, kept with the tab; VOCALTUNER saves none.
- The user's own machine, any length: Audimee's Convert takes 7 minutes at most (seen), its Harmony maker under 75 s.

## 1. VOCALTUNER: what it is

An ARA2 Event FX VST3 for Studio One on Windows (JUCE, WORLD, optional whisper.cpp), AGPL-3.0. No host parameters, no MIDI in or out (`Source/PluginProcessor.h:26-27`), and **no edits saved with the project**: `doStoreObjectsToStream` and `doRestoreObjectsFromStream` return `true` and do nothing (`Source/DocumentController.cpp:19-29`); a reopened song is analysed afresh and its edits are gone.

### Analysis

| What | Method | Ref |
|---|---|---|
| Pitch | WORLD Harvest, frames every 5 ms, 71 to 800 Hz, in 10 s chunks with 1 s overlap, run in parallel | `Source/Analysis/VocalFeatures.h:11-25`, `VocalFeatures.cpp:59-79,146-184` |
| Level | RMS over 2048 samples centred on each frame, normalised to the take's peak | `VocalFeatures.cpp:116-138` |
| Notes ("blocks") | voiced runs ≥ 60 ms, bridged over ≤ 40 ms gaps; split where the 11-frame median-filtered pitch's slope (3-frame gradient) peaks over 0.22 st a frame, peaks 12 frames apart; then split again, recursively, where the two sides' means (21-frame median) differ by 0.9 st, each side ≥ 100 ms | `Source/Analysis/BlockParser.cpp:101-135,138-174,178-210`, options `BlockParser.h:44-68` |
| Consonants | unvoiced frames over 0.02 RMS (−34 dB), 40 to 150 ms, before or after a voiced run, as blocks of their own whose pitch is fixed | `BlockParser.cpp:215-227,281-328` |
| Note centre | the median of the block's voiced frames, split into a semitone and an offset | `BlockParser.cpp:239-253` |

### Correction (each a per-block number, applied when drawn and rendered)

| Tool | What it computes | Ref |
|---|---|---|
| Move | the whole block by semitones; the drag snaps the block's centre to the absolute semitone, Shift or fine-drag free; ±48 st | `Source/UI/PianoRollEdit.cpp:570-586`, `BlockTransforms.cpp:330-339` |
| Double-click: snap | `pitchShift = round(centre) − centre` | `BlockTransforms.cpp:330-339` |
| Pitch Balance: centre | `tidy × (target − centre)` added to every voiced frame, shape kept; target the nearest note of a key, major or natural minor only, chromatic by default; a 5-cent "leave alone" toggle | `BlockTransforms.cpp:213-219,771-812`, `Source/UI/PitchBalancePanel.cpp` |
| Default correction | every block starts with tidy 5%: an edit nobody asked for, on by default, toggled per track | `BlockParser.h:35`, `BlockTransforms.h:47,757-769` |
| Pitch Balance and tool: drift | `drift × (centre − mean of the curve over ±20 frames)`; −1 to 1 | `BlockTransforms.cpp:226-255` |
| Vibrato | depth in absolute semitones (0 to 1.5), rate 3.5 to 8 Hz. Where the block already has vibrato (half-range ≥ 0.25 st over ±20 frames), its swing about the midpoint of its local min and max is scaled to the depth, at most 1.5×; where it has none (< 0.1 st), a sine is added with fades in (min(0.3 × length, 0.25 s)) and out (min(0.15 × length, 0.1 s)); blended between | `BlockTransforms.cpp:257-287` |
| Flatten | `flatten × (centre − pitch)` per frame: vibrato and drift together | `BlockTransforms.cpp:205-210` |
| Bake | on mouse-up the shape tools are written into the per-frame curve offset and reset to 0 | `BlockTransforms.cpp:294-309` |
| Curve handles | handles at the curve's extrema (zigzag over a 7-frame mean, 0.3 st threshold, 6 frames apart) and the block's ends; a drag moves the handle with a raised-cosine falloff to its neighbours, up/down in semitones, left/right as a time warp limited to 60% of the gap; double-click adds or removes a handle | `BlockTransforms.cpp:82-113,655-755` |
| Transitions | between voiced blocks ≤ 120 ms apart, the two shifts cross by a smoothstep over up to ±120 ms × `transitionAfter` (default 0.5), dragged on a dot at the joint | `BlockTransforms.cpp:142-186`, `BlockTransforms.h:10-11`, `PianoRollEdit.cpp:635-641` |
| Volume | ±24 dB a block, blended across touching blocks | `BlockTransforms.cpp:364-386` |
| Timing | a block or a group moved, or its outer edges dragged to scale it; neighbours pushed; the largest valid fraction found by bisection | `BlockTransforms.cpp:424-564` |
| Cut and join | a double-click with the cut tool splits a block, or joins two within 40 ms | `Source/Analysis/BlockEditing.h:9-39` |
| Linked tracks | an edit's deltas copied to overlapping blocks of other editable tracks; snap re-snaps each to its own semitone | `BlockTransforms.cpp:566-653` |
| Retune speed, humanize, tolerance per note | none: every correction is a static offset per block | |
| Formants | none; WORLD keeps the spectral envelope, so a shift keeps the formants, but nothing moves them | |
| MIDI guide | none | |

### Guide mode: a double aligned to a reference track

The guide is another audio track in the same ARA document. Per track: log-mel MFCC (26 bands, c1 to c12, mean and variance normalised), energy, flatness and high-band share every 10 ms (`Source/Alignment/SpectralFrames.cpp:157-217`); frames classed silence, voiced, breath or unvoiced (`SectionClassifier.cpp:64-97`); optional Whisper words, matched by LCS on characters and filtered for outliers, as a guide line through the DTW band when there are 8 or more (`WordAnchors.cpp:28-110`); banded DTW within ±1 s (±0.4 s along the lyric guide), cost the MFCC distance + 0.5 × energy + 1.5 for a class mismatch, step penalty 0.15 (`TimeWarp.cpp:25-229`). The fit moves each block's start and end by `amount × (mapped − current)`, and shifts each voiced block to the reference blocks' overlap-weighted pitch, rounded to the octave (unison) or the semitone (harmony), octave errors folded (`ReferenceFit.cpp:5-131`). Whole-block pitch only; the curve inside a block is not followed.

### Resynthesis

`Source/Render/EditRenderer.cpp`. The edits are scattered onto a 5 ms grid of target pitch, source frame and gain (`:34-97`). The take is cut into 10 s chunks with 0.25 s pads, crossfaded sin²/cos² (`:114-126,286-310`). A chunk where any frame moves pitch by more than 0.12 st or reads another source frame is rebuilt whole by WORLD (CheapTrick envelope, D4C aperiodicity, Synthesis at the target F0), its consonants and breath included (`:99-110,257-284`); only a chunk with no change is the original. Time edits re-index the 5 ms frames (`:34-44`). WORLD's output is matched frame by frame to the source's RMS over ±12 ms, gain clamped to 0.1 to 4, smoothed over ±3 frames (`:189-231`), then soft-limited above 0.9 (`:166-178`). The README's "unedited sections use the original audio" holds per 10 s chunk, not per note.

Playback renders the whole source on a background thread once the block list has settled for 250 ms and crossfades to it over 20 ms; a held note renders its own span for audition (`Source/RenderCache.cpp:7-8,87-189`, `Source/PlaybackRenderer.cpp:19,101-147`, `Source/RenderCachePreview.cpp`).

### Editor

Modes Blob, Curve, Rhythm (Ctrl+1/2/3), tools 1 to 4 per mode, Ctrl+4 the Pitch Balance panel (`Source/UI/PianoRollView.cpp:94-293`). Fine drag ×0.1 with Ctrl held mid-drag (`PianoRollEdit.cpp:555-561`). Label over a block: note name and offset in hundredths of a semitone (`PianoRollDraw.cpp:471-473`). Undo: whole-block snapshots, 100 deep (`Source/Analysis/AnalysisManager.cpp:177-242`). No scale overlay on the roll, no beat grid, no snap in time. `lyric` is never set, so lyrics are never shown (`BlockEditing.cpp:104`).

## 2. Coverage

| VOCALTUNER | Ours | Status | Note |
|---|---|---|---|
| Pitch track (Harvest, 5 ms) | `contour()` (pYIN Viterbi, 5 or 10 ms), `fn/pitch-detect.js`; `stat('notes', { robust })` a neural first stage | ✅ | Not compared against Harvest here |
| Note segmentation (slope peaks, plateaus) | Tony's note HMM (`@audio/pitch/pyin` `notes`), the Notes view's (`repl/worker.js` `notes`) and the new ops' | ✅ | A published, evaluated model (Mauch et al., TENOR 2015) |
| Consonant blocks | unvoiced audio passes untouched by every voice op | ✅ | No consonant "notes" to edit |
| Move a note, snapped to its semitone | the Notes view's drag: a note sung apart (30 ms of quiet or more either side) a `pitch()` curve stepping in the quiet, moved from its first cycle to its last; a note tied to the next, `pitch(st, { at, d, voice: true })`, gliding as a voice does (repl/view/gestures.js `apart`, repl/editor/writers.js `stepped`) | ✅ | Was ◐: every range glided in over ~90 ms |
| Double-click: centre on its semitone | `center(0, { at, d })` | ✅ | From the note's first frame after silence (measured below) |
| Pitch Balance: centre %, key, tolerance | `center(k, { scale, root, a4 })` (`fn/intonation.js`); `tune({ scale, root, strength, speed, tolerance })` (`@audio/tune-snap`) | ★ | 11 scales or any degrees, against major and natural minor |
| Drift −1..1 | `drift(k)`, any k | ★ | Separated by the vibrato's own period, measured below |
| Vibrato depth, natural or synthetic | `modulation(k)`: a ratio of the note's own | ◐ | A ratio, as Melodyne's: can double a vibrato (VOCALTUNER caps the natural one at 1.5×). No synthetic vibrato on a flat note, except `pitch(t => d * Math.sin(2 * Math.PI * f * t), { at, d, voice: true })` without fades |
| Flatten | `modulation(0).drift(0)` | ✅ | |
| Retune speed, humanize | `tune({ speed })` | ★ | |
| Curve handles with falloff and time warp | the pitch line (`repl/editor.js` `pitchline`, `curveEdit('pitch')`): points, straight between; the curve's bends (Praat's stylization, 2 st, repl/view/model.js `stylize`) as hollow handles, one dragged bending the voice between the handles either side | ◐ | Linear between neighbours, not a raised cosine; no time warp of a point |
| Transition per joint | a fixed 100 ms crossover in the note ops; the pitch line | ◐ | No per-joint handle |
| Volume per note | `gain` over the note's range (`level()` in the editor) | ✅ | |
| Timing: move and stretch notes | `warp([[from, to], …])`, `stretch(f, { at, d, voice: true })` | ◐ | Engine yes; no gesture in the Notes view |
| Cut and join notes | ranges stand in for notes | ◐ | No note editing in the view |
| Formant shift | `formant(st, { at, d })`, true envelope (`fn/formant.js`) | ★ | |
| Resynthesis | TD-PSOLA on the voice's own cycles (`@audio/tune-curve`), unvoiced and unchanged audio passed sample for sample | ★ | See "Better" |
| Guide track: syllable timing by DTW, pitch to the reference | `align(ref)`: one lag and a rate (`fn/align.js`) | ✗ | The largest gap |
| MIDI guide | `@audio/tune-midi` (YIN, per-note PSOLA crossfaded over dry), direct import only | ★ ◐ | Weaker than tune-snap's method; not in the registry |
| Linked edits across tracks | a range through every track applies the op to each (`repl/editor.js` `spread`) | ◐ | Each track analysed on its own, not a copied delta |
| Edits saved | the script is the edit | ★ | VOCALTUNER saves nothing |
| Default 5% centring on every note | none | ⊘ | An edit nobody asked for changes the sound of untouched notes |
| Rendered-artifact finder (`Source/Render/SpectralDiff.cpp`) | none | ✗ | A diagnostic: high band of the render 6 dB over the source's |

## 3. Better and worse, with evidence

**Better.**

- *Separating vibrato from drift.* VOCALTUNER's drift line is a mean over ±20 frames (205 ms, `BlockTransforms.cpp:228`; its comment says ±200 ms, the code is ±100 ms). A 205 ms boxcar passes sinc(f × 0.205) of a vibrato: −11% at 5.5 Hz, −21% at 6.5 Hz, so drift at 100% adds 11 to 21% to such a vibrato (computed from the code, not run). Its own test asks only that a slope fall under 60% plus 0.1 st (`Tests/BlockTransformsTests.cpp:347-361`). Ours finds each note's period and smooths over it twice, a triangle that nulls the rate and its harmonics; measured on a synthetic note (test/pro.js): `drift(0)` leaves 6% of a ±40-cent 0.7 Hz drift and keeps the vibrato within 0.2%.
- *Vibrato depth.* Ours is a ratio of the note's own (Melodyne's semantics, below): `modulation(2)` measured 1.96× at 5.5 Hz. VOCALTUNER's natural scaling is capped at 1.5× (`BlockTransforms.cpp:270`), and its local min and max over ±100 ms span less than a period below 4.9 Hz.
- *Resynthesis.* VOCALTUNER rebuilds every 10 s chunk holding an edit through WORLD, consonants and breath included (`EditRenderer.cpp:257-284`), then rescales its level frame by frame because WORLD comes out louder (`:189-231`). Ours re-spaces the voice's own cycles and leaves unvoiced audio as it is; outside a range the output is the input to float precision (test/pro.js, `ranged: outside it the input (0.0e+0 off)`). Not compared by ear or against WORLD here.
- *Scales, speed, tolerance, formants, persistence*: in the table above.

**Worse.**

- *Guide mode.* We have no syllable-level alignment of a double to a reference, and no "follow the reference's pitch". `align()` finds one lag and a rate.
- *Note editing in the view.* VOCALTUNER cuts, joins, moves and stretches notes, drags handles at the curve's extrema with a time warp, and drags transitions at joints. Our Notes view drags a note's pitch only.
- *Synthetic vibrato.* VOCALTUNER adds a faded sine vibrato to a note sung straight; ours needs a hand-written `pitch()` curve.

## 4. Melodyne's tools for a voice, and ours

Melodyne 5's pitch modulation and drift tools: "100% represents in this case the original modulation or drift", 0% a straight line, −100% "the same curve inverted with its axis unchanged"; dragging down goes to zero, then inverts; a double-click toggles between the original and none; modulation and drift both removed give "an unnaturally flat monotone" ([Celemony help: Pitch modulation and drift](https://helpcenter.celemony.com/M5/doc/melodyneStudio5/en/M5tour_ToolModulationDrift_2)). The new ops take those semantics: factor 1 as sung, 0 flat, −1 inverted.

| Melodyne | Ours | Status |
|---|---|---|
| Pitch tool: a note dragged, its centre snapped to the semitone | Notes view drag, `pitch()` over the note, from its first cycle where it is sung apart | ✅ |
| Pitch tool double-click / Correct Pitch: pitch center | `center(k, { scale, root })` | ✅ |
| Pitch Modulation tool | `modulation(k)` | ✅ |
| Pitch Drift tool / Correct Pitch: drift | `drift(k)` | ✅ |
| Pitch transition between notes | 100 ms crossover in the ops; the pitch line | ◐ |
| Formant tool | `formant(st, { at, d })` | ✅ |
| Amplitude tool | `gain` over the note | ✅ |
| Time tool (move a note, stretch its attack) | `warp`, `stretch({ voice: true })`, no gesture | ◐ |
| Note separation tool | ranges | ◐ |
| Pitch line drawn freely | the pitch line, points | ◐ |

## 5. What was built

All in `fn/intonation.js`, one module for a voice's pitch in layers, each op a whole op taking `{ at, duration, channel, mix }` as intonation did:

- `modulation(factor)`: each note's pitch about its own line, ×factor.
- `drift(factor)`: each note's line about its centre, ×factor.
- `center(factor, { scale, root, a4 })`: each note's centre about the nearest note of the scale, ×factor (0 on the note).
- `intonation(factor)`: unchanged in meaning (the range's pitch about its median), now through the same path.

Method: the pitch, `contour()` every 5 ms over the range and 0.5 s either side; the notes, Tony's (`notes` from `@audio/pitch/pyin`), whose stable state spreads 0.8 st, so a held note stays whole however it drifts (a semitone Viterbi, tried first, split a note drifting across the midpoint between semitones and left the drift in as steps); per note (`layer()`, exported): the centre, the median of its middle half; its line, its pitch less the centre smoothed by a mean over its vibrato period taken twice, the period where its fast part best matches itself between 3.5 and 8.5 Hz (else 5.5 Hz), held past its ends at the median of its first and last period. Moves cross over 100 ms where notes meet (Xu & Sun 2002), rise over 100 ms inside the range where the voice runs across its edge, and start at once where the note starts after silence. The moves are 0 at the range's ends exactly, then `pitch({ t, v }, { voice: true })` renders the range and its context.

Measured (test/pro.js, a vowel through Klatt resonators, centre A3 +30 cents, drift ±40 cents at 0.7 Hz, vibrato ±50 cents at 5.5 Hz; each layer by least squares on the pitch read back):

| | vibrato (st) | drift (st) | centre |
|---|---|---|---|
| as sung | 0.485 | 0.401 | 57.304 |
| `modulation(0)` | 0.026 | 0.383 | 57.304 |
| `modulation(0.5)` | 0.251 | 0.392 | 57.305 |
| `modulation(2)` | 0.953 | 0.422 | 57.302 |
| `modulation(-1)` | 0.456 | 0.361 | 57.298 |
| `drift(0)` | 0.485 | 0.024 | 57.319 |
| `drift(2)` | 0.486 | 0.777 | 57.287 |
| `center(0)` | 0.486 | 0.404 | 56.985 |
| `center(0.5)` | 0.485 | 0.406 | 57.146 |

At 4.5 and 7 Hz, `modulation(0)` leaves 0.026 and 0.030 st of 0.49 and 0.48. C 30 cents sharp goes to 59.972 chromatically and 60.972 (C♯) in D major. Two notes tied by a glide: `center(0)` over the first note's range moved its first 50 ms by −0.291 st (`pitch(-0.3)` over the same range: −0.076, gliding in), left the next note sample for sample, and over both moved them −0.275 and +0.419 with no frame jumping more than 0.373 st across the step (0.505 with the crossover taken out). The line holds 95% of a 0.7 Hz drift, so 5% goes with the vibrato: at −1, 10% of the drift is lost; that is the price of a line slow enough to null the vibrato.

Two defects found on the way:

1. **`contour()` read every frame half a period early.** YIN's difference compares a window with itself a period on, so a frame's pitch is the audio's half a period past its time: an FM tone at 112, 158, 224, 317, 448 Hz matched best 4.50, 3.20, 2.20, 1.60, 1.10 ms ahead, its half periods to 0.05 ms. Fixed in `fn/pitch-detect.js` (`atFrames`): each voiced run read again at the frames' own times; now 0.00 to 0.10 ms. It took `modulation(0)`'s residual from 9 to 20% of the vibrato (more at lower pitches) to 5 to 6%. Every contour user gains: the editor's pitch curve, the notes' pitch, intonation. `@audio/tune-snap`'s `pitchOf` reads pYIN's `track` the same way and has the same offset (not fixed: another repo).
2. **tune-curve follows a voice's own pitch up to a period late.** The next cycle's spacing copies the period of the source cycle the place is in, which before a mark is the cycle ending there. Handed the exact cancelling curve of a ±50-cent vibrato, it leaves 0.026 to 0.042 st. `scratchpad/tune-curve-period.patch` (unapplied, for `@audio/tune`) takes the period half way to the next cycle instead, straight between the cycles either side of the mark; tune-curve's own 14 tests pass with it, and `modulation(0)` falls to 2 to 5%. Some of what remains in that measurement is the test vowel's formant resonators delaying the waveform by about 1.3 ms against the pitch function that made it.

## 6. The Notes view: how each tool should appear

What the notes already carry (`repl/worker.js` `notes`: `f0` every 10 ms, `level`) is enough to draw each tool's result before the audio comes: `layer(st, a, b, hop)` from `fn/intonation.js` gives a note's centre, line and vibrato period at any hop.

- **Modulation and drift: two tools at the foot of the selected notes**, beside pitch, intonation and formants, dragged up or down as intonation is (half a lane up ×2, half a lane down 0), a detent at 1 and at 0; modulation goes on below 0 into inversion, as Melodyne's does. Double-click on the tool toggles between 1 and 0 (Melodyne). While dragging, draw each note's curve as it will be (modulation: `line + k × (f0 − line)`; drift: `c + k × (line − c)`) and say "vibrato ±38 cents at 5.6 Hz → ±19". The same tool again over the same range multiplies its factor (`voiced(name, k, range, (p, q) => p * q)`, as `tone`).
- **Centre: double-click a note** writes `center(0, { at, d })`: onto its semitone from its first frame, all inside kept. Several selected: one call over the selection. A note dragged up or down should snap its centre to the semitone (Melodyne, VOCALTUNER), ⌘ for cents, as it does now.
- **Correct Pitch, for a take or a selection**: a small panel with Center % and Drift % and a scale and root, defaulting to the key the status bar reads (`stat('key')`), writing `center(1 − c, { scale, root }).drift(1 − d)`. The tune grid `guides()` draws for `tune` (`repl/ops.js`) can draw for `center` too.
- **The note drag's onset** (built: §2, "Move a note"): `pitch(st, { at, d, voice: true })` glides in over ~90 ms even where the note starts after silence (measured above: −0.076 of −0.3 st in its first 50 ms). Where the note starts and ends at an unvoiced gap, write the shift as an unranged curve stepping in the gaps (`pitch({ t: [a − ε, a, b, b + ε], v: [0, s, s, 0] }, { voice: true })`), or use `center`'s path; keep the glide only where a neighbour is tied to it.
- **Time**: a selected note dragged left or right writes `warp` markers at its ends, its neighbours' far ends held; its edge dragged writes `stretch(f, { at, d, voice: true })`. The engine has both.
- **Level**: the note's thickness dragged writes `gain` over its range (the selection's pill does this already).
- **Precise pitch line** (in part: the bends as handles, Praat's rather than VOCALTUNER's extrema, linear between them): offer the curve's extrema as the pitch line's starting points (VOCALTUNER's 0.3 st zigzag), and drag a point with a raised-cosine falloff to the points either side rather than straight lines, so the inner shape stays. A point's time warp is not in the engine.

## 7. Left undone

The gaps against the tools are in [Parity](#parity-what-to-build-in-order). In the engine:

- Passing the contour's f0 to tune-curve (it takes `f0`) to save its second pYIN pass: a note op reads pYIN three times (contour, notes, the retuner); 196 s of a take took 9.4 s.
- tune-curve's period patch, to apply in `@audio/tune` after its own review.

## 8. Audimee

Read 2026-11-09 by an agent that neither signed in nor used the app. Its screenshots and their index: `.work/ui/audimee/`, `.work/ui/INDEX.md` (gitignored).

- **Pitch editor (2024)**, a modal in the voice-conversion page: seen in full-resolution screenshots from audimee.com (`pitch-editor-full-modal.png`, `pitch-editor-notes-20s-26s.png`, `pitch-editor-quick-tuning-callout.png`); how its modes work, from the auto-captions of the vendor's how-to video ([F1jQq9hysTs](https://www.youtube.com/watch?v=F1jQq9hysTs), 3 Jul 2024), which are noisy.
- **Text to Vocals (October 2026)**, a note editor that sings with a model: behind a sign-in, so seen only in YouTube thumbnails partly covered by presenters (`ttv-*-thumb.jpg`); its features from UI strings in the public client JavaScript (`audimee.com/_next/static/chunks`), not used. A string there may be flagged off or an alpha's; one thumbnail shows a preview build's URL. No video frames: YouTube refused the downloads.

| Audimee | Ours | Status | Seen |
|---|---|---|---|
| Pitch mode: a note dragged up or down, a preview tone heard (a speaker toggles it), Ctrl to select more | the Notes view's drag, by semitones (⌘ by cents), the voice itself heard as it will sound | ★ | mode seen, gesture text |
| Quick tuning: a Pitch knob (strength) and a key menu, "No Key" by default; a double-click snaps every note to the key | `center(k, { scale, root })`, `tune({ strength })`, palette only; the key read in the status bar, not linked | ◐ | seen; double-click text |
| Vibrato: a knob for the take, a mode for a note | `modulation(k)` over a range, palette only | ◐ | seen |
| Drift mode, for notes sung sharp or flat | `drift(k)` | ◐ | tab seen, behaviour text |
| Cut mode (labelled Point in an older build): a click splits a note, the parts moved apart | none | ✗ | tab seen, gesture text |
| Notes moved, resized by their edges, sliced (C), tied (L), timing locked | `warp`, `stretch(f, { voice: true })`, no gesture | ◐ | code |
| Key and scale: Major, Minor, Major and Minor pentatonic, Blues, Dorian, Mixolydian, Harmonic minor, Spanish, Arabic; the key detected; rows shaded by the scale | 11 scales or any degrees (`SCALES`, repl/ops.js), no Spanish or Arabic; the key detected; rows shaded as a piano's keys, a tune's notes drawn over its range | ◐ | code |
| Tune, per selection | `tune({ strength, speed })`, `center(k)` | ◐ | code (no knob here) |
| Vibrato amount and Speed (3 to 8 Hz), per selection | amount only | ◐ | code |
| Draw pitch freehand (D) | the pitch line's points, the curve dragged, its bends | ◐ | code |
| A pencil adds a note; paint notes (B) lays a run | none | ⊘ | code; a note from nothing needs a singer |
| Expression: Tension and Breathiness, −100 to +100, "As sung" by default | none | ⊘ | code; the button seen |
| Lyrics per note, a phoneme strip (each sound retimed by its edges), a pronunciation dictionary | none | ⊘ | strip seen, the rest code |
| Re-Sing, takes, up to 6 singers, unison layers (4 or 16 by plan, with Spread), harmony presets | none | ⊘ | plan limits seen in pricing, the rest code |
| Harmony maker: up to 5 harmony tracks from a recording, 35 presets, pitch and timing varied, under 75 s | none | ✗ | text |
| MIDI: import (notes, timing, velocities; bends dropped), export (every plan), audio to notes and lyrics | the notes with MIDI numbers (`stat('notes')`), no .mid; `@audio/tune-midi` tunes to a MIDI guide | ◐ | export seen in pricing, the rest code |
| BPM, time signature, grid, snap (J), metronome; tempo and key detected | tempo and key read; a click track (`rhythm`); no grid | ◐ | bar seen in thumbnails |
| Effects for all singers: presets Studio, Radio, Velvet, Vintage, Dream, Arena; Brightness, Compression, De-esser, Saturation, Delay, Reverb | each an op (`tilt`, `exciter`, `compressor`, `deesser`, `tape`, `delay`, `plate`), recipes for whole chains | ✅ | seen |
| Voice parameters overlay: energy, breathiness, voicing, tension (the model's) | the spectrogram, the pitch curve on it | ◐ | code |
| Singer's Range overlay | a melody's compass in the status bar | ◐ | code |
| Convert: the voice to another singer (216 voices, or your own trained on 1 to 30 min) | none | ⊘ | text; a model's job |
| Undo history naming each edit ("Drew pitch") | the script, a line per edit | ✅ | code |
| Formants | `formant(st)` | ★ | not found in captions or code |
| Portamento, vibrato onset, a quantize command | none here either: a fixed 100 ms crossover (Parity §2) | | not found |

Unresolved: its tool page says only paying users get the manual pitch editor; its pricing table ticks it on every plan, Free included.
