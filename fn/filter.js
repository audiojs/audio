import { highpass as hpFilter, lowpass as lpFilter, bandpass as bpFilter, notch as notchFilter } from 'audio-filter/effect'
import { lowShelf as lsFilter, highShelf as hsFilter, parametricEq } from 'audio-filter/eq'

// ── Filter state helper ─────────────────────────────────────────────────
// Each channel gets its own params object (holds coefs + state).
// Persists across streaming chunks via ctx.state.

function apply(chs, ctx, key, fn, makeParams) {
  if (!ctx.state[key]) ctx.state[key] = chs.map(() => makeParams(ctx.sampleRate))
  let st = ctx.state[key]
  return chs.map((ch, c) => {
    let o = new Float32Array(ch)
    fn(o, st[c])
    return o
  })
}

// ── Ops ─────────────────────────────────────────────────────────────────

// highpass FC [ORDER]  — remove everything below FC
const highpass = (chs, ctx) => {
  let fc = ctx.args[0], order = ctx.args[1] ?? 2
  return apply(chs, ctx, '_hp', hpFilter, fs => ({ fc, order, fs }))
}

// lowpass FC [ORDER]  — remove everything above FC
const lowpass = (chs, ctx) => {
  let fc = ctx.args[0], order = ctx.args[1] ?? 2
  return apply(chs, ctx, '_lp', lpFilter, fs => ({ fc, order, fs }))
}

// eq FC GAIN [Q]  — parametric peaking EQ at FC
const eq = (chs, ctx) => {
  let fc = ctx.args[0], gain = ctx.args[1] ?? 0, Q = ctx.args[2] ?? 1
  return apply(chs, ctx, '_eq', parametricEq, fs => ({
    bands: [{ fc, Q, gain, type: 'peak' }], fs
  }))
}

// lowshelf FC GAIN [Q]  — boost/cut below FC
const lowshelf = (chs, ctx) => {
  let fc = ctx.args[0], gain = ctx.args[1] ?? 0, Q = ctx.args[2] ?? 0.707
  return apply(chs, ctx, '_ls', lsFilter, fs => ({ fc, gain, Q, fs }))
}

// highshelf FC GAIN [Q]  — boost/cut above FC
const highshelf = (chs, ctx) => {
  let fc = ctx.args[0], gain = ctx.args[1] ?? 0, Q = ctx.args[2] ?? 0.707
  return apply(chs, ctx, '_hs', hsFilter, fs => ({ fc, gain, Q, fs }))
}

// notch FC [Q]  — kill a single frequency
const notch = (chs, ctx) => {
  let fc = ctx.args[0], Q = ctx.args[1] ?? 30
  return apply(chs, ctx, '_notch', notchFilter, fs => ({ fc, Q, fs }))
}

// bandpass FC [Q]  — pass only around FC
const bandpass = (chs, ctx) => {
  let fc = ctx.args[0], Q = ctx.args[1] ?? 0.707
  return apply(chs, ctx, '_bp', bpFilter, fs => ({ fc, Q, fs }))
}

// ── Register ────────────────────────────────────────────────────────────

export default (audio) => {
  audio.op.highpass = highpass
  audio.op.lowpass = lowpass
  audio.op.eq = eq
  audio.op.lowshelf = lowshelf
  audio.op.highshelf = highshelf
  audio.op.notch = notch
  audio.op.bandpass = bandpass
}
