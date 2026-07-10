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
		let v = init[name] !== undefined && typeof init[name] !== 'function' ? init[name] : s.default
		state[name] = {
			spec: s,
			fn: typeof init[name] === 'function' ? init[name] : null,
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
	if (shape === 'mono') return buses[0][0]
	if (shape === 'channels') return buses[0]
	return buses
}

function outputDecl (factory, inBuses) {
	let ch = factory.channels ?? 'any'
	if (typeof ch === 'number') return [ch]
	if (ch === 'any') return [inBuses ? inBuses[0].length : 1]
	let outs = ch.outputs ?? 'any'
	if (outs === 'any') return [inBuses ? inBuses[0].length : 1]
	if (typeof outs === 'number') return [outs]
	if (Array.isArray(outs)) return outs
	return []
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
		let ctx = makeCtx(factory, opts, state, events)
		let process = factory(ctx)

		let outDecl = outputDecl(factory, inBuses)
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
			if (!started) { outDecl = outputDecl(factory, inBuses); started = true }
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
