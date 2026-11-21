import { highpass as hpFilter, lowpass as lpFilter, bandpass as bpFilter, notch as notchFilter, allpass } from '@audio/filter-biquad'
import lsFilter from '@audio/eq-lowshelf'
import hsFilter from '@audio/eq-highshelf'
import parametricEq from '@audio/eq-parametric'
import { highpass as hpCoefs, lowpass as lpCoefs } from '@audio/biquad'
import { finite } from '../plan.js'
const apFilter = allpass.second

// Order > 2 (even): Butterworth as cascaded biquads, pole-pair Q_k = 1 / (2·cos((2k−1)π / 2N))
// (order 4: 0.5412 · 1.3066, 24 dB/octave)
const butterworth = (order, fc, fs, type) => {
  let n = 2 * Math.round(order / 2), coefs = type === 'highpass' ? hpCoefs : lpCoefs
  return Array.from({ length: n / 2 }, (_, k) => coefs(fc, 1 / (2 * Math.cos((2 * k + 1) * Math.PI / (2 * n))), fs))
}
hpFilter.useButterworth(butterworth)
lpFilter.useButterworth(butterworth)

// ── Filter state helper ─────────────────────────────────────────────────
// Each channel gets its own params object (holds coefs + state).
// Persists across streaming chunks via ctx (persistent object).
// sync() copies current ctx params into the state object before each call —
// @audio/filter recomputes coefficients on param change, so automation
// (engine-resolved fn params) reshapes the filter mid-stream.

function apply(input, output, ctx, key, fn, makeParams, sync, as) {
  if (as) read(as, ctx)
  if (!ctx[key]) ctx[key] = input.map(() => makeParams(ctx.sampleRate))
  let st = ctx[key]
  for (let c = 0; c < input.length; c++) {
    if (sync) sync(st[c], ctx)
    output[c].set(input[c])
    fn(output[c], st[c])
  }
}

// ── Filter dispatch ─────────────────────────────────────────────────────

// Its values as the filter reads them each block (a value, automation's, one patched in): numbers a render can hold.
// Text the call let through (a word: '300hz', 'inf') is a number here or refused, as a number no render can hold is at
// the call (plan.js finite); what reaches the filter is as given
const read = (as, ctx) => { let q = Q(ctx); if (ctx.freq != null) finite(as, 'freq', ctx.freq); if (ctx.gain != null) finite(as, 'gain', ctx.gain); if (q != null) finite(as, 'Q', q) }

const syncFc = (p, ctx) => {
  let order = ctx.order ?? 2
  if (!Number.isSafeInteger(order) || order < 2 || order % 2) throw new RangeError('filter: order must be an even integer >= 2')
  p.fc = ctx.freq; p.order = order
}
// `Q` as everywhere in the ecosystem; `q` is its former name here, still read (options and saved edits)
const Q = (ctx, dflt) => ctx.Q ?? ctx.q ?? dflt
const syncFcQ = (p, ctx) => { p.fc = ctx.freq; if (Q(ctx) != null) p.Q = Q(ctx) }
const syncShelf = (p, ctx) => { p.fc = ctx.freq; p.gain = ctx.gain ?? 0; if (Q(ctx) != null) p.Q = Q(ctx) }
const syncEq = (p, ctx) => {
  let b = p.bands[0]
  if (b.fc !== ctx.freq || b.Q !== Q(ctx, 1) || b.gain !== (ctx.gain ?? 0)) {
    b.fc = ctx.freq; b.Q = Q(ctx, 1); b.gain = ctx.gain ?? 0
    p._dirty = true
  }
}

const types = {
  highpass:  (input, output, ctx, as = 'highpass') => apply(input, output, ctx, '_hp', hpFilter, fs => ({ fc: ctx.freq, order: ctx.order, fs }), syncFc, as),
  lowpass:   (input, output, ctx, as = 'lowpass') => apply(input, output, ctx, '_lp', lpFilter, fs => ({ fc: ctx.freq, order: ctx.order, fs }), syncFc, as),
  eq:        (input, output, ctx, as = 'eq') => apply(input, output, ctx, '_eq', parametricEq, fs => ({ bands: [{ fc: ctx.freq, Q: Q(ctx, 1), gain: ctx.gain ?? 0, type: 'peak' }], fs }), syncEq, as),
  lowshelf:  (input, output, ctx, as = 'lowshelf') => apply(input, output, ctx, '_ls', lsFilter, fs => ({ fc: ctx.freq, gain: ctx.gain ?? 0, Q: Q(ctx, 0.707), fs }), syncShelf, as),
  highshelf: (input, output, ctx, as = 'highshelf') => apply(input, output, ctx, '_hs', hsFilter, fs => ({ fc: ctx.freq, gain: ctx.gain ?? 0, Q: Q(ctx, 0.707), fs }), syncShelf, as),
  notch:     (input, output, ctx, as = 'notch') => apply(input, output, ctx, '_notch', notchFilter, fs => ({ fc: ctx.freq, Q: Q(ctx, 30), fs }), syncFcQ, as),
  bandpass:  (input, output, ctx, as = 'bandpass') => apply(input, output, ctx, '_bp', bpFilter, fs => ({ fc: ctx.freq, Q: Q(ctx, 0.707), fs }), syncFcQ, as),
  allpass:   (input, output, ctx, as = 'allpass') => apply(input, output, ctx, '_ap', apFilter, fs => ({ fc: ctx.freq, Q: Q(ctx, 0.707), fs }), syncFcQ, as),
}

const filterParams = {
  highpass: ['freq', 'order'], lowpass: ['freq', 'order'], eq: ['freq', 'gain', 'Q'],
  lowshelf: ['freq', 'gain', 'Q'], highshelf: ['freq', 'gain', 'Q'],
  notch: ['freq', 'Q'], bandpass: ['freq', 'Q'], allpass: ['freq', 'Q'],
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
  fn(input, output, ctx, 'filter')
}

// ── Register ────────────────────────────────────────────────────────────

import audio from '../core.js'
audio.op('filter', {
  params: ['type', 'freq', 'gain', 'Q'],
  fnArgs: ['type'],
  // a filter of the user's takes its own options
  nonfinite: (k, o) => typeof o.type === 'function' || undefined,
  process: filter
})

for (let name in types) {
  audio.op(name, { params: filterParams[name], process: types[name] })
}
