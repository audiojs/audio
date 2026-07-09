#!/usr/bin/env python3
# librosa + Pedalboard timings for the audio benchmark. Emits one JSON line per
# {tool, op} to stdout: {"tool","op","ms"} (ms = best of N warm runs), or ms=null
# for ops the tool doesn't provide. Driven by bench.js; not run directly.
#
# Every timed task runs END-TO-END from the input file, matching the CLI tools:
# decode for decode rows, load+analyze for analysis rows, load+op+write for
# transform rows. (librosa/Pedalboard are libraries, so these run in-process and
# exclude interpreter startup — noted in the doc.)
#
#   python bench.py <wav> <mp3> <out_dir> <reps>

import json, sys, time, os

wav, mp3, out_dir, reps = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])

def best(fn, reps):
    fn()  # warm
    t = []
    for _ in range(reps):
        s = time.perf_counter()
        fn()
        t.append((time.perf_counter() - s) * 1000)
    return min(t)

def emit(tool, op, fn):
    try:
        print(json.dumps({"tool": tool, "op": op, "ms": round(best(fn, reps), 1)}), flush=True)
    except Exception as e:
        print(json.dumps({"tool": tool, "op": op, "ms": None, "err": str(e)[:80]}), flush=True)

# ── librosa (load inside every timed task) ──────────────────────────────────
import librosa, soundfile as sf, numpy as np

def lr_resample():
    y, sr = librosa.load(wav, sr=None, mono=False)
    o = librosa.resample(y, orig_sr=sr, target_sr=48000)
    sf.write(os.path.join(out_dir, "lr_rs.wav"), o.T, 48000)

def lr_stretch():
    y, sr = librosa.load(wav, sr=None, mono=False)
    o = librosa.effects.time_stretch(y, rate=0.8)
    sf.write(os.path.join(out_dir, "lr_st.wav"), o.T, sr)

def lr_pitch():
    y, sr = librosa.load(wav, sr=None, mono=False)
    o = librosa.effects.pitch_shift(y, sr=sr, n_steps=2)
    sf.write(os.path.join(out_dir, "lr_pi.wav"), o.T, sr)

def lr_fft():
    y, sr = librosa.load(wav, sr=None, mono=True)
    librosa.stft(y, n_fft=1024)

def lr_mfcc():
    y, sr = librosa.load(wav, sr=None, mono=True)
    librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)

def lr_beat():
    y, sr = librosa.load(wav, sr=None, mono=True)
    librosa.beat.beat_track(y=y, sr=sr)

emit("librosa", "wav_decode", lambda: librosa.load(wav, sr=None, mono=False))
emit("librosa", "mp3_decode", lambda: librosa.load(mp3, sr=None, mono=False))
emit("librosa", "resample", lr_resample)
emit("librosa", "stretch", lr_stretch)
emit("librosa", "pitch", lr_pitch)
emit("librosa", "fft", lr_fft)
emit("librosa", "mfcc", lr_mfcc)
emit("librosa", "beat", lr_beat)

# ── Pedalboard (load inside every timed task) ────────────────────────────────
from pedalboard import Pedalboard, Resample, PitchShift
from pedalboard.io import AudioFile

def pb_decode(path):
    with AudioFile(path) as f:
        f.read(f.frames)

def pb_load(path):
    with AudioFile(path) as f:
        return f.read(f.frames), f.samplerate

def pb_write(path, data, sr):
    with AudioFile(path, "w", sr, data.shape[0]) as f:
        f.write(data)

def pb_resample():
    a, sr = pb_load(wav)
    o = Pedalboard([Resample(target_sample_rate=48000)])(a, sr)
    pb_write(os.path.join(out_dir, "pb_rs.wav"), o, sr)

def pb_pitch():
    a, sr = pb_load(wav)
    o = Pedalboard([PitchShift(semitones=2)])(a, sr)
    pb_write(os.path.join(out_dir, "pb_pi.wav"), o, sr)

emit("pedalboard", "wav_decode", lambda: pb_decode(wav))
emit("pedalboard", "mp3_decode", lambda: pb_decode(mp3))
emit("pedalboard", "resample", pb_resample)
emit("pedalboard", "pitch", pb_pitch)
