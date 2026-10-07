/**
 * WAM: a Web Audio Module (WAM 2.0: webaudiomodules.com's Faust effects, amps, synths) as a plugin edit, by its
 * module's URL or its WebAudioModule class. The WAM SDK's host (@webaudiomodules/sdk) loads it into an
 * OfflineAudioContext and the edit's input renders through it before the timeline plays, as a codec's does.
 *
 * a.plugin('https://…/StonePhaserStereo/index.js', { feedback: 0.6 })   → its parameters by id, label or the label's key
 * a.plugin(url, { depth: t => t / 10 })                                 → automated: wam-automation, each render quantum
 * a.plugin(url, { notes: [{ time: 0, duration: 1, note: 'C4' }], bpm: 96 })   → wam-midi; the tempo as wam-transport
 *
 * Its compensation delay is taken off, its decay rendered until it falls silent (30 s at most; `tail` seconds; `false`
 * none). A page's Web Audio, or web-audio-api in Node (a module on disk there: Node imports no http URL).
 */
import audio, { arrived } from '../core.js'
import { isCurve, curveFn } from '../plan.js'
import { parse as noteOf } from '@audio/note'

export const WAM = Symbol('plugin.wam')
// pre-roll: the plugin runs a quarter second before the input reaches it, its parameters' smoothing settled (the
// SDK's 256 samples, Faust's si.smoo to 1e-4 in 0.2 s at 48 kHz), as a DAW's plugins are set long before playback
const TAIL = 30, QUIET = 1e-4, QUANTUM = 128, PREROLL = 0.25

/** A WAM: its class, or a JavaScript module's URL or path (an LV2 URI is a URL too, but no module) */
export const isWam = (ref, format) => format === 'wam' || (typeof ref === 'function' ? !!ref.isWebAudioModuleConstructor
  : typeof ref === 'string' && (/\.m?js(\?.*)?$/i.test(ref) || /^(blob:|data:text\/javascript)/.test(ref)))

/** The Web Audio a WAM renders in: the page's, else web-audio-api's (its AudioWorkletNode global, as the SDK's
 *  classes extend it when they load) */
async function webAudio() {
  if (globalThis.OfflineAudioContext && globalThis.AudioWorkletNode) return globalThis.OfflineAudioContext
  let waa = await audio.import('web-audio-api').catch(() => null)
  if (!waa) throw new Error('plugin: a WAM renders through Web Audio: a page\'s, or web-audio-api in Node (npm i web-audio-api)')
  globalThis.AudioWorkletNode ??= waa.AudioWorkletNode
  return waa.OfflineAudioContext
}

/** Its parameter by id, label, or the label as a key ('Delay Time' → delayTime), any case */
const key = s => String(s).replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => c ? c.toUpperCase() : '').replace(/^./, c => c.toLowerCase())
function param(info, name) {
  let all = Object.values(info), n = String(name), lower = n.toLowerCase()
  return info[n] ?? all.find(p => p.label === n || key(p.label ?? '') === n || p.id.split('/').pop() === n)
    ?? all.find(p => p.label?.toLowerCase() === lower || key(p.label ?? '').toLowerCase() === lower || p.id.toLowerCase() === lower)
}
/** A value in its units: a number, a choice's label, on/off */
function valueOf(p, v) {
  if (typeof v === 'boolean') return v ? p.maxValue : p.minValue
  if (typeof v === 'string') {
    let i = p.choices?.findIndex(c => c.toLowerCase() === v.toLowerCase()) ?? -1
    if (i < 0) throw new RangeError(`plugin: ${p.label || p.id} is ${p.choices?.length ? p.choices.join(', ') : 'a number'}, not '${v}'`)
    return p.minValue + i * (p.discreteStep || 1)
  }
  return v
}

/** Notes and MIDI as wam-midi events, at seconds */
function midiEvents(notes = [], midi = []) {
  let ev = [], at = (time, bytes) => ev.push({ type: 'wam-midi', data: { bytes }, time })
  for (let n of notes) {
    let k = Math.round(n.midi ?? (n.freq ? 69 + 12 * Math.log2(n.freq / 440) : n.note != null ? (typeof n.note === 'number' ? n.note : noteOf(n.note)) : 60))
    let v = n.velocity == null ? 100 : n.velocity <= 1 ? Math.max(1, Math.round(n.velocity * 127)) : Math.round(n.velocity), ch = (n.channel ?? 0) & 15
    at(n.time ?? 0, [0x90 | ch, k, v])
    at((n.time ?? 0) + (n.duration ?? 1), [0x80 | ch, k, 0])
  }
  for (let m of midi) { let [data, time] = Array.isArray(m) ? m : [m.data, m.time]; at(time ?? 0, Array.from(data).slice(0, 3)) }
  return ev
}

/** The input through the WAM: its channels at its length plus the decay, the delay taken off */
async function render(o, params, pcm, sr, room = sr) {
  let OAC = await webAudio()
  let { initializeWamHost } = await audio.import('@webaudiomodules/sdk')
  let ch = pcm.length, len = pcm[0].length, D = 0, P = Math.round(PREROLL * sr), t0 = P / sr
  let extra = o.tail === false ? 0 : typeof o.tail === 'number' ? o.tail : TAIL
  // the delay is the plugin's to say once it runs: a context with `room` for it (a second), then trimmed; a longer
  // delay renders again with room for it
  let n = P + len + Math.ceil(extra * sr) + room
  let ctx = new OAC(ch, n, sr)
  let [group] = await initializeWamHost(ctx)
  let WAM = typeof o.ref === 'function' ? o.ref : (await import(/* @vite-ignore */ o.ref)).default
  let wam = await WAM.createInstance(group, ctx, o.state)
  let node = wam.audioNode
  try {
    let info = await node.getParameterInfo(), fixed = {}, events = []
    for (let [k, v] of Object.entries(params)) {
      let p = param(info, k)
      if (!p) throw new RangeError(`plugin: ${wam.name ?? 'the WAM'} has no parameter '${k}' (${Object.values(info).map(p => key(p.label || p.id)).join(', ')})`)
      if (typeof v === 'function' || isCurve(v)) {
        let f = typeof v === 'function' ? v : curveFn(v)
        for (let i = 0; i < n - P; i += QUANTUM) events.push({ type: 'wam-automation', data: { id: p.id, value: valueOf(p, f(i / sr)), normalized: false }, time: t0 + i / sr })
        fixed[p.id] = { id: p.id, value: valueOf(p, f(0)), normalized: false }
      } else fixed[p.id] = { id: p.id, value: valueOf(p, v), normalized: false }
    }
    await node.setParameterValues(fixed)
    if (o.transport !== false && (o.bpm || o.timeSignature)) {
      let [num, den] = o.timeSignature ?? [4, 4]
      events.push({ type: 'wam-transport', data: { currentBar: 0, currentBarStarted: t0, tempo: o.bpm ?? 120, timeSigNumerator: num, timeSigDenominator: den, playing: true }, time: t0 })
    }
    events.push(...midiEvents(o.notes, o.midi).map(e => ({ ...e, time: t0 + e.time })))
    if (events.length) node.scheduleEvents(...events.sort((a, b) => a.time - b.time))
    // a request answered: the port is in order, so the events have reached the processor before rendering starts
    await node.getParameterValues(false)
    D = Math.max(0, Math.round(await node.getCompensationDelay() || 0))
    if (D > room) return render(o, params, pcm, sr, D)
    let buf = ctx.createBuffer(ch, len || 1, sr)
    for (let c = 0; c < ch; c++) buf.copyToChannel(pcm[c], c)
    let src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(node)
    node.connect(ctx.destination)
    src.start(t0)
    let out = await ctx.startRendering()
    let y = Array.from({ length: ch }, (_, c) => out.getChannelData(c).subarray(P + D, P + D + len + Math.ceil(extra * sr)))
    // `tail` seconds, or until it falls silent: the last sample over -80 dB past the input
    let end = len + (typeof o.tail === 'number' ? Math.ceil(o.tail * sr) : 0)
    if (extra && typeof o.tail !== 'number') for (let c of y) for (let i = c.length - 1; i >= end; i--) if (Math.abs(c[i]) > QUIET) { end = i + 1; break }
    return { pcm: y.map(c => c.slice(0, end)), tail: (end - len) / sr, delay: D, name: wam.name }
  } finally { node.destroy?.() }
}

/** Renders the edit's input through the WAM, held by the edit until it or its input changes; true when its tail
 *  changed (the plan compiles again, the decay padded) */
export async function prepare(a, index, params) {
  let o = a.edits[index][1]
  await arrived(a)
  if (!a.decoded) throw new Error('plugin: a WAM renders its whole input first: a live source plays through native plugins')
  let input = audio.from(a, { sampleRate: a._.sr })
  input.edits = a.edits.slice(0, index)
  input.version = index
  let sr = input.sampleRate, settings = JSON.stringify(params, (k, v) => typeof v === 'function' ? String(v) : v)
  let stamp = `${a.version}:${a._.len}:${sr}:${settings}:${o.tail}:${o.bpm}:${JSON.stringify([o.notes, o.midi, o.timeSignature, o.transport, o.state])}`
  if (o[WAM]?.stamp === stamp) return
  let pcm = await input.read(), prev = o[WAM]?.tail
  o[WAM] = { stamp, ...await render(o, params, pcm, sr) }
  return o[WAM].tail !== prev
}

/** The rendered output, at the block's place on the timeline */
function process(input, output, ctx) {
  let done = ctx[WAM]
  if (!done) throw new Error('plugin: a WAM renders before the timeline plays, through read(), stream() or save()')
  let off = Math.round((ctx.blockOffset || 0) * ctx.sampleRate), len = input[0].length
  for (let c = 0; c < output.length; c++) {
    let v = done.pcm[c % done.pcm.length], y = output[c]
    for (let i = 0, j = off; i < len; i++, j++) y[i] = j < v.length ? v[j] : 0
  }
}

audio.op('_wam', { params: ['ref'], hidden: true, process })
