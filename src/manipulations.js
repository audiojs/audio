/**
 * Extend audio with manipulations functionality
 *
 * @module  audio/src/manipulations
 */

'use strict'


const util = require('audio-buffer-utils')
const nidx = require('negative-index')

let Audio = require('../')


//normalize contents by the offset
Audio.prototype.normalize = function normalize (time = 0, duration = this.buffer.duration) {
	let start = Math.floor(time * this.buffer.sampleRate)
	let end = Math.floor(duration * this.buffer.sampleRate) + start

	util.normalize(this.buffer, start, end)

	return this;
}

//fade in/out
Audio.prototype.fade = function (start, duration, easing) {
	if (arguments.length < 2) {
		easing = duration
		duration = start
		start = 0
	}
	if (duration == null) duration = .5
	start = nidx(start, this.buffer.duration)

	let step = duration > 0 ? 1 : -1
	let halfStep = step*.5
	let startOffset = start * this.buffer.sampleRate
	let len = duration * this.buffer.sampleRate
	let endOffset = startOffset + len
	let map = typeof easing === 'function' ? easing : (t) => t

	for (let c = 0, l = this.buffer.length; c < this.buffer.numberOfChannels; c++) {
		let data = this.buffer.getChannelData(c)
		for (let i = startOffset; i != endOffset; i+=step) {
			let idx = Math.floor(nidx(i + halfStep, l))
			let t = (i + halfStep - startOffset) / len
			data[idx] *= map(t)
		}
	}

	return this
}

//trim start/end silence
Audio.prototype.trim = function trim (threshold = 0) {
	this.buffer = util.trim(this.buffer, threshold)

	//TODO: trimLeft, trimRight

	return this;
}

//regulate volume of playback/output/read etc
Audio.prototype.volume = function volume (start, end) {
	if (arguments.length < 2) {
		duration = start;
		start = 0;
	}
	if (duration == null) duration = .5;

	start = Math.floor(nidx(start, this.buffer.length))
	start = nidx(start, duration);

	return this;
};

//regulate rate of playback/output/read etc
Audio.prototype.rate = function rate () {
	return this;
};

Audio.prototype.reverse = function reverse () {

	return this;
}
Audio.prototype.mix = function mix () {

	return this;
}

Audio.prototype.shift = function shift () {

	return this;
}
Audio.prototype.pad = function pad () {

	return this;
}
Audio.prototype.concat = function concat () {

	return this;
}
Audio.prototype.slice = function slice () {

	return this;
}
Audio.prototype.invert = function invert () {

	return this;
}
Audio.prototype.copy = function copy () {

	return this;
}
Audio.prototype.isEqual = function isEqual () {

	return this;
}
