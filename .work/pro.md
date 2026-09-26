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

Wired: registry plugins autowired (deps, methods before load, `load` hook), sidechain `key:FILE`, `mix` gain, video round trip (remux), `match`, `spectral`, `repair`, `stat dialog|momentary|shortterm`.

Open:
- Transcription: `@audio/neural-asr` unpublished.
- Chapters: m4a `chpl` and MP3 ID3 CHAP are written, not read back (`decode-mp4`, `decode-mp3`).
- Room tone fill; `split` at silence/onsets; polarity invert, take alignment; denoise profile from a chosen range (`specsub` reads only leading frames); noise floor stat; dialog-gated `normalize` mode (measure `stat dialog`, then `gain`).
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
