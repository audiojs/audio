# Handout: from an empty GPU box to `@audio/neural-restore`

The steps, in order, to train the restorer and ship it as a plugin of the audiojs ecosystem, with the numbers
that say go or stop at each one. Why each choice was made is in [`.work/restore.md`](../../.work/restore.md);
this is the how. Everything in `train/restore/` moves into the plugin's repository as `scripts/` when the first
weights exist (the convention of `audiojs/neural`: `packages/neural-pitch/scripts/train.py`,
`packages/neural-separate/scripts/export-*.py`).

What "done" means: a `restore()` op in `audio` that takes a voice recorded in a room, in noise, on a phone or
through a codec, speech or singing, English or Russian, and gives back a 48 kHz full-band studio take; one
model under 40 MB in fp16, one pass, faster than real time on WebGPU; measured against `deepfilter()`,
`auto()` and Adobe Enhance v2 on the sets below; weights hosted under a license that allows anyone to use them.

Budget, if nothing goes wrong: a week of your attention spread over three weeks of wall time, and under $300
of rented GPU. Data preparation is most of the work; training is the cheap part.

## 1. Machine

| Choice | Fits | Notes |
|---|---|---|
| Rented RTX 4090 / A5000 / L4 (24 GB), Linux | the full model, batch 16 × 4 s, ~2.5–3.5 steps/s | RunPod, Vast, Lambda: $0.4–0.9/h. 150 GB disk for data. Keep the data on a persistent volume: the run is restartable, the downloads are the slow part |
| A100 40/80 GB | same, batch 32 | not faster per step than a 4090 for this size; buy it for batch, not speed |
| M4 Max 36 GB (MPS) | the small model (dim 384, batch 8), 5–10× slower | for debugging the recipe on real data, not the production run. `torch.stft` / `istft` on MPS have had gaps between versions: if they fail, `--device cpu` for the smoke test and the GPU for the run |
| 16 GB card | small model, batch 8 × 4 s, or full model batch 6 × 3 s | adjust `--batch` and `--seg` until it fits |

Setup on the box:

```
sudo apt install -y ffmpeg unzip                     # ffmpeg with libmp3lame, libopus, libgsm, aac: check `ffmpeg -encoders`
python3.12 -m venv .venv && . .venv/bin/activate     # 3.12: pesq builds; 3.13 runs the trainer but not pesq
pip install torch torchaudio soundfile scipy pystoi onnx onnxruntime onnxconverter-common pyloudnorm pesq
python test.py                                       # ~1 minute: the whole path on synthetic voices must print ok
```

If `test.py` prints every codec as "changed the take" and ends with `ok`, the machine is ready.

## 2. Data

Targets must be clean and, for the top octave, full band; licenses must allow hosting weights for anyone.
Sizes are the downloads; keep ~100 GB free after unpacking.

### 2.1 English speech (the bulk)

| Corpus | Get | Use |
|---|---|---|
| LibriTTS-R train-clean-100 and train-clean-360 (CC BY 4.0, 24 kHz, ~7 + 27 GB) | `openslr.org/141` | all of it; `scan` records 12 kHz bandwidth, so it trains nothing above |
| VCTK 0.92 (CC BY 4.0, 48 kHz, 11 GB) | `datashare.ed.ac.uk/handle/10283/3443` | `wav48_silence_trimmed`, mic1 only (`*_mic1.flac`): drop mic2. Its room is mild but real: see 2.5 |

Skip: DAPS, EARS (non-commercial), anything from YouTube.

### 2.2 Russian speech

Nothing studio-grade and open exists at 48 kHz. The route is 16 kHz corpora through a teacher (2.5):

| Corpus | Get | Use |
|---|---|---|
| Golos crowd (SberDevices; research and commercial use allowed, ShareAlike-like: read `license/en_us.pdf` in `github.com/sberdevices/golos`) | `openslr.org/114` | the crowd part only (far-field is a test set); teacher-cleaned and gated |
| RuLS, Russian LibriSpeech (public domain in the USA / CC BY 4.0 on mirrors, 98 h) | `openslr.org/96` | teacher-cleaned and gated |
| M-AILABS Russian | search "M-AILABS speech dataset" (the original host is gone; mirrors exist) | read its license file first; teacher-cleaned |

Not for training weights you host: RUSLAN, Natasha, Balalaika (non-commercial), Common Voice (quality), LitRes or
any audiobook you do not own the rights to.

### 2.3 Singing

| Source | Get | Use |
|---|---|---|
| VocalSet (CC BY 4.0, 44.1 kHz, 10 h, 20 singers) | `zenodo.org/records/1193957` | all; the only full-band open singing set |
| CC BY / CC0 music → vocals | Jamendo (filter by license), Free Music Archive, ccMixter | the factory: `npx audio song.mp3 --vocals isolate --model mel-roformer -o vocal.wav` (your own separator), then the teacher and the gate (2.5). Aim at 50–100 h. Keep a CSV of track, artist, license: it goes into the model card |

Not for training: GTSinger, M4Singer, OpenSinger, Opencpop, MUSDB18-HQ (non-commercial or by agreement). GTSinger's
Russian songs are a fine *test* set.

### 2.4 Rooms and noise

| Source | Get | Use |
|---|---|---|
| OpenAIR (CC BY) | `openairlib.net`, per room | every mono / omni IR into `rirs/`; B-format: take the W channel |
| BUT ReverbDB (CC BY 4.0, 1300+ IRs in 8 rooms) | `speech.fit.vutbr.cz/software/but-speech-fit-reverb-database` | all `RIR` wavs into `rirs/` |
| Your own | a balloon pop or a clap in bathrooms, stairwells, offices, cars, recorded on a phone | the rooms real users have; 50 of them are worth more than 500 concert halls |
| MUSAN noise (CC BY 4.0) | `openslr.org/17` | `musan/noise` into `noise/` |
| FSD50K (CC BY 4.0; per-clip licenses) | `zenodo.org/records/4060432` | keep clips whose license in `FSD50K.metadata/collection/*.csv` is CC0 or CC BY (85 %); drop `Speech`, `Singing`, `Music` labels (they are targets, not noise) |
| DEMAND (CC BY-SA 3.0) | `zenodo.org/records/1227121` | **test only**: VoiceBank+DEMAND's noises are from it, and the bench must not see training noise |

Without `rirs/` every room is synthetic (`degrade.synth_rir`): the model still learns dereverberation, weaker on
real tails. 30 % of rooms stay synthetic even with a bank, by design.

### 2.5 The teacher pass (Russian, separated vocals, VCTK)

Install Sidon (`github.com/sarulab-speech/Sidon`, MIT; 16 kHz in, 48 kHz out, ~500× real time on a GPU). Run it
over Golos crowd, RuLS, the separated vocals and VCTK mic1. Then gate each clip; keep it only if all hold:

| Gate | Tool | Threshold |
|---|---|---|
| quality | DNSMOS OVRL on the teacher's output (`bench/speech.py`'s `dnsmos`) | ≥ 3.3 (speech); singing: ≥ 3.0 and SIG ≥ 3.3 |
| no invented words | WER of `neural-asr` (whisper) on the output against the input's transcript (Golos and RuLS have transcripts; else against the input's own ASR) | relative increase ≤ 10 % |
| same person | cosine of `neural-diarize`'s WavLM speaker embeddings, input vs output | ≥ 0.85 |
| full band | `dsp.bandwidth` of the output | ≥ 18 kHz (else the teacher gave up on the top: drop) |

Expect to keep 30–60 % of Golos crowd, 60–80 % of RuLS and VCTK, 20–50 % of separated vocals. The student trains
on the teacher's outputs as ordinary targets (that is what LibriTTS-R is to Miipher); the teacher is not needed at
training time. Listen to 20 kept Russian clips for a "teacher accent" on с/ш/щ before trusting the set.

### 2.6 Scan and look

```
python data.py scan en.json    $DATA/libritts-r $DATA/vctk-clean --kind speech --lang en
python data.py scan ru.json    $DATA/ru-clean --kind speech --lang ru
python data.py scan sing.json  $DATA/vocalset $DATA/vocals-clean --kind sing
python data.py pairs listen 20 --clean en.json,ru.json,sing.json --rirs $DATA/rirs --noises $DATA/noise
```

Open `listen/` in the playground. Each `k-in.wav` should sound like a recording someone would actually send you:
a room, a laptop mic, a phone, a Zoom call, a cassette. If they all sound like the same kind of broken, change
the chances in `degrade.Chain.P`; if an input is unrecognizable, the SNR floor (−5 dB) or the clip range is too
hard for your use: raise them. This half hour decides more than any hyperparameter.

Check the manifests: `python -c "import json;m=json.load(open('en.json'));print(sum(i['frames']/i['sr'] for i in m)/3600,'h')"`.
Target before the full run: ≥ 300 h English, ≥ 100 h Russian, ≥ 30 h singing, of it ≥ 60 h full band in total.

## 3. Training

### 3.1 Stage A: does the recipe learn on real data? (half a day)

```
python train.py --out runs/a --clean en.json --rirs $DATA/rirs --noises $DATA/noise \
                --dim 384 --blocks 6 --attn 2,4 --batch 12 --steps 60000 --warmup 20000 --every 2000
```

Watch `runs/a/log.jsonl` and `runs/a/samples/`. Go / no-go at 60k steps, on the validation lines (`val`):

| Measure | Go | Stop and look |
|---|---|---|
| `lsd` | falls below 1.0 by 20k and keeps falling | flat above 1.3: the chain or the data is broken, not the model |
| `sisdr` | above the input's (compute the input's once: `score.py` on `listen/`), typically 8–14 dB | below the input's: the level or alignment is off (a codec lag the search missed) |
| `mel` | under 0.5 | — |
| samples at 40k+ | the room gone, consonants crisp, no buzzing in sustained vowels, the top octave present on inputs cut at 4–8 kHz | metallic ringing: `--w-adv 0.5`; muffled: the adversarial phase is not biting, check `d` hovers 0.3–0.7 and `adv` 0.2–1.0 |

A clean input must come out clean: run `infer.py` on three VCTK files and compare by ear and with `score.py` against
the originals (PESQ ≥ 4.0, LSD ≤ 0.6). If stage A passes, nothing in the recipe changes for stage B.

### 3.2 Stage B: the model (2 days of GPU)

```
python train.py --out runs/b --clean en.json,ru.json,sing.json --rirs $DATA/rirs --noises $DATA/noise \
                --batch 16 --steps 400000 --warmup 30000 --every 2000
```

Defaults are the full model (dim 512, 8 blocks, attention after 3 and 6, ~18M). Resume after any interruption with
the same command plus `--resume`. Checkpoints land every 2000 steps as `net-NNNNNNN.pt` (keep every 20th; delete
the rest). Expect: regression phase 2–3 hours, then `d` settles near 0.5, `adv` near 0.5–1.0, `fm` falling slowly
for the whole run; `lsd` under 0.8 and `sisdr` 10–16 dB by the end. If `val` numbers plateau by 250k and the
samples are good, stop there: the last 150k steps buy texture, not intelligibility.

Knobs worth touching, in order: the data mix (duplicate `sing.json` in `--clean` to weight singing ×2); `--seg 6`
if rooms over 1 s stay (longer context); `--w-fm 4` if the top octave sounds sprayed; `--ssl 0.5` if speech comes
out overly smooth. Not worth touching: learning rates, betas, the discriminator set, the STFT.

### 3.3 Stage C: the browser-size sibling (1 day)

The same command with `--dim 384 --blocks 6 --attn 2,4` (~8M, ~16 MB fp16). Measure what it loses in section 4;
ship both and let `restore({ model })` choose, the small one where there is no GPU.

### 3.4 Trouble

| Symptom | Cause | Fix |
|---|---|---|
| `nan` in the log | a silent crop (RMS gate at −45 dBFS failed on a file of zeros) or fp16 overflow | `--device cuda` uses bf16 already; find the file: `data.py pairs` with the same seed; drop it |
| GPU under 60 % busy | the loaders: codecs through ffmpeg are the slow stage | `--workers 12`, or `Chain.P['codec'] = 0.15` |
| `d` → 0, `adv` → 2+, samples buzz | the discriminators won | restart from the last good checkpoint with `--w-adv 0.5 --w-fm 4`; never raise the generator's lr |
| output 2–3 dB quieter than the input | expected on noisy input (the noise is gone); on clean input it is a bug | check `to_level` is applied in both `train.py` and `infer.py` the same way |
| Russian щ/ц come out as hiss | too little Russian in the mix, or the teacher's accent | weight `ru.json` ×2; listen to the teacher's outputs again |
| held sung notes lose level | the singing share is too small | VocalSet ×3 in `--clean`; the factory of 2.3 |
| 24 kHz-only output on everything | every target was band-limited (a scan bug) | `python -c` over the manifest: `bw` must be 24000 for VCTK and VocalSet |

## 4. Evaluation

Run before claiming anything. The sets exist in `audio`'s bench or download in minutes:

| Set | What it measures | Baseline to beat |
|---|---|---|
| VoiceBank+DEMAND test (824 files, `datashare.ed.ac.uk/handle/10283/2791`) | noise; PESQ, STOI, SI-SDR, DNSMOS | `deepfilter()` PESQ 3.05, `deepfilter(0)` 3.15, RX 12 Dialogue Isolate 2.72 (`bench/rx/isolate.mjs`). A generative model may land near 3.0 PESQ while winning DNSMOS and the listen: report both |
| vbreverb (its clean speech in MIT IR Survey rooms: `bench/speech.mjs` builds it) | rooms | `dereverb()`, `deepfilter()` + `dereverb()`; PESQ 2.52 for WPE |
| the ten narrations (`bench/speech.mjs rooms`) | real recordings, no reference: DNSMOS, ACX floor | `auto('speech')` OVRL 3.12 |
| band limits: VCTK test speakers low-passed at 4 and 8 kHz, and through Opus 12 kb/s (`degrade.bandlimit`, `degrade.codec`) | recovery; LSD, DNSMOS | the input itself (LSD 2.5–3.5 at 4 kHz); target ≤ 1.0 |
| GTSinger's Russian songs, VocalSet held-out singers, with rooms and noise added | singing | the input; DNSMOS SIG must not fall on clean singing |
| 20 real takes of your own (phone, laptop, car, Zoom, cassette), the same files through Adobe Enhance v2 by hand | the comparison that matters | blind A/B, you and two others, which of each pair they would publish |
| WER: `npx audio take.wav --asr` on input, output and reference (`neural-asr`) | invented or lost words | relative WER increase ≤ 10 % over the reference's; Adobe's and FINALLY's class loses words at −5 dB SNR too: measure, do not assume |

```
python infer.py runs/b/net-0400000.pt $VB/noisy_testset_wav/*.wav --out out/vb
python score.py --ref $VB/clean_testset_wav --out out/vb --json out/vb.json
```

Publish only numbers from `score.py` and the bench scripts, with the commit that produced them, as every README in
the ecosystem does (the `Measured` sections of `neural-denoise`, `neural-separate`).

## 5. Export and host

```
python export.py runs/b/net-0400000.pt --fp16 --verify        # ~/.cache/audiojs/neural/restore/restore{,.fp16}.onnx
```

`--verify` must print over 100 dB from torch at both lengths. Host `restore.fp16.onnx` (and the small model's) in a
Hugging Face model repo `audiojs/restore`, and pin its revision hash in the plugin (as `neural-separate`'s
`REVISIONS` does): a URL without a hash is a model that can change under your users. The model card lists every
corpus, its license and attribution, the teacher, the bench numbers, and the weights' own license: CC BY 4.0 if
every source is CC BY or public domain, CC BY-SA 4.0 if Golos's ShareAlike applies (read its PDF; if in doubt, train
the hosted weights without Golos and keep a Golos variant for yourself).

## 6. The plugin: `@audio/neural-restore`

A package in `audiojs/neural/packages/neural-restore`, the shape of `neural-denoise`:

```
neural-restore/
  package.json        "@audio/neural-restore", type module, peer: @audio/neural-runtime
  index.js            export default restore(pcm, { sampleRate, model, strength }) ; export { load, MODEL, REVISIONS }
  restore.js          the pipeline below
  stft.js             or @audio/stft if it does centered reflect padding with a periodic Hann window
  scripts/            this directory: train.py, data.py, degrade.py, model.py, loss.py, export.py, infer.py, score.py, test.py, run.sh
  test.js             fixtures/in.wav through the JS pipeline against fixtures/ref.wav (Python's infer.py output): ≥ 60 dB
  README.md           What, How, Measured, Weights (license, sources), as the other packages
  LICENSE, NOTICE     MIT; the data attributions
```

The pipeline `restore.js` must reproduce `infer.py` exactly; the contract is small:

1. Per channel, resample to 48 kHz (`@audio/resample-sinc`); remember the gain `g` that brings the chunk to −20 dBFS RMS
   (`dsp.to_level`: `g = 10^((−20 − rms_db) / 20)`), apply it.
2. Chunks of 10 s overlapping by 1 s; each chunk: STFT with `n_fft` 2048, hop 512, **periodic** Hann
   (`0.5 − 0.5 cos(2πn/2048)`, torch's default), centered with 1024 samples of reflect padding at both ends, no
   normalization → 1025 bins × T frames; feed `[1, 2, 1025, T]` re/im float32 through `neural-runtime` (`load(url,
   { backend })`, `webgpu` where `backends()` lists it, else `wasm` / Node); iSTFT the output with the same window,
   overlap-add divided by the summed squared window (torch's `istft`), cut to the chunk's length.
3. Raised-cosine crossfade over the 1 s overlaps; divide by `g`; resample back to the input's rate; the output is
   exactly the input's length.
4. `strength` 0–1: `out = strength · y + (1 − strength) · x` (the same mixback `deepfilter()` uses for its limit).

Verify the JS STFT against torch once with a fixture (`scripts/export.py --verify` writes none: add
`scripts/reference.py` that dumps one chunk's spectrum, as `neural-separate/scripts/reference.py` does); then the
whole pipeline against `infer.py` on `fixtures/in.wav`. Speed: measure RTF on onnxruntime-web WebGPU first; if it
is over 0.2, the Mel-RoFormer engine (`neural-separate/roformer.js`) has the matmul and attention kernels, and the
ConvNeXt blocks add depthwise convolution and LayerNorm shaders.

## 7. The op in `audio`

`fn/deepfilter.js`'s `enhancer(name, id, finish, again)` already does what `restore()` needs: the whole input made
once ahead of rendering, memoized on the input's fingerprint and the options, channels apart, live sources waited
for, playback from the kept output. Two things in it are DeepFilterNet3's and become parameters: the package it
imports (`@audio/neural-denoise`) and the run (`removal()`, DFN3's unlimited output). Give `enhancer` a fifth
argument `{ pkg, run }` with the current values as defaults, and `fn/restore.js` is:

```js
import audio from '../core.js'
import { enhancer } from './deepfilter.js'

// restore(strength = 1, { model = 'restore', weights, device }): the take as a studio would have recorded it, 48 kHz full band
audio.op('restore', {
  params: ['strength'],
  ...enhancer('restore', o => {
    let s = o.strength ?? 1
    if (typeof s !== 'number' || !(s >= 0 && s <= 1)) throw new TypeError(`restore: strength is 0 to 1, not ${s}`)
    return `${s}:${o.model ?? 'restore'}`
  }, (x, y, o) => {                       // the model's output, the input mixed back by 1 − strength
    let s = o.strength ?? 1, out = new Float32Array(y.length)
    for (let i = 0; i < y.length; i++) out[i] = s * y[i] + (1 - s) * x[i]
    return out
  }, null, {
    pkg: '@audio/neural-restore',
    run: (neural, pcm, sampleRate, o) => neural.default(pcm, { sampleRate, model: o.model, weights: o.weights, device: o.device }),
  }),
})
```

`restore()` is a full-band op: unlike `deepfilter`, no `music: 'pass'` guard (a song is a valid input), so `music`
is not read. Then: `fn/` is auto-registered by name, so a row in README's plugin table (what it is, the measured
numbers, ≡ Adobe Podcast Enhance Speech, iZotope RX Dialogue Isolate + Spectral Recovery), `audio.d.ts`, the
playground's Enhance menu ("Restore"), the CLI (`--restore`), `auto('speech')` taking it as the last repair stage
when the package is installed (as it takes `deepfilter` through `@audio/chain`), a test in `test/` with a
fixture, and `bench/speech.mjs` gaining a `restore` system so the recipe benches and `bench/rx` compare it.

## 8. Ship list

- [ ] `test.py` ok on the GPU box; `listen/` pairs sound like real bad recordings
- [ ] Stage A go on every row of 3.1
- [ ] Stage B: `val` plateaued, samples clean, a clean input stays clean
- [ ] Section 4 numbers, with the commit hash, and the blind A/B against Adobe v2
- [ ] `export.py --verify` over 100 dB; weights on `audiojs/restore` with a pinned revision and a complete model card
- [ ] `@audio/neural-restore` tests pass in Node and the browser; RTF measured on WebGPU, wasm, Node
- [ ] `restore()` in `audio`: README row, d.ts, playground, CLI, `auto()`; `bench/rx` numbers against RX and Adobe
- [ ] Licenses: every corpus in NOTICE; the weights' license decided (CC BY or CC BY-SA); nothing non-commercial touched the hosted weights
