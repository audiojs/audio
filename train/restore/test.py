"""Smoke test on synthetic voices, CPU: the chain degrades, the net trains a few steps, exports to ONNX and
matches torch. python test.py [--steps 6]"""
import os, sys, json, subprocess, tempfile, math
import numpy as np, soundfile as sf, torch
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from dsp import SR, bandwidth, band, stft, istft, to_level
from degrade import Chain, synth_rir, codec, FFMPEG
from model import Net, Graph, Discriminators, params
import loss as L

def voice(sec, f0=140.0, bw=None, sr=SR):
    """a sung vowel: harmonics under a formant envelope, vibrato, breath noise; low-passed at bw"""
    t = torch.arange(int(sec * sr)) / sr
    f = f0 * (1 + 0.02 * torch.sin(2 * math.pi * 5.5 * t))
    ph = 2 * math.pi * torch.cumsum(f, 0) / sr
    x = sum(torch.sin(k * ph) * math.exp(-k / 12) * (1 + 0.5 * math.cos(k * 0.7)) for k in range(1, 120))
    x = x + 0.01 * torch.randn(len(t)); x = x * (0.5 - 0.5 * torch.cos(2 * math.pi * t / sec))
    if bw: x = band(x[None], torch.tensor([bw]))[0]
    return x / x.abs().max() * 0.3

steps = int(sys.argv[sys.argv.index('--steps') + 1]) if '--steps' in sys.argv else 6
torch.manual_seed(0)
with tempfile.TemporaryDirectory() as d:
    # data: a few files at 48 and 24 kHz
    os.makedirs(f'{d}/clean'); os.makedirs(f'{d}/rir'); os.makedirs(f'{d}/noise')
    for i in range(4):
        sf.write(f'{d}/clean/a{i}.wav', voice(5, 110 + 40 * i).numpy(), SR, subtype='FLOAT')
        sf.write(f'{d}/clean/b{i}.wav', voice(5, 200 + 30 * i, sr=24000).numpy(), 24000, subtype='FLOAT')
    sf.write(f'{d}/rir/r.wav', synth_rir(0.8).numpy(), SR, subtype='FLOAT')
    sf.write(f'{d}/noise/n.wav', (torch.randn(SR * 3) * 0.05).numpy(), SR, subtype='FLOAT')
    x24, _ = sf.read(f'{d}/clean/b0.wav'); bw24 = bandwidth(torch.from_numpy(x24).float(), 24000)
    assert bw24 <= 12000, bw24
    x48 = voice(3, 150); assert bandwidth(x48) > 15000, bandwidth(x48)
    x8 = voice(3, 150, bw=4000); assert 3000 < bandwidth(x8) < 5000, bandwidth(x8)
    print(f'bandwidth: 24 kHz file {bw24:.0f} Hz, 48 kHz voice {bandwidth(x48):.0f}, low-passed at 4 kHz {bandwidth(x8):.0f}')
    # degradation chain, every stage forced
    ch = Chain(p={k: 1.0 for k in Chain.P})
    y = ch(x48); assert y.shape == x48.shape and torch.isfinite(y).all()
    print(f'chain: {20 * math.log10((y - x48).pow(2).mean().sqrt() / x48.pow(2).mean().sqrt()):.1f} dB of change, codecs {"on" if FFMPEG else "off"}')
    if FFMPEG:
        import degrade
        every = list(degrade.CODECS)
        for c in every:  # one codec at a time; a build without an encoder passes the take through
            degrade.CODECS[:] = [c]
            z = codec(x48); assert z.shape == x48.shape and torch.isfinite(z).all()
            print(f'codec {c[0]}: {"changed the take" if not torch.equal(z, x48) else "unavailable, passed through"}')
        degrade.CODECS[:] = every
    # manifests and a training run
    subprocess.check_call([sys.executable, f'{HERE}/data.py', 'scan', f'{d}/clean.json', f'{d}/clean', '--kind', 'sing'], stderr=subprocess.DEVNULL)
    m = json.load(open(f'{d}/clean.json')); assert len(m) == 8 and any(i['sr'] == 24000 and i['bw'] <= 12000 for i in m)
    out = f'{d}/run'
    subprocess.check_call([sys.executable, f'{HERE}/train.py', '--out', out, '--clean', f'{d}/clean.json', '--rirs', f'{d}/rir', '--noises', f'{d}/noise',
                           '--dim', '64', '--blocks', '2', '--attn', '1', '--heads', '4', '--seg', '1', '--batch', '2', '--steps', str(steps), '--warmup', str(steps // 2),
                           '--every', str(steps), '--workers', '0', '--ssl', '0', '--val-batches', '1', '--device', 'cpu'])
    log = [json.loads(l) for l in open(f'{out}/log.jsonl')]
    assert any('val' in r for r in log), log
    assert os.path.exists(f'{out}/last.pt') and os.path.exists(f'{out}/samples')
    # resume
    subprocess.check_call([sys.executable, f'{HERE}/train.py', '--out', out, '--clean', f'{d}/clean.json', '--dim', '64', '--blocks', '2', '--attn', '1', '--heads', '4',
                           '--seg', '1', '--batch', '2', '--steps', str(steps + 2), '--warmup', '0', '--every', '1000', '--workers', '0', '--ssl', '0', '--val-batches', '1', '--device', 'cpu', '--resume'])
    # export and verify, then infer with both
    ck = sorted(f for f in os.listdir(out) if f.startswith('net-'))[-1]
    subprocess.check_call([sys.executable, f'{HERE}/export.py', f'{out}/{ck}', '--out', f'{d}/onnx', '--verify', '--frames', '50'])
    subprocess.check_call([sys.executable, f'{HERE}/infer.py', f'{out}/{ck}', f'{d}/clean/a0.wav', f'{d}/clean/b0.wav', '--out', f'{d}/pt', '--device', 'cpu'])
    subprocess.check_call([sys.executable, f'{HERE}/infer.py', f'{d}/onnx/restore.onnx', f'{d}/clean/a0.wav', '--out', f'{d}/onnx-out', '--device', 'cpu'])
    a, _ = sf.read(f'{d}/pt/a0.wav'); b, _ = sf.read(f'{d}/onnx-out/a0.wav'); o, _ = sf.read(f'{d}/clean/a0.wav')
    assert len(a) == len(o) and len(b) == len(o)
    snr = 10 * np.log10((a ** 2).sum() / ((a - b) ** 2).sum())
    print(f'infer: torch and onnx within {snr:.1f} dB; outputs {len(a)} samples as the input')
    # the long path: a 25 s file in chunks
    sf.write(f'{d}/clean/long.wav', voice(25, 130).numpy(), SR, subtype='FLOAT')
    subprocess.check_call([sys.executable, f'{HERE}/infer.py', f'{out}/{ck}', f'{d}/clean/long.wav', '--out', f'{d}/pt', '--device', 'cpu'])
    l, _ = sf.read(f'{d}/pt/long.wav'); assert len(l) == 25 * SR and np.isfinite(l).all()
    # the full-size net's cost
    net = Net(); print(f'full net {params(net) / 1e6:.1f}M parameters, discriminators {params(Discriminators()) / 1e6:.1f}M')
print('ok')
