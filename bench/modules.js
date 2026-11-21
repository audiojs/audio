// The Performance table's rows timed as the modules that do the work, not as `audio` end to end (bench.js does that):
// each row's module called as its README says, in-process, warmed, on the same fixture as bench.js, the sound already
// decoded in memory where the row is not a decode (so a row times its op, not the decode before it). librosa and
// Pedalboard on the same basis (modules.py beside this). SoX and FFmpeg are processes that decode and encode: their wall
// whole, less their own start (the same run on a 10 ms file), and for an op row less a pass-through of the same file
// (decode and encode, no op), each figure marked for what it is. What each tool makes is compared where the jobs can be:
// lengths, values, an error against a reference, a correlation. Every figure carries the 1-minute load average over its
// runs; every row the path and version of each package it ran.
//
//   node bench/modules.js [durationSeconds=600] [reps=5] [ops]
//
// ops: the rows to run, comma-separated (wav_decode, mp3_decode, lufs, truepeak, resample, stretch, pitch, fft, mfcc,
//   beat); all by default. Each tool's cells for those ops alone.
// $BENCH_PY: a Python with librosa (soundfile, soxr, numpy) for librosa's cells, and Pedalboard's where it has it (the
//   recipe in modules.py); without it, none.
// $BENCH_CHECKOUT: packages to run from their checkouts instead of node_modules, by name, comma-separated
//   (`fourier-transform,@audio/spectral-mfcc`). Such a package is loaded from its checkout wherever it is imported, by
//   this file or by another package; every other package as audio's node_modules has it, also where a checkout imports
//   it (one audio lacks, as the checkout resolves it): as if those checkouts were published and installed here. A
//   checkout is $PROJECTS/<name> (default: the folder holding audio) or $AUDIO_ROOT/<family>,
//   $AUDIO_ROOT/<family>/packages/<name> for @audio/<family>-… (default $PROJECTS/@audio), its package.json naming it.
//   The report lists, for every row, each package it ran, its version and path.
// $BENCH_CACHE: the fixtures, as bench.js's (bench/.cache); what the tools make for comparing goes in its modules/.
// $BENCH_JSON: where the figures are written; bench/results.json is bench.js's and is not touched.
// Peak normalize has no module of its own (a few lines of fn/normalize.js): not timed; true peak stands in its place.

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerHooks } from 'node:module'
import { loadavg } from 'node:os'
import v8 from 'node:v8'
import vm from 'node:vm'
import { ensureFixtures } from './fixtures.js'

v8.setFlagsFromString('--expose-gc')
const gc = vm.runInNewContext('gc')

const HERE = dirname(fileURLToPath(import.meta.url))
const DUR = Number(process.argv[2] || 600), REPS = Number(process.argv[3] || 5), SR = 44100
const ONLY = process.argv[4] ? new Set(process.argv[4].split(',')) : null, runs = op => !ONLY || ONLY.has(op)
const CACHE = process.env.BENCH_CACHE || join(HERE, '.cache'), OUT = join(CACHE, 'modules'), PY = process.env.BENCH_PY
mkdirSync(OUT, { recursive: true })

// ── which code runs ─────────────────────────────────────────────────────────

const PROJECTS = process.env.PROJECTS || join(HERE, '../..'), AUDIO_ROOT = process.env.AUDIO_ROOT || join(PROJECTS, '@audio')
const json = f => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }
const pkgName = s => s.split('/').slice(0, s[0] === '@' ? 2 : 1).join('/')
function checkoutOf(name) {
	let bare = name.replace(/^@audio\//, ''), dirs = bare === name ? [join(PROJECTS, name)] : [join(AUDIO_ROOT, bare), join(AUDIO_ROOT, bare.split('-')[0], 'packages', bare)]
	let dir = dirs.find(d => json(join(d, 'package.json'))?.name === name)
	if (!dir) throw Error(`BENCH_CHECKOUT: no checkout of ${name} (looked in ${dirs.join(', ')})`)
	if (!json(join(dir, 'package.json')).exports) throw Error(`BENCH_CHECKOUT: ${name} has no exports to resolve it by`)
	return realpathSync(dir)
}
const CHECKOUT = new Map((process.env.BENCH_CHECKOUT || '').split(',').map(s => s.trim()).filter(Boolean).map(n => [n, checkoutOf(n)]))
const inCheckout = url => url?.startsWith('file:') && [...CHECKOUT.values()].some(d => fileURLToPath(url).startsWith(d + '/'))
// every resolution, parent to child, for the packages each row ran
let edges = new Map(), entries = new Map()
registerHooks({
	resolve (spec, ctx, next) {
		// the parent read first: a context handed to next() is merged into this one
		let parent = ctx.parentURL, name = /^[@\w]/.test(spec) && !spec.includes(':') ? pkgName(spec) : null, r
		if (name && CHECKOUT.has(name)) r = next(spec, { ...ctx, parentURL: pathToFileURL(join(CHECKOUT.get(name), 'package.json')).href })
		else if (name && inCheckout(parent)) { try { r = next(spec, { ...ctx, parentURL: import.meta.url }) } catch { r = next(spec, { ...ctx, parentURL: parent }) } }
		else r = next(spec, ctx)
		if (parent === import.meta.url) entries.set(spec, r.url)
		if (parent) (edges.get(parent) ?? edges.set(parent, new Set()).get(parent)).add(r.url)
		return r
	},
})
// the package a file is in: its nearest package.json that names one
const pkgs = new Map()
function pkgOf(url) {
	if (!url.startsWith('file:')) return null
	for (let d = dirname(fileURLToPath(url)); d !== dirname(d); d = dirname(d)) {
		if (pkgs.has(d)) return pkgs.get(d)
		let p = json(join(d, 'package.json'))
		if (p?.name) { let v = { name: p.name, version: p.version, dir: d, checkout: [...CHECKOUT.values()].includes(d) }; pkgs.set(d, v); return v }
	}
	return null
}
/** The packages a row's module ran on: every package its import graph reaches, its own first */
function graph(spec) {
	let seen = new Set(), out = new Map(), stack = [entries.get(spec)]
	while (stack.length) {
		let u = stack.pop()
		if (!u || seen.has(u)) continue
		seen.add(u)
		let p = pkgOf(u)
		if (p && !out.has(p.dir)) out.set(p.dir, p)
		for (let c of edges.get(u) ?? []) stack.push(c)
	}
	return [...out.values()]
}

// imported once the hook is in place, so it sees them
const { default: decodeWav } = await import('@audio/decode-wav'), { default: decodeMp3 } = await import('@audio/decode-mp3')
const { lufs, truepeak } = await import('@audio/loudness'), { default: polyphase } = await import('@audio/resample-polyphase')
const { default: pvocLock } = await import('@audio/stretch-pvoc-lock'), { default: pitchShift } = await import('@audio/shift')
const { fft } = await import('fourier-transform'), { default: mfcc } = await import('@audio/spectral-mfcc')
const { beatTrack } = await import('@audio/beat')

// ── the sound ───────────────────────────────────────────────────────────────

let { wav, mp3 } = await ensureFixtures(CACHE, DUR)
let tiny = { wav: join(OUT, 'tiny.wav'), mp3: join(OUT, 'tiny.mp3') }
for (let [k, f] of Object.entries(tiny)) if (!existsSync(f)) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', k === 'wav' ? wav : mp3, '-t', '0.01', ...k === 'wav' ? ['-c:a', 'pcm_s16le'] : ['-b:a', '192k'], f])
const [L, R] = decodeWav(readFileSync(wav)).channelData, N = L.length
// the channels' mean, as librosa.load(mono=True) makes it
const mono = Float32Array.from(L, (v, i) => (v + R[i]) / 2)
// librosa's window: Hann, periodic (scipy.signal.get_window('hann', n))
const hann = n => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n))

/** librosa's frame grid: frames of n centred every hop samples, 1 + ⌊N / hop⌋ of them, the signal padded with n / 2
 *  zeros a side as librosa.stft pads it (center=True, pad_mode='constant'), within the run as its np.pad is in its;
 *  each windowed into `frame` and handed to `fn(frame, f)` */
function frames(x, n, hop, fn) {
	let w = hann(n), frame = new Float64Array(n), F = 1 + Math.floor(x.length / hop), xp = new Float32Array(x.length + n)
	xp.set(x, n >> 1)
	for (let f = 0; f < F; f++) {
		let s = f * hop
		for (let i = 0; i < n; i++) frame[i] = xp[s + i] * w[i]
		fn(frame, f)
	}
	return F
}

// ── the modules: each row's, called as its README says ───────────────────────

let sinc = null
// `keep`: what of a run's output is kept for comparing (the first channel's first seconds, a length, a value), so no
// run's output is held while the others are timed; `mod`: what the row imports, for the packages it ran
const first = s => out => ({ length: out[0].length, head: out[0].slice(0, s) })
const MODULES = [
	{ op: 'wav_decode', name: '@audio/decode-wav', mod: '@audio/decode-wav', run: () => decodeWav(readFileSync(wav)).channelData, keep: first(SR * 10) },
	{ op: 'mp3_decode', name: '@audio/decode-mp3', mod: '@audio/decode-mp3', run: async () => (await decodeMp3(readFileSync(mp3))).channelData, keep: first(SR * 30) },
	{ op: 'lufs', name: '@audio/loudness (lufs)', mod: '@audio/loudness', run: () => lufs([L, R], { fs: SR }) },
	{ op: 'truepeak', name: '@audio/loudness (truepeak)', mod: '@audio/loudness', run: () => truepeak([L, R], { fs: SR }) },
	{ op: 'resample', name: '@audio/resample-polyphase', mod: '@audio/resample-polyphase', run: () => [L, R].map(x => polyphase(x, { from: SR, to: 48000 })), keep: first(48000 * 10) },
	// audio's own resampler (fn/resample.js, in the library: no package of its own), its sinc, which audio's a.resample
	// uses going up only when asked ({ type: 'sinc' }; linear by default)
	{ op: 'resample', name: "audio's sinc (fn/resample.js, the library's)", mod: '../fn/resample.js', library: true, run: () => [L, R].map(x => {
		let n = Math.round(x.length * 48000 / SR), y = new Float32Array(n)
		sinc(x, y, 0, n, SR / 48000)
		return y
	}), keep: first(48000 * 10) },
	// 0.8 times the tempo: 750 s out, as librosa's rate=0.8, SoX's tempo 0.8 and FFmpeg's atempo=0.8 (the factor is the
	// length's here)
	{ op: 'stretch', name: '@audio/stretch (pvoc-lock)', mod: '@audio/stretch-pvoc-lock', run: () => {
		let write = pvocLock({ factor: 1.25, channels: 2 }), a = write([L, R]), b = write()
		return a.map((x, c) => { let y = new Float32Array(x.length + b[c].length); y.set(x); y.set(b[c], x.length); return y })
	}, keep: first(0) },
	{ op: 'pitch', name: '@audio/shift (pitchShift)', mod: '@audio/shift', run: () => pitchShift([L, R], { semitones: 2 }), keep: first(SR * 20) },
	// librosa.stft(y, n_fft=1024)'s job: 1024-point Hann frames every 256 samples of the mean, each frame's complex
	// spectrum kept (float32, as librosa's complex64)
	{ op: 'fft', name: 'fourier-transform (fft)', mod: 'fourier-transform', run: () => {
		let half = 513, F = 1 + Math.floor(N / 256), re = new Float32Array(F * half), im = new Float32Array(F * half)
		frames(mono, 1024, 256, (fr, f) => fft(fr, [re.subarray(f * half, (f + 1) * half), im.subarray(f * half, (f + 1) * half)]))
		return { re, im, F, half }
	}, keep: ({ re, im, F, half }) => ({ F, half, mag: Float64Array.from({ length: 3 * half }, (_, i) => Math.hypot(re[1000 * half + i], im[1000 * half + i])) }) },
	// librosa.feature.mfcc(n_mfcc=13)'s frame grid: 2048-point Hann frames every 512 samples of the mean
	{ op: 'mfcc', name: '@audio/spectral (mfcc)', mod: '@audio/spectral-mfcc', run: () => {
		let out = []
		frames(mono, 2048, 512, fr => out.push(mfcc(fr, { fs: SR, bins: 13 })))
		return out
	}, keep: out => ({ F: out.length, c1: Float32Array.from(out, c => c[1]) }) },
	{ op: 'beat', name: '@audio/beat (beatTrack)', mod: '@audio/beat', run: () => beatTrack(mono, { fs: SR }) },
].filter(m => runs(m.op))
if (MODULES.some(m => m.library)) ({ sincInterp: sinc } = await import('../fn/resample.js'))
for (let m of MODULES) m.pkgs = graph(m.mod)

// ── SoX and FFmpeg: processes ───────────────────────────────────────────────

// each op: its run on a file (to /dev/null), and its pass-through (the same decode and encode, no op) where it encodes
const FF = (...a) => ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', ...a]
const NATIVE = {
	wav_decode: { sox: f => ['sox', f, '-t', 'f32', '/dev/null'], ffmpeg: f => FF('-i', f, '-f', 'f32le', '/dev/null') },
	mp3_decode: { sox: f => ['sox', f, '-t', 'f32', '/dev/null'], ffmpeg: f => FF('-i', f, '-f', 'f32le', '/dev/null') },
	lufs: { ffmpeg: f => FF('-i', f, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'), pass: { ffmpeg: f => FF('-i', f, '-f', 'null', '-') } },
	truepeak: { ffmpeg: f => FF('-i', f, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'), pass: { ffmpeg: f => FF('-i', f, '-f', 'null', '-') } },
	resample: { sox: f => ['sox', f, '-r', '48000', '-t', 'wav', '/dev/null'], ffmpeg: f => FF('-i', f, '-ar', '48000', '-f', 'wav', '/dev/null') },
	stretch: { sox: f => ['sox', f, '-t', 'wav', '/dev/null', 'tempo', '0.8'], ffmpeg: f => FF('-i', f, '-af', 'atempo=0.8', '-f', 'wav', '/dev/null') },
	// FFmpeg's pitch: the rate set higher and resampled back, tempo and length with it (no rubberband in this build)
	pitch: { sox: f => ['sox', f, '-t', 'wav', '/dev/null', 'pitch', '200'], ffmpeg: f => FF('-i', f, '-af', `asetrate=${SR * 2 ** (2 / 12)},aresample=${SR}`, '-f', 'wav', '/dev/null') },
}
for (let op of ['resample', 'stretch', 'pitch']) NATIVE[op].pass = { sox: f => ['sox', f, '-t', 'wav', '/dev/null'], ffmpeg: f => FF('-i', f, '-f', 'wav', '/dev/null') }
const has = c => spawnSync('which', [c]).status === 0
const TOOLS = ['sox', 'ffmpeg'].filter(has)
// a SoX that prints no version (Homebrew's says `SoX v`) named by where it is installed
const toolVersion = {
	sox: () => spawnSync('sox', ['--version'], { encoding: 'utf8' }).stdout.match(/v(\d\S*)/)?.[1] ?? realpathSync(execFileSync('which', ['sox'], { encoding: 'utf8' }).trim()),
	ffmpeg: () => spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).stdout.match(/version (\S+)/)?.[1],
}
const srcOf = op => op === 'mp3_decode' ? 'mp3' : 'wav'
function proc(args) {
	let s = performance.now(), r = spawnSync('/usr/bin/time', ['-p', ...args], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] }), t = performance.now() - s
	if (r.status) throw Error(`${args.join(' ')}: ${r.stderr}`)
	return [t, ((+r.stderr.match(/user\s+([\d.]+)/)[1]) + (+r.stderr.match(/sys\s+([\d.]+)/)[1])) * 1000]
}

// ── runs ────────────────────────────────────────────────────────────────────

const sorted = a => a.slice().sort((x, y) => x - y), best = a => sorted(a)[0], median = a => sorted(a)[a.length >> 1]
const load1 = () => loadavg()[0]
let rows = MODULES.map(m => ({ ...m, wall: [], cpu: [], load: [] })), made = {}
console.error(`# ${DUR} s fixture, ${REPS} runs a cell; modules${ONLY ? ': ' + [...ONLY].join(', ') : ''}${CHECKOUT.size ? '; from checkouts: ' + [...CHECKOUT.keys()].join(', ') : ''}`)
for (let r of rows) {
	// the first run's output kept for comparing; one of over 20 s stands as the module's one run (cold)
	gc()
	let l = load1(), c = process.cpuUsage(), t = performance.now(), out = await r.run()
	t = performance.now() - t; c = process.cpuUsage(c)
	made[r.name] = r.keep ? r.keep(out) : out
	if (t > 20000) { r.cold = true; r.wall.push(t); r.cpu.push((c.user + c.system) / 1000); r.load.push(l) }
	else { out = null; await r.run() }
}
for (let i = 0; i < REPS; i++) for (let k = 0; k < rows.length; k++) {
	let r = rows[(k + i) % rows.length]
	if (r.cold) continue
	gc()
	let l = load1(), c = process.cpuUsage(), t = performance.now(), out = await r.run()
	t = performance.now() - t; c = process.cpuUsage(c)
	r.wall.push(t); r.cpu.push((c.user + c.system) / 1000); r.load.push(l); out = null
}

// librosa's and Pedalboard's cells, by tool and op; what each made, by op and tool
let py = { cells: {}, checks: {}, versions: null }
if (PY) {
	console.error('# librosa, Pedalboard')
	let raw = execFileSync(PY, [join(HERE, 'modules.py'), wav, mp3, OUT, String(REPS), ONLY ? [...ONLY].join(',') : ''], { encoding: 'utf8', maxBuffer: 1 << 26 })
	for (let line of raw.trim().split('\n')) {
		let j = JSON.parse(line)
		if (j.versions) py.versions = j.versions
		else if (j.check) (py.checks[j.check] ??= {})[j.tool] = j
		else (py.cells[j.op] ??= {})[j.tool] = j
	}
}
const pyCheck = (op, tool) => py.checks[op]?.[tool]
const pyFile = (tool, op) => join(OUT, `${tool === 'pedalboard' ? 'pb' : 'lr'}_${op}.f32`)

console.error('# SoX, FFmpeg')
let nat = []
for (let [op, t] of Object.entries(NATIVE)) if (runs(op)) for (let tool of TOOLS) if (t[tool]) nat.push({ op, tool, cmd: t[tool], pass: t.pass?.[tool], wall: [], cpu: [], start: [], through: [], load: [] })
for (let i = 0; i < REPS; i++) for (let k = 0; k < nat.length; k++) {
	let n = nat[(k + i) % nat.length], src = srcOf(n.op)
	n.load.push(load1())
	let [w, c] = proc(n.cmd(src === 'mp3' ? mp3 : wav))
	n.wall.push(w); n.cpu.push(c); n.start.push(proc(n.cmd(tiny[src]))[0])
	if (n.pass) n.through.push(proc(n.pass(wav))[0])
}

// ── what each made, compared ────────────────────────────────────────────────

const f32 = p => { let b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.length >> 2) }
const raw = (args, chans = 2) => { let b = execFileSync(args[0], args.slice(1), { maxBuffer: 2 ** 31 }); let x = new Float32Array(Uint8Array.prototype.slice.call(b).buffer); return Array.from({ length: chans }, (_, c) => Float32Array.from({ length: x.length / chans }, (_, i) => x[i * chans + c])) }
const ffRaw = (f, ...af) => raw(FF('-i', f, ...af, '-f', 'f32le', '-'))
const soxRaw = (f, ...fx) => raw(['sox', f, '-t', 'f32', '-', ...fx])
/** SNR in dB of y against x: y shifted by the lag (±maxLag) that matches them best over 2 s from a, over [a, b) of x */
function snr(x, y, a, b, maxLag = 64) {
	let bestLag = 0, bestC = -Infinity
	for (let lag = -maxLag; lag <= maxLag; lag++) { let c = 0; for (let i = a, e = Math.min(b, a + 2 * SR); i < e; i++) c += x[i] * (y[i + lag] ?? 0); if (c > bestC) { bestC = c; bestLag = lag } }
	let s = 0, e = 0
	for (let i = a; i < b; i++) { let d = (y[i + bestLag] ?? 0) - x[i]; s += x[i] * x[i]; e += d * d }
	return { db: 10 * Math.log10(s / e), lag: bestLag }
}
const corr = (a, b) => { let n = Math.min(a.length, b.length), ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] } ma /= n; mb /= n; let sab = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { let u = a[i] - ma, v = b[i] - mb; sab += u * v; sa += u * u; sb += v * v } return sab / Math.sqrt(sa * sb) }
/** The strongest frequency between lo and hi Hz in the first 2^19 samples of x (Hann, the peak's bin refined by a parabola) */
function peakHz(x, rate, lo, hi) {
	let n = 1 << 19, w = hann(n), fr = new Float64Array(n)
	for (let i = 0; i < n; i++) fr[i] = (x[i] ?? 0) * w[i]
	let [re, im] = fft(fr), mag = k => Math.hypot(re[k], im[k]), k0 = Math.ceil(lo * n / rate), k1 = Math.floor(hi * n / rate), kb = k0
	for (let k = k0; k <= k1; k++) if (mag(k) > mag(kb)) kb = k
	let [a, b, c] = [mag(kb - 1), mag(kb), mag(kb + 1)].map(Math.log)
	return (kb + 0.5 * (a - c) / (a - 2 * b + c)) * rate / n
}
/** How far y lags x at hz, in samples (fractional, negative where y leads): the phase of their cross-spectrum at that
 *  bin of the first 2^19 samples, Hann-windowed; within half a period of hz */
function delay(x, y, rate, hz) {
	let n = 1 << 19, w = hann(n), bin = Math.round(hz * n / rate), spec = s => { let [re, im] = fft(Float64Array.from({ length: n }, (_, i) => (s[i] ?? 0) * w[i])); return [re[bin], im[bin]] }
	let [a, b] = spec(x), [c, d] = spec(y)
	return -Math.atan2(d * a - c * b, c * a + d * b) / (2 * Math.PI * bin / n)
}
/** Beats against the fixture's kicks, one each half second from 0 (fixtures.js: a 60 Hz pulse at 120 BPM), as mir_eval
 *  scores them: beats before 5 s left out, a hit within 70 ms (mir_eval.beat.f_measure, its defaults) */
function fBeats(est) {
	let ref = Array.from({ length: Math.floor(DUR * 2) }, (_, k) => k / 2).filter(t => t >= 5), e = [...est].filter(t => t >= 5), used = new Set(), hit = 0
	for (let t of ref) { let j = e.findIndex((u, i) => !used.has(i) && Math.abs(u - t) <= 0.07); if (j >= 0) { used.add(j); hit++ } }
	let p = hit / e.length, r = hit / ref.length
	return p + r ? 2 * p * r / (p + r) : 0
}
let checks = {}, say = (op, who, s) => (checks[op] ??= {})[who] = s
const PYTOOLS = ['librosa', 'pedalboard']

// decodes: lengths, and samples against decode-wav's (the WAV) or FFmpeg's (the MP3)
if (runs('wav_decode')) {
	let w = made['@audio/decode-wav']
	say('wav_decode', 'audio', `${w.length} frames`)
	for (let tool of PYTOOLS) if (pyCheck('wav_decode', tool)) say('wav_decode', tool, `${pyCheck('wav_decode', tool).frames} frames; first 10 s ${f32(pyFile(tool, 'wav_decode')).every((v, i) => Object.is(v, w.head[i])) ? 'bit-equal to' : 'not equal to'} decode-wav's`)
}
if (runs('mp3_decode')) {
	let m = made['@audio/decode-mp3'], [fm] = ffRaw(mp3), a = SR
	const vs = (y, n) => { let s = snr(fm, y, a, Math.min(SR * 29, y.length, fm.length) - 2400, 2400); return `${n} frames; against FFmpeg's ${fm.length}: SNR ${s.db.toFixed(1)} dB (lag ${s.lag})` }
	say('mp3_decode', 'audio', vs(m.head, m.length))
	if (TOOLS.includes('sox')) { let [sm] = soxRaw(mp3); say('mp3_decode', 'sox', vs(sm, sm.length)) }
	say('mp3_decode', 'ffmpeg', `${fm.length} frames`)
	for (let tool of PYTOOLS) if (pyCheck('mp3_decode', tool)) say('mp3_decode', tool, vs(f32(pyFile(tool, 'mp3_decode')), pyCheck('mp3_decode', tool).frames))
}
// loudness: the figures, against FFmpeg's ebur128 and audio's own stat
if (runs('lufs') || runs('truepeak')) {
	let e = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
	let I = +e.match(/I:\s+(-?[\d.]+) LUFS/)?.[1], P = +e.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]
	if (runs('lufs')) { say('lufs', 'audio', `${made['@audio/loudness (lufs)'].toFixed(2)} LUFS`); say('lufs', 'ffmpeg', `${I} LUFS (ebur128, one decimal)`) }
	if (runs('truepeak')) { say('truepeak', 'audio', `${made['@audio/loudness (truepeak)'].toFixed(2)} dBTP (4× oversampled)`); say('truepeak', 'ffmpeg', `${P} dBTP (ebur128 peak=true, 4×)`) }
}
// resample: lengths, and the first 10 s of the first channel against soxr's VHQ (python-soxr, its best quality)
if (runs('resample')) {
	let ref = PY && f32(join(OUT, 'lr_resample_ref.f32'))
	let cmp = y => ref ? `; against soxr VHQ: SNR ${snr(ref, y, 48000, 48000 * 9).db.toFixed(1)} dB, ${delay(ref, y, 48000, 440).toFixed(2)} samples later at 440 Hz` : ''
	for (let [who, name] of [['audio', '@audio/resample-polyphase'], ['audio sinc', "audio's sinc (fn/resample.js, the library's)"]]) say('resample', who, `${made[name].length} frames${cmp(made[name].head)}`)
	if (TOOLS.includes('sox')) { let [y] = soxRaw(wav, 'rate', '48000'); say('resample', 'sox', `${y.length} frames${cmp(y)}`) }
	if (TOOLS.includes('ffmpeg')) { let [y] = ffRaw(wav, '-ar', '48000'); say('resample', 'ffmpeg', `${y.length} frames${cmp(y)}`) }
	for (let tool of PYTOOLS) if (pyCheck('resample', tool)) say('resample', tool, `${pyCheck('resample', tool).frames} frames${cmp(f32(pyFile(tool, 'resample')))}`)
}
// stretch: lengths (750 s); pitch: lengths, and where the 220 Hz tone went (220 · 2^(2/12) = 246.94 Hz in 12-TET)
if (runs('stretch')) {
	say('stretch', 'audio', `${(made['@audio/stretch (pvoc-lock)'].length / SR).toFixed(2)} s`)
	if (TOOLS.includes('sox')) say('stretch', 'sox', `${(soxRaw(wav, 'tempo', '0.8')[0].length / SR).toFixed(2)} s`)
	if (TOOLS.includes('ffmpeg')) say('stretch', 'ffmpeg', `${(ffRaw(wav, '-af', 'atempo=0.8')[0].length / SR).toFixed(2)} s`)
	for (let tool of PYTOOLS) if (pyCheck('stretch', tool)) say('stretch', tool, `${(pyCheck('stretch', tool).frames / SR).toFixed(2)} s`)
}
if (runs('pitch')) {
	let p = made['@audio/shift (pitchShift)'], tone = y => `the 220 Hz tone at ${peakHz(y, SR, 200, 300).toFixed(2)} Hz`
	say('pitch', 'audio', `${(p.length / SR).toFixed(2)} s; ${tone(p.head)}`)
	if (TOOLS.includes('sox')) { let [y] = soxRaw(wav, 'pitch', '200'); say('pitch', 'sox', `${(y.length / SR).toFixed(2)} s; ${tone(y)}`) }
	if (TOOLS.includes('ffmpeg')) { let [y] = ffRaw(wav, '-af', `asetrate=${SR * 2 ** (2 / 12)},aresample=${SR}`); say('pitch', 'ffmpeg', `${(y.length / SR).toFixed(2)} s; ${tone(y)}`) }
	for (let tool of PYTOOLS) if (pyCheck('pitch', tool)) say('pitch', tool, `${(pyCheck('pitch', tool).frames / SR).toFixed(2)} s; ${tone(f32(pyFile(tool, 'pitch')))}`)
}
// fft: frames, and three frames' magnitudes against librosa's; mfcc: frames, and c1's course against librosa's
if (runs('fft')) {
	let { mag, F, half } = made['fourier-transform (fft)']
	say('fft', 'audio', `${F} frames × ${half} bins`)
	if (pyCheck('fft', 'librosa')) {
		let lr = f32(pyFile('librosa', 'fft')), max = 0, top = 0
		for (let i = 0; i < 3 * half; i++) { top = Math.max(top, mag[i]); max = Math.max(max, Math.abs(mag[i] - lr[i])) }
		say('fft', 'librosa', `${pyCheck('fft', 'librosa').frames} frames × ${pyCheck('fft', 'librosa').bins} bins; frames 1000–1002: |X| within ${(max / top).toExponential(1)} of the largest`)
	}
}
if (runs('mfcc')) {
	let { F: mfF, c1 } = made['@audio/spectral (mfcc)']
	say('mfcc', 'audio', `${mfF} frames × 13`)
	if (pyCheck('mfcc', 'librosa')) say('mfcc', 'librosa', `${pyCheck('mfcc', 'librosa').frames} frames × 13; c1 over time against the module's: r = ${corr(c1, f32(pyFile('librosa', 'mfcc'))).toFixed(3)}`)
}
// beat: BPM, and F-measure against the kicks
if (runs('beat')) {
	let b = made['@audio/beat (beatTrack)'], lr = pyCheck('beat', 'librosa')
	say('beat', 'audio', `${b.bpm.toFixed(1)} BPM, ${b.beats.length} beats, F ${fBeats(b.beats).toFixed(3)} against the kicks`)
	if (lr) say('beat', 'librosa', `${lr.bpm.toFixed(1)} BPM, ${lr.beats.length} beats, F ${fBeats(lr.beats).toFixed(3)} against the kicks`)
}

// ── report ──────────────────────────────────────────────────────────────────

const ms = x => x == null ? '' : x >= 1000 ? (x / 1000).toFixed(2) + ' s' : x >= 100 ? x.toFixed(0) + ' ms' : x.toFixed(1) + ' ms'
const loads = l => `load ${Math.min(...l).toFixed(1)}–${Math.max(...l).toFixed(1)}`
const LABEL = { wav_decode: 'WAV decode', mp3_decode: 'MP3 decode', lufs: 'LUFS measurement', truepeak: 'True peak (proposed for Peak normalize)', resample: 'Resample 44.1k→48k', stretch: 'Time stretch 0.8×', pitch: 'Pitch shift +2 st', fft: 'FFT spectrum (1024-pt)', mfcc: 'MFCC (13 coeff)', beat: 'Beat tracking' }
let results = []
console.log(`\n${new Date().toISOString()}, node ${process.version}${CHECKOUT.size ? `, BENCH_CHECKOUT=${[...CHECKOUT.keys()].join(',')}` : ''}`)
console.log('\n| Operation | module (in-process) | librosa (in-process) | Pedalboard (in-process) | SoX (process) | FFmpeg (process) |\n|---|---|---|---|---|---|')
for (let [op, label] of Object.entries(LABEL)) {
	if (!runs(op)) continue
	let mods = rows.filter(r => r.op === op), lr = py.cells[op]?.librosa, pb = py.cells[op]?.pedalboard
	let cell = r => `${ms(best(r.wall))} (median ${ms(median(r.wall))}, CPU ${ms(best(r.cpu))}; ${loads(r.load)})${r.cold ? ', one cold run' : ''}`
	let natCell = tool => {
		let n = nat.find(n => n.op === op && n.tool === tool)
		if (!n) return '—'
		let w = best(n.wall), s = w - best(n.start), p = n.through.length ? w - best(n.through) : null
		return `${ms(w)} whole; ${ms(s)} net of start${p != null ? `; ${p > 0 ? ms(p) + ' net of pass-through' : 'within its pass-through'} (${ms(best(n.through))})` : ''}; ${loads(n.load)}`
	}
	console.log(`| ${label} | ${mods.map(m => `${m.name}: ${cell(m)}`).join('<br>')} | ${lr ? cell(lr) : '—'} | ${pb ? `${pb.method}: ${cell(pb)}` : '—'} | ${natCell('sox')} | ${natCell('ffmpeg')} |`)
	for (let m of mods) results.push({ op, tool: m.name, packages: m.pkgs, basis: 'in-process', wall: m.wall, cpu: m.cpu, load: m.load })
	for (let c of [lr, pb]) if (c) results.push({ op, tool: c.tool, method: c.method, basis: 'in-process', wall: c.wall, cpu: c.cpu, load: c.load })
	for (let n of nat.filter(n => n.op === op)) results.push({ op, tool: n.tool, basis: 'process', wall: n.wall, cpu: n.cpu, start: n.start, through: n.through, load: n.load })
}
console.log('\n| Operation | what each made |\n|---|---|')
for (let [op, label] of Object.entries(LABEL)) if (checks[op]) console.log(`| ${label} | ${Object.entries(checks[op]).map(([k, v]) => `${k}: ${v}`).join('<br>')} |`)
console.log('\nWhat each row ran (package, version, path; * from its checkout):')
for (let r of rows) console.log(`- ${r.name}: ${r.pkgs.map(p => `${p.name} ${p.version}${p.checkout ? '*' : ''} (${p.dir})`).join(', ')}`)
let versions = { ...Object.fromEntries(TOOLS.map(t => [t, toolVersion[t]()])), ...py.versions }
if (Object.keys(versions).length) console.log(`\nTools: ${Object.entries(versions).map(([k, v]) => `${k} ${v}`).join(', ')}`)
if (process.env.BENCH_JSON) writeFileSync(process.env.BENCH_JSON, JSON.stringify({ dur: DUR, reps: REPS, at: new Date().toISOString(), node: process.version, checkout: Object.fromEntries(CHECKOUT), versions, results, checks }, null, 2) + '\n')
process.exit(0)
