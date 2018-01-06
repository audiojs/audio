/**
 * @module  audio
 *
 * High-level audio container
 */

'use strict'

const isPlainObj = require('is-plain-obj')
const AudioBufferList = require('../audio-buffer-list')
const createBuffer = require('audio-buffer-from')
const isAudioBuffer = require('is-audio-buffer')
const db = require('decibels')

let {isMultisource} = require('./src/util')


module.exports = Audio


// conversions
Audio.gain = db.toGain
Audio.db = db.fromGain

Audio.prototype.time = function offsetToTime (offset) {
	return offset / this.sampleRate
}

Audio.prototype.offset = function timeToOffset (time) {
	return Math.ceil(time * this.sampleRate)
}


// @constructor
function Audio(source, options) {
	if (!(this instanceof Audio)) return new Audio(source, options)

	// handle channels-only options
	if (typeof options === 'number') options = {channels: options}

	if (isPlainObj(source)) {
		options = source
		source = null
	}

	if (!options) options = {}

	// enable metrics
	if (options.stats) this.stats = true

	if (options.data) source = options.data

	let context = options.context

	// empty case
	if (source === undefined || typeof source === 'number') {
		options.duration = source || 0

		if (options.duration < 0) throw Error('Duration should not be negative')

		source = null

		this.buffer = new AudioBufferList(createBuffer(options))
	}

	// audiobufferlist case
 	if (source instanceof AudioBufferList) {
		this.buffer = source
	}

	// audiobuffer case
	else if (isAudioBuffer(source)) {
		this.buffer = new AudioBufferList(source)
	}

	// other Audio instance
	else if (source instanceof Audio) {
		this.buffer = source.buffer.clone()
	}

	// array with malformed data
	else if (isMultisource(source)) {
		throw Error('Bad argument. Use `Audio.from` to create joined audio.')
	}

	// fall back to buffer
	else {
		try {
			let buf = createBuffer(source, options)
			this.buffer = new AudioBufferList(buf)
		}
		catch (e) {
			throw e
		}
	}

	// slice by length
	if (options.length != null) {
		if (this.buffer.length > options.length) {
			this.buffer = this.buffer.slice(0, options.length)
		}
		else if (this.buffer.length < options.length) {
			this.buffer.append(options.length - this.buffer.length)
		}
	}

	// TODO: remix channels if provided in options
}


require('./src/core')
require('./src/playback')
require('./src/metrics')
require('./src/manipulations')
require('./src/alias')
