/**
 * Extend audio with manipulations functionality
 *
 * @module  audio/src/manipulations
 */

'use strict'


let Audio = require('../')



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
