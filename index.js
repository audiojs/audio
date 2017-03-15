/**
 * @module  audio
 *
 * High-level audio container
 */
'use strict';

const AudioBuffer = require('audio-buffer')
const Emitter = require('events')
const inherits = require('inherits')
const load = require('audio-loader')
const extend = require('object-assign')
const isBrowser = require('is-browser')
const util = require('audio-buffer-utils')
const decode = require('audio-decode')
const tick = require('next-tick')
const nidx = require('negative-index')
const isPromise = require('is-promise')
const isBuffer = require('is-buffer')
const b2ab = require('buffer-to-arraybuffer')

module.exports = Audio;


//for events sake
inherits(Audio, Emitter)


//augment functionality
require('./src/playback')
require('./src/metrics')
require('./src/manipulations')


//@contructor
function Audio(source, options, onload) {
	if (!(this instanceof Audio)) return new Audio(source, options)

	if (options instanceof Function) {
		onload = options
		options = {}
	}

	options = options || {}
	extend(this, options)

	//if user looks for loading
	if (onload) this.once('load', onload)

	//launch init
	this.isReady = false;

	this.load(source, () => {
		this.isReady = true;
	})
}

//cache of loaded audio buffers for urls
Audio.cache = {};

//cache URL
Audio.prototype.cache = true;

//default params
Audio.prototype.channels = 2;
Audio.prototype.sampleRate = 44100;
Audio.prototype.duration = 0;

//load file by url
Audio.prototype.load = function (src, onload) {
	if (!src) return this;

	//async string case
	if (typeof src === 'string') {
		//load cached version, if any
		if (this.cache && Audio.cache[src]) {
			//if loading already - just clone when loaded
			if (isPromise(Audio.cache[src])) {
				Audio.cache[src].then((audioBuffer) => {
					this.load(src)
				})
			}
			else {
				this.buffer = util.clone(Audio.cache[src])
				onload && onload(null, this)
				this.emit('load', this)
			}
			return this;
		}

		//if no cache - create empty stub till loading
		else {
			//create empty buffer if async source
			this.buffer = util.create(1, this.channels, this.sampleRate)
		}

		let promise = load(src).then(audioBuffer => {
			this.buffer = audioBuffer;

			//save cache
			if (this.cache) {
				Audio.cache[src] = audioBuffer
			}

			onload && onload(null, this)
			this.emit('load', this)
		}, err => {
			onload && onload(err)
			this.emit('error', err)
		})

		//save promise to cache
		if (this.cache) {
			Audio.cache[src] = promise;
		}
	}

	//direct access cases
	else if (Array.isArray(src) || typeof src === 'number') {
		this.buffer = util.create(src, this.channels, this.sampleRate)

		onload && onload(null, this)
		this.emit('load', this)
	}

	//TODO: stream case
	//TODO: buffer case

	//redirect other cases to audio-loader
	else {
		//enforce arraybuffer
		if (isBuffer(src)) {
			src = b2ab(src)
		}

		load(src).then(audioBuffer => {
			this.buffer = audioBuffer
			onload && onload(null, this)
			this.emit('load', this)
		}, err => {
			onload && onload(err)
			this.emit('error', err)
		})
	}


	return this;
}

//return slice of data as an audio buffer
Audio.prototype.read = function (start = 0, duration = this.buffer.duration) {
	return this.readRaw(start * this.buffer.sampleRate, duration * this.buffer.sampleRate)
}

//return audio buffer by sample number
Audio.prototype.readRaw = function (offset = 0, length = this.buffer.length) {
	offset = Math.floor(nidx(offset, this.buffer.length))
	length = Math.floor(Math.min(length, this.buffer.length - offset))
	let buf = util.slice(this.buffer, offset, offset + length)

	return buf;
}

/*
//put audio buffer data by offset
Audio.prototype.write = function (buffer, offsetTime) {
	if (!buffer || !buffer.length) return this;

	let offset = nidx(offsetTime || 0, this.buffer.duration) * this.buffer.sampleRate;

	let beginning = util.slice(0, offset)
	let end = util.slice(offset)

	this.buffer = util.concat(beginning, buffer, end)

	return this;
}
*/
