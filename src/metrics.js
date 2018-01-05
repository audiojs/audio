/**
 * Extend audio with playback functionality
 *
 * @module  audio/src/metrics
 */

'use strict'


const ft = require('fourier-transform')

//TODO: make external package
const loudness = {
	rms: require('compute-qmean')
}

let {parseArgs} = require('./util')
let Audio = require('../')

//get amplitudes range for the interval
Audio.prototype.limits = function (time, duration, options) {
	options = parseArgs(this, time, duration, options)

	if (this.stats) {
		//TODO: implement fast bounds search, extremum-based
	}

	let max = -1, min = 1

	//search across channels
	this.buffer.fill((buf, idx, offset) => {
		for (let c = 0, l = buf.length; c < options.channels.length; c++) {
			let channel = options.channels[c]
			let data = buf.getChannelData(channel)

			for (let i = 0; i < l; i++) {
				if (data[i] > max) max = data[i]
				if (data[i] < min) min = data[i]
			}
		}
	}, options.start, options.end)

	return [min, max]
}

Audio.prototype.spectrum = function (start, options) {
	if (typeof start !== 'number') {
		options = start
	}
	options = options || {}
	start = start || 0

	if (!options.size) options.size = 1024;

	if (!bit.isPow2(options.size)) throw Error('Size must be a power of 2')

	if (options.channel == null) options.channel = 0;

	let buf = this.readRaw(start * this.buffer.sampleRate, options.size);
	let waveform = buf.getChannelData(options.channel);
	let magnitudes = ft(waveform);

	if (options.db) {
		magnitudes = magnitudes.map(value => db.fromGain(value))
	}

	return magnitudes;
}

Audio.prototype.cepstrum = function () {

}

Audio.prototype.stats = function () {

}

//calculate loudness by provided method/interval
Audio.prototype.loudness = function (time, duration, options) {
	if (typeof options === 'string') options = {method: options}

	options = parseArgs(this, time, duration, options)

	if (options.type) options.method = options.type

	let calc = loudness[options.method] || loudness.rms

	let result = []

	let mean2 = []
	if (this.stats) {
		for (let c = 0; c < options.channels.length; c++) {
			let channel = options.channels[c]
			mean2.push(this.stats.mean2[channel])
		}
	}
	else {
		//TODO: compute-qmean has faster rms calculation, utilize it's method
		for (let c = 0; c < options.channels.length; c++) {
			let channel = options.channels[c]
			let data = this.getChannelData(channel, options.from, options.duration)
			let sum2 = 0
			for (let i = 0, l = data.length; i < l; i++) {
				// sum2 +=
			}

			// result.push(val)
		}
	}


	return options.channels.length === 1 ? result[0] : result
}


Audio.prototype.size = function size () {

	return this;
}


