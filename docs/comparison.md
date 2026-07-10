# Comparison & Alternatives

A landscape of audio tools across the web, Python, CLI, and desktop. The goal: help you pick the right tool for the job — including, often, *not* `audio`.

`audio` occupies a specific niche: **a non-destructive audio workstation library for JavaScript runtimes (Node, Deno, Bun, browsers)**. Decode, edit, analyze, encode, play, record — chainable API + CLI, no native binaries, ~20 KiB gzipped core.

`audio` is part of the [audiojs](https://github.com/audiojs) ecosystem — a constellation of small focused packages (`@audio/decode`, `@audio/encode`, `@audio/speaker`, `@audio/mic`, `@audio/filter`, `@audio/dynamics`, `@audio/denoise`, `wavearea`, ...) that together cover most JS audio needs. `audio` itself composes many of them into a unified workstation.


## Comparison matrix

Cells contain method/op names where supported, `—` if absent. For `audio`, plain names are built-ins; the rest are `@audio/*` registry atoms (`npm i` the package, then `audio.use('name')` — same chainable API). Comma-separated lists are not exhaustive.

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
| Band split (crossover) | `crossover(...freqs)` | — | manual | — | — | `MultibandSplit` | — | `acrossover` | — | `crossoverFilter` |
| **Volume / dynamics** | | | | | | | | | | |
| Gain (dB) | `gain(dB \| t=>dB)` | `seg + dB` | `y * gain` | — | `Multiplier` | `Gain(db)` | `gain`, `vol` | `volume` | Amplify | scalar multiply |
| Fade in/out | `fade(in, out?, curve?)` | `fade_in/fade_out` | manual | — | — | — | `fade` | `afade` | Fade In/Out, Adjustable Fade | `fade` |
| Peak normalize | `normalize()` | `effects.normalize` | `util.normalize` | — | `Normalize` | — | `norm` | `volume=normalize` | Normalize | manual |
| LUFS normalize | `normalize('podcast')` | — | custom | — | `LoudnessEBUR128` (measure) | — | — | `loudnorm` | Loudness Normalization | `integratedLoudness` |
| DC removal | `normalize({dc:true})` | — | custom | — | `DCRemoval` | — | `dcshift` | `dcshift` | DC | highpass at low f |
| Compressor | `compressor()`, `compand()`, `leveler()` | `compress_dynamic_range()` | custom | — | — | `Compressor(thr, ratio)` | `compand` | `acompressor` | Compressor | `compressor` |
| Limiter | `limiter()` | — | — | — | — | `Limiter` | (`compand` ∞) | `alimiter` | Limiter | `limiter` |
| Gate | `gate()` | — | — | — | — | — | `compand` neg | `agate` | Noise Gate | `noisegate` |
| Distortion / clip | `softclip()`, `distortion()`, `waveshaper()` | — | — | — | — | `Distortion`, `Clipping` | `overdrive` | `asoftclip` | Distortion | custom |
| Bit crush | `bitcrusher()`, `lofi()` | — | — | — | — | `Bitcrush` | — | `acrusher` | (plugin) | custom |
| **Filters** | | | | | | | | | | |
| Highpass | `highpass(f)` | `high_pass_filter()` | `scipy.signal.butter` | `digital_filter` | `HighPass` | `HighpassFilter` | `highpass` | `highpass` | High-Pass Filter | `designfilt`, `highpass` |
| Lowpass | `lowpass(f)` | `low_pass_filter()` | `scipy.signal.butter` | filter | `LowPass` | `LowpassFilter` | `lowpass` | `lowpass` | Low-Pass Filter | `lowpass` |
| Bandpass | `bandpass(f, Q?)` | `band_pass_filter()` | `butter` | filter | `BandPass` | — | `bandpass` | `bandpass` | (Filter Curve) | `bandpass` |
| Notch | `notch(f, Q?)` | — | custom | filter | `BandReject` | — | `band -n` | `bandreject` | Notch Filter | `bandstop` |
| Allpass | `allpass(f, Q?)` | — | custom | filter | `AllPass` | — | `allpass` | `allpass` | — | `designfilt` |
| Low/high shelf | `lowshelf/highshelf(f, dB, Q?)` | — | custom | filter | `LowShelf`, `HighShelf` | — | `bass`/`treble` | `bass`/`treble` | Bass and Treble | `designShelvingEQ` |
| Parametric EQ | `eq(f, dB, Q?)` | — | custom | — | — | — | `equalizer` | `equalizer`, `anequalizer` | Filter Curve EQ, Graphic EQ | `multibandParametricEQ`, `graphicEQ` |
| FIR / convolution | `@audio/eq-fir`, `@audio/reverb-convolution` (import) | — | `scipy.signal.fftconvolve` | — | FFT-based | `Convolution` | — | `afir`, `firequalizer` | (plugin) | `dsp.FIRFilter`, `dsp.Convolver` |
| Ladder filter | `moog()`, `diode()`, `korg35()`, `oberheim()` | — | — | — | — | `LadderFilter` | — | — | — | — |
| Derivative / integral | `derivative()`, `integral()` | — | `np.diff` / `np.cumsum` | — | `Derivative` | — | — | `aderivative`, `aintegral` | — | `diff`, `cumsum` |
| **Spatial effects** | | | | | | | | | | |
| Reverb | `freeverb()`, `plate()`, `fdn()`, `spring()`, `shimmer()` | — | — | — | — | `Reverb`, `Convolution` | `reverb` | `afir` | Reverb | `reverberator` |
| Echo / delay | `delay()`, `multitap()`, `pingpong()` | — | — | — | — | `Delay` | `echo`, `echos`, `delay` | `aecho`, `adelay` | Echo, Delay | examples |
| Chorus | `chorus()` | — | — | — | — | `Chorus` | `chorus` | `chorus` | (VST) | examples |
| Flanger | `flanger()` | — | — | — | — | — | `flanger` | `flanger` | — | — |
| Phaser | `phaser()` | — | — | — | — | `Phaser` | `phaser` | `aphaser` | Phaser | — |
| Tremolo | `tremolo()` | — | — | — | — | — | `tremolo` | `tremolo` | Tremolo | — |
| Vibrato | `vibrato()` | — | — | — | — | — | (via `bend`) | `vibrato` | — | — |
| Stereo widen / image | `widener()`, `haas()`, `midside()`, `surround()`, `crossfeed()` | — | — | — | — | — | `oops`, `earwax` | `stereotools`, `stereowiden`, `crossfeed`, `bs2b` | (plugin) | `crossoverFilter` |
| HRTF / binaural | — | — | — | — | — | — | — | `sofalizer`, `headphone` | (plugin) | `interpolateHRTF` |
| **Restoration** | | | | | | | | | | |
| Denoise | `specsub()`, `wiener()`, `omlsa()`, `dehum()`, `dereverb()` | — | — | — | — | — | `noisered`, `noiseprof` | `afftdn`, `arnndn`, `anlmdn` | Noise Reduction | `wdenoise` |
| Declick | `declick()`, `decrackle()` | — | — | — | `ClickDetector` | — | — | `adeclick` | Click Removal | manual |
| Declip | `declip()` | — | — | — | — | — | — | `adeclip` | Clip Fix | manual |
| Dither | `dither(bits?)` | — | — | — | — | — | `dither` | (sample fmt) | (project export) | `dither` |
| **Analysis (volume)** | | | | | | | | | | |
| Peak (dB) | `stat('db')` | `seg.max_dBFS` | `np.max(np.abs)` | `aubioquiet` | `MaxMagnitude` | — | `stat` | `astats`, `volumedetect` | Plot Spectrum | `max(abs)` |
| RMS | `stat('rms')` | `seg.rms`, `dBFS` | `feature.rms` | `aubioquiet` | `RMS`, `Energy` | — | `stat` | `astats` | Measure RMS | `rms` |
| LUFS loudness | `stat('loudness')` | — | custom | — | `LoudnessEBUR128`, `Loudness` | — | — | `ebur128`, `loudnorm` | Loudness Normalization | `integratedLoudness`, `loudnessMeter` |
| Clipping | `stat('clipping')` | — | manual | — | `ClickDetector` | — | `stat` | `astats` | Find Clipping | manual |
| DC offset | `stat('dc')` | — | `np.mean` | — | `DCRemoval` (measure) | — | `stat` | `astats` | DC stat | `mean` |
| Silence | `stat('silence')`, `stat('sounds')`, `shrink()` | `split_on_silence`, `detect_silence` | `effects.split` | `aubioquiet` | `SilenceRate`, `StartStopSilence` | — | `silence` | `silencedetect`, `silenceremove` | Truncate Silence, Label Sounds | `voiceActivityDetector` |
| Speech contrast (WCAG) | `stat('speech-contrast')` | — | — | — | — | — | — | — | Contrast | — |
| **Analysis (spectral)** | | | | | | | | | | |
| FFT spectrum | `stat('spectrum')` | — | `librosa.stft` | `pvoc`, `fft` | `FFT`, `Spectrum` | — | `spectrogram` | `showspectrum` | Plot Spectrum | `fft`, `stft`, `pspectrum` |
| MFCC | `stat('cepstrum')` | — | `feature.mfcc` | `aubiomfcc`, `mfcc` | `MFCC`, `BFCC`, `GFCC` | — | — | — | (plugin) | `mfcc` |
| Mel spectrogram | (in `cepstrum`) | — | `feature.melspectrogram` | `filterbank` | `MelBands`, `BarkBands`, `ERBBands` | — | — | — | — | `melSpectrogram` |
| Chromagram | `stat('chroma')` | — | `feature.chroma_stft/cqt/cens` | — | `HPCP`, `Chromagram` | — | — | — | — | manual |
| Tonnetz | `stat('tonnetz')` | — | `feature.tonnetz` | — | `Tonnetz`, `TonalExtractor` | — | — | — | — | — |
| Spectral centroid/bw/flatness/rolloff | `stat('centroid'/'spread'/'flatness'/'rolloff')` | — | `feature.spectral_*` | `specdesc` | `Centroid`, `SpectralCentroidTime`, `Flatness`, `RollOff` | — | — | `aspectralstats` | — | `spectralCentroid`, `spectralFlatness`, `spectralRolloff` |
| Zero-crossing rate | `stat('zcr')` | — | `feature.zero_crossing_rate` | `zero_crossing_rate` | `ZeroCrossingRate` | — | — | — | — | `zerocrossrate` |
| **Analysis (rhythm/melody)** | | | | | | | | | | |
| Tempo / BPM | `stat('bpm')` | — | `beat.tempo`, `beat.beat_track` | `aubiotempo` | `RhythmExtractor`, `PercivalBpmEstimator` | — | — | — | Beat Finder | `tempo` |
| Beat tracking | `stat('beats')` | — | `beat.beat_track` | `aubiotrack` | `BeatTrackerMultiFeature`, `BeatsLoudness` | — | — | — | Beat Finder | `beat` |
| Onset detection | `stat('onsets')` | — | `onset.onset_detect` | `aubioonset`, `onset` | `OnsetDetection`, `Onsets` | — | — | — | Sound Finder | `detectSpeech` (vad) |
| Pitch (notes, F0) | `stat('notes')` | — | `pyin`, `piptrack` | `aubiopitch`, `aubionotes` | `PitchYin`, `PitchYinFFT`, `PredominantPitchMelodia` | — | — | — | (plugin) | `pitch` |
| Chord recognition | `stat('chords')` | — | (3rd-party) | — | `ChordsDetection`, `ChordsDetectionBeats` | — | — | — | — | — |
| Key detection | `stat('key')` | — | (3rd-party) | — | `KeyExtractor`, `Key` | — | — | — | — | — |
| Downbeat | `stat('downbeat')` | — | (madmom) | — | `BeatTrackerMultiFeature` | — | — | — | — | — |
| Stem separation | `@audio/neural-separate` (import) | — | `effects.hpss` | — | `HarmonicMask`, HPSS | — | — | — | (OpenVINO plugin) | `separateSpeakers` |
| **Playback / record** | | | | | | | | | | |
| Playback | `a.play({at, duration, rate, loop})` | `play(seg)` (simpleaudio) | — | — | — | — | `play` (utility) | `ffplay` (separate) | GUI transport | `audioplayer`, `sound` |
| Pause / seek | `a.pause()`, `a.seek(t)` | — | — | — | — | — | — | — | GUI | `pause`, `resume` |
| Volume / loop / rate | `a.volume`, `a.loop`, `a.playbackRate` | — | — | — | — | — | — | — | GUI | limited |
| Recording (mic) | `a.record({deviceId, sampleRate, channels})` | pyaudio | — | source from mic | streaming source | — | (`rec`) | (avfoundation/dshow) | GUI Record | `audioDeviceReader`, `audiorecorder` |
| Events | `'data'`, `'timeupdate'`, `'play'`, `'ended'`, `'progress'`, ... | — | — | — | — | — | — | — | GUI | listeners on System objects |
| Streaming meter | `a.meter({type, smoothing, hold})` | — | — | per-frame source | streaming network outputs | — | — | — | GUI meters | `dsp.SpectrumAnalyzer`, `timescope` |
| **Synthesis** | | | | | | | | | | |
| Generators | `audio.from(fn, {duration})` | tone generator | manual | — | — | — | `synth` | `aevalsrc`, `sine`, `anoisesrc` | Tone, Noise, Chirp, DTMF, Pluck, Risset Drum, Rhythm Track | `audioOscillator`, `dsp.SineWave` |
| Synth voices | `voice()`, `poly()` (note events) | — | — | — | — | — | — | — | — | — |
| Envelopes (ADSR) | `adsr()`, gain automation | — | — | — | — | — | — | — | Envelope tool | examples |
| LFO | function-arg automation, `tremolo()`, `autopan()` | — | — | — | — | — | — | — | — | `audioOscillator` |
| Transport / scheduling | — | — | — | — | — | — | — | — | — | — |
| MIDI | note events (`voice`/`poly`), `@audio/tune-midi` (import) | — | — | — | — | — | — | — | MIDI import | `midiread`, `midiwrite` |
| **Plugin hosting** | | | | | | | | | | |
| VST3 / AU | — | — | — | — | — | VST3, AU | — | LADSPA, LV2 | VST/AU/LV2/Nyquist | `validateAudioPlugin` (export) |
| Custom processors | `audio.op(name, descriptor)` | Python function | Python function | C/Python plugin | C++ algorithm | Python `Plugin` subclass | — | C filter | Nyquist | System object subclass |
| Macros / batch | CLI macro | scripts | scripts | shell + scripts | scripts + extractor profiles | Python scripts | shell scripts | filter graph | Audacity Macros | scripts / Live Editor |
| **Misc** | | | | | | | | | | |
| Performance | measured — [§ Performance](#performance) | slow (shells out to ffmpeg) | numpy-fast | native | native | native | native | native | n/a | native |
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
| audiojs ecosystem | `@audio/decode`, `@audio/encode`, `@audio/speaker`, `@audio/mic`, `@audio/filter`, `@audio/stretch`, `@audio/mir` | <https://github.com/audiojs> |

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

Measured 2026-07: 10-minute 44.1 kHz stereo fixture (105 MB WAV / 192 kbps MP3, mixed tones + shaped noise + 120 BPM pulse), one op per cell, **end-to-end from the input file** — decode for decode rows, decode + analyze for analysis rows, decode + op + encode-to-file for transform rows. Best of 3 warm runs. CLI tools (`audio`, SoX, FFmpeg) run as a fresh subprocess per rep, so their cells include process startup and full decode (~100 ms of every `audio` cell is Node boot + import). librosa/Pedalboard are libraries and run in-process — their cells *exclude* interpreter startup, which flatters them slightly. Apple M4 Max, macOS 26.5, Node 25.9, FFmpeg 8.0.1, SoX 14.4.2, librosa 0.11, Pedalboard 0.9.24. Reproduce: `npm run bench` ([bench/bench.js](../bench/bench.js)).

| Operation | `audio` (Node) | librosa | Pedalboard | SoX | FFmpeg |
|---|---|---|---|---|---|
| WAV decode | 967 ms | 84 ms | 35 ms | 51 ms | 73 ms |
| MP3 decode | 1.57 s | 274 ms | 432 ms | — | 487 ms |
| Peak normalize | 1.89 s | — | — | 462 ms | — |
| LUFS measurement | 973 ms | — | — | — | 337 ms |
| Resample 44.1k→48k | 2.00 s | 581 ms | 6.24 s | 1.02 s | 270 ms |
| Time stretch 0.8× | 8.74 s | 6.98 s | — | 5.54 s | 640 ms |
| Pitch shift +2 st | 15.2 s | 6.62 s | 9.29 s | 5.74 s | 794 ms |
| FFT spectrum (1024-pt) | 1.22 s | 452 ms | — | — | — |
| MFCC (13 coeff) | 1.29 s | 610 ms | — | — | — |
| Beat tracking | 1.11 s | 1.16 s | — | — | — |

Reading the numbers honestly:

- **Analysis is `audio`'s strong lane.** Stats ride the decode pass (the always-resident index), so LUFS/FFT/MFCC/beat cells are ≈ decode cost + 0–0.3 s. Beat tracking matches librosa wall-to-wall — *including* Node startup that librosa's cell doesn't pay. Ten stats on one file cost one decode, not ten passes.
- **Decode is ~10–15× native.** Pure-JS codecs. The gap is real; it buys zero native dependencies on every platform.
- **Stretch/pitch is ~1.5–2.6× SoX/librosa** — a pure-JS phase vocoder at ~40–70× realtime. Within reach of the native tools, an order of magnitude behind FFmpeg's `asetrate`+`aresample` (which is the cheap resample trick, not a duration-preserving vocoder like the others — not like-for-like). Earlier drafts of this table read ~15× slower here; that was a streaming-encode defect (per-block `await` kept V8 from tiering up the FFT), fixed 2026-07 — see the note below.
- **Resample beats Pedalboard, trails the rest.** `normalize` includes writing 105 MB of output; the LUFS row shows the measure-only cost.

> **Why the CLI transform numbers moved 6–9×.** Until 2026-07, `save`/`encode` drove the DSP through a per-1024-sample-block async loop, which prevented V8 from tiering up the FFT-heavy ops for the whole file (baseline JIT, ~10× slower on a one-shot process). The fix renders the plan through the synchronous generator in large synchronous bursts, crossing an `await` only for I/O between bursts — bit-identical output, JIT-friendly. `read()` was always on the fast path. The remaining gap to native is a genuine constant factor, addressable via the atom contract's WASM lane (jz) for the streaming/realtime case that can't batch.

`audio` does not aim to beat native FFmpeg/SoX on raw throughput. It trades ergonomics + portability + non-destructive editing for a constant-factor cost. Where it competes structurally:

- **Time-to-first-sample** — `audio` plays during decode; native CLIs render then play
- **Amortized analysis** — the index makes the 2nd..Nth stat/waveform query ~free; CLI tools re-decode per query
- **Bundle size** — `audio` core ~20 KiB gz vs ffmpeg.wasm ~25 MiB
- **Cold-start in browser** — no install, no native binary, no subprocess
