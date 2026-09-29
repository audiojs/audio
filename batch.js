// toBatch / toStream — engine-free hosts for the atom contract (audiojs/compile CONTRACT.md § Core).
// toBatch drives a whole signal through per-block process calls (or one call for
// `streaming: false` atoms); toStream keeps one live instance across write() chunks.
// Param semantics mirror the worklet adapter: defaults from the spec, live values per
// block (constant, or a `t => value` automation function), linear block-rate smoothing
// over the declared seconds (first block snaps). Emissions are collected with the result.

const DEFAULTS = { sampleRate: 44100, maxBlockSize: 2048 }

function paramState (specs, init = {}) {
	let state = {}
	for (let name in specs) {
		let s = specs[name]
		let given = init[name] !== undefined ? init[name] : s.alias != null ? init[s.alias] : undefined   // alias: the param's former name
		let v = given !== undefined && typeof given !== 'function' ? given : s.default
		state[name] = {
			spec: s,
			fn: typeof given === 'function' ? given : null,
			buf: s.type === 'number' ? new Float32Array([v]) : null,
			value: v,        // enum string / bool / number target
			current: v,      // smoothed value (number only)
			init: true,
		}
	}
	return state
}

// live params object passed to process, updated per block
function updateParams (state, live, t, blockFrames, sampleRate) {
	for (let name in state) {
		let p = state[name], s = p.spec
		let target = p.fn ? p.fn(t) : p.value
		if (s.type !== 'number') { live[name] = target; continue }
		if (p.init) { p.current = target; p.init = false; p.rampFrom = null }
		else if (s.smoothing > 0 && p.current !== target) {
			// linear ramp: cover the jump over `smoothing` seconds, advanced per block
			if (p.rampFrom == null || p.rampTarget !== target) { p.rampFrom = p.current; p.rampTarget = target }
			let inc = (p.rampTarget - p.rampFrom) * (blockFrames / (s.smoothing * sampleRate))
			p.current = inc > 0 ? Math.min(target, p.current + inc) : Math.max(target, p.current + inc)
			if (p.current === target) p.rampFrom = null
		} else p.current = target
		p.buf[0] = p.current
		live[name] = p.buf
	}
	return live
}

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

// Speaker layouts and their channel counts (CONTRACT.md § Buses)
const LAYOUTS = { mono: 1, stereo: 2, quad: 4, '5.1': 6, '7.1': 8 }
export function layoutChannels (tag) {
	if (tag in LAYOUTS) return LAYOUTS[tag]
	let n = /^ambisonic-(\d+)$/.exec(tag)?.[1]
	if (n) return (+n + 1) ** 2
	throw new Error(`unknown layout "${tag}"`)
}

// one side of a `channels` declaration → buses, each { layouts: string[] } or { count: number | 'any' }
function sideBuses (decl) {
	let bus = d => typeof d === 'number' || d === 'any' ? { count: d } : typeof d === 'string' ? { layouts: [d] }
		: d?.layouts ? { layouts: [].concat(d.layouts) } : { count: 'any' }
	if (decl == null) return [{ count: 'any' }]
	if (!Array.isArray(decl)) return [bus(decl)]
	if (decl.length && decl.every(d => typeof d === 'string')) return [{ layouts: decl }]   // one bus, host picks
	return decl.map(bus)
}

/**
 * Resolve a `channels` declaration (CONTRACT.md § channels, § Buses) against the input buses' widths: a bus with
 * layouts takes the one chosen (`{ inputs, outputs }` of tags), else an input bus the first of its width, else an
 * output bus its input's layout when it declares it too, else the first. Count buses keep their count; 'any' takes
 * the width of input bus 0.
 * → { inputs: [{ layout, channels }], outputs: [{ layout, channels }], layouts } — layouts: ctx.layouts, or
 * undefined when the declaration names none.
 */
export function resolveBuses (channels = 'any', widths = [], chosen = {}) {
	let decl = typeof channels === 'object' && !Array.isArray(channels) ? channels : { inputs: channels, outputs: channels }
	let named = false
	let pick = (bus, b, side, want, prefer) => {
		if (!bus.layouts) return { layout: undefined, channels: bus.count === 'any' ? (widths[0] ?? 1) : bus.count }
		named = true
		let tag = chosen?.[side]?.[b]
		if (tag != null && !bus.layouts.includes(tag)) throw new Error(`${side} bus ${b}: layout "${tag}" is not declared (${bus.layouts.join(', ')})`)
		tag ??= want != null ? bus.layouts.find(t => layoutChannels(t) === want) : bus.layouts.includes(prefer) ? prefer : bus.layouts[0]
		if (tag == null) throw new Error(`${side} bus ${b}: ${want} channels fit none of its layouts (${bus.layouts.join(', ')})`)
		if (want != null && layoutChannels(tag) !== want) throw new Error(`${side} bus ${b}: layout "${tag}" has ${layoutChannels(tag)} channels, the input ${want}`)
		return { layout: tag, channels: layoutChannels(tag) }
	}
	let inputs = sideBuses(decl.inputs).map((bus, b) => pick(bus, b, 'inputs', widths[b]))
	let outputs = sideBuses(decl.outputs).map((bus, b) => pick(bus, b, 'outputs', undefined, inputs[b]?.layout))
	return { inputs, outputs, layouts: named ? { inputs: inputs.map(b => b.layout), outputs: outputs.map(b => b.layout) } : undefined }
}

function makeCtx (factory, opts, state, events) {
	let specs = factory.params || {}
	let snapshot = {}
	for (let name in specs) {
		let p = state[name]
		snapshot[name] = specs[name].type === 'number' ? new Float32Array([p.fn ? p.fn(0) : p.value]) : (p.fn ? p.fn(0) : p.value)
	}
	let declared = factory.events?.out || {}
	let ctx = {
		sampleRate: opts.sampleRate,
		maxBlockSize: opts.maxBlockSize,
		maxChannels: opts.maxChannels ?? 32,
		render: 'offline',
		duration: opts.duration,
		params: snapshot,
		currentTime: 0,
		layouts: undefined,
		events: undefined,
		emit (name, ...args) {
			if (!(name in declared)) throw new Error(`emit: "${name}" not declared in events.out`)
			events.push({ name, args, time: ctx.currentTime })
		},
	}
	return ctx
}

/**
 * toBatch(factory, opts?) → (input, params?) => output | { output, events }
 * input: null (generators) | Float32Array | Float32Array[] | Float32Array[][]
 * opts/params: { sampleRate, maxBlockSize, frames (generators), params: { name: value | t => value } }
 */
export function toBatch (factory, baseOpts = {}) {
	return function batch (input, runOpts = {}) {
		let opts = { ...DEFAULTS, ...baseOpts, ...runOpts }
		let specs = factory.params || {}
		let state = paramState(specs, opts.params || {})
		let events = []
		let { buses: inBuses, shape } = shapeIn(input)

		let frames = inBuses ? inBuses[0][0].length : (opts.frames ?? Math.round((opts.duration ?? 1) * opts.sampleRate))
		if (!opts.duration) opts.duration = frames / opts.sampleRate
		let res = resolveBuses(factory.channels, inBuses ? inBuses.map(b => b.length) : [], opts.layouts)
		let ctx = makeCtx(factory, opts, state, events)
		ctx.layouts = res.layouts
		let process = factory(ctx)

		let outDecl = res.outputs.map(b => b.channels)
		let outBuses = outDecl.map(nch => Array.from({ length: nch }, () => new Float32Array(frames)))

		let live = {}
		let block = factory.streaming === false ? frames : opts.maxBlockSize
		for (let pos = 0; pos < frames; pos += block) {
			let n = Math.min(block, frames - pos)
			ctx.currentTime = pos / opts.sampleRate
			updateParams(state, live, ctx.currentTime, n, opts.sampleRate)
			let ins = inBuses ? inBuses.map(b => b.map(c => c.subarray(pos, pos + n))) : []
			let outs = outBuses.map(b => b.map(c => c.subarray(pos, pos + n)))
			process(ins, outs, live)
		}

		let hasAudioOut = outBuses.length > 0 && outBuses[0].length > 0
		let hasEvents = !!factory.events?.out
		let output = hasAudioOut ? shapeOut(outBuses, shape === 'none' ? (outDecl[0] === 1 ? 'mono' : 'channels') : shape) : undefined
		if (!hasAudioOut) return { events }
		return hasEvents ? { output, events } : output
	}
}

/**
 * toStream(factory, opts?) → { write(chunk) → chunk', end() → tail, latency, events }
 * One live instance; chunks may be any length. Same input shapes as toBatch.
 */
export function toStream (factory, baseOpts = {}) {
	let opts = { ...DEFAULTS, ...baseOpts }
	if (factory.streaming === false) throw new Error('toStream: plugin declares streaming: false — use toBatch')
	let specs = factory.params || {}
	let state = paramState(specs, opts.params || {})
	let events = []
	let ctx = makeCtx(factory, opts, state, events)
	// declared layouts resolve before the first chunk: `layouts` given, else each bus's first
	let res = resolveBuses(factory.channels, [], opts.layouts)
	ctx.layouts = res.layouts
	let process = factory(ctx)
	let live = {}
	let started = false, outDecl

	return {
		latency: (typeof factory.latency === 'function' ? factory.latency(ctx) : factory.latency) | 0,
		events,
		write (chunk, chunkParams) {
			if (chunkParams) for (let k in chunkParams) if (state[k]) { state[k].value = chunkParams[k]; state[k].fn = null }
			let { buses: inBuses, shape } = shapeIn(chunk)
			let frames = inBuses ? inBuses[0][0].length : 0
			if (!started) {
				let widths = inBuses ? inBuses.map(b => b.length) : []
				res.inputs.forEach((b, i) => {
					if (b.layout && widths[i] != null && widths[i] !== b.channels) throw new Error(`toStream: input bus ${i} has ${widths[i]} channels, layout "${b.layout}" ${b.channels}; pass { layouts: { inputs: [...] } }`)
				})
				outDecl = res.layouts ? res.outputs.map(b => b.channels) : resolveBuses(factory.channels, widths).outputs.map(b => b.channels)
				started = true
			}
			let outBuses = outDecl.map(nch => Array.from({ length: nch }, () => new Float32Array(frames)))
			for (let pos = 0; pos < frames; pos += opts.maxBlockSize) {
				let n = Math.min(opts.maxBlockSize, frames - pos)
				updateParams(state, live, ctx.currentTime, n, opts.sampleRate)
				let ins = inBuses.map(b => b.map(c => c.subarray(pos, pos + n)))
				let outs = outBuses.map(b => b.map(c => c.subarray(pos, pos + n)))
				process(ins, outs, live)
				ctx.currentTime += n / opts.sampleRate
			}
			return outBuses[0]?.length ? shapeOut(outBuses, shape) : undefined
		},
		end (tailFrames) {
			let n = tailFrames ?? Math.round((factory.tail || 0) * opts.sampleRate)
			if (!n || !outDecl) return undefined
			let inBuses = outDecl.map(nch => Array.from({ length: nch }, () => new Float32Array(n)))
			// reuse write() with silence, preserving instance state
			return this.write(inBuses.length === 1 && inBuses[0].length === 1 ? inBuses[0][0] : inBuses[0])
		},
	}
}
