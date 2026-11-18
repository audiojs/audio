// toBatch / toStream: engine-free hosts for the processor contract (audiojs/compile CONTRACT.md, 1.0).
// toBatch drives a whole signal through process calls (one call for a `streaming: false` processor);
// toStream keeps one live instance across write() chunks. Both keep a host's duties as audio's own host does
// (core.js useOp), through the helpers below that it shares: values held to their spec and changed between calls only,
// a call split where one jumps and kept to 32 frames while one moves; each input bus of the channels it carries, its
// samples finite; notes, the transport and buffers in ctx.
// Emissions are collected with the result.

const DEFAULTS = { sampleRate: 44100, maxBlockSize: 2048 }

/** A processor's id, as every host's errors name it: its `id`, else its function's name, lowercase-dashed
 *  (CONTRACT.md § Identity: `pingPong` gives `ping-pong`) */
export const idOf = factory => factory.id || (factory.name ? factory.name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase() : 'processor')

// A value as its param's spec allows it, as a worklet's AudioParam holds one: a number on its step (the nearest from
// `min`, ties upward), within [min, max]; an enum one of its values, else its default (a value of another kind never
// gets here: `accept` refuses it as it is given, `resolved` as automation resolves to it). Every host's rule: toBatch,
// toStream, and audio's own (core.js hostOp), for a value, automation and a smoothing ramp alike
export function held (s, v) {
	if (s.type === 'enum') return s.values?.includes(v) ? v : s.default
	if (s.type !== 'number') return v
	if (s.step > 0) v = s.min + Math.round((v - s.min) / s.step) * s.step
	return v < s.min ? s.min : v > s.max ? s.max : v
}

// The units a value may be written in, by dimension, each as a power of ten of the smallest listed. A value goes from
// one to another by moving its decimal point, so it is the number its digits say in the new unit, as that literal
// would be: '10ms' is 0.01 s, '1.005s' is 1005 ms. A param that declares no unit takes s, Hz and dB, as the CLI reads a
// time, a frequency and a level
const UNITS = { ms: ['time', 0], s: ['time', 3], hz: ['frequency', 0], khz: ['frequency', 3], db: ['level', 0] }
const BASE = { time: 3, frequency: 0, level: 0 }

/**
 * A value written with a unit ('10ms', '0.01s', '1khz', '-3db', '+3db', '1e-3s') in the unit its param declares
 * (CONTRACT.md § Units): 10 to an attack in ms from either of the first two, 0.25 to a delay time in s from '250ms'. A
 * unit of another dimension than the param's is an error naming the op, the param and its unit. A number is in the
 * param's unit already and passes, as does any value of a param that is not a number. Every host's rule, like held
 */
export function inUnit (s, v, op, name) {
	if (typeof v !== 'string' || s.type !== 'number') return v
	let m = /^([+-]?(?:\d+\.?\d*|\.\d+))(?:e([+-]?\d+))?\s*([a-z%/]*)$/i.exec(v.trim()), u = m?.[3].toLowerCase(), to = s.unit?.toLowerCase()
	let shift = d => +`${m[1]}e${+(m[2] ?? 0) + d}`
	if (m && (u === '' || u === to)) return shift(0)
	let a = UNITS[u], b = to ? UNITS[to] : a && [a[0], BASE[a[0]]]
	if (!a || !b || a[0] !== b[0]) throw new RangeError(`${op}: ${name} takes ${kindOf(s)}, not '${v}'`)
	return shift(a[1] - b[1])
}

// A param read once, as its processor is built (`restart: true`, or `flags: ['restart']` as manifests published before
// 1.0 mark it: a delay line's length, a smoother's ballistics), holds one value for an instance: automation, or a value
// changed between chunks, would be heard as its first value
export const fixed = s => s.restart === true || !!s.flags?.includes('restart')
export const unfixed = (op, name, what) => new TypeError(`${op}: ${name} is fixed for a render (the processor reads it once, as it is built), so it takes one value, not ${what}`)

/** Breakpoint curve {t, v} (seconds → value): the serializable stand-in for `t => v` automation */
export const isCurve = x => x != null && typeof x === 'object' && x.t?.length > 0 && x.v?.length === x.t.length && typeof x.t[0] === 'number'

/** A value as an error names what was passed: a string quoted, a number or a boolean as written, anything else by its
 *  kind (a Float32Array, an array, an audio instance, an instance's JSON), never the samples it may hold */
export const what = v => {
	let t = typeof v
	if (t === 'string') return `'${v}'`
	if (v == null || t === 'number' || t === 'boolean') return String(v)
	let k = t !== 'object' ? t : v.pages ? 'audio instance' : v.getChannelData ? 'AudioBuffer' : ArrayBuffer.isView(v) ? v.constructor.name
		: Array.isArray(v) ? 'array' : isCurve(v) ? 'curve' : Array.isArray(v.edits) ? 'audio instance\'s JSON' : 'object'
	return `${/^[aeio]/i.test(k) ? 'an' : 'a'} ${k}`
}

/** Whether `v` is a value a param of spec `s` takes, in the forms a host resolves (sourceAt, held): automation (a
 *  function of the time, a curve { t, v }) for any param, or else a number for a number param (a string with a unit is
 *  one by now: inUnit; not NaN, which held passes on unclamped and the processor renders as NaN), one of its values
 *  for an enum, a boolean for a bool. null passes, as it did: a value left out by its place (a.ducker(null, -30)). A
 *  param of a type the contract does not list takes what it is given */
const ofKind = (s, v) => v === null || typeof v === 'function' || isCurve(v)
	|| (s.type === 'number' ? typeof v === 'number' && !Number.isNaN(v) : s.type === 'enum' ? !!s.values?.includes(v) : s.type === 'bool' ? typeof v === 'boolean' : true)

/** What a param of spec `s` takes, as an error says it: its unit, its values, true or false. A unit declared empty
 *  (specsub's beta: unit '') is none: 'a number', not "takes , not …" */
const kindOf = s => {
	if (s.type === 'bool') return 'true or false'
	if (s.type !== 'enum') return s.unit || 'a number'
	let q = s.values.map(v => typeof v === 'string' ? `'${v}'` : String(v))
	return q.length > 1 ? `${q.slice(0, -1).join(', ')} or ${q.at(-1)}` : q[0]
}
const unkind = (s, v, op, name) => new TypeError(`${op}: ${name} takes ${kindOf(s)}, not ${what(v)}`)

/**
 * A value given to a param, as every host accepts it (CONTRACT.md § What a host owes, 2 and 4): automation of a param
 * read once refused, text in its unit (inUnit), and then a value of its kind (an undeclared enum value, an array for a
 * number, a word for a bool: an error naming the processor, the param, what it takes and what was passed). The
 * processor's own default passes as declared: a manifest is the validator's to check, not a host's. Every host's:
 * toBatch's and toStream's params, toStream's write, audio's edits (core.js hostOp settle)
 */
export function accept (s, v, op, name) {
	if ((typeof v === 'function' || isCurve(v)) && fixed(s)) throw unfixed(op, name, 'automation')
	v = inUnit(s, v, op, name)
	if (v !== s.default && !ofKind(s, v)) throw unkind(s, v, op, name)
	return v
}

// The longest call while a value moves (CONTRACT.md § Parameters, Time)
export const MOVING = 32

// A value's source at frame `f`: a value; a function of the time in seconds (automation, moving throughout); a curve
// { t, v } of seconds, straight between its points (a value that is not a number, an enum's word or a bool, holds to
// the next), a step where two share a time (the later one from its frame on), flat past its ends. `span` is set to the
// frames it holds from f: to the curve's next point, MOVING while it moves; `step` to whether a curve steps at f (what
// it reaches f with, from before, is not its value there)
let span = Infinity, step = false
export function sourceAt (v, f, sr, bp) {
	step = false
	if (typeof v === 'function') return span = MOVING, v(f / sr)
	if (!isCurve(v)) return span = Infinity, v
	bp ??= v.t.map(t => Math.round(t * sr))
	let n = bp.length, i = n - 1, k
	if (f < bp[0]) return span = bp[0] - f, v.v[0]
	while (i > 0 && bp[i] > f) i--
	for (k = i; k > 0 && bp[k - 1] === f;) k--
	step = v.v[k] !== v.v[i]
	if (i === n - 1) return span = Infinity, v.v[i]
	let a = bp[i], b = bp[i + 1], x = v.v[i], y = v.v[i + 1]
	if (x === y || typeof x !== 'number' || typeof y !== 'number') return span = b - f, x
	return span = Math.min(MOVING, b - f), x + (y - x) * (f - a) / (b - a)
}

// Each param's state in a host: its spec, the processor and the param as errors name them, its source (a value, a
// function, a curve), the value in force and a smoothing ramp (what a jump differs by, ramped away from frame `at` over
// `len`). `given` holds the values asked for, by name or by a param's alias (its former name)
export function paramState (specs, given = {}, op) {
	let state = {}
	for (let name in specs) {
		let s = specs[name], v = given[name] !== undefined ? given[name] : s.alias != null ? given[s.alias] : undefined
		state[name] = { spec: s, op, name, src: undefined, bp: null, cur: 0, init: true, set: false, off: 0, at: 0, len: 0, buf: s.type === 'number' ? new Float32Array(1) : null }
		setParam(state[name], v === undefined ? s.default : v, op, name)
	}
	return state
}

// A new source for a param: a value, a function of seconds or a curve, as `accept` takes it, set anew (a jump from the
// frame it is next read at) unless it is the one in place
export function setParam (p, v, op, name) {
	v = accept(p.spec, v, op, name)
	if (v === p.src) return
	p.src = v
	p.bp = null
	p.set = true
}

// What automation resolves to at a frame is a value of its param's kind, else an error, as a value given of another
// kind is (accept): a function of the time that returns an undeclared enum value, a word for a number, NaN
const resolved = (p, x) => {
	if (x !== p.src && !ofKind(p.spec, x)) throw unkind(p.spec, x, p.op, p.name)
	return x
}

// A param's value at frame f, held to its spec, without moving its state: what ctx.params and a latency or tail
// function read
export const valueAt = (p, f, sr) => held(p.spec, resolved(p, sourceAt(p.src, f, sr)))

/**
 * Each param's value at frame `f` of the timeline into `live`, and the frames they all hold from there: to a curve's
 * next point, and at most MOVING while one moves (a smoothing ramp, an automation function, a curve's slope);
 * Infinity when none changes unasked (CONTRACT.md § Parameters, Time). The first values snap. A param with `smoothing`
 * reaches a jump (a value set anew, a curve's step) by a linear ramp of that many seconds from the value in force: what
 * it jumped by, ramped away over them while its source goes on, so a step into a slope ends on the slope. A value that
 * moves by itself (a function, a curve's slope) is its own, not smoothed again
 */
export function valuesAt (state, live, f, sr) {
	let hold = Infinity
	for (let name in state) {
		let p = state[name], s = p.spec
		if (isCurve(p.src)) p.bp ??= p.src.t.map(t => Math.round(t * sr))
		let v = held(s, resolved(p, sourceAt(p.src, f, sr, p.bp))), h = span
		if (s.type === 'number') {
			if (p.init) p.init = false
			else if (s.smoothing > 0 && (p.set || step)) p.off = p.cur - v, p.at = f, p.len = p.off ? Math.max(1, Math.round(s.smoothing * sr)) : 0
			p.set = false
			if (p.len && f - p.at >= p.len) p.len = 0
			if (p.len) v = held(s, v + p.off * (1 - (f - p.at) / p.len)), h = Math.min(h, MOVING, p.at + p.len - f)
			p.cur = v
			p.buf[0] = v
			v = p.buf
		}
		live[name] = v
		if (h < hold) hold = h
	}
	return hold
}

/** The calls a block of `n` frames from frame `f` of the timeline splits into: `call(i0, i1)` for each, the values it
 *  holds set in `live` before it (valuesAt). Where nothing moves, the block is one call */
export function eachCall (state, live, f, n, sr, call) {
	for (let i = 0, k; i < n; i += k) {
		k = Math.max(1, Math.min(n - i, valuesAt(state, live, f + i, sr)))
		call(i, i + k)
	}
}

/**
 * A notes option ([{ time, midi | freq, duration?, velocity? }], seconds) as note events (CONTRACT.md § Events), each
 * { time (frame), kind, midi, velocity, id }: sorted by frame, at one frame an off before an on unless it ends a note
 * begun there; ids from 0 in the list's order, so unique among the notes sounding; velocity held to 0..1
 */
export function noteEvents (notes, sr) {
	let evs = []
	notes.forEach((n, id) => {
		let midi = n.midi ?? (n.freq != null ? 69 + 12 * Math.log2(n.freq / 440) : 69)
		let on = Math.round((n.time ?? 0) * sr), velocity = Math.min(1, Math.max(0, n.velocity ?? 1))
		evs.push({ time: on, kind: 'on', midi, velocity, id, on })
		if (n.duration != null) evs.push({ time: on + Math.round(n.duration * sr), kind: 'off', midi, velocity: 0, id, on })
	})
	let rank = e => e.kind === 'on' ? 1 : e.on < e.time ? 0 : 2
	return evs.sort((a, b) => a.time - b.time || rank(a) - rank(b))
}

/** The note events of frames [f, f + n) in `view`, their times from f, in slots of `pool` that the next call reuses */
export function notesIn (evs, f, n, pool, view) {
	let lo = 0, hi = evs.length, k = 0
	while (lo < hi) { let mid = (lo + hi) >> 1; if (evs[mid].time < f) lo = mid + 1; else hi = mid }
	for (let i = lo; i < evs.length && evs[i].time < f + n; i++, k++) {
		let e = evs[i], s = view[k] = pool[k] ??= {}
		s.time = e.time - f; s.kind = e.kind; s.midi = e.midi; s.velocity = e.velocity; s.id = e.id
		s.pitch = e.midi   // for manifests published before 1.0, which read `pitch`
	}
	view.length = k
	return view
}

/** ctx.transport for a host with no tempo (CONTRACT.md § Context) */
export const stillTransport = () => ({ playing: false, bpm: 120, beat: 0, barStart: 0, timeSig: [4, 4] })

/** ctx.transport `tr` at frame `f` of the timeline, in place: with a tempo (`bpm`, `timeSig` [numerator, denominator]),
 *  playing, the beat there in quarter notes from the timeline's start and the bar line at or before it (a bar is
 *  numerator × 4 / denominator quarter notes); with none, as it was made */
export function moveTransport (tr, bpm, timeSig, f, sr) {
	if (!(bpm > 0)) return tr
	let [num, den] = timeSig ?? [4, 4], bar = num * 4 / den
	tr.playing = true; tr.bpm = bpm; tr.timeSig[0] = num; tr.timeSig[1] = den
	tr.beat = f * bpm / (60 * sr)
	tr.barStart = Math.floor(tr.beat / bar) * bar
	return tr
}

/** What a latency, tail or frames function is handed (CONTRACT.md § Latency, tail, whole signals): the rate, the values
 *  `get(name)` gives, held, the buffers, and the transport in force at frame `f` with `tempo` ({ bpm, timeSig }; none:
 *  standing still), a new one, as ctx.transport would be there: a tail's where the input ends, the others' where the
 *  instance is built. Every host's: toBatch, toStream, audio's own (core.js hostOp) */
export const settingAt = (specs, get, buffers, tempo, f, sr) => ({ sampleRate: sr, params: snap(specs, get), buffers, transport: moveTransport(stillTransport(), tempo?.bpm, tempo?.timeSig, f, sr) })

/** The channels a source holds (a buffer, a key): an audio instance's, an AudioBuffer's (its length is its frames), a
 *  Float32Array[]'s, one for a Float32Array */
export const channelsOf = b => ArrayBuffer.isView(b) ? 1 : b.pages ? b.channels : b.numberOfChannels ?? b.length

/** The buffers a processor declares (CONTRACT.md § Buffers), each as `given` holds it (`read(b, name)` turns one that
 *  has a rate, an audio instance or an AudioBuffer, into channels at the host's): a Float32Array[] as it is, a
 *  Float32Array as one channel, none as undefined. A channel count its declaration does not take is an error naming
 *  the buffer */
export function buffersOf (factory, given = {}, read) {
	let out = {}
	for (let name in factory.buffers || {}) {
		let b = given?.[name], ok = factory.buffers[name]?.channels
		if (b == null) { out[name] = undefined; continue }
		let n = channelsOf(b)
		if (ok != null && ok !== 'any' && ![].concat(ok).includes(n)) throw new RangeError(`${idOf(factory)}: buffer ${name} has ${n} channel${n === 1 ? '' : 's'}, it takes ${[].concat(ok).join(' or ')}`)
		out[name] = ArrayBuffer.isView(b) ? [b] : b.pages || b.getChannelData ? read?.(b, name) : b
	}
	return out
}

// How toBatch and toStream read a buffer that is a sound: they cannot (a sound renders through audio's engine, at a
// rate of its own), so it is an error naming the buffer and what they take
const unread = (host, op) => (b, name) => { throw new TypeError(`${op}: buffer ${name} is a sound, which ${host} cannot render; it takes planar arrays at the render's rate (Float32Array[])`) }

// normalize audio into buses × channels; remember the container shape
function shapeIn (input) {
	if (input == null) return { buses: null, shape: 'none' }
	if (input[0]?.length === undefined) return { buses: [[input]], shape: 'mono' }
	if (input[0][0]?.length === undefined) return { buses: [input], shape: 'channels' }
	return { buses: input, shape: 'buses' }
}
function shapeOut (buses, shape) {
	// a bare channel in, several out (mono → stereo, → ambisonic): the channels, not the first
	if (shape === 'mono') return buses[0].length > 1 ? buses[0] : buses[0][0]
	if (shape === 'channels') return buses[0]
	return buses
}

/** The input buses a process call reads (CONTRACT.md § process), each as busIn hands it: bus 0 always with its channels,
 *  silent when nothing feeds it; a further one nothing feeds, none; buses given past the declared ones, as given.
 *  `keep`: the instance's scratch for busIn */
export function inputBuses (declared, given, frames, op, keep = []) {
	let ins = declared.map((b, i) => given?.[i] != null ? busIn(given[i], b.channels, op, i, keep[i] ??= []) : i ? [] : Array.from({ length: b.channels }, () => new Float32Array(frames)))
	for (let i = declared.length; i < (given?.length ?? 0); i++) ins.push(busIn(given[i], undefined, op, i, keep[i] ??= []))
	return ins
}

/** Input bus `i` fed the channels `x`, for a processor whose bus carries `n` (CONTRACT.md § process: "Input bus 0 always
 *  carries its channels"; a further bus that declares a count carries it too), as plugin hosts feed a bus: as fed where
 *  they are n (a bus of any count carries what feeds it), one channel copied to each of n, any other count an error
 *  naming both. Its samples finite (`keep`, the instance's scratch for it: see finite) */
export function busIn (x, n, op, i = 0, keep = []) {
	x = finite(x, keep)
	if (n == null || x.length === n) return x
	if (x.length === 1 && n > 1) return Array.from({ length: n }, () => x[0])
	throw new RangeError(`${op}: input bus ${i} takes ${n} channel${n === 1 ? '' : 's'}, not the ${x.length} that feed it`)
}

/** The channels `x` with no NaN or Infinity (CONTRACT.md § What a host owes, 5: one coming in is made 0), the caller's
 *  arrays never written: clean, they are handed over as they are; a channel that holds one is copied into `keep` (the
 *  instance's scratch, grown as needed: a clean input allocates nothing) with those samples 0 */
export function finite (x, keep) {
	let y = x
	for (let c = 0; c < x.length; c++) {
		let a = x[c], i = 0
		while (i < a.length && Number.isFinite(a[i])) i++
		if (i === a.length) { if (y !== x) y[c] = a; continue }
		// the first channel that holds one: the bus from here on in keep, the channels before it as they are
		if (y === x) { y = keep.bus ??= []; y.length = x.length; for (let k = 0; k < c; k++) y[k] = x[k] }
		let b = keep[c]?.length >= a.length ? keep[c].subarray(0, a.length) : keep[c] = new Float32Array(a.length)
		b.set(a.subarray(0, i))
		for (; i < a.length; i++) b[i] = Number.isFinite(a[i]) ? a[i] : 0
		y[c] = b
	}
	return y
}

/** ctx.maxChannels: the channels of the widest bus of an instance */
export const widest = (...sides) => Math.max(0, ...sides.flat())

// Speaker layouts and their channel counts (CONTRACT.md § Buses)
const LAYOUTS = { mono: 1, stereo: 2, quad: 4, '5.1': 6, '7.1': 8 }
export function layoutChannels (tag) {
	if (tag in LAYOUTS) return LAYOUTS[tag]
	let n = /^ambisonic-(\d+)$/.exec(tag)?.[1]
	if (n) return (+n + 1) ** 2
	throw new Error(`unknown layout "${tag}"`)
}

// one side of a `channels` declaration → buses, each { layouts: string[] } or { count: number | 'any' }, and its `name`
export function sideBuses (decl) {
	let bus = d => typeof d === 'number' || d === 'any' ? { count: d } : typeof d === 'string' ? { layouts: [d] }
		: d?.layouts ? { layouts: [].concat(d.layouts), name: d.name } : { count: d?.channels ?? 'any', name: d?.name }
	if (decl == null) return [{ count: 'any' }]
	if (!Array.isArray(decl)) return [bus(decl)]
	if (decl.length && decl.every(d => typeof d === 'string' && d !== 'any')) return [{ layouts: decl }]   // one bus, host picks
	return decl.map(bus)
}

/**
 * Resolve a `channels` declaration (CONTRACT.md § channels, § Buses) against the input buses' widths: a bus with
 * layouts takes the one chosen (`{ inputs, outputs }` of tags), else an input bus the first of its width, else an
 * output bus its input's layout when it declares it too, else the first. Count buses keep their count; 'any' takes
 * the width of what feeds it: an input bus its own (bus 0 fed by nothing one, a further one none), an output bus input
 * bus 0's.
 * `op`, the processor's name, opens a refusal of a width none of a bus's layouts has, as the other count errors do.
 * → { inputs: [{ layout, channels }], outputs: [{ layout, channels }], layouts } — layouts: ctx.layouts, or
 * undefined when the declaration names none.
 */
export function resolveBuses (channels = 'any', widths = [], chosen = {}, op) {
	let decl = typeof channels === 'object' && !Array.isArray(channels) ? channels : { inputs: channels, outputs: channels }
	let named = false
	let pick = (bus, b, side, want, prefer) => {
		if (!bus.layouts) return { layout: undefined, channels: bus.count !== 'any' ? bus.count : side === 'inputs' ? want ?? (b ? 0 : 1) : widths[0] ?? 1 }
		named = true
		let tag = chosen?.[side]?.[b]
		if (tag != null && !bus.layouts.includes(tag)) throw new Error(`${side} bus ${b}: layout "${tag}" is not declared (${bus.layouts.join(', ')})`)
		tag ??= want != null ? bus.layouts.find(t => layoutChannels(t) === want) : bus.layouts.includes(prefer) ? prefer : bus.layouts[0]
		if (tag == null) throw new Error(`${op ? `${op}: ` : ''}${side} bus ${b}: ${want} channel${want === 1 ? ' fits' : 's fit'} none of its layouts (${bus.layouts.join(', ')})`)
		if (want != null && layoutChannels(tag) !== want) throw new Error(`${side} bus ${b}: layout "${tag}" has ${layoutChannels(tag)} channels, the input ${want}`)
		return { layout: tag, channels: layoutChannels(tag) }
	}
	let inputs = sideBuses(decl.inputs).map((bus, b) => pick(bus, b, 'inputs', widths[b]))
	let outputs = sideBuses(decl.outputs).map((bus, b) => pick(bus, b, 'outputs', undefined, inputs[b]?.layout))
	return { inputs, outputs, layouts: named ? { inputs: inputs.map(b => b.layout), outputs: outputs.map(b => b.layout) } : undefined }
}

// The params a factory is made with, `get(name)` held: a number as a one-sample Float32Array
export function snap (specs, get) {
	let s = {}
	for (let name in specs) {
		let v = held(specs[name], get(name))
		s[name] = specs[name].type === 'number' ? new Float32Array([v]) : v
	}
	return s
}

// The context a factory is made with, in every host (toBatch, toStream, audio's own): `emit` takes only what
// `events.out` declares (a descriptor { min, max, unit? }, or 'number' as manifests published before 1.0 declare it),
// each one handed to `heard(name, args, time)` where the host keeps them. maxChannels is the host's to give: no default
export function hostCtx (factory, { sampleRate, maxBlockSize, maxChannels, duration, params, layouts, buffers = {}, transport = stillTransport() }, heard) {
	let declared = factory.events?.out || {}
	let ctx = {
		sampleRate, maxBlockSize, maxChannels, render: 'offline', duration, params, buffers, currentTime: 0, layouts, transport,
		events: factory.events?.in?.includes('note') ? [] : undefined,
		emit (name, ...args) {
			if (!(name in declared)) throw new Error(`emit: "${name}" not declared in events.out`)
			heard?.(name, args, ctx.currentTime)
		},
	}
	return ctx
}

function makeCtx (factory, opts, state, events) {
	let params = snap(factory.params || {}, name => valueAt(state[name], 0, opts.sampleRate))
	return hostCtx(factory, { ...opts, params, transport: undefined }, (name, args, time) => events.push({ name, args, time }))
}

// One call of `process` over frames [f, f + n) of the timeline, at offset `a` of the buses, writing `m` frames (a
// whole-signal processor's `frames`; n otherwise): ctx set for it first
function callAt (ctx, process, ins, outs, live, f, a, n, sr, tempo, notes, m = n) {
	ctx.currentTime = f / sr
	moveTransport(ctx.transport, tempo?.bpm, tempo?.timeSig, f, sr)
	if (notes) ctx.events = notesIn(notes.evs, f, n, notes.pool, notes.view)
	process(ins.map(b => b.map(c => c.subarray(a, a + n))), outs.map(b => b.map(c => c.subarray(a, a + m))), live)
}
const notesOf = (factory, notes, sr) => factory.events?.in?.includes('note') ? { evs: notes ? noteEvents(notes, sr) : [], pool: [], view: [] } : null

/**
 * toBatch(factory, opts?) → (input, params?) => output | { output, events }
 * input: null (generators) | Float32Array | Float32Array[] | Float32Array[][]
 * opts/params: { sampleRate, maxBlockSize, frames (generators), params: { name: value | t => value | { t, v } },
 *   buffers: { name: Float32Array[] | Float32Array }, notes: [{ time, midi, duration?, velocity? }],
 *   transport: { bpm, timeSig } }
 * A value of another kind than its param's (an undeclared enum value, a word for a number, a number for a bool) is an
 * error at the call, naming the processor, the param, what it takes and what was passed (`accept`); automation where
 * it resolves to one.
 * The output is what the processor wrote, raw: as long as the input (a whole-signal processor's as its `frames` says),
 * its latency not compensated and no tail rendered. For them, use toStream (its `latency` says how many frames to
 * drop, end() renders the tail) or audio (audio.use(processor): an op that does both)
 */
export function toBatch (factory, baseOpts = {}) {
	return function batch (input, runOpts = {}) {
		let opts = { ...DEFAULTS, ...baseOpts, ...runOpts }, sr = opts.sampleRate, op = idOf(factory)
		let state = paramState(factory.params || {}, opts.params || {}, op)
		let buffers = buffersOf(factory, opts.buffers, unread('toBatch', op))
		let events = []
		let { buses: given, shape } = shapeIn(input)

		let frames = given ? given[0][0].length : (opts.frames ?? Math.round((opts.duration ?? 1) * sr))
		if (!opts.duration) opts.duration = frames / sr
		let widths = given ? given.map(b => b.length) : []
		let res = resolveBuses(factory.channels, widths, opts.layouts, op)
		let ins = inputBuses(res.inputs, given, frames, op)
		// a whole-signal processor gets it in one call, its values fixed: a call as long as the signal, and its output as
		// long as its `frames` says, of { sampleRate, params, buffers, transport } as it is built (CONTRACT.md § Latency,
		// tail, whole signals)
		let whole = factory.streaming === false
		let out = whole && factory.frames ? Math.max(0, Math.round(factory.frames(frames, settingAt(factory.params || {}, name => valueAt(state[name], 0, sr), buffers, opts.transport, 0, sr)))) : frames
		let outDecl = res.outputs.map(b => b.channels)
		let outBuses = outDecl.map(nch => Array.from({ length: nch }, () => new Float32Array(out)))
		let ctx = makeCtx(factory, { ...opts, maxBlockSize: whole ? Math.max(frames, out) : opts.maxBlockSize, maxChannels: widest(ins.map(b => b.length), outDecl), layouts: res.layouts, buffers }, state, events)
		let process = factory(ctx)
		let notes = notesOf(factory, opts.notes, sr), tempo = opts.transport, live = {}

		if (whole) { if (frames) valuesAt(state, live, 0, sr), callAt(ctx, process, ins, outBuses, live, 0, 0, frames, sr, tempo, notes, out) }
		else for (let pos = 0; pos < frames; pos += opts.maxBlockSize)
			eachCall(state, live, pos, Math.min(opts.maxBlockSize, frames - pos), sr, (i0, i1) => callAt(ctx, process, ins, outBuses, live, pos + i0, pos + i0, i1 - i0, sr, tempo, notes))

		let hasAudioOut = outBuses.length > 0 && outBuses[0].length > 0
		let hasEvents = !!factory.events?.out
		let output = hasAudioOut ? shapeOut(outBuses, shape === 'none' ? (outDecl[0] === 1 ? 'mono' : 'channels') : shape) : undefined
		if (!hasAudioOut) return { events }
		return hasEvents ? { output, events } : output
	}
}

/**
 * toStream(factory, opts?) → { write(chunk, params?) → chunk', end() → tail, latency, events }
 * One live instance, built at the first write (its channels are the chunk's); chunks may be any length. Same input
 * shapes and options as toBatch; a number for a chunk is that many frames with nothing fed (a generator's). A bus
 * carries from the first chunk on what it carried then, a later chunk of one channel copied to each of more; a chunk of
 * another count is another configuration, an error: a new instance is a new toStream.
 * write's params are values, by name or alias: a jump at the chunk's first frame, ramped over a param's `smoothing`.
 * end() renders the tail, none for an endless one (Infinity), which cannot be flushed
 */
export function toStream (factory, baseOpts = {}) {
	let opts = { ...DEFAULTS, ...baseOpts }, sr = opts.sampleRate
	let specs = factory.params || {}, op = idOf(factory)
	if (factory.streaming === false) throw new Error(`toStream: ${op} declares streaming: false; use toBatch`)
	let state = paramState(specs, opts.params || {}, op)
	let buffers = buffersOf(factory, opts.buffers, unread('toStream', op))
	let events = []
	// declared layouts resolve before the first chunk: `layouts` given, else each bus's first
	let res = resolveBuses(factory.channels, [], opts.layouts, op)
	let notes = notesOf(factory, opts.notes, sr), tempo = opts.transport
	let live = {}, ctx = null, process = null, outDecl, carry, keep = [], pos = 0
	// the values in force at frame f, and the transport there
	let setting = f => settingAt(specs, name => valueAt(state[name], f, sr), buffers, tempo, f, sr)

	return {
		latency: (typeof factory.latency === 'function' ? factory.latency(setting(0)) : factory.latency) | 0,
		events,
		write (chunk, chunkParams) {
			let { buses: given, shape } = typeof chunk === 'number' ? { buses: null, shape: 'none' } : shapeIn(chunk)
			let frames = typeof chunk === 'number' ? chunk : given ? given[0][0].length : 0
			let widths = given ? given.map(b => b.length) : []
			// the instance is one configuration (CONTRACT.md § Lifecycle): a bus carries from the first chunk on what it carried
			// then, one channel copied to each of more (busIn) whenever it comes; a chunk of another count is another
			if (process && given) widths.forEach((n, i) => {
				let was = carry[i] ?? 0
				if (n !== was && !(n === 1 && was > 1)) throw new RangeError(`toStream: ${op} was built for ${was} channel${was === 1 ? '' : 's'} on input bus ${i}${was > 1 ? ' (or one, copied to each)' : ''}, this chunk has ${n}: other channels are another instance (another toStream)`)
			})
			if (chunkParams) for (let k in chunkParams) {
				// a param by its name, or by its alias (its former name) where the name is not given too
				let name = state[k] ? k : Object.keys(specs).find(n => specs[n].alias === k && chunkParams[n] === undefined)
				if (!name) continue
				let p = state[name], v = chunkParams[k]
				// a function or a curve is asked at a render's time, which a chunk has none of
				if (typeof v === 'function' || isCurve(v)) throw new TypeError(`${op}: ${name} takes a value between chunks, not ${typeof v === 'function' ? 'a function' : 'a curve'}: a stream has no render time to ask it at (give automation to toStream's params)`)
				v = accept(p.spec, v, op, name)
				if (fixed(p.spec) && held(p.spec, v) !== valueAt(p, pos, sr)) throw unfixed(op, name, 'a change between chunks')
				setParam(p, v, op, name)
			}
			if (!process) {
				res.inputs.forEach((b, i) => {
					if (b.layout && widths[i] != null && widths[i] !== b.channels) throw new Error(`toStream: input bus ${i} has ${widths[i]} channels, layout "${b.layout}" ${b.channels}; pass { layouts: { inputs: [...] } }`)
				})
				// buses of a count resolve against the first chunk's channels; those of layouts as before it. What each carries
				// from then on: its count, a further one nothing fed none, one past the declared ones as fed
				res = resolveBuses(factory.channels, widths, opts.layouts, op)
				carry = Array.from({ length: Math.max(res.inputs.length, widths.length) }, (_, i) => i >= res.inputs.length ? widths[i] : i && widths[i] == null ? 0 : res.inputs[i].channels)
				outDecl = res.outputs.map(b => b.channels)
				ctx = makeCtx(factory, { ...opts, maxChannels: widest(carry, outDecl), layouts: res.layouts, buffers }, state, events)
				process = factory(ctx)
			}
			let ins = inputBuses(res.inputs, given, frames, op, keep)
			let outBuses = outDecl.map(nch => Array.from({ length: nch }, () => new Float32Array(frames)))
			for (let at = 0; at < frames; at += opts.maxBlockSize)
				eachCall(state, live, pos + at, Math.min(opts.maxBlockSize, frames - at), sr, (i0, i1) => callAt(ctx, process, ins, outBuses, live, pos + at + i0, at + i0, i1 - i0, sr, tempo, notes))
			pos += frames
			return outBuses[0]?.length ? shapeOut(outBuses, shape === 'none' ? (outDecl[0] === 1 ? 'mono' : 'channels') : shape) : undefined
		},
		end (tailFrames) {
			// tail: seconds, or a function of { sampleRate, params, buffers, transport } read with the values and the
			// transport in force now, where the input ends (CONTRACT.md § Latency, tail). An endless one (Infinity) cannot be
			// flushed: none is rendered for it
			if (!process) return undefined
			let tail = typeof factory.tail === 'function' ? factory.tail(setting(pos)) : factory.tail
			let n = tailFrames ?? (tail > 0 && tail < Infinity ? Math.round(tail * sr) : 0)
			// reuse write() with nothing fed, preserving instance state
			return n ? this.write(n) : undefined
		},
	}
}
