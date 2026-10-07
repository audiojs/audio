# Scores for bench/rx/separate.mjs: BSSEval v4 (museval 0.4.1; Stöter, Liutkus, Ito, "The 2018 Signal Separation
# Evaluation Campaign", LVA/ICA 2018: SiSEC 2018's metric) of each estimated stem against MUSDB18's own, per track.
#   python bench/rx/separate.py score < JOBS.json    [{"mp4": "<track>.stem.mp4", "est": {"vocals": "a.wav", ...}}, ...]
# Each job gives back, per stem estimated, the median over the track's 1 s frames (museval's win = hop = 44100, the
# frames with a silent reference or estimate left out, as museval leaves them) of SDR, ISR, SIR and SAR, dB: SiSEC
# 2018's per-track aggregation; the tables take the median of these over tracks. In museval's images mode (v4) the SDR
# of a frame is the reference's energy over that of the estimate's difference from it, no filter allowed (metrics.py,
# _bss_decomp_mtifilt: the four errors sum to estimate - reference). References: the .stem.mp4's streams decoded by
# ffmpeg as bench/rx/separate.mjs decodes the mixture (stream 1 drums, 2 bass, 3 other, 4 vocals; float, 44.1 kHz).
import os, sys, json, subprocess, numpy as np, soundfile as sf, museval
from multiprocessing import Pool

STREAM = {'drums': 1, 'bass': 2, 'other': 3, 'vocals': 4}

def decode(mp4, k):
    b = subprocess.run(['ffmpeg', '-v', 'error', '-i', mp4, '-map', f'0:a:{k}', '-f', 'f32le', '-ac', '2', '-ar', '44100', '-'],
                       capture_output=True, check=True).stdout
    return np.frombuffer(b, np.float32).reshape(-1, 2).astype(np.float64)

def score(job):
    names = list(job['est'])
    ref = np.stack([decode(job['mp4'], STREAM[s]) for s in names])
    est = []
    for s in names:
        y = sf.read(job['est'][s], dtype='float64', always_2d=True)[0]
        est.append(np.repeat(y, 2, axis=1) if y.shape[1] == 1 else y[:, :2])
    sdr, isr, sir, sar = museval.evaluate(ref, np.stack(est), win=44100, hop=44100)
    # JSON: no NaN or Infinity; a frame set all NaN is null, an infinite median 'inf' (one source alone: SIR)
    med = lambda v: None if np.all(np.isnan(v)) else (lambda m: m if np.isfinite(m) else ('inf' if m > 0 else '-inf'))(float(np.nanmedian(v)))
    return {s: {'SDR': med(sdr[i]), 'ISR': med(isr[i]), 'SIR': med(sir[i]), 'SAR': med(sar[i])} for i, s in enumerate(names)}

if __name__ == '__main__':
    if sys.argv[1] == 'score':
        jobs = json.load(sys.stdin)
        with Pool(int(os.environ.get('JOBS', 4))) as pool: print(json.dumps(pool.map(score, jobs)))
