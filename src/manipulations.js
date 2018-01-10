/**
 * Extend audio with manipulations functionality
 *
 * @module  audio/src/manipulations
 */

'use strict'


const clamp = require('clamp')
const convert = require('pcm-convert')
const bufferFrom = require('audio-buffer-from')
const isPlainObj = require('is-plain-obj')
const aFormat = require('audio-format')
const AudioBufferList = require('audio-buffer-list')

let { parseArgs } = require('./util')
let Audio = require('../')


// return channels data distributed in array
Audio.prototype.read = function (t, d, options) {
	let {start, end, from, to, duration, format, channels, destination, channel, length} = parseArgs(this, t, d, options)

	//transfer data for indicated channels
	let data = []
	for (let c = 0; c < channels.length; c++) {
		let arr = new Float32Array(length)
		this.buffer.copyFromChannel(arr, channels[c], start, end)
		data.push(arr)
	}

	if (format === 'audiobuffer') {
		data = bufferFrom(data, {sampleRate: this.sampleRate})
		return data
	}
	if (format || destination) {
		//pre-convert data to float32 array
		let len = data[0].length
		let arr = new Float32Array(data.length * len)

		for (let c = 0; c < data.length; c++) {
			arr.set(data[c], c*len)
		}

		data = convert(arr, 'float32', format, destination)
	}
	else if (ArrayBuffer.isView(data[0])) {
		//make sure data items are arrays
		data = data.map(ch => Array.from(ch))

		if (typeof channel == 'number') {
			if (channel >= this.channels) throw Error('Bad channel number `' + channel + '`')
			data = data[0]
		}
	}

	return data
}


// put data by the offset
Audio.prototype.write = function write (value, time, duration, options) {
	let {start, end, length, channels, format} = parseArgs(this, time, duration, options)

	// fill with value
	if (typeof value === 'number') {
		this.buffer.map((buf, idx, offset) => {
			for (let c = 0, l = buf.length; c < channels.length; c++) {
				let channel = channels[c]
				let data = buf.getChannelData(channel)

				for (let i = 0; i < l; i++) {
					data[i] = value
				}
			}
		}, start, end)
	}
	// fill with function
	else if (typeof value === 'function') {
		this.buffer.map((buf, idx, offset) => {
			for (let c = 0, l = buf.length; c < channels.length; c++) {
				let channel = channels[c]
				let data = buf.getChannelData(channel)

				for (let i = 0; i < l; i++) {
					data[i] = value.call(this, data[i], i + offset, c, this)
				}
			}
		}, start, end)
	}
	// write any other argument
	else {
		let buf = bufferFrom(value instanceof Audio ? value.buffer : value, { format })

		for (let c = 0, l = Math.min(channels.length, buf.numberOfChannels); c < l; c++ ) {
			let channel = channels[c]
			let data = buf.getChannelData(c).subarray(0, length)
			this.buffer.copyToChannel(data, channel, start)
		}
	}

	return this
}


// insert new data at the offset
Audio.prototype.insert = function (value, time, duration, options) {
	let toEnd = false
	if (time == null || isPlainObj(time)) {
		toEnd = true
	}

	let {start, end, length, channels, format} = parseArgs(this, time, duration, options)

	//make sure audio is padded till the indicated time
	if (time > this.duration) {
		this.pad(time, {right: true})
	}

	let buffer, isFn = typeof value === 'function'

	// fill with value/function
	if (typeof value === 'number' || isFn) {
		buffer = bufferFrom(length, {channels: this.channels})

		for (let c = 0, l = buffer.length; c < channels.length; c++) {
			let channel = channels[c]
			let data = buffer.getChannelData(channel)

			for (let i = 0; i < l; i++) {
				data[i] = isFn ? value.call(this, data[i], i + offset, c, this) : value
			}
		}
	}
	// write any other argument
	else {
		let src = bufferFrom(value instanceof Audio ? value.buffer : value, { format })
		buffer = bufferFrom(src.length, {channels: this.channels})

		for (let c = 0, l = Math.min(channels.length, src.numberOfChannels); c < l; c++ ) {
			let channel = channels[c]
			let data = src.getChannelData(c)
			if (length) data.subarray(0, length)

			buffer.getChannelData(channel).set(data)
		}
	}

	// TODO: refactor to use updated audio-buffer-list notation
	this.buffer.insert(toEnd ? end : start, buffer)

	return this
}


// remove data at the offset
Audio.prototype.remove = function remove (time, duration, options) {
	let o = parseArgs(this, time, duration, options)

	let fragment = this.buffer.remove(o.start, o.length)

	if (!o.keep) return this

	return Audio(fragment)
}


// return sliced [copy] of audio
Audio.prototype.slice = function slice (time, duration, options) {
	let {start, end, channels, copy} = parseArgs(this, time, duration, options)

	if (copy) {
		let src = this.buffer.slice(start, end)
		let copy = new AudioBufferList(0, channels.length)

		for (let i = 0; i < src.buffers.length; i++) {
			let buffer = src.buffers[i]
			let buf = bufferFrom(buffer.length, {
				channels: channels.length,
				sampleRate: buffer.sampleRate
			});

			// FIXME: channels are unnecessary extension here
			for (let c = 0; c < channels.length; c++) {
				let channel = channels[c]
				let data = buf.getChannelData(c)
				data.set(buffer.getChannelData(channel))
			}

			// FIXME: use insert
			copy.append(buf)
		}

		return new Audio(copy)
	}

	this.buffer = this.buffer.slice(start, end)

	return this
}


// apply processing function
Audio.prototype.through = function (fn, time, duration, options) {
	if(typeof fn !== 'function') throw Error('First argument should be a function')

	options = parseArgs(this, time, duration, options)

	//make sure we split at proper positions
	this.buffer.split(options.start)
	this.buffer.split(options.end)

	//apply processor
	this.buffer.map((buf, idx, offset) => {
		return fn(buf) || buf
	}, options.start, options.end)

	return this
}


// normalize contents by the offset
Audio.prototype.normalize = function normalize (time, duration, options) {
	options = parseArgs(this, time, duration, options)

	//find max amplitude for the channels set
	let range = this.limits(options)
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

	return this
}


// fade in/out by db range
Audio.prototype.fade = function (time, duration, options) {
	//first arg goes duration by default
	if (typeof duration != 'number' || duration == null) {
		duration = time;
		time = 0;
	}

	options = parseArgs(this, time, duration, options)

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


// trim start/end silence
Audio.prototype.trim = function trim (options) {
	let {threshold, left, right} = parseArgs(this, options)

	if (threshold == null) threshold = -40

	if (left && right == null) right = false
	else if (right && left == null) left = false
	if (left == null) left = true
	if (right == null) right = true

	let tlr = Audio.gain(threshold), first = 0, last = this.length;

	//trim left
	if (left) {
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
	if (right) {
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


// return audio padded to the duration
Audio.prototype.pad = function pad (duration, options) {
	if (typeof options === 'number') {
		options = {value: options}
	}

	if (typeof duration !== 'number') throw Error('First argument should be a number')

	let length = this.offset(duration)

	let {value, left} = parseArgs(this, options)


	if (value == null) value = 0

	//ignore already lengthy audio
	if (length <= this.length) return this

	let buf = bufferFrom(length - this.length, {channels: this.channels, rate: this.sampleRate})

	if (value) {
		let v = value
		let channels = this.channels
		for (let c = 0; c < channels; c++) {
			let data = buf.getChannelData(c)
			for (let i = 0, l = buf.length; i < l; i++) {
				data[i] = v
			}
		}
	}

	//pad left
	if (left) {
		this.buffer.insert(0, buf)
	}
	//pad right
	else {
		this.buffer.append(buf)
	}

	return this
}


// move samples within audio by amount
Audio.prototype.shift = function shift (amount, options) {
	let {rotate, channels} = parseArgs(this, options)

	if (typeof amount !== 'number') throw Error('First argument should be a number')
	let length = this.offset(Math.abs(amount))
	let offset = amount < 0 ? -length : length;

	// short way
	if (channels.length === this.channels) {
		let remains = Math.max(this.length - length, 0)
		let remBuffer, fillBuffer

		if (!rotate) {
			fillBuffer = bufferFrom(this.length - remains, {
				channels: this.channels,
				sampleRate: this.sampleRate
			})
		}

		if (offset > 0) {
			remBuffer = this.buffer.slice(0, remains)
			if (rotate) fillBuffer = this.buffer.slice(-this.length + remains)
			this.buffer = new AudioBufferList([fillBuffer, remBuffer], this.channels)
		}
		else {
			remBuffer = this.buffer.slice(-remains)
			if (rotate) fillBuffer = this.buffer.slice(0, this.length - remains)
			this.buffer = new AudioBufferList([remBuffer, fillBuffer], this.channels)
		}
	}
	else {
		// TODO: impl channel shift
		throw Error('Unimplemented: channel shift')
	}

	return this
}



// regain audio
Audio.prototype.gain = function (gain=0, time, duration, options) {
	if (!gain) return this

	options = parseArgs(this, time, duration, options)

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


// reverse sequence of samples
Audio.prototype.reverse = function (start, duration, options) {
	options = parseArgs(this, start, duration, options)

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


// invert sequence of samples
Audio.prototype.invert = function (time, duration, options) {
	options = parseArgs(this, time, duration, options)

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

// regulate rate of playback/output/read etc
Audio.prototype.rate = function rate () {
	return this
}


Audio.prototype.mix = function mix () {

	return this
}

