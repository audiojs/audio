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
const pcm = require('pcm-util')
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
function Audio(source, options, onload) {
	if (!(this instanceof Audio)) return new Audio(source, options, onload)

	if (options instanceof Function) {
		onload = options
		options = {}
	}

	//handle channels-only options
	if (typeof options === 'number') options = {channels: options}

	if (!options) options = {}

	//init cache
	if (options.cache != null) this.cache = options.cache

	//enable metrics
	if (options.stats) this.stats = true

	//create buffer holder
	this.buffer = new AudioBufferList()


	//async source
	if (typeof source === 'string') {
		source = resolvePath(source, 3)

		//load cached version, if any
		if (this.cache && Audio.cache[source]) {
			//if source is cached but loading - just clone when loaded

			this.promise = Audio.cache[source].then((audio) => {
				this.insert(audio.buffer.clone())
				onload && onload(null, this)
				this.emit('load', this)
			}, (err) => {
				onload && onload(err)
				this.emit('error', err)
			})
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

	//data-arrays
	else if (ArrayBuffer.isView(source) || Array.isArray(source) && typeof source[0] === 'number') {
		if (!options.channels) options.channels = 1;
		source = new AudioBuffer(options.channels, source, options.sampleRate)
		this.insert(source, options)
		onload && onload(null, this)
		this.emit('load', this)
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
		this.promise = Promise.all(source).then(list => {
			this.insert(list)
			onload && onload(null, this)
			this.emit('load', this)
		}, err => {
			onload && onload(err)
			this.emit('error', err)
		})
	}
	else if (typeof source === 'number') {
		this.promise = Promise.resolve()
		let rate = options.sampleRate || pcm.defaults.sampleRate
		this.insert(source*rate, options)
		onload && onload(null, this)
		this.emit('load', this)
	}

	//TODO: stream case
	//TODO: buffer case

	//audiobuffer[list] case
	else if (isAudioBuffer(source)) {
		this.promise = Promise.resolve()
		this.insert(source)
		onload && onload(null, this)
		this.emit('load', this)
	}

	//other Audio instance
	else if (Audio.isAudio(source)) {
		this.promise = source.then(audio => {
			this.insert(audio.buffer.clone())
			onload && onload(null, this)
			this.emit('load', this)
		}, err => {
			onload && onload(err)
			this.emit('error', err)
		})
	}

	//null-case
	else if (!source) {
		this.promise = Promise.resolve()
		onload && onload(null, this)
		this.emit('load', this)
	}

	//redirect other cases to audio-loader
	else {
		//enforce arraybuffer
		//FIXME: it is possible to do direct reading of arrays via pcm.toAudioBuffer
		if (isBuffer(source)) {
			source = b2ab(source)
		}

		this.promise = load(source).then(audioBuffer => {
			this.insert(audioBuffer)
			onload && onload(null, this)
			this.emit('load', this)
		}, err => {
			onload && onload(err)
			this.emit('error', err)
		})
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
			return this.buffer.numberOfChannels || pcm.defaults.channels
		}
	},
	sampleRate: {
		set: function () {
			//TODO
			throw Error('Unimplemented.')
		},
		get: function () {
			return this.buffer.sampleRate || pcm.defaults.sampleRate
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

//resolved once promise is resolved
Audio.prototype.then = function (success, error, progress) {
	return this.promise.then(success, error, progress)
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
