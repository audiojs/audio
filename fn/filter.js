import hpFilter from 'audio-filter/effect/highpass.js'
import lpFilter from 'audio-filter/effect/lowpass.js'
import bpFilter from 'audio-filter/effect/bandpass.js'
import notchFilter from 'audio-filter/effect/notch.js'
import lsFilter from 'audio-filter/eq/lowshelf.js'
import hsFilter from 'audio-filter/eq/highshelf.js'
import parametricEq from 'audio-filter/eq/parametric-eq.js'

// ── Filter state helper ─────────────────────────────────────────────────
// Each channel gets its own params object (holds coefs + state).
// Persists across streaming chunks via ctx (persistent object).

function apply(chs, ctx, key, fn, makeParams) {
  if (!ctx[key]) ctx[key] = chs.map(() => makeParams(ctx.sampleRate))
  let st = ctx[key]
  for (let c = 0; c < chs.length; c++) fn(chs[c], st[c])
  return chs
}

// ── Filter dispatch ─────────────────────────────────────────────────────

const types = {
  highpass:  (chs, ctx, args) => apply(chs, ctx, '_hp', hpFilter, fs => ({ fc: args[0], fs })),
  lowpass:   (chs, ctx, args) => apply(chs, ctx, '_lp', lpFilter, fs => ({ fc: args[0], fs })),
  eq:        (chs, ctx, args) => apply(chs, ctx, '_eq', parametricEq, fs => ({ bands: [{ fc: args[0], Q: args[2] ?? 1, gain: args[1] ?? 0, type: 'peak' }], fs })),
  lowshelf:  (chs, ctx, args) => apply(chs, ctx, '_ls', lsFilter, fs => ({ fc: args[0], gain: args[1] ?? 0, Q: args[2] ?? 0.707, fs })),
  highshelf: (chs, ctx, args) => apply(chs, ctx, '_hs', hsFilter, fs => ({ fc: args[0], gain: args[1] ?? 0, Q: args[2] ?? 0.707, fs })),
  notch:     (chs, ctx, args) => apply(chs, ctx, '_notch', notchFilter, fs => ({ fc: args[0], Q: args[1] ?? 30, fs })),
  bandpass:  (chs, ctx, args) => apply(chs, ctx, '_bp', bpFilter, fs => ({ fc: args[0], Q: args[1] ?? 0.707, fs })),
}

/** Unified filter: a.filter('highpass', 80) or a.filter(fn, {fc, ...}) */
const filter = (chs, ctx) => {
  let [type, ...args] = ctx.args
  if (typeof type === 'function') {
    let opts = args[0] || {}
    return apply(chs, ctx, '_custom', type, fs => ({ ...opts, fs }))
  }
  let fn = types[type]
  if (!fn) throw new Error(`Unknown filter type: ${type}`)
  return fn(chs, ctx, args)
}

// ── Register ────────────────────────────────────────────────────────────

import audio from '../core.js'
audio.op('filter', {
  process: filter,
  call(std, type, ...args) {
    if (typeof type === 'function') return this.run({ type: 'filter', args: [type, args[0] || {}] })
    return std.call(this, type, ...args)
  }
})

for (let name in types) {
  audio.op(name, { process: (chs, ctx) => types[name](chs, ctx, ctx.args) })
}
