"""The restorer: one pass over the STFT, from a degraded voice's spectrum to a clean one's.

Between torch's STFT and iSTFT (dsp.py) a ConvNeXt stack over frames (Vocos's backbone: Siuzdak, ICLR 2024)
with a few self-attention layers in it for a room's long memory, reading each frame's log magnitude and phase
and writing a change of log magnitude (so it attenuates what is noise and raises what is missing, both
unbounded) and a new phase as a unit vector. `Net.spec(X) → Y` is the whole network on complex (B, F, T);
`Net(x) → y` wraps it in the STFT for training; `Graph` is the ONNX view, re and im as channels.

Discriminators for the adversarial phase: HiFi-GAN's multi-period (Kong et al., 2020) and a multi-resolution
spectrogram discriminator (UnivNet, Jang et al., 2021), each returning logits and feature maps.
"""
import math
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.nn.utils.parametrizations import weight_norm
from dsp import BINS, stft, istft, EPS

class Block(nn.Module):
    """ConvNeXt block over (B, T, C): depthwise conv 7, LayerNorm, MLP ×3, GELU, layer scale, residual."""
    def __init__(self, dim, mult=3, scale=1e-6):
        super().__init__()
        self.dw = nn.Conv1d(dim, dim, 7, padding=3, groups=dim)
        self.norm = nn.LayerNorm(dim, eps=1e-6)
        self.up, self.down = nn.Linear(dim, dim * mult), nn.Linear(dim * mult, dim)
        self.gamma = nn.Parameter(scale * torch.ones(dim))
    def forward(self, h):
        r = h
        h = self.dw(h.transpose(1, 2)).transpose(1, 2)
        h = self.down(F.gelu(self.up(self.norm(h))))
        return r + self.gamma * h

class Attn(nn.Module):
    """Self-attention over frames with rotary positions, pre-norm, residual; the room's whole tail in view."""
    def __init__(self, dim, heads=8, scale=1e-6):
        super().__init__()
        self.h, self.d = heads, dim // heads
        self.norm = nn.LayerNorm(dim, eps=1e-6)
        self.qkv, self.out = nn.Linear(dim, dim * 3, bias=False), nn.Linear(dim, dim)
        self.gamma = nn.Parameter(scale * torch.ones(dim))
    def rope(self, x):
        B, H, T, D = x.shape
        pos = torch.arange(T, device=x.device, dtype=torch.float32)
        inv = 1.0 / (10000 ** (torch.arange(0, D, 2, device=x.device, dtype=torch.float32) / D))
        ang = pos[:, None] * inv[None]
        c, s = ang.cos()[None, None], ang.sin()[None, None]
        x1, x2 = x[..., : D // 2], x[..., D // 2:]
        return torch.cat([x1 * c - x2 * s, x1 * s + x2 * c], -1)
    def forward(self, h):
        B, T, C = h.shape
        q, k, v = self.qkv(self.norm(h)).view(B, T, 3, self.h, self.d).permute(2, 0, 3, 1, 4)
        q, k = self.rope(q), self.rope(k)
        a = torch.softmax(q @ k.transpose(-1, -2) / math.sqrt(self.d), -1) @ v
        return h + self.gamma * self.out(a.transpose(1, 2).reshape(B, T, C))

class Net(nn.Module):
    def __init__(self, dim=512, blocks=8, attn=(3, 6), heads=8):
        super().__init__()
        self.inp = nn.Linear(3 * BINS, dim)
        self.norm = nn.LayerNorm(dim, eps=1e-6)
        layers = []
        for i in range(blocks):
            layers.append(Block(dim))
            if i + 1 in attn: layers.append(Attn(dim, heads))
        self.layers = nn.Sequential(*layers)
        self.final = nn.LayerNorm(dim, eps=1e-6)
        self.out = nn.Linear(dim, 3 * BINS)
        self.cfg = dict(dim=dim, blocks=blocks, attn=list(attn), heads=heads)

    def spec(self, X):
        """complex (B, F, T) → complex (B, F, T)"""
        return torch.complex(*self.parts(X.real, X.imag, torch.log(X.abs() + EPS)))

    def parts(self, re, im, logmag):
        mag = torch.sqrt(re * re + im * im) + EPS
        f = torch.cat([logmag, re / mag, im / mag], 1).transpose(1, 2)   # (B, T, 3F)
        h = self.final(self.layers(self.norm(self.inp(f))))
        d, px, py = self.out(h).transpose(1, 2).chunk(3, 1)
        m = torch.exp((logmag + d).clamp(max=6.0))
        n = torch.sqrt(px * px + py * py) + EPS
        return m * px / n, m * py / n

    def forward(self, x):
        return istft(self.spec(stft(x)), x.shape[-1])

class Graph(nn.Module):
    """ONNX contract, as @audio/neural-separate's 'complex' models: in (1, 2, F, T) re/im, out the same."""
    def __init__(self, net): super().__init__(); self.net = net
    def forward(self, spec):
        re, im = spec[:, 0], spec[:, 1]
        return torch.stack(self.net.parts(re, im, 0.5 * torch.log(re * re + im * im + EPS * EPS)), 1)

# ---------------------------------------------------------------- discriminators

class Period(nn.Module):
    def __init__(self, p, ch=(32, 128, 512, 1024)):
        super().__init__()
        self.p = p; c = 1; layers = []
        for i, o in enumerate(ch):
            layers.append(weight_norm(nn.Conv2d(c, o, (5, 1), (3, 1), (2, 0)))); c = o
        layers.append(weight_norm(nn.Conv2d(c, 1024, (5, 1), 1, (2, 0))))
        self.layers = nn.ModuleList(layers)
        self.post = weight_norm(nn.Conv2d(1024, 1, (3, 1), 1, (1, 0)))
    def forward(self, x):
        B, N = x.shape
        if N % self.p: x = F.pad(x, (0, self.p - N % self.p), 'reflect')
        h = x.view(B, 1, -1, self.p); fm = []
        for l in self.layers: h = F.leaky_relu(l(h), 0.1); fm.append(h)
        h = self.post(h); fm.append(h)
        return h.flatten(1), fm

class Resolution(nn.Module):
    def __init__(self, n_fft, hop, ch=32):
        super().__init__()
        self.n_fft, self.hop = n_fft, hop
        k, s, p = (3, 9), (1, 2), (1, 4)
        self.layers = nn.ModuleList([weight_norm(nn.Conv2d(1, ch, k, 1, p)), weight_norm(nn.Conv2d(ch, ch, k, s, p)),
                                     weight_norm(nn.Conv2d(ch, ch, k, s, p)), weight_norm(nn.Conv2d(ch, ch, k, s, p)),
                                     weight_norm(nn.Conv2d(ch, ch, (3, 3), 1, (1, 1)))])
        self.post = weight_norm(nn.Conv2d(ch, 1, (3, 3), 1, (1, 1)))
    def forward(self, x):
        w = torch.hann_window(self.n_fft, device=x.device)
        S = torch.stft(x, self.n_fft, self.hop, self.n_fft, w, center=True, return_complex=True).abs()
        h = torch.log(S + 1e-5)[:, None]; fm = []
        for l in self.layers: h = F.leaky_relu(l(h), 0.1); fm.append(h)
        h = self.post(h); fm.append(h)
        return h.flatten(1), fm

class Discriminators(nn.Module):
    def __init__(self, periods=(2, 3, 5, 7, 11), resolutions=((512, 128), (1024, 256), (2048, 512))):
        super().__init__()
        self.d = nn.ModuleList([Period(p) for p in periods] + [Resolution(n, h) for n, h in resolutions])
    def forward(self, x):
        out = [d(x) for d in self.d]
        return [o[0] for o in out], [o[1] for o in out]

def params(m): return sum(p.numel() for p in m.parameters())
