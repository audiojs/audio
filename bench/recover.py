# Scores for bench/recover.mjs's outputs: PESQ (ITU-T P.862.2 wideband, python-pesq, at 16 kHz: it hears up to 8 kHz,
# so the 16k case's rebuilt band is past it) against the clean take, and DNSMOS P.835 (bench/speech.py's dnsmos(), at
# 16 kHz too), each output at the clean take's loudness. The mean over utterances, and against the input as it came,
# the mean difference with its 95 % interval. PESQ, an intrusive measure, takes any band added for a distortion and
# barely misses one taken away: on 26 training utterances cut to 8 kHz, recover()'s band added at −∞, −20, −12, −6
# and 0 dB scored 4.01, 3.73, 3.32, 2.92, 2.47, falling with its level however close its spectrum comes; it cannot rank
# a band rebuilt, only show what each method does under the edge (the 16k case: PESQ hears to 8 kHz).
#   python bench/recover.py [CASE...] [--every N]
import os, sys, numpy as np, soundfile as sf
from multiprocessing import Pool
from scipy.signal import resample_poly
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from speech import dnsmos, lufs

DATA = os.path.expanduser('~/.cache/audiojs/data/vbdemand')
CLEAN, OUT = os.path.join(DATA, 'clean_testset_wav'), os.path.join(DATA, 'out-recover')
SYSTEMS = ['input', 'sbr', 'recover']

def score(job):
    from pesq import pesq
    case, system, name = job
    r, fs = sf.read(os.path.join(CLEAN, name), dtype='float64')
    e, _ = sf.read(os.path.join(OUT, case, system, name), dtype='float64')
    e = e[:len(r)] if len(e) >= len(r) else np.pad(e, (0, len(r) - len(e)))
    g = 10 ** ((lufs(r, fs) - lufs(e, fs)) / 20)
    sig, bak, ovr = dnsmos(e * g, fs)
    return dict(pesq=pesq(16000, resample_poly(r, 1, 3), resample_poly(e, 1, 3), 'wb'), sig=sig, bak=bak, ovrl=ovr)

if __name__ == '__main__':
    args = sys.argv[1:]
    every = int(args[args.index('--every') + 1]) if '--every' in args else 1
    cases = [a for a in args if a in ('8k', '16k')] or ['8k', '16k']
    names = sorted(f for f in os.listdir(CLEAN) if f.endswith('.wav'))[::every]
    with Pool(6) as pool:
        for case in cases:
            rows = {s: pool.map(score, [(case, s, n) for n in names], chunksize=4) for s in SYSTEMS}
            print(f'{case}: {len(names)} utterances')
            for s in SYSTEMS:
                line = f'  {s:8s} ' + ' '.join(f'{k} {np.mean([r[k] for r in rows[s]]):.3f}' for k in ('pesq', 'sig', 'bak', 'ovrl'))
                if s != 'input':
                    d = lambda k: np.array([a[k] - b[k] for a, b in zip(rows[s], rows['input'])])
                    line += '  Δ ' + ' '.join(f'{k} {d(k).mean():+.3f}±{1.96 * d(k).std(ddof=1) / np.sqrt(len(names)):.3f}' for k in ('pesq', 'ovrl'))
                print(line, flush=True)
