/**
 * Extend audio with manipulations functionality
 *
 * @module  audio/src/manipulations
 */

'use strict'


const nidx = require('negative-index')
const clamp = require('clamp')
const assert = require('assert')

let Audio = require('../')

//apply processing function
Audio.prototype.through = function (fn, time, duration, options) {
	assert(typeof fn === 'function', 'First argument should be a function')

	options = this._parseArgs(time, duration, options)

	//make sure we split at proper positions
	this.buffer.split(options.start)
	this.buffer.split(options.end)

	//apply processor
	this.buffer.map((buf, idx, offset) => {
		return fn(buf) || buf
	}, options.start, options.end)

	return this
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

//insert new data at the offset
Audio.prototype.insert = function (time, source, options) {
	//5, source, options
	//5, source
	if (typeof time == 'number') {}
	else {
		//source, options
		if ( isPlainObj(source) ) {
			options = source
			source = time
			time = null
		}
		//source, 5, options
		//source, 5
		//source
		else {
			[source, time] = [time, source]
		}
	}

	//by default insert to the end
	if (time == null) time = -0

	//do insert
	options = this._parseArgs(time, 0, options)

	//make sure audio is padded till the indicated time
	if (time > this.duration) {
		this.pad(time, {right: true})
	}

	//TODO: insert channels data
	let buffer = Audio.isAudio(source) ? source.buffer : isAudioBuffer(source) ? source : new AudioBufferList(source, {channels: options.channels})

	if (options.start === this.buffer.length) {
		this.buffer.append(buffer)
	}
	else {
		this.buffer.insert(options.start, buffer)
	}

	return this
}

//remove data at the offset
Audio.prototype.remove = function remove (time, duration, options) {
	options = this._parseArgs(time, 0, options)

	this.buffer.remove(options.start, options.end)

	return this
}

//put data by the offset
Audio.prototype.set = function set (time, data, options) {
	//5, data, options
	//5, data
	if (typeof time == 'number') {}
	else {
		//data, options
		if ( isPlainObj(data) ) {
			options = data
			data = time
		}
		//data, 5, options
		//data, 5
		//data
		else {
			[data, time] = [time, data]
		}
	}

	options = this._parseArgs(time, 0, options)

	if (typeof options.channels == 'number') {
		options.channels = [options.channels]
	}

	for (let c = 0; c < options.channels.length; c++ ) {
		let channel = options.channel[c]

		//TODO: figure out how to get proper data
		this.buffer.copyToChannel(data, channel, options.start)
	}

	return this
}

//return channels data distributed in array
Audio.prototype.get = function (time, duration, options) {
	options = this._parseArgs(time, duration, options)

	//transfer data for indicated channels
	let data = []
	for (let c = 0; c < options.channels.length; c++) {
		let arr = new Float32Array(options.length)
		let channel = options.channels[c]
		this.buffer.copyFromChannel(arr, c, options.start, options.end)
		data.push(arr)
	}

	if (typeof options.channel == 'number') {
		return data[0]
	}
	return data
}


//normalize contents by the offset
Audio.prototype.normalize = function normalize (start, duration, options) {
	options = this._parseArgs(start, duration, options)

	//find max amp for the channels set
	let max = 0
	if (typeof options.channels == 'number') {
		options.channel = [options.channel]
	}
	for (let c = 0; c < options.channel.length; c++) {
		let channel = options.channels[c]
		let data = this.buffer.getChannelData(channel, options.start, options.end)
		for (let i = 0; i < data.length; i++) {
			max = Math.max(Math.abs(data[i]), max)
		}
	}

	let amp = Math.max(1 / max, 1)

	//fill values
	this.buffer.each((buf, idx, offset) => {
		for (let c = 0, l = Math.min(options.end - offset, buf.length); c < options.channels.length; c++) {
			let channel = options.channels[c]
			let data = buf.getChannelData(channel)

			for (let i = Math.max(options.start - offset, 0); i < l; i++) {
				data[i] = clamp(data[i] * amp, -1, 1)
			}
		}
	}, options.start, options.end)

	return this;
}


//fade in/out by db range
Audio.prototype.fade = function (start, duration, options) {
	if (typeof duration != 'number' || duration == null) {
		duration = start;
		start = 0;
	}

	options = this._parseArgs(start, duration, options)

	let easing = typeof options.easing === 'function' ? options.easing : t => t

	let step = duration > 0 ? 1 : -1
	let halfStep = step*.5

	let len = options.end - options.start

	let gain
	if (options.level != null) {
		gain = this.toDb(options.level)
	}
	else {
		gain = options.gain == null ? -40 : options.gain
	}

	if (typeof options.channels == 'number') {
		options.channels = [options.channels]
	}

	this.buffer.each((buf, idx, offset) => {
		for (let c = 0, l = Math.min(options.end - offset, buf.length); c < options.channels.length; c++) {
			let channel = options.channels[c]
			let data = buf.getChannelData(channel)

			for (let i = Math.max(options.start - offset, 0); i != options.end; i+= step) {
				let idx = Math.floor(i + halfStep)
				let t = (i + halfStep - options.start) / len

				//volume is mapped by easing and 0..-40db
				data[idx] *= this.fromDb(-easing(t) * gain + gain)
			}
		}
	}, options.start, options.end)

	return this
}


//trim start/end silence
Audio.prototype.trim = function trim (options) {
	if (!options) options = {}

	if (options.threshold == null) options.threshold = -40
	if (options.level == null) options.level = this.fromDb(options.threshold)

	if (options.left && options.right == null) options.right = false
	else if (options.right && options.left == null) options.left = false
	if (options.left == null) options.left = true
	if (options.right == null) options.right = true

	let tlr = options.level, first = 0, last = this.length;

	//trim left
	if (options.left) {
		// this.buffer = util.trimLeft(this.buffer, options.level)
		this.buffer.each((buf, idx, offset) => {
			for (let c = 0; c < buf.numberOfChannels; c++) {
				let data = buf.getChannelData(c)
				for (let i = 0; i < buf.length; i++) {
					if (Math.abs(data[i]) > tlr) {
						first = offset + i
						return false
					}
				}
			}
		})
	}

	//trim right
	if (options.right) {
		this.buffer.each((buf, idx, offset) => {
			for (let c = 0; c < buf.numberOfChannels; c++) {
				let data = buf.getChannelData(c)
				for (let i = buf.length; i--;) {
					if (Math.abs(data[i]) > tlr) {
						last = offset + i + 1
						return false
					}
				}
			}
		}, {reversed: true})
	}

	this.buffer = this.buffer.slice(first, last)

	return this
}


//regain audio
Audio.prototype.gain = function (gain = 0, time, duration, options) {
	if (!gain) return this

	options = this._parseArgs(time, duration, options)

	let level = Audio.fromDb(gain)

	this.buffer.map((buf, idx, offset) => {
		for (let c = 0, cnum = options.channels.length; c < cnum; c++) {
			let channel = options.channels[c]
			let data = buf.getChannelData(channel)

			for (let i = 0, l = buf.length; i < l; i++) {
				data[i] *= level
			}
		}
	}, options.start, options.end)

	return this
}


//reverse sequence of samples
Audio.prototype.reverse = function (start, duration, options) {

	options = this._parseArgs(start, duration, options)

	if (typeof options.channels == 'number') {
		options.channels = [options.channels]
	}

	this.buffer.reverse(options.start, options.end)

	return this
}


//invert sequence of samples
Audio.prototype.invert = function (start, duration, options) {

	options = this._parseArgs(start, duration, options)

	if (typeof options.channels == 'number') {
		options.channels = [options.channels]
	}

	this.buffer.each((buf, idx, offset) => {
		for (let c = 0, l = Math.min(options.end - offset, buf.length); c < options.channels.length; c++) {
			let channel = options.channels[c]
			let data = buf.getChannelData(channel)

			for (let i = Math.max(options.start - offset, 0); i < l; i++) {
				data[i] *= -1
			}
		}
	}, options.start, options.end)

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

//return audio padded to the duration
Audio.prototype.pad = function pad (duration, options) {
	if (!options) options = {}

	if (options.value == null) options.value = 0

	if (options.left && options.right == null) options.right = false
	else if (options.right && options.left == null) options.left = false
	if (options.left == null) options.left = true
	if (options.right == null) options.right = true


	//ignore already lengthy audio
	if (options.end - options.start <= this.length) return this;

	let buf = new AudioBuffer(this.channels, options.end - options.start - this.length)

	if (options.value) {
		let v = options.value
		for (let c = 0; c < this.channels; c++) {
			let data = buf.getChannelData(c)
			for (let i = 0; i < buf.length; i++) {
				data[i] = v
			}
		}
	}

	//pad left
	if (options.left) {
		this.buffer.insert(0, buf)
	}

	//trim right
	else if (options.right) {
		this.buffer.append(buf)
	}

	return this
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

