# iZotope RX 12's plugins, hosted (Pedalboard 0.9, VST3) for bench/rx: one job renders one file through one plugin.
#   python bench/rx/host.py JOBS.json       [{"plugin": "De-click", "params": {"sensitivity": 5}, "in": "a.wav", "out": "b.wav"}, ...]
#   python bench/rx/host.py serve           the same jobs one per line on stdin, each answered by a line (bench/rx/lib.mjs)
#   python bench/rx/host.py params PLUGIN   its parameters: name, range, default
#   python bench/rx/host.py lag             each plugin's alignment at its defaults: the lag of its output on noise
# Plugins load from /Library/Audio/Plug-Ins/VST3/RX 12 <PLUGIN>.vst3 (RX 12 Advanced, authorized). Each job starts
# from the plugin's defaults and a reset; a file renders whole, offline, in Pedalboard's 8192-sample blocks, the
# plugin's reported latency taken off (Pedalboard does it). Outputs are float32 WAV at the input's rate. Jobs run in
# parallel processes (RX_JOBS, default half the cores), each loading a plugin once. A parameter is set by its
# Pedalboard name to a number or a value's string ("Multi-band"); "-inf" is minus infinity (a gain's off).
import os, sys, json, numpy as np, soundfile as sf, pedalboard
from multiprocessing import Pool

VST = '/Library/Audio/Plug-Ins/VST3/RX 12 %s.vst3'
PLUGINS = ['Breath Control', 'De-bleed', 'De-click', 'De-clip', 'De-crackle', 'De-ess', 'De-hum', 'De-plosive', 'De-reverb',
           'Dialogue Isolate', 'Guitar De-noise', 'Mouth De-click', 'Music Rebalance', 'Repair Assistant', 'Spectral De-noise',
           'Voice De-noise']
_loaded = {}

def plugin(name):
    if name not in _loaded:
        p = pedalboard.load_plugin(VST % name)
        _loaded[name] = (p, {k: getattr(p, k) for k in p.parameters})
    p, defaults = _loaded[name]
    for k, v in defaults.items(): setattr(p, k, v)
    p.reset()
    return p

def render(job):
    p = plugin(job['plugin'])
    for k, v in job.get('params', {}).items(): setattr(p, k, float(v) if v in ('-inf', 'inf') else v)
    x, fs = sf.read(job['in'], dtype='float32', always_2d=True)
    y = p.process(np.ascontiguousarray(x.T), fs)
    os.makedirs(os.path.dirname(os.path.abspath(job['out'])), exist_ok=True)
    sf.write(job['out'], y.T, fs, subtype='FLOAT')
    return job['out']

def lag(name):
    out = []
    for fs in (16000, 44100, 48000):
        r = np.random.default_rng(1)
        x = (0.1 * r.standard_normal(fs * 3)).astype(np.float32)
        p = plugin(name)
        y = p.process(x[None], fs)[0]
        a, b = x[fs:2 * fs], y[fs - 4096:2 * fs + 4096]
        c = np.correlate(b, a, 'valid')
        out.append((fs, int(np.argmax(np.abs(c))) - 4096, round(float(np.max(np.abs(c)) / np.dot(a, a)), 3)))
    return name, out

if __name__ == '__main__':
    if sys.argv[1] == 'params':
        p = plugin(sys.argv[2])
        for k, v in p.parameters.items(): print(k, '|', v)
    elif sys.argv[1] == 'serve':
        for line in sys.stdin:
            try: print(json.dumps({'out': render(json.loads(line))}), flush=True)
            except Exception as e: print(json.dumps({'error': repr(e)}), flush=True)
    elif sys.argv[1] == 'lag':
        with Pool(8) as pool:
            for name, out in pool.imap(lag, PLUGINS): print(name, out, flush=True)
    else:
        jobs = json.load(open(sys.argv[1]))
        with Pool(int(os.environ.get('RX_JOBS', os.cpu_count() // 2))) as pool:
            for i, o in enumerate(pool.imap_unordered(render, jobs, chunksize=4)): pass
        print(len(jobs), 'rendered')
