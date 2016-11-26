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
const play = require('audio-play');
const decode = require('audio-decode');
const normOffset = require('negative-index');
const tick = require('next-tick');
const nidx = require('negative-index')

module.exports = Audio;


//for events sake
inherits(Audio, Emitter);


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

//load file by url
Audio.prototype.load = function (src, onload) {
	if (!src) return this;

	load(src).then(audioBuffer => {
		this.buffer = audioBuffer;
		onload && onload(null, this);
		this.emit('load', this);
	}, err => {
		onload && onload(err);
		this.emit('error', err);
	});

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


//preview the sound
Audio.prototype.play = function (start, duration, how, onend) {
	//sort out args
	if (arguments.length === 1) {
		//start
		if (typeof start === 'number') {
		}
		//onend
		else if (start instanceof Function) {
			onend = start;
			start = null
		}
		//how
		else {
			how = start
			start = null
		}
	}
	else if (arguments.length === 2) {
		//start, duration
		if (typeof duration === 'number') {
		}
		else if (duration instanceof Function) {
			onend = duration;
			duration = null
			//start, onend
			if (typeof start === 'number') {
			}
			//how, onend
			else {
				how = start
				start = null
			}
		}
		//start, how
		else {
			how = duration
			duration = null
		}
	}
	else if (arguments.length === 3) {
		if (how instanceof Function) {
			onend = how
			how = null
			//start, duration, onend
			if (typeof duration === 'number') {
			}
			//start, how, onend
			else {
				how = duration
				duration = null
			}
		}
		//start, duration, how
		else {
		}
	}
	//start, duration, how, onend
	//no args
	else {
	}

	//normalize args
	start = start == null ? (this.playback && this.playback.currentTime) : nidx(start || 0, this.buffer.duration);
	duration = duration || (this.buffer.duration - start);
	how = how || {};

	if (!this.playback) {
		how.autostart = true;
		how.start = start;
		how.end = nidx(start + duration, this.buffer.duration);
		this.playback = play(this.buffer, how, () => {
			this.stop();
			onend && onend();
		});
	}
	else this.playback.play();

	this.emit('play');

	return this;
}

//pause playback
Audio.prototype.pause = function () {
	if (this.playback) {
		this.playback.pause();
		this.emit('pause');
	}

	return this;
}

//reset playback
Audio.prototype.stop = function () {
	if (this.playback) this.playback.pause();
	this.playback = null;

	this.emit('stop');

	return this;
}


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
