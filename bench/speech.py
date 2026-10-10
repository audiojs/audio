# Scores for bench/speech.mjs's outputs.
#   python bench/speech.py SET SYSTEM[,SYSTEM...] [--ref SYSTEM | --lin] [--delivered] [--shard K/N]
# SET: test, train (VoiceBank+DEMAND), reverb-test, reverb-train (its clean speech in MIT IR Survey rooms),
# rooms, rooms-train (narrations)
# pip install numpy scipy soundfile pesq pystoi onnxruntime pyloudnorm; DNSMOS: sig_bak_ovr.onnx from
# microsoft/DNS-Challenge at 82f1b17e77 (DNSMOS/DNSMOS/, CC BY 4.0) in ~/.cache/audiojs/neural/dnsmos/.
#
# VoiceBank+DEMAND, against the clean reference (with --ref, the clean reference through SYSTEM; with --lin,
# SI-SDR's reference through the system's own tone filters, highpass and EQ, whose phase shift it would count as
# damage), at 16 kHz (scipy.signal.resample_poly, 1:3), the output cut to
# the reference's length:
#   PESQ: ITU-T P.862.2 wideband MOS-LQO (python-pesq 0.0.4, the ITU reference C code); it aligns level itself
#   STOI: Taal, Hendriks, Heusdens, Jensen, IEEE TASLP 19(7), 2011 (pystoi 0.4.1); scale-invariant
#   SI-SDR: Le Roux, Wisdom, Erdogan, Hershey, ICASSP 2019, eq. 3, zero-mean signals, dB; scale-invariant
# Both sets: DNSMOS P.835 (Reddy, Gopal, Cutler, ICASSP 2022), dnsmos_local.py's method at 82f1b17e77
# (non-personalized; 9.01 s windows at a 4.5 s hop; a shorter clip tiled, one window). The model reads absolute level, so it
# scores each output at its input's loudness (ITU-R BS.1770-4 integrated, pyloudnorm), a gain the other
# metrics ignore; "as delivered" (--delivered) scores the output at its own level. Rooms add the checks bench/speech.mjs ran.
import os, sys, json, hashlib, subprocess, numpy as np, onnxruntime as ort, soundfile as sf, pyloudnorm as pyln
from multiprocessing import Pool
from scipy.signal import resample_poly

DATA = os.path.expanduser('~/.cache/audiojs/data')
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get('AUDIO_NEURAL_CACHE') or os.path.expanduser('~/.cache/audiojs/neural')
SETS = {'test': ('vbdemand', 'noisy_testset_wav', 'clean_testset_wav'), 'train': ('vbdemand-train', 'noisy', 'clean'),
        'reverb-test': ('vbreverb', 'test-reverb', 'test-clean'), 'reverb-train': ('vbreverb', 'train-reverb', 'train-clean')}
ROOMS = {'rooms': 'spoken', 'rooms-train': 'spoken-train'}
P_SIG = np.poly1d([-0.08397278, 1.22083953, 0.0052439])
P_BAK = np.poly1d([-0.13166888, 1.60915514, -0.39604546])
P_OVR = np.poly1d([-0.06766283, 1.11546468, 0.04602535])
KEYS = ['pesq', 'stoi', 'sisdr', 'sig', 'bak', 'ovrl', 'sig_d', 'bak_d', 'ovrl_d', 'lufs']
_sess = None

def dnsmos(x, fs):
    global _sess
    if _sess is None:
        so = ort.SessionOptions(); so.intra_op_num_threads = 1; so.inter_op_num_threads = 1
        _sess = ort.InferenceSession(os.path.join(CACHE, 'dnsmos', 'sig_bak_ovr.onnx'), so)
    a = to16(x, fs)
    need = int(9.01 * 16000)
    # a clip shorter than a window is tiled and scored once: dnsmos_local also scores its copy at further 1 s
    # shifts, the same speech again (1 to 9 runs of the model per VoiceBank+DEMAND clip)
    short = len(a) < need
    while len(a) < need: a = np.append(a, a)
    if short: a = a[:need]
    # windows at a 4.5 s hop, half a window (dnsmos_local: 1 s; 60 s runs the model 12 times, not 51)
    s, hop = [], 72000
    for i in range((len(a) - need) // hop + 1):
        seg = a[i * hop: i * hop + need]
        if len(seg) == need: s.append(_sess.run(None, {'input_1': seg.astype('float32')[None]})[0][0])
    s = np.array(s)
    return float(np.mean(P_SIG(s[:, 0]))), float(np.mean(P_BAK(s[:, 1]))), float(np.mean(P_OVR(s[:, 2])))

def to16(x, fs):
    return resample_poly(x, 1, 3) if fs == 48000 else resample_poly(x, 160, 441) if fs == 44100 else x

def lufs(x, fs):
    return pyln.Meter(fs).integrated_loudness(x)

def sisdr(ref, est):
    ref = ref - ref.mean(); est = est - est.mean()
    t = np.dot(est, ref) / np.dot(ref, ref) * ref
    return float(10 * np.log10(np.dot(t, t) / np.dot(est - t, est - t)))

def read(p):
    x, fs = sf.read(p, dtype='float64')
    return (x.mean(axis=1) if x.ndim > 1 else x), fs

def fit(x, n):
    return x[:n] if len(x) >= n else np.pad(x, (0, n - len(x)))

def vb(args):
    from pesq import pesq
    from pystoi import stoi
    set_, out, ref, name, delivered, lin = args
    d = os.path.join(DATA, SETS[set_][0])
    noisy, fs = read(f'{d}/{SETS[set_][1]}/{name}.wav')
    r = read(f'{ref}/{name}.wav')[0] if ref else read(f'{d}/{SETS[set_][2]}/{name}.wav')[0]
    e = noisy if out is None else fit(read(f'{out}/{name}.wav')[0], len(noisy))
    r = fit(r, len(noisy))
    r16, e16 = resample_poly(r, 1, 3), resample_poly(e, 1, 3)
    # SI-SDR against the reference through the same tone filters (a waveform measure: a highpass's phase shift
    # alone costs clean speech 12 dB of it); PESQ and STOI read magnitudes and stay against the plain reference:
    # STOI drops the reference's silent frames, and a highpassed reference silences pauses the plain one keeps
    l16 = resample_poly(fit(read(f'{lin}/{name}.wav')[0], len(noisy)), 1, 3) if lin else r16
    lin, lout = lufs(noisy, fs), lufs(e, fs)
    g = 10 ** ((lin - lout) / 20) if np.isfinite(lout) else 1
    sig, bak, ovr = dnsmos(e * g, fs)
    sig_d, bak_d, ovr_d = (sig, bak, ovr) if abs(lin - lout) < 0.1 else dnsmos(e, fs) if delivered else (np.nan,) * 3
    return dict(name=name, pesq=pesq(16000, r16, e16, 'wb'), stoi=stoi(r16, e16, 16000, extended=False), sisdr=sisdr(l16, e16),
                sig=sig, bak=bak, ovrl=ovr, sig_d=sig_d, bak_d=bak_d, ovrl_d=ovr_d, lufs=lout)

def room(args):
    set_, out, name, delivered = args
    raw = np.fromfile(os.path.join(DATA, ROOMS[set_], name + '.f32'), dtype=np.float32).astype(np.float64)
    e, fs = (raw, 48000) if out is None else read(f'{out}/{name}.wav')
    lin, lout = lufs(raw, 48000), lufs(e, fs)
    sig, bak, ovr = dnsmos(e * 10 ** ((lin - lout) / 20), fs)
    sig_d, bak_d, ovr_d = (sig, bak, ovr) if abs(lin - lout) < 0.1 else dnsmos(e, fs) if delivered else (np.nan,) * 3
    return dict(name=name, sig=sig, bak=bak, ovrl=ovr, sig_d=sig_d, bak_d=bak_d, ovrl_d=ovr_d, lufs=lout)

def dirs(ids):
    return json.loads(subprocess.check_output(['node', os.path.join(HERE, 'speech.mjs'), 'dirs', ids], cwd=os.path.dirname(HERE)))

def expanded(dd, set_):
    # the systems in order, `name:*` spread into its prefixes (the keys bench/speech.mjs dirs writes)
    return [k.split('/', 1)[1] for k in dd if k.startswith(set_ + '/') and not k.split('/', 1)[1].startswith('lin:')]

def ci(a, b, k):
    d = np.array([x[k] - y[k] for x, y in zip(a, b)])
    return d.mean(), 1.96 * d.std(ddof=1) / np.sqrt(len(d))

def summary(sid, rows, base, keys):
    m = {k: np.mean([r[k] for r in rows]) for k in keys}
    line = f"{sid:28s} " + ' '.join(f"{k} {m[k]:.3f}" for k in keys)
    if base is not None and rows is not base:
        line += '  Δ ' + ' '.join('{} {:+.3f}±{:.3f}'.format(k, *ci(rows, base, k)) for k in keys if k != 'lufs')
    print(line, flush=True)

def cached(path, fn, jobs, pool, keep=True):
    if keep and os.path.exists(path): return json.load(open(path))
    rows = pool.map(fn, jobs, chunksize=4)
    if keep: json.dump(rows, open(path, 'w'))
    return rows

if __name__ == '__main__':
    args = sys.argv[1:]
    ref = args[args.index('--ref') + 1] if '--ref' in args else None
    dl, lin = '--delivered' in args, '--lin' in args
    k, n = map(int, args[args.index('--shard') + 1].split('/')) if '--shard' in args else (0, 1)
    set_, ids = args[0], args[1]
    ids = [i for i in ids.split(',') if i]
    with Pool(4) as pool:
        if set_ in SETS:
            d = os.path.join(DATA, SETS[set_][0])
            names = sorted(f[:-4] for f in os.listdir(f'{d}/{SETS[set_][2]}') if f.endswith('.wav'))[k::n]
            refdir = dirs(ref)[f'{set_}-clean/{ref}'] if ref else None
            # scores of one reference: the clean one, or the clean one through --ref's stages
            tag = 'scores' + (f'.ref-{hashlib.sha256(refdir.encode()).hexdigest()[:8]}' if ref else '')
            os.makedirs(os.path.join(DATA, 'recipes', set_), exist_ok=True)
            keep = n == 1  # a shard (a trial run) keeps no scores
            base = cached(os.path.join(DATA, 'recipes', set_, f'noisy.{tag}.json'), vb, [(set_, None, refdir, x, True, None) for x in names], pool, keep)
            summary('noisy', base, base, KEYS)
            dd = dirs(','.join(ids))
            for sid in expanded(dd, set_):
                out = dd[f'{set_}/{sid}']
                # --lin: SI-SDR against the clean reference through the system's own tone filters (bench/speech.mjs `lin:`)
                l, t = (dd[f'{set_}-clean/lin:{sid}'], tag + '.lin') if lin else (None, tag)
                rows = cached(os.path.join(out, t + ('.d' if dl else '') + '.json'), vb, [(set_, out, refdir, x, dl, l) for x in names], pool, keep)
                summary(sid, rows, base, KEYS)
        elif set_ in ROOMS:
            names = sorted(f[:-4] for f in os.listdir(os.path.join(DATA, ROOMS[set_])) if f.endswith('.f32'))
            keys = ['sig', 'bak', 'ovrl', 'sig_d', 'bak_d', 'ovrl_d', 'lufs']
            os.makedirs(os.path.join(DATA, 'recipes', set_), exist_ok=True)
            base = cached(os.path.join(DATA, 'recipes', set_, 'raw.scores.json'), room, [(set_, None, x, True) for x in names], pool)
            summary('raw', base, base, keys)
            dd = dirs(','.join(ids))
            for sid in expanded(dd, set_):
                out = dd[f'{set_}/{sid}']
                rows = cached(os.path.join(out, 'scores' + ('.d' if dl else '') + '.json'), room, [(set_, out, x, dl) for x in names], pool)
                summary(sid, rows, base, keys)
                checks = {}
                for f in os.listdir(out):
                    if f.startswith('checks.'): checks.update(json.load(open(os.path.join(out, f))))
                for spec in sorted({s for c in checks.values() for s in c}):
                    res = [c[spec] for c in checks.values() if spec in c]
                    fails = {}
                    for r in res:
                        for rule in r['rules']:
                            if rule['pass'] is False: fails[rule['name']] = fails.get(rule['name'], 0) + 1
                    # JSON carries −∞ (digital silence) as null
                    fl = [-np.inf if rule['value'] is None else rule['value'] for r in res for rule in r['rules'] if rule['name'] == 'Noise floor']
                    print(f"    {spec}: {sum(r['pass'] for r in res)} of {len(res)} pass" + (f"; fails {fails}" if fails else '') +
                          (f"; floor {min(fl):.1f} to {max(fl):.1f} dB" if fl and spec == 'acx' else ''), flush=True)
        else:
            print('usage: python bench/speech.py test|train|rooms|rooms-train SYSTEM[,SYSTEM...] [--ref SYSTEM] [--delivered] [--shard K/N]')
