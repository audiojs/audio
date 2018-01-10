/**
 * Core Audio methods
 */

'use strict'


const loadAudio = require('audio-loader')
const decodeAudio = require('audio-decode')
const extend = require('object-assign')
const nidx = require('negative-index')
const isPromise = require('is-promise')
const saveAs = require('save-file')
const toWav = require('audiobuffer-to-wav')
const AudioBuffer = require('audio-buffer')
const AudioBufferList = require('audio-buffer-list')
const remix = require('audio-buffer-remix')
const isAudioBuffer = require('is-audio-buffer')
const isPlainObj = require('is-plain-obj')
const getContext = require('audio-context')
const convert = require('pcm-convert')
const aformat = require('audio-format')
const createBuffer = require('audio-buffer-from')

let {parseArgs, resolvePath, isMultisource} = require('./util')
let Audio = require('../')


// cache of loaded audio buffers for urls
Audio.cache = {}


// cache URLs
Audio.prototype.cache = true


// enable metrics
Audio.prototype.stats = false

// default params
Object.defineProperties(Audio.prototype, {
	channels: {
		set: function (channels) {
			this.buffer = remix(this.buffer, this.buffer.numberOfChannels, channels)
		},
		get: function () {
			return this.buffer.numberOfChannels
		}
	},
	sampleRate: {
		set: function () {
			// TODO
			throw Error('Unimplemented.')
		},
		get: function () {
			return this.buffer.sampleRate || 44100
		}
	},
	duration: {
		set: function (duration) {
			let length = Math.floor(duration * this.sampleRate)
			if (length < this.length) {
				this.buffer = this.buffer.slice(0, length)
			}
			else if (length > this.length) {
				this.buffer = this.pad(duration, {right: true})
			}
		},
		get: function () {
			return this.buffer.duration
		}
	},
	length: {
		set: function (length) {
			if (length < this.length) {
				this.buffer = this.buffer.slice(0, length)
			}
			else if (length > this.length) {
				// TODO
				// this.buffer = this.pad({start: , right: true})
			}
		},
		get: function () {
			return this.buffer.length
		}
	}
})


// create audio from multiple sources
Audio.from = function from (...sources) {
	let items = [], channels = 1

	let options = sources[sources.length - 1]

	if ((isPlainObj(options) && (!options.duration || !options.length)) || typeof options === 'string' ) {
		sources.pop()
	}
	else {
		options = null
	}

	for (let i = 0; i < sources.length; i++) {
		let source = sources[i], subsource

		//multiple source
		if (isMultisource(source)) {
			if (options) {
				subsource = Audio.from(...source, options).buffer
			} else {
				subsource = Audio.from(...source).buffer
			}
		}
		else {
			subsource = source instanceof Audio ? source.buffer : Audio(source, options).buffer
		}
		items.push(subsource)
		channels = Math.max(subsource.numberOfChannels, channels)
	}

	let buffer = new AudioBufferList(items, {numberOfChannels: channels, sampleRate: items[0].sampleRate})

	return new Audio(buffer)
}


// load audio from remote/local url
Audio.load = function load (source, callback) {
	let promise

	if (typeof source === 'string') {
		source = resolvePath(source, 2)

		// load cached version, if any
		if (Audio.cache[source]) {
			// if source is cached but loading - just clone when loaded
			if (isPromise(Audio.cache[source])) {
				promise = Audio.cache[source].then(audio => {
					// in order to avoid fetching modified source, we clone cached source
					audio = Audio(Audio.cache[source])

					callback && callback(null, audio)
					return Promise.resolve(audio)
				}, error => {
					callback && callback(error)
					return Promise.reject(error)
				})
			}
			// else clone right ahead
			else {
				promise = Promise.resolve(Audio(Audio.cache[source])).then(audio => {
					callback && callback(null, audio)
					return Promise.resolve(audio)
				}, error => {
					callback && callback(error)
					return Promise.reject(error)
				})
			}
		}

		// load source by path
		else {
			promise = loadAudio(source).then(audioBuffer => {
				let audio = Audio(audioBuffer)

				// since user may modify original audio later, we have to put clone into cache
				Audio.cache[source] = Audio(audio)

				callback && callback(null, audio)
				return Promise.resolve(audio)
			}, error => {
				callback && callback(error)
				return Promise.reject(error)
			})

			// save promise to cache
			Audio.cache[source] = promise
		}
	}

	// multiple sources
	else if (Array.isArray(source)) {
		let items = []

		// make sure for every array item audio instance is created and loaded
		for (let i = 0; i < source.length; i++) {
			let a = source[i]
			if (typeof a === 'string') {
				a = resolvePath(a, 2)
				items[i] = Audio.load(a)
			}
			else if (isPromise(a)) {
				items[i] = a
			}
			else {
				items[i] = Promise.resolve(Audio(a))
			}
		}

		// then do promise once all loaded
		promise = Promise.all(items).then((list) => {
			callback && callback(null, list)
			return Promise.resolve(list)
		}, error => {
			callback && callback(error)
			return Promise.reject(error)
		})
	}

	// fall back non-string sources to decode
	else {
		promise = Audio.decode(source, callback)
	}

	return promise
}


// decode audio buffer
Audio.decode = function decode (source, options, callback) {
	if (typeof options === 'function') {
		callback = options
		options = {context: this.context}
	}

	if (!source) throw Error('No source to decode');

	// decode multiple items
	if (Array.isArray(source)) {
		let items = []

		// make sure for every array item audio instance is created and loaded
		for (let i = 0; i < source.length; i++) {
			let a = source[i]
			if (isPromise(a)) {
				items[i] = a
			}
			else {
				items[i] = Audio.decode(a)
			}
		}

		// then do promise once all loaded
		return Promise.all(items).then((list) => {
			callback && callback(null, list)
			return Promise.resolve(list)
		}, error => {
			callback && callback(error)
			return Promise.reject(error)
		})
	}

	// convert to AudioBuffer
	return decodeAudio(source, options).then(
		audioBuffer => {
			let audio = Audio(audioBuffer)
			callback && callback(null, audio)
			return audio
		},
		error => {
			callback && callback(error)
			return Promise.reject(error)
		}
	)
}


// record streamish source
Audio.record = function record (source, options, callback) {

}


// download file or create a file in node
Audio.prototype.save = function save (fileName, ondone) {
	if (!fileName) throw Error('File name is not provided')

	let buffer = this.read({format: 'audiobuffer'})

	let wav = toWav(buffer)

	// fix path for node
	fileName = resolvePath(fileName)

	saveAs(wav, fileName, (err) => {
		ondone && ondone(err, this)
	})

	return this
}

// test if audio is equal
Audio.equal = function (a, ...sources) {
	for (let i = 0; i < sources.length; i++) {
		let b = sources[i]

		if (a === b) return true
		if (a.length !== b.length || a.channels !== b.channels || a.sampleRate != b.sampleRate) return false


		for (let c = 0; c < a.channels; c++) {
			let dataA = a.read({channel: c});
			let dataB = b.read({channel: c});

			for (let i = 0; i < dataA.length; i++) {
				if (dataA[i] !== dataB[i]) return false;
			}
		}
	}

	return true
}

