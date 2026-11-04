"""The take as a bad recording makes it: a clean 48 kHz voice through a random chain, on the fly, per item.

Order is the physical one: the voice in a room, noise in the room, the microphone's colour and preamp, its
compressor and clipping, the channel's band limit and codec, the file's word length. Each stage draws its own
chance and strength from the ranges below; `Chain(bank).__call__(clean) → degraded`, same length and about the
same level. CPU torch on (N,) tensors, cheap enough for data-loader workers; codecs through ffmpeg.
"""
import math, os, random, shutil, subprocess, tempfile
import torch
import torch.nn.functional as F
import torchaudio.functional as AF
from dsp import SR, band, resample

FFMPEG = shutil.which('ffmpeg')
CODECS = [  # (name, args, container, bitrates kb/s): codecs a voice reaches us through
    ('mp3', ['-c:a', 'libmp3lame'], 'mp3', (24, 32, 48, 64, 96, 128)),
    ('aac', ['-c:a', 'aac'], 'm4a', (24, 32, 48, 64, 96)),
    ('opus', ['-c:a', 'libopus', '-application', 'voip'], 'ogg', (8, 12, 16, 24, 32, 48)),
    ('gsm', ['-c:a', 'libgsm', '-ar', '8000'], 'gsm', (13,)),
]

def u(a, b): return random.uniform(a, b)
def lu(a, b): return math.exp(u(math.log(a), math.log(b)))
def chance(p): return random.random() < p

def db(x): return 10 ** (x / 20)
def power(x): return x.pow(2).mean() + 1e-12

def spectral(x, curve_db):
    """x through a zero-phase filter whose log-magnitude is `curve_db` over rfftfreq(n)."""
    X = torch.fft.rfft(x)
    return torch.fft.irfft(X * db(curve_db), len(x))

def freqs(n): return torch.fft.rfftfreq(n, 1 / SR)

# ---------------------------------------------------------------- stages

def mic(x):
    """A cheap microphone and its placement: tilt, two or three resonances and dips, a low cut; ±12 dB at most."""
    f = freqs(len(x)); lf = torch.log2(f.clamp(min=20) / 1000)
    c = u(-4, 4) * lf                                   # dB per octave about 1 kHz
    for _ in range(random.randint(1, 3)):
        fc, q, g = lu(150, 12000), lu(0.5, 4), u(-12, 9)
        c = c + g * torch.exp(-((torch.log2(f.clamp(min=1) / fc)) * q) ** 2)
    hp = lu(40, 300)                                    # proximity's absence, a windscreen, a phone
    c = c + 12 * torch.log10(1 / (1 + (hp / f.clamp(min=1)) ** 4))
    c = c - c[(f > 300) & (f < 3000)].mean()            # the voice band's level kept
    return spectral(x, c.clamp(-30, 12))

def synth_rir(t60=None):
    """A room without a measurement: exponentially decaying Gaussian noise with a sparser first 20 ms and a
    direct path `drr` dB over the tail; T60 0.15–2.5 s."""
    t60 = t60 or lu(0.15, 2.5)
    n = int(min(t60 * 1.2, 3.0) * SR)
    t = torch.arange(n) / SR
    h = torch.randn(n) * torch.exp(-6.908 * t / t60)
    early = int(0.02 * SR)
    h[:early] *= (torch.rand(early) < u(0.02, 0.2)).float() * 3
    h[0] = 0
    drr = u(-6, 12)
    h = h * (h[1:].pow(2).sum() + 1e-9).rsqrt() * db(-drr)
    h[0] = 1.0
    if chance(0.5):  # air and walls take the top
        h = spectral(h, (-u(2, 10)) * torch.log2(freqs(n).clamp(min=1000) / 1000))
    return h

def room(x, h):
    """x in the room h, the direct path's level kept: y scaled so its energy equals x's."""
    n = len(x) + len(h) - 1
    y = torch.fft.irfft(torch.fft.rfft(x, n) * torch.fft.rfft(h, n), n)[: len(x)]
    return y * (power(x) / power(y)).sqrt()

def synth_noise(n):
    """Coloured noise at a random slope, sometimes with mains hum and its harmonics."""
    f = freqs(n)
    y = spectral(torch.randn(n), -u(0, 12) * torch.log2(f.clamp(min=20) / 20))
    if chance(0.3):
        t = torch.arange(n) / SR; f0 = random.choice((50, 60))
        for k in range(1, random.randint(2, 12)): y = y + torch.sin(2 * math.pi * f0 * k * t + u(0, 6.3)) * db(-u(0, 30)) / k
    return y

def noise(x, z, snr):
    z = z * (power(x) / power(z) / db(snr) ** 2).sqrt()
    return x + z

def compress(x, ratio, thresh_db, attack=0.005, release=0.1):
    """A preamp's or a phone's compressor: gain from a one-pole-smoothed envelope, over `thresh_db` reduced by ratio."""
    env = x.abs()
    a, r = math.exp(-1 / (attack * SR)), math.exp(-1 / (release * SR))
    one = lambda c: AF.lfilter(env[None], torch.tensor([1.0, -c]), torch.tensor([1 - c, 0.0]), clamp=False)[0]
    e = torch.maximum(one(r), one(a))
    edb = 20 * torch.log10(e + 1e-6)
    over = (edb - thresh_db).clamp(min=0)
    g = db(-over * (1 - 1 / ratio))
    y = x * g
    return y * (power(x) / power(y)).sqrt()

def clip(x):
    peak = x.abs().max() + 1e-9
    th = peak * u(0.15, 0.7)
    if chance(0.5): return x.clamp(-th, th)
    return torch.tanh(x / th) * th

def bandlimit(x, hz):
    return band(x[None], torch.tensor([hz]))[0]

def codec(x):
    """x through a real codec at a low bitrate: the file written, encoded, decoded back to 48 kHz by ffmpeg."""
    name, args, ext, rates = random.choice(CODECS)
    kb = random.choice(rates)
    with tempfile.TemporaryDirectory() as d:
        src, enc = os.path.join(d, 'in.wav'), os.path.join(d, 'enc.' + ext)
        import soundfile as sf
        sf.write(src, x.numpy(), SR, subtype='FLOAT')
        q = ['-loglevel', 'error', '-y']
        if subprocess.run([FFMPEG, *q, '-i', src, *args, '-b:a', f'{kb}k', enc]).returncode: return x
        out = subprocess.run([FFMPEG, *q, '-i', enc, '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True)
        if out.returncode: return x
        y = torch.frombuffer(bytearray(out.stdout), dtype=torch.float32)
    # the codec's delay: the lag, under half a second, where y best meets x (cross-correlation by FFT)
    k = min(len(x), len(y), SR * 2)
    c = torch.fft.irfft(torch.fft.rfft(y[:k], 2 * k) * torch.fft.rfft(x[:k], 2 * k).conj(), 2 * k)[: SR // 2]
    lag = int(c.argmax())
    y = y[lag: lag + len(x)]
    return F.pad(y, (0, len(x) - len(y))) if len(y) < len(x) else y

def quantize(x):
    bits = random.choice((8, 12, 16))
    q = 2 ** (bits - 1)
    return torch.round(x * q + (torch.rand_like(x) - 0.5)) / q

# ---------------------------------------------------------------- the chain

class Chain:
    """P: the chance of each stage; `rirs`, `noises`: lists of (N,) tensors at 48 kHz, or empty for synthetic."""
    P = dict(mic=0.7, room=0.6, noise=0.8, compress=0.3, clip=0.2, bandlimit=0.6, codec=0.3 if FFMPEG else 0, quantize=0.3)

    def __init__(self, rirs=(), noises=(), p=None):
        self.rirs, self.noises = list(rirs), list(noises)
        self.p = {**self.P, **(p or {})}

    def pick(self, bank, n):
        z = random.choice(bank)
        if len(z) < n: z = z.repeat(n // len(z) + 1)
        at = random.randint(0, len(z) - n)
        return z[at: at + n]

    def __call__(self, x):
        p = self.p
        y = x
        if chance(p['room']):
            h = random.choice(self.rirs) if self.rirs and chance(0.7) else synth_rir()
            y = room(y, h)
        if chance(p['noise']):
            z = self.pick(self.noises, len(y)) if self.noises and chance(0.85) else synth_noise(len(y))
            y = noise(y, z, u(-5, 35))
        if chance(p['mic']): y = mic(y)
        if chance(p['compress']): y = compress(y, lu(2, 10), u(-35, -15))
        if chance(p['clip']): y = clip(y)
        if chance(p['bandlimit']): y = bandlimit(y, lu(2000, 20000))
        if chance(p['codec']): y = codec(y)
        if chance(p['quantize']): y = quantize(y)
        return y
