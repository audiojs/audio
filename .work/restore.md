# restore(): a studio-grade voice from a bad recording

Plan and findings, 2026-10-14. The training side lives in [`train/restore/`](../train/restore/README.md); the op and
its package follow once weights exist. "Verified" marks what was checked at the source this session; "recalled"
marks training knowledge not re-checked (the container could not fetch arxiv, openreview or most paper mirrors).

## Goal

An offline alternative to Adobe Podcast Enhance Speech (v2): a voice recorded in a room, in noise, on a laptop or
phone microphone, through a codec, speech or singing, English or Russian, comes back as a studio would have
recorded it, 48 kHz, full band. Small (20 MB or less in fp16), one pass on the GPU (no diffusion steps, no
autoregression), real-time factor under 0.05 on a consumer GPU, runnable in the page on WebGPU and in Node.

What this is not: a denoiser. `deepfilter()` (DeepFilterNet3, 8 MB) already beats iZotope RX 12 Dialogue Isolate
on VoiceBank+DEMAND, and `dereverb()` (WPE) beats RX De-reverb (docs/rx.md). Masking keeps what is there and takes
what is not; it cannot give back a band a phone never recorded, a consonant a codec smeared, or a voice under a
long tail. That is generation, and it needs an adversarially trained model (or a diffusion / token model, which
is slow). Adobe's is that class: on real takes its output has bandwidth and texture the input never had.

## What exists, measured (reused here)

- `@audio/neural-denoise`: DeepFilterNet3 through `@audio/neural-runtime` (ONNX Runtime, wasm / WebGPU / Node),
  10 s chunks, the input mixed back at a limit (`fn/deepfilter.js`'s `enhancer()`): the op shape `restore()` takes.
- `@audio/neural-separate`: the STFT-outside-the-graph contract (`[1, 2, F, T]` re/im in and out, `export-roformer.py`),
  the Mel-RoFormer WebGPU engine (subgroup matrices, 1.5–1.8 s an 8 s segment) and the fp16 hosting on Hugging Face
  (`audiojs/mel-roformer`). The restorer exports to the same contract, so the JS side is the same code.
- `bench/speech.py` and `bench/speech.mjs`: PESQ, STOI, SI-SDR, DNSMOS at 16 kHz on VoiceBank+DEMAND, MIT IR Survey
  rooms (`vbreverb`), ten narrations; `bench/rx/*.mjs` the same against RX 12. `train/restore/score.py` reads them
  and adds LSD at 48 kHz, the bandwidth measure.
- `dereverb()`'s room sets (`bench/rx/dereverb.py`: MIT IR Survey, DEMAND, VocalSet) and `auto()`'s multi-defect
  takes (`bench/rx/assistant.mjs`) are evaluation sets ready to run.

## Prior art, checked 2026-10-14

| System | What | Verified | Use here |
|---|---|---|---|
| FINALLY (Samsung, NeurIPS 2024) | HiFi++ generator with a WavLM encoder, GAN over MS-STFT discriminators, LMOS (WavLM-conv features + STFT L1), UTMOS and PESQ losses in the last stage, 48 kHz out; three stages: content on LibriTTS-R at 16 kHz, then an upsampler and adversarial training on DAPS-clean at 48 kHz; noise from DNS; claims studio-like quality on real takes, one pass | paper found, training data and staging confirmed from the proceedings text; no code, weights or license found (demo page only) | the recipe (a speech model's features as the loss that carries quality through GAN training; regression first, adversarial after). DAPS is CC BY-NC-SA: not for our targets |
| Sidon v0.1 (U. Tokyo, 2025, MIT) | w2v-BERT 2.0 predictor + DAC decoder, 16 kHz in → 48 kHz out, multilingual (dozens of languages), 470 MB, 500× real time on a GPU; made for dataset cleansing | repo MIT, two models released; corpora not named; weights' own license not stated | the teacher: cleans Russian audiobooks and separated vocals into 48 kHz targets; a quality ceiling to measure against; too big to ship |
| Resemble Enhance (2023, MIT) | UNet denoiser + latent conditional flow matching enhancer, 44.1 kHz | MIT confirmed from several sources | second teacher / baseline; multi-step, not the shape we ship |
| AnyEnhance (CUHK-SZ / Huawei, 2025) | masked generative model on DAC tokens for speech and singing (denoise, dereverb, declip, super-resolution, target speaker) | code MIT, a 45.7M baseline checkpoint released (trained on 2×A800, 200k steps), ~200 h paired data | the one open restorer that names singing; token models are slower and hallucinate more: a baseline, not the design |
| UniPASE (2026) | generative universal SE "with low hallucinations": a Vocos-style iSTFT vocoder at 16 kHz and a 48 kHz PostNet for bandwidth | abstract and architecture summary only | confirms the Vocos backbone as an enhancement generator |
| "Fast and flexible audio bandwidth extension via Vocos" (Sharma, 2026) | one Vocos network for 8–48 kHz input, a refiner blends the low band back; RTF 0.0001 on an A100, 0.0053 on an 8-core CPU | abstract only, code link not retrieved | same backbone, the speed figure we aim at |
| URGENT 2026 (ICASSP) | universal SE across distortions and rates; 2025's finding: purely generative models show language dependency; 2026 adds whispered and singing voices, ages, accents | overview papers found; Russian not confirmed in its data | the finding is the reason for Russian targets; its data lists are a source map |
| Adobe Enhance Speech v2 | web app, March 2026 release added source separation; reviewers: much better than v1, adds bass, still flattens voices and damages consonants at times; RX 11 and Waves Clarity Vx preferred for natural tone in several tests | reviews only | the reference set: our test takes through it, by hand (no API) |

Recalled, not re-checked: VoiceFixer (2021, mel + TFGAN vocoder, 44.1 kHz, slow), Miipher / Miipher-2 (Google, not
open; LibriTTS-R is Miipher's output), MaskSR / Genhancer (token models), VoiceRestore (flow matching on mel +
BigVGAN), UNIVERSE++ (Dolby, score-based).

## Design

One network, one pass, in the STFT domain, trained first as a regressor and then adversarially with a speech
model's features in the loss. Reasons, against the alternatives:

- Not DeepFilterNet3 → Vocos in series. DFN3 is a masker trained to erase; what it erases (breath, held-note texture,
  Russian fricatives it takes for hiss) a second net must invent back. Two models, two error surfaces, two
  downloads, and the second cannot see what the first threw away. One net trained end to end on the same
  degradations learns to keep what is signal and to make what is missing. (DFN3 stays the cheap tier for noise alone.)
- Not flow matching or tokens (Resemble Enhance, AnyEnhance, UniPASE's generative core). They give the best
  worst-case restoration but need 8–32 passes or an autoregressive loop, hallucinate words and speaker identity
  at low SNR (URGENT's finding), and the token codecs cap singing. A GAN-trained one-pass model is what FINALLY
  shows reaches "studio-like" on real takes, and what fits a browser.
- Backbone: Vocos's ConvNeXt stack over frames (dim 512, 8 blocks, kernel 7, ×3 MLP) with two self-attention
  layers (rotary positions) after blocks 3 and 6: the convolutions see ~0.5 s, the attention the whole 10 s chunk,
  which a room's tail needs. ~17M parameters; no recurrence, so the GPU spreads it over time (SCNet's LSTMs are
  what made our split slow, .work/todo.md). STFT 2048/512 at 48 kHz (1025 bins, 93.75 frames/s).
- Output: a change of log magnitude added to the input's (unbounded, so a band can be attenuated 60 dB or raised
  from nothing) and a phase as a unit vector (Vocos's head without the atan2). The STFT and iSTFT stay outside the
  graph (neural-separate's contract), so the export is the network alone.
- Level: the net hears every input at −20 dBFS RMS (as `deepfilter()` has DFN3 hear it) and the target is scaled
  by the same gain: the output keeps the input's level, which `mix` and `auto()` need; loudness is the next stage's.
- Losses: log-magnitude L1 + spectral convergence over 512/1024/2048/4096 windows, log-mel L1 (×45), WavLM Base+
  conv features and layer 6 L1 (FINALLY's LMOS made of a 95M MIT model that torchaudio ships), then least-squares
  GAN over HiFi-GAN's multi-period (2, 3, 5, 7, 11) and UnivNet's multi-resolution discriminators with L1
  feature matching (×2). Pitch loss: none; the period discriminators and WavLM carry f0 (CREPE-feature losses
  exist in vocoder work; add only if vibrato measurably drifts).
- Mixed-bandwidth targets, the novelty worth keeping: every loss and discriminator sees the target and the
  estimate through the same low-pass at the target's measured bandwidth (`dsp.band`, `dsp.bandwidth`). LibriTTS-R
  is 24 kHz, Russian corpora 16 kHz, VCTK and VocalSet full band: a 24 kHz target judges nothing above 12 kHz and
  the full-band ones teach the top. FINALLY needed three stages and two corpora for this; here it is one run.
- Degradations on the fly, in the physical order (`degrade.py`): room (measured IRs 70 %, else an exponential
  tail with a sparse early part, T60 0.15–2.5 s, DRR −6…12 dB), noise (banks or coloured noise and mains hum,
  SNR −5…35 dB), microphone (tilt ±4 dB/oct, 1–3 resonances, low cut 40–300 Hz), compressor, clipping, band
  limit (2–20 kHz, log-uniform), codec (MP3, AAC, Opus, GSM through ffmpeg at 8–128 kb/s, the codec's lag removed),
  8/12/16-bit words with dither; chances 0.2–0.8 a stage. Chunks of 4 s, levels −35…−12 dBFS.

## Data

Targets must be studio-clean and, for the top octave, full band; the license must allow hosting weights for anyone
(the audiojs policy: audited before any promise). Checked this session:

| Source | Hours | Rate | License | Status |
|---|---|---|---|---|
| VCTK | 44 | 48 kHz | CC BY 4.0 | use; its room and noise are mild but real: teacher-clean it (Sidon) or filter by DNSMOS |
| LibriTTS-R | 585 | 24 kHz | CC BY 4.0 per OpenSLR (one arXiv entry says CC BY-NC-ND: read the download page) | use, bandwidth 12 kHz; Miipher-restored, so already a teacher's output |
| EARS | 100 | 48 kHz | CC BY-NC 4.0 (secondhand) | not for hosted weights; evaluation only |
| DAPS | 4.5 | 44.1 kHz | CC BY-NC-SA | evaluation only (FINALLY's 48 kHz targets) |
| Hi-Fi TTS (NVIDIA) | 292 | 44.1 kHz | not checked | check: LibriVox-derived, likely CC BY-SA-ish |
| Golos (Sber, Russian) | 1240 | 16 kHz | "close to CC BY-SA", research and commercial use allowed (SberDevices), ShareAlike | use after teacher cleaning: crowd and far-field, not studio; ShareAlike may bind the weights' license: read `license/en_us.pdf` |
| RuLS (Russian LibriSpeech, OpenSLR 96) | 98 | 16 kHz | public domain in the USA (OpenSLR), CC BY 4.0 on a mirror | use after teacher cleaning (LibriVox amateurs' rooms and microphones) |
| M-AILABS Russian | ~46 | 16 kHz | not retrieved | check |
| RUSLAN, Natasha (Russian TTS corpora) | 31, ? | ? | RUSLAN recalled CC BY-NC-SA | likely evaluation only |
| Balalaika (Russian, 2025/26) | 1000 | ? | CC BY-NC-SA / NC-ND (sources disagree) | not for hosted weights |
| Dialogs (Russian studio, 2026) | 20.6 | 44.1 kHz | OpenRAIL | read its use restrictions before use |
| VocalSet | 10.1 | 44.1 kHz | CC BY 4.0 (the paper; confirm on Zenodo) | use: the one full-band singing set with a permissive license |
| GTSinger | 80.6 | ? | CC BY-NC-SA 4.0 | not for hosted weights (it has Russian singing: evaluation set for exactly that) |
| MUSDB18-HQ vocals, M4Singer, OpenSinger, Opencpop | — | — | research-only / NC / agreement | evaluation only |
| CC BY and CC0 music (Jamendo, FMA, ccMixter) → `vocals({ model: 'mel-roformer' })` | unbounded | 44.1 kHz | per track | the singing data factory: separate, teacher-clean, keep the clips a quality gate passes |
| MIT IR Survey | 271 IRs | 32 kHz | unspecified (a mirror says unknown) | already used in benches; for training prefer the clearly CC BY sets below |
| OpenAIR, BUT ReverbDB (1300+ and 2325 IRs) | — | — | CC BY / CC BY 4.0 | use; plus synthetic rooms (unlimited) |
| DEMAND | 18 scenes | 48 kHz | CC BY-SA 3.0 (a mirror) | use for training noise (ShareAlike again), test noise as benches do |
| MUSAN | 109 | 16 kHz | CC BY 4.0 overall, per-file LICENSE files, commercial use allowed by selection | use (noise and music beds) |
| FSD50K | 108 | 44.1 kHz | CC BY 4.0 overall; 84.7 % of clips CC0 or CC BY, the rest NC | use the CC0 + CC BY clips |
| WHAM!, DNS Challenge noise and IRs | — | — | not retrieved (WHAM! recalled CC BY-NC) | check before use |

What this means in hours, after cleaning and gating: English ~300–600 h (LibriTTS-R, VCTK, maybe Hi-Fi TTS), of
it ~50 h full band; Russian ~100–300 h at 16 kHz through the teacher (its top octave then is the teacher's);
singing 10 h full band (VocalSet) plus whatever the separation factory yields (aim 50–100 h). The pasted
strategy's "150 h of studio Russian" and "100–200 h of singing" do not exist under an open license; GTSinger,
M4Singer, OpenSinger, MUSDB18-HQ, EARS and RUSLAN are all non-commercial, and scraping LitRes is a copyright
breach. The teacher route (Sidon, MIT) is how both gaps close, and it is what Google did for LibriTTS-R.

Teacher cleaning, concretely: run Sidon over Golos's crowd subset, RuLS and the separated vocals; keep a clip when
DNSMOS OVRL ≥ 3.3, the teacher's output stays within 0.5 of the input's WER (neural-asr, so no words are
invented) and speaker similarity ≥ 0.85 (neural-diarize's WavLM embeddings); drop the rest. The student then
trains on teacher outputs the way LibriTTS-R is Miipher's: distillation by data, no teacher at training time.

## Training and compute

- Steps: 30k regression warm-up, then adversarial to 400k; batch 16 × 4 s at 48 kHz. Memory with the WavLM loss
  and 8 discriminators: ~18 GB at bf16. A 24 GB card (RTX 4090 / 3090, A5000) does it; a 16 GB card at batch 8.
- Time: the generator is ~17M parameters over 375 frames a clip, the discriminators and WavLM dominate. Estimate
  2.5–3.5 steps/s on a 4090 → 400k steps in 1.5–2 days; on an A100 about the same; on the M4 Max (MPS) 5–10×
  slower and `torch.stft` / `istft` on MPS have had gaps: debug there, train on a rented card. Cloud: a 4090 at
  $0.4–0.7/h on Vast or RunPod → $20–60 a run; budget five runs (losses, data mix, size) → under $300.
- The teacher pass: Sidon at 500× real time cleans 1000 h in a few GPU hours. Separation of music for singing
  targets: mel-roformer at RTF 0.44 on the laptop's WebGPU, 100 h of music a day; on a CUDA card far less.
- Smaller sibling for the page: dim 384, 6 blocks (~8M, ~16 MB fp16) trained the same way; measure what it loses.
- Checked to work before any GPU is paid for: `train/restore/test.py` runs the chain, a training run with resume,
  ONNX export matching torch, inference in chunks, on CPU with synthetic voices.

## Evaluation

The sets exist in `bench/`: VoiceBank+DEMAND (noise), vbreverb (MIT rooms), the ten narrations, `bench/rx/
assistant.mjs`'s multi-defect takes, `dereverb.py`'s sung and music rooms. Add: phone and laptop-mic takes (record
them: no open set), Russian (GTSinger's Russian songs and Balalaika's or RUSLAN's clips are fine as test material),
and the same takes through Adobe Enhance v2 by hand, as `bench/rx` does with RX. Measures: PESQ, STOI, SI-SDR,
DNSMOS (there already), LSD for bandwidth, WER through `neural-asr` (a restorer that invents consonants raises it),
speaker similarity, UTMOS; and a blind listen, which decides. The policy from `deepfilter()` holds: DNSMOS SIG
must not fall on clean input, VocalSet's held notes must not go down, music alone must pass.

## Shipping

- Export: `export.py` → `restore.onnx` (fp32) and `restore.fp16.onnx` (~34 MB), `[1, 2, 1025, T]` in and out,
  verified against torch; hosted as `audiojs/restore` on Hugging Face, pinned by revision as neural-separate pins.
- Package: `@audio/neural-restore` in audiojs/neural: STFT 2048/512 (JS, as neural-separate's), the net through
  `neural-runtime` (WebGPU where there is one, Node's providers else), 10 s chunks with 1 s crossfades, the input at
  −20 dBFS RMS and back. The Mel-RoFormer WGSL engine's matmul and attention kernels apply if ONNX Runtime is too
  slow; the ConvNeXt blocks add depthwise convolutions and LayerNorm.
- Op: `restore(strength?, { model?, weights?, device? })` in `fn/restore.js` on `fn/deepfilter.js`'s `enhancer()`:
  the whole output made ahead of rendering, memoized on the input; `strength` 0–1 mixes the input back (1: the
  model's output; as `deepfilter`'s limit). `auto('speech')` gains it as the last repair stage when installed.
  Playground: a "Restore" entry beside Enhance; the CLI the same.

## What the pasted strategy got right and wrong

Right: the problem class (generative restoration and bandwidth extension, not masking), synthetic degradation of
clean targets, 48 kHz, multi-resolution STFT + mel + MPD/MSD losses, 15–40M parameters, one pass, fine-tune
cost in the tens of dollars. Wrong or unsupported: the data list (GTSinger, M4Singer, OpenSinger, MUSDB18-HQ, EARS,
RUSLAN are non-commercial; LitRes scraping is not a source); "150 h studio Russian" (none open; Golos is crowd
and far-field, 16 kHz); DFN3 → Vocos as two models (see Design); "Vocos is orders of magnitude faster than
wave-domain GANs" (true against HiFi-GAN's transposed convolutions, and why we use its backbone, but FINALLY's
HiFi++ is also one pass); a pitch loss as a fix for vibrato (unmeasured; MPD and WavLM already hold f0); and the
most important ingredient was missing: the speech-model feature loss (LMOS) that FINALLY shows turns adversarial
training from "clean" into "studio". The Russian fricative worry is plausible but unmeasured: test it (WER and a
listen on щ / ц / ч words) before building for it.

## Risks

- GAN training can collapse or ring: the warm-up and feature matching are the usual guards; watch `samples/`.
- Hallucination at low SNR (the generative tax): the WavLM loss and the WER gate in evaluation; `strength` mixes
  the input back where the user prefers damage to invention.
- Singing: VocalSet alone is 20 singers; the separation factory decides whether singing is good or merely not broken.
- Russian top octave comes from the teacher, not from recordings: listen for a "Sidon accent" in sibilants.
- Licenses: three "verify" rows above before any weights are hosted; ShareAlike (Golos, DEMAND) may bind the
  weights' license to CC BY-SA, which is still hostable.

## Next

1. On a GPU machine: fetch VCTK, LibriTTS-R, VocalSet, OpenAIR + BUT IRs, MUSAN + FSD50K CC0/BY; `data.py scan`;
   a 50k-step run at dim 384 to validate the recipe on VoiceBank+DEMAND and vbreverb (`score.py`); then full size.
2. Sidon installed; the Russian and separated-vocal teacher pass with the quality gate; rerun with them.
3. Export, host, `@audio/neural-restore`, `restore()`; benches against `deepfilter()`, `auto()`, Adobe v2.
