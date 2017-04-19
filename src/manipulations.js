/**
 * Extend audio with manipulations functionality
 *
 * @module  audio/src/manipulations
 */

'use strict'


const util = require('audio-buffer-utils')
const nidx = require('negative-index')
const clamp = require('clamp')

let Audio = require('../')



//return channels data distributed in array
Audio.prototype.data = function (start, duration, options) {
	options = this.parseArgs(start, duration, options)

	if (typeof options.channel == 'number') {
		return this.bufferList.getChannelData(options.channel).subarray(options.from, options.to)
	}
	//transfer data for indicated channels
	else {
		let data = []
		let buf = this.bufferList.shallowSlice(options.from, options.to)
		for (let i = 0; i < options.channel.length; i++) {
			let channel = options.channel[i]

			data.push(buf.getChannelData(channel))
		}
		return data
	}
}


/*
//return slice of data as an audio buffer
Audio.prototype.read = function (start = 0, duration = this.bufferList.duration) {
	return this.readRaw(start * this.bufferList.sampleRate, duration * this.bufferList.sampleRate)
}

//TODO: provide nicer name for getting raw data as array, not audio buffer
//return audio buffer by sample number
Audio.prototype.readRaw = function (offset = 0, length = this.bufferList.length) {
	offset = Math.floor(nidx(offset, this.bufferList.length))
	length = Math.floor(Math.min(length, this.bufferList.length - offset))

	let buf = util.slice(this.bufferList, offset, offset + length)

	return buf
}

//write audiobuffer at the indicated position
Audio.prototype.write = function (buf, start=0) {
	return this.writeRaw(buf, start * this.bufferList.sampleRate)
}

//write audio buffer data by offset
Audio.prototype.writeRaw = function (buffer, offset=0) {
	if (!buffer || !buffer.length) return this

	offset = Math.floor(nidx(offset, this.bufferList.length))

	util.copy(buffer, this.bufferList, offset)

	return this
}
*/



//normalize contents by the offset
Audio.prototype.normalize = function normalize (start, duration, options) {
	options = this.parseArgs(start, duration, options)

	//find max amp for the channels set
	let max = 0
	if (typeof options.channel == 'number') {
		options.channel = [options.channel]
	}
	for (let c = 0; c < options.channel.length; c++) {
		let channel = options.channel[c]
		let data = this.bufferList.getChannelData(channel, options.from, options.to)
		for (let i = 0; i < data.length; i++) {
			max = Math.max(Math.abs(data[i]), max)
		}
	}

	let amp = Math.max(1 / max, 1)

	//fill values
	this.bufferList.each((buf, idx, offset) => {
		for (let c = 0, l = Math.min(options.to - offset, buf.length); c < options.channel.length; c++) {
			let channel = options.channel[c]
			let data = buf.getChannelData(channel)

			for (let i = Math.max(options.from - offset, 0); i < l; i++) {
				data[i] = clamp(data[i] * amp, -1, 1)
			}
		}
	}, options.from, options.to)

	return this;
}


//fade in/out by db range
Audio.prototype.fade = function (start, duration, options) {
	if (typeof duration != 'number' || duration == null) {
		duration = start;
		start = 0;
	}

	options = this.parseArgs(start, duration, options)

	let easing = typeof options.easing === 'function' ? options.easing : t => t

	let step = duration > 0 ? 1 : -1
	let halfStep = step*.5

	let len = options.to - options.from

	let gain
	if (options.level != null) {
		gain = this.toDb(options.level)
	}
	else {
		gain = options.gain == null ? -40 : options.gain
	}

	if (typeof options.channel == 'number') {
		options.channel = [options.channel]
	}

	//TODO: slice part of data to fade, process, insert back
	return this.bufferList.map(buf => {
		for (let c = 0, l = buf.length; c < options.channel.length; c++) {
			let channel = options.channel[c]
			let data = buf.getChannelData(channel)

			for (let i = options.from; i != options.to; i+= step) {
				let idx = Math.floor(i + halfStep)
				let t = (i + halfStep - options.from) / len

				//volume is mapped by easing and 0..-40db
				data[idx] *= this.fromDb(-easing(t) * gain + gain)
			}
		}
	}, options.from, options.to)



	return this
}


//trim start/end silence
//TODO: implement manual trim
Audio.prototype.trim = function trim (options) {
	if (!options) options = {}

	if (options.threshold == null) options.threshold = -40
	if (options.level == null) options.level = this.fromDb(options.threshold)

	if (options.left && options.right == null) options.right = false
	else if (options.right && options.left == null) options.left = false
	if (options.left == null) options.left = true
	if (options.right == null) options.right = true

	if (options.left && options.right) this.bufferList = util.trim(this.bufferList, options.level)
	else if (options.left) this.bufferList = util.trimLeft(this.bufferList, options.level)
	else if (options.right) this.bufferList = util.trimRight(this.bufferList, options.level)

	return this
}


//regain audio
Audio.prototype.gain = function (gain = 0, start, duration, options) {
	if (!gain) return this

	options = this.parseArgs(start, duration, options)

	let level = this.fromDb(gain)

	if (typeof options.channel == 'number') {
		options.channel = [options.channel]
	}

	for (let c = 0, l = this.bufferList.length; c < options.channel.length; c++) {
		let channel = options.channel[c]
		let data = this.bufferList.getChannelData(channel)

		for (let i = options.from; i != options.to; i++) {
			data[i] *= level
		}
	}

	return this
}


//reverse sequence of samples
Audio.prototype.reverse = function (start, duration, options) {

	options = this.parseArgs(start, duration, options)

	for (let c = 0, l = this.bufferList.length; c < options.channel.length; c++) {
		let channel = options.channel[c]
		let data = this.bufferList.getChannelData(channel)

		data.subarray(options.from, options.to).reverse()
	}

	return this
}


//invert sequence of samples
Audio.prototype.invert = function (start, duration, options) {

	options = this.parseArgs(start, duration, options)

	for (let c = 0, l = this.bufferList.length; c < options.channel.length; c++) {
		let channel = options.channel[c]
		let data = this.bufferList.getChannelData(channel)

		for (let i = options.from; i < options.to; i++) {
			data[i] *= -1
		}
	}

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
	if (start == null) {
		options = {}
		start = 0
		duration = this.duration
	}
	//single arg
	else if (duration == null) {
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
	else if (options == null) {
		//1, 1
		if (typeof duration === 'number') {
			options = {}
		}
		//1, {}
		else if (typeof duration != 'number') {
			options = duration
			duration = this.duration
		}
	}

	if (!start && duration < 0) start = -0;

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
		startOffset = nidx(startOffset, this.bufferList.length)
		options.from = startOffset
	}
	if (options.to == null) {
		let len = duration * this.sampleRate
		let endOffset;
		if (len < 0) {
			endOffset = nidx(options.from + len, this.bufferList.length)
		}
		else {
			endOffset = Math.min(options.from + len, this.bufferList.length)
		}
		options.to = endOffset
	}

	return options
}
