// A WAM 2.0 plugin for the tests, made with the SDK as plugins are: its input at `gain` dB, a sine at each held MIDI
// note's frequency and the tempo it hears (bpm / 10⁴, a DC step), all through a 64-sample delay it reports as its
// compensation delay (or `delay` samples, from its initial state).
import { WebAudioModule, WamNode, addFunctionModule } from '../../../node_modules/@webaudiomodules/sdk/dist/index.js'

/** The processor, stringified into the worklet by addFunctionModule: it reaches nothing outside itself */
const getProcessor = moduleId => {
	const { webAudioModules, registerProcessor } = globalThis
	const { WamProcessor, WamParameterInfo } = webAudioModules.getModuleScope(moduleId)
	class TestProcessor extends WamProcessor {
		constructor(options) {
			super(options)
			this.delay = options.processorOptions.delay
			this._compensationDelay = this.delay
			this.line = null
			this.at = 0
			this.notes = new Map()   // key → phase
			this.bpm = 0
		}
		_generateWamParameterInfo() {
			return { gain: new WamParameterInfo('gain', { label: 'Gain', type: 'float', defaultValue: 0, minValue: -60, maxValue: 12, units: 'dB' }) }
		}
		_onMidi({ bytes: [status, key, velocity] }) {
			let type = status & 0xf0
			if (type === 0x90 && velocity) this.notes.set(key, 0)
			else if (type === 0x80 || type === 0x90) this.notes.delete(key)
		}
		_onTransport(t) { this.bpm = t.tempo }
		_process(start, end, inputs, outputs) {
			const out = outputs[0], inp = inputs[0] || [], g = this._parameterInterpolators.gain.values
			const DELAY = this.delay
			if (!this.line) this.line = out.map(() => new Float32Array(DELAY))
			// what it makes: the input at its gain, a sine per held note, the tempo it hears as a DC step
			for (let c = 0; c < out.length; c++) {
				const x = inp[c] || inp[0], y = out[c]
				for (let i = start; i < end; i++) y[i] = (x ? x[i] * 10 ** (g[i] / 20) : 0) + this.bpm / 1e4
			}
			for (const [key, phase] of this.notes) {
				const w = 2 * Math.PI * 440 * 2 ** ((key - 69) / 12) / sampleRate
				let p = phase
				for (let i = start; i < end; i++, p += w) for (const y of out) y[i] += 0.25 * Math.sin(p)
				this.notes.set(key, p % (2 * Math.PI))
			}
			// all of it DELAY samples late, as it reports
			for (let c = 0; c < out.length; c++) {
				const y = out[c], line = this.line[c]
				for (let i = start, k = this.at; i < end; i++, k = (k + 1) % DELAY) { const v = line[k]; line[k] = y[i]; y[i] = v }
			}
			this.at = (this.at + end - start) % DELAY
		}
	}

	if (globalThis.AudioWorkletProcessor) registerProcessor(moduleId, TestProcessor)
	return TestProcessor
}

export default class TestWam extends WebAudioModule {
	constructor(groupId, audioContext) {
		super(groupId, audioContext)
		Object.assign(this._descriptor, { identifier: 'dev.audiojs.testwam', name: 'Test WAM', vendor: 'audiojs' })
	}
	async createAudioNode(initialState) {
		await WamNode.addModules(this.audioContext, this.moduleId)
		await addFunctionModule(this.audioContext.audioWorklet, getProcessor, this.moduleId)
		const node = new WamNode(this, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { delay: initialState?.delay ?? 64 } })
		await node._initialize()
		if (initialState) await node.setState(initialState)
		return node
	}
}
