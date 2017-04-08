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

module.exports = Audio


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
				Audio.cache[source].then((audioBuffer) => {
					this.buffer = util.clone(audioBuffer)
					onload && onload(null, this)
					this.emit('load', this)
				})
			}
			//if source is cached - clone
			else {
				this.buffer = util.clone(Audio.cache[source])
				onload && onload(null, this)
				this.emit('load', this)
			}
		}

		else {
			//load remote source
			let promise = load(source).then(audioBuffer => {
				this.buffer = audioBuffer

				//save cache
				if (this.cache) {
					Audio.cache[source] = audioBuffer
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

	//syn data source cases
	else if (Array.isArray(source)) {
		this.buffer = util.create(source, options.channels, options.sampleRate)

		onload && onload(null, this)
		this.emit('load', this)
	}
	else if (typeof source === 'number') {
		this.buffer = util.create(source*options.sampleRate, options.channels, options.sampleRate)

		onload && onload(null, this)
		this.emit('load', this)
	}

	//TODO: stream case
	//TODO: buffer case

	//redirect other cases to audio-loader
	else {
		//enforce arraybuffer
		if (isBuffer(source)) {
			source = b2ab(source)
		}

		load(source).then(audioBuffer => {
			this.buffer = audioBuffer
			onload && onload(null, this)
			this.emit('load', this)
		}, err => {
			onload && onload(err)
			this.emit('error', err)
		})

	}

	//create silent buffer for the time of loading
	if (!this.buffer) this.buffer = util.create(1, options.channels, options.sampleRate)
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
		set: function () {
			//TODO
		},
		get: function () {
			return this.buffer.numberOfChannels
		}
	},
	sampleRate: {
		set: function () {
			//TODO
		},
		get: function () {
			return this.buffer.sampleRate
		}
	},
	duration: {
		set: function () {
			//TODO
		},
		get: function () {
			return this.buffer.duration
		}
	}
})


//download file or create a file in node
Audio.prototype.save = function (fileName, ondone) {
	if (!fileName) throw Error('File name is not provided')

	let wav = toWav(this.buffer)

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
