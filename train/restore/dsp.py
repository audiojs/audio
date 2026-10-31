"""Shared signal parts: the STFT the model lives between, levels, band limits, mel, resampling.

Everything is torch, batched, device-agnostic. Tensors are (B, N) waveforms unless said.
"""
import math
import torch
import torch.nn.functional as F
import torchaudio.functional as AF

SR = 48000            # the model's rate: everything in and out at 48 kHz
N_FFT, HOP = 2048, 512  # 1025 bins of 23.4 Hz, 93.75 frames a second
BINS = N_FFT // 2 + 1
LEVEL = -20.0         # dBFS RMS the model hears its input at
EPS = 1e-5

_win = {}
def window(device):
    if device not in _win: _win[device] = torch.hann_window(N_FFT, device=device)
    return _win[device]

def stft(x):
    """(B, N) → complex (B, F, T), centered, reflect-padded: torch's convention, which the JS side mirrors."""
    return torch.stft(x, N_FFT, HOP, N_FFT, window(x.device), center=True, pad_mode='reflect', return_complex=True)

def istft(X, length):
    return torch.istft(X, N_FFT, HOP, N_FFT, window(X.device), center=True, length=length)

def rms_db(x):
    return 10 * torch.log10(x.pow(2).mean(-1) + 1e-12)

def to_level(x, db=LEVEL):
    """x scaled to `db` dBFS RMS; returns (y, gain) so the result can be undone."""
    g = 10 ** ((db - rms_db(x)) / 20)
    return x * g[..., None], g

def band(x, hz):
    """x low-passed at `hz` (B,) with a 1/6-octave raised-cosine edge, zero-phase (FFT over the whole segment).
    hz ≥ SR/2 leaves x as it is. Both target and estimate pass through it: a target recorded at 24 kHz holds
    nothing above 12 kHz, so what the model invents there must be kept out of every loss."""
    n = x.shape[-1]
    X = torch.fft.rfft(x, dim=-1)
    f = torch.fft.rfftfreq(n, 1 / SR, device=x.device)
    lo, hi = hz[:, None] * 2 ** (-1 / 12), hz[:, None] * 2 ** (1 / 12)
    m = ((hi - f) / (hi - lo)).clamp(0, 1)
    m = 0.5 - 0.5 * torch.cos(math.pi * m)
    m = torch.where(hz[:, None] >= SR / 2, torch.ones_like(m), m)
    return torch.fft.irfft(X * m, n, dim=-1)

def bandwidth(x, sr=SR, floor_db=55.0):
    """The highest frequency a recording carries, Hz: where the long-term spectrum has fallen `floor_db` under
    its 1–4 kHz level and stays there. Reads a 24 kHz file as ≤ 12 kHz and a band-limited 48 kHz one as its edge."""
    x = x.reshape(-1)
    n = 4096
    if len(x) < n: return sr / 2
    frames = x[: len(x) // n * n].reshape(-1, n) * torch.hann_window(n)
    psd = torch.fft.rfft(frames).abs().pow(2).mean(0)
    db = 10 * torch.log10(psd + 1e-20)
    f = torch.fft.rfftfreq(n, 1 / sr)
    ref = db[(f >= 1000) & (f <= 4000)].mean()
    k = 12  # bins smoothed, 140 Hz at 48 kHz
    sm = F.avg_pool1d(db[None, None], k, 1, k // 2)[0, 0, : len(db)]
    below = (sm < ref - floor_db).int().flip(0).cumprod(0).flip(0).bool()  # true from the edge to the top
    idx = below.nonzero()
    return float(f[idx[0, 0]]) if len(idx) else sr / 2

_mel = {}
def mel(x, n_mels=128):
    """log mel power of (B, N) at 48 kHz, (B, n_mels, T)."""
    key = (n_mels, x.device)
    if key not in _mel:
        _mel[key] = AF.melscale_fbanks(BINS, 0, SR / 2, n_mels, SR, norm='slaney', mel_scale='slaney').to(x.device)
    S = stft(x).abs().pow(2)
    return torch.log(torch.matmul(S.transpose(1, 2), _mel[key]).transpose(1, 2) + EPS)

def resample(x, sr, to=SR):
    if sr == to: return x
    return AF.resample(x, sr, to, lowpass_filter_width=64, rolloff=0.9475937167399596, resampling_method='sinc_interp_kaiser', beta=14.769656459379492)

def fade(n, device):
    return 0.5 - 0.5 * torch.cos(math.pi * torch.arange(n, device=device) / n)
