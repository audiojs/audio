/**
 * @module  audio
 *
 * High-level audio container
 */

'use strict'

const assert = require('assert')
const isPlainObj = require('is-plain-obj')
const AudioBufferList = require('audio-buffer-list')
const createBuffer = require('audio-buffer-from')
const isAudioBuffer = require('is-audio-buffer')


module.exports = function Audio(source, options) {
	if (!(this instanceof Audio)) return new Audio(source, options)

	//handle channels-only options
	if (typeof options === 'number') options = {channels: options}

	if (isPlainObj(source)) {
		options = source
		source = null
	}

	if (!options) options = {}

	//enable metrics
	if (options.stats) this.stats = true

	if (options.data) source = options.data

	let context = options.context

	//empty case
	if (source === undefined || typeof source === 'number') {
		options.duration = source || 0
		assert(options.duration >= 0, 'Duration should not be negative')
		source = null
		this.buffer = new AudioBufferList(createBuffer(options))
	}

	//audiobufferlist case
 	if (AudioBufferList.isInstance(source)) {
		this.buffer = source
	}

	//audiobuffer case
	else if (isAudioBuffer(source) ) {
		this.buffer = new AudioBufferList(source)
	}

	//other Audio instance
	else if (Audio.isAudio(source)) {
		this.buffer = source.buffer.clone()
	}

	//multiple source
	else if (Array.isArray(source) &&
			!(typeof source[0] === 'number' && (source.length === 1 || typeof source[1] === 'number')) &&
			!(source.length < 32 && source.every(ch => Array.isArray(ch) || ArrayBuffer.isView(ch)))
		) {
		//make sure every array item audio instance is created and loaded
		let items = [], channels = 1
		for (let i = 0; i < source.length; i++) {
			let subsource = Audio.isAudio(source[i]) ? source[i].buffer : Audio(source[i], options).buffer
			items.push(subsource)
			channels = Math.max(subsource.numberOfChannels, channels)
		}

		this.buffer = new AudioBufferList(items, {numberOfChannels: channels, sampleRate: items[0].sampleRate})
	}

	else {
		try {
			let buf = createBuffer(source, options)
			this.buffer = new AudioBufferList(buf)
		}
		catch (e) {
			throw Error('Bad arguments')
		}
	}

	//slice by length
	if (options.length != null) {
		if (this.buffer.length > options.length) {
			this.buffer = this.buffer.slice(0, options.length)
		}
		else if (this.buffer.length < options.length) {
			this.buffer.append(options.length - this.buffer.length)
		}
	}

	//TODO: remix channels if provided in options
}

require('./src/core')
require('./src/playback')
require('./src/metrics')
require('./src/manipulations')
