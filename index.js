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


module.exports = Audio;


//for events sake
inherits(Audio, Emitter);


//@contructor
function Audio(source, options) {
	if (!(this instanceof Audio)) return new Audio(source, options);

	options = options || {};

	extend(this, options);


	//launch init
	this.isReady = false;

	if (this.buffer) {
		this.isReady = true;
		this.emit('ready');
	}
	//load source from url
	else {
		this.load(source, () => {
			this.isReady = true;
			this.emit('ready');
		});
	}
}


//load file by url
Audio.prototype.load = function (src, cb) {
	if (!src) return this;

	load(src).then(audioBuffer => {
		this.buffer = audioBuffer;
		cb && cb(null, audioBuffer);
		this.emit('load', audioBuffer);
	}, err => {
		cb && cb(err);
		this.emit('error', err);
	});

	return this;
}


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


//preview the sound
Audio.prototype.play = function (how, end) {
	//if not ready - wait for it
	if (!this.buffer) return this.once('ready', () => this.play(how, end));

	if (!this.playback) {
		how = how || {};
		how.autostart = true;
		this.playback = play(this.buffer, how, () => {
			this.stop();
			end && end();
		});
	}
	else this.playback.play();

	this.emit('play');

	return this;
}

//pause playback
Audio.prototype.pause = function () {
	if (this.playback) this.playback.pause();

	this.emit('pause');

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
Audio.prototype.volume = function volume () {
	return this;
};

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
