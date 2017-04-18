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
const util = require('audio-buffer-utils')
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
const AudioBufferList = require('audio-buffer-list')
const remix = require('audio-buffer-remix')

module.exports = Audio


//for events sake
inherits(Audio, Emitter)

//utilities
Audio.prototype.toGain = Audio.prototype.fromDb = db.toGain
Audio.prototype.fromGain = Audio.prototype.toDb = db.fromGain


//augment functionality
require('./src/playback')
require('./src/metrics')
require('./src/manipulations')


//@contructor
function Audio(source, options, onload) {
	if (!(this instanceof Audio)) return new Audio(source, options, onload)

	if (options instanceof Function) {
		onload = options
		options = {}
	}

	//handle channels-only options
	if (typeof options === 'number') options = {channels: options}

	options = extend({}, pcm.defaults, options)

	//init cache
	if (options.cache != null) this.cache = options.cache

	//enable metrics
	if (options.stats) this.stats = true


	//launch init
	this.isReady = false


	//async source
	if (typeof source === 'string') {
		//load cached version, if any
		if (this.cache && Audio.cache[source]) {
			//if source is cached but loading - just clone when loaded
			if (isPromise(Audio.cache[source])) {
				Audio.cache[source].then((audioBufferList) => {
					this.bufferList = new AudioBufferList(audioBufferList.slice())
					onload && onload(null, this)
					this.emit('load', this)
				})
			}
			//if source is cached - clone
			else {
				this.bufferList = new AudioBufferList(Audio.cache[source].slice())
				onload && onload(null, this)
				this.emit('load', this)
			}
		}

		else {
			//load remote source
			let promise = load(source).then(audioBuffer => {
				this.bufferList = new AudioBufferList(audioBuffer)

				//save cache
				if (this.cache) {
					Audio.cache[source] = this.bufferList
				}

				onload && onload(null, this)
				this.emit('load', this)
			}, err => {
				onload && onload(err)
				this.emit('error', err)
			})

			//save promise to cache
			if (this.cache) {
				Audio.cache[source] = promise
			}
		}
	}

	//sync data source cases
	else if (Array.isArray(source)) {
		this.bufferList = new AudioBufferList(util.create(source, options.channels, options.sampleRate))

		onload && onload(null, this)
		this.emit('load', this)
	}
	else if (typeof source === 'number') {
		this.bufferList = new AudioBufferList(util.create(source*options.sampleRate, options.channels, options.sampleRate))

		onload && onload(null, this)
		this.emit('load', this)
	}

	//TODO: stream case
	//TODO: buffer case

	//redirect other cases to audio-loader
	else {
		//enforce arraybuffer
		//FIXME: it is possible to do direct reading of arrays via pcm.toAudioBuffer
		if (isBuffer(source)) {
			source = b2ab(source)
		}

		load(source).then(audioBuffer => {
			this.bufferList = new AudioBufferList(audioBuffer)
			onload && onload(null, this)
			this.emit('load', this)
		}, err => {
			onload && onload(err)
			this.emit('error', err)
		})

	}

	//create silent buffer for the time of loading
	if (!this.bufferList) this.bufferList = new AudioBufferList(util.create(1, options.channels, options.sampleRate))
}

//cache of loaded audio buffers for urls
Audio.cache = {}

//cache URLs
Audio.prototype.cache = true

//enable metrics
Audio.prototype.stats = false

//default params
//TODO: make properties map channels/sampleRate by writing them
Object.defineProperties(Audio.prototype, {
	channels: {
		set: function (channels) {
			this.bufferList = remix(this.bufferList, this.numberOfChannels, channels)
			this.numberOfChannels = channels
		},
		get: function () {
			return this.bufferList.numberOfChannels
		}
	},
	sampleRate: {
		set: function () {
			//TODO
			throw Error('Unimplemented.')
		},
		get: function () {
			return this.bufferList.sampleRate
		}
	},
	duration: {
		set: function (duration) {
			let length = Math.floor(duration * this.sampleRate)
			this.bufferList = this.bufferList.shallowSlice(0, length)
		},
		get: function () {
			return this.bufferList.duration
		}
	}
})


//download file or create a file in node
Audio.prototype.save = function (fileName, ondone) {
	if (!fileName) throw Error('File name is not provided')

	let wav = toWav(this.bufferList.slice())

	//fix path for node
	if (!isBrowser) {
		var callerPath = callsites()[1].getFileName()
		fileName = path.dirname(callerPath) + path.sep + fileName
	}

	saveAs(wav, fileName, (err) => {
		ondone && ondone(err, this)
	})

	return this
}

