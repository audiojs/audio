/**
 * Extend audio with manipulations functionality
 *
 * @module  audio/src/manipulations
 */

'use strict'


const clamp = require('clamp')
const assert = require('assert')
const convert = require('pcm-convert')
const bufferFrom = require('audio-buffer-from')
const isPlainObj = require('is-plain-obj')
const aFormat = require('audio-format')

let Audio = require('../')


//return channels data distributed in array
Audio.prototype.read = function (dst, time, duration, options) {
	if (typeof dst === 'number') {
		options = duration
		duration = time
		time = dst
		dst = null
	}
	else if (isPlainObj(dst)) {
		options = dst
		time = null
		duration = null
		dst = null
	}
	options = this._parseArgs(time, duration, options)

	//transfer data for indicated channels
	let data = []
	for (let c = 0; c < options.channels.length; c++) {
		data.push(this.getChannelData(c, options.from, options.duration, options))
	}

	if (options.dtype === 'audiobuffer') {
		data = bufferFrom(data, {sampleRate: this.sampleRate})
		return data
	}
	else {
		if (options.dtype || dst) {
			//pre-convert data to float32 array
			let len = data[0].length
			let arr = new Float32Array(data.length * len)
			for (let c = 0; c < data.length; c++) {
				arr.set(data[c], c*len)
			}

			data = convert(arr, 'float32', options.dtype, dst)
		}
		else if (ArrayBuffer.isView(data[0])) {
			//make sure data items are arrays
			data = data.map(ch => Array.from(ch))

			if (typeof options.channel == 'number') {
				data = data[0]
			}
		}
	}

	return data
}


//put data by the offset
Audio.prototype.write = function write (data, time, duration, options) {
	options = this._parseArgs(time, duration, options)

	//TODO: make shortcut for buffer-list/audio to avoid coercing to audiobuffer

	//fill with value
	if (typeof data === 'number') {
		let val = data
		this.buffer.map((buf, idx, offset) => {
			for (let c = 0, l = buf.length; c < options.channels.length; c++) {
				let channel = options.channels[c]
				let data = buf.getChannelData(channel)

				for (let i = 0; i < l; i++) {
					data[i] = val
				}
			}
		}, options.start, options.end)

		return this
	}

	let buf = data.getChannelData ? data : bufferFrom(data, {format: options.format})

	let bufChannels = buf.numberOfChannels || buf.channels

	for (let c = 0, l = Math.min(options.channels.length, bufChannels); c < l; c++ ) {
		let channel = options.channels[c]
		let data = buf.getChannelData(c).subarray(0, options.length)
		this.buffer.copyToChannel(data, channel, options.start)
	}

	return this
}


//fetch channel data
Audio.prototype.getChannelData = function (channel, time, duration, options) {
	assert(channel <= this.channels, 'Audio has only ' + this.channels + ' channels')

	options = this._parseArgs(time, duration, options)

	//transfer data for indicated channels
	let arr = new Float32Array(options.length)
	this.buffer.copyFromChannel(arr, channel, options.start, options.end)

	return arr
}


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


//normalize contents by the offset
Audio.prototype.normalize = function normalize (time, duration, options) {
	options = this._parseArgs(time, duration, options)

	//find max amplitude for the channels set
	let range = this.range(options)
	let max = Math.max(Math.abs(range[0]), Math.abs(range[1]))

	let amp = Math.max(1 / max, 1)

	//amp values
	this.buffer.map((buf, idx, offset) => {
		for (let c = 0, l = buf.length; c < options.channels.length; c++) {
			let channel = options.channels[c]
			let data = buf.getChannelData(channel)

			for (let i = 0; i < l; i++) {
				data[i] = clamp(data[i] * amp, -1, 1)
			}
		}
	}, options.start, options.end)

	return this;
}


//fade in/out by db range
Audio.prototype.fade = function (time, duration, options) {
	//first arg goes duration by default
	if (typeof duration != 'number' || duration == null) {
		duration = time;
		time = 0;
	}

	options = this._parseArgs(time, duration, options)

	let easing = typeof options.easing === 'function' ? options.easing : t => t

	let step = options.duration > 0 ? 1 : -1
	let halfStep = step*.5

	let len = options.length

	let gain
	if (options.level != null) {
		gain = Audio.db(options.level)
	}
	else {
		gain = options.gain == null ? -40 : options.gain
	}

	this.buffer.map((buf, idx, offset) => {
		for (let c = 0, l = buf.length; c < options.channels.length; c++) {
			let channel = options.channels[c]
			let data = buf.getChannelData(channel)

			for (let i = Math.max(options.start - offset, 0); i != options.end; i+= step) {
				let idx = Math.floor(i + halfStep)
				let t = (i + halfStep - options.start) / len

				//volume is mapped by easing and 0..-40db
				data[idx] *= Audio.gain(-easing(t) * gain + gain)
			}
		}
	}, options.start, options.end)

	return this
}


//trim start/end silence
Audio.prototype.trim = function trim (options) {
	if (!options) options = {}

	if (options.threshold == null) options.threshold = -40
	if (options.level == null) options.level = Audio.gain(options.threshold)

	if (options.left && options.right == null) options.right = false
	else if (options.right && options.left == null) options.left = false
	if (options.left == null) options.left = true
	if (options.right == null) options.right = true

	let tlr = options.level, first = 0, last = this.length;

	//trim left
	if (options.left) {
		this.buffer.map((buf, idx, offset) => {
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
		this.buffer.map((buf, idx, offset) => {
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

	let level = Audio.gain(gain)

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

	this.buffer.join(options.start, options.end)

	this.buffer.map((buf, idx, offset) => {
		// console.log(idx)
		for (let c = 0, cnum = options.channels.length; c < cnum; c++) {
			let channel = options.channels[c]
			let data = buf.getChannelData(channel)

			Array.prototype.reverse.call(data)
		}
	}, options.start, options.end)

	return this
}


//invert sequence of samples
Audio.prototype.invert = function (time, duration, options) {
	options = this._parseArgs(time, duration, options)

	this.buffer.map((buf, idx, offset) => {
		for (let c = 0, l = buf.length; c < options.channels.length; c++) {
			let channel = options.channels[c]
			let data = buf.getChannelData(channel)

			for (let i = 0; i < l; i++) {
				data[i] = -data[i]
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
	assert(typeof duration === 'number', 'First arg should be a number')

	let length = duration * this.sampleRate

	if (options == null) options = {}
	else if (typeof options === 'string') {
		let dir = options
		options = {}
		if (dir === 'left') options.left = true
		else if (dir === 'right') options.right = true
	}
	else if (typeof options === 'number') {
		options = {value: options}
	}

	if (options.value == null) options.value = 0

	if (options.left == null && options.right == null) options.right = true

	//ignore already lengthy audio
	if (length <= this.length) return this;

	let buf = bufferFrom(length - this.length, this.channels)

	if (options.value) {
		let v = options.value
		let channels = this.channels
		for (let c = 0; c < channels; c++) {
			let data = buf.getChannelData(c)
			for (let i = 0, l = buf.length; i < l; i++) {
				data[i] = v
			}
		}
	}

	//pad right
	if (options.right) {
		this.buffer.append(buf)
	}

	//pad left
	else if (options.left) {
		this.buffer.insert(0, buf)
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

