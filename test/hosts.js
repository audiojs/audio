// The contract's host duties (test/conformance.js) run against audio's three hosts: its own op host (core.js hostOp,
// driven by the engine in plan.js), toBatch and toStream (batch.js). A toy host, kept to the contract with the helpers
// toBatch is made of, shows each duty failing where the host breaks it: one flaw at a time.

import test, { ok } from 'tst'
import audio from '../audio.js'
import { toBatch, toStream, paramState, valuesAt, valueAt, eachCall, snap, hostCtx, widest, resolveBuses, buffersOf, busIn, noteEvents, notesIn, moveTransport, settingAt } from '../batch.js'
import { duties } from './conformance.js'

const ramp = (n, frames) => Array.from({ length: n }, () => Float32Array.from({ length: frames }, (_, i) => i))
// what feeds input bus 0: the arrays given, else a ramp of `channels`, else nothing
const source = o => o.input ?? (o.channels ? ramp(o.channels, o.frames) : null)
// output bus 0 as channels, from what toBatch or toStream returns: bus 0 of buses, channels, or one channel
const bus0 = y => y == null ? [] : ArrayBuffer.isView(y) ? [y] : Array.isArray(y[0]) ? y[0] : y
const told = events => events.map(e => ({ name: e.name, value: e.args[0] }))
// the channels of each part end to end
const join = parts => (parts.find(y => y.length) ?? []).map((_, k) => Float32Array.from(parts.flatMap(y => y[k] ? [...y[k]] : [])))

// audio: the processor registered under a name of its own (audio.op(name, processor)), an edit of a sound fed with the
// input, its options the moves, buffers, notes, tempo and key; emissions to its `emitted` option
let made = 0
async function audioHost (p, o) {
  let name = `conformance-${++made}`, emitted = []
  audio.op(name, p)
  let src = audio.from(source(o) ?? [new Float32Array(o.frames)], { sampleRate: o.sampleRate })
  let opts = { ...o.params, ...o.moves, ...o.buffers, emitted: (name, value) => emitted.push({ name, value }) }
  if (o.notes) opts.notes = o.notes
  if (o.transport) Object.assign(opts, { bpm: o.transport.bpm, timeSignature: o.transport.timeSig })
  if (o.key) opts.key = audio.from(o.key, { sampleRate: o.sampleRate })
  try { return { output: await src[name](opts).read(), emitted } }
  finally { src.dispose(); opts.key?.dispose() }
}

// toBatch returns what the processor wrote, raw: this host lines it up itself, by the latency the processor declares
// for the setting it is built with (its values, its buffers, the transport at the start: batch.js settingAt, as
// toStream reads it), the input fed that much longer, the lead dropped (with none, the arrays as given). It renders no
// tail
function batchHost (p, o) {
  let built = () => { let state = paramState(p.params, { ...o.params, ...o.moves }, 'host'); return settingAt(p.params, k => valueAt(state[k], 0, o.sampleRate), buffersOf(p, o.buffers), o.transport, 0, o.sampleRate) }
  let L = typeof p.latency === 'function' ? p.latency(built()) | 0 : p.latency | 0
  let fed = b => L ? b.map(c => { let x = new Float32Array(o.frames + L); x.set(c); return x }) : b
  let input = o.channels ? fed(source(o)) : null
  let y = toBatch(p, { sampleRate: o.sampleRate, maxBlockSize: o.blocks ?? 2048 })(o.key ? [input, fed(o.key)] : input,
    { frames: o.frames + L, params: { ...o.params, ...o.moves }, buffers: o.buffers, notes: o.notes, transport: o.transport })
  let { output, events } = y?.events ? y : { output: y, events: [] }
  return { output: bus0(output).map(c => c.subarray(L)), emitted: told(events) }
}

// toStream: the input written in chunks of uneven lengths, as a source delivers them; then as many frames of nothing as
// the latency it reports, the lead dropped, and the tail end() renders
function streamHost (p, o) {
  let s = toStream(p, { sampleRate: o.sampleRate, maxBlockSize: o.blocks ?? 2048, params: { ...o.params, ...o.moves }, buffers: o.buffers, notes: o.notes, transport: o.transport })
  let input = source(o), parts = [], sizes = [1000, 2048, 77]
  for (let at = 0, i = 0; at < o.frames; i++) {
    let n = Math.min(sizes[i % sizes.length], o.frames - at), cut = b => b.map(c => c.subarray(at, at + n))
    parts.push(bus0(s.write(input ? o.key ? [cut(input), cut(o.key)] : cut(input) : n)))
    at += n
  }
  if (s.latency) parts.push(bus0(s.write(s.latency)))
  parts.push(bus0(s.end()))
  return { output: join(parts).map(c => c.subarray(s.latency)), emitted: told(s.events) }
}

const HOSTS = [['audio', audioHost], ['toBatch', Object.assign(async (p, o) => batchHost(p, o), { tails: false })], ['toStream', async (p, o) => streamHost(p, o)]]
for (let [label, host] of HOSTS) for (let d of duties) test(`${label} keeps: ${d.name}`, () => d.run(host))

// A toy host: the contract in a few lines, unless it is told one flaw. Flaws: zero (a call of 0 frames before each),
// zeroend (one after the last call), oversize (calls past its maxBlockSize), channels (maxChannels 32), bus0 (no bus 0
// when nothing feeds it), bus0count (bus 0 as fed, whatever count it declares), bus1 (undefined for a further bus
// nothing feeds), nosplit (one call a block, its values from the block's start), smoothing (none: values jump), lag (a
// moving value smoothed again, lagging behind it), restart (automation let through to a restart param), clamp (values
// as asked: unclamped, any enum, text unread), enum (an undeclared enum value held to its default), infinite (a number
// given Infinity or -Infinity refused, as Number.isFinite reads it), id (every note id 0), pitch (`pitch`, no `midi`),
// unsorted (each call's notes reversed), notetime (note times from the timeline's start, not the call's), velocity
// (velocity as given, not held to 0..1), beat (counted from each call's start), emit
// (emissions dropped), latency (not compensated), latencybuffers (latency read without the buffers), latencyparams
// (latency read with the defaults, not the instance's values), latencytransport (latency handed no transport),
// latencyend (latency handed the transport where the input ends), tail (none rendered), tailparams (the tail read with
// the defaults), tailtransport (the tail handed no transport), buffers (none given to it), blocks (a whole-signal
// processor called in blocks), nan (NaN and Infinity handed on as fed), inplace (made 0 in the arrays it was given),
// step (numbers clamped, not put on their step)
const toy = flaw => async (p, o) => {
  let has = f => f === flaw, sr = o.sampleRate, frames = o.frames, B = o.blocks ?? 256
  let specs = Object.fromEntries(Object.entries(p.params).map(([k, s]) => [k, has('restart') ? { ...s, restart: false, flags: [] } : has('smoothing') ? { ...s, smoothing: 0 } : has('step') ? { ...s, step: 0 } : s]))
  let asked = { ...o.params, ...o.moves }
  if (has('enum')) asked = Object.fromEntries(Object.entries(asked).filter(([k, v]) => specs[k]?.type !== 'enum' || specs[k].values.includes(v)))
  if (has('infinite')) for (let k in asked) if (specs[k]?.type === 'number' && typeof asked[k] === 'number' && !Number.isFinite(asked[k])) throw new TypeError(`toy: ${k} takes a number, not ${asked[k]}`)
  let state = paramState(specs, has('clamp') ? {} : asked, 'toy'), live = {}, lag = {}
  let buffers = has('buffers') ? {} : buffersOf(p, o.buffers)
  // latency and tail, of the values the instance is built with, its buffers and the transport where each is asked (a
  // latency's at the start, a tail's where the input ends): the output lined up, the tail rendered
  let built = k => valueAt(state[k], 0, sr), declared = k => specs[k].default, setting = (f, get = built) => settingAt(specs, get, buffers, o.transport, f, sr)
  let atL = has('latencybuffers') ? { ...setting(0), buffers: {} } : has('latencyparams') ? setting(0, declared) : has('latencytransport') ? { ...setting(0), transport: undefined } : setting(has('latencyend') ? frames : 0)
  let atT = has('tailparams') ? setting(frames, declared) : has('tailtransport') ? { ...setting(frames), transport: undefined } : setting(frames)
  let L = has('latency') ? 0 : (typeof p.latency === 'function' ? p.latency(atL) : p.latency) | 0
  let T = has('tail') ? 0 : typeof p.tail === 'function' ? p.tail(atT) : p.tail ?? 0
  let total = frames + L + (T > 0 && T < Infinity ? Math.round(T * sr) : 0), fed = b => b.map(c => { let x = new Float32Array(total); x.set(c); return x })
  if (has('inplace')) for (let c of [...o.input ?? [], ...o.key ?? []]) for (let i = 0; i < c.length; i++) if (!Number.isFinite(c[i])) c[i] = 0
  // each bus fed of the channels it carries, its samples finite (busIn)
  let res = resolveBuses(p.channels, [o.channels || undefined, o.key?.length]), keep = []
  let bus = (x, i) => has('nan') ? x : busIn(x, res.inputs[i].channels, 'toy', i, keep[i] ??= [])
  let ins = res.inputs.map((b, i) => i ? (i === 1 && o.key ? bus(fed(o.key), 1) : has('bus1') ? undefined : [])
    : o.channels ? has('bus0count') ? fed(source(o)) : bus(fed(source(o)), 0)
    : has('bus0') ? [] : Array.from({ length: b.channels }, () => new Float32Array(total)))
  let out = Array.from({ length: res.outputs[0]?.channels ?? 0 }, () => new Float32Array(total)), emitted = []
  let whole = p.streaming === false && !has('blocks')
  let ctx = hostCtx(p, {
    sampleRate: sr, maxBlockSize: whole ? total : has('oversize') ? B >> 1 : B,
    maxChannels: has('channels') ? 32 : widest(ins.map(b => b?.length ?? 0), [out.length]), params: snap(specs, built), buffers,
  }, (name, [value]) => has('emit') || emitted.push({ name, value }))
  let process = p(ctx)
  let evs = p.events?.in && noteEvents(o.notes ?? [], sr), pool = [], view = []
  if (has('id')) for (let e of evs) e.id = 0
  if (has('velocity')) for (let e of evs) if (e.kind === 'on') e.velocity = o.notes[e.id].velocity ?? 1
  let call = (f, n) => {
    if (has('clamp')) for (let k in asked) if (k in specs && typeof asked[k] !== 'object') live[k] = specs[k].type === 'number' ? Float32Array.of(parseFloat(asked[k])) : asked[k]
    if (has('lag')) for (let k in specs) if (specs[k].smoothing > 0) { lag[k] ??= live[k][0]; lag[k] += (live[k][0] - lag[k]) * Math.min(1, n / (specs[k].smoothing * sr)); live[k] = Float32Array.of(lag[k]) }
    if (has('zero')) process(ins.map(b => b?.map(c => c.subarray(f, f))), [out.map(c => c.subarray(f, f))], live)
    moveTransport(ctx.transport, o.transport?.bpm, o.transport?.timeSig, has('beat') ? 0 : f, sr)
    if (evs) {
      ctx.events = notesIn(evs, f, n, pool, view)
      if (has('unsorted')) view.reverse()
      if (has('pitch')) for (let s of view) delete s.midi
      if (has('notetime')) for (let s of view) s.time += f
    }
    process(ins.map(b => b?.map(c => c.subarray(f, f + n))), [out.map(c => c.subarray(f, f + n))], live)
  }
  for (let pos = 0, step = whole ? total : B; pos < total; pos += step) {
    let n = Math.min(step, total - pos)
    if (whole || has('nosplit')) valuesAt(state, live, pos, sr), call(pos, n)
    else eachCall(state, live, pos, n, sr, (i0, i1) => call(pos + i0, i1 - i0))
  }
  if (has('zeroend')) process(ins.map(b => b?.map(c => c.subarray(total))), [out.map(c => c.subarray(total))], live)
  return { output: out.map(c => c.subarray(L)), emitted }
}

test('the toy host keeps every duty', async () => {
  for (let d of duties) { await d.run(toy()); ok(true, d.name) }
})

// each duty, and the flaws that break it
const BREAKS = {
  'calls carry 1 to maxBlockSize frames': ['zero', 'zeroend', 'oversize'],
  'ctx.maxChannels is the widest bus of the instance': ['channels'],
  'input bus 0 always carries its channels; a further bus nothing feeds has none': ['bus0', 'bus0count', 'bus1'],
  'a NaN or Infinity coming in reaches the processor as 0, the arrays given unchanged': ['nan', 'inplace'],
  'a jump falls on a call boundary at its own frame': ['nosplit'],
  'while a value moves, no call is longer than 32 frames': ['nosplit'],
  'smoothing ramps a jump linearly over its seconds from the value in force; a slope is not smoothed again': ['smoothing', 'lag'],
  'no automation reaches a restart parameter': ['restart'],
  'numbers are clamped, undeclared enum values refused, text converted to the unit': ['clamp', 'enum', 'infinite'],
  'a stepped number is put on its step: a value, automation and a smoothing ramp': ['step'],
  'notes arrive sorted, ids assigned, offs paired': ['id', 'pitch', 'unsorted', 'notetime', 'velocity'],
  'ctx.transport is set before each block': ['beat'],
  'emissions are passed on': ['emit'],
  'latency is taken as the instance is built, and the output lined up by it': ['latency', 'latencybuffers', 'latencyparams'],
  'a tail is rendered as long as it is declared, by the instance that heard the input': ['tail', 'tailparams'],
  'a tail is handed the transport in force, a latency the one the instance is built with': ['latencytransport', 'latencyend', 'tailtransport', 'tail'],
  'buffers are there at construction, undefined when none is given': ['buffers'],
  'a whole-signal processor gets it in one call, its values fixed': ['blocks'],
}
test('every duty fails on a host that breaks it', async () => {
  for (let d of duties) {
    ok(BREAKS[d.name]?.length, `${d.name}: a flaw that breaks it`)
    for (let flaw of BREAKS[d.name] ?? []) {
      let err = null
      try { await d.run(toy(flaw)) } catch (e) { err = e }
      ok(err, `${d.name}, ${flaw}: ${err?.message ?? 'kept'}`)
    }
  }
})
