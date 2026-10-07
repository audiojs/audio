# bench/rx/dereverb.mjs's Python half: the inputs it builds, the scores it reads, and RX De-reverb's Learn.
#   python bench/rx/dereverb.py build SPLIT              the inputs of SPLIT (train | test), once: ~/.cache/audiojs/data/
#                                                        rx/dereverb/sets/SPLIT/ and its manifest.json
#   python bench/rx/dereverb.py score JOBS.json OUT.json  each job { kind, sr, in, out, ref, early?, late? } scored
#   python bench/rx/dereverb.py learn JOBS.json OUT.json  each job { in }: RX De-reverb's Learn on it, the profile it sets
# The sets, measures and sources are in bench/rx/dereverb.mjs's header.
import os, sys, glob, json, numpy as np, soundfile as sf
from multiprocessing import Pool
from scipy.signal import resample_poly, fftconvolve, butter, sosfiltfilt

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.expanduser('~/.cache/audiojs/data'); OUT = os.path.join(DATA, 'rx', 'dereverb')
OCT = [(63, 125), (125, 250), (250, 500), (500, 1000), (1000, 2000), (2000, 4000), (4000, 8000)]
SNR, PRE_MS, EARLY_MS, TAIL_S = 10, 2, 50, 0.4

def rf32(p): return np.fromfile(p, np.float32).astype(np.float64)
def load(p):
    if p.endswith('.f32'): return rf32(p)
    x, _ = sf.read(p, dtype='float64', always_2d=True); return x[:, 0]
def save(p, x, fs): os.makedirs(os.path.dirname(p), exist_ok=True); sf.write(p, np.asarray(x, np.float32), fs, subtype='FLOAT')

# Rooms as @audio/denoise's scripts/dereverb.py picks them: MIT IR Survey responses (32 kHz) at FS, aligned to the
# direct peak (2 ms kept before it); those whose first 50 ms are under 12 dB over the rest (a tail to hear) and whose
# T60 (Schroeder T20, 500 Hz–1 kHz octave) reads, 19 spread by T60; even-numbered for train, odd for test.
def response(p, fs):
    h, r = sf.read(p, dtype='float64', always_2d=True); h = resample_poly(h[:, 0], fs // 100, r // 100)
    k = int(np.argmax(np.abs(h))); h = h[max(0, k - fs * PRE_MS // 1000):]; return h / np.abs(h).max()
def t60(h, fs):
    v = sosfiltfilt(butter(4, [354, 1414], 'bandpass', fs=fs, output='sos'), h)
    e = np.cumsum(v[::-1] ** 2)[::-1]; e = 10 * np.log10(e / e[0] + 1e-30); a, b = np.argmax(e < -5), np.argmax(e < -25)
    return -60 / np.polyfit(np.arange(a, b) / fs, e[a:b], 1)[0] if b > a else np.nan
def rooms(parity, fs):
    c, cut = [], fs * (PRE_MS + EARLY_MS) // 1000
    for p in sorted(glob.glob(f'{DATA}/mit-ir/Audio/*.wav')):
        if int(os.path.basename(p)[1:4]) % 2 != parity: continue
        h = response(p, fs); r, t = 10 * np.log10(np.sum(h[:cut] ** 2) / np.sum(h[cut:] ** 2)), t60(h, fs)
        if r < 12 and np.isfinite(t): c.append((h, t))
    c.sort(key=lambda v: v[1]); return [c[int(i * len(c) / 19)][0] for i in range(19)]
def place(x, h, fs):
    # x in the room with TAIL_S after it: its early part (the target as the room colours it) and late part, scaled so
    # the early part carries the dry take's energy
    cut, pre, n = fs * (PRE_MS + EARLY_MS) // 1000, fs * PRE_MS // 1000, len(x) + int(TAIL_S * fs)
    he = h.copy(); he[cut:] = 0; xp = np.zeros(n); xp[:len(x)] = x
    ye, yl = (fftconvolve(xp, k)[pre:pre + n] for k in (he, h - he)); g = np.sqrt(np.sum(xp ** 2) / np.sum(ye ** 2))
    return xp, ye * g, yl * g

def phrases(x, fs, seed):
    # music with pauses, as a recording has them: 2–4 s phrases, each faded over 50 ms at its ends, 0.5–1.5 s between,
    # over a noise floor 50 dB under the music's mean power (white, Gaussian)
    r, y, i, f = np.random.default_rng(seed), [], 0, int(0.05 * fs)
    fade = 0.5 - 0.5 * np.cos(np.pi * np.arange(f) / f)
    while i < len(x):
        k = min(len(x), i + int(r.uniform(2, 4) * fs)); p = x[i:k].copy(); m = min(f, len(p) // 2)
        p[:m] *= fade[:m]; p[len(p) - m:] *= fade[:m][::-1]; y += [p, np.zeros(int(r.uniform(0.5, 1.5) * fs))]; i = k
    y = np.concatenate(y[:-1])
    return y + r.standard_normal(len(y)) * np.sqrt(np.mean(x ** 2) * 1e-5)

def build(split):
    parity, d, items = {'train': 0, 'test': 1}[split], os.path.join(OUT, 'sets', split), []
    # speech: the takes @audio/denoise's scripts/dereverb.py builds, 48 kHz
    src = os.path.join(DATA, 'dereverb', split)
    noise = [load(p) for p in sorted(glob.glob(f'{DATA}/demand/*/ch01.wav'))]
    for i, p in enumerate(sorted(q[:-8] for q in glob.glob(f'{src}/*.rev.f32'))):
        n, g = os.path.basename(p), 'long' if 'long-' in p else 'short'
        items.append(dict(cond='room', group=g, name=n, sr=48000, kind='speech', **{'in': p + '.rev.f32'}, ref=p + '.dry.f32', early=p + '.early.f32', late=p + '.late.f32'))
        items.append(dict(cond='dry', group=g, name=n, sr=48000, kind='speech', **{'in': p + '.dry.f32'}, ref=p + '.dry.f32'))
        # DEMAND (Thiemann, Ito & Vincent 2013), recording i % 5, from its first half (train) or second (test)
        rev = rf32(p + '.rev.f32'); z = noise[i % len(noise)]; half = len(z) // 2
        at = half * parity + (i * 104729) % (half - len(rev)); z = z[at:at + len(rev)]
        z *= np.sqrt(np.mean(rev ** 2) / np.mean(z ** 2) / 10 ** (SNR / 10)); f = f'{d}/noisy/{n}.wav'
        if not os.path.exists(f): save(f, rev + z, 48000)
        items.append(dict(cond='noisy', group=g, name=n, sr=48000, kind='speech', **{'in': f}, ref=p + '.dry.f32'))
    # music, 44.1 kHz: as it is, cut into phrases with pauses, and in a room
    fs, R, pieces = 44100, rooms(parity, 44100), []
    pieces += [('MUSDB18', os.path.basename(p)[:-4], rf32(p)) for p in sorted(glob.glob(f'{DATA}/musdb/test-mono/*.f32'))[1 - parity::2]]
    pieces += [('GuitarSet', os.path.basename(p)[:-4], load(p)[:30 * fs]) for p in sorted(glob.glob(f'{DATA}/guitarset/audio_mono-mic/*.wav'))[9 * parity::18][:20]]
    for k in ['brahms', 'nutcracker', 'trumpet', 'vibeace']:
        x = rf32(f'{DATA}/repair/{k}.f32'); h = len(x) // 2; pieces.append(('pieces', k, x[:min(h, 30 * fs)] if parity else x[h:h + 30 * fs]))
    singers = sorted(glob.glob(f'{DATA}/vocalset/FULL/*/excerpts/straight/*.wav'))
    pieces += [('sung', os.path.basename(p)[:-4], load(p)) for p in singers[parity::2]]
    for i, (g, n, x) in enumerate(pieces):
        f = f'{d}/music/{g}-{n}.wav'
        if not os.path.exists(f): save(f, x, fs)
        items.append(dict(cond='music', group=g, name=f'{g}-{n}', sr=fs, kind='music', **{'in': f}, ref=f))
        f = f'{d}/pauses/{g}-{n}.wav'
        if not os.path.exists(f): save(f, phrases(x, fs, i), fs)
        items.append(dict(cond='pauses', group=g, name=f'{g}-{n}', sr=fs, kind='music', **{'in': f}, ref=f))
        b = f'{d}/music-room/{g}-{n}'
        if not os.path.exists(b + '.in.wav'):
            xp, ye, yl = place(x, R[i % 19], fs)
            for s, v in [('in', ye + yl), ('dry', xp), ('early', ye), ('late', yl)]: save(f'{b}.{s}.wav', v, fs)
        items.append(dict(cond='music-room', group=g, name=f'{g}-{n}', sr=fs, kind='music', **{'in': b + '.in.wav'}, ref=b + '.dry.wav', early=b + '.early.wav', late=b + '.late.wav'))
    json.dump(items, open(f'{d}/manifest.json', 'w'), indent=0)
    print(f'{split}: {len(items)} inputs in {d}')

# Measures
def stft(x, N=2048, hop=512):
    w = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N) / N); xp = np.concatenate([np.zeros(N), x, np.zeros(N)])
    idx = np.arange(N)[None, :] + hop * np.arange((len(xp) - N) // hop + 1)[:, None]
    return np.fft.rfft(xp[idx] * w, axis=1)
def split_(early, late, out):
    # where the early part is 10 dB over the late one, the output's power and the early part's; where the late part is
    # 10 dB over the early one, the output's and the late part's (cells within 50 dB of the loudest)
    pe, pl, po = (np.abs(stft(z)) ** 2 for z in (early, late, out)); live = pe + pl > max(pe.max(), pl.max()) * 1e-5
    sp, rv = (pe > 10 * pl) & live, (pl > 10 * pe) & live
    return [float(po[sp].sum()), float(pe[sp].sum()), float(po[rv].sum()), float(pl[rv].sum())]
def sisdr(r, e):
    r, e = r - r.mean(), e - e.mean(); t = np.dot(e, r) / np.dot(r, r) * r; n = np.dot(e - t, e - t)
    return float(10 * np.log10(np.dot(t, t) / n)) if n > 0 else float('inf')
def bands(z, fs):
    P = np.abs(np.fft.rfft(z)) ** 2; f = np.fft.rfftfreq(len(z), 1 / fs); return [float(P[(f >= a) & (f < b)].sum()) for a, b in OCT]
def fit(x, n): return x[:n] if len(x) >= n else np.pad(x, (0, n - len(x)))

def score(j):
    from pesq import pesq; from pystoi import stoi; import pyloudnorm as pyln
    sys.path.insert(0, os.path.dirname(HERE)); from speech import dnsmos
    fs, x = j['sr'], load(j['in']); y, ref = fit(load(j['out']), len(x)), fit(load(j['ref']), len(x))
    r = dict(same=bool(np.array_equal(np.float32(x), np.float32(y))), sisdr=sisdr(ref, y), sisdr_in=sisdr(x, y), bin=bands(x, fs), bout=bands(y, fs))
    if 'early' in j: r['split'] = split_(load(j['early']), load(j['late']), y)
    if j['kind'] == 'speech':
        r16 = lambda z: resample_poly(z, 1, 3); m = pyln.Meter(fs); li, lo = m.integrated_loudness(x), m.integrated_loudness(y)
        r.update(pesq=float(pesq(16000, r16(ref), r16(y), 'wb')), stoi=float(stoi(r16(ref), r16(y), 16000)),
                 dns=dnsmos(y * 10 ** ((li - lo) / 20) if np.isfinite(lo) else y, fs))
    if j['kind'] == 'pesq':     # the tuning search: PESQ and STOI alone
        r16 = lambda z: resample_poly(z, 1, 3); r.update(pesq=float(pesq(16000, r16(ref), r16(y), 'wb')), stoi=float(stoi(r16(ref), r16(y), 16000)))
    return r

# RX De-reverb's Learn, as its panel runs it: the plugin's learning flag (its state's "Dereverb Learning", which no
# parameter exposes) set, the take played through, the flag cleared; the profile it learned is the tail length and the
# four band strengths, which then render as the same parameters set by hand would (within −76 dB).
def learn(j):
    import re, zlib, struct, pedalboard
    T = '.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+'
    def dec(s):                                      # JUCE's MemoryBlock base-64 (bits little-endian, 6 a character)
        n, d = s.split('.', 1); out = bytearray(int(n))
        for c, ch in enumerate(q for q in d if q in T):
            v = T.find(ch)
            for b in range(6):
                i = 6 * c + b
                if v >> b & 1 and i // 8 < len(out): out[i // 8] |= 1 << (i % 8)
        return bytes(out)
    def enc(b):
        bit = lambda i: b[i // 8] >> (i % 8) & 1 if i < 8 * len(b) else 0
        return f'{len(b)}.' + ''.join(T[sum(bit(6 * c + k) << k for k in range(6))] for c in range((8 * len(b) + 5) // 6))
    def state(raw, flag=None):
        # the VST3 state: XML whose IComponent holds a 16-byte header (size after byte 12, size inflated) and zlib JSON
        x = raw[8:].split(b'\0')[0].decode(); b = dec(re.search('<IComponent>(.*?)</IComponent>', x).group(1))
        d = json.loads(zlib.decompress(b[16:])); v = d['DSP State']['Value']['DSP Elements']['Value']['Dereverb']['Value']
        if flag is None: return v
        v['Dereverb Learning']['Value'] = flag
        s = (json.dumps(d, indent=3, separators=(',', ' : ')) + '\n').encode(); z = zlib.compress(s)
        xb = re.sub('<IComponent>.*?</IComponent>', '<IComponent>' + enc(b[:8] + struct.pack('<II', len(z) + 4, len(s)) + z) + '</IComponent>', x).encode() + b'\0'
        return b'VC2!' + struct.pack('<I', len(xb) - 1) + xb
    # a plugin loaded for each take: a reset and the default state restored still leave the last take's learning in it
    p = pedalboard.load_plugin('/Library/Audio/Plug-Ins/VST3/RX 12 De-reverb.vst3')
    x, fs = sf.read(j['in'], dtype='float32', always_2d=True) if not j['in'].endswith('.f32') else (np.fromfile(j['in'], np.float32)[:, None], j['sr'])
    p.raw_state = state(p.raw_state, True); p.reset(); p.process(np.ascontiguousarray(x.T), fs)
    # the profile is committed by the first block after the flag is cleared
    p.raw_state = state(p.raw_state, False); p.reset(); p.process(np.zeros((x.shape[1], 512), np.float32), fs)
    v = state(p.raw_state)
    return dict(tail_length=round(v['Dereverb Tail Length']['Value'], 2), **{k: round(v[f'Dereverb Amount Band {i}']['Value'], 2) for i, k in enumerate(['band_strength_low', 'band_strength_low_mid', 'band_strength_high_mid', 'band_strength_high'])})

if __name__ == '__main__':
    if sys.argv[1] == 'build': build(sys.argv[2]); sys.exit()
    jobs = json.load(open(sys.argv[2]))
    with Pool(int(os.environ.get('JOBS', 4))) as pool: out = pool.map({'score': score, 'learn': learn}[sys.argv[1]], jobs, chunksize=2)
    json.dump(out, open(sys.argv[3], 'w'))
