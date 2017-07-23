/**
 * Extend audio with playback functionality
 *
 * @module  audio/src/metrics
 */

'use strict'


const ft = require('fourier-transform')

let Audio = require('../')

//get amplitudes range for the interval
Audio.prototype.range = function (time, duration, options) {
	options = this._parseArgs(time, duration, options)

	if (this.stats) {
		//TODO: implement fast bounds search, extremum-based
	}

	let max = -1, min = 1

	//search across channels
	this.buffer.map((buf, idx, offset) => {
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


Audio.prototype.loudness = function () {

}


Audio.prototype.size = function size () {

	return this;
}


