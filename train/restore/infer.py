"""Restore files with a checkpoint or the ONNX export.

    python infer.py MODEL IN.wav [IN2.wav ...] --out DIR        MODEL: net-*.pt or restore.onnx

Each channel apart: resampled to 48 kHz, brought to −20 dBFS RMS, run in 10 s chunks overlapping by 1 s
(raised-cosine crossfade), the gain undone, resampled back to the input's rate, written as float WAV.
"""
import argparse, os
import numpy as np
import soundfile as sf
import torch
from dsp import SR, stft, istft, to_level, resample, fade

CHUNK, OVERLAP = 10 * SR, SR

class Model:
    def __init__(self, path, dev):
        self.dev = dev
        if path.endswith('.onnx'):
            import onnxruntime as ort
            self.s = ort.InferenceSession(path, providers=['CUDAExecutionProvider', 'CoreMLExecutionProvider', 'CPUExecutionProvider'])
            self.net = None
        else:
            from export import load
            self.net = load(path, dev).to(dev)
    def __call__(self, x):
        X = stft(x[None].to(self.dev))
        if self.net:
            with torch.no_grad(): Y = self.net.spec(X)
        else:
            spec = torch.stack([X.real, X.imag], 1).cpu().numpy()
            o = self.s.run(None, {'spec': spec})[0]
            Y = torch.complex(torch.from_numpy(o[:, 0]), torch.from_numpy(o[:, 1])).to(self.dev)
        return istft(Y, x.shape[-1])[0].cpu()

def restore(model, x):
    xin, g = to_level(x[None]); xin = xin[0]
    n = len(xin)
    if n <= CHUNK: return model(xin) / g
    y, w = torch.zeros(n), torch.zeros(n)
    step = CHUNK - OVERLAP; f = fade(OVERLAP, 'cpu')
    for at in range(0, n, step):
        seg = xin[at: at + CHUNK]; out = model(seg); win = torch.ones(len(seg))
        if at > 0: win[:OVERLAP] = f[: len(seg)]
        if at + CHUNK < n: win[-OVERLAP:] = 1 - f
        y[at: at + len(seg)] += out * win; w[at: at + len(seg)] += win
        if at + CHUNK >= n: break
    return y / w.clamp(min=1e-6) / g

def main():
    a = argparse.ArgumentParser(); a.add_argument('model'); a.add_argument('files', nargs='+'); a.add_argument('--out', required=True); a.add_argument('--device', default='cuda' if torch.cuda.is_available() else 'cpu')
    o = a.parse_args(); os.makedirs(o.out, exist_ok=True)
    m = Model(o.model, torch.device(o.device))
    for p in o.files:
        x, sr = sf.read(p, dtype='float32', always_2d=True)
        chans = []
        for c in range(x.shape[1]):
            v = resample(torch.from_numpy(x[:, c]), sr)
            v = restore(m, v)
            chans.append(resample(v, SR, sr)[: len(x)].numpy())
        y = np.stack(chans, 1)
        if len(y) < len(x): y = np.pad(y, ((0, len(x) - len(y)), (0, 0)))
        sf.write(os.path.join(o.out, os.path.basename(p)), y, sr, subtype='FLOAT'); print(p)

if __name__ == '__main__':
    main()
