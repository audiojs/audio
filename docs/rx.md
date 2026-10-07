# iZotope RX 12, measured

`audio`'s repair ops against iZotope RX 12 Advanced, plugin by plugin, on the same buffers, October 2026.

## How

- **RX:** its VST3 plugins hosted by Pedalboard 0.9 ([bench/rx/host.py](../bench/rx/host.py)), a new instance per job: what a plugin learned survives its reset (reused after a learning run, De-hum's output differed from a new instance's by −27 dB, Spectral De-noise's by −26). Every plugin's output lines up with its input at 0 samples, at 16, 44.1 and 48 kHz. Learn buttons that are no plugin parameter were driven through the plugin's state where it allows it (Spectral De-noise, De-reverb), and said so where it doesn't.
- **Ours:** the op as `audio` runs it, at its defaults.
- **Fairness:** every setting, RX's and ours, chosen on a tuning split; every number below on a test split nothing was tuned on. RX at its defaults and at its best setting on the tuning split (a grid over its main knobs).
- **Measures:** what each module removes, and what it does to sound with nothing to remove (harm). Cited in each bench: PESQ (ITU-T P.862.2), STOI (Taal 2011), SI-SDR (Le Roux 2019), DNSMOS P.835 (Reddy 2022), BSSEval v4 SDR (SiSEC 2018), PEAQ ODG (ITU-R BS.1387, Kabal's implementation).
- **Rerun:** `node bench/rx/<module>.mjs` (its header says how); renders and scores cache in `~/.cache/audiojs/data/rx/`.

## Plugins

| RX 12 | `audio` | Ours | RX 12 | RX leads where |
|---|---|---|---|---|
| De-click | `declick()` | ticks on speech at 5×: 31.4 dB of the click's error gone | 14.8 (tuned) | nowhere measured |
| Mouth De-click | `declick()` | mouth clicks at 2×: 18.1 dB; 83 % taken 10 dB or more | 16.7, 82 % | nowhere measured |
| De-crackle | `decrackle()` | medium crackle, 200/s on speech: 32.8 dB SDR; clean takes: 0 to 1.4 % of samples moved, error −44 dB to none | 21.0; 0.3 to 10.3 %, −36 to −67 dB (its gentlest) | harm on 2 of 6 clean takes: its gentlest leaves 2 to 3 dB less error on VoiceBank and "Vibe Ace", moving 7 and 73 times the samples |
| De-clip | `declip()` | SQAM clipped to 7 dB: ΔSDR 16.7, PEAQ −1.74; soft saturation, its curve found blind: ΔSDR 20 to 40 dB under tanh, 17 under arctan | 9.7, −2.44; 0.0 to 2.2 (tuned) | nowhere measured |
| De-hum | `dehum()` | 6 hum conditions × speech, readings, music: SDR 34.9 dB, PESQ 4.01 | 25.4, 2.80 | |
| Spectral De-noise | `denoise({ noise })` | music under steady noise: SDR 20.9 dB | 20.2 (learned, tuned) | |
| Voice De-noise | `omlsa()` | VoiceBank+DEMAND: PESQ 2.36, SI-SDR 14.2 dB | 2.37, 7.3 (default); 2.50, 3.7 (tuned) | PESQ tuned: ours 2.47 with `omlsa({ threshold: 4 })` |
| Dialogue Isolate | `deepfilter()` | VoiceBank+DEMAND: PESQ 3.05; mixtures at −5 to 5 dB, babble, music beds, rooms: mean PESQ 2.00; a room with noise: PESQ 1.81 (the model run again on the take with the room's linear prediction off) | 2.73; 1.86; 1.80 | a music bed as loud as the voice (DNSMOS OVRL 2.44 vs 2.74); a room with noise: OVRL 2.44 vs 2.51, SI-SDR 6.2 vs 7.2 dB |
| De-reverb | `dereverb()` | reverberant VoiceBank: PESQ 2.61; dry takes untouched; music recorded in a room untouched (the four pieces' worst octave 0.0 dB; sung tones and GuitarSet in rooms: +0.1 and −0.1 dB of the music) | 2.46; changes every dry take; −0.5, +0.1, −0.2 | a song whose beat 7 s does not show, in a room (3 of 25 MUSDB18 previews still processed: −0.09 dB of the music, RX +0.01) |
| De-plosive | `deplosive()` | synthetic pops on VoiceBank: 22.5 dB of the pop's error gone; voiced frames 53.4 dB untouched | 21.9; 46.8 | |
| De-ess | `deesser()` | harsh sibilants: 12.5 dB of the error gone, SNR 26.2 dB | 12.1, 25.4 | |
| Breath Control | `debreath()` | narrations: 92 % of breaths down 6 dB, 0.76 % of speech frames touched; real breaths in VoiceBank: 88 % | 88 %, 1.96 %; 73 % | the median breath's depth, −12.0 against −11.2 dB (ours never takes a breath under the room) |
| De-bleed | `debleed({ key })` | still bleed paths (click track, co-host, drums, headphones, stems): SI-SDR 7.8 to 37.1 dB, ahead in every case | 1.1 to 35.3 | a moving source at loud bleed (click track at −6 dB: 12.2 vs 18.1). RX's plugin takes no reference: it was given the mic alone |
| Music Rebalance | `rebalance()` | MUSDB18 test, median SDR: vocals 10.75, drums 10.30, bass 8.17, other 6.94; ahead song by song on every stem | 10.89, 9.85, 9.66, 6.45 (Best) | bass median (synth bass taken for "other" on 8 songs); speed (1.7× faster on long files) |
| Guitar De-noise | `desqueak()` | real squeaks in GuitarSet: a median 12.8 dB off, 86 % by 3 dB or more; picks made harsh: 8.9 dB of it off; amp hiss: 11.8 dB off, the guitar at 49.2 dB SDR; amp buzz: 13.1 dB off, the guitar at 47.3 | 13.5, 94 %; 3.3; 10.3, 47.9; 9.5, 44.5 | real squeaks (by 0.7 dB); buzz and hiss together, the guitar at 44.8 against 46.7 dB SDR. RX's amp part acts only on a learned print, so its hiss and buzz columns are Spectral De-noise learned |
| Repair Assistant | `auto()` | takes with 1 to 4 defects (noise, hum, clicks, clipping, room, sibilance, pops): speech PESQ 2.96, DNSMOS OVRL 3.12, music ODG −1.85; steady beds under speech PESQ 2.96 (a bed to DeepFilterNet3 where `@audio/neural-denoise` is installed; OM-LSA: 2.38); clean speech PESQ 4.45 (in: 4.64); loudness on target (89 % of speech, 98 % of music within 1 LU) | 2.56, 3.12, −2.23; 2.94; 3.81 | DEMAND beds under speech (PESQ 2.50 vs 2.90): the plan finds five of nine, where ours leads (2.42 vs 2.35), and reads three hallways and a river as no bed; clean music, which RX leaves and ours brings to −14 LUFS (ODG −0.22 vs 0.21). RX's analysis can't run offline: it got its modules tuned on the tuning split, and an oracle that switches them by each take's true defects |

Each package's README has its full tables: [@audio/denoise](https://github.com/audiojs/denoise), [@audio/dynamics](https://github.com/audiojs/dynamics), [@audio/neural](https://github.com/audiojs/neural).

## Modules RX keeps in its editor

These run only in the RX 12 Audio Editor, or only as AAX, so they could not be hosted and are not measured against RX. Where this round measured ours, against ground truth or published results:

| RX 12 | `audio` | Measured |
|---|---|---|
| Spectral Repair, Interpolate | `repair()`, `spectral()` | |
| Ambience Match | `roomtone()` | |
| Center Extract | `isolate()`, `vocals()` | |
| De-wind | `dewind()` | |
| Deconstruct | `deconstruct()` | the three parts add back to the input within 3e-8; a chord lands 100 % tonal, clicks 100 % transient |
| Dialogue Contour, Variable Pitch | the editor's pitch line, `pitch()` and `intonation()` with curves | |
| Spectral Recovery | `sbr()` | |
| Wow & Flutter | `dewow()` | a disc's wow at 33⅓ rpm, 1 %, on music: 12.2 → 2.1 cents; a recording without wow comes back bit for bit |
| Scene Rebalance | `scene()` | Divide and Remaster v3 test, 150 clips, median SNR: dialogue 11.8, music 5.3, effects 6.0 dB (MRX, the default); `{ model: 'tiger' }` 12.7, 10.2, 8.1 on 30 of them, 50 times slower |
| De-rustle | `derustle()` | clothing rustle as loud as the voice: PESQ 1.21 → 2.13 (RX Dialogue Isolate, which hosts: 2.06); a clean take 4.61 (Dialogue Isolate 3.96), a room alone 4.37 (2.96) |
| Azimuth | `azimuth()` | known offsets read within 0.0001 samples; a stereo image with none left bit for bit |
| Phase | `phase()` | automatic rotation lowers clean speech's peaks 0.7 to 0.8 dB on average, at most 2.9, never raises them |
| Streaming Preview | `codec()` | MP3, AAC, Opus, Vorbis back in line with the input within 0.031 samples |
| Loudness Control, Loudness Optimize | `normalize()`, `check()` | |
| Leveler | `leveler()` | |
| EQ, EQ Match | `eq()` and the filters, `match()` | |
| Time & Pitch, Variable Time | `stretch()`, `pitch()`, with curves | |
| Dither, Resample, Fade, Gain, Normalize, Mixing | `dither()`, `resample()`, `fade()`, `gain()`, `normalize()`, `remix()` and `mix()` | |
| Signal Generator | `osc()`, `noise()`, `chirp()` | |
| Trim Silence | `trim()`, `shrink()` | |
| Find Similar | `similar()` | coughs, clicks, barks and beeps planted in speech found within 7 ms, nothing else |
| Spectrum, Markers | `stat('spectrum')`, the editor's markers | |
| Plug-in | `plugin()`, through `@audio/host` (Node) | |
