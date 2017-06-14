/**
 * @module  audio
 *
 * High-level audio container
 */
'use strict'

const Emitter = require('events')
const inherits = require('inherits')
const load = require('audio-loader')
const extend = require('object-assign')
const nidx = require('negative-index')
const isPromise = require('is-promise')
const isBuffer = require('is-buffer')
const b2ab = require('buffer-to-arraybuffer')
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
const isRelative = require('is-relative')
const isPlainObj = require('is-plain-obj')
const getContext = require('audio-context')
const util = require('audio-buffer-utils')

module.exports = Audio


//for events sake
inherits(Audio, Emitter)


//utilities
Audio.prototype.toGain = Audio.prototype.fromDb = db.toGain
Audio.prototype.fromGain = Audio.prototype.toDb = db.fromGain


//augment functionality
require('./src/manipulations')
require('./src/playback')
require('./src/metrics')


//@contructor
function Audio(source, options) {
	if (!(this instanceof Audio)) return new Audio(source, options)

	//handle channels-only options
	if (typeof options === 'number') options = {channels: options}

	if (!options) options = {}

	//enable metrics
	if (options.stats) this.stats = true

	let context = options.context
	let sampleRate = options.sampleRate || (context && context.sampleRate) || 44100
	let channels = options.channels || 1

	//create buffer holder
	this.buffer = new AudioBufferList()

	//duration
	if (typeof source === 'number') {
		this.insert(new AudioBuffer(context, {
			length: source*sampleRate,
			sampleRate: sampleRate,
			channels: channels
		}))
	}

	//float-arrays
	else if (ArrayBuffer.isView(source)) {
		source = util.create(source, channels, sampleRate)
		this.insert(source)
	}

	//multiple sources
	else if (Array.isArray(source)) {
		//make sure every array item audio instance is created and loaded
		for (let i = 0; i < source.length; i++) {
			let subsource = Audio.isAudio(source[i]) ? source[i].buffer : Audio(source[i], options).buffer

			this.insert(subsource)
		}
	}

	//audiobuffer[list] case
	else if (isAudioBuffer(source) || source instanceof AudioBufferList) {
		this.insert(source)
	}

	//other Audio instance
	else if (Audio.isAudio(source)) {
		this.insert(audio.buffer.clone())
	}

	//null-case
	else if (!source) {}

	//redirect other cases to audio-loader
	else {
		//enforce arraybuffer
		//FIXME: it is possible to do direct reading of arrays via pcm.toAudioBuffer
		if (isBuffer(source)) {
			source = b2ab(source)
		}

		let audioBuffer = util.create(source, channels, sampleRate)
		this.insert(audioBuffer)
	}
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
	source = resolvePath(source, 3)

	//load cached version, if any
	if (this.cache && Audio.cache[source]) {
		//if source is cached but loading - just clone when loaded

		this.promise = Audio.cache[source].then(success, error)
	}

	//multiple sources
	else if (Array.isArray(source)) {
		let items = []
		//make sure every array item audio instance is created and loaded
		for (let i = 0; i < source.length; i++) {
			let a = source[i]
			items[i] = Audio.isAudio(a) ? a : Audio(a, options)
		}

		//then do promise once all loaded
		this.promise = Promise.all(source).then(success, error)
	}

	else {
		//load remote source
		this.promise = load(source).then(audioBuffer => {
			this.insert(audioBuffer)
			onload && onload(null, this)
			this.emit('load', this)
		}, err => {
			console.log(err)
			onload && onload(err)
			this.emit('error', err)
		})

		//save promise to cache
		if (this.cache) {
			Audio.cache[source] = this
		}
	}
}

Audio.from = function () {

}

Audio.decode = function () {
		//enforce arraybuffer
		//FIXME: it is possible to do direct reading of arrays via pcm.toAudioBuffer
		if (isBuffer(source)) {
			source = b2ab(source)
		}
		this.promise = load(source).then(audioBuffer => {
			this.insert(audioBuffer)
			success(audioBuffer)
		}, error)

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

	if (typeof options.channels == 'number') {
		return this.buffer.getChannelData(options.channel).subarray(options.start, options.end)
	}
	//transfer data for indicated channels
	else {
		let data = []
		let buf = this.buffer.slice(options.start, options.end)
		for (let i = 0; i < options.channel.length; i++) {
			let channel = options.channel[i]

			data.push(buf.getChannelData(channel))
		}
		return data
	}
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


//include start/end offsets and channel for options. Purely helper.
Audio.prototype._parseArgs = function (start, duration, options) {
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
	if (options.channels == null) {
		options.channels = []
		for (let i = 0; i < this.channels; i++) {
			options.channels.push(i)
		}
	}

	//detect raw interval
	if (options.start == null) {
		let startOffset = Math.floor(start * this.sampleRate)
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

	return options
}

//create a duplicate or clone of audio
Audio.prototype.clone = function (deep) {
	if (deep == null || deep) return new Audio(this.buffer.clone())
	else return new Audio(this.buffer)
}


function resolvePath (fileName, depth=2) {
	if (!isBrowser && isRelative(fileName)) {
		var callerPath = callsites()[depth].getFileName()
		fileName = path.dirname(callerPath) + path.sep + fileName
		fileName = path.normalize(fileName)
	}

	return fileName
}
