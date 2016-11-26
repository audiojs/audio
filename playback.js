/**
 * Extend audio with playback functionality
 *
 * @module  audio/playback
 */

'use strict'

const isPromise = require('is-promise')
const play = require('audio-play')
const nidx = require('negative-index')
let Audio = require('./')


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
	start = (start == null && this.playback) ? (this.playback && this.playback.currentTime) : nidx(start || 0, this.buffer.duration);
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


module.exports = Audio;
