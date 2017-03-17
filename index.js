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

	//handle channels-only options
	if (typeof options === 'number') options = {channels: options}

	options = extend({}, pcm.defaults, options)

	//init cache
	if (options.cache != null) this.cache = options.cache

	//if user looks for loading
	if (onload) this.once('load', onload)

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
				this.buffer = audioBuffer;

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
				Audio.cache[source] = promise;
			}
		}
	}

	//syn data source cases
	else if (Array.isArray(source) || typeof source === 'number') {
		this.buffer = util.create(source, options.channels, options.sampleRate)

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
Audio.cache = {};

//cache URL
Audio.prototype.cache = true;

//default params
//TODO: make properties map channels/sampleRate by writing them
Object.defineProperties(Audio.prototype, {
	channels: {
		set: function () {
			//TODO
		},
		get: function () {
			return this.buffer.channels
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


//download file (WAA) or create a file in node
Audio.prototype.download = function (fileName) {
	if (util.isBrowser()) {
		window.requestFileSystem = window.requestFileSystem || window.webkitRequestFileSystem;
		window.requestFileSystem(window.TEMPORARY, arrayBuffer.byteLength, function(fs) {
		fs.root.getFile(fileName, {create: true}, function(fileEntry) {
			fileEntry.createWriter(function(writer) {
				var dataView = new DataView(arrayBuffer);
				var blob = new Blob([dataView], {type: 'font/opentype'});
				writer.write(blob);

				writer.addEventListener('writeend', function() {
					// Navigating to the file will download it.
					location.href = fileEntry.toURL();
				}, false);
			});
			});
		},
		function(err) {
			throw new Error(err.name + ': ' + err.message);
		});
	} else {
		var fs = require('fs');
		var buffer = util.arrayBufferToNodeBuffer(arrayBuffer);
		fs.writeFileSync(fileName, buffer);
	}
}
