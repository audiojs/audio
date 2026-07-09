# Baseline coverage — audio vs FFmpeg / SoX / librosa / Pedalboard / MIREX

Goal: `audio` (+ the `@audio/*` atoms it wires) covers the practical baseline of FFmpeg audio filters, SoX effects, librosa, Pedalboard and MIREX — then extensions go through `@audio/host` (native plugins) / `@audio/atom` (cross-target contract).

Legend:
**✔** implemented + tested
**●** in `audio` core (tested in its suite)
**◌** stub scaffolded (`private` package.json + README, at `~/projects/@audio/`)
**✗** uncovered
**~** partial.

Test evidence: suite name = repo root `test.js` (counts as of 2026-07-09, fully published: pitch 46, mir 27, beat 70, dynamics 32, denoise 46, effect 44, reverb 14, filter 98, eq 30, weighting 34, auditory 28, spatial 4, synth 17, resample 12, vocals 4, spectral 16, loudness 10, note 4, tune 6, saturate 5, measure 5, amp 3, decode 67, encode 23, shift 50, stretch 153, atom 26, voice 5, midi 3, defeedback 3, sinusoidal 4, primitives 8, mic 18, speaker 27 — ~942 atom tests, all green, + `audio` engine's own 548).

## Pedalboard (Spotify)

| Plugin | Status | Where |
|---|---|---|
| Bitcrush | ✔ | `@audio/effect-bitcrusher` (effect) |
| Chorus | ✔ | `@audio/effect-chorus` (effect) |
| Clipping | ✔ | `@audio/dynamics-softclip` (dynamics) |
| Compressor | ✔ | `@audio/dynamics-compressor` (dynamics) |
| Convolution | ✔ | `@audio/reverb-convolution` (reverb 9✓) |
| Delay | ✔ | `@audio/effect-delay` (effect) |
| Distortion | ✔ | `@audio/effect-distortion` (effect) |
| Gain | ✔● | `@audio/effect-gain`; audio core op |
| Highpass/LowpassFilter | ✔● | `@audio/filter-biquad` (filter); audio core ops |
| High/LowShelfFilter | ✔● | `@audio/eq-highshelf`/`-lowshelf` (eq); audio core |
| Invert | ● | trivial core op |
| LadderFilter | ✔ | `@audio/filter-moog-ladder` (filter) |
| Limiter | ✔ | `@audio/dynamics-limiter` (dynamics) |
| NoiseGate | ✔ | `@audio/dynamics-gate` (dynamics) |
| PeakFilter | ✔ | `@audio/eq-parametric` (eq) |
| Phaser | ✔ | `@audio/effect-phaser` (effect) |
| PitchShift | ✔ | `@audio/shift-*` 16 algorithms (shift) |
| Resample | ✔● | `@audio/resample-sinc`/`-linear` (resample 8✓: pitch preservation, round-trip energy, anti-alias); audio core |
| Reverb | ✔ | `@audio/reverb-*` — schroeder, freeverb, dattorro plate, convolution (direct + partitioned FFT), fdn, spring, shimmer (reverb 13✓) — family complete |
| GSMFullRate/MP3Compressor | ~ | codec-sim → decode/encode round-trip (encode 23✓) — not a dedicated effect |

## SoX effects

| Effect | Status | Where |
|---|---|---|
| allpass, biquad, bandpass, bandreject, highpass, lowpass, band | ✔● | `@audio/filter-biquad` (filter 98✓); audio core filter ops (stream≡read + response-fit tested) |
| bass, treble | ✔ | `@audio/eq-lowshelf`/`-highshelf`, `@audio/eq-baxandall` (eq) |
| equalizer | ✔● | `@audio/eq-parametric`; audio core `eq` |
| chorus, flanger, phaser, tremolo | ✔ | `@audio/effect-*` (effect) |
| compand, mcompand | ✔ | `@audio/dynamics-compand` + `@audio/dynamics-multiband` (dynamics 27✓: flat-sum + band-selective) |
| contrast | ✗ | enhancement distortion — low value, skip for now |
| dcshift | ✔● | `@audio/filter-dcblocker`; audio core DC stat |
| deemph | ✔ | `@audio/filter-preemphasis` (emphasis/deemphasis) |
| delay, echo, echos | ✔ | `@audio/effect-delay`/`-multitap`/`-pingpong` |
| dither | ● | audio core (TPDF: quantization levels, SNR 93/45 dB tested) |
| divide, ladspa | ✗ | esoteric / plugin-host duplicate — skip |
| downsample, upsample, rate | ✔● | `@audio/resample-*` (8✓); audio core |
| earwax | ✔● | `@audio/spatial-crossfeed`; audio core `earwax` op |
| fade, pad, trim, repeat, reverse, splice, speed, vol, gain, norm | ● | audio core ops (stream≡read + page-boundary tested) |
| fir, sinc | ✔ | `@audio/eq-fir` (eq 29✓: exact identity, shape, linear phase); generic FIR design in `digital-filter` (scijs) |
| hilbert | ~ | inside `@audio/effect-freqshift` (SSB via Hilbert); standalone atom not planned |
| loudness | ✔● | `@audio/weighting-*` (30✓) + `@audio/loudness-lufs` (EBU Tech 3341 cases 1–3 ±0.1); audio core LUFS |
| noiseprof, noisered | ✔ | `@audio/denoise-spectral`/`-wiener`/`-omlsa` + `denoise-core` noise estimation (denoise 42✓) |
| oops | ✔● | `@audio/vocals-isolate`/`-remove` (4✓); audio core op |
| overdrive | ✔ | `@audio/effect-distortion` |
| pitch | ✔● | `@audio/shift-*` (50✓); audio core `pitch` op |
| remix, channels, swap | ✔● | audio core remix; `@audio/spatial-channelsplit` (spatial 4✓) |
| reverb | ✔ | `@audio/reverb-*` family complete (13✓) |
| riaa | ✔ | `@audio/weighting-riaa` |
| silence, vad | ✔● | audio core silence stat; `@audio/denoise-core` VAD |
| spectrogram | ● | audio core spectrum stat + CLI live FFT |
| stat, stats | ● | audio core stats (peak/rms/dc/crest/…) |
| stretch, tempo | ✔● | `@audio/stretch-*` 10 algorithms (152✓); audio core `stretch` |
| synth | ✔ | `@audio/synth-*` family complete — noise/chirp/osc/dtmf/pluck/risset/rhythm/adsr/lfo/wavetable/drum/voice/poly/sfx (17✓) |
| bend | ~ | shift + engine automation (state-bound params open — see todo Modulation) |

## FFmpeg audio filters (curated baseline)

| Filter | Status | Where |
|---|---|---|
| acompressor, alimiter, agate, compand, asoftclip | ✔ | `@audio/dynamics-*` (25✓) |
| dynaudnorm | ✔ | `@audio/dynamics-leveler` (framewise smoothed riding, peak-guarded; dynamics 32✓) |
| stereotools, stereowiden, extrastereo | ✔~ | `@audio/spatial-widener`/`-haas`/`-panner` (11✓); exact FFmpeg knobs not mirrored |
| bs2b | ✔ | `@audio/spatial-crossfeed` |
| surround | ✔ | `@audio/spatial-surround` (spatial 4✓, family complete) |
| afftdn, adeclick, adeclip, deesser | ✔ | `@audio/denoise-*` (42✓) |
| firequalizer | ✔ | `@audio/eq-fir` (eq 29✓) |
| acrossover | ✔ | `@audio/eq-crossover` (flat-sum verified) |
| tiltshelf | ✔ | `@audio/eq-tilt` |
| superequalizer | ✔~ | `@audio/eq-graphic` (10-band ISO 266; 18-band variant = params) |
| aspectralstats | ✔● | `@audio/spectral-*` — all seven + mfcc + ltas (spectral 12✓); audio core stats |
| drmeter, replaygain, ebur128/loudnorm | ✔● | `@audio/loudness-*` complete — lufs (EBU 3341), truepeak (inter-sample, BS.1770 Annex 2), lra (EBU 3342 10 LU case), replaygain (RG2), dr (TT method); audio core LUFS |
| channelsplit, adelay | ✔● | `@audio/spatial-channelsplit`/`-delay` (spatial 4✓); audio core remix |
| amultiply | ✔ | `@audio/effect-ringmod` |
| aloop, silenceremove, afade, apad, areverse, atempo, aresample, volume | ● | audio core ops |
| afreqshift | ✔ | `@audio/effect-freqshift` |
| afftfilt | ✔ | `@audio/spectral-edit` (COLA STFT region gains; reconstruction + band-kill tested) |
| aderivative, aintegral | ✗ | trivial math — core candidates, low priority |

## librosa

| Module | Status | Where |
|---|---|---|
| beat, onset | ✔● | `@audio/beat-*` (70✓, MIREX thresholds); audio `bpm`/`beats`/`onsets` stats |
| pyin, yin | ✔ | `@audio/pitch-pyin`/`-yin` (46✓) |
| effects.time_stretch / pitch_shift | ✔ | stretch / shift |
| effects.hpss | ✔ | `@audio/shift-hpss` (harmonic-percussive separation core) |
| effects.preemphasis | ✔ | `@audio/filter-preemphasis` |
| effects.trim / split | ● | audio core (silence-based) |
| feature.chroma_stft/cqt | ✔~ | `@audio/mir-chroma` (PCP + NNLS; CQT variant ✗) |
| feature.melspectrogram | ✔● | `@audio/auditory-mel` (28✓); audio spectrum (mel-binned, tested) |
| feature.mfcc | ✔● | `@audio/spectral-mfcc` (gain-invariance + timbre-separation verified); audio cepstrum stat |
| feature.spectral_{centroid,bandwidth,flatness,rolloff,contrast} | ✔● | `@audio/spectral-*` (12✓, analytic identities); audio core stats |
| feature.tonnetz, tempogram | ✔ | `@audio/mir-tonnetz`/`-tempogram` (mir 19✓) |
| feature.zero_crossing_rate, rms | ● | audio core stats |
| filters.mel / get_window | ✔ | auditory-mel; `window-function` (scijs) |
| decompose.hpss | ✔ | shift-hpss |
| sequence.viterbi | ✔ | inside `@audio/mir-chord` (smoothing, tested) |
| segment (structure) | ✔ | `@audio/mir-structure` (mir 27✓, family complete) |
| griffinlim | ~ | `@audio/stretch-pghi` (phase-gradient heap integration — same phase-reconstruction family) |

## MIREX

Have (tested), family complete (mir 27✓): tempo (bpm), beat tracking, onset detection, melody notes (YIN), **melody contour** (`mir-melody`), chords (NNLS + Viterbi), key (Krumhansl-Schmuckler), MFCC, spectrum, **tempogram**, **tonnetz**, structure (Foote novelty), fingerprint (Wang landmark), transcribe, downbeat, coversong, multif0 (Klapuri), similarity, drums.
Deferred (ML-tier only): genre, mood, tags, stem separation — needs hosted weights, conflicts with no-ML-in-hot-path.

## Deliberate exclusions

- **ladspa / plugin formats** — that's `@audio/host` (VST3/CLAP hosts, platform binaries) + `@audio/atom` (JS→Worklet/WAM/CLAP/VST3 contract, 26✓, natively hosted by `audio` since v2.3.0), not effects.
- **SoX contrast, divide; FFmpeg aderivative/aintegral** — trivial or low-value; revisit on demand.
- **Codec-sim effects (MP3Compressor)** — expressed as decode/encode round-trip, not a filter.
- **ML denoise/separation** — classical-DSP stance; see site strategy.

## Next moves (ordered)

Waves 1–4 + the 22-package stub wave + the `@audio/module`→`@audio/atom` rename all shipped 2026-07-08/09. ~330 packages published, 10/11 unscoped names deprecated, `audio@2.3.0` live consuming the scope natively. Remaining:

1. **CI**: `audio`'s `test/fix-core.js` "Blob/File/Response sources" test uses the global `File` constructor — not defined in Node 18 (CI matrix runs 18/20/22; the 20/22 jobs cancel via fail-fast behind the Node-18 failure, not independent bugs). Needs a `typeof File !== 'undefined'` guard (matches this file's own existing pattern for Node's missing OPFS) or a matrix/engines.node decision.
2. **Family-core swap**: `denoise-core/stft` → `@audio/stft`, `dynamics-core/biquad` → `@audio/biquad`, behind differential tests — published, not yet swapped in.
3. **Merge near-dupes**: `dynamics-gate`/`denoise-gate`, `dynamics-deesser`/`denoise-deesser` — deliberately qualified as different variants, migration deferred to the atom pass.
4. **Docs**: per-atom `.d.ts` + individual READMEs (currently umbrella-level only, ~280 atoms — content-authorship decision, not mechanical).
5. **Engine-side atom hosting**: `streaming: false` whole-signal hosting (leveler et al. run per-block today — wrong for time-varying material) and true multi-bus sidechain feeding (ducker self-keys as a fallback).
6. **Still deferred, reasons on record**: speech-world (faithful WORLD port or WASM, not a namesake), midi-soundfont (asset-strategy decision — SF2 engine vs ~100 MB pre-rendered banks), neural lane (runtime adapter + policy).
7. **a-weighting**: absorbed for A/B/C/ITU-468 (`.response()` on the atoms); its own npm deprecation held pending — D/Z-weighting have no atom equivalent yet.
