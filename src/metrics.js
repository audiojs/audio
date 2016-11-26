/**
 * Extend audio with playback functionality
 *
 * @module  audio/src/metrics
 */

'use strict'


let Audio = require('../')
const ft = require('fourier-transform')
const bit = require('bit-twiddle')
const db = require('decibels')

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


