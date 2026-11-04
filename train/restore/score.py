"""Scores of restored files against their references: bench/speech.py's measures (PESQ, STOI, SI-SDR, DNSMOS)
and LSD at 48 kHz (the bandwidth measure), each file's by name, the mean last.

    python score.py --ref DIR --out DIR [--json OUT.json]
Needs bench/speech.py's dependencies (pesq pystoi onnxruntime pyloudnorm) and its DNSMOS model in the neural cache.
"""
import argparse, json, os, sys, importlib.util
import numpy as np, soundfile as sf
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('speech', os.path.join(HERE, '..', '..', 'bench', 'speech.py'))
speech = importlib.util.module_from_spec(spec); spec.loader.exec_module(speech)

def lsd(ref, out):
    n, h = 2048, 512
    def S(x):
        f = np.lib.stride_tricks.sliding_window_view(np.pad(x, n // 2), n)[::h] * np.hanning(n)
        return np.log10(np.abs(np.fft.rfft(f)) ** 2 + 1e-9)
    a, b = S(ref), S(out); m = min(len(a), len(b))
    return float(np.sqrt(((a[:m] - b[:m]) ** 2).mean(1)).mean())

def main():
    a = argparse.ArgumentParser(); a.add_argument('--ref', required=True); a.add_argument('--out', required=True); a.add_argument('--json')
    o = a.parse_args(); rows = {}
    for name in sorted(os.listdir(o.out)):
        if not name.endswith('.wav') or not os.path.exists(os.path.join(o.ref, name)): continue
        r, sr = sf.read(os.path.join(o.ref, name), dtype='float64', always_2d=True); y, sr2 = sf.read(os.path.join(o.out, name), dtype='float64', always_2d=True)
        r, y = r[:, 0], y[:, 0]
        if sr2 != sr: y = resample_poly(y, sr, sr2)
        m = min(len(r), len(y)); r, y = r[:m], y[:m]
        r16, y16 = speech.to16(r, sr), speech.to16(y, sr)
        from pesq import pesq; from pystoi import stoi
        row = dict(pesq=pesq(16000, r16, y16, 'wb'), stoi=stoi(r16, y16, 16000), sisdr=speech.sisdr(r16, y16), lsd=lsd(r, y))
        try: row['sig'], row['bak'], row['ovrl'] = speech.dnsmos(y, sr)
        except Exception as e: row['dnsmos_error'] = str(e)
        rows[name] = row; print(name, json.dumps({k: round(v, 3) for k, v in row.items() if isinstance(v, float)}))
    keys = [k for k in next(iter(rows.values())) if isinstance(rows[next(iter(rows))][k], float)] if rows else []
    mean = {k: float(np.mean([r[k] for r in rows.values() if k in r])) for k in keys}
    print('mean', json.dumps({k: round(v, 3) for k, v in mean.items()}))
    if o.json: json.dump(dict(files=rows, mean=mean), open(o.json, 'w'), indent=1)

if __name__ == '__main__':
    main()
