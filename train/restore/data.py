"""Clean voices, rooms and noises on disk → training pairs.

    python data.py scan OUT.json DIR [DIR...] [--kind speech|sing] [--lang en|ru|..]
        every audio file under the DIRs: its rate, length and the bandwidth it carries (dsp.bandwidth), one
        manifest; a corpus at 16 or 24 kHz is kept, its band edge recorded, so the losses stop at it (dsp.band)
    python data.py pairs OUT_DIR N --clean A.json[,B.json] [--rirs DIR] [--noises DIR] [--seg 4]
        N training pairs as the trainer would draw them, <k>-in.wav and <k>-ref.wav: listen before training

Pairs(manifests, rirs, noises, seg) draws a crop of `seg` seconds from a random file (by length), at 48 kHz mono,
at a random level, through degrade.Chain, and yields (degraded, clean, bandwidth_hz). An IterableDataset: each
worker seeds itself. Bank(dir) holds every file of a directory in memory at 48 kHz (rooms: aligned to the direct
peak, 2.5 s at most, unit energy).
"""
import glob, json, os, random, sys
import numpy as np
import soundfile as sf
import torch
from torch.utils.data import IterableDataset, get_worker_info
from dsp import SR, bandwidth, resample, rms_db
from degrade import Chain

EXT = ('.wav', '.flac', '.ogg', '.mp3', '.opus')

def files(d):
    return sorted(p for p in glob.glob(os.path.join(d, '**', '*'), recursive=True) if p.lower().endswith(EXT))

def read(path, start=0, frames=-1):
    x, sr = sf.read(path, start=start, frames=frames, dtype='float32', always_2d=True)
    return torch.from_numpy(x.mean(1)), sr

def scan(out, dirs, kind='speech', lang='en'):
    items = json.load(open(out)) if os.path.exists(out) else []
    seen = {i['path'] for i in items}
    for d in dirs:
        for p in files(d):
            if p in seen: continue
            try:
                info = sf.info(p)
                x, sr = read(p, frames=min(info.frames, info.samplerate * 30))
            except Exception as e:
                print('skip', p, e, file=sys.stderr); continue
            bw = bandwidth(resample(x, sr), SR) if sr != SR else bandwidth(x, SR)
            items.append(dict(path=p, sr=sr, frames=info.frames, bw=round(bw), kind=kind, lang=lang))
            print(len(items), p, sr, round(info.frames / sr, 1), 's', round(bw), 'Hz', file=sys.stderr)
            if len(items) % 200 == 0: json.dump(items, open(out, 'w'))
    json.dump(items, open(out, 'w'))
    return items

class Bank:
    def __init__(self, d, rir=False, limit=None):
        self.items = []
        for p in files(d)[:limit] if d else []:
            x, sr = read(p)
            x = resample(x, sr)
            if rir:
                k = int(x.abs().argmax()); x = x[max(0, k - int(0.002 * SR)): k + int(2.5 * SR)]
                x = x / (x.pow(2).sum().sqrt() + 1e-9)
            if len(x) > SR // 10: self.items.append(x)

class Pairs(IterableDataset):
    def __init__(self, manifests, rirs=(), noises=(), seg=4.0, p=None, level=(-35, -12), seed=0):
        self.items = [i for m in manifests for i in json.load(open(m)) if i['frames'] >= i['sr'] * 0.5]
        self.w = np.array([i['frames'] / i['sr'] for i in self.items]); self.w /= self.w.sum()
        self.chain = Chain(rirs, noises, p)
        self.n, self.level, self.seed = int(seg * SR), level, seed

    def crop(self):
        while True:
            i = self.items[np.random.choice(len(self.items), p=self.w)]
            n = int(self.n * i['sr'] / SR) + 1
            start = random.randint(0, max(0, i['frames'] - n))
            try: x, sr = read(i['path'], start, min(n, i['frames'] - start))
            except Exception: continue
            x = resample(x, sr)
            if len(x) < self.n: x = torch.nn.functional.pad(x, (0, self.n - len(x)))
            x = x[: self.n]
            if rms_db(x) > -45: return x, float(min(i['bw'], sr / 2))

    def __iter__(self):
        w = get_worker_info()
        s = self.seed + (w.id if w else 0) + 1000 * int.from_bytes(os.urandom(2), 'little')
        random.seed(s); np.random.seed(s % 2 ** 32); torch.manual_seed(s)
        while True:
            x, bw = self.crop()
            x = x * 10 ** ((random.uniform(*self.level) - float(rms_db(x))) / 20)
            y = self.chain(x)
            peak = y.abs().max()
            if peak > 0.99: x, y = x * 0.99 / peak, y * 0.99 / peak
            yield y, x, torch.tensor(bw)

if __name__ == '__main__':
    import argparse
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('cmd', choices=['scan', 'pairs']); a.add_argument('out'); a.add_argument('dirs', nargs='*')
    a.add_argument('--kind', default='speech', choices=['speech', 'sing']); a.add_argument('--lang', default='en')
    a.add_argument('--clean'); a.add_argument('--rirs'); a.add_argument('--noises'); a.add_argument('--seg', type=float, default=4.0)
    o = a.parse_args()
    if o.cmd == 'scan':
        scan(o.out, o.dirs, o.kind, o.lang)
    else:
        n = int(o.dirs[0]) if o.dirs else 10
        pairs = Pairs(o.clean.split(','), Bank(o.rirs, rir=True).items if o.rirs else (), Bank(o.noises).items if o.noises else (), o.seg)
        os.makedirs(o.out, exist_ok=True)
        for k, (y, x, bw) in zip(range(n), pairs):
            sf.write(os.path.join(o.out, f'{k}-in.wav'), y.numpy(), SR, subtype='FLOAT')
            sf.write(os.path.join(o.out, f'{k}-ref.wav'), x.numpy(), SR, subtype='FLOAT')
            print(k, f'bandwidth {int(bw)} Hz')
