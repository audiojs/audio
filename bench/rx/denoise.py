# bench/rx/denoise.mjs's Python half: RX on a learned print, and the speech scores.
#   python bench/rx/denoise.py learn    jobs on stdin, one JSON line each, each answered by a line (as host.py serve):
#                                       {"plugin", "params", "lead": [from, to] s, "in", "out"}
#   python bench/rx/denoise.py score    [[SET, DIR, NAME], ...] on stdin (SET: train, test, train-clean, test-clean)
#                                       -> a row per item on stdout
#
# Learn. Spectral De-noise's Learn button and Voice De-noise's Learn are not plugin parameters, so the print is learned
# as the plugin's adaptive mode learns it: adaptive on over the lead-in, then off, and what it learned is held for the
# file. The held print survives reset() and parameter changes (checked on Gaussian noise: at Spectral De-noise's
# defaults noise at the learned level goes 10 dB down, 10 dB under it 16 dB, 20 dB over it passes). Spectral De-noise
# learns a print only once its adaptive learning time has passed (0.5 s at its shortest), so it hears the lead-in at that
# time and the lead-in looped to 2 s (a lead-in under 0.5 s otherwise leaves a print 10 dB off). Voice De-noise learns
# from the first frames. Each job starts from the plugin's defaults; outputs are aligned to the input (Pedalboard takes
# the reported latency off, as host.py), float32 WAV at the input's rate.
#
# Score: bench/speech.py's `vb` (PESQ P.862.2, STOI, SI-SDR, DNSMOS P.835 at the input's loudness; its header cites
# each), and musical noise as @audio/denoise's scripts/speech.py measures it: the log kurtosis ratio of the power
# spectral values, output over input, in the clean reference's frames 40 dB under its loudest (Uemura et al., IWAENC
# 2008; Miyazaki et al., IEEE TASLP 20(7), 2012), 512-point Hann frames at 16 kHz, 94 Hz to 7.9 kHz.
import os, sys, json, numpy as np, soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))          # bench/speech.py
VST = '/Library/Audio/Plug-Ins/VST3/RX 12 %s.vst3'
ADAPT = {'Spectral De-noise': 'adaptive_learning', 'Voice De-noise': 'adaptive_mode'}
_loaded = {}

def plugin(name):
    import pedalboard
    if name not in _loaded:
        p = pedalboard.load_plugin(VST % name)
        _loaded[name] = (p, {k: getattr(p, k) for k in p.parameters})
    p, defaults = _loaded[name]
    for k, v in defaults.items(): setattr(p, k, v)
    p.reset()
    return p

def learned(job):
    name = job['plugin']; p = plugin(name); a = ADAPT[name]
    x, fs = sf.read(job['in'], dtype='float32', always_2d=True); x = np.ascontiguousarray(x.T)
    lead = x[:, int(job['lead'][0] * fs): int(job['lead'][1] * fs)]
    if name == 'Spectral De-noise':
        p.adaptive_learning_time = 0.5
        lead = np.tile(lead, (1, int(np.ceil(2 * fs / lead.shape[1]))))
    setattr(p, a, True); p.process(np.ascontiguousarray(lead), fs); setattr(p, a, False)
    if name == 'Spectral De-noise': p.adaptive_learning_time = _loaded[name][1]['adaptive_learning_time']
    for k, v in job.get('params', {}).items(): setattr(p, k, float(v) if v in ('-inf', 'inf') else v)
    y = p.process(x, fs)
    os.makedirs(os.path.dirname(os.path.abspath(job['out'])), exist_ok=True)
    sf.write(job['out'], y.T, fs, subtype='FLOAT')
    return job['out']

def frames(x, N=512, hop=128):
    w = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N) / N)
    n = 1 + max(0, (len(x) - N) // hop)
    return np.abs(np.fft.rfft(x[np.arange(N)[None, :] + hop * np.arange(n)[:, None]] * w, axis=1)) ** 2

def kurt(ref16, inp16, out16):
    e = frames(ref16).sum(1); quiet = e < e.max() * 1e-4
    if quiet.sum() < 8: return float('nan')
    k = lambda P: np.mean(P ** 2) / np.mean(P) ** 2
    Pi, Po = frames(inp16)[quiet, 3:254], frames(out16)[quiet, 3:254]
    return float(np.log(k(Po) / k(Pi))) if Po.sum() > 0 else float('nan')

def row(job):
    import speech
    from scipy.signal import resample_poly
    set_, out, name = job
    base = set_.removesuffix('-clean')               # the clean utterances in: scored against themselves
    r = speech.vb((base, out, None, name, False, None))
    if base != set_: return {k: v for k, v in r.items() if k in ('name', 'pesq', 'stoi', 'sisdr')}
    d = os.path.join(speech.DATA, speech.SETS[set_][0])
    ref, inp = speech.read(f'{d}/{speech.SETS[set_][2]}/{name}.wav')[0], speech.read(f'{d}/{speech.SETS[set_][1]}/{name}.wav')[0]
    est = speech.fit(speech.read(f'{out}/{name}.wav')[0], len(inp))
    r16, i16, e16 = (resample_poly(speech.fit(v, len(inp)), 1, 3) for v in (ref, inp, est))
    r['kurt'] = kurt(r16, i16, e16)
    return {k: v for k, v in r.items() if k in ('name', 'pesq', 'stoi', 'sisdr', 'sig', 'bak', 'ovrl', 'kurt')}

if __name__ == '__main__':
    if sys.argv[1] == 'learn':
        for line in sys.stdin:
            try: print(json.dumps({'out': learned(json.loads(line))}), flush=True)
            except Exception as e: print(json.dumps({'error': repr(e)}), flush=True)
    elif sys.argv[1] == 'score':
        from multiprocessing import Pool
        jobs = json.load(sys.stdin)
        with Pool(int(os.environ.get('JOBS', 4))) as pool: rows = pool.map(row, jobs, chunksize=4)
        print(json.dumps([{k: None if isinstance(v, float) and not np.isfinite(v) else v for k, v in r.items()} for r in rows]))
