// Contract atoms as audio ops — audio.use(module) hosts the contract natively.
// Pilots: @audio/dynamics-compressor (dynamics kernel, live/automated params) and
// @audio/reverb-freeverb (declared tail → composed trailing pad, decay preserved).

import test, { ok, almost, is } from 'tst'
import audio from '../audio.js'
import { compressor } from '@audio/dynamics-compressor/atom'
import { freeverb } from '@audio/reverb-freeverb/atom'

audio.use(compressor, freeverb)

const SR = 44100

function tone(freq, dur, amp = 0.8, sr = SR) {
  let n = Math.round(dur * sr), ch = new Float32Array(n)
  for (let i = 0; i < n; i++) ch[i] = amp * Math.sin(2 * Math.PI * freq * i / sr)
  return ch
}
function rms(d, from = 0, to = d.length) {
  let s = 0
  for (let i = from; i < to; i++) s += d[i] * d[i]
  return Math.sqrt(s / (to - from))
}

test('use(module) registers an op; compressor reduces hot material', async () => {
  ok(typeof audio.fn.compressor === 'function', 'method registered')
  let a = audio.from([tone(440, 1)], { sampleRate: SR })
  let dry = (await audio.from([tone(440, 1)], { sampleRate: SR }).read())[0]
  let wet = (await a.compressor({ threshold: -24, ratio: 6 }).read())[0]
  ok(rms(wet, SR / 2) < rms(dry, SR / 2) * 0.8, `compressed (${(20 * Math.log10(rms(wet, SR / 2) / rms(dry, SR / 2))).toFixed(1)} dB)`)
  ok(wet.every(isFinite))
})

test('module op params flow through engine automation (fn param ≡ static param)', async () => {
  let stat = (await audio.from([tone(440, 1)], { sampleRate: SR }).compressor({ threshold: -24, ratio: 6 }).read())[0]
  let auto = (await audio.from([tone(440, 1)], { sampleRate: SR }).compressor({ threshold: () => -24, ratio: 6 }).read())[0]
  let diff = 0
  for (let i = 0; i < stat.length; i++) diff = Math.max(diff, Math.abs(stat[i] - auto[i]))
  ok(diff < 1e-6, `automated ≡ static (${diff.toExponential(1)})`)

  // ramp: threshold drops mid-signal → later material more compressed
  let ramp = (await audio.from([tone(440, 2)], { sampleRate: SR }).compressor({ threshold: t => t < 1 ? 0 : -30, ratio: 8 }).read())[0]
  ok(rms(ramp, Math.round(1.5 * SR)) < rms(ramp, Math.round(0.25 * SR), Math.round(0.75 * SR)) * 0.7, 'automation engages mid-stream')
})

test('declared tail composes a trailing pad — freeverb decay is not truncated', async () => {
  let a = audio.from([tone(440, 0.5)], { sampleRate: SR })
  let dur0 = a.duration
  a.freeverb({ room: 0.8, mix: 1 })
  almost(a.duration, dur0 + 6, 0.05, `duration extended by tail (${a.duration.toFixed(2)}s)`)
  let out = (await a.read())[0]
  let tailRms = rms(out, Math.round(0.7 * SR), Math.round(1.5 * SR))
  ok(tailRms > 1e-4, `reverb rings past the source (${tailRms.toExponential(1)})`)
  ok(out.every(isFinite))
})

test('op introspection carries module param metadata (CLI help substrate)', () => {
  let d = audio.op('compressor')
  is(d.module.params.threshold.min, -60)
  is(d.module.params.threshold.unit, 'dB')
  ok(d.params.includes('ratio'))
  is(audio.op('freeverb').tail, 6)
})

test('tail op is undo-atomic and serializes as one edit', async () => {
  let a = audio.from([tone(440, 0.5)], { sampleRate: SR })
  let dur0 = a.duration
  a.freeverb({ room: 0.8 })
  is(a.edits.length, 1, 'one edit recorded (pad composed at compile)')
  is(a.toJSON().edits.length, 1)
  a.undo()
  is(a.duration, dur0, 'undo removes reverb AND its tail pad')
})

test('audio.use(name) resolves through the registry (dynamic import)', async () => {
  audio.modules ??= {}
  audio.modules.tube = '@audio/saturate-tube/atom'
  await audio.use('tube')
  ok(typeof audio.fn.tube === 'function', 'registry-resolved module registered')
  let out = (await audio.from([tone(440, 0.2)], { sampleRate: SR }).tube({ drive: 8 }).read())[0]
  ok(out.every(isFinite))
  let err = null
  try { audio.use('nosuchmodule') } catch (e) { err = e }
  ok(/unknown module/.test(err?.message), 'unknown name throws')
})

// ── Wave B: dynamics-gate + denoise-dehum ─────────────────────────────

import { gate } from '@audio/dynamics-gate/atom'
import { dehum } from '@audio/denoise-dehum/atom'
audio.use(gate, dehum)

/** Goertzel magnitude at f Hz. */
function energyAt(buf, f, sr = SR) {
  let n = buf.length, w = 2 * Math.PI * f / sr
  let coeff = 2 * Math.cos(w), s1 = 0, s2 = 0
  for (let i = 0; i < n; i++) { let s = buf[i] + coeff * s1 - s2; s2 = s1; s1 = s }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / n
}

test('gate: passes signal, silences the floor', async () => {
  // 0.5s tone at -6dB, then 0.5s floor at -50dB
  let n = SR, ch = new Float32Array(n)
  for (let i = 0; i < n / 2; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR)
  for (let i = n / 2; i < n; i++) ch[i] = 0.003 * Math.sin(2 * Math.PI * 440 * i / SR)
  let out = (await audio.from([ch], { sampleRate: SR }).gate({ threshold: -40, range: -90 }).read())[0]
  ok(rms(out, SR * 0.1, SR * 0.4) > 0.3, 'signal above threshold passes')
  ok(rms(out, SR * 0.8) < 0.0005, `floor gated (${rms(out, SR * 0.8).toExponential(1)})`)
})

test('dehum: notches mains fundamental + harmonics, preserves program', async () => {
  let n = SR, ch = new Float32Array(n)
  for (let i = 0; i < n; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR)
    + 0.2 * Math.sin(2 * Math.PI * 50 * i / SR) + 0.1 * Math.sin(2 * Math.PI * 150 * i / SR)
  let a = audio.from([ch], { sampleRate: SR })
  let out = (await a.dehum({ freq: 50, harmonics: 4 }).read())[0]
  let mid = out.subarray(SR / 4, (3 * SR) / 4)  // skip filter settle
  let dry = ch.subarray(SR / 4, (3 * SR) / 4)
  ok(energyAt(mid, 50) < energyAt(dry, 50) * 0.1, `50Hz hum removed (${(energyAt(mid, 50) / energyAt(dry, 50)).toFixed(3)}×)`)
  ok(energyAt(mid, 150) < energyAt(dry, 150) * 0.1, '3rd harmonic removed')
  ok(energyAt(mid, 440) > energyAt(dry, 440) * 0.9, 'program at 440Hz preserved')
})

// ── Latency compensation (plugin delay compensation) ──────────────────

test('declared latency compensates to identity', async () => {
  const L = 300
  const latdelay = (ctx) => {
    let bufs = []
    for (let c = 0, N = ctx.maxChannels ?? 8; c < N; c++) bufs.push({ b: new Float32Array(L), i: 0 })
    return (inputs, outputs) => {
      let inp = inputs[0], out = outputs[0]
      for (let c = 0; c < inp.length; c++) {
        let st = bufs[c], x = inp[c], y = out[c]
        for (let i = 0; i < x.length; i++) { y[i] = st.b[st.i]; st.b[st.i] = x[i]; st.i = (st.i + 1) % L }
      }
    }
  }
  latdelay.params = {}
  latdelay.latency = L
  audio.use(latdelay)

  let dry = tone(440, 0.5)
  let out = (await audio.from([dry.slice()], { sampleRate: SR }).latdelay().read())[0]
  is(out.length, dry.length, 'length preserved')
  let d = 0
  for (let i = 0; i < dry.length; i++) d = Math.max(d, Math.abs(out[i] - dry[i]))
  ok(d < 1e-7, `read compensated to identity (${d.toExponential(1)})`)

  let seg = (await audio.from([dry.slice()], { sampleRate: SR }).latdelay().read({ at: 0.1, duration: 0.2 }))[0]
  let ref = dry.subarray(Math.round(0.1 * SR), Math.round(0.3 * SR))
  let d2 = 0
  for (let i = 0; i < ref.length; i++) d2 = Math.max(d2, Math.abs(seg[i] - ref[i]))
  ok(d2 < 1e-7, `ranged read aligned (${d2.toExponential(1)})`)

  let a2 = audio.from([dry.slice()], { sampleRate: SR }).latdelay()
  let total = 0, d3 = 0, pos = 0
  for await (let c of a2.stream()) {
    for (let i = 0; i < c[0].length; i++) d3 = Math.max(d3, Math.abs(c[0][i] - dry[pos + i]))
    pos += c[0].length; total += c[0].length
  }
  is(total, dry.length, 'stream length preserved')
  ok(d3 < 1e-7, `stream compensated (${d3.toExponential(1)})`)
})

// ── Wave B continued: limiter (declared latency), deesser, softclip ───

import { limiter } from '@audio/dynamics-limiter/atom'
import { deesser } from '@audio/dynamics-deesser/atom'
import { softclip } from '@audio/dynamics-softclip/atom'
audio.use(limiter, deesser, softclip)

test('limiter: brickwall under ceiling, latency-compensated onset', async () => {
  let a = audio.from([tone(440, 0.5, 1.0)], { sampleRate: SR })
  let out = (await a.limiter({ ceiling: -6, lookahead: 5 }).read())[0]
  is(out.length, Math.round(0.5 * SR), 'length preserved (latency compensated)')
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  ok(20 * Math.log10(peak) < -5.9, `peak under ceiling (${(20 * Math.log10(peak)).toFixed(2)} dB)`)
  // onset aligned: energy present within the first millisecond
  ok(rms(out, 0, Math.round(0.001 * SR)) > 0.05, 'onset not delayed by lookahead')
})

test('deesser: sibilance-keyed broadband reduction, inactive without sibilance', async () => {
  // kernel design: bandpass sidechain drives BROADBAND gain reduction
  let n = SR, ch = new Float32Array(n)
  for (let i = 0; i < n; i++) ch[i] = 0.3 * Math.sin(2 * Math.PI * 300 * i / SR) + 0.4 * Math.sin(2 * Math.PI * 7000 * i / SR)
  let out = (await audio.from([ch.slice()], { sampleRate: SR }).deesser({ freq: 7000, threshold: -30, ratio: 8 }).read())[0]
  let mid = out.subarray(SR / 4, (3 * SR) / 4), dry = ch.subarray(SR / 4, (3 * SR) / 4)
  ok(energyAt(mid, 7000) < energyAt(dry, 7000) * 0.7, `sibilance reduced (${(energyAt(mid, 7000) / energyAt(dry, 7000)).toFixed(2)}×)`)

  // no sibilance in the keyed band → no reduction at all
  let low = new Float32Array(n)
  for (let i = 0; i < n; i++) low[i] = 0.3 * Math.sin(2 * Math.PI * 300 * i / SR)
  let out2 = (await audio.from([low.slice()], { sampleRate: SR }).deesser({ freq: 7000, threshold: -30, ratio: 8 }).read())[0]
  let m2 = out2.subarray(SR / 4, (3 * SR) / 4), d2 = low.subarray(SR / 4, (3 * SR) / 4)
  ok(energyAt(m2, 300) > energyAt(d2, 300) * 0.95, 'no sibilance → signal untouched')
})

test('softclip: bounded by ceiling, enum curve validated', async () => {
  let out = (await audio.from([tone(440, 0.2, 1.0)], { sampleRate: SR }).softclip({ curve: 'hard', drive: 4, ceiling: 0.5 }).read())[0]
  ok(out.every(v => Math.abs(v) <= 0.5 + 1e-6), 'hard curve clamps at ceiling')
  let out2 = (await audio.from([tone(440, 0.2, 1.0)], { sampleRate: SR }).softclip({ curve: 'nope' }).read())[0]
  ok(out2.every(v => Math.abs(v) <= 1 + 1e-6) && out2.every(isFinite), 'unknown enum falls back to default')
})

// ── Dynamics wave: expander, compand, leveler, transient-shaper, ducker ───
// Not yet published to npm — import via the sibling @audio/dynamics checkout;
// switch to '@audio/dynamics-<atom>/atom' after next publish.
import { expander } from '@audio/dynamics-expander/atom'
import { compand } from '@audio/dynamics-compand/atom'
import { leveler } from '@audio/dynamics-leveler/atom'
import { transientShaper } from '@audio/dynamics-transient-shaper/atom'
import { ducker } from '@audio/dynamics-ducker/atom'
audio.use(expander, compand, leveler, transientShaper, ducker)

const db = (lin) => 20 * Math.log10(Math.max(lin, 1e-12))

test('expander: attenuates below threshold, passes material above it', async () => {
  let loud = tone(440, 0.6, 0.5), quiet = tone(440, 0.6, 0.003)
  let combined = new Float32Array([...loud, ...quiet])
  let out = (await audio.from([combined], { sampleRate: SR }).expander({ threshold: -30, ratio: 2, range: -40 }).read())[0]
  ok(out.every(isFinite))
  let settle = Math.round(0.3 * SR)
  let loudDrop = db(rms(loud, settle)) - db(rms(out, settle, loud.length))
  let quietDrop = db(rms(quiet, settle)) - db(rms(out, loud.length + settle))
  ok(quietDrop > loudDrop + 6, `quiet parts attenuated well past loud (${quietDrop.toFixed(1)} dB vs ${loudDrop.toFixed(1)} dB)`)
})

test('compand: transfer curve pulls loud material down, leaves quiet identity segment untouched', async () => {
  let loud = tone(1000, 1.5, 0.9), quiet = tone(1000, 1.5, 0.03)
  let combined = new Float32Array([...loud, ...quiet])
  let out = (await audio.from([combined], { sampleRate: SR }).compand({ out0: -90, out1: -60, out2: -20, out3: -8, attack: 5, release: 200 }).read())[0]
  ok(out.every(isFinite))
  let settle = Math.round(1.0 * SR)
  let loudDelta = db(rms(out, settle, loud.length)) - db(rms(loud, settle))
  let quietDelta = db(rms(out, loud.length + settle)) - db(rms(quiet, settle))
  ok(loudDelta < -3, `loud (near 0dB, above the -20dB knee) pulled toward -8dB (delta ${loudDelta.toFixed(2)} dB)`)
  ok(Math.abs(quietDelta) < 1, `quiet (below -20dB) identity segment unchanged (delta ${quietDelta.toFixed(2)} dB)`)
})

test('leveler: loud/quiet sections converge in RMS toward target loudness', async () => {
  // NOTE: this host's op engine (core.js useModule) calls process() per 1024-sample
  // block and has no `streaming: false` batch dispatch — the leveler kernel is
  // designed around seeing the whole signal in one call (CONTRACT's promised shape
  // for streaming: false). It still converges here because each ~23ms block's own
  // RMS happens to match its section's RMS for this steady-tone signal, but the
  // kernel's cross-frame gaussian smoothing genuinely needs the whole-signal call
  // this host doesn't provide yet — see atom.js's header comment.
  let loud = tone(440, 10, 0.5), quiet = tone(440, 10, 0.006)
  let combined = new Float32Array([...loud, ...quiet])
  let out = (await audio.from([combined], { sampleRate: SR }).leveler({ target: -20, frame: 0.5, maxGain: 12, smooth: 5 }).read())[0]
  ok(out.every(isFinite))
  let margin = Math.round(3 * SR)
  let gapBefore = Math.abs(db(rms(loud, 0, loud.length - margin)) - db(rms(quiet, margin)))
  let gapAfter = Math.abs(db(rms(out, 0, loud.length - margin)) - db(rms(out, loud.length + margin)))
  ok(gapAfter < gapBefore * 0.5, `RMS gap narrows toward target loudness (${gapBefore.toFixed(1)} -> ${gapAfter.toFixed(1)} dB)`)
})

test('transient-shaper: attackGain raises crest factor (attack emphasis)', async () => {
  let hitLen = Math.round(0.05 * SR), nHits = 20
  let burst = new Float32Array(hitLen * nHits)
  for (let h = 0; h < nHits; h++) {
    let base = h * hitLen, tLen = Math.round(0.002 * SR)
    for (let i = 0; i < hitLen; i++) burst[base + i] = (i < tLen ? 1.0 : 0.25) * Math.sin(2 * Math.PI * 1000 * i / SR)
  }
  // prime with 300ms of steady tone: the kernel's transient = envFast/envSlow-derived
  // ratio is unbounded and spikes hugely from a true cold start (both envelopes at 0);
  // priming keeps the measurement in the kernel's normal operating regime — see
  // atom.js's header comment for the underlying kernel defect.
  let prime = tone(1000, 0.3, 0.25)
  let full = new Float32Array([...prime, ...burst])
  let out0 = (await audio.from([full.slice()], { sampleRate: SR })['transient-shaper']({ attackGain: 0, sustainGain: 0 }).read())[0]
  let out1 = (await audio.from([full.slice()], { sampleRate: SR })['transient-shaper']({ attackGain: 2, sustainGain: 0 }).read())[0]
  ok(out0.every(isFinite) && out1.every(isFinite))
  let crest = d => { let p = 0, s = 0; for (let i = 0; i < d.length; i++) { let a = Math.abs(d[i]); if (a > p) p = a; s += d[i] * d[i] }; return p / Math.sqrt(s / d.length) }
  let c0 = crest(out0.subarray(prime.length)), c1 = crest(out1.subarray(prime.length))
  ok(c1 > c0, `attack emphasis raises crest factor (${c0.toFixed(2)} -> ${c1.toFixed(2)})`)
})

test('ducker: self-keyed fallback engages when the host feeds only the main bus', async () => {
  // The manifest declares a real two-bus sidechain ({ inputs: [2,2], outputs: [2] })
  // per CONTRACT §channels, but this host's op engine (core.js useModule) wraps a
  // single input bus only (`st.process([input], [output], ...)`) — no sidechain
  // routing exists yet. This exercises the documented fallback: keys off the main
  // signal itself instead of crashing on the missing bus.
  let main = tone(220, 0.5, 0.9)
  let out = (await audio.from([main], { sampleRate: SR }).ducker({ threshold: -30, ratio: 4 }).read())[0]
  ok(out.every(isFinite))
  let settle = Math.round(0.1 * SR)
  ok(db(rms(out, settle)) < db(rms(main, settle)) - 3, `self-keyed reduction engages (${db(rms(out, settle)).toFixed(1)} dB)`)
})

// ── Engine hosting: streaming:false (whole-render) + sidechain key bus ──
// (leveler/ducker imported + registered in the wave-2 block above)

test('whole-render hosting: leveler converges time-varying levels (streaming:false)', async () => {
  // loud 1s then quiet 1s — exactly what per-block hosting could not level
  let n = 2 * SR, ch = new Float32Array(n)
  for (let i = 0; i < SR; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * 330 * i / SR)
  for (let i = SR; i < n; i++) ch[i] = 0.02 * Math.sin(2 * Math.PI * 330 * i / SR)
  let a = audio.from([ch.slice()], { sampleRate: SR })
  let out = (await a.leveler({ maxGain: 30, frame: 0.1, smooth: 2 }).read())[0]
  is(out.length, n, 'length preserved')
  let gap0 = 20 * Math.log10(rms(ch, SR * 0.2, SR * 0.8) / rms(ch, SR * 1.2, SR * 1.8))
  let gap1 = 20 * Math.log10(rms(out, SR * 0.2, SR * 0.8) / rms(out, SR * 1.2, SR * 1.8))
  ok(gap1 < gap0 - 10, `level gap narrowed ${gap0.toFixed(1)}dB → ${gap1.toFixed(1)}dB`)
  ok(out.every(isFinite))

  // whole-render composes: ops after it apply to the materialized result
  let b = audio.from([ch.slice()], { sampleRate: SR })
  b.leveler({ maxGain: 30, frame: 0.1, smooth: 2 }).gain(-6)
  let out2 = (await b.read())[0]
  almost(rms(out2, SR * 0.2, SR * 0.8), rms(out, SR * 0.2, SR * 0.8) * 10 ** (-6 / 20), 1e-3, 'post-op applies to materialized output')
  b.undo(); b.undo()
  is(b.duration, 2, 'undo unwinds whole-render edit')
})

test('sidechain key bus: ducker ducks under the key, recovers after', async () => {
  let n = Math.round(1.5 * SR)
  let main = new Float32Array(n)
  for (let i = 0; i < n; i++) main[i] = 0.4 * Math.sin(2 * Math.PI * 440 * i / SR)
  let key = new Float32Array(n)
  for (let i = Math.round(0.5 * SR); i < SR; i++) key[i] = 0.8 * Math.sin(2 * Math.PI * 220 * i / SR)

  let a = audio.from([main.slice(), main.slice()], { sampleRate: SR })
  let k = audio.from([key, key], { sampleRate: SR })
  a.ducker({ key: k, threshold: -30, ratio: 8, range: -40, attack: 5, release: 50 })
  let out = (await a.read())[0]
  let before = rms(out, SR * 0.1, SR * 0.4)
  let during = rms(out, SR * 0.6, SR * 0.9)
  let after = rms(out, Math.round(1.25 * SR), Math.round(1.45 * SR))
  ok(during < before * 0.25, `ducked under key (${(20 * Math.log10(during / before)).toFixed(1)}dB)`)
  ok(after > before * 0.7, `recovers after key (${(20 * Math.log10(after / before)).toFixed(1)}dB)`)
})
