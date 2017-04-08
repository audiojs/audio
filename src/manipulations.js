/**
 * Extend audio with manipulations functionality
 *
 * @module  audio/src/manipulations
 */

'use strict'


const util = require('audio-buffer-utils')
const nidx = require('negative-index')
const db = require('decibels')

let Audio = require('../')



//return channels data distributed in array
Audio.prototype.data = function (start, duration, options) {
	options = this.parseArgs(start, duration, options)

	if (typeof options.channel == 'number') {
		return this.buffer.getChannelData(options.channel).subarray(options.from, options.to)
	}
	//transfer data for indicated channels
	else {
		let data = []
		for (let i = 0; i < options.channel.length; i++) {
			let channel = options.channel[i]

			data.push(this.buffer.getChannelData(channel).subarray(options.from, options.to))
		}
		return data
	}
}


/*
//return slice of data as an audio buffer
Audio.prototype.read = function (start = 0, duration = this.buffer.duration) {
	return this.readRaw(start * this.buffer.sampleRate, duration * this.buffer.sampleRate)
}

//TODO: provide nicer name for getting raw data as array, not audio buffer
//return audio buffer by sample number
Audio.prototype.readRaw = function (offset = 0, length = this.buffer.length) {
	offset = Math.floor(nidx(offset, this.buffer.length))
	length = Math.floor(Math.min(length, this.buffer.length - offset))

	let buf = util.slice(this.buffer, offset, offset + length)

	return buf
}

//write audiobuffer at the indicated position
Audio.prototype.write = function (buf, start=0) {
	return this.writeRaw(buf, start * this.buffer.sampleRate)
}

//write audio buffer data by offset
Audio.prototype.writeRaw = function (buffer, offset=0) {
	if (!buffer || !buffer.length) return this

	offset = Math.floor(nidx(offset, this.buffer.length))

	util.copy(buffer, this.buffer, offset)

	return this
}
*/



//normalize contents by the offset
Audio.prototype.normalize = function normalize (start, duration, options) {
	options = this.parseArgs(start, duration, options)

	//todo: normalize compound channels
	util.normalize(this.buffer, options.from, options.to)

	return this;
}


//fade in/out by db range
Audio.prototype.fade = function (start, duration, options) {
	options = this.parseArgs(start, duration, options)

	options.map = typeof options.map === 'function' ? options.map : t => t

	let step = duration > 0 ? 1 : -1
	let halfStep = step*.5

	let len = options.from - options.to
	let range = this.range

	for (let c = 0, l = this.buffer.length; c < this.buffer.numberOfChannels; c++) {
		let data = this.buffer.getChannelData(c)
		for (let i = startOffset; i != endOffset; i+=step) {
			let idx = Math.floor(nidx(i + halfStep, l))
			let t = (i + halfStep - startOffset) / len

			//volume is mapped by easing and 0..-40db
			data[idx] *= db.toGain(map(t) * range - range)
		}
	}

	return this
}


//trim start/end silence
Audio.prototype.trim = function trim (options) {
	if (!options) options = {}

	if (options.threshold == null) options.threshold = -40
	if (options.level == null) options.level = db.toGain(options.threshold)

	if (options.left && options.right == null) options.right = false
	else if (options.right && options.left == null) options.left = false
	if (options.left == null) options.left = true
	if (options.right == null) options.right = true

	if (options.left && options.right) this.buffer = util.trim(this.buffer, options.level)
	else if (options.left) this.buffer = util.trimLeft(this.buffer, options.level)
	else if (options.right) this.buffer = util.trimRight(this.buffer, options.level)

	return this
}


//change gain of the audio
Audio.prototype.gain = function gain (volume = 1, start = 0, duration = this.buffer.duration) {
	let [startOffset, endOffset] = offsets(start, duration, this.buffer)
	let range = this.range

	for (let c = 0; c < this.buffer.numberOfChannels; c++) {
		let data = this.buffer.getChannelData(c)
		for (let i = startOffset; i != endOffset; i++) {
			data[i] *= db.toGain(volume * range - range)
		}
	}

	return this
}


//reverse sequence of samples
Audio.prototype.reverse = function (start = 0, duration = this.buffer.duration) {

	let [startOffset, endOffset] = offsets(start, duration, this.buffer)

	util.reverse(this.buffer, startOffset, endOffset)

	return this
}


//invert sequence of samples
Audio.prototype.invert = function (start = 0, duration = this.buffer.duration) {

	let [startOffset, endOffset] = offsets(start, duration, this.buffer)

	util.invert(this.buffer, startOffset, endOffset)

	return this
}


//regulate rate of playback/output/read etc
Audio.prototype.rate = function rate () {
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
Audio.prototype.copy = function copy () {

	return this;
}
Audio.prototype.isEqual = function isEqual () {

	return this;
}


//include start/end offsets and channel for options. Purely helper.
Audio.prototype.parseArgs = function (start, duration, options) {
	//no args at all
	if (!start) {
		options = {}
		start = 0
		duration = this.duration
	}
	//single arg
	else if (!duration) {
		//{}
		if (typeof start !== 'number') {
			options = start
			start = 0
			duration = this.duration
		}
		//number
		else {
			options = {}
			duration = this.duration
		}
	}
	//two args
	else if (!options) {
		//1, 1
		if (typeof duration === 'number') {
			options = {}
		}
		//1, {}
		else {
			options = duration
			duration = this.duration
		}
	}

	//ensure channels
	if (options.channel == null) {
		options.channel = []
		for (let i = 0; i < this.channels; i++) {
			options.channel.push(i)
		}
	}

	//detect raw interval
	if (options.from == null) {
		let startOffset = Math.floor(start * this.sampleRate)
		startOffset = nidx(startOffset, this.buffer.length)
		options.from = startOffset
	}
	if (options.to == null) {
		let len = duration * this.sampleRate
		let endOffset = Math.min(options.from + len, this.buffer.length)
		options.to = endOffset
	}

	return options
}
