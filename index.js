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
const normOffset = require('negative-index');
const tick = require('next-tick');
const nidx = require('negative-index')
const isPromise = require('is-promise')

module.exports = Audio;


//for events sake
inherits(Audio, Emitter);


//require functionality
require('./playback')
require('./metrics')
require('./manipulations')


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

/*
//return slice of data as an audio buffer
Audio.prototype.read = function (start, duration) {
	start = normOffset(start || 0, this.buffer.duration) * this.buffer.sampleRate;
	duration = (duration || this.buffer.duration) * this.buffer.sampleRate;
	let buf = util.slice(this.buffer, start, start + duration);

	//FIXME: pad if duration is more than buffer.duration?

	return buf;
}

//put audio buffer data by offset
Audio.prototype.write = function (buffer, offsetTime) {
	if (!buffer || !buffer.length) return this;

	let offset = normOffset(offsetTime || 0, this.buffer.duration) * this.buffer.sampleRate;

	let beginning = util.slice(0, offset);
	let end = util.slice(offset);

	this.buffer = util.concat(beginning, buffer, end);

	return this;
}
*/


//Modifiers

//regulate volume of playback/output/read etc
Audio.prototype.volume = function volume (start, end) {
	if (arguments.length < 2) {
		duration = start;
		start = 0;
	}
	if (duration == null) duration = .5;
	start = normOffset(start);

	return this;
};

//apply fade curve
Audio.prototype.fadeIn = function (start, duration) {
	if (arguments.length < 2) {
		duration = start;
		start = 0;
	}
	if (duration == null) duration = .5;
	start = normOffset(start);

	return this;
}

Audio.prototype.fadeOut = function (start, duration) {
	if (arguments.length < 2) {
		duration = start;
		start = 0;
	}
	if (duration == null) duration = .5;
	start = normOffset(start);

	return this;
}

//regulate rate of playback/output/read etc
Audio.prototype.rate = function rate () {
	return this;
};

Audio.prototype.reverse = function reverse () {

	return this;
}
Audio.prototype.size = function size () {

	return this;
}
Audio.prototype.mix = function mix () {

	return this;
}
Audio.prototype.trim = function trim () {

	return this;
}
Audio.prototype.normalize = function normalize () {

	return this;
}
Audio.prototype.shift = function shift () {

	return this;
}
Audio.prototype.pad = function pad () {

	return this;
}
Audio.prototype.concat = function concat () {

	return this;
}
Audio.prototype.slice = function slice () {

	return this;
}
Audio.prototype.invert = function invert () {

	return this;
}
Audio.prototype.copy = function copy () {

	return this;
}
Audio.prototype.isEqual = function isEqual () {

	return this;
}
