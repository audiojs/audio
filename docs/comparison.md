# Comparison & Alternatives

A landscape of audio tools across the web, Python, CLI, and desktop. The goal: help you pick the right tool for the job — including, often, *not* `audio`.

`audio` occupies a specific niche: **a non-destructive audio workstation library for JavaScript runtimes (Node, Deno, Bun, browsers)**. Decode, edit, analyze, encode, play, record — chainable API + CLI, no native binaries, ~20 KiB gzipped core.

`audio` is part of the [audiojs](https://github.com/audiojs) ecosystem — a constellation of small focused packages (`audio-decode`, `encode-audio`, `audio-speaker`, `audio-mic`, `audio-filter`, `pcm-convert`, `pitch-detection`, `wavearea`, ...) that together cover most JS audio needs. `audio` itself composes many of them into a unified workstation.


## Comparison matrix

Cells contain method/op names where supported, `—` if absent, `(plan)` if planned for `audio`. Comma-separated lists are not exhaustive.

| | **audio** | **pydub** | **librosa** | **aubio** | **essentia** | **Pedalboard** | **SoX** | **FFmpeg** | **Audacity** | **MATLAB Audio Toolbox** |
|---|---|---|---|---|---|---|---|---|---|---|
| **Identity** | | | | | | | | | | |
| Scope | edit + analyze + play + record | high-level edit (slice/fade/normalize) | MIR / analysis | pitch + onset + beat + MFCC | MIR / 240+ algorithms | effects + VST hosting | CLI batch DSP | CLI multimedia | desktop GUI editor | scientific DSP + ML for audio |
| Language | JS / TS | Python | Python | C (Python/JS bindings) | C++ (Python/JS bindings) | Python (C++/JUCE core) | C | C | C++ | MATLAB |
| Platform | Node, Deno, Bun, browser | Python (needs FFmpeg) | Python 3 | native, Python, browser (WASM) | native, Python, browser (essentia.js) | Python (native) | native CLI | native CLI + libs | native app (Win/Mac/Linux) | MATLAB R20xx+ |
| Packaging | `npm i audio` (~20 KiB gz) | `pip install pydub` | `pip install librosa` | `brew install aubio`, `pip install aubio` | `brew install essentia`, build from source | `pip install pedalboard` | `brew install sox` | `brew install ffmpeg` | standalone installer | Mathworks license |
| License | MIT | MIT | ISC | GPL-3 | AGPL-3 (commercial avail.) | GPL-3 | GPL/LGPL | LGPL/GPL | GPL-2 | proprietary |
| Open/closed | open | open | open | open | open | open | open | open | open | closed |
| API style | chainable + plan | chainable `AudioSegment` | functional (NumPy) | functional + CLI | algorithm objects `Algo()(in)` | callable chain | CLI args | CLI args | GUI + Nyquist + macros | functional + System objects |
| CLI | `audio in.wav ...` | — | — | aubiopitch/onset/tempo/notes/mfcc/quiet/track | `essentia_streaming_extractor_music` | — | yes | yes | macros only | — |
| Link | <https://github.com/audiojs/audio> | <https://github.com/jiaaro/pydub> | <https://librosa.org> | <https://aubio.org> | <https://essentia.upf.edu> | <https://github.com/spotify/pedalboard> | <https://sox.sourceforge.net> | <https://ffmpeg.org> | <https://audacityteam.org> | <https://mathworks.com/products/audio.html> |
| **I/O** | | | | | | | | | | |
| Decode formats | wav, mp3, flac, ogg, opus, aac, aiff, caf, webm, amr, wma, qoa | anything FFmpeg supports | wav, mp3, flac, ogg (audioread) | wav, aiff, flac, ogg, mp3 (libsndfile/ffmpeg) | wav, mp3, flac, ogg, m4a (FFmpeg) | wav, aiff, flac, mp3, ogg (+ AAC/AC3/WMA per platform) | wav, aiff, mp3, flac, ogg, au | virtually every codec | wav, mp3, flac, ogg, opus, m4a, ... | wav, flac, mp3, ogg, mp4, m4a |
| Encode formats | wav, mp3, flac, opus, ogg, aiff | export via FFmpeg | wav (via soundfile) | wav | wav | same as decode | same as decode | same as decode | wav, mp3, flac, ogg, opus | wav, flac, ogg, m4a, mp4 |
| Streaming | yes (page-based, OPFS) | no | eager (NumPy) | yes (frame-by-frame source) | yes (streaming network) | yes (chunked O(1)-mem) | no | no | no | `dsp.AudioFileReader` |
| Async iterator | `for await (chunk of a.stream())` | — | — | source iteration | streaming network | `while f.tell() < f.frames` | — | — | — | block-by-block read |
| **Editing** | | | | | | | | | | |
| Non-destructive | yes (edit plan, replayable) | no | no | n/a (analysis) | n/a (analysis) | no | no | no | partial (history) | no |
| Undo | `a.undo(n?)` | — | — | — | — | — | — | — | yes (GUI) | — |
| Serialize edits | `JSON.stringify(a)` | — | — | — | pool serialization | — | — | — | project file | — |
| Crop / trim | `crop({at, duration})` | `seg[a:b]` | slicing | source slicing | `Slicer`, `Trimmer` | array slice | `trim` | `atrim` | Trim | array slice |
| Remove range | `remove({at, duration})` | manual | manual | — | — | manual | — | — | Cut | manual |
| Insert | `insert(src, {at})` | `seg[:a] + new + seg[a:]` | manual | — | — | manual | — | — | Paste | manual |
| Repeat | `repeat(n)` | `seg * n` | `np.tile` | — | — | manual | `repeat` | `aloop` | Repeat | `repmat` |
| Pad silence | `pad(before, after?)` | `silence + seg` | `pad_center` | — | — | manual | `pad` | `apad` | Generate→Silence | zeros padding |
| Mix / overlay | `mix(b, {at})` | `overlay()` | `y1+y2` | — | — | manual sum | `-m combine` | `amix`, `amerge` | Mix and Render | sum |
| Concat / crossfade | `crossfade(b, dur, curve?)` | `+`, `append(crossfade=)` | manual | — | — | — | `splice` | `acrossfade` | Crossfade Tracks | `crossfade` |
| Reverse | `reverse({at,duration})` | `reverse()` | `y[::-1]` | — | — | — | `reverse` | `areverse` | Reverse | `flip` |
| Pan | `pan(value, {at, duration})` | `pan()` | manual | — | — | — | (via remix matrix) | `pan` | Stereo→Mono only | `audioPanner` |
| Remix channels | `remix(layout)` | `set_channels()` | manual | — | `MonoMixer`, `StereoMuxer` | — | `remix` | `channelmap`, `pan` | Stereo to Mono | matrix multiply |
| **Time / pitch** | | | | | | | | | | |
| Speed (pitch+tempo) | `speed(rate)` | `speedup()` | resample | — | — | — | `speed` | `asetrate` | Change Speed | resample-based |
| Time stretch | `stretch(factor)` | — | `effects.time_stretch` | — | — | — | `tempo`, `stretch` | `atempo`, `rubberband` | Change Tempo, Paulstretch | `stretchAudio` |
| Pitch shift | `pitch(semitones)` | — | `effects.pitch_shift` | — | — | `PitchShift(semitones)` | `pitch` | `rubberband=pitch` | Change Pitch | `shiftPitch` |
| Resample | `resample(sr, opts?)` | `set_frame_rate()` | `librosa.resample` | — | `Resample` | `Resample(target_sr)` | `rate` | `aresample` | Project rate | `resample` |
| **Volume / dynamics** | | | | | | | | | | |
| Gain (dB) | `gain(dB \| t=>dB)` | `seg + dB` | `y * gain` | — | `Multiplier` | `Gain(db)` | `gain`, `vol` | `volume` | Amplify | scalar multiply |
| Fade in/out | `fade(in, out?, curve?)` | `fade_in/fade_out` | manual | — | — | — | `fade` | `afade` | Fade In/Out, Adjustable Fade | `fade` |
| Peak normalize | `normalize()` | `effects.normalize` | `util.normalize` | — | `Normalize` | — | `norm` | `volume=normalize` | Normalize | manual |
| LUFS normalize | `normalize('podcast')` | — | custom | — | `LoudnessEBUR128` (measure) | — | — | `loudnorm` | Loudness Normalization | `integratedLoudness` |
| DC removal | `normalize({dc:true})` | — | custom | — | `DCRemoval` | — | `dcshift` | `dcshift` | DC | highpass at low f |
| Compressor | (plan) | `compress_dynamic_range()` | custom | — | — | `Compressor(thr, ratio)` | `compand` | `acompressor` | Compressor | `compressor` |
| Limiter | (plan) | — | — | — | — | `Limiter` | (`compand` ∞) | `alimiter` | Limiter | `limiter` |
| Gate | (plan) | — | — | — | — | — | `compand` neg | `agate` | Noise Gate | `noisegate` |
| Distortion / clip | (plan) | — | — | — | — | `Distortion`, `Clipping` | `overdrive` | `asoftclip` | Distortion | custom |
| Bit crush | (plan) | — | — | — | — | `Bitcrush` | — | `acrusher` | (plugin) | custom |
| **Filters** | | | | | | | | | | |
| Highpass | `highpass(f)` | `high_pass_filter()` | `scipy.signal.butter` | `digital_filter` | `HighPass` | `HighpassFilter` | `highpass` | `highpass` | High-Pass Filter | `designfilt`, `highpass` |
| Lowpass | `lowpass(f)` | `low_pass_filter()` | `scipy.signal.butter` | filter | `LowPass` | `LowpassFilter` | `lowpass` | `lowpass` | Low-Pass Filter | `lowpass` |
| Bandpass | `bandpass(f, Q?)` | `band_pass_filter()` | `butter` | filter | `BandPass` | — | `bandpass` | `bandpass` | (Filter Curve) | `bandpass` |
| Notch | `notch(f, Q?)` | — | custom | filter | `BandReject` | — | `band -n` | `bandreject` | Notch Filter | `bandstop` |
| Allpass | `allpass(f, Q?)` | — | custom | filter | `AllPass` | — | `allpass` | `allpass` | — | `designfilt` |
| Low/high shelf | `lowshelf/highshelf(f, dB, Q?)` | — | custom | filter | `LowShelf`, `HighShelf` | — | `bass`/`treble` | `bass`/`treble` | Bass and Treble | `designShelvingEQ` |
| Parametric EQ | `eq(f, dB, Q?)` | — | custom | — | — | — | `equalizer` | `equalizer`, `anequalizer` | Filter Curve EQ, Graphic EQ | `multibandParametricEQ`, `graphicEQ` |
| FIR / convolution | (plan) | — | `scipy.signal.fftconvolve` | — | FFT-based | `Convolution` | — | `afir`, `firequalizer` | (plugin) | `dsp.FIRFilter`, `dsp.Convolver` |
| Ladder filter | — | — | — | — | — | `LadderFilter` | — | — | — | — |
| **Spatial effects** | | | | | | | | | | |
| Reverb | (plan) | — | — | — | — | `Reverb`, `Convolution` | `reverb` | `afir` | Reverb | `reverberator` |
| Echo / delay | (plan) | — | — | — | — | `Delay` | `echo`, `echos`, `delay` | `aecho`, `adelay` | Echo, Delay | examples |
| Chorus | (plan) | — | — | — | — | `Chorus` | `chorus` | `chorus` | (VST) | examples |
| Flanger | (plan) | — | — | — | — | — | `flanger` | `flanger` | — | — |
| Phaser | (plan) | — | — | — | — | `Phaser` | `phaser` | `aphaser` | Phaser | — |
| Tremolo | (plan) | — | — | — | — | — | `tremolo` | `tremolo` | Tremolo | — |
| Vibrato | (plan) | — | — | — | — | — | (via `bend`) | `vibrato` | — | — |
| Stereo widen / image | `vocals`, `crossfeed` | — | — | — | — | — | `oops`, `earwax` | `stereotools`, `stereowiden`, `crossfeed`, `bs2b` | (plugin) | `crossoverFilter` |
| HRTF / binaural | (plan) | — | — | — | — | — | — | `sofalizer`, `headphone` | (plugin) | `interpolateHRTF` |
| **Restoration** | | | | | | | | | | |
| Denoise | (plan) | — | — | — | — | — | `noisered`, `noiseprof` | `afftdn`, `arnndn`, `anlmdn` | Noise Reduction | `wdenoise` |
| Declick | (plan) | — | — | — | `ClickDetector` | — | — | `adeclick` | Click Removal | manual |
| Declip | (plan) | — | — | — | — | — | — | `adeclip` | Clip Fix | manual |
| Dither | `dither(bits?)` | — | — | — | — | — | `dither` | (sample fmt) | (project export) | `dither` |
| **Analysis (volume)** | | | | | | | | | | |
| Peak (dB) | `stat('db')` | `seg.max_dBFS` | `np.max(np.abs)` | `aubioquiet` | `MaxMagnitude` | — | `stat` | `astats`, `volumedetect` | Plot Spectrum | `max(abs)` |
| RMS | `stat('rms')` | `seg.rms`, `dBFS` | `feature.rms` | `aubioquiet` | `RMS`, `Energy` | — | `stat` | `astats` | Measure RMS | `rms` |
| LUFS loudness | `stat('loudness')` | — | custom | — | `LoudnessEBUR128`, `Loudness` | — | — | `ebur128`, `loudnorm` | Loudness Normalization | `integratedLoudness`, `loudnessMeter` |
| Clipping | `stat('clipping')` | — | manual | — | `ClickDetector` | — | `stat` | `astats` | Find Clipping | manual |
| DC offset | `stat('dc')` | — | `np.mean` | — | `DCRemoval` (measure) | — | `stat` | `astats` | DC stat | `mean` |
| Silence | `stat('silence')` | `split_on_silence`, `detect_silence` | `effects.split` | `aubioquiet` | `SilenceRate`, `StartStopSilence` | — | `silence` | `silencedetect`, `silenceremove` | Truncate Silence, Label Sounds | `voiceActivityDetector` |
| **Analysis (spectral)** | | | | | | | | | | |
| FFT spectrum | `stat('spectrum')` | — | `librosa.stft` | `pvoc`, `fft` | `FFT`, `Spectrum` | — | `spectrogram` | `showspectrum` | Plot Spectrum | `fft`, `stft`, `pspectrum` |
| MFCC | `stat('cepstrum')` | — | `feature.mfcc` | `aubiomfcc`, `mfcc` | `MFCC`, `BFCC`, `GFCC` | — | — | — | (plugin) | `mfcc` |
| Mel spectrogram | (in `cepstrum`) | — | `feature.melspectrogram` | `filterbank` | `MelBands`, `BarkBands`, `ERBBands` | — | — | — | — | `melSpectrogram` |
| Chromagram | (plan) | — | `feature.chroma_stft/cqt/cens` | — | `HPCP`, `Chromagram` | — | — | — | — | manual |
| Tonnetz | (plan) | — | `feature.tonnetz` | — | `Tonnetz`, `TonalExtractor` | — | — | — | — | — |
| Spectral centroid/bw/flatness/rolloff | (plan) | — | `feature.spectral_*` | `specdesc` | `Centroid`, `SpectralCentroidTime`, `Flatness`, `RollOff` | — | — | `aspectralstats` | — | `spectralCentroid`, `spectralFlatness`, `spectralRolloff` |
| Zero-crossing rate | (plan) | — | `feature.zero_crossing_rate` | `zero_crossing_rate` | `ZeroCrossingRate` | — | — | — | — | `zerocrossrate` |
| **Analysis (rhythm/melody)** | | | | | | | | | | |
| Tempo / BPM | `stat('bpm')` | — | `beat.tempo`, `beat.beat_track` | `aubiotempo` | `RhythmExtractor`, `PercivalBpmEstimator` | — | — | — | Beat Finder | `tempo` |
| Beat tracking | `stat('beats')` | — | `beat.beat_track` | `aubiotrack` | `BeatTrackerMultiFeature`, `BeatsLoudness` | — | — | — | Beat Finder | `beat` |
| Onset detection | `stat('onsets')` | — | `onset.onset_detect` | `aubioonset`, `onset` | `OnsetDetection`, `Onsets` | — | — | — | Sound Finder | `detectSpeech` (vad) |
| Pitch (notes, F0) | `stat('notes')` | — | `pyin`, `piptrack` | `aubiopitch`, `aubionotes` | `PitchYin`, `PitchYinFFT`, `PredominantPitchMelodia` | — | — | — | (plugin) | `pitch` |
| Chord recognition | `stat('chords')` | — | (3rd-party) | — | `ChordsDetection`, `ChordsDetectionBeats` | — | — | — | — | — |
| Key detection | `stat('key')` | — | (3rd-party) | — | `KeyExtractor`, `Key` | — | — | — | — | — |
| Downbeat | (plan) | — | (madmom) | — | `BeatTrackerMultiFeature` | — | — | — | — | — |
| Stem separation | (plan) | — | `effects.hpss` | — | `HarmonicMask`, HPSS | — | — | — | (OpenVINO plugin) | `separateSpeakers` |
| **Playback / record** | | | | | | | | | | |
| Playback | `a.play({at, duration, rate, loop})` | `play(seg)` (simpleaudio) | — | — | — | — | `play` (utility) | `ffplay` (separate) | GUI transport | `audioplayer`, `sound` |
| Pause / seek | `a.pause()`, `a.seek(t)` | — | — | — | — | — | — | — | GUI | `pause`, `resume` |
| Volume / loop / rate | `a.volume`, `a.loop`, `a.playbackRate` | — | — | — | — | — | — | — | GUI | limited |
| Recording (mic) | `a.record({deviceId, sampleRate, channels})` | pyaudio | — | source from mic | streaming source | — | (`rec`) | (avfoundation/dshow) | GUI Record | `audioDeviceReader`, `audiorecorder` |
| Events | `'data'`, `'timeupdate'`, `'play'`, `'ended'`, `'progress'`, ... | — | — | — | — | — | — | — | GUI | listeners on System objects |
| Streaming meter | `a.meter({type, smoothing, hold})` | — | — | per-frame source | streaming network outputs | — | — | — | GUI meters | `dsp.SpectrumAnalyzer`, `timescope` |
| **Synthesis** | | | | | | | | | | |
| Generators | `audio.from(fn, {duration})` | tone generator | manual | — | — | — | `synth` | `aevalsrc`, `sine`, `anoisesrc` | Tone, Noise, Chirp, DTMF, Pluck, Risset Drum, Rhythm Track | `audioOscillator`, `dsp.SineWave` |
| Synth voices | — | — | — | — | — | — | — | — | — | — |
| Envelopes (ADSR) | (gain automation) | — | — | — | — | — | — | — | Envelope tool | examples |
| LFO | (function-arg automation) | — | — | — | — | — | — | — | — | `audioOscillator` |
| Transport / scheduling | — | — | — | — | — | — | — | — | — | — |
| MIDI | — | — | — | — | — | — | — | — | MIDI import | `midiread`, `midiwrite` |
| **Plugin hosting** | | | | | | | | | | |
| VST3 / AU | — | — | — | — | — | VST3, AU | — | LADSPA, LV2 | VST/AU/LV2/Nyquist | `validateAudioPlugin` (export) |
| Custom processors | `audio.op(name, descriptor)` | Python function | Python function | C/Python plugin | C++ algorithm | Python `Plugin` subclass | — | C filter | Nyquist | System object subclass |
| Macros / batch | CLI macro | scripts | scripts | shell + scripts | scripts + extractor profiles | Python scripts | shell scripts | filter graph | Audacity Macros | scripts / Live Editor |
| **Misc** | | | | | | | | | | |
| Performance (stub) | TBD | TBD | TBD | TBD (native fast) | TBD (native fast) | TBD | TBD (native fast) | TBD (native fast) | n/a | TBD |
| Bundle size | ~20 KiB gz core | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Last release | active | active | active | active | active | active | 2015 | active | active | active |
| Integrations | Wavearea, audiojs ecosystem | FFmpeg | scikit-learn, torchaudio, numpy | PureData, MaxMSP, Python, JS | TensorFlow, Gaia, essentia.js | TensorFlow, PyTorch, JUCE plugins | shell, FFmpeg | LADSPA/LV2, ffmpeg.wasm | VST/AU/LV2 plugins | Simulink, Deep Learning Toolbox |

---

## Adjacent (different paradigm)

These are not direct competitors — they solve a different problem — but often appear in the same conversations.

| Tool | Scope | Why different | Link |
|---|---|---|---|
| **Tone.js** | live synth + transport + scheduling on Web Audio | aimed at music *creation* (synth voices, sequencer, MIDI), not file processing | <https://tonejs.github.io> |
| **Wavesurfer.js** | waveform UI + player + region/spectrogram plugins | a *visualization component*, not a processing library | <https://wavesurfer.xyz> |
| **audiotool / probe** | André Michelle's browser DAW + analyzer | full DAW UI, not a library | <https://probe.audiotool.com> |
| **Web Audio API** | browser native real-time audio graph | substrate everything in the browser builds on | <https://developer.mozilla.org/Web/API/Web_Audio_API> |
| **WebCodecs API** | low-level browser encode/decode | format codec primitives, no editing or analysis | <https://developer.mozilla.org/Web/API/WebCodecs_API> |
| **JUCE** | C++ framework for plugins / native apps | industry standard for VST/AU/AAX authoring | <https://juce.com> |
| **Faust** | DSP-specific functional language → C++/JS/WASM | language for *writing* DSP, not using it | <https://faust.grame.fr> |
| **Csound, SuperCollider, Pure Data, Max/MSP** | music synthesis languages/environments | composition + live performance | — |

---

## Other notable tools

Compact one-liners for tools not in the matrix.

### Web / JavaScript

| Tool | Scope | Link |
|---|---|---|
| HTML5 `<audio>` | element-level playback; universal | <https://developer.mozilla.org/Web/HTML/Element/audio> |
| Howler.js | playback only: load, play, fade, sprite | <https://howlerjs.com> |
| Pizzicato.js | Web Audio effects wrapper (Distortion, Delay, Reverb, Compressor) | <https://alemangui.github.io/pizzicato/> |
| Tuna.js | Web Audio effects (Chorus, Filter, Compressor, Convolver, Phaser, Overdrive) | <https://github.com/Theodeus/tuna> |
| Meyda | Web Audio feature extraction (MFCC, chroma, centroid, RMS, ZCR) | <https://meyda.io> |
| Essentia.js | WASM port of Essentia; full MIR (key, BPM, danceability) | <https://mtg.github.io/essentia.js> |
| Wavearea | DOM-native editable waveform component | <https://github.com/dy/wavearea> |
| Magenta.js | TensorFlow.js music ML (generation, transcription) | <https://magenta.tensorflow.org/js> |
| audiojs ecosystem | `audio-decode`, `encode-audio`, `audio-speaker`, `audio-mic`, `audio-filter`, `pcm-convert`, `pitch-detection` | <https://github.com/audiojs> |

### Python

| Tool | Scope | Link |
|---|---|---|
| soundfile | libsndfile binding for I/O | <https://github.com/bastibe/python-soundfile> |
| scipy.signal | DSP primitives (filter design, convolution, resample) | <https://docs.scipy.org/doc/scipy/reference/signal.html> |
| madmom | MIR specialized for music (beats, downbeats, chords, key) | <https://github.com/CPJKU/madmom> |
| torchaudio | PyTorch audio I/O + transforms + datasets | <https://pytorch.org/audio> |
| noisereduce | spectral gating noise reduction | <https://github.com/timsainb/noisereduce> |
| demucs / spleeter | source separation (stems) | <https://github.com/facebookresearch/demucs> |

### CLI / native

| Tool | Scope | Link |
|---|---|---|
| ecasound | Linux multitrack CLI, chain-based effects | <https://ecasound.seul.org> |
| mhwaveedit | minimalist GTK editor | — |
| Rubber Band | time-stretch + pitch-shift library + CLI | <https://breakfastquay.com/rubberband> |

### Desktop DAWs

| Tool | Scope | Link |
|---|---|---|
| Reaper | affordable cross-platform DAW; deep scripting (Lua, Python, EEL) | <https://reaper.fm> |
| Adobe Audition | pro audio editor; spectral repair, multitrack | <https://adobe.com/products/audition> |
| Logic Pro | Apple DAW; pro mixing/mastering | <https://apple.com/logic-pro> |
| Pro Tools | industry standard for audio post; HDX integration | <https://avid.com/pro-tools> |
| Ardour | open-source DAW | <https://ardour.org> |
| Ocenaudio | free cross-platform editor; leaner than Audacity | <https://ocenaudio.com> |
| WaveLab | Steinberg mastering suite | — |
| iZotope RX | gold-standard audio repair (declick, denoise, declip, dialogue isolate) | <https://izotope.com/en/products/rx.html> |

### Scientific / industrial

| Tool | Scope | Link |
|---|---|---|
| GNU Octave + signal package | open-source MATLAB-alike | <https://octave.sourceforge.io/signal/> |
| R `tuneR`, `seewave` | R packages for audio + bioacoustics | <https://cran.r-project.org/package=tuneR> |

---

## Performance

> **Stub.** Numbers TBD. See [todo.md](../.work/todo.md).

Method: 10-minute 44.1kHz stereo WAV input, single op, wall-clock on M-series Mac, warm cache.

| Operation                       | `audio` (Node) | pydub | librosa | aubio | essentia | Pedalboard | SoX | FFmpeg | MATLAB |
|---------------------------------|----------------|-------|---------|-------|----------|------------|-----|--------|--------|
| WAV decode                      | TBD            | TBD   | TBD     | TBD   | TBD      | TBD        | TBD | TBD    | TBD    |
| MP3 decode                      | TBD            | TBD   | TBD     | TBD   | TBD      | TBD        | TBD | TBD    | TBD    |
| Peak normalize                  | TBD            | TBD   | TBD     | —     | TBD      | —          | TBD | TBD    | TBD    |
| LUFS measurement                | TBD            | —     | —       | —     | TBD      | —          | —   | TBD    | TBD    |
| Resample 44.1k→48k              | TBD            | TBD   | TBD     | —     | TBD      | TBD        | TBD | TBD    | TBD    |
| Time stretch 0.8×               | TBD            | —     | TBD     | —     | —        | —          | TBD | TBD    | TBD    |
| Pitch shift +2 semitones        | TBD            | —     | TBD     | —     | —        | TBD        | TBD | TBD    | TBD    |
| FFT spectrum (1024-pt)          | TBD            | —     | TBD     | TBD   | TBD      | —          | —   | —      | TBD    |
| MFCC (20 coeffs)                | TBD            | —     | TBD     | TBD   | TBD      | —          | —   | —      | TBD    |
| Beat tracking                   | TBD            | —     | TBD     | TBD   | TBD      | —          | —   | —      | TBD    |

`audio` does not aim to beat native FFmpeg/SoX on raw throughput. It trades ergonomics + portability + non-destructive editing for a small constant-factor cost. Where it competes:

- **Time-to-first-sample** — `audio` plays during decode; native CLIs render then play
- **Bundle size** — `audio` core ~20 KiB gz vs ffmpeg.wasm ~25 MiB
- **Cold-start in browser** — no install, no native binary, no subprocess
