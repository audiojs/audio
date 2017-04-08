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
Audio.prototype.data = function (start = 0, duration = this.buffer.duration) {
	let [startOffset, endOffset] = offsets(start, duration, this.buffer)
	let data = []

	//transfer data per-channel
	for (var channel = 0; channel < this.buffer.numberOfChannels; channel++) {
		data[channel] = this.buffer.getChannelData(channel).subarray(startOffset, endOffset);
	}

	return data
}

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




//normalize contents by the offset
Audio.prototype.normalize = function normalize (time = 0, duration = this.buffer.duration) {

	let [startOffset, endOffset] = offsets(time, duration, this.buffer)

	util.normalize(this.buffer, startOffset, endOffset)

	return this;
}


//fade in/out by db range
Audio.prototype.fade = function (start, duration, map) {
	//0, 1, easing
	//0, -1, easing
	//-0, -1, easing
	if (arguments.length === 3) {

	}

	//1, easing
	//-1, easing
	//0, 1
	//0, -1
	//-0, -1
	else if (arguments.length === 2) {
		let last = arguments[arguments.length - 1]
		if (typeof last === 'number') {
			duration = last
		}
		else {
			map = last
			duration = start
			start = 0
		}
	}

	//1
	//-1
	else if (arguments.length === 1) {
		duration = start
		start = 0
	}

	map = typeof map === 'function' ? map : t => t

	let step = duration > 0 ? 1 : -1
	let halfStep = step*.5

	let [startOffset, endOffset] = offsets(start, duration, this.buffer)
	let len = endOffset - startOffset
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
Audio.prototype.trim = function trim (threshold = 0) {
	this.buffer = util.trim(this.buffer, threshold)

	//TODO: trimLeft, trimRight

	return this;
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


//get start/end offsets for the buffer
function offsets (start, duration, buffer) {
	let startOffset = Math.floor(start * buffer.sampleRate)
	startOffset = nidx(startOffset, buffer.length)
	let len = duration * buffer.sampleRate
	let endOffset = Math.min(startOffset + len, buffer.length)

	return [startOffset, endOffset]
}
