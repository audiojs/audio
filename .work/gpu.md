# GPU and neural audio

Research notes, 2026-09-27. Sources are linked at the end: papers, project pages, gpu-font, mel and the audiojs packages. "Arithmetic" marks my own calculations; "estimate" marks guesses not yet measured.

## In short

- **The split that makes it work.** gpu-font never generates: the font file renders, the network only encodes. For sound, make each catalog entry something a fixed engine can play (a mel component, a synth preset, a mode set) and train only encoders, the problem gpu-font already solved.
- **Where the GPU goes.** Analysis, catalog building, training and candidate search. Playback stays deterministic DSP in the AudioWorklet, which has no WebGPU.
- **Flagship: famous-synth recognition.** Name the synth and preset in a recording (DX7 E.PIANO 1, a Juno pad, a TB-303 line, a Hammond registration), then rebuild it: in the original synth through `@audio/neural-synth`, and in mel as an editable component.
- **Much is already built.** `neural-synth` (CMA-ES matching, patch recovery verified), `neural-separate` (pipeline done, no weights yet), `neural-runtime` (ONNX, WebGPU), `sinusoidal-track` (McAulay–Quatieri), `synth-modal` (takes measured modes), filter models of famous synths.
- **The op upgrades need no heavy data collection.** `vocals`: pretrained MIT weights plus integration. `notes`: classical fixes first, then small pretrained models. `repair`: classical tiers; a neural tier only for speech, optional. See [Ops](#ops-vocals-pitch-detect-repair).

## Status, 2026-09-27

Built by Opus agents and checked by rerunning each suite; nothing committed or published unless noted.

| Work | Where | Measured | Waits on the owner |
|---|---|---|---|
| `notes`, classical | `pitch-pyin` (`track`, `notes`), audio `fn/pitch-detect.js` | Vocadito onset F 0.83 (was 0.45), official Tony 0.82; note stage equals Tony's C++ on 1687/1687 notes | published `pitch-pyin` 2.0.0; audio depends on it directly |
| `notes({ poly: true })` | `neural-transcribe` (Basic Pitch, Apache-2.0), audio `fn/pitch-detect.js` | 969/969 of Python's notes within one frame (with `resample-sinc` 1.2.0); arpeggio F1 0.95 vs 0.23 classical; bends read 0 on in-tune notes (Basic Pitch #87 corrected, `upstream: true` keeps parity) | none |
| Neural pitch stage 1 | `neural-pitch`: 6,066 parameters, 12 KB MIT weights, pYIN's `candidates` hook | 0 dB SNR: raw pitch 0.918 vs 0.499 (Vocadito), notes onset F 0.758 vs 0.526; trails YIN when clean | placement; option name (`neural` or `robust`); YIN stays default |
| `repair` by gap length | `lpc` (`arBridge`), `denoise-repair` (`plan`), audio `fn/spectral.js` | music: lowest LSD of any single tier at every gap length; cough 8.10 → 3.16 dB LSD | published (`lpc` 1.1.0, `denoise-repair` 0.2.0, `@audio/denoise` 0.4.0); audio's release |
| `vocals({ model })` | `neural-separate`, `neural-runtime` (`sessionOptions`), audio `fn/vocals.js`, `core.js` `prepare` hook | SDR equals Python on 50 MUSDB previews (vocals: umxhq 6.75, htdemucs 8.86); WebGPU 0.21× real time | host umxhq ONNX; Demucs weights are research-only |
| Neural denoise | `neural-denoise`: RNNoise (bit-exact, bundled 3.5 MB BSD-3), DeepFilterNet3; audio ops `rnnoise` (streaming) and `deepfilter` (prepare-style) | VoiceBank+DEMAND PESQ: noisy 1.97, `wiener` 2.19, DFN3 3.16 unlimited, 2.67 at a fixed 12 dB, 3.10 with audio's `deepfilter()` default (noise floor 45 dB under the input's loudness, at least the 12 dB `limit`); package defaults RNNoise 20 dB, DFN3 12 dB, `limit: 0` = upstream | DFN weight terms (deferred); recipes: speech chain agent |
| Famous synths | `synth-tonewheel`, `synth-tonewheel-fit`, `synth-dx7` (Apache-2.0) | drawbar fit 100% dry; DX7 zero differing samples vs MSFA | Apache package under the MIT umbrella |
| DX7 recognizer (M1) | `neural-timbre`: `createMatcher('dx7-factory')` offline, bundled int8 encoder (1.87 MB) and int4 catalogs (factory 0.21 MB, all 7.9 MB) | held-out voices 75.0% top-1, 92.6% top-5 (int4 catalogs: 74.0, 92.1); rebuild 1.9 seeded vs 9.6 blind | licences (deferred) |
| mel harmonics | mel `src/oscillator.js` | 256 partials; 0.9 ms per voice-second at 8 (was 6.6) | none |
| mel decompose | mel `src/decompose.js`, vendored nosc b18e8cc, with mel-1f's `points` volume | recordings 4.7–6.4 dB specDist (were 6.9–19.7) | REACH moved 6 → 7 dB |

Follow-ups:
- Done: `neural-transcribe` on `resample-sinc` 1.2.0 (968/969 notes identical to Python, 969/969 within one frame); `@audio/neural` lock refreshed; `rnnoise`, `deepfilter` and `notes({ robust })` wired into audio; the CLI binds a bare enum value to its op's parameter (`vocals remove`, `filter highpass 80hz`).
- Open: `fourier-transform`'s `stftStream` holds output back twice in hop-function mode (sliding stretch, warp); removing the second hold-back halves their latency (constant ratios already avoid it in audio's fn/stretch.js); the `@audio/denoise` lock after the denoise quality pass; publishing (the owner approves); `audio/node_modules/@audio/{pitch-pyin,denoise-repair,neural-separate,neural-transcribe,neural-denoise,neural-pitch}` are local symlinks until then; a stale comment at audio.js lines 12–13 (the rnnoise default now matches `denoise()`'s).
- Quality audits, 2026-09-27/28 (details in each package's README and tests):
  - Denoise: `imcra` rebuilt per Cohen 2003, OM-LSA per Cohen & Berdugo 2001 (bit-exact with a port of omlsa.m), minStats bias fixed, dehum measures hum first, frames follow the rate; VoiceBank+DEMAND PESQ omlsa 1.88 → 2.43 (noisy 1.97).
  - Loudness: BS.1770 gating grid and −70 LUFS gate fixed, max momentary/short-term slide per sample, normalize measures its selection, limiter and true peak use a 96-tap Kaiser kernel; all synthetic EBU Tech 3341/3342 cases pass; within 5e-5 LU of libebur128.
  - Other families: WMA replaced by FFmpeg's decoders (LGPL), AAC priming trimmed, MP3 LAME tag, SMPTE channel order, int↔float scaling exact (libswresample convention), EQ state kept under automation, LR4 crossover, stretch octave errors fixed, trapezoidal SVF in wah/autowah/exciter/sbr, STFT head fade removed, pcm-convert without top-level await (`ready` export).
  - Speech chain and recipes: compressor and eq dropped from speech recipes (both measurably hurt), neural variants added (`, neural`), "Remove room echo" removed until dereverb is fixed; Enhance speech PESQ 1.63 → 2.36 (neural 2.91), audiobook ACX 9/10 → 10/10 narrations. Final entries in `~/.cache/audiojs/snapshots/pending/final-recipes.txt`.
  - Dynamics defects (compressor detector topology and a 0.3 s silent tail on every compressed file, leveler lifting pauses +12 dB and peaking at +4.95 dBFS, limiter gain steps, de-esser modes): a tested patch waits for the owner's permission at `~/.cache/audiojs/snapshots/pending/dynamics.patch` (the agent's edits to @audio/dynamics were refused).
  - Chords: Chordino (NNLS chroma and chord HMM) ported from c4dm/nnls-chroma, equal to the plugin; GuitarSet majmin .583 → .746. Oscillators band-limited (BLEP), aliasing under −94 dB below 16 kHz. `toBatch` resolves ambisonic layout tags. PGHI stays out of the default stretch (fails audio's regression tests). AAC encoder settings already optimal.
- Licences: the Chordino port ships as the GPL-2.0-or-later `mir-nnls-chroma` and `mir-chordino`; the WMA decoder is an LGPL FFmpeg build with its notice; `synth-dx7` and `neural-transcribe` are Apache-2.0 with NOTICE files; still open: DeepFilterNet weight terms (fetched, never bundled), Demucs weights research-only, the DX7 catalog of `neural-timbre`.
  - Dereverb: replaced by recursive WPE (Nakatani 2010; Yoshioka & Nakatani 2012): reverberant speech PESQ 2.33 → 2.52 (the old op gave 1.55), dry speech 4.64 → 4.37 (old 1.60); speech only (a held tone loses 13 dB); breaking options (`t60`, `alpha`, `beta`, `predelay` gone, `lookahead` new). Restore the "Remove room echo" recipe as `$src.highpass(80).dereverb()` once 0.2.0 is published.

### Published, 2026-09-28

Each repo committed by file name, not pushed. Majors (or 0.x minors) wherever a published dependent, audio 2.7.0 included, would have changed under its caret range.

- `@audio/stft` 2.0.0; `lpc` 1.1.0, `noise-estimate` 2.0.0, `denoise-{dehum,dereverb,omlsa,repair,spectral,wiener}` 0.2.0, `@audio/denoise` 0.4.0 (README figures re-measured on stft 2.0.0).
- `loudness-truepeak` 1.1.6, `-lufs` 1.2.0, `-lra` 1.3.0, `-replaygain` 1.2.1, `@audio/loudness` 1.2.3.
- Decode: `-wav`, `-flac`, `-wavpack`, `-tta`, `-qoa` 2.0.0 (v/2^(bits-1)), `-aac` 1.6.0, `-mp4` 1.3.0, `-opus` 1.3.3, `-vorbis` 1.3.4, `-caf` 1.4.1, `-wma` 1.4.0, `@audio/decode` 4.0.0. Encode: `-mp3` 2.0.0, `-mp4` 1.2.0, `-opus` 1.3.1, PCM encoders patched, `@audio/encode` 1.9.0.
- `filter-biquad` 2.0.2; `eq-graphic` 1.2.4, `eq-{high,low}shelf`, `eq-parametric` 1.1.2; `effect-{wah,autowah}` 1.1.5, `effect-{exciter,sbr}` 1.2.1; `stretch-pghi` 1.3.0, `@audio/stretch` 2.1.0; `dynamics-compressor` 0.3.0, `-leveler` 0.2.0, `-limiter` 0.1.6, `@audio/dynamics` 0.3.0.
- Beat: `onset` 1.0.3, `beat-tempo` 2.0.0, `beat-detect` 1.1.0, `beat-track` 1.1.0, `@audio/beat` 3.0.0.
- Synth: `synth-osc` 1.1.0, `-sfx` 1.1.4, `-dx7`, `-tonewheel`, `-tonewheel-fit` 0.1.0, `@audio/synth` 1.3.0.
- `pitch-pyin` 2.0.0 (MIT: the note model reimplements Tony's from its paper and parameters, no code or table copied).
- Chords: `mir-nnls-chroma` 1.0.0 and `mir-chordino` 1.0.0, GPL-2.0-or-later (the port copies the plugin's profile tables); `mir-chroma` and `mir-chord` stay MIT and unchanged. audio takes them as optional peers: `chords` and default `key` need them installed; `key({ method: 'pcp' })` does not.
- Neural: `neural-runtime`, `-separate`, `-transcribe`, `-denoise`, `-pitch` 0.1.0, optional peers of audio.

Not published: `pcm-convert` 3.3.0 (committed; npm wants the owner's OTP), `neural-timbre` (DX7 catalog terms), audio itself (after pcm-convert; its lock gets the pcm-convert entry from `npm install` then).

Follow-ups: `denoise-detect` still pins the 0.1.x kernels and stft 1.x, so `@audio/denoise`'s `denoise()` runs the old ones (detect 0.3.0); `dynamics-multiband` and the six compressor dependents stay on compressor 0.2.x (identical `compressorGain`); Opus in MP4 is not end-trimmed (10248 samples where ffprobe says 9600); 7.1 AAC channel order is not mapped; `fn/beat.js` `detect()` and `fn/spectrum.js` read the first channel only.

## Next, from 2026-09-29

Done: Order steps 1, 2, 4 and 5 (ops, `vocals` weights, audio → mel baseline, recognizer M0 and M1) and mel's harmonics. In order, what follows:

1. **Track 4, modal snapshots.** No training; `synth-modal` already plays `modes`. Build the fit: `sinusoidal-track` partials, a decay fit per partial (log-envelope regression; matrix pencil where modes sit closer than a bin), `{ ratio, gain, t60 }` out. Bench frozen first: synthetic modal renders with exact modes (ratio, t60 error), then recordings (karatalas, bells, mridanga, tabla), scored by render-and-compare (`specLoss`). Done when a karatala re-rendered from its snapshot scores under the bench's threshold and plays in mel.
2. **mel engine, rest of step 3.** The filter and inharmonic partials: Track 4's snapshots and M2's subtractive voices both need them, and analysis can't beat what the engine reaches.
3. **Recognizer M2, subtractive families.** Corpus from the audiojs filter models (`filter-moog-ladder`, `-diode-ladder`, `-korg35`, `-oberheim`) and OB-Xd and Surge XT presets rendered headless (DawDreamer). Family and model heads on the M1 encoder recipe, catalog bound to its SHA; a seeded `match` refines the named preset. Bench: held-out presets and held-out synths, frozen before training.
4. **Recognizer M3, real recordings.** `neural-separate` stems → note segments → recognizer → a timeline of named sounds; calibrate the "not in the catalog" threshold from rebuild distance.
5. **Track 3, gesture × snapshot.** Harmonic amplitude tables over pitch and loudness taken from a recording, played by mel from a new pitch curve (DDSP's split without a network at playback).
6. **Encoders where classical analysis fails (step 6).** Folding partials into curves, noise, reverb, polyphony: trained on mel's seeded renders, the GPU as data factory and candidate search.
7. **Voice (step 8).** kNN-VC on WavLM features (`neural-diarize` already runs WavLM) with a vocoder, or a Kokoro voicepack encoder; "verified" is the speaker-verification cosine at the equal-error threshold.

Open for the owner: `neural-timbre`'s DX7 catalog terms (unpublished until then); DeepFilterNet weight terms (fetched, never bundled).

## Principle

gpu-font's [research.md](../../gpu-font/research.md) records the gpu-time rule: "Predict the uncertain part; compute deterministic rules normally." Audio's best small models follow it: RNNoise predicts 22 band gains and leaves the rest to DSP; DDSP drives a fixed additive synth. The [neural lane policy](../../@audio/neural/README.md) agrees: classical tools never require ML, deterministic pipelines stay classical.

## Where the GPU pays

| Pays | Why |
|---|---|
| Many candidates at once | Analysis by synthesis: render thousands of candidate patches in parallel, score each against the target. CMA-ES populations in `neural-synth` have exactly this shape. |
| Many signals at once | Indexing a sample or preset library; rendering training sets. torchsynth renders 16,200× real time on one GPU (synth1B1: a billion 4-second sounds with their parameters). |
| All-pairs search | Catalog nearest neighbours (gpu-font's core), kNN-VC frame matching, fingerprints, self-similarity matrices, DTW between takes. |
| Grids and banks | FDTD plates, membranes and rooms; banks of thousands of modes; HRTF convolution for many sources. |
| Networks | Separation, pitch, transcription, denoise, TTS. |

| Doesn't pay | Why |
|---|---|
| Recursive DSP on a few channels | IIR filters, envelopes, compressors: each sample waits for the previous one. Exceptions: thousands of filters at once, or IIR as a parallel prefix scan (how S5 and Mamba train), a digital-filter experiment. |
| Single-file edits | Gain, trim and meters move a lot of memory and do little math; upload and readback cost more than the work. jz/WASM is the lever here ([todo.md](todo.md), "jz/WASM lane"). |
| Live playback in the browser | WebGPU is exposed to windows and workers, not AudioWorklet, and readback is async. A GPU in the audio path needs a worker, a ring buffer and buffering against jitter: fine for rendering ahead, wrong for playing an instrument. |

## gpu-font, mapped to sound

| gpu-font | Sound |
|---|---|
| Chromium renders labeled crops | mel's seeded renderer, audiojs synths and open emulators render labeled sounds |
| Font file | Timbre: synth preset, instrument, voice |
| Text | Score: MIDI, pitch curve, phonemes |
| Encoder → 4-bit vectors bound to its SHA | Encoder → timbre vectors bound to its SHA |
| The font file renders any text | Needs a renderer: something must play any score |

The last row is the whole difference: a font vector points at a file that renders; a timbre vector renders nothing. Three ways to fill it:

1. **Patch + fixed engine.** Catalog entry = mel component or synth preset; the engine plays it. Train an encoder only. Tiny, editable, deterministic; capped by what the engine can express.
2. **Vector + neural decoder** (DDSP family). A generator must be trained too, and near-misses are audible: the second-ranked font is still a real font, a second-best decoded voice is a wrong voice.
3. **Reference frames + universal vocoder** (kNN-VC). No per-voice training; the core step is nearest-neighbour search.

Tracks 1–4 use the first way; voice needs the third.

## Track 1: famous-synth recognizer

**What.** A recording goes in; synth and preset come out with a score, then a rebuild. For analysis: "a TB-303 line, a Juno pad and an 808 kit in this track". For mel: each named sound becomes an editable component, the start of "remake this track in mel".

**Levels.** Engine family (FM, subtractive, wavetable, sample ROM, drawbar organ, electromechanical) → model (DX7, Juno-106, TB-303, Minimoog, JP-8000, M1, D-50, Prophet-5, OB-Xa, Hammond B-3, Rhodes) → preset (factory names) → parameters (fitted). Each level carries its own score. Answer at the family level when the model is uncertain: subtractive synths of one topology sound alike.

**Catalog.** As in gpu-font: one vector per preset, the mean over its rendered notes, bound to the encoder SHA. Ship names and vectors only (gpu-font's DaFont and Adobe policy); preset files and renders stay in a local `.data/`. Drum machines (808, 909, LinnDrum) form a sibling catalog of one-shots.

**Data factory.**

| Source | Gives |
|---|---|
| Open emulators rendered headless with DawDreamer or pedalboard (VST3/AU, MIDI, parameter control, multiprocess) | Dexed (DX7: original cartridges load as-is), OB-Xd, Surge XT, Vital: factory and community presets with exact parameters |
| audiojs atoms | `synth-fm`, `synth-osc`, `synth-wavetable`, `synth-poly` with `filter-moog-ladder` (Minimoog), `filter-diode-ladder` (TB-303), `filter-korg35` (MS-20), `filter-oberheim` (SEM): family emulations rendered in Node |
| torchsynth / synth1B1 | Pretraining: a billion sounds with parameters, rendered on the GPU |
| NSynth | General timbre pretraining: 305,979 notes from 1,006 instruments |
| Multisampled recordings of hardware | Evaluation only, kept local |

Phrase set per preset: single notes across the range at several velocities, chords, a legato line, a held pad note, an arpeggio. Augment with audiojs itself: reverb, delay, chorus, EQ and compression (`reverb-*`, `effect-*`, `eq-*`, `dynamics-*`), mix context at set SNRs (Slakh2100 stems, CC BY 4.0), codecs (`encode-mp3`, `encode-opus`, `encode-aac`).

**Model.** A small encoder on log-mel or CQT frames, trained contrastively: positives are the same preset on other notes and augmentations. Heads for family and model. Export through `neural-runtime` (ONNX, WebGPU) or custom WGSL as gpu-font does; quantize as gpu-font does (6-bit weights, 4-bit catalog vectors).

**Rebuild.**

1. A renderable synth is recognized: its preset parameters seed `neural-synth`'s `match` (the `seeds` option), which refines toward the recording. For the DX7's 155 voice parameters the seed decides everything: blind CMA-ES at that dimension does not converge within a sane budget (estimate).
2. mel: map the preset to a mel component (a reference-corpus entry, or the audio → mel analysis of Track 2 run on its clean render), then refine with `match` over mel's parameters.

**Milestones.**

- **M0, Hammond registrations, no training.** Nine drawbars, 0–8 each, set harmonics 1, 3, 2, 4, 6, 8, 10, 12 and 16 of the 16′ pitch, in drawbar order (footage arithmetic: 16 divided by each footage). Recognition is a harmonic fit plus rounding: "888000000" comes back as itself. It exercises recognize → rebuild in mel end to end and needs mel's harmonic cap raised from 8 to 16. Tonewheels are equal-tempered: the quint drawbars sit 2 cents flat of true harmonics and the tierce 14 cents sharp (arithmetic), so integer harmonics give a close, slightly purer organ.
- **M1, DX7 via Dexed.** Factory ROM and public cartridges (32 voices each). Held-out cartridges are the bench. Recognizer plus seeded match.
- **M2, subtractive families** through the audiojs filter models and the OB-Xd and Surge XT presets.
- **M3, real recordings.** `neural-separate` stems → recognizer per stem and per note segment → a timeline of named sounds.

**Bench**, frozen before training as gpu-font's is: held-out presets of seen synths, held-out synths, a set of real recordings. Metrics: top-1 and top-5 per level; the rebuild's spectral distance before and after refinement.

**Risks.**

- Presets are usually tweaked: retrieval gives the nearest known preset, refinement closes the rest.
- Effects and the mix mask identity: separate first, and augment during training.
- Polyphony and layering: recognize per stem and per segment.
- Unknown synths: a calibrated threshold for "not in the catalog" (gpu-font's `threshold` is still `null`; here the rebuild distance measures it).

**Prior art.** Contrastive instrument and synthesizer retrieval (2025: 3,884 instruments; 81.7% top-1 and 95.7% top-5 on three-instrument mixtures). DX7 audio–parameter shared embeddings (2026: a graph network over the 32 algorithms retrieves presets from a gallery and beats baselines on held-out algorithms). SynthScribe (2023: CLAP-embedded presets for text and audio search). Synplant 2's Genopatch (commercial matching). Open ground: a browser tool that names famous synths and rebuilds them as an editable document.

## Track 2: audio → mel curves

- **Why.** mel's readme lists "decomposition of samples into oscillators" as future work; its [R&D](../../mel/r&d.md) wants famous sounds as small patches. The [neural lane's M6](../../@audio/neural/todo.md) ends with "Wire into mel: target vector sound → configured synth patch".
- **Classical baseline, no training.** A mel curve (pitch, level, breadth in cents) is the bandwidth-enhanced partial of Loris (Fitz & Haken): frequency, amplitude and noisiness over time. `sinusoidal-track` already does McAulay–Quatieri tracking. Add bandwidth association (Loris assigns noise energy to nearby partials in Bark-width regions) and a fold into curves: harmonic groups become one Oscillator curve, the rest become Noisc curves, and points are simplified to mel's 20 ms spacing. SPEAR and Loris stop at hundreds of raw partials; the fold into a few editable curves is the new part.
- **Verification is free.** Render the result and measure its distance to the input with `neural-synth`'s `specLoss`. That is the score, and the threshold for "mel can't represent this" is measurable.
- **Network, where classical analysis fails.** Folding hundreds of partials into a few curves, noise, reverb, polyphony. Train on mel's own seeded renders (unlimited, exact labels), as gpu-font trains on Chromium renders. Parameter loss alone misleads, because different patches sound alike: score the re-render's spectrum through a PyTorch twin of mel's renderer, parity-tested against the JS one, comparing power spectra because Noisc is random per seed. This is M6's "inverse model per synth", with mel as the synth.
- **Engine first.** Analysis can't beat what the engine can reach. mel's R&D names the gaps; for analysis the order is: harmonics beyond 8 (inverse-FFT additive synthesis, Rodet & Depalle 1992, costs a few spectral bins per partial per frame instead of a per-sample oscillator; no GPU needed), then the filter, inharmonic partials (components), transients.
- **Text in.** Swap the target for a text prompt and the same search makes sounds from words. CTAG (ICML 2024) evolves a 78-parameter synth toward a CLAP text score, and the result stays inspectable. Synplant 2's PhenoType (2026) ships text → patch.

## Track 3: gesture × snapshot

mel's "sound = gesture × source" is DDSP's split: Engel et al. (2020) trained a violin model on 13 minutes of recordings and played it from a singer's pitch and loudness. Without a network at playback, the snapshot is a table: harmonic amplitudes over (pitch, loudness, time since onset), a noise envelope and an attack. The renderer interpolates. Gestures come from MIDI, drawn curves, or a sung line through a pitch tracker (see pitch-detect below).

## Track 4: modal snapshots

A strike is a sum of decaying partials, so the snapshot is one `{ ratio, gain, t60 }` per mode, which `synth-modal` already takes as `modes`. Analysis: `sinusoidal-track` plus a decay fit per partial, or matrix pencil / ESPRIT for close modes.

Prior art: Ren, Yeh & Lin 2013 (a material estimated from one recording); NeuralSound (SIGGRAPH 2022: modal analysis of most new objects in under a second on a GPU); DiffSound (SIGGRAPH 2024: physical parameters recovered from recordings).

First corpus: kirtan instruments. Karatalas and bells are modal. C. V. Raman showed loaded Indian drumheads (he measured mridangam and tabla) keep nine modes grouped into five harmonic tones, so a mridanga snapshot is tiny. `@audio/voice` already notes mridangam-syllable experiments.

## Track 5: voice

A timbre snapshot can't speak: speech is formant motion, which is content, not identity. mel curves reach sine-wave speech at best (Remez et al. 1981: three sinusoids tracking formants, intelligible to a listener who knows the sentence). Natural voice takes the neural route:

- **kNN-VC** (Interspeech 2023). WavLM-Large layer 6 features, one 1024-d vector per 20 ms; each source frame becomes the mean of its 4 nearest neighbours (cosine) among the target's frames; a HiFi-GAN trained on prematched features vocodes. No per-voice training. 5 minutes of target is about as good as 8; under 30 s it falls behind trained systems. The source can be `neural-tts` output or a recording, so text, MIDI and pitch curves all reduce to "make source audio, then match". Cost (arithmetic): 5 minutes = 15,000 vectors, about 30 MB at fp16 or 8 MB at 4 bits, per voice; WavLM-Large has about 316M parameters. Server or strong WebGPU.
- **Singing.** NeuCoSVC (ICASSP 2024) keeps the kNN matching and drives an explicit harmonic generator from pitch and loudness, so the pitch curve stays editable: mel's gesture fits there.
- **Kokoro-82M** is a fixed model with a voice catalog already: voicepacks of [510, 1, 256] float32, about 0.5 MB each, running in the browser on WebGPU. It ships no voice encoder; KVoiceWalk random-walks the style tensor against a speaker-similarity score (GPU forks exist). An audio → voicepack encoder is a gpu-font-shaped project whose catalog format already exists. `neural-tts` (SpeechT5, one 512-d x-vector per voice) has the same shape at lower quality.
- **"Verified" is a number.** Speaker-verification cosine between output and reference, thresholded at the equal-error rate (the measure kNN-VC reports); `neural-diarize` already runs WavLM speaker embeddings. Signed catalog entries and a watermark (AudioSeal, 2024) make consent checkable.

## Ops: vocals, pitch-detect, repair

| Op | Today | Upgrade | Data to collect | Training | GPU |
|---|---|---|---|---|---|
| `vocals` | mid/side center cancel (`@audio/vocals`) | `neural-separate` with pretrained weights | none | none; distillation optional | yes: WebGPU, WASM fallback |
| `notes` (pitch-detect) | YIN per frame, rounded to MIDI | pYIN + Viterbi notes + onsets, then PESTO-class and Basic Pitch | none | none; a small self-supervised model optional | no |
| `repair`, `spectral` | log-magnitude interpolation, phase from the leading context | route by gap length to existing kernels | none | none; speech-only neural tier optional | no |

### vocals

1. **Weights.** Run `scripts/export-openunmix.py --model umxhq --verify` (MIT weights): the first working neural `vocals`. Then HTDemucs for quality: overall SDR 9.0 (fine-tuned HT Demucs) against 5.3 (Open-Unmix), per the Demucs README. Vanilla ONNX export of htdemucs fails; demucs.onnx moves STFT/iSTFT outside the graph and runs under onnxruntime-web. `neural-separate` needs a `modelType: 'hybrid'` for that contract, reusing its torch-compatible STFT.
2. **License.** Demucs code is MIT, but its weights are research-only: "The model weights are not covered by the MIT license, and are provided only for scientific purposes" (the author, facebookresearch/demucs#327; again in #508). The repo is archived (2025); adefossez/demucs is the maintained fork. So HTDemucs is a personal and research tier, and Open-Unmix umxhq (MIT weights) is the shippable one.
3. **Op.** Mid/side stays the default: instant, nothing to download. The neural path is opt-in (`vocals({ model })`, or a `stems` op for four stems). `neural-separate`'s 30 s chunks with 2 s crossfades fit the lookahead pattern `match` already uses.
4. **Runtime and size.** Measure the real-time factor on WebGPU, WASM and Node, as gpu-font reports 0.05 s on WebGPU against 1.2 s on the CPU. Ship fp16; cache in the neural cache.
5. **Bench.** MUSDB18-HQ's 50 test tracks with SDR, for measurement only (its terms are educational, non-commercial); plus real cases: speech over a music bed, karaoke.
6. **Leverage.** Separation is the front end for Track 1's M3 and for the pitch of a voice inside a mix.

Training: none for v1. Optional distillation for a worklet-sized model: HTDemucs labels unlabeled CC BY or CC0 music, no stems needed. Training a separator from scratch is out: vocal multitracks at scale are non-commercial (MUSDB18-HQ, MoisesDB), and Slakh2100 has no vocals.

### pitch-detect

1. **Classical first, the biggest win, no ML.** `notes` runs YIN on 2048-sample frames with a 1024 hop and rounds each frame to a MIDI number, so vibrato and glides split into note flurries and repeated notes merge. Use pYIN's posterior (`@audio/pitch-pyin`) with Viterbi note tracking (Mauch & Dixon 2014; Tony, Mauch et al. 2015) and split at onsets. The `track()` that pyin.js's comment names doesn't exist yet: write it.
2. **Robust monophonic pitch: PESTO-class.** Under 30k parameters, 800× fewer than CREPE, 12× real time on a CPU; streaming version 2025. Code and weights are LGPL-3.0: host the weights separately, or train MIT weights of our own, self-supervised on unlabeled audio or supervised on synth renders with exact f0 (hours on the M4 Max, estimate).
3. **Polyphonic notes with pitch bends: Basic Pitch** (Apache-2.0, npm `@spotify/basic-pitch`, ICASSP 2022), beside the classical `mir-transcribe` (Klapuri multi-F0). Its bends map onto mel curves: a direct audio → mel note import.
4. **A voice inside a mix:** `vocals`, then monophonic pitch. No new model.
5. **Chords and key** stay classical (NNLS chroma, Krumhansl–Schmuckler).

Data: none to collect. Training: optional and small. If a transcriber is ever trained: Slakh2100 (CC BY 4.0, 2,100 tracks, 145 h, from 187 patches) or our own renders from MIDI, which is Track 1's data factory again. MAESTRO is non-commercial.

### repair

Route by gap length; every tier has a kernel already:

| Gap | Method | Kernel |
|---|---|---|
| clicks, dropouts up to tens of ms | AR least-squares interpolation (Janssen 1986; Godsill & Rayner 1998) | `denoise-declick`'s interpolator, `lpc` |
| 50–500 ms, tonal | sinusoidal bridge: match partials across the gap, interpolate frequency and amplitude | `sinusoidal-track`, `sinusoidal-synth` |
| half a second and longer, music | similarity transplant: the most similar passage elsewhere, crossfaded in (Perraudin et al. 2018) | `mir-structure`'s self-similarity |
| band-limited regions (cough, ring) | log-magnitude interpolation, plus sinusoidal continuation of partials crossing the band, plus a matched noise floor | `denoise-repair`, `noise-estimate` |

Neural tier, optional: speech dropouts with a packet-loss-concealment-class model, trained self-supervised by masking clean speech (LibriTTS-R: 585 h, CC BY 4.0); days on one GPU (estimate). General-music neural inpainting (GACELA 2021; CQT-diff 2023, one diffusion prior for inpainting, declipping and bandwidth extension, trained on piano) needs large diverse data and big models: skip.

Data: none for the classical tiers. Training: only for the optional speech tier.

Adjacent: neural denoise and dereverb (the lane's M5, RNNoise → DeepFilterNet, weights audit first) has the strongest market pull; [market.md](market.md) marks us "weak on bad rooms".

## Order

1. Ops, classical: `notes` on pYIN + Viterbi + onsets; `repair` routing. No ML.
2. `vocals` neural path with Open-Unmix HQ weights, then HTDemucs via `modelType: 'hybrid'`.
3. mel engine: harmonics by inverse FFT (16 or more, for Hammond), the filter, inharmonic partials.
4. Audio → mel classical analysis (`sinusoidal-track`, bandwidth association, the fold) with the render-and-compare score.
5. Recognizer M0 (Hammond) and M1 (DX7 via Dexed), with frozen benches.
6. Encoders where classical analysis fails; the GPU as data factory and candidate search.
7. Recognizer M2 and M3 on real recordings through separation.
8. Voice, later: kNN-VC or a Kokoro voicepack encoder, with mel supplying the gesture.

## Open question

Is the goal "reproduce any sound" or "make any sound editable"? Neural codecs (EnCodec, DAC) already do the first at a few kbps, opaquely. Only the second is mel's: drop in a recording, get curves you can drag and a name for what it was.

## Sources

Local: [gpu-font README](../../gpu-font/README.md), [gpu-font research.md](../../gpu-font/research.md), [mel readme](../../mel/readme.md), [mel R&D](../../mel/r&d.md), [neural lane README](../../@audio/neural/README.md), [neural lane todo](../../@audio/neural/todo.md), `neural-synth` and `neural-separate` READMEs, `sinusoidal-track`, `synth-modal`, `pitch-pyin`, `mir-transcribe`, `denoise-repair`, `denoise-declick` READMEs.

GPU and runtime:
- [Navigator.gpu (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/gpu), [AudioWorkletGlobalScope (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletGlobalScope)
- [torchsynth / synth1B1](https://arxiv.org/abs/2104.12922), [code](https://github.com/torchsynth/torchsynth)

Synths and matching:
- [Contrastive timbre representations for instrument and synthesizer retrieval](https://arxiv.org/abs/2509.13285)
- [FM synthesizer audio-parameter shared embeddings (DX7)](https://arxiv.org/abs/2608.18226)
- [SynthScribe](https://arxiv.org/abs/2312.04690)
- [Synplant 2](https://soniccharge.com/synplant), [PhenoType](https://audionewsroom.net/2026/06/phenotype-generate-synplant-2-patches-from-prompts.html)
- [CTAG](https://arxiv.org/abs/2406.00294)
- [DawDreamer](https://dirt.design/DawDreamer/), [pedalboard](https://github.com/spotify/pedalboard)
- [NSynth](https://www.tensorflow.org/datasets/catalog/nsynth)

Analysis and synthesis:
- [DDSP](https://arxiv.org/abs/2001.04643), [RNNoise](https://jmvalin.ca/demo/rnnoise/)
- [Loris](https://www.cerlsoundgroup.org/Loris/)
- McAulay & Quatieri 1986, "Speech analysis/synthesis based on a sinusoidal representation", IEEE TASSP
- Rodet & Depalle 1992, "A new additive synthesis method using inverse Fourier transform and spectral envelopes", ICMC
- Ren, Yeh & Lin 2013, "Example-guided physically based modal sound synthesis", ACM TOG
- [NeuralSound](https://arxiv.org/abs/2108.07425), [DiffSound](https://arxiv.org/abs/2409.13486)
- [Raman, The Indian musical drums](https://ed.iitm.ac.in/~raman/1935PIAS.pdf)

Voice:
- [kNN-VC](https://arxiv.org/abs/2305.18975), [NeuCoSVC](https://arxiv.org/abs/2312.04919)
- [Kokoro voicepack format](https://huggingface.co/cstr/kokoro-voices-GGUF), [KVoiceWalk](https://github.com/RobViren/kvoicewalk)
- [Sine-wave speech (Remez et al. 1981)](https://www.science.org/doi/10.1126/science.7233191)
- AudioSeal: San Roman et al. 2024, "Proactive detection of voice cloning with localized watermarking", ICML

Separation, pitch, repair:
- [Demucs](https://github.com/facebookresearch/demucs), [demucs.onnx](https://github.com/sevagh/demucs.onnx), [free-music-demixer](https://github.com/sevagh/free-music-demixer)
- [MUSDB18-HQ](https://zenodo.org/records/3338373), [MoisesDB](https://github.com/moises-ai/moises-db), [Slakh2100](https://zenodo.org/records/4599666), [MAESTRO](https://magenta.tensorflow.org/datasets/maestro), [LibriTTS-R](https://www.openslr.org/141/)
- [PESTO](https://arxiv.org/abs/2309.02265), [PESTO real-time](https://arxiv.org/abs/2508.01488), [PESTO code (LGPL-3.0)](https://github.com/SonyCSLParis/pesto)
- [Basic Pitch](https://github.com/spotify/basic-pitch), [basic-pitch-ts](https://github.com/spotify/basic-pitch-ts)
- Mauch & Dixon 2014, "pYIN", ICASSP; Mauch et al. 2015, "Computer-aided melody note transcription using the Tony software", TENOR
- Janssen, Veldhuis & Vries 1986, "Adaptive interpolation of discrete-time signals that can be modeled as autoregressive processes", IEEE TASSP; Godsill & Rayner 1998, *Digital Audio Restoration*
- Perraudin et al. 2018, "Inpainting of long audio segments with similarity graphs", IEEE/ACM TASLP
- Marafioti et al. 2021, "GACELA", IEEE JSTSP; Moliner, Lehtinen & Välimäki 2023, "Solving audio inverse problems with a diffusion model" (CQT-diff), ICASSP
