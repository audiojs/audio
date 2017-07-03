/**
 * @module  audio
 *
 * High-level audio container
 */
'use strict'

const load = require('audio-loader')
const decode = require('audio-decode')
const extend = require('object-assign')
const nidx = require('negative-index')
const isPromise = require('is-promise')
const saveAs = require('save-file')
const isBrowser = require('is-browser')
const toWav = require('audiobuffer-to-wav')
const callsites = require('callsites')
const path = require('path')
const db = require('decibels')
const AudioBuffer = require('audio-buffer')
const AudioBufferList = require('audio-buffer-list')
const remix = require('audio-buffer-remix')
const isAudioBuffer = require('is-audio-buffer')
const isPlainObj = require('is-plain-obj')
const isRelative = require('is-relative')
const getContext = require('audio-context')
const isURL = require('is-url')
const convert = require('pcm-convert')
const aformat = require('audio-format')
const createBuffer = require('audio-buffer-from')
const assert = require('assert')

module.exports = Audio


//utilities
Audio.fromDb = db.toGain
Audio.toDb = db.fromGain


//augment functionality
require('./src/playback')
require('./src/metrics')
require('./src/manipulations')


//@contructor
function Audio(source, options) {
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

	//if nested arrays data - probably it is channels layout
	else if (Array.isArray(source) && !(Array.isArray(source[0]) || ArrayBuffer.isView(source[0]))) {
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
		let buf = createBuffer(source, options)
		this.buffer = new AudioBufferList(buf)
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


//cache of loaded audio buffers for urls
Audio.cache = {}

//cache URLs
Audio.prototype.cache = true

//enable metrics
Audio.prototype.stats = false

//default params
Object.defineProperties(Audio.prototype, {
	channels: {
		set: function (channels) {
			this.buffer = remix(this.buffer, this.numberOfChannels, channels)
			this.numberOfChannels = channels
		},
		get: function () {
			return this.buffer.numberOfChannels
		}
	},
	sampleRate: {
		set: function () {
			//TODO
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
				//TODO
				// this.buffer = this.pad({start: , right: true})
			}
		},
		get: function () {
			return this.buffer.length
		}
	}
})

//load audio from remote/local url
Audio.load = function (source, callback) {
	let promise

	if (typeof source === 'string') {
		source = resolvePath(source, 2)

		//load cached version, if any
		if (Audio.cache[source]) {
			//if source is cached but loading - just clone when loaded
			if (isPromise(Audio.cache[source])) {
				promise = Audio.cache[source].then(audio => {
					audio = Audio(audio)
					callback && callback(null, audio)
					return Promise.resolve(audio)
				}, error => {
					callback && callback(error)
					return Promise.reject(error)
				})
			}
			// else clone right ahead
			else {
				promise = Promise.resolve(Audio(Audio.cache[source]))
			}
		}

		//load source by path
		else {
			promise = load(source).then(audioBuffer => {
				let audio = Audio(audioBuffer)
				Audio.cache[source] = audio
				callback && callback(null, audio)
				return Promise.resolve(audio)
			}, error => {
				callback && callback(error)
				return Promise.reject(error)
			})

			//save promise to cache
			Audio.cache[source] = promise
		}
	}

	//multiple sources
	else if (Array.isArray(source)) {
		let items = []

		//make sure for every array item audio instance is created and loaded
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

		//then do promise once all loaded
		promise = Promise.all(items).then((list) => {
			callback && callback(null, list)
			return Promise.resolve(list)
		}, error => {
			callback && callback(error)
			return Promise.reject(error)
		})
	}

	//fall back non-string sources to decode
	else {
		promise = Audio.decode(source, callback)
	}

	return promise
}

//decode audio buffer
Audio.decode = function (source, options, callback) {
	if (typeof options === 'function') {
		callback = options
		options = {context: this.context}
	}

	if (!source) throw Error('No source to decode');

	//decode multiple items
	if (Array.isArray(source)) {
		let items = []

		//make sure for every array item audio instance is created and loaded
		for (let i = 0; i < source.length; i++) {
			let a = source[i]
			if (isPromise(a)) {
				items[i] = a
			}
			else {
				items[i] = Audio.decode(a)
			}
		}

		//then do promise once all loaded
		return Promise.all(items).then((list) => {
			callback && callback(null, list)
			return Promise.resolve(list)
		}, error => {
			callback && callback(error)
			return Promise.reject(error)
		})
	}

	//convert to AudioBuffer
	return decode(source, options).then(
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

//record streamish source
Audio.record = function (source, options, callback) {

}

//check if source is instance of audio
Audio.isAudio = function (source) {
	return source instanceof Audio
}

//download file or create a file in node
Audio.prototype.save = function (fileName, ondone) {
	if (!fileName) throw Error('File name is not provided')

	let wav = toWav(this.buffer.slice())

	//fix path for node
	fileName = resolvePath(fileName)

	saveAs(wav, fileName, (err) => {
		ondone && ondone(err, this)
	})

	return this
}

//create a duplicate or clone of audio
Audio.prototype.clone = function (deep) {
	if (deep == null || deep) return new Audio(this.buffer.clone())
	else return new Audio(this.buffer)
}

//get array representation of audio
Audio.prototype.toArray = function (options) {
	if (!options) {
		options = {dtype: 'array'}
	} else if (typeof options === 'string') {
		options = aformat.parse(options)
	}

	let format = extend({
		channels: this.channels
	}, options)

	let arr = convert(this.buffer.copy(), format)

	return arr
}

function resolvePath (fileName, depth=2) {
	if (!isBrowser && isRelative(fileName) && !isURL(fileName)) {
		var callerPath = callsites()[depth].getFileName()
		fileName = path.dirname(callerPath) + path.sep + fileName
		fileName = path.normalize(fileName)
	}

	return fileName
}

//include start/end offsets and channel for options.
Audio.prototype._parseArgs = function (time, duration, options, cb) {
	//no args at all
	if (time == null) {
		options = {}
		time = 0
		duration = this.duration
	}
	//single arg
	else if (duration == null) {
		//{}
		if (typeof time !== 'number') {
			options = time
			time = 0
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

	if (!time && duration < 0) time = -0;

	//ensure channels
	if (options.channel != null) {
		options.channels = options.channel
	}
	if (options.channels == null || typeof options.channels === 'number') {
		options.channels = []
		for (let i = 0; i < this.channels; i++) {
			options.channels.push(i)
		}
	}
	assert(Array.isArray(options.channels), 'Bad `channels` argument')

	//take over from/to params
	if (options.from != null) time = options.from
	if (options.to != null) duration = options.to - time
	if (options.length != null) duration = options.length * this.sampleRate

	//detect raw interval
	if (options.start == null) {
		let startOffset = Math.floor(time * this.sampleRate)
		startOffset = nidx(startOffset, this.buffer.length)
		options.start = startOffset
	}
	if (options.end == null) {
		let len = duration * this.sampleRate
		let endOffset;
		if (len < 0) {
			endOffset = nidx(options.start + len, this.buffer.length)
		}
		else {
			endOffset = Math.min(options.start + len, this.buffer.length)
		}
		options.end = endOffset
	}

	if (options.length == null) options.length = options.end - options.start

	return options
}
