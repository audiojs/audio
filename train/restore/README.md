# restore: a studio-grade voice from a bad recording

The training side of `audio`'s coming `restore()` op: one network that takes a voice recorded in a room, in noise,
through a cheap microphone, a codec or a phone, speech or singing, and gives back the voice as a studio would have
recorded it, at 48 kHz. The plan, the data and what is known are in [`.work/restore.md`](../../.work/restore.md).

On a GPU machine, `bash run.sh all` does all of the below (about 20 GB of downloads: LibriTTS-R train-clean-100, VCTK, MUSAN, VocalSet). By hand:

```
pip install torch torchaudio soundfile scipy onnx onnxruntime onnxconverter-common     # ffmpeg on PATH for codecs
python data.py scan en.json  /data/vctk /data/libritts-r --kind speech --lang en       # manifests, bandwidth per file
python data.py scan ru.json  /data/ruls --kind speech --lang ru
python data.py scan sing.json /data/vocalset --kind sing
python train.py --out runs/a --clean en.json,ru.json,sing.json --rirs /data/rirs --noises /data/noise
python export.py runs/a/net-0400000.pt --fp16 --verify                                   # → ~/.cache/audiojs/neural/restore/
python infer.py runs/a/net-0400000.pt take.wav --out restored/
python score.py --ref clean/ --out restored/                                             # PESQ, STOI, SI-SDR, DNSMOS, LSD
python test.py                                                                           # smoke test, CPU, a minute
```

`score.py` also needs `pesq pyloudnorm` (`pesq` builds from source: on Python 3.13 it needs `setuptools<70` in the build, or Python 3.12).

```
```

| File | What |
|---|---|
| `dsp.py` | the STFT (2048/512 at 48 kHz), levels, the band limit every loss passes through, mel, resampling, the bandwidth a file carries |
| `degrade.py` | the on-the-fly degradation chain: room (measured or synthetic), noise, microphone colour, compressor, clipping, band limit, codec (ffmpeg), word length |
| `data.py` | manifests and the pair sampler (an IterableDataset: crops by length, levels, the chain) |
| `model.py` | the generator (ConvNeXt over frames with self-attention, log-magnitude change + phase), the discriminators (multi-period, multi-resolution) |
| `loss.py` | multi-resolution STFT, log-mel, WavLM feature distance, least-squares GAN, feature matching |
| `train.py` | the run: regression warm-up, then adversarial; checkpoints, validation (LSD, SI-SDR, mel), samples |
| `export.py` | ONNX between STFT and iSTFT, `[1, 2, 1025, T]` re/im in and out, fp16, verified against torch |
| `infer.py` | files through a checkpoint or the ONNX, chunked |
| `score.py` | `bench/speech.py`'s measures plus LSD on a directory of outputs against references |
| `test.py` | the whole path on synthetic voices, CPU |
| `run.sh` | one command on a GPU machine: fetch the open data, scan, train, export (`bash run.sh all`; `small` for the browser-size model) |
