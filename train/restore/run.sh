#!/usr/bin/env bash
# One command on a GPU machine (CUDA, 24 GB; or an Apple Silicon Mac for the small model): the open data fetched,
# scanned, the model trained, exported and scored.
#
#   bash run.sh fetch   [DATA]        LibriTTS-R train-clean-100 (CC BY 4.0, 24 kHz), VCTK (CC BY 4.0, 48 kHz), MUSAN noise
#                                     (CC BY 4.0), VocalSet (CC BY 4.0, 44.1 kHz) into DATA (default ~/.cache/audiojs/data/restore)
#   bash run.sh scan    [DATA]        manifests with each file's bandwidth
#   bash run.sh train   [DATA] [RUN]  the run (RUN default runs/restore); resumes if RUN exists
#   bash run.sh small   [DATA] [RUN]  the browser-size model (dim 384, 6 blocks), batch 8
#   bash run.sh export  RUN           ONNX fp32 and fp16 into the neural cache, verified
#   bash run.sh all     [DATA]        fetch, scan, train, export
#
# Rooms: no single archive serves OpenAIR or BUT ReverbDB; put any impulse responses (wav) under DATA/rirs and the run
# takes them (70 % measured, 30 % synthetic); without them every room is synthetic. Python 3.12 is used where found
# (pesq, which score.py needs, builds on it; the trainer runs on 3.13 too).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
CMD=${1:-all}; DATA=${2:-$HOME/.cache/audiojs/data/restore}; RUN=${3:-$HERE/runs/restore}
PY=$(command -v python3.12 || command -v python3)

venv() {
  [ -d "$HERE/.venv" ] || { "$PY" -m venv "$HERE/.venv"; "$HERE/.venv/bin/pip" -q install -U pip; }
  "$HERE/.venv/bin/pip" -q install torch torchaudio soundfile scipy pystoi onnx onnxruntime onnxconverter-common pyloudnorm \
    && ("$HERE/.venv/bin/pip" -q install pesq || echo "pesq did not build: score.py's PESQ needs it, the rest runs")
  PY="$HERE/.venv/bin/python"
}

get() {  # get URL DIR: fetched once (resumable), unpacked once
  local url=$1 dir=$2 f; f="$dir/$(basename "${url%%\?*}")"
  mkdir -p "$dir"
  if [ ! -e "$f" ]; then curl -fL --retry 5 -C - -o "$f.part" "$url" && mv -f "$f.part" "$f"; fi
  [ -e "$f" ] || { echo "could not fetch $url" >&2; return 1; }
  if [ ! -e "$f.unpacked" ]; then
    case "$f" in *.tar.gz|*.tgz) tar xzf "$f" -C "$dir";; *.zip) unzip -qo "$f" -d "$dir";; esac
    touch "$f.unpacked"
  fi
}

fetch() {
  get https://www.openslr.org/resources/141/train_clean_100.tar.gz "$DATA/libritts-r"
  get https://www.openslr.org/resources/17/musan.tar.gz "$DATA/musan"
  get https://datashare.ed.ac.uk/bitstream/handle/10283/3443/VCTK-Corpus-0.92.zip "$DATA/vctk"
  get "https://zenodo.org/records/1193957/files/VocalSet1-2.zip?download=1" "$DATA/vocalset" || echo "VocalSet: download VocalSet1-2.zip from zenodo.org/records/1193957 into $DATA/vocalset and unzip it"
  mkdir -p "$DATA/rirs" "$DATA/noise"
  [ -d "$DATA/musan/musan/noise" ] && ln -sfn "$DATA/musan/musan/noise" "$DATA/noise/musan"
}

scan() {
  cd "$HERE"
  [ -d "$DATA/libritts-r/LibriTTS_R" ] && "$PY" data.py scan "$DATA/en-libritts.json" "$DATA/libritts-r/LibriTTS_R" --kind speech --lang en
  [ -d "$DATA/vctk/wav48_silence_trimmed" ] && "$PY" data.py scan "$DATA/en-vctk.json" "$DATA/vctk/wav48_silence_trimmed" --kind speech --lang en
  [ -d "$DATA/vocalset" ] && "$PY" data.py scan "$DATA/sing.json" "$DATA/vocalset" --kind sing
  ls "$DATA"/*.json
}

manifests() { ls "$DATA"/*.json | paste -sd, -; }

train() {
  cd "$HERE"; local resume=""; [ -e "$RUN/last.pt" ] && resume=--resume
  "$PY" train.py --out "$RUN" --clean "$(manifests)" --rirs "$DATA/rirs" --noises "$DATA/noise" $resume "$@" 2>&1 | tee -a "$RUN.log"
}

export_() {
  cd "$HERE"; local ck; ck=$(ls "$RUN"/net-*.pt | tail -1)
  "$PY" export.py "$ck" --fp16 --verify
}

venv
case "$CMD" in
  fetch) fetch;;
  scan) scan;;
  train) mkdir -p "$RUN"; train;;
  small) mkdir -p "$RUN"; train --dim 384 --blocks 6 --attn 2,4 --batch 8;;
  export) export_;;
  all) fetch; scan; mkdir -p "$RUN"; train; export_;;
  *) sed -n 2,20p "$0"; exit 1;;
esac
