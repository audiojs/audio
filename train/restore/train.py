"""Train the restorer.

    python train.py --out runs/a --clean speech-en.json,speech-ru.json,sing.json [--rirs DIR] [--noises DIR]
        [--dim 512 --blocks 8] [--seg 4] [--batch 16] [--steps 400000] [--warmup 30000] [--ssl 1] [--resume]

Two phases in one run. To `warmup`: regression alone (mrstft, mel, ssl). After: the discriminators join
(adversarial, feature matching), the regression terms kept (HiFi-GAN's weights: mel 45, fm 2, adv 1). Both
nets AdamW (0.8, 0.99), lr 2e-4 decayed ×0.999 every 1000 steps, bf16 autocast on CUDA. Every `every` steps a
checkpoint (`last.pt`: nets, optimizers, step) and a validation on `--val` pairs (LSD, SI-SDR, log-mel distance)
with a few restored examples written as wav. Logs a JSON line per 50 steps to <out>/log.jsonl.

The model hears its input at −20 dBFS RMS (dsp.to_level); the target is scaled by the same gain, so a level
is preserved, not imposed.
"""
import argparse, json, os, time, glob
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader
import soundfile as sf
from dsp import SR, to_level, band, mel
from data import Pairs, Bank
from model import Net, Discriminators, params
import loss as L

def device():
    if torch.cuda.is_available(): return torch.device('cuda')
    if getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available(): return torch.device('mps')
    return torch.device('cpu')

def lsd(y, yh):
    """log-spectral distance, dB: the bandwidth measure (Vocos / NVSR convention: 2048-point, log10 power)"""
    Y, Yh = L.mag(y, 2048, 512).pow(2), L.mag(yh, 2048, 512).pow(2)
    return torch.sqrt(((torch.log10(Yh + 1e-9) - torch.log10(Y + 1e-9)) ** 2).mean(1)).mean().item()

def sisdr(y, yh):
    y, yh = y - y.mean(-1, keepdim=True), yh - yh.mean(-1, keepdim=True)
    s = (yh * y).sum(-1, keepdim=True) * y / (y.pow(2).sum(-1, keepdim=True) + 1e-9)
    return (10 * torch.log10(s.pow(2).sum(-1) / ((yh - s).pow(2).sum(-1) + 1e-9) + 1e-9)).mean().item()

def validate(net, val, dev, out, step):
    net.eval(); m = dict(lsd=0, sisdr=0, mel=0); n = 0
    with torch.no_grad():
        for i, (x, y, bw) in enumerate(val):
            x, y = x.to(dev), y.to(dev)
            xin, g = to_level(x); yh = net(xin) / g[:, None]
            y, yh = band(y, bw.to(dev)), band(yh, bw.to(dev))
            m['lsd'] += lsd(y, yh); m['sisdr'] += sisdr(y, yh); m['mel'] += F.l1_loss(mel(yh), mel(y)).item(); n += 1
            if i == 0:
                d = os.path.join(out, 'samples'); os.makedirs(d, exist_ok=True)
                for k in range(min(4, len(x))):
                    for name, v in (('in', x), ('out', yh), ('ref', y)):
                        sf.write(os.path.join(d, f'{step:07d}-{k}-{name}.wav'), v[k].cpu().numpy(), SR, subtype='FLOAT')
    net.train()
    return {k: v / max(n, 1) for k, v in m.items()}

def main():
    a = argparse.ArgumentParser()
    a.add_argument('--out', required=True); a.add_argument('--clean', required=True)
    a.add_argument('--val', help='manifests for validation pairs (else 2% of a fixed draw from --clean)')
    a.add_argument('--rirs'); a.add_argument('--noises')
    a.add_argument('--dim', type=int, default=512); a.add_argument('--blocks', type=int, default=8)
    a.add_argument('--attn', default='3,6'); a.add_argument('--heads', type=int, default=8)
    a.add_argument('--seg', type=float, default=4.0); a.add_argument('--batch', type=int, default=16)
    a.add_argument('--steps', type=int, default=400000); a.add_argument('--warmup', type=int, default=30000)
    a.add_argument('--lr', type=float, default=2e-4); a.add_argument('--every', type=int, default=2000)
    a.add_argument('--workers', type=int, default=6); a.add_argument('--ssl', type=float, default=1.0)
    a.add_argument('--w-mel', type=float, default=45.0); a.add_argument('--w-stft', type=float, default=10.0)
    a.add_argument('--w-fm', type=float, default=2.0); a.add_argument('--w-adv', type=float, default=1.0)
    a.add_argument('--val-batches', type=int, default=8); a.add_argument('--resume', action='store_true')
    a.add_argument('--device')
    o = a.parse_args()
    dev = torch.device(o.device) if o.device else device()
    os.makedirs(o.out, exist_ok=True)
    rirs = Bank(o.rirs, rir=True).items if o.rirs else ()
    noises = Bank(o.noises).items if o.noises else ()
    manifests = o.clean.split(',')
    data = Pairs(manifests, rirs, noises, o.seg)
    loader = DataLoader(data, o.batch, num_workers=o.workers, pin_memory=dev.type == 'cuda', persistent_workers=o.workers > 0)
    vdata = Pairs(o.val.split(',') if o.val else manifests, rirs, noises, o.seg, seed=12345)
    val = []
    for i, b in enumerate(DataLoader(vdata, o.batch, num_workers=0)):
        val.append(b)
        if i + 1 >= o.val_batches: break

    net = Net(o.dim, o.blocks, tuple(int(v) for v in o.attn.split(',') if v), o.heads).to(dev)
    disc = Discriminators().to(dev)
    print(f'generator {params(net) / 1e6:.1f}M, discriminators {params(disc) / 1e6:.1f}M, {dev}')
    og = torch.optim.AdamW(net.parameters(), o.lr, (0.8, 0.99), weight_decay=0.01)
    od = torch.optim.AdamW(disc.parameters(), o.lr, (0.8, 0.99), weight_decay=0.01)
    sg = torch.optim.lr_scheduler.StepLR(og, 1000, 0.999); sd = torch.optim.lr_scheduler.StepLR(od, 1000, 0.999)
    step = 0
    last = os.path.join(o.out, 'last.pt')
    if o.resume and os.path.exists(last):
        ck = torch.load(last, map_location=dev)
        net.load_state_dict(ck['net']); disc.load_state_dict(ck['disc']); og.load_state_dict(ck['og']); od.load_state_dict(ck['od'])
        sg.load_state_dict(ck['sg']); sd.load_state_dict(ck['sd']); step = ck['step']
        print('resumed at', step)
    ssl = None
    if o.ssl > 0:
        try: ssl = L.SSL(dev)
        except Exception as e: print('no SSL loss:', e)
    json.dump(dict(vars(o), cfg=net.cfg), open(os.path.join(o.out, 'config.json'), 'w'), indent=1)
    log = open(os.path.join(o.out, 'log.jsonl'), 'a')
    amp = dev.type == 'cuda'
    t0 = time.time()
    for x, y, bw in loader:
        if step >= o.steps: break
        x, y, bw = x.to(dev, non_blocking=True), y.to(dev, non_blocking=True), bw.to(dev)
        xin, g = to_level(x); y = y * g[:, None]
        adv = step >= o.warmup
        with torch.autocast(dev.type, torch.bfloat16, enabled=amp):
            yh = net(xin)
        yh = yh.float()
        y, yhb = band(y, bw), band(yh, bw)
        if adv:
            od.zero_grad(set_to_none=True)
            lr_, _ = disc(y); lf_, _ = disc(yhb.detach())
            ld = L.gan_d(lr_, lf_); ld.backward(); od.step()
        og.zero_grad(set_to_none=True)
        terms = dict(stft=L.mrstft(y, yhb), mel=L.mel_l1(y, yhb))
        if ssl: terms['ssl'] = ssl(y, yhb)
        lg = o.w_stft * terms['stft'] + o.w_mel * terms['mel'] + o.ssl * terms.get('ssl', 0)
        if adv:
            lr_, fr = disc(y); lf_, ff = disc(yhb)
            terms['adv'], terms['fm'] = L.gan_g(lf_), L.fm(fr, ff)
            lg = lg + o.w_adv * terms['adv'] + o.w_fm * terms['fm']
        lg.backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), 10.0)
        og.step(); sg.step()
        if adv: sd.step()
        step += 1
        if step % 50 == 0:
            rec = dict(step=step, loss=round(lg.item(), 4), **{k: round(float(v), 4) for k, v in terms.items()}, s=round(time.time() - t0, 1))
            if adv: rec['d'] = round(ld.item(), 4)
            print(json.dumps(rec)); log.write(json.dumps(rec) + '\n'); log.flush()
        if step % o.every == 0 or step == o.steps:
            m = validate(net, val, dev, o.out, step)
            print(json.dumps(dict(step=step, val=m))); log.write(json.dumps(dict(step=step, val=m)) + '\n'); log.flush()
            torch.save(dict(net=net.state_dict(), disc=disc.state_dict(), og=og.state_dict(), od=od.state_dict(), sg=sg.state_dict(), sd=sd.state_dict(), step=step, cfg=net.cfg), last + '.part')
            os.replace(last + '.part', last)
            torch.save(dict(net=net.state_dict(), cfg=net.cfg, step=step), os.path.join(o.out, f'net-{step:07d}.pt'))

if __name__ == '__main__':
    main()
