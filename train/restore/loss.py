"""What the restorer is trained toward.

Regression: log-magnitude L1 and spectral convergence over four STFT resolutions, log-mel L1, and (where its
weights are present) the distance of WavLM's representations (FINALLY's finding, Babaev et al., NeurIPS 2024:
a speech model's features, not a waveform or spectrum distance, carry "studio" quality through adversarial
training). Adversarial: least-squares GAN (HiFi-GAN) over the discriminators' logits and L1 feature matching.

Every loss sees the estimate and the target through the same band limit (dsp.band at the target's bandwidth):
a target that stops at 12 kHz judges nothing above it.
"""
import torch
import torch.nn.functional as F
import torchaudio
from dsp import SR, mel, resample

RES = ((512, 128), (1024, 256), (2048, 512), (4096, 1024))

def mag(x, n_fft, hop):
    w = torch.hann_window(n_fft, device=x.device)
    return torch.stft(x, n_fft, hop, n_fft, w, center=True, return_complex=True).abs()

def mrstft(y, yh):
    """Σ over resolutions of L1(log|Y|, log|Ŷ|) + ‖|Y| − |Ŷ|‖_F / ‖|Y|‖_F"""
    loss = 0
    for n, h in RES:
        Y, Yh = mag(y, n, h), mag(yh, n, h)
        loss = loss + F.l1_loss(torch.log(Yh + 1e-5), torch.log(Y + 1e-5)) + (Y - Yh).norm() / (Y.norm() + 1e-5)
    return loss / len(RES)

def mel_l1(y, yh): return F.l1_loss(mel(yh), mel(y))

def fm(real, fake):
    return sum(F.l1_loss(f, r.detach()) for rs, fs in zip(real, fake) for r, f in zip(rs, fs)) / len(real)

def gan_g(fake): return sum(((1 - l) ** 2).mean() for l in fake) / len(fake)
def gan_d(real, fake): return sum(((1 - r) ** 2).mean() + (f ** 2).mean() for r, f in zip(real, fake)) / len(real)

class SSL:
    """L1 between WavLM Base+'s convolutional features and its layer `layer` on y and ŷ, at 16 kHz."""
    def __init__(self, device, layer=6):
        bundle = torchaudio.pipelines.WAVLM_BASE_PLUS
        self.m = bundle.get_model().to(device).eval()
        for p in self.m.parameters(): p.requires_grad_(False)
        self.layer = layer
    def feats(self, x):
        x = resample(x, SR, 16000)
        c, _ = self.m.feature_extractor(x, None)
        return c, self.m.encoder.extract_features(c, None, self.layer)[-1]
    def __call__(self, y, yh):
        with torch.no_grad(): c, t = self.feats(y)
        ch, th = self.feats(yh)
        return F.l1_loss(ch, c) + F.l1_loss(th, t)
