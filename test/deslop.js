// deslop() and its plan, stat('slop') (fn/deslop.js), each stage against a signal made here whose measure is known:
// the top's flatness of white noise (e^-γ) and of steady tones, band levels set by construction, runs at full scale
// counted. The depths the stages work at are the module's own figures (HAZE, CUT, KEPT), read from it: what is held here
// is that each stage is planned by its evidence alone and that the op is the chain its plan prints.
import test, { ok, is } from 'tst'
import audio from '../audio.js'
import { measure, render, KEPT } from '../fn/deslop.js'

const sr = 48000, secs = 6, n = sr * secs
const rng = (seed = 7) => () => (seed = seed * 16807 % 2147483647) / 2147483647 * 2 - 1
// a sum of steady tones, each `amp`, at `freqs` Hz
const tones = (freqs, amp) => Float32Array.from({ length: n }, (_, i) => { let s = 0; for (let f of freqs) s += amp * Math.sin(2 * Math.PI * f * i / sr); return s })
const add = (...xs) => Float32Array.from({ length: n }, (_, i) => xs.reduce((s, x) => s + x[i], 0))
// white noise held to lo..hi Hz, of rms `rms`: a brick-wall band by its spectrum (the whole signal one FFT)
async function hiss(lo, hi, rms, seed) {
  let r = rng(seed), x = Float32Array.from({ length: n }, r), [y] = await audio.from([x], { sampleRate: sr }).highpass(lo, 8).read()
  if (hi < sr / 2) [y] = await audio.from([y], { sampleRate: sr }).filter('lowpass', hi).read()
  let e = 0; for (let v of y) e += v * v
  let g = rms / Math.sqrt(e / n)
  return y.map(v => v * g)
}
// a body for a track: tones through the 0.5 to 2 kHz band the other bands are read against, and under it
const body = () => tones([110, 220, 330, 440, 660, 880, 1100, 1320, 1760], 0.05)
// tones filling a band at whole steps, so its level is set and its flatness low
const comb = (lo, hi, step, amp) => tones(Array.from({ length: Math.floor((hi - lo) / step) }, (_, k) => lo + step / 2 + k * step), amp)

test('measure: the flatness of 5 to 10 kHz is e^-γ for white noise and near 0 for steady tones', async () => {
  // a periodogram ordinate of white noise is exponentially distributed: the mean of its log is the log of its mean less
  // Euler's constant γ, so geometric over arithmetic mean tends to e^-γ = 0.5615 (Johnston 1988's flatness measure)
  let r = rng(3), noise = Float32Array.from({ length: n }, () => 0.1 * r()), m = measure([noise], sr)
  ok(Math.abs(m.flatMid - Math.exp(-0.5772156649)) < 0.02, `white noise: median flatness ${m.flatMid.toFixed(3)}, e^-γ is 0.561`)
  ok(m.flat > 0.45 && m.flat < m.flatMid, `its 10th percentile close under: ${m.flat.toFixed(3)}`)
  let t = measure([add(body(), comb(5000, 10000, 500, 0.01))], sr)
  ok(t.flat < 0.01 && t.flatMid < 0.01, `ten steady tones there: ${t.flat.toFixed(4)}`)
})

test('measure: each band over the 0.5 to 2 kHz band, as built; runs at full scale counted', async () => {
  // white noise is flat per Hz: a band's power over another's is their widths' ratio
  let r = rng(5), noise = Float32Array.from({ length: n }, () => 0.1 * r()), m = measure([noise], sr)
  for (let [k, lo, hi] of [['pres', 2000, 6000], ['high', 6000, 12000], ['air', 12000, 16000]]) {
    let want = 10 * Math.log10((hi - lo) / 1500)
    ok(Math.abs(m[k] - want) < 0.3, `${k}: ${m[k].toFixed(2)} dB, ${want.toFixed(2)} by the bands' widths`)
  }
  is(m.runs, 0, 'no sample at full scale')
  // a sine driven 6 dB past full scale and clipped: each half cycle a run at the rail, two a period
  let hot = Float32Array.from({ length: n }, (_, i) => Math.max(-1, Math.min(1, 2 * Math.sin(2 * Math.PI * 100 * i / sr)))), c = measure([hot], sr)
  ok(Math.abs(c.runs - 2 * 100 * secs) <= 2, `${c.runs} runs, two a period of 100 Hz over ${secs} s`)
  ok(Math.abs(c.railed - 2 / 3) < 0.01, `${(100 * c.railed).toFixed(1)} % of the samples at the rail: 2/3 (the sine over half its peak for 240° of 360°)`)
})

test('a track that carries nothing gets its level alone; the plan changes nothing', async () => {
  let x = add(body(), comb(2000, 6000, 400, 0.004), comb(6000, 12000, 600, 0.002)), a = audio.from([x], { sampleRate: sr })
  let plan = await a.stat('slop')
  is(plan.stages.map(s => s.op), ['normalize'], 'one stage')
  is(plan.code, ".normalize('spotify')")
  is(a.edits.length, 0, 'the stat adds no edit')
  let b = audio.from([x], { sampleRate: sr }).deslop()
  // Spotify plays at -14 LUFS and asks masters to stay under -1 dBTP (normalize()'s 'spotify', fn/specs.js)
  ok(Math.abs(await b.stat('loudness') + 14) < 0.1, `loudness ${(await b.stat('loudness')).toFixed(2)} LUFS`)
  ok(await b.stat('truepeak') <= -0.99, `true peak ${(await b.stat('truepeak')).toFixed(2)} dBTP`)
})

test('a top that is noise in every frame: its noise part lowered over 4 kHz, by intensity; the body as it came', async () => {
  let x = add(body(), await hiss(4000, sr / 2, 0.01, 11)), m = measure([x], sr)
  ok(m.flat > 0.4, `flatness ${m.flat.toFixed(2)}, over the stage's full depth`)
  let plan = await audio.from([x], { sampleRate: sr }).stat('slop'), s = plan.stages[0]
  is([s.op, s.args], ['deconstruct', [0, -6, 0, { band: [4000, sr / 2] }]], 'the noise part 6 dB down over 4 kHz')
  ok(s.why.includes(m.flat.toFixed(2)) && s.why.includes(String(KEPT.flat)), `it says why: ${s.why}`)
  let half = await audio.from([x], { sampleRate: sr }).stat('slop', { intensity: 0.5 })
  is(half.stages[0].args[1], -3, 'intensity 0.5: 3 dB')
  // the stage alone, as the plan prints it: under 3 kHz the samples' spectrum as it was, the top lower
  let [y] = await audio.from([x], { sampleRate: sr }).deconstruct(...s.args).read()
  const power = async (v, lo, hi) => { let [f] = await audio.from([v], { sampleRate: sr }).highpass(lo, 8).filter('lowpass', hi).read(), e = 0; for (let i = sr; i < n - sr; i++) e += f[i] * f[i]; return 10 * Math.log10(e) }
  let low = await power(y, 100, 2500) - await power(x, 100, 2500), top = await power(y, 6000, 16000) - await power(x, 6000, 16000)
  ok(Math.abs(low) < 0.05, `100 Hz to 2.5 kHz moved ${low.toFixed(3)} dB`)
  ok(top < -3 && top > -6.5, `6 to 16 kHz ${top.toFixed(1)} dB: the noise part of it 6 dB down`)
})

test('a band hotter than finished music keeps it is cut by the excess, 4 dB at most', async () => {
  // tones in 6 to 12 kHz set 3 dB over what is kept (KEPT.high): the cut is 3 dB, and it lands the band on the figure
  const built = async over => {
    let base = add(body(), comb(6000, 12000, 500, 0.01)), m = measure([base], sr), g = 10 ** ((KEPT.high + over - m.high) / 20)
    return add(body(), comb(6000, 12000, 500, 0.01 * g))
  }
  let x = await built(3), m = measure([x], sr)
  ok(Math.abs(m.high - (KEPT.high + 3)) < 0.1, `built ${m.high.toFixed(2)} dB, 3 over ${KEPT.high}`)
  let plan = await audio.from([x], { sampleRate: sr }).stat('slop'), cut = plan.stages.find(s => s.op === 'eq')
  is(cut.args, [8500, -3, 0.9], 'a 3 dB cut at 8.5 kHz')
  let { channels } = await render([x], { sampleRate: sr }), after = measure(channels, sr)
  ok(after.high < KEPT.high + 1 && after.high > KEPT.high - 2.5, `after it ${after.high.toFixed(1)} dB`)
  let hot = await audio.from([await built(9)], { sampleRate: sr }).stat('slop')
  is(hot.stages.find(s => s.op === 'eq').args[1], -4, '9 dB over: 4 dB, the most a stage takes')
  is((await audio.from([await built(0.5)], { sampleRate: sr }).stat('slop')).stages.map(s => s.op), ['normalize'], 'half a dB over: left')
})

test('clipped: declip first; deslop() is the chain its plan prints, sample for sample', { timeout: 120000 }, async () => {
  // a second of the body with its top, driven 12 dB past full scale (declip rebuilds each run: a second is enough)
  let whole = add(body(), comb(2000, 6000, 400, 0.004)), hot = Float32Array.from({ length: sr }, (_, i) => Math.max(-1, Math.min(1, 12 * whole[i])))
  ok(measure([hot], sr).runs > 100, `${measure([hot], sr).runs} runs at the rails`)
  let plan = await audio.from([hot], { sampleRate: sr }).stat('slop')
  is(plan.stages[0].op, 'declip', 'declip first')
  is(plan.stages.at(-1).op, 'normalize', 'the level last')
  let x = add(body(), await hiss(4000, sr / 2, 0.01, 13)), p = await audio.from([x], { sampleRate: sr }).stat('slop')
  let [made] = await audio.from([x], { sampleRate: sr }).deslop().read()
  let by = audio.from([x], { sampleRate: sr })
  for (let s of p.stages) by = audio.from(await by[s.op](...s.args).read(), { sampleRate: sr })
  let [hand] = await by.read()
  ok(made.length === hand.length && made.every((v, i) => v === hand[i]), 'the op and its stages run by hand: the same samples')
})

test('a stage needs its band there: a top 40 dB under the body is left, noise or not; a sound with no body gets no cut', async () => {
  let faint = add(body(), await hiss(4000, sr / 2, 0.0002, 17)), m = measure([faint], sr)
  ok(m.flat > 0.4 && m.high < -40, `a hiss ${m.high.toFixed(0)} dB under the body, flatness ${m.flat.toFixed(2)}`)
  is((await audio.from([faint], { sampleRate: sr }).stat('slop')).stages.map(s => s.op), ['normalize'], 'nothing planned on it')
  let bell = comb(6000, 12000, 500, 0.02), b = measure([bell], sr)
  ok(b.body < -20 && b.high > 0, `tones in 6 to 12 kHz alone: the body ${b.body.toFixed(0)} dB under the sound`)
  is((await audio.from([bell], { sampleRate: sr }).stat('slop')).stages.map(s => s.op), ['normalize'], 'no band to read it against: no cut')
})

test('deslop: intensity is 0 to 2', async () => {
  let a = audio.from([body()], { sampleRate: sr })
  for (let run of [() => a.clone().deslop({ intensity: 3 }).read(), () => a.stat('slop', { intensity: -1 })]) {
    let said = await run().then(() => null, e => e.message)
    ok(/intensity is 0 to 2/.test(said), `refused: ${said}`)
  }
  is((await a.stat('slop', { intensity: 0 })).stages.map(s => s.op), ['normalize'], 'intensity 0: the level alone')
})
