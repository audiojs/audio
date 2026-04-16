import hpFilter from 'audio-filter/effect/highpass.js'
import lpFilter from 'audio-filter/effect/lowpass.js'
import bpFilter from 'audio-filter/effect/bandpass.js'
import notchFilter from 'audio-filter/effect/notch.js'
import { second as apFilter } from 'audio-filter/effect/allpass.js'
import lsFilter from 'audio-filter/eq/lowshelf.js'
import hsFilter from 'audio-filter/eq/highshelf.js'
import parametricEq from 'audio-filter/eq/parametric-eq.js'

// ── Filter state helper ─────────────────────────────────────────────────
// Each channel gets its own params object (holds coefs + state).
// Persists across streaming chunks via ctx (persistent object).

function apply(input, output, ctx, key, fn, makeParams) {
  if (!ctx[key]) ctx[key] = input.map(() => makeParams(ctx.sampleRate))
  let st = ctx[key]
  for (let c = 0; c < input.length; c++) {
    output[c].set(input[c])
    fn(output[c], st[c])
  }
}

// ── Filter dispatch ─────────────────────────────────────────────────────

const types = {
  highpass:  (input, output, ctx) => apply(input, output, ctx, '_hp', hpFilter, fs => ({ fc: ctx.freq, fs })),
  lowpass:   (input, output, ctx) => apply(input, output, ctx, '_lp', lpFilter, fs => ({ fc: ctx.freq, fs })),
  eq:        (input, output, ctx) => apply(input, output, ctx, '_eq', parametricEq, fs => ({ bands: [{ fc: ctx.freq, Q: ctx.q ?? 1, gain: ctx.gain ?? 0, type: 'peak' }], fs })),
  lowshelf:  (input, output, ctx) => apply(input, output, ctx, '_ls', lsFilter, fs => ({ fc: ctx.freq, gain: ctx.gain ?? 0, Q: ctx.q ?? 0.707, fs })),
  highshelf: (input, output, ctx) => apply(input, output, ctx, '_hs', hsFilter, fs => ({ fc: ctx.freq, gain: ctx.gain ?? 0, Q: ctx.q ?? 0.707, fs })),
  notch:     (input, output, ctx) => apply(input, output, ctx, '_notch', notchFilter, fs => ({ fc: ctx.freq, Q: ctx.q ?? 30, fs })),
  bandpass:  (input, output, ctx) => apply(input, output, ctx, '_bp', bpFilter, fs => ({ fc: ctx.freq, Q: ctx.q ?? 0.707, fs })),
  allpass:   (input, output, ctx) => apply(input, output, ctx, '_ap', apFilter, fs => ({ fc: ctx.freq, Q: ctx.q ?? 0.707, fs })),
}

const filterParams = {
  highpass: ['freq'], lowpass: ['freq'], eq: ['freq', 'gain', 'q'],
  lowshelf: ['freq', 'gain', 'q'], highshelf: ['freq', 'gain', 'q'],
  notch: ['freq', 'q'], bandpass: ['freq', 'q'], allpass: ['freq', 'q'],
}

/** Unified filter: a.filter('highpass', 80) or a.filter(fn, {fc, ...}) */
const filter = (input, output, ctx) => {
  let type = ctx.type
  if (typeof type === 'function') {
    return apply(input, output, ctx, '_custom', type, fs => ({ ...ctx.freq, fs }))
  }
  let fn = types[type]
  if (!fn) throw new Error(`Unknown filter type: ${type}`)
  fn(input, output, ctx)
}

// ── Register ────────────────────────────────────────────────────────────

import audio from '../core.js'
audio.op('filter', {
  params: ['type', 'freq', 'gain', 'q'],
  process: filter
})

for (let name in types) {
  audio.op(name, { params: filterParams[name], process: types[name] })
}
