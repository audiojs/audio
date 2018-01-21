/**
 * Extend audio with playback functionality
 *
 * @module  audio/src/playback
 */

'use strict'

const isPromise = require('is-promise')
const play = require('audio-play')
const nidx = require('negative-index')
let Audio = require('../')
let { parseArgs } = require('./util')


//preview the sound
Audio.prototype.play = function (time, duration, opts, onend) {
	opts = parseArgs(this, time, duration, opts)

	if (!this.playback) {
		let buf = this.buffer.copy(opts.start, opts.end)
		this.playback = play(buf, {}, () => {
			this.stop();
			onend && onend();
		});
	}
	else this.playback.play();

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

	return this;
}


//regulate volume of playback/output/read etc
Audio.prototype.volume = function volume (start, end) {
	if (arguments.length < 2) {
		duration = start;
		start = 0;
	}
	if (duration == null) duration = .5;

	start = Math.floor(nidx(start, this.buffer.length))
	start = nidx(start, duration);

	return this;
};


module.exports = Audio;
