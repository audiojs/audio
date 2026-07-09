// Reverb-family atoms exercised through the real engine (audio.use + .read()).
// One defining-property test per atom: the tail rings past the dry source and the
// declared tail extends the duration. schroeder streams (params-state kernel);
// plate/fdn/spring/shimmer are whole-render (streaming: false + engine tail pad).

import test, { ok, is } from 'tst'
import audio from '../audio.js'

import { schroeder } from '@audio/reverb-schroeder/atom'
import { plate } from '@audio/reverb-dattorro/atom'
import { fdn } from '@audio/reverb-fdn/atom'
import { spring } from '@audio/reverb-spring/atom'
import { shimmer } from '@audio/reverb-shimmer/atom'

audio.use(schroeder, plate, fdn, spring, shimmer)

const SR = 44100

function burst(dur = 0.15, amp = 0.8, sr = SR) {
	let n = Math.round(dur * sr), d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = amp * Math.sin(2 * Math.PI * 440 * i / sr) * (1 - i / n)
	return d
}
function rms(d, from = 0, to = d.length) { let s = 0; for (let i = from; i < to; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(1, to - from)) }

async function ringsOut(name, opts = {}) {
	let src = burst()
	let a = audio.from([src.slice()], { sampleRate: SR })
	a[name]({ mix: 0.5, ...opts })
	ok(a.duration > 0.15 + 0.05, `${name}: declared tail extends duration (${a.duration.toFixed(2)}s)`)
	let out = (await a.read())[0]
	let tail = rms(out, Math.round(0.2 * SR), Math.min(out.length, Math.round(0.6 * SR)))
	ok(tail > 1e-4, `${name}: rings past the source (${tail.toExponential(1)})`)
	ok(out.every(isFinite), `${name}: finite`)
}

test('schroeder: decay rings past the dry burst', () => ringsOut('schroeder'))
test('plate (dattorro): whole-render tank rings out', () => ringsOut('plate'))
test('fdn: uniform-T60 network rings out', () => ringsOut('fdn'))
test('spring: dispersive loop rings out', () => ringsOut('spring'))
test('shimmer: octave-up feedback rings out', () => ringsOut('shimmer'))

test('plate: stereo tank decorrelates channels', async () => {
	let src = burst()
	let [l, r] = await audio.from([src.slice(), src.slice()], { sampleRate: SR }).plate({ mix: 1, decay: 0.7 }).read()
	let diff = 0
	for (let i = Math.round(0.2 * SR); i < Math.min(l.length, Math.round(0.5 * SR)); i++) diff = Math.max(diff, Math.abs(l[i] - r[i]))
	ok(diff > 1e-4, `identical input, decorrelated wet field (${diff.toExponential(1)})`)
})
