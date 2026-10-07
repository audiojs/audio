/**
 * Plugin — a VST3, CLAP, Audio Unit or LV2 plugin as an edit, through @audio/host (optional package, Node).
 *
 * a.plugin('RX 12 De-click', { sensitivity: 6 })          → its parameters by key, in its own units
 * a.plugin('AUDelay', { delayTime: 0.25, feedback: t => 20 + 40 * t })   → automated: a function, { t, v }
 * a.plugin('Valhalla Room', { params: { mix: 30 } })       → a parameter whose name an option has (mix, at…)
 * a.plugin('/path/Plugin.vst3', { plugin: 'Its Reverb' })  → one plugin of a file holding several
 * a.plugin('Surge XT', { notes: [{ time: 0, duration: 1, note: 'C4' }], bpm: 96 })   → an instrument
 * music.plugin('Pro-C 2', { key: voice })                   → its sidechain, another sound
 * a.plugin(ref, { preset: 'Warm.vstpreset' }), { state }   → a preset file, a named one, or saved bytes
 *
 * Its latency is taken off (the engine's delay compensation), its tail rendered past the end (the plugin's own,
 * or `tail` seconds; `tail: false`, none). Transport: `bpm`, `timeSignature` (the plugin hears the timeline's
 * position), `transport: false` for none. `isolate: true` runs it in a process of its own. Notes and automation
 * keep to the timeline. Each render loads its own instance, so playback and export never share one.
 *
 * a.plugin('https://…/plugin/index.js', { … })             → a Web Audio Module (WAM 2.0), in a page too (fn/wam.js)
 */

import audio from '../core.js'
import { isWam, prepare as prepareWam, WAM } from './wam.js'

/* what the edit's options are, besides its plugin's parameters */
const OPTIONS = new Set(['ref', 'plugin', 'format', 'params', 'state', 'preset', 'key', 'notes', 'midi', 'bpm', 'timeSignature',
  'transport', 'tail', 'isolate', 'blockSize', 'offline', 'at', 'duration', 'channel', 'mix', 'offset', 'length', 'd', 'xfade',
  /* and what the engine puts beside them */ 'sampleRate', 'channelCount', 'totalDuration', 'blockOffset', 'render', 'final'])
const RUN = Symbol('plugin.run')

function host() {
  let mod = audio.op('plugin')?.mod
  if (!mod) throw new Error('plugin: a native plugin needs @audio/host, in Node (npm i @audio/host); a page hosts WAMs, by their module\'s URL')
  return mod
}

/** Its parameters: every option that isn't one of the edit's, and `params` */
function paramsOf(o) {
  let p = {}
  for (let k in o) if (!OPTIONS.has(k)) p[k] = o[k]
  return { ...p, ...o.params }
}

const fixed = v => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'

/** An instance at the stage's rate and width, its fixed parameters set */
function open(o, sampleRate, channels) {
  let p = host().load(o.ref, {
    sampleRate, channels, plugin: o.plugin, format: o.format, sidechain: o.key != null, isolate: o.isolate,
    blockSize: o.blockSize ?? audio.BLOCK_SIZE, offline: o.offline ?? true, state: o.state, preset: o.preset,
  })
  for (let [k, v] of Object.entries(paramsOf(o))) if (fixed(v)) p.set(k, v)
  return p.reset()  /* the parameters reach it, and the latency they make is known */
}

/** A probe: an instance that answers what the settings make its latency, tail and width, kept by the settings
 *  (a plan compiles often, its edits copied each time: what stays the same is what they say) */
const probes = new Map(), PROBES = 8
const bytesKey = b => { if (!b || typeof b === 'string') return b; let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193); return `${b.length}:${h >>> 0}` }
function probe(o, sr, ch = o.channelCount ?? 2) {
  if (!audio.op('plugin')?.mod) return null  // planned before @audio/host loads: none yet, the plan compiles again once it has
  let fixedParams = Object.fromEntries(Object.entries(paramsOf(o)).filter(([, v]) => fixed(v)))
  let key = JSON.stringify([o.ref, o.plugin, o.format, o.preset, bytesKey(o.state), o.isolate, o.key != null, o.offline, sr, ch, fixedParams])
  let p = probes.get(key)
  if (p) { probes.delete(key); probes.set(key, p); return p }
  probes.set(key, p = open(o, sr, ch))
  if (probes.size > PROBES) { let [k, old] = probes.entries().next().value; probes.delete(k); old.close() }
  return p
}

const tailOf = (o, sr) => {
  if (o.tail === false) return 0
  if (typeof o.tail === 'number') return o.tail
  let t = probe(o, sr)?.tail
  return isFinite(t) ? t / sr : 0
}

/** The processor: one instance per render (a seek, an export, playback), parameters and events per block */
function process(input, output, ctx) {
  let st = ctx[RUN]
  if (!st) {
    let p = open(ctx, ctx.sampleRate, input.length), curves = {}, last = {}
    for (let [k, v] of Object.entries(paramsOf(ctx))) typeof v === 'function' ? (curves[k] = v) : (last[k] = v)
    st = ctx[RUN] = { p, curves, last, has: Object.keys(curves).length > 0 }
  }
  // a fixed value patched while it plays (a live edit) reaches it at this block
  for (let [k, v] of Object.entries(paramsOf(ctx))) if (fixed(v) && st.last[k] !== v) { st.p.set(k, v); st.last[k] = v }
  let n = input[0]?.length ?? output[0].length
  let key = ctx.key != null && audio.renderAt ? audio.renderAt(ctx.render, ctx.key, Math.round((ctx.blockOffset || 0) * ctx.sampleRate), n, ctx.sampleRate) : undefined
  st.p.process(input, {
    reset: false, compensate: false, offset: ctx.blockOffset || 0, into: output, sidechain: key,
    automation: st.has ? st.curves : undefined, notes: ctx.notes, midi: ctx.midi,
    bpm: ctx.bpm, timeSignature: ctx.timeSignature, transport: ctx.transport,
  })
}

const width = (n, ctx) => isWam(ctx.ref, ctx.format) ? n : probe(ctx, ctx.sampleRate, n)?.outputChannels ?? n
const NOT_OPTIONS = new Set(['sampleRate', 'channel', 'at', 'duration', 'totalDuration', 'final'])  /* channelCount stays: its latency's width */

audio.op('_plugin', {
  params: ['ref'], hidden: true, auto: 'sample', process, ch: width, chKeeps: true,
  latency: (o, sr) => probe(o, sr)?.latency ?? 0,
})

audio.op('plugin', {
  params: ['ref'], auto: 'sample', ch: width, chKeeps: true,
  // native plugins need @audio/host (Node); a WAM, Web Audio: either may be all there is
  load: () => audio.import('@audio/host').catch(() => null),
  prepare: (a, index) => { let o = a.edits[index][1]; if (isWam(o.ref, o.format)) return prepareWam(a, index, paramsOf(o)) },
  // the processor, and its tail as a pad (as a contract plugin's): the edit stays one, the decay renders
  expand: ctx => {
    if (isWam(ctx.ref, ctx.format)) {
      let done = ctx[WAM], t = done?.tail ?? 0
      return t > 0 ? [['pad', { before: 0, after: t }], ['_wam', { ref: ctx.ref, [WAM]: done }]] : [['_wam', { ref: ctx.ref, [WAM]: done }]]
    }
    let o = {}
    for (let k in ctx) if (!NOT_OPTIONS.has(k)) o[k] = ctx[k]
    let t = tailOf(ctx, ctx.sampleRate)
    return t > 0 ? [['pad', { before: 0, after: t }], ['_plugin', o]] : [['_plugin', o]]
  },
})
