/**
 * @module  audio
 *
 * High-level audio container
 */
'use strict';

const AudioBuffer = require('audio-buffer');
const Emitter = require('events').EventEmitter;
const inherits = require('inherits');
const load = require('audio-loader');
const extend = require('just-extend');
const isBrowser = require('is-browser');
const util = require('audio-buffer-utils');
const decode = require('audio-decode');
const tick = require('next-tick');
const nidx = require('negative-index')
const isPromise = require('is-promise')

module.exports = Audio;


//for events sake
inherits(Audio, Emitter);


//require functionality
require('./src/playback')
require('./src/metrics')
require('./src/manipulations')


//@contructor
function Audio(source, options, onload) {
	if (!(this instanceof Audio)) return new Audio(source, options);

	if (options instanceof Function) {
		onload = options;
		options = {};
	}

	options = options || {};
	extend(this, options);

	//if user looks for loading
	if (onload) this.once('load', onload);

	this.buffer = new AudioBuffer(this.channels, 1, this.sampleRate);

	//launch init
	this.isReady = false;

	this.load(source, () => {
		this.isReady = true;
	});
}

//cache of loaded buffers for urls
Audio.cache = {};

//cache URL
Audio.prototype.cache = true;

//load file by url
Audio.prototype.load = function (src, onload) {
	if (!src) return this;

	//load cached version, if any
	if (this.cache && Audio.cache[src]) {
		//if loading already - just clone when loaded
		if (isPromise(Audio.cache[src])) {
			Audio.cache[src].then((audioBuffer) => {
				this.load(src);
			});
		}
		else {
			this.buffer = util.clone(Audio.cache[src])
			onload && onload(null, this);
			this.emit('load', this);
		}
		return this;
	}

	let promise = load(src).then(audioBuffer => {
		this.buffer = audioBuffer;

		//save cache
		if (this.cache) {
			Audio.cache[src] = audioBuffer;
		}

		onload && onload(null, this);
		this.emit('load', this);
	}, err => {
		onload && onload(err);
		this.emit('error', err);
	});

	//save promise to cache
	if (this.cache) {
		Audio.cache[src] = promise;
	}

	return this;
}

//return slice of data as an audio buffer
Audio.prototype.read = function (start, duration) {
	start = start || 0;
	duration = duration || this.buffer.duration;

	return this.readRaw(start * this.buffer.sampleRate, length * this.buffer.sampleRate)

	return buf;
}

Audio.prototype.readRaw = function (offset, length) {
	offset = Math.floor(nidx(offset || 0, this.buffer.length));
	length = Math.floor(Math.min(length || this.buffer.length, this.buffer.length - offset));
	console.log(this.buffer.getChannelData(0)[offset])
	let buf = util.slice(this.buffer, offset, offset + length);

	return buf;
}

/*
//put audio buffer data by offset
Audio.prototype.write = function (buffer, offsetTime) {
	if (!buffer || !buffer.length) return this;

	let offset = nidx(offsetTime || 0, this.buffer.duration) * this.buffer.sampleRate;

	let beginning = util.slice(0, offset);
	let end = util.slice(offset);

	this.buffer = util.concat(beginning, buffer, end);

	return this;
}
*/
