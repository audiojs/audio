import { highpass as hpFilter, lowpass as lpFilter, bandpass as bpFilter, notch as notchFilter } from 'audio-filter/effect'
import { lowShelf as lsFilter, highShelf as hsFilter, parametricEq } from 'audio-filter/eq'

// ── Filter state helper ─────────────────────────────────────────────────
// Each channel gets its own params object (holds coefs + state).
// Persists across streaming chunks via ctx.state.

function apply(chs, ctx, key, fn, makeParams) {
  if (!ctx.state[key]) ctx.state[key] = chs.map(() => makeParams(ctx.sampleRate))
  let st = ctx.state[key]
  for (let c = 0; c < chs.length; c++) fn(chs[c], st[c])
  return chs
}

// ── Filter dispatch ─────────────────────────────────────────────────────

const types = {
  highpass:  (chs, ctx, args) => apply(chs, ctx, '_hp', hpFilter, fs => ({ fc: args[0], order: args[1] ?? 2, fs })),
  lowpass:   (chs, ctx, args) => apply(chs, ctx, '_lp', lpFilter, fs => ({ fc: args[0], order: args[1] ?? 2, fs })),
  eq:        (chs, ctx, args) => apply(chs, ctx, '_eq', parametricEq, fs => ({ bands: [{ fc: args[0], Q: args[2] ?? 1, gain: args[1] ?? 0, type: 'peak' }], fs })),
  lowshelf:  (chs, ctx, args) => apply(chs, ctx, '_ls', lsFilter, fs => ({ fc: args[0], gain: args[1] ?? 0, Q: args[2] ?? 0.707, fs })),
  highshelf: (chs, ctx, args) => apply(chs, ctx, '_hs', hsFilter, fs => ({ fc: args[0], gain: args[1] ?? 0, Q: args[2] ?? 0.707, fs })),
  notch:     (chs, ctx, args) => apply(chs, ctx, '_notch', notchFilter, fs => ({ fc: args[0], Q: args[1] ?? 30, fs })),
  bandpass:  (chs, ctx, args) => apply(chs, ctx, '_bp', bpFilter, fs => ({ fc: args[0], Q: args[1] ?? 0.707, fs })),
}

/** Unified filter: a.filter('highpass', 80) */
const filter = (chs, ctx) => {
  let [type, ...args] = ctx.args
  let fn = types[type]
  if (!fn) throw new Error(`Unknown filter type: ${type}`)
  return fn(chs, ctx, args)
}

// ── Register ────────────────────────────────────────────────────────────

import audio from '../core.js'
audio.op('filter', filter)
for (let name in types) {
  audio.op(name, (chs, ctx) => types[name](chs, ctx, ctx.args))
}
