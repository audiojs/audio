"""The trained net as ONNX, between the STFT and the iSTFT the JS side computes.

    python export.py runs/a/net-0400000.pt --out ~/.cache/audiojs/neural/restore [--fp16] [--verify]

  input   spec  [1, 2, 1025, T]   STFT of one channel at 48 kHz (n_fft 2048, hop 512, Hann, centered, reflect), re and im
  output  spec  [1, 2, 1025, T]   the restored STFT
The frame axis is dynamic; the model hears its input at −20 dBFS RMS (dsp.to_level), the JS side undoes the gain.
--fp16 writes a second file with float16 weights (half the download; computed in float32 by onnxruntime's
WebGPU as neural-separate's mel-roformer is). --verify runs onnxruntime on a random segment against torch.
"""
import argparse, os
import numpy as np
import torch
from model import Net, Graph, params
from dsp import BINS

def load(path, dev='cpu'):
    ck = torch.load(path, map_location=dev)
    net = Net(**ck['cfg']); net.load_state_dict(ck['net']); return net.eval()

def main():
    a = argparse.ArgumentParser()
    a.add_argument('ckpt'); a.add_argument('--out', default=os.path.join(os.environ.get('AUDIO_NEURAL_CACHE') or os.path.expanduser('~/.cache/audiojs/neural'), 'restore'))
    a.add_argument('--fp16', action='store_true'); a.add_argument('--verify', action='store_true'); a.add_argument('--frames', type=int, default=376)
    o = a.parse_args()
    os.makedirs(o.out, exist_ok=True)
    net = load(o.ckpt); g = Graph(net).eval()
    print(f'{params(net) / 1e6:.2f}M parameters')
    x = torch.randn(1, 2, BINS, o.frames) * 0.01
    path = os.path.join(o.out, 'restore.onnx')
    torch.onnx.export(g, (x,), path, input_names=['spec'], output_names=['spec_out'], dynamic_axes={'spec': {3: 'T'}, 'spec_out': {3: 'T'}}, opset_version=17, dynamo=False)
    print('wrote', path, os.path.getsize(path) // 1024, 'KB')
    if o.fp16:
        import onnx
        from onnxconverter_common import float16
        m = float16.convert_float_to_float16(onnx.load(path), keep_io_types=True)
        p16 = os.path.join(o.out, 'restore.fp16.onnx'); onnx.save(m, p16); print('wrote', p16, os.path.getsize(p16) // 1024, 'KB')
    if o.verify:
        import onnxruntime as ort
        s = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
        for T in (o.frames, 97):
            x = torch.randn(1, 2, BINS, T) * 0.01
            with torch.no_grad(): ref = g(x).numpy()
            out = s.run(None, {'spec': x.numpy()})[0]
            err = np.abs(out - ref).max(); snr = 10 * np.log10((ref ** 2).sum() / ((out - ref) ** 2).sum())
            print(f'T={T}: max |Δ| {err:.2e}, {snr:.1f} dB from torch')

if __name__ == '__main__':
    main()
