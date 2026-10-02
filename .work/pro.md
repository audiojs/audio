# Pro-grade audit

Measured on the 2.6.10 working tree, 2026-09-25. Reference values quoted from primary sources (linked). Every defect has a repro, so each can become a test.

## Status

Fixed, tested in [test/pro.js](../test/pro.js):
- D1: loudness normalize runs a true-peak lookahead limiter (4×, 32-tap Lanczos detector, same kernel as `stat truepeak`) and makes the limited loudness back up by secant steps: on a block model of the limiter while live (within 0.01 LU under light limiting, ±0.5 LU at 5–9 LU of it), then on measured renders when the render starts with the whole signal known (within 0.005 LU, usually one pass). Make-up stops at +12 dB over the plain gain.
- D2: pointwise derivation keeps only min/max/clipping; stats declare `fields`; a query missing one renders.
- D3: `save` forwards bitDepth/bitrate/quality/codec/compression; lossless keeps the source depth (`a.bitDepth`); m4a writes chapters. CLI `192k`, `24bit`.
- D4: `normalize(target, mode)` (`normalize -18 lufs`), unknown mode/preset throw, more positional args than params throw.
- D5: `remove`/`cut`/`insert`/`paste` take a crossfade (envelope segments summed equal-power, length exact, stream ≡ read).
- D6: `remix` downmixes per BS.775-4 Table 2; loudness weights surrounds per BS.1770-4 Tables 3–4.
- Also found and fixed: `remove OFF DUR` removed everything; `mix`/`insert` dropped their offset; `highpass FC ORDER` ignored the order (now Butterworth 2/4/6/8); `fade(in, curve)` lost the curve; `dither shape:false` shaped; channel-scoped latency ops misaligned the other channels; site demo exported 16-bit from 24-bit/float uploads.

Added 2026-09-27, tested in [test/pro.js](../test/pro.js), [test/mcp.js](../test/mcp.js), [test/editor.test.js](../test/editor.test.js):
- `stat noisefloor`: ACX Check 2.4.2-1 `getfloor` (Steve Daulton, [plugins.audacityteam.org](https://plugins.audacityteam.org/analyzers/loudness-compliance-checks)), sample-exact: RMS over 0.4 s windows every 0.1 s, full windows, the channels' mean squares averaged. Differential test against a sample-for-sample port: 0.000 dB on speech, bursts, a rising floor, 44.1 and 48 kHz. Block windows (1024 samples) read lena 4.6 dB low: 5 ms of a word inside a 0.4 s pause outweighs its room tone, so the stat streams.
- `check SPEC` (CLI sink, `a.check()`, MCP, editor panel): acx, podcast (Apple), streaming (Spotify), broadcast (EBU R 128-2023), netflix; each limit quoted from its source in [fn/check.js](../fn/check.js). Judged at 0.01 as printed. Exit 1 on a fail; `--json`; a glob checks a book, and mixed mono/stereo chapters fail it (ACX's one cross-file rule). ACX thresholds and warnings follow ACX Check (peak > -2.99 fails, < -6 warns; floor < -90 warns "dead silence"). Room tone: time to the first and from the last 0.1 s window 10 dB over the floor, to the block (ACX states the duration, not a measure).
- CLI `rms` prints dBFS (the library keeps the linear value until v3); the overview shows RMS.
- Cut lists: `a.cuts()`, `save x.edl|x.fcpxml|x.otio`. Validated with OpenTimelineIO 0.18.1 (ASWF) readers `cmx_3600`, `otio_json`, `fcpx_xml`: same source ranges and record positions at 10, 25 and 29.97 fps. The `fcpx_xml` reader truncates rates to integers (fcpx_xml.py:345, `int(fps)` at :102), so 29.97 FCPXML is checked by its rational times. EDL refuses non-SMPTE rates (ST 12-1). Rate from the MP4 video track (mdhd timescale / stts delta), size from tkhd.
- `match(ref, { midside: true })`, `master(ref)`, `normalize(ref)`: Matchering 2.0's split (mid and side matched apart, [stages.py](https://github.com/sergree/matchering/blob/master/matchering/stages.py)), side level to the reference's side/mid ratio (K-weighted), loudness by BS.1770 integrated (Matchering: RMS of the loudest 15 s pieces), true-peak ceiling -1 dBTP (Matchering: sample-peak brickwall at -0.016 dBFS). Synthetic test: loudness exact, 8 kHz/500 Hz tilt 13.9 vs 14.1 dB, side/mid -8.0 vs -8.0 dB.
- `roomtone`: digital silence (≥ 10 ms under -90 dBFS) filled with grains of the quietest hundredth (at least five) of the recording's silence-free 0.1 s stretches, 5 ms edge crossfades, seeded (renders reproduce). `trim().pad(1.5, 2).roomtone()` gives ACX head and tail room tone. The twentieth was too loud where a file has few real pauses (soft speech got in).
- Engine: `resolveCtxStats` (plan.js) returned the source stats for any single segment from 0, so after `crop({ at: 0 })` a resolve op (normalize, trim, shrink) measured the uncropped file: 0.216 LU off on a Spoken Wikipedia take. It now requires the segment to span the source.
- Ten real narrations (Spoken Wikipedia, 2010 to 2026, first 90 s, WAV and Ogg Vorbis at 32 to 48 kHz): raw 0 of 10 pass Apple Podcasts; "Enhance speech" 10 of 10. ACX: raw fails room tone on all, peak 5, RMS 4, floor 2, sample rate 3; four files had pauses edited to digital silence (floor -∞). `highpass 80 omlsa gMin:-12 compressor -24 2.5 normalize -20 rms ceiling:-3.5 trim pad 1.5s 2s roomtone resample 44100` passes every ACX rule on 10 of 10 (floor -60.3 to -84.4 dB). Default OM-LSA (gMin -20) took floors to -98 to -141 dB, dead silence; a gate after levelling did the same and broke room tone detection.

Fixed 2026-09-27 in dependency packages, tested in each, published (audio-type 2.8.0, @audio/decode 3.16.2 (vorbis 1.3.3, opus 1.3.2, flac 1.3.5), @audio/resample 1.2.3 (sinc 1.2.0, polyphase 1.1.0), eq-fir 1.0.2, @audio/denoise 0.3.11 (denoise-detect 0.2.0, noise-estimate 1.0.2), @audio/chain 0.1.1):
- Detection ([core.js](../core.js)): a path, Blob or stream was sniffed from its first 12 bytes, too few to see an Ogg codec (bytes 28–35), so Ogg Opus and Ogg FLAC opened by path went to the Vorbis decoder. It now reads 64. audio-type (`isOggFlac`: OggS, then 0x7F "FLAC" at byte 28) sends Ogg FLAC to the FLAC decoder.
- Resampling (@audio/resample; audio-f7's transcription agent found 1 and 2 against librosa/soxr at 2:1). Tested against the analytic sine at the output times (Shannon): level and delay at 2:1, 3:1, 44.1→48.
  1. resample-sinc kept 32 taps when downsampling while its kernel stretched by the ratio, so at 2:1 the Lanczos window was cut at |x| = 8 of 16, where it is still 0.64: ±0.3 dB ripple (+2.8% at 4 kHz), aliases -32 dB, and at 3:1 an uneven cut delayed the output 0.095 samples. Taps now widen to 16 / scale each side (64 at 2:1), as `sincRead` and `resampleTo` already did: flat within 0.01 dB to 0.8 of Nyquist, no delay, aliases -39 dB past Nyquist, -62 dB from 1.36×. Oversampled saturation (saturate-*, dynamics-softclip, 4×): aliases -48.7 → -89.6 dB re the harmonics.
  2. resample-polyphase centered its prototype at (n − 1) / 2 while the read compensates L·D: every output 1/(2L) input samples early, half a sample at 2:1 and 3:1. Now centered on L·D.
  3. Found on the sweep: resample-polyphase kept 32 taps per phase at any ratio, so at 3:1 (the 48→16 kHz voice path) its alias floor was -35 dB. Taps now widen with M/L: -93 dB at 2:1 and 3:1, flat within 0.001 dB to 0.8 of Nyquist. Its README's -97 dB was a sidelobe null at 15 kHz; the swept floor at 2:1 was -86 dB before, -94 now. A same-rate stream flushed 32 zeros; now none.
  - Verified downstream by audio-f7: neural-transcribe from 44.1 kHz matches Python basic-pitch (librosa, soxr_hq) on 969 of 969 notes within one frame, 963 before; note counts identical on every file.
  - `audio`'s own `resample` had the same shape (32 taps, window fitted to them): at 3:1 -2.06 dB at 0.9 of Nyquist, aliases -13.6 dB at 1.1×. audio-f2 widened it the same way in f372d73 (released in 2.7.0) (half = min(64, ceil(16 / scale))): 0.10 dB at 0.9, aliases -38.6 / -62 dB at 1.1 / 1.36× for 2:1 and 3:1; upsampling bit-identical.
- Ogg framing (@audio/decode `_build/ogg.js`, used by vorbis, opus, flac): codec-parser is fed whole pages only, so a stream cut inside a page ends at the page before it. The published decoder built the cut page from what it had: a throw ("Offset is outside the bounds of the DataView") or, on 9 of 10 Spoken Wikipedia files cut at 64 KB, 0.5 to 4.3 s of junk past the cut at speech level (RMS -18 to -33 dB). Now all 10 decode to ffmpeg's length, max difference 4.2e-7; every cut of a test file decodes to an exact prefix. Chained Opus streams were 648 samples long per link; the end trim now counts from the link's start.
- `auto` (@audio/chain) CPU time for 90 s of speech: 16.1 → 2.8 s (c02), 24.5 → 5.8 s (c09), 15 to 32 times faster than real time. Wall time read "about real time" under load average 50.
  - @audio/denoise-detect: the click score was AR(30) residual kurtosis, which a glottal pulse train raises too; declick fired on 6 of 10 clean narrations. Now impulses per second, counted where the residual jumps K=12 over its local RMS and stands 2× over every residual 2.5 to 15 ms away (a pitch period repeats; a click doesn't); trigger 1/s (`CLICK_RATE`). Speech and a sung vowel 0.00/s, clicks 2.58/s. Declick now fires on 0 of 10. `scores.click` changes meaning: publish 0.2.0.
  - @audio/resample-sinc: sin and cos per tap by angle addition from tables; bit-exact on 11 ratios, 3 to 8 times faster; direct sinc within 1e-3 of zero (cancellation at 7→5 gave 1.1e-3).
  - @audio/eq-fir: FFT overlap-add above 32 taps, equal to direct convolution; 511 taps over 10 s: 2661 → 31 ms.
  - @audio/noise-estimate: minimum statistics with per-bin monotonic deques instead of a rescan of D frames; bit-identical, 7.6 times faster (was 38% of `auto` once the others were fixed).
  - What's left is flat: STFT and FFT about 40%, biquads, limiter, LRA, Wiener gain. The STFT converts to polar and back per bin (atan2, cos, sin); a complex path, as fourier-transform 2.5.0's `stft` has, would remove it.

Wired: registry plugins autowired (deps, methods before load, `load` hook), sidechain `key:FILE`, `mix` gain, video round trip (remux), `match`, `spectral`, `repair`, `stat dialog|momentary|shortterm`.

Open:
- Transcription: `@audio/neural-asr` unpublished.
- Chapters: m4a `chpl` and MP3 ID3 CHAP are written, not read back (`decode-mp4`, `decode-mp3`).
- `split` at silence/onsets; polarity invert, take alignment; denoise profile from a chosen range (`specsub` reads only leading frames); dialog-gated `normalize` mode (measure `stat dialog`, then `gain`).
- Room tone matched across chapters (one book, one room); chapter-to-chapter consistency report in a batch check (floor, RMS spread).
- `auto`'s reference mode is not reachable from the `auto` op (no reference param).
- Engine: a non-ranged latency plugin with a range passes out-of-range audio undelayed (pre-existing).

## Skill distribution

- `npx skills add audiojs/audio` already installs. The skills CLI clones the repo and finds `skills/audio/SKILL.md` (`npx skills add audiojs/audio --list` → "Found 1 skill"). It scans root, `skills/`, `skills/.curated/`, `.claude/skills/` and others, three levels deep ([vercel-labs/skills](https://github.com/vercel-labs/skills)).
- skills.sh has no submission step: the leaderboard ranks by anonymous install telemetry ([skills.sh/docs](https://skills.sh/docs)). First installs list it.
- Keep the skill here. Its body is also the MCP tool description ([bin/mcp.js](../bin/mcp.js), asserted ≤ 2048 chars in [test/mcp.js](../test/mcp.js)), and it teaches this CLI's grammar, so it changes in the same commit as the grammar. A separate `audiojs/skills` would hold one skill drifting from its tool. Revisit only when a skill does not teach this CLI.
- Growth: one skill, progressive disclosure. `SKILL.md` stays grammar + measure/edit/verify loop (MCP-sized); workflows go to `skills/audio/references/<workflow>.md`, read on demand. The five skills planned in [mcp.md](mcp.md) (master, clean, analyze, match, edit) become references, not five skills competing for the same trigger with five copies of the grammar.
- Drift guard: a test that runs every `audio …` line in `skills/**/*.md` against fixtures.

## Delivery specs

| Target | Loudness | Max peak | Format | Source |
|---|---|---|---|---|
| Apple Podcasts | -16 LKFS ±1 | -1 dBFS true peak | WAV/FLAC stereo, 24-bit recommended; MP3/AAC mono 64–128k, stereo 128–256k | [Apple](https://podcasters.apple.com/support/893-audio-requirements) |
| ACX audiobook | RMS -23 to -18 dB | < -3 dB | noise floor < -60 dB RMS; room tone 1–5 s head and tail; MP3 ≥ 192 kbps CBR, 44.1 kHz; ≤ 120 min per file | [ACX](https://help.acx.com/s/article/acx-audio-submission-requirements) |
| Spotify | -14 LUFS | -1 dBTP; -2 dBTP if louder than -14 LUFS | "Loud" plays at -11 LUFS through a limiter | [Spotify](https://support.spotify.com/us/artists/article/loudness-normalization/) |
| AES streaming | speech -18 LUFS (+1 LU), dialog-gated; music track -16, album-loudest -14 | -1 dBTP at codec input | | [AES TD1008 §4](https://aes.org/wp-content/uploads/2024/01/20210924_TD1008_v3.13.pdf) |
| EBU broadcast | -23.0 LUFS; ±1.0 LU only where unachievable (live); ±0.2 LU for QC | -1 dBTP | LRA, max momentary, max short-term as descriptors | [EBU R 128-2023](https://tech.ebu.ch/docs/r/r128.pdf) |
| Netflix | -27 LKFS ±2, dialog-gated | -2 dBTP | | [Netflix mix spec v1.6](https://partnerhelp.netflixstudios.com/hc/en-us/articles/360001794307) |

AES TD1008 §5A: "When upward normalization would cause clipping, peak limiting is required."

## How engineers work

✅ works · ⚠ present, falls short · 🔌 atom exists, CLI can't reach it · ❌ absent

**Repair**, deepest damage first ([iZotope order of operations](https://www.izotope.com/en/learn/order-of-audio-repair-operations.html)): declip ✅ → stereo fixes ❌ (no polarity invert, no take alignment) → declick, decrackle ✅ → dehum ✅ → broadband denoise ⚠ (auto estimate only; `specsub` can't learn a profile from a chosen room-tone range) → breaths, sibilance, plosives ✅ → dereverb ✅ → spectral repair 🔌 (`spectral-edit`, direct import only).

**Dialog edit**: cut filler and flubs ⚠ (splices click, D5) → tighten pauses ✅ `shrink` → room tone under gaps ❌ → transcript-driven cuts ❌ (neural-asr in progress).

**Podcast process and deliver**: HPF, EQ, compress, de-ess, level ✅ → music bed ducked under voice 🔌 (`ducker` takes an external sidechain; CLI can't name the file) → loudness to spec ⚠ (D1, D4) → encode to spec ⚠ (D3) → tags ✅, chapters 🔌 (`encode-mp4` `writeMeta({chapters})`; markers → chapters on save unverified).

**Audiobook (ACX)**: RMS ✅ → peak ✅ → noise floor ❌ as a stat → room tone head and tail ⚠ (`pad` adds digital silence) → MP3 192k CBR ❌ (D3).

**Mastering**: match EQ to a reference 🔌 (`ltas` + `@audio/eq-fit` + parametric EQ) → EQ, compression, multiband, M/S, saturation ✅ → true-peak limiting ⚠ (`limiter` detects sample peaks only) → SRC ✅ → dither last ✅ → 24-bit master plus lossy ⚠ (D3).

**Broadcast QC**: integrated, LRA, true peak ✅ → max momentary, max short-term ❌ → dialog-gated loudness ❌ (`@audio/vad` exists) → 5.1 to stereo ⚠ (D6) → mono compatibility ✅ `correlation` → one pass/fail report per spec ❌.

**Audio for video**: extract ✅ (mp4, webm, avi decode) → process ✅ → back under the picture 🔌 (`@audio/encode-mp4` `remux()` swaps the audio track, video untouched).

**Samples and loops**: slice at onsets or beats ❌ (`split` takes times or a cue sheet; `stat onsets|beats` already yields the times) → tempo conform ✅ `stretch` from `bpm` → key ✅ → seamless loop crossfade ❌.

**Speech datasets**: 16 kHz mono ✅ → voice segments ⚠ (`stat silence`) → split at pauses into ≤ 30 s chunks ❌ → loudness ⚠ (D1).

## Defects

Measured. They break the specs above, and the skill already promises them.

**D1. LUFS presets clip instead of limiting.** After gain to target, `normalize` hard-clamps at -1 dBFS *sample* peak ([fn/normalize.js:100](../fn/normalize.js#L100)). README calls it "-1 dBTP", "true peak limiter", "equivalent to FFmpeg `loudnorm`". Drum-like file (crest 20.6 dB, -18 LUFS) → `normalize streaming save`: re-measured **-14.48 LUFS, +4.93 dBTP**, 1800 samples (0.47 %) flat-topped. Fix: lookahead limiter with a 4× oversampled detector (BS.1770 true peak) at the ceiling, then re-measure and compensate gain. `@audio/dynamics-limiter` is sample-peak and a devDependency, so core needs its own detector or that dependency.

**D2. Preview lies after nonlinear ops.** `normalize streaming stat loudness` reports -14.0000 LUFS on the file above; the render measures -14.48. [stats.js:223](../stats.js#L223) `derivePointwise` recomputes min/max/clipping for `clamp` and keeps pre-clamp energy. Step 2 of the skill ("preview a chain, nothing written") rests on this. Fix: a pointwise op without `deriveStats` invalidates energy, ms, dc; queries needing them render.

**D3. `save` ignores encoder quality.** Every WAV is 16-bit, every MP3 128 kbps CBR: [fn/save.js:56](../fn/save.js#L56) forwards only sampleRate, channels, meta, while encoders accept `bitDepth` (16/24/32) and `bitrate`/`quality`. ACX rejects every MP3 we write; 24-bit sources truncate to 16 without dither; no 24-bit or float masters. Fix: pass through; default lossless output to source depth; CLI grammar for it (e.g. `save out.mp3 192k`, `save out.wav 24bit`).

**D4. No arbitrary LUFS target from the CLI.** `normalize -18 lufs` runs a -18 dBFS *peak* normalize; `lufs` is dropped silently (`params: ['target']`). AES speech -18, Netflix -27 unreachable. Fix: a unit on the value, parallel to `-3db` (`-18lufs`), and reject unknown trailing args.

**D5. Splices click.** Structural edits join segments sample to sample ([fn/remove.js](../fn/remove.js)). 440 Hz sine, `remove` 1.1 ms at 0.5 s: largest step 0.073 vs 0.029 for the clean sine (2.5×). Measured on `remove`; `cut`, `paste`, `insert` build the same joins. Fix: default micro-crossfade at every seam in the plan (non-destructive), opt-out for sample-exact work.

**D6. `remix 2` from 5.1 collapses to mono.** All inputs, LFE included, are averaged into every output ([fn/remix.js](../fn/remix.js)): L-only 5.1 → L 0.083, R 0.083. ITU-R BS.775 downmix: Lo = L + 0.71 C + 0.71 Ls, Ro = R + 0.71 C + 0.71 Rs, LFE dropped. Fix: standard matrices per layout.

Minor: op help examples use `-o out.wav`, absent from `--help`; `split --help` shows both `save …` and `-o out.wav`.

## Exposure gaps

The atom exists; the CLI can't reach it. Wiring, not DSP.

| Task | Atom | Missing |
|---|---|---|
| Clean a video's audio, keep the picture | `encode-mp4` `remux()` | `save` to a video container when the source is video |
| Duck music under voice | `dynamics-ducker` external sidechain | a way to name the sidechain file |
| Match tone to a reference | `ltas`, `eq-fit`, `eq-parametric` | `match REF` |
| Remove a cough or phone ring | `spectral-edit` | time × frequency range in the grammar |
| Denoise from room tone | `noise-estimate` `noiseProfile` | profile from a chosen range |
| Dialog-gated loudness | `vad` + BS.1770 | stat |
| Podcast chapters | `encode-mp4` `writeMeta({chapters})` | markers → chapters (verify) |
| Transcript, alignment, stems | `neural-asr`, `-align`, `-separate`, `-diarize` | neural lane policy ([todo.md](todo.md)) |

## Streaming

A live source (push, pipe, socket, fetch body, stdin) renders as it arrives, and its output equals the whole-file render. [test/stream.js](../test/stream.js) checks 20 chains live against the file, bounds when the first output appears, and keeps the ratchet of ops that still wait (it may only shrink).

Engine: `latency` (delay compensation), `warmup` (seeks start early by what an op needs), `holdback` (output that depends on the unknown end waits by that much only: fade-out, ranges from the end, crossfade blend, trim's silent tail, shrink's open pause). Resolve ops stop at their stats horizon. Measurement renders (normalize through the limiter, stats after a non-derivable op) run only when the render starts with the whole input known; a live stream that ends keeps its progressive decisions.

Streaming now: normalize (progressive), trim, shrink, fade, crossfade, splices with crossfades, ranged reverse, spectral (STFT only near its range), repair (range + context), match (lookahead, refits at 2×), dialog loudness, filters, time/pitch/rate ops, the streaming plugins.

Waits for the whole input:
- Inherent: `reverse()` of everything.
- Clipboard: `copy` captures at the end of decode.
- 48 registry atoms declared `streaming: false`, by kernel class: whole-signal oversampling (softclip, tape, tube, transistor, waveshaper, multisat, amp, cabinet), state built per call (plate, fdn, spring, shimmer, multiband, dyneq, leveler, auto), batch repair (declick, declip, decrackle, debreath), time-scaling (stretch-*, pitch-shift, paulstretch, tune, tapestop), upmix (surround), one-call synthesis (noise, chirp, pluck, fm, modal, risset, rhythm, sfx, kick, snare, cymbal, adsr, voice, poly). Each is a fix in its own package: carry state across calls.

Decisions that read the whole input wait for it, by declaring a holdback of all of it: trim/shrink with the automatic threshold (a given threshold streams), normalize's one gain for the selection (`adaptive: true` streams, the ceiling guarding what it hasn't heard). Resolve ops after a filter get the prefix stage's stats, accumulated as it renders. `read()` waits for its range, or for the end.

Output: `save` streams every format (@audio/encode `stream: true`), headers exact upfront when the length is known (`frames`), patched at the end otherwise (a pipe keeps "unknown"); m4a from a live source is fragmented. AAC encodes in Node (FDK, WASM).

Open, for a week-long stream (the three unbounded axes):
- PCM pages: 48 kHz stereo is ~232 GB a week. Needs a retention window behind the slowest reader (`retain`), or disk-backed pages (a Node counterpart of the OPFS cache).
- Per-block stats: ~1.3 GB a week. Needs running aggregates (loudness as a gating histogram, peak, DC) plus a recent window for trim/shrink.
- Recompiles: every new chunk recompiles the plan, and resolve ops rescan all blocks: quadratic in stream time; shrink adds a remove per pause, growing the plan. Needs incremental resolve over aggregates, and settled structural edits folded out of the plan.
- The 48 registry atoms declared `streaming: false`; the clipboard.

Speed (next): the default CLI overview spends most of its time in `@audio/mir-chroma` NNLS key detection (dense 72-pitch dictionary × every bin × 30 iterations, `Dᵀs` recomputed each iteration): ~5 s for an 11 s clip on a loaded machine. Sparse dictionary columns and a hoisted `Dᵀs` are algorithmic, before any jz work.

## Missing

1. True-peak limiting (D1 depends on it).
2. Edit crossfades, zero-crossing snap (D5).
3. Room tone: sample from a range, fill gaps and pads with it.
4. `split` at `silence`, `onsets`, `beats`, with min and max length.
5. Max momentary and short-term loudness; one `stat` that reports pass/fail per spec (R128, ACX, Apple).
6. Polarity invert; align two takes (GCC-PHAT already in `neural-align`).
7. Waveform and spectrogram images. FFmpeg has `showwavespic`/`showspectrumpic`; an agent with vision looks at a file this way before cutting it.
8. Noise floor stat.

## Against FFmpeg

FFmpeg leads on: true-peak `loudnorm` (D1), codec parameters on every output (D3), multi-input graphs with sidechain (`sidechaincompress`, `amix`), video muxing, surround downmix, image output, and transcription (`whisper` filter via whisper.cpp, [filters.texi](https://github.com/FFmpeg/FFmpeg/blob/master/doc/filters.texi)).

`audio` leads on: one-command overview (LUFS, BPM, key, clipping, DC); musical analysis FFmpeg lacks (beats, key, chords, notes); non-destructive edit list, undo, JSON macros; preview without writing; repair FFmpeg lacks (dewind, deplosive, debreath, dereverb); browser runtime; one MCP tool.

An agent that measures, edits and re-measures needs every number to be true. D1 to D4 are where they are not, so correctness comes before breadth.

## Order

1. D1–D4: loudness and encoding correctness.
2. D5, D6.
3. Exposure gaps: video round trip, sidechain, `match`, `split` at silence/onsets.
4. `skills/audio/references/` for podcast, audiobook, mastering, repair, broadcast QC, each ending in a verify command; the drift test.
5. Missing 3, 5, 7.
