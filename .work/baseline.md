# Baseline coverage — audio vs FFmpeg / SoX / librosa / Pedalboard / MIREX

Goal: `audio` (+ the `@audio/*` atoms it wires) covers the practical baseline of FFmpeg audio filters, SoX effects, librosa, Pedalboard and MIREX — then extensions go through `@audio/host` (native plugins) / `@audio/module` (cross-target contract).

Legend:
**✔** implemented + tested
**●** in `audio` core (tested in its suite)
**◌** stub scaffolded (`private` package.json + README, at `~/projects/@audio/`)
**✗** uncovered
**~** partial.

Test evidence: suite name = repo root `test.js` (counts as of 2026-07 post-implementation wave: pitch 46, mir 19, beat 70, dynamics 27, denoise 42, effect 36, reverb 9, filter 98, eq 29, weighting 30, auditory 28, spatial 11, synth 2, resample 8, vocals 4, spectral 12, loudness 6, decode 67, encode 23, shift 50, stretch 152, module 16 — 785 total, all green).

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
| Reverb | ✔ | `@audio/reverb-*` — schroeder, freeverb, dattorro plate, convolution (reverb 9✓); fdn/spring/shimmer ◌ |
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
| remix, channels, swap | ●◌ | audio core remix; `@audio/spatial-channelsplit` stub |
| reverb | ✔ | `@audio/reverb-*` family (9✓) |
| riaa | ✔ | `@audio/weighting-riaa` |
| silence, vad | ✔● | audio core silence stat; `@audio/denoise-core` VAD |
| spectrogram | ● | audio core spectrum stat + CLI live FFT |
| stat, stats | ● | audio core stats (peak/rms/dc/crest/…) |
| stretch, tempo | ✔● | `@audio/stretch-*` 10 algorithms (152✓); audio core `stretch` |
| synth | ✔◌ | `@audio/synth-noise` (pink ✔); tone/chirp/dtmf/pluck stubs |
| bend | ~ | shift + engine automation (state-bound params open — see todo Modulation) |

## FFmpeg audio filters (curated baseline)

| Filter | Status | Where |
|---|---|---|
| acompressor, alimiter, agate, compand, asoftclip | ✔ | `@audio/dynamics-*` (25✓) |
| dynaudnorm | ◌ | `@audio/dynamics-leveler` stub (Vocal Rider class) |
| stereotools, stereowiden, extrastereo | ✔~ | `@audio/spatial-widener`/`-haas`/`-panner` (11✓); exact FFmpeg knobs not mirrored |
| bs2b | ✔ | `@audio/spatial-crossfeed` |
| surround | ◌ | `@audio/spatial-surround` |
| afftdn, adeclick, adeclip, deesser | ✔ | `@audio/denoise-*` (42✓) |
| firequalizer | ✔ | `@audio/eq-fir` (eq 29✓) |
| acrossover | ✔ | `@audio/eq-crossover` (flat-sum verified) |
| tiltshelf | ✔ | `@audio/eq-tilt` |
| superequalizer | ✔~ | `@audio/eq-graphic` (10-band ISO 266; 18-band variant = params) |
| aspectralstats | ✔● | `@audio/spectral-*` — all seven + mfcc + ltas (spectral 12✓); audio core stats |
| drmeter, replaygain, ebur128/loudnorm | ✔◌● | `@audio/loudness-lufs` (EBU 3341-verified); truepeak/lra/replaygain/dr ◌; audio core LUFS |
| channelsplit, adelay | ◌● | `@audio/spatial-channelsplit`/`-delay` stubs; audio core remix |
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
| segment (structure) | ◌ | `@audio/mir-structure` |
| griffinlim | ~ | `@audio/stretch-pghi` (phase-gradient heap integration — same phase-reconstruction family) |

## MIREX

Have (tested): tempo (bpm), beat tracking, onset detection, melody notes (YIN), **melody contour** (`mir-melody`), chords (NNLS + Viterbi), key (Krumhansl-Schmuckler), MFCC, spectrum, **tempogram**, **tonnetz** (mir 19✓).
Scaffolded ◌: structure, transcribe, downbeat, coversong, multif0, fingerprint, similarity, drums (`@audio/mir-*`).
Deferred (ML-tier): genre, mood, tags, stem separation.

## Deliberate exclusions

- **ladspa / plugin formats** — that's `@audio/host` (VST3/CLAP hosts, platform binaries) + `@audio/module` (JS→Worklet/WAM/CLAP/VST3 contract, 16✓), not effects.
- **SoX contrast, divide; FFmpeg aderivative/aintegral** — trivial or low-value; revisit on demand.
- **Codec-sim effects (MP3Compressor)** — expressed as decode/encode round-trip, not a filter.
- **ML denoise/separation** — classical-DSP stance; see site strategy.

## Next moves (ordered)

Items 1–5 of the previous list shipped 2026-07 (resample, vocals, spectral, LUFS, multiband, FIR EQ, reverb family, tonnetz/melody/tempogram). Next:

1. Reverb tail kinds — `reverb-fdn`, `reverb-spring`, `reverb-shimmer` (uses @audio/shift); partitioned FFT convolution for long IRs.
2. Saturation family (`@audio/saturate-*`) with proper oversampling — then `@audio/amp` (tube stage + cabinet IR).
3. Loudness meters tail — `loudness-truepeak` (BS.1770-4 Annex 2 4×), `-lra` (EBU 3342), `-replaygain`, `-dr`.
4. Dynamics character models — opto/fet/vca/varimu + `dynamics-leveler` (dynaudnorm); `eq-dynamic` (Pro-Q3/soothe class).
5. `@audio/tune` (pitch-correct, Tier-2 in todo) — pitch-yin → scale snap → shift-psola/formant.
6. MIR heavy tail — structure, downbeat, multif0, fingerprint, similarity, transcribe, drums, coversong.
7. Publish prep: swap local `file:` atom links to semver (loudness-lufs→weighting-k, dynamics-multiband→eq-crossover, mir-melody→pitch-yin, mir-tempogram→beat-core).
