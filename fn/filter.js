import { highpass as hpFilter, lowpass as lpFilter, bandpass as bpFilter, notch as notchFilter, allpass } from '@audio/filter'
import { lowShelf as lsFilter, highShelf as hsFilter, parametricEq } from '@audio/eq'
const apFilter = allpass.second

// ── Filter state helper ─────────────────────────────────────────────────
// Each channel gets its own params object (holds coefs + state).
// Persists across streaming chunks via ctx (persistent object).
// sync() copies current ctx params into the state object before each call —
// @audio/filter recomputes coefficients on param change, so automation
// (engine-resolved fn params) reshapes the filter mid-stream.

function apply(input, output, ctx, key, fn, makeParams, sync) {
  if (!ctx[key]) ctx[key] = input.map(() => makeParams(ctx.sampleRate))
  let st = ctx[key]
  for (let c = 0; c < input.length; c++) {
    if (sync) sync(st[c], ctx)
    output[c].set(input[c])
    fn(output[c], st[c])
  }
}

// ── Filter dispatch ─────────────────────────────────────────────────────

const syncFc = (p, ctx) => { p.fc = ctx.freq }
const syncFcQ = (p, ctx) => { p.fc = ctx.freq; if (ctx.q != null) p.Q = ctx.q }
const syncShelf = (p, ctx) => { p.fc = ctx.freq; p.gain = ctx.gain ?? 0; if (ctx.q != null) p.Q = ctx.q }
const syncEq = (p, ctx) => {
  let b = p.bands[0]
  if (b.fc !== ctx.freq || b.Q !== (ctx.q ?? 1) || b.gain !== (ctx.gain ?? 0)) {
    b.fc = ctx.freq; b.Q = ctx.q ?? 1; b.gain = ctx.gain ?? 0
    p._dirty = true
  }
}

const types = {
  highpass:  (input, output, ctx) => apply(input, output, ctx, '_hp', hpFilter, fs => ({ fc: ctx.freq, fs }), syncFc),
  lowpass:   (input, output, ctx) => apply(input, output, ctx, '_lp', lpFilter, fs => ({ fc: ctx.freq, fs }), syncFc),
  eq:        (input, output, ctx) => apply(input, output, ctx, '_eq', parametricEq, fs => ({ bands: [{ fc: ctx.freq, Q: ctx.q ?? 1, gain: ctx.gain ?? 0, type: 'peak' }], fs }), syncEq),
  lowshelf:  (input, output, ctx) => apply(input, output, ctx, '_ls', lsFilter, fs => ({ fc: ctx.freq, gain: ctx.gain ?? 0, Q: ctx.q ?? 0.707, fs }), syncShelf),
  highshelf: (input, output, ctx) => apply(input, output, ctx, '_hs', hsFilter, fs => ({ fc: ctx.freq, gain: ctx.gain ?? 0, Q: ctx.q ?? 0.707, fs }), syncShelf),
  notch:     (input, output, ctx) => apply(input, output, ctx, '_notch', notchFilter, fs => ({ fc: ctx.freq, Q: ctx.q ?? 30, fs }), syncFcQ),
  bandpass:  (input, output, ctx) => apply(input, output, ctx, '_bp', bpFilter, fs => ({ fc: ctx.freq, Q: ctx.q ?? 0.707, fs }), syncFcQ),
  allpass:   (input, output, ctx) => apply(input, output, ctx, '_ap', apFilter, fs => ({ fc: ctx.freq, Q: ctx.q ?? 0.707, fs }), syncFcQ),
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
    return apply(input, output, ctx, '_custom', type, fs => {
      let { type: _, sampleRate: _sr, at: _a, duration: _d, channel: _ch, _custom, ...params } = ctx
      // If freq is an object, flatten it (@audio/filter convention: { fc, Q, gain })
      if (params.freq && typeof params.freq === 'object') {
        let { freq, ...rest } = params
        return { ...freq, ...rest, fs }
      }
      return { ...params, fs }
    })
  }
  let fn = types[type]
  if (!fn) throw new Error(`filter: unknown type '${type}'`)
  fn(input, output, ctx)
}

// ── Register ────────────────────────────────────────────────────────────

import audio from '../core.js'
audio.op('filter', {
  params: ['type', 'freq', 'gain', 'q'],
  fnArgs: ['type'],
  process: filter
})

for (let name in types) {
  audio.op(name, { params: filterParams[name], process: types[name] })
}
