#!/usr/bin/env python3
# librosa's and Pedalboard's cells for the module benchmark (bench/modules.js, which drives it; not run directly). Each
# row's op on the sound already decoded in memory, as the modules are timed there: only the decode rows read the file.
# In-process, each op warmed once, then `reps` runs taking turns, the order turned each run. One JSON line per cell to
# stdout: {"tool","op","method","wall":[ms…],"cpu":[ms…],"load":[1-min load average before each run…]}; a line of the
# versions; then, once, what each op made, for modules.js to compare: {"check": op, "tool", …}, the samples it compares
# in <out_dir>/<lr|pb>_<op>.f32 (float32, the first channel's first seconds).
# Pedalboard's cells only where it is installed; without it, librosa's alone.
#
#   python modules.py <wav> <mp3> <out_dir> <reps> [ops,…]
#
# A Python for both: python3 -m venv venv && venv/bin/pip install librosa soundfile soxr numpy pedalboard

import json, sys, time, os

wav, mp3, out_dir, reps = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
only = set(sys.argv[5].split(',')) if len(sys.argv) > 5 and sys.argv[5] else None

import librosa, soundfile as sf, soxr, numpy as np
try:
    import pedalboard
    from pedalboard.io import AudioFile, StreamResampler
except ImportError:
    pedalboard = None

y, sr = sf.read(wav, dtype='float32', always_2d=True)
y = np.ascontiguousarray(y.T)                  # channels by frames, as librosa.load(mono=False) gives
m = librosa.to_mono(y)                         # the channels' mean, as librosa.load(mono=True) gives

def pb_read(path):
    with AudioFile(path) as f: return f.read(f.frames)

def pb_resample():
    r = StreamResampler(sr, 48000, y.shape[0])  # its default quality, WindowedSinc32
    return np.concatenate([r.process(y), r.process()], axis=1)

# (tool, op): (what it is, the call)
CELLS = {
    ("librosa", "wav_decode"): ("librosa.load (soundfile, libsndfile)", lambda: librosa.load(wav, sr=None, mono=False)[0]),
    ("librosa", "mp3_decode"): ("librosa.load (soundfile, libsndfile's mpg123)", lambda: librosa.load(mp3, sr=None, mono=False)[0]),
    ("librosa", "resample"): ("soxr_hq, librosa's default", lambda: librosa.resample(y, orig_sr=sr, target_sr=48000)),
    ("librosa", "stretch"): ("phase vocoder, n_fft 2048, hop 512", lambda: librosa.effects.time_stretch(y, rate=0.8)),
    ("librosa", "pitch"): ("time_stretch, then soxr_hq", lambda: librosa.effects.pitch_shift(y, sr=sr, n_steps=2)),
    ("librosa", "fft"): ("stft: n_fft 1024, hop 256, Hann, centred", lambda: librosa.stft(m, n_fft=1024)),
    ("librosa", "mfcc"): ("n_fft 2048, hop 512, 128 mels", lambda: librosa.feature.mfcc(y=m, sr=sr, n_mfcc=13)),
    ("librosa", "beat"): ("onset strength, tempo, DP", lambda: librosa.beat.beat_track(y=m, sr=sr)),
}
if pedalboard:
    CELLS.update({
        ("pedalboard", "wav_decode"): ("AudioFile.read (JUCE's WAV reader)", lambda: pb_read(wav)),
        ("pedalboard", "mp3_decode"): ("AudioFile.read (JUCE's MP3 decoder)", lambda: pb_read(mp3)),
        ("pedalboard", "resample"): ("StreamResampler, its default WindowedSinc32", pb_resample),
        # Rubber Band offline, its finer engine (R3): high_quality=True, the default
        ("pedalboard", "stretch"): ("time_stretch: Rubber Band R3, offline", lambda: pedalboard.time_stretch(y, sr, 0.8)),
        # Rubber Band real-time, its default engine (R2): the PitchShift plugin
        ("pedalboard", "pitch"): ("PitchShift: Rubber Band R2, real-time", lambda: pedalboard.PitchShift(semitones=2)(y, sr)),
    })
keys = [k for k in CELLS if not only or k[1] in only]
wall, cpu, load = ({k: [] for k in keys} for _ in range(3))
for k in keys: CELLS[k][1]()                   # warm (numba compiles beat_track's tracker on its first call)
for r in range(reps):
    for i in range(len(keys)):
        k = keys[(i + r) % len(keys)]
        load[k].append(os.getloadavg()[0])
        w, c = time.perf_counter(), time.process_time()
        out = CELLS[k][1]()
        wall[k].append((time.perf_counter() - w) * 1000); cpu[k].append((time.process_time() - c) * 1000)
        del out
for k in keys:
    print(json.dumps({"tool": k[0], "op": k[1], "method": CELLS[k][0], "wall": wall[k], "cpu": cpu[k], "load": load[k]}), flush=True)
print(json.dumps({"versions": {"python": sys.version.split()[0], "librosa": librosa.__version__, "soundfile": sf.__version__,
    "libsndfile": sf.__libsndfile_version__, "soxr": soxr.__version__, "numpy": np.__version__,
    **({"pedalboard": pedalboard.__version__} if pedalboard else {})}}), flush=True)

# ── what each made ───────────────────────────────────────────────────────────
def save(name, x): np.ascontiguousarray(x, dtype=np.float32).tofile(os.path.join(out_dir, f"{name}.f32"))
def check(tool, op, **kv): print(json.dumps({"check": op, "tool": tool, **kv}), flush=True)
run = lambda tool, op: (tool, op) in keys and CELLS[(tool, op)][1]()
pre = {"librosa": "lr", "pedalboard": "pb"}

for tool in pre:
    p = pre[tool]
    if (d := run(tool, "wav_decode")) is not False: save(f"{p}_wav_decode", d[0, :sr * 10]); check(tool, "wav_decode", frames=d.shape[1])
    if (d := run(tool, "mp3_decode")) is not False: save(f"{p}_mp3_decode", d[0, :sr * 30]); check(tool, "mp3_decode", frames=d.shape[1])
    if (d := run(tool, "resample")) is not False: save(f"{p}_resample", d[0, :48000 * 10]); check(tool, "resample", frames=d.shape[1])
    if (d := run(tool, "stretch")) is not False: check(tool, "stretch", frames=d.shape[1])
    if (d := run(tool, "pitch")) is not False: save(f"{p}_pitch", d[0, :sr * 20]); check(tool, "pitch", frames=d.shape[1])
if not only or "resample" in only:             # the reference the resamplers are measured against: soxr at its best
    save("lr_resample_ref", soxr.resample(y[0, :sr * 12], sr, 48000, quality='VHQ')[:48000 * 10])
if (d := run("librosa", "fft")) is not False: save("lr_fft", np.abs(d[:, 1000:1003]).T); check("librosa", "fft", frames=d.shape[1], bins=d.shape[0])
if (d := run("librosa", "mfcc")) is not False: save("lr_mfcc", d[1]); check("librosa", "mfcc", frames=d.shape[1])
if (d := run("librosa", "beat")) is not False:
    tempo, frames = d
    check("librosa", "beat", bpm=float(np.atleast_1d(tempo)[0]), beats=librosa.frames_to_time(frames, sr=sr).tolist())
